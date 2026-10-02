//! Foreground-window detection and interception.
//!
//! Windows uses the native Win32 API (no extra permissions required).
//! macOS and Linux shells fall back to AppleScript / xdotool so the same
//! focus engine works on all desktop targets. Only the process name and window
//! title are read — never screen content.

#[derive(Debug, Clone, serde::Serialize)]
pub struct ActiveWindowInfo {
    pub process_name: String,
    pub window_title: String,
    pub pid: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub domain: Option<String>,
}

/* ------------------------------------------------------------------ */
/* Windows                                                             */
/* ------------------------------------------------------------------ */

#[cfg(windows)]
mod platform {
    use super::ActiveWindowInfo;
    use std::ffi::OsString;
    use std::os::windows::ffi::OsStringExt;
    use windows::Win32::Foundation::{CloseHandle, HANDLE, HWND};
    use windows::Win32::System::ProcessStatus::K32GetProcessImageFileNameW;
    use windows::Win32::System::Threading::{OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION};
    use windows::Win32::UI::WindowsAndMessaging::{
        GetForegroundWindow, GetWindowTextW, GetWindowThreadProcessId, ShowWindow, SW_MINIMIZE,
    };

    pub fn get_active_window() -> Option<ActiveWindowInfo> {
        unsafe {
            let hwnd: HWND = GetForegroundWindow();
            if hwnd.is_invalid() || hwnd.0.is_null() {
                return None;
            }

            let mut title_buf = [0u16; 512];
            let len = GetWindowTextW(hwnd, &mut title_buf);
            let window_title = OsString::from_wide(&title_buf[..len.max(0) as usize])
                .to_string_lossy()
                .to_string();

            let mut pid: u32 = 0;
            GetWindowThreadProcessId(hwnd, Some(&mut pid));
            if pid == 0 {
                return None;
            }

            let process_handle: HANDLE =
                match OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) {
                    Ok(handle) => handle,
                    Err(_) => return None,
                };

            let mut path_buf = [0u16; 1024];
            let path_len = K32GetProcessImageFileNameW(process_handle, &mut path_buf);
            let _ = CloseHandle(process_handle);

            if path_len == 0 {
                return None;
            }

            let full_path = OsString::from_wide(&path_buf[..path_len as usize])
                .to_string_lossy()
                .to_string();

            let process_name = full_path
                .rsplit('\\')
                .next()
                .unwrap_or(&full_path)
                .to_string();

            Some(ActiveWindowInfo {
                process_name,
                window_title,
                pid,
                domain: None,
            })
        }
    }

    pub fn minimize_active_window() {
        unsafe {
            let hwnd: HWND = GetForegroundWindow();
            if !hwnd.is_invalid() && !hwnd.0.is_null() {
                let _ = ShowWindow(hwnd, SW_MINIMIZE);
            }
        }
    }
}

/* ------------------------------------------------------------------ */
/* macOS                                                               */
/* ------------------------------------------------------------------ */

#[cfg(target_os = "macos")]
mod platform {
    use super::ActiveWindowInfo;
    use std::process::Command;

    fn osascript(script: &str) -> Option<String> {
        let output = Command::new("osascript").arg("-e").arg(script).output().ok()?;
        if !output.status.success() {
            return None;
        }
        let text = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if text.is_empty() {
            None
        } else {
            Some(text)
        }
    }

    pub fn get_active_window() -> Option<ActiveWindowInfo> {
        let process_name = osascript(
            "tell application \"System Events\" to get name of first application process whose frontmost is true",
        )?;

        let window_title = osascript(
            "tell application \"System Events\" to get name of front window of (first application process whose frontmost is true)",
        )
        .unwrap_or_default();

        let pid = osascript(
            "tell application \"System Events\" to get unix id of first application process whose frontmost is true",
        )
        .and_then(|value| value.trim().parse::<u32>().ok())
        .unwrap_or(0);

        Some(ActiveWindowInfo {
            process_name,
            window_title,
            pid,
            domain: None,
        })
    }

    pub fn minimize_active_window() {
        let _ = osascript(
            "tell application \"System Events\" to set visible of first application process whose frontmost is true to false",
        );
    }
}

/* ------------------------------------------------------------------ */
/* Linux                                                               */
/* ------------------------------------------------------------------ */

#[cfg(all(unix, not(target_os = "macos")))]
mod platform {
    use super::ActiveWindowInfo;
    use std::fs;
    use std::process::Command;

    fn xdotool(args: &[&str]) -> Option<String> {
        let output = Command::new("xdotool").args(args).output().ok()?;
        if !output.status.success() {
            return None;
        }
        let text = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if text.is_empty() {
            None
        } else {
            Some(text)
        }
    }

    pub fn get_active_window() -> Option<ActiveWindowInfo> {
        let window_title = xdotool(&["getactivewindow", "getwindowname"]).unwrap_or_default();

        let pid = xdotool(&["getactivewindow", "getwindowpid"])
            .and_then(|value| value.trim().parse::<u32>().ok())
            .unwrap_or(0);

        let process_name = if pid > 0 {
            fs::read_to_string(format!("/proc/{pid}/comm"))
                .map(|name| name.trim().to_string())
                .unwrap_or_else(|_| format!("pid-{pid}"))
        } else {
            "unknown".to_string()
        };

        Some(ActiveWindowInfo {
            process_name,
            window_title,
            pid,
            domain: None,
        })
    }

    pub fn minimize_active_window() {
        let _ = xdotool(&["getactivewindow", "windowminimize"]);
    }
}

/* ------------------------------------------------------------------ */
/* unsupported targets                                                 */
/* ------------------------------------------------------------------ */

#[cfg(not(any(windows, unix)))]
mod platform {
    use super::ActiveWindowInfo;

    pub fn get_active_window() -> Option<ActiveWindowInfo> {
        None
    }

    pub fn minimize_active_window() {}
}

pub use platform::{get_active_window, minimize_active_window};
