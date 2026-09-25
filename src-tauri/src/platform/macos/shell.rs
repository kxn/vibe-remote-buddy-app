pub use super::super::unsupported::shell::tray_size;
use super::desktop;
use objc2_app_kit::NSWindow;
/// The picker's own window as a desktop token (`pid:windowNumber`), so the
/// shared picker flow can verify it really became the front window.
pub fn picker_identity(w: &tauri::WebviewWindow) -> Result<desktop::Window, String> {
    let ptr = w.ns_window().map_err(|e| e.to_string())? as usize;
    let number = super::sys::on_main(std::time::Duration::from_millis(500), move || {
        // SAFETY: tao keeps the NSWindow alive for the lifetime of the Tauri window.
        unsafe { &*(ptr as *const NSWindow) }.windowNumber()
    })?;
    if number <= 0 {
        return Err("窗口选择器尚未创建".into());
    }
    let info = desktop::app_info(std::process::id() as i32).ok_or("无法读取本应用信息")?;
    Ok(desktop::Window {
        token: format!("{}:{number}", std::process::id()),
        title: "窗口选择".into(),
        process: info.process,
        path: info.path,
    })
}
pub fn launch_path(p: &std::path::Path) -> Result<(), String> {
    std::process::Command::new("open")
        .arg("-a")
        .arg(p)
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}
