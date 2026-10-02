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

/// One blocklist entry. `always` rules bite outside focus sessions too.
#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
struct BlockRule {
    #[serde(alias = "domain", alias = "process")]
    pattern: String,
    #[serde(default)]
    always: bool,
}

impl BlockRule {
    fn new(pattern: impl Into<String>, always: bool) -> Self {
        Self { pattern: pattern.into(), always }
    }
}

#[derive(Default)]
struct WebRules {
    rules: Vec<BlockRule>,
    reels_blocked: bool,
    study_mode: bool,
    channels: Vec<String>,
    /// block every site except `allowlist` while a session is running
    block_all: bool,
    allowlist: Vec<String>,
}

impl WebRules {
    /// Every pattern, with duplicates folded away (always wins over focus).
    fn patterns(&self) -> Vec<BlockRule> {
        let mut out: Vec<BlockRule> = Vec::new();
        for rule in &self.rules {
            match out.iter().position(|r| r.pattern == rule.pattern) {
                Some(index) => out[index].always = out[index].always || rule.always,
                None => out.push(rule.clone()),
            }
        }
        out
    }
}

struct AppState {
    is_blocking_active: AtomicBool,
    is_strict_mode: AtomicBool,
    blocked_processes: Arc<Mutex<Vec<BlockRule>>>,
    web_rules: Arc<Mutex<WebRules>>,
    /// number of extensions currently attached to the bridge
    bridge_clients: Arc<Mutex<u32>>,
    tx_channel: broadcast::Sender<String>,
}

/* ------------------------------------------------------------------ */
/* rule matching (mirrors src/lib/blocking.ts)                         */
/* ------------------------------------------------------------------ */

/// "C:\\Program Files\\Chess.com\\Chess.exe" -> "chess"
fn normalize_process(input: &str) -> String {
    let lowered = input.trim().to_lowercase().replace('\\', "/");
    let last = lowered.rsplit('/').next().unwrap_or(&lowered).to_string();
    let stripped = last.strip_suffix(".exe").unwrap_or(&last).to_string();
    stripped
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '+' | '-'))
        .collect()
}

/// "https://www.Chess.com/play" -> "chess.com"
fn normalize_domain(input: &str) -> String {
    let mut value = input.trim().to_lowercase();
    if let Some(idx) = value.find("://") {
        value = value[idx + 3..].to_string();
    }
    value = value.split(['/', '?', '#']).next().unwrap_or("").to_string();
    value = value.split(':').next().unwrap_or("").to_string();
    value = value.trim_matches('.').to_string();
    if let Some(rest) = value.strip_prefix("www.") {
        value = rest.to_string();
    }
    for prefix in ["m.", "mobile.", "amp.", "music."] {
        if let Some(rest) = value.strip_prefix(prefix) {
            value = rest.to_string();
        }
    }
    let looks_like_host = value.contains('.')
        && value.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-'));
    if looks_like_host {
        value
    } else {
        String::new()
    }
}

/// Rule matches the domain itself or any subdomain of it.
fn domain_matches(rule: &str, host: &str) -> bool {
    let r = normalize_domain(rule);
    let h = normalize_domain(host);
    if r.is_empty() || h.is_empty() {
        return false;
    }
    h == r || h.ends_with(&format!(".{r}"))
}

/// Matches a rule against a real foreground window. Process names rarely equal
/// what a user types, so the rule may also appear inside the process name or the
/// window title ("chess.com" -> "Chess.com - Play Chess").
fn process_matches(rule: &str, process_name: &str, window_title: &str) -> bool {
    let rule_norm = normalize_process(rule);
    let proc_norm = normalize_process(process_name);
    if rule_norm.is_empty() || proc_norm.is_empty() {
        return false;
    }
    if rule_norm == proc_norm {
        return true;
    }
    if rule_norm.len() >= 3 && proc_norm.contains(&rule_norm) {
        return true;
    }
    let stem = rule_norm.split('.').next().unwrap_or(&rule_norm);
    if rule_norm.len() >= 4 && !stem.is_empty() && stem == proc_norm {
        return true;
    }
    if rule_norm.len() >= 4 && !window_title.is_empty() {
        let title = window_title.to_lowercase();
        let plain = rule_norm.replace(['.', '_', '-'], " ");
        if title.contains(&rule_norm) || title.contains(&plain) {
            return true;
        }
        if stem.len() >= 5 && title.contains(stem) {
            return true;
        }
    }
    false
}

/// First matching rule wins. `active` = a focus session is running.
fn find_blocking_rule(
    rules: &[BlockRule],
    process_name: &str,
    window_title: &str,
    active: bool,
) -> Option<BlockRule> {
    rules
        .iter()
        .find(|rule| (active || rule.always) && process_matches(&rule.pattern, process_name, window_title))
        .cloned()
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
            .map(|w| w.patterns().iter().map(|r| r.pattern.clone()).collect::<Vec<String>>())
            .unwrap_or_default(),
        "rules": state
            .web_rules
            .lock()
            .map(|w| {
                w.patterns()
                    .iter()
                    .map(|r| serde_json::json!({ "domain": r.pattern, "always": r.always }))
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default(),
        "reelsBlocked": state.web_rules.lock().map(|w| w.reels_blocked).unwrap_or(false),
        "studyMode": state.web_rules.lock().map(|w| w.study_mode).unwrap_or(false),
        "channels": state.web_rules.lock().map(|w| w.channels.clone()).unwrap_or_default(),
        "blockAll": state.web_rules.lock().map(|w| w.block_all).unwrap_or(false),
        "allowlist": state
            .web_rules
            .lock()
            .map(|w| w.allowlist.clone())
            .unwrap_or_default(),
    })
    .to_string();
    let _ = state.tx_channel.send(payload);
}

/* ------------------------------------------------------------------ */
/* blocklists                                                          */
/* ------------------------------------------------------------------ */

#[tauri::command]
fn update_blocklist(state: tauri::State<AppState>, mut rules: Vec<BlockRule>) -> Vec<BlockRule> {
    if let Ok(mut blocklist) = state.blocked_processes.lock() {
        // Fold duplicates so the UI can send focus + always entries freely.
        let mut merged: Vec<BlockRule> = Vec::new();
        for rule in rules.drain(..) {
            let pattern = rule.pattern.trim().to_string();
            if pattern.is_empty() {
                continue;
            }
            match merged.iter().position(|r| r.pattern.eq_ignore_ascii_case(&pattern)) {
                Some(index) => merged[index].always = merged[index].always || rule.always,
                None => merged.push(BlockRule { pattern, always: rule.always }),
            }
        }
        *blocklist = merged.clone();
        broadcast_focus_state(&state);
        return merged;
    }
    Vec::new()
}

#[tauri::command]
fn get_blocklist(state: tauri::State<AppState>) -> Vec<BlockRule> {
    state.blocked_processes.lock().map(|b| b.clone()).unwrap_or_default()
}

#[tauri::command]
fn update_web_blocklist(state: tauri::State<AppState>, mut rules: Vec<BlockRule>) -> Vec<BlockRule> {
    let mut cleaned: Vec<BlockRule> = Vec::new();
    for rule in rules.drain(..) {
        let domain = normalize_domain(&rule.pattern);
        if domain.is_empty() {
            continue;
        }
        match cleaned.iter().position(|r| r.pattern == domain) {
            Some(index) => cleaned[index].always = cleaned[index].always || rule.always,
            None => cleaned.push(BlockRule { pattern: domain, always: rule.always }),
        }
    }
    if let Ok(mut web) = state.web_rules.lock() {
        web.rules = cleaned.clone();
    }
    broadcast_focus_state(&state);
    cleaned
}

/// Connection count for the "is my extension talking to the app?" chip.
#[tauri::command]
fn get_bridge_status(state: tauri::State<AppState>) -> serde_json::Value {
    serde_json::json!({
        "clients": state.bridge_clients.lock().map(|c| *c).unwrap_or(0),
        "port": BRIDGE_PORT,
    })
}

#[tauri::command]
fn update_extension_settings(
    state: tauri::State<AppState>,
    reels_blocked: bool,
    study_mode: bool,
    channels: Vec<String>,
    #[serde(default)] block_all: bool,
    #[serde(default)] allowlist: Vec<String>,
) {
    if let Ok(mut rules) = state.web_rules.lock() {
        rules.reels_blocked = reels_blocked;
        rules.study_mode = study_mode;
        rules.channels = channels;
        rules.block_all = block_all;
        rules.allowlist = allowlist
            .into_iter()
            .filter_map(|d| {
                let clean = normalize_domain(&d);
                if clean.is_empty() {
                    None
                } else {
                    Some(clean)
                }
            })
            .collect();
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
    // Mirrors APP_CATALOGUE in src/lib/defaults.ts: the UI replaces this list
    // as soon as it loads, this is only the cold-start default.
    let default_blocked: Vec<BlockRule> = [
        "discord.exe",
        "steam.exe",
        "tiktok.exe",
        "instagram.exe",
        "snapchat.exe",
        "Chess.exe",
        "chess.com.exe",
        "lichess.exe",
    ]
    .iter()
    .map(|p| BlockRule::new(*p, false))
    .collect();

    let (tx, _rx) = broadcast::channel::<String>(64);

    let state = AppState {
        is_blocking_active: AtomicBool::new(false),
        is_strict_mode: AtomicBool::new(false),
        blocked_processes: Arc::new(Mutex::new(default_blocked)),
        bridge_clients: Arc::new(Mutex::new(0)),
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
            get_bridge_status,
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
                            let bridge_clients = client.state::<AppState>().bridge_clients.clone();
                            let connected = match bridge_clients.lock() {
                                Ok(mut count) => {
                                    *count += 1;
                                    *count
                                }
                                Err(_) => 0,
                            };
                            let _ = client.emit("bridge-clients", connected);

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
                                            "domains": web.as_ref().map(|w| w.patterns().iter().map(|r| r.pattern.clone()).collect::<Vec<String>>()).unwrap_or_default(),
                                            "rules": web.as_ref().map(|w| w.patterns().iter().map(|r| serde_json::json!({ "domain": r.pattern, "always": r.always })).collect::<Vec<_>>()).unwrap_or_default(),
                                            "reelsBlocked": web.as_ref().map(|w| w.reels_blocked).unwrap_or(false),
                                            "studyMode": web.as_ref().map(|w| w.study_mode).unwrap_or(false),
                                            "blockAll": web.as_ref().map(|w| w.block_all).unwrap_or(false),
                                            "allowlist": web.as_ref().map(|w| w.allowlist.clone()).unwrap_or_default(),
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
                                    let bridge_clients = client.state::<AppState>().bridge_clients.clone();
                                    let remaining = match bridge_clients.lock() {
                                        Ok(mut count) => {
                                            *count = count.saturating_sub(1);
                                            *count
                                        }
                                        Err(_) => 0,
                                    };
                                    let _ = client.emit("bridge-clients", remaining);
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

                        // focus-only rules need a session; always-rules do not

                        // Fuzzy match on process name *and* window title, so a
                        // rule like "chess.com" also catches "Chess.exe" and
                        // "Chess.com - Play Chess". "Always" rules apply even
                        // when no session is running.
                        let rules = blocked_ref.lock().map(|list| list.clone()).unwrap_or_default();
                        let matched = find_blocking_rule(&rules, &info.process_name, &info.window_title, is_active);

                        if let Some(rule) = matched {
                            monitor::minimize_active_window();
                            let payload = serde_json::json!({
                                "process_name": info.process_name,
                                "window_title": info.window_title,
                                "pid": info.pid,
                                "domain": info.domain,
                                "rule": rule.pattern,
                                "always": rule.always,
                            });
                            let _ = app_handle.emit("distraction-blocked", payload);
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
