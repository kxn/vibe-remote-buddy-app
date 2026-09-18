use crate::platform::desktop;
pub fn tray_size() -> u32 {
    unsafe {
        use windows::{
            core::w,
            Win32::UI::{HiDpi::GetDpiForWindow, WindowsAndMessaging::FindWindowW},
        };
        let dpi = FindWindowW(w!("Shell_TrayWnd"), None)
            .ok()
            .map(|h| GetDpiForWindow(h))
            .filter(|d| *d > 0)
            .unwrap_or(96);
        (16 * dpi + 95) / 96
    }
}
pub fn picker_identity(w: &tauri::WebviewWindow) -> Result<desktop::Window, String> {
    let hwnd = w.hwnd().map_err(|e| e.to_string())?;
    Ok(desktop::Window {
        token: format!("{}:{}", hwnd.0 as usize, std::process::id()),
        title: "窗口选择".into(),
        process: "".into(),
        path: std::env::current_exe()
            .map_err(|e| e.to_string())?
            .to_string_lossy()
            .into_owned(),
    })
}
pub fn launch_path(p: &std::path::Path) -> Result<(), String> {
    std::process::Command::new(p)
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}
