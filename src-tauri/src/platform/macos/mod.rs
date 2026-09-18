// Native AX/TIS implementations belong here; never fall through to Win32.
pub use super::unsupported::{activate, desktop, ime, installed_apps};
pub const DESKTOP_AVAILABLE: bool = false;
pub const TRAY_MENU_ON_LEFT_CLICK: bool = true;
pub mod shell {
    pub use super::super::unsupported::shell::{picker_identity, tray_size};
    pub fn launch_path(p: &std::path::Path) -> Result<(), String> {
        std::process::Command::new("open")
            .arg("-a")
            .arg(p)
            .spawn()
            .map(|_| ())
            .map_err(|e| e.to_string())
    }
}
