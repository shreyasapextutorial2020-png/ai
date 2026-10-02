//! Regain PC core — focus engine, native blocker and browser bridge.
//!
//! The Rust side owns three things:
//!   1. the focus state machine (is a session active / strict / what is blocked),
//!   2. foreground-window detection + interception,
//!   3. a local WebSocket bridge on 127.0.0.1:48123 that streams focus state and
//!      blocklists to the Regain browser extension and receives the active tab
//!      domain back (used for website blocking and screen-time attribution).

pub mod monitor;

use futures_util::{SinkExt, StreamExt};
use std::collections::HashSet;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{Emitter, Manager};
use tokio::net::TcpListener;
use tokio::sync::broadcast;
use tokio_tungstenite::accept_async;
use tokio_tungstenite::tungstenite::Message;

use monitor::ActiveWindowInfo;

/// Port the browser extension connects to.
const BRIDGE_PORT: u16 = 48123;

#[derive(Default)]
struct WebRules {
    domains: HashSet<String>,
    reels_blocked: bool,
    study_mode: bool,
    channels: Vec<String>,
}

struct AppState {
    is_blocking_active: AtomicBool,
    is_strict_mode: AtomicBool,
    blocked_processes: Arc<Mutex<HashSet<String>>>,
    web_rules: Arc<Mutex<WebRules>>,
    tx_channel: broadcast::Sender<String>,
}

/* ------------------------------------------------------------------ */
/* focus state                                                         */
/* ------------------------------------------------------------------ */

#[tauri::command]
fn toggle_focus_mode(state: tauri::State<AppState>, active: bool) -> bool {
    state.is_blocking_active.store(active, Ordering::SeqCst);
    broadcast_focus_state(&state);
    active
}

#[tauri::command]
fn set_strict_mode(state: tauri::State<AppState>, enabled: bool) {
    state.is_strict_mode.store(enabled, Ordering::SeqCst);
    broadcast_focus_state(&state);
}

/// Optional timer mirror so the bridge knows when the session will end even if
/// the UI window is hidden.
#[tauri::command]
fn sync_timer(
    state: tauri::State<AppState>,
    mode: String,
    remaining_sec: i64,
    planned_sec: i64,
    label: String,
) {
    let payload = serde_json::json!({
        "type": "TIMER",
        "mode": mode,
        "remainingSec": remaining_sec,
        "plannedSec": planned_sec,
        "label": label,
    })
    .to_string();
    let _ = state.tx_channel.send(payload);
}

fn broadcast_focus_state(state: &tauri::State<AppState>) {
    let payload = serde_json::json!({
        "type": "FOCUS_MODE_STATE",
        "active": state.is_blocking_active.load(Ordering::SeqCst),
        "strict": state.is_strict_mode.load(Ordering::SeqCst),
        "domains": state
            .web_rules
            .lock()
            .map(|w| w.domains.iter().cloned().collect::<Vec<String>>())
            .unwrap_or_default(),
        "reelsBlocked": state.web_rules.lock().map(|w| w.reels_blocked).unwrap_or(false),
        "studyMode": state.web_rules.lock().map(|w| w.study_mode).unwrap_or(false),
        "channels": state.web_rules.lock().map(|w| w.channels.clone()).unwrap_or_default(),
    })
    .to_string();
    let _ = state.tx_channel.send(payload);
}

/* ------------------------------------------------------------------ */
/* blocklists                                                          */
/* ------------------------------------------------------------------ */

#[tauri::command]
fn update_blocklist(state: tauri::State<AppState>, list: Vec<String>) {
    if let Ok(mut blocklist) = state.blocked_processes.lock() {
        blocklist.clear();
        for item in list {
            blocklist.insert(item.to_lowercase());
        }
    }
    broadcast_focus_state(&state);
}

#[tauri::command]
fn get_blocklist(state: tauri::State<AppState>) -> Vec<String> {
    state
        .blocked_processes
        .lock()
        .map(|b| b.iter().cloned().collect())
        .unwrap_or_default()
}

#[tauri::command]
fn update_web_blocklist(state: tauri::State<AppState>, list: Vec<String>) -> Vec<String> {
    let cleaned: Vec<String> = list
        .into_iter()
        .map(|d| d.trim().to_lowercase().replace("www.", ""))
        .filter(|d| !d.is_empty())
        .collect();
    if let Ok(mut rules) = state.web_rules.lock() {
        rules.domains = cleaned.iter().cloned().collect();
    }
    broadcast_focus_state(&state);
    cleaned
}

#[tauri::command]
fn update_extension_settings(
    state: tauri::State<AppState>,
    reels_blocked: bool,
    study_mode: bool,
    channels: Vec<String>,
) {
    if let Ok(mut rules) = state.web_rules.lock() {
        rules.reels_blocked = reels_blocked;
        rules.study_mode = study_mode;
        rules.channels = channels;
    }
    broadcast_focus_state(&state);
}

/* ------------------------------------------------------------------ */
/* window utilities                                                    */
/* ------------------------------------------------------------------ */

#[tauri::command]
fn get_active_window() -> Option<ActiveWindowInfo> {
    monitor::get_active_window()
}

#[tauri::command]
fn minimize_active_window() {
    monitor::minimize_active_window();
}

#[tauri::command]
fn show_blocker_window(app: tauri::AppHandle, app_name: String, title: String) {
    if let Some(win) = app.get_webview_window("blocker") {
        let _ = win.emit(
            "blocker-payload",
            serde_json::json!({ "app": app_name, "title": title }),
        );
        let _ = win.show();
        let _ = win.set_focus();
    }
}

#[tauri::command]
fn hide_blocker_window(app: tauri::AppHandle) {
    if let Some(win) = app.get_webview_window("blocker") {
        let _ = win.hide();
    }
}

/// Emits a desktop notification request to the frontend, which uses the OS
/// notification channel available on the current platform.
#[tauri::command]
fn notify(app: tauri::AppHandle, title: String, body: String) {
    let _ = app.emit("regain-notify", serde_json::json!({ "title": title, "body": body }));
}

/* ------------------------------------------------------------------ */
/* bootstrap                                                           */
/* ------------------------------------------------------------------ */

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut default_blocked = HashSet::new();
    for process in [
        "discord.exe",
        "steam.exe",
        "tiktok.exe",
        "instagram.exe",
        "snapchat.exe",
    ] {
        default_blocked.insert(process.to_string());
    }

    let (tx, _rx) = broadcast::channel::<String>(64);

    let state = AppState {
        is_blocking_active: AtomicBool::new(false),
        is_strict_mode: AtomicBool::new(false),
        blocked_processes: Arc::new(Mutex::new(default_blocked)),
        web_rules: Arc::new(Mutex::new(WebRules::default())),
        tx_channel: tx.clone(),
    };

    let blocked_ref = state.blocked_processes.clone();

    tauri::Builder::default()
        .manage(state)
        .invoke_handler(tauri::generate_handler![
            toggle_focus_mode,
            set_strict_mode,
            sync_timer,
            update_blocklist,
            get_blocklist,
            update_web_blocklist,
            update_extension_settings,
            get_active_window,
            minimize_active_window,
            show_blocker_window,
            hide_blocker_window,
            notify
        ])
        .setup(move |app| {
            let app_handle = app.handle().clone();

            // Strict Mode protects the main window from being closed mid-session.
            if let Some(main_win) = app.get_webview_window("main") {
                let handle_clone = app_handle.clone();
                main_win.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        let state = handle_clone.state::<AppState>();
                        let is_strict = state.is_strict_mode.load(Ordering::SeqCst);
                        let is_focus = state.is_blocking_active.load(Ordering::SeqCst);
                        if is_strict && is_focus {
                            api.prevent_close();
                            let _ = handle_clone.emit("strict-mode-prevent-exit", ());
                        }
                    }
                });
            }

            // 1. WebSocket bridge for the browser extension (and other tools).
            let tx_server = tx.clone();
            let bridge_handle = app_handle.clone();
            tauri::async_runtime::spawn(async move {
                match TcpListener::bind(("127.0.0.1", BRIDGE_PORT)).await {
                    Ok(listener) => {
                        println!("[WS Server] Listening on ws://127.0.0.1:{BRIDGE_PORT}");
                        while let Ok((stream, _)) = listener.accept().await {
                            let mut rx_sub = tx_server.subscribe();
                            let client = bridge_handle.clone();

                            tauri::async_runtime::spawn(async move {
                                if let Ok(ws_stream) = accept_async(stream).await {
                                    let (mut sink, mut source) = ws_stream.split();

                                    // Initial state for the freshly connected client.
                                    let initial = {
                                        let state = client.state::<AppState>();
                                        let web = state.web_rules.lock().ok();
                                        serde_json::json!({
                                            "type": "FOCUS_MODE_STATE",
                                            "active": state.is_blocking_active.load(Ordering::SeqCst),
                                            "strict": state.is_strict_mode.load(Ordering::SeqCst),
                                            "domains": web.as_ref().map(|w| w.domains.iter().cloned().collect::<Vec<String>>()).unwrap_or_default(),
                                            "reelsBlocked": web.as_ref().map(|w| w.reels_blocked).unwrap_or(false),
                                            "studyMode": web.as_ref().map(|w| w.study_mode).unwrap_or(false),
                                            "channels": web.as_ref().map(|w| w.channels.clone()).unwrap_or_default(),
                                        })
                                        .to_string()
                                    };
                                    if sink.send(Message::Text(initial)).await.is_err() {
                                        return;
                                    }

                                    // Extension → desktop: active domain reports.
                                    let inbound = client.clone();
                                    let reader = tauri::async_runtime::spawn(async move {
                                        while let Some(Ok(message)) = source.next().await {
                                            if let Message::Text(text) = message {
                                                if let Ok(value) =
                                                    serde_json::from_str::<serde_json::Value>(&text)
                                                {
                                                    if value.get("type").and_then(|t| t.as_str())
                                                        == Some("ACTIVE_DOMAIN")
                                                    {
                                                        let _ = inbound.emit(
                                                            "extension-domain",
                                                            value.clone(),
                                                        );
                                                    }
                                                }
                                            }
                                        }
                                    });

                                    // Desktop → extension: state + blocklist fan-out.
                                    while let Ok(message) = rx_sub.recv().await {
                                        if sink.send(Message::Text(message)).await.is_err() {
                                            break;
                                        }
                                    }
                                    reader.abort();
                                }
                            });
                        }
                    }
                    Err(error) => {
                        eprintln!("[WS Server Error] Failed to bind 127.0.0.1:{BRIDGE_PORT}: {error:?}");
                    }
                }
            });

            // 2. Foreground window monitor + interception loop.
            tauri::async_runtime::spawn(async move {
                loop {
                    tokio::time::sleep(Duration::from_millis(400)).await;

                    let is_active = app_handle
                        .state::<AppState>()
                        .is_blocking_active
                        .load(Ordering::SeqCst);

                    if let Some(info) = monitor::get_active_window() {
                        let _ = app_handle.emit("window-focus-changed", &info);

                        if !is_active {
                            continue;
                        }

                        let blocked = blocked_ref
                            .lock()
                            .map(|list| list.contains(&info.process_name.to_lowercase()))
                            .unwrap_or(false);

                        if blocked {
                            monitor::minimize_active_window();
                            let _ = app_handle.emit("distraction-blocked", &info);
                            if let Some(win) = app_handle.get_webview_window("blocker") {
                                let _ = win.show();
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
