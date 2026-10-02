#[cfg(windows)]
use std::ffi::OsString;
#[cfg(windows)]
use std::os::windows::ffi::OsStringExt;
#[cfg(windows)]
use windows::Win32::Foundation::{CloseHandle, HANDLE, HWND};
#[cfg(windows)]
use windows::Win32::System::ProcessStatus::K32GetProcessImageFileNameW;
#[cfg(windows)]
use windows::Win32::System::Threading::{OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION};
#[cfg(windows)]
use windows::Win32::UI::WindowsAndMessaging::{
    GetForegroundWindow, GetWindowTextW, GetWindowThreadProcessId, ShowWindow, SW_MINIMIZE,
};

#[derive(Debug, Clone, serde::Serialize)]
pub struct ActiveWindowInfo {
    pub process_name: String,
    pub window_title: String,
    pub pid: u32,
}

#[cfg(windows)]
pub fn get_active_window() -> Option<ActiveWindowInfo> {
    unsafe {
        let hwnd: HWND = GetForegroundWindow();
        if hwnd.is_invalid() || hwnd.0.is_null() {
            return None;
        }

        // 1. Window Title
        let mut title_buf = [0u16; 512];
        let len = GetWindowTextW(hwnd, &mut title_buf);
        let window_title = OsString::from_wide(&title_buf[..len as usize])
            .to_string_lossy()
            .to_string();

        // 2. Process ID
        let mut pid: u32 = 0;
        GetWindowThreadProcessId(hwnd, Some(&mut pid));
        if pid == 0 {
            return None;
        }

        // 3. Process binary executable name
        let process_handle: HANDLE = match OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) {
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
        })
    }
}

#[cfg(windows)]
pub fn minimize_active_window() {
    unsafe {
        let hwnd: HWND = GetForegroundWindow();
        if !hwnd.is_invalid() && !hwnd.0.is_null() {
            let _ = ShowWindow(hwnd, SW_MINIMIZE);
        }
    }
}

#[cfg(not(windows))]
pub fn get_active_window() -> Option<ActiveWindowInfo> {
    None
}

#[cfg(not(windows))]
pub fn minimize_active_window() {}