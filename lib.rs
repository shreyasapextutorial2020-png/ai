pub mod monitor;

use futures_util::SinkExt;
use std::collections::HashSet;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{Emitter, Manager};
use tokio::net::TcpListener;
use tokio::sync::broadcast;
use tokio_tungstenite::accept_async;
use tokio_tungstenite::tungstenite::Message;

struct AppState {
    is_blocking_active: AtomicBool,
    is_strict_mode: AtomicBool,
    blocked_processes: Arc<Mutex<HashSet<String>>>,
    tx_channel: broadcast::Sender<String>,
}

#[tauri::command]
fn toggle_focus_mode(state: tauri::State<AppState>, active: bool) -> bool {
    state.is_blocking_active.store(active, Ordering::SeqCst);

    let payload = serde_json::json!({
        "type": "FOCUS_MODE_STATE",
        "active": active
    })
    .to_string();
    let _ = state.tx_channel.send(payload);

    active
}

#[tauri::command]
fn set_strict_mode(state: tauri::State<AppState>, enabled: bool) {
    state.is_strict_mode.store(enabled, Ordering::SeqCst);
}

#[tauri::command]
fn update_blocklist(state: tauri::State<AppState>, list: Vec<String>) {
    let mut blocklist = state.blocked_processes.lock().unwrap();
    blocklist.clear();
    for item in list {
        blocklist.insert(item.to_lowercase());
    }
}

#[tauri::command]
fn get_blocklist(state: tauri::State<AppState>) -> Vec<String> {
    let blocklist = state.blocked_processes.lock().unwrap();
    blocklist.iter().cloned().collect()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut default_blocked = HashSet::new();
    default_blocked.insert("discord.exe".into());
    default_blocked.insert("spotify.exe".into());
    default_blocked.insert("steam.exe".into());

    let (tx, _rx) = broadcast::channel::<String>(32);

    let state = AppState {
        is_blocking_active: AtomicBool::new(false),
        is_strict_mode: AtomicBool::new(false),
        blocked_processes: Arc::new(Mutex::new(default_blocked)),
        tx_channel: tx.clone(),
    };

    let blocked_ref = state.blocked_processes.clone();

    tauri::Builder::default()
        .manage(state)
        .invoke_handler(tauri::generate_handler![
            toggle_focus_mode,
            set_strict_mode,
            update_blocklist,
            get_blocklist
        ])
        .setup(move |app| {
            let app_handle = app.handle().clone();

            // Intercept window close event if strict mode is active
            if let Some(main_win) = app.get_webview_window("main") {
                let handle_clone = app_handle.clone();
                main_win.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        let is_strict = handle_clone
                            .state::<AppState>()
                            .is_strict_mode
                            .load(Ordering::SeqCst);
                        let is_focus = handle_clone
                            .state::<AppState>()
                            .is_blocking_active
                            .load(Ordering::SeqCst);

                        if is_strict && is_focus {
                            api.prevent_close();
                            let _ = handle_clone.emit("strict-mode-prevent-exit", ());
                        }
                    }
                });
            }

            // 1. WebSocket Server for Browser Extensions (Port 48123)
            let tx_server = tx.clone();
            let app_state_ref = app_handle.clone();
            tauri::async_runtime::spawn(async move {
                match TcpListener::bind("127.0.0.1:48123").await {
                    Ok(listener) => {
                        println!("[WS Server] Listening on ws://127.0.0.1:48123");
                        while let Ok((stream, _)) = listener.accept().await {
                            let mut rx_sub = tx_server.subscribe();
                            let current_state = app_state_ref.state::<AppState>();
                            let is_active = current_state.is_blocking_active.load(Ordering::SeqCst);

                            tauri::async_runtime::spawn(async move {
                                if let Ok(mut ws_stream) = accept_async(stream).await {
                                    // Send immediate initial state upon connection
                                    let initial_msg = serde_json::json!({
                                        "type": "FOCUS_MODE_STATE",
                                        "active": is_active
                                    })
                                    .to_string();
                                    let _ = ws_stream.send(Message::Text(initial_msg)).await;

                                    // Forward subsequent state updates
                                    while let Ok(msg) = rx_sub.recv().await {
                                        if ws_stream.send(Message::Text(msg)).await.is_err() {
                                            break;
                                        }
                                    }
                                }
                            });
                        }
                    }
                    Err(e) => {
                        eprintln!("[WS Server Error] Failed to bind 127.0.0.1:48123: {:?}", e);
                    }
                }
            });

            // 2. Process Monitor Loop
            tauri::async_runtime::spawn(async move {
                loop {
                    tokio::time::sleep(Duration::from_millis(400)).await;

                    let is_active = app_handle
                        .state::<AppState>()
                        .is_blocking_active
                        .load(Ordering::SeqCst);

                    if let Some(info) = monitor::get_active_window() {
                        let _ = app_handle.emit("window-focus-changed", &info);

                        if is_active {
                            let blocklist = blocked_ref.lock().unwrap();
                            if blocklist.contains(&info.process_name.to_lowercase()) {
                                monitor::minimize_active_window();
                                let _ = app_handle.emit("distraction-blocked", &info);
                            }
                        }
                    }
                }
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}