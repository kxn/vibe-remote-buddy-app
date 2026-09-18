pub const DESKTOP_AVAILABLE: bool = false;
pub const TRAY_MENU_ON_LEFT_CLICK: bool = false;
pub mod desktop {
    pub use super::super::types::{Focus, Window};
    pub fn list() -> Result<Vec<Window>, String> {
        Err("此平台的窗口操作尚未适配".into())
    }
    pub fn foreground() -> Result<Window, String> {
        Err("此平台的窗口操作尚未适配".into())
    }
    pub fn activate(_: &Window) -> Result<(), String> {
        Err("此平台的窗口操作尚未适配".into())
    }
    pub fn focus(_: &Window, _: &Focus) -> Result<(), String> {
        Err("此平台的输入框聚焦尚未适配".into())
    }
    pub fn command(_: &str) -> Result<(), String> {
        Err("此平台的窗口操作尚未适配".into())
    }

    pub fn current_token() -> String {
        String::new()
    }
}
pub mod installed_apps {
    pub use super::super::types::InstalledApp;
    pub fn list() -> Result<Vec<InstalledApp>, String> {
        Err("此平台的应用启动适配尚未实现".into())
    }
    pub fn launch(_: &str) -> Result<(), String> {
        Err("此平台的应用启动适配尚未实现".into())
    }
}
pub mod ime {
    pub fn switch(_: &super::super::types::Window, _: &str) -> Result<(), String> {
        Err("此平台尚不支持自动切换输入法".into())
    }
}
pub mod activate {
    pub fn existing(_: &str) -> Result<bool, String> {
        Ok(false)
    }
}
pub mod shell {
    pub fn tray_size() -> u32 {
        32
    }
    pub fn picker_identity(
        _: &tauri::WebviewWindow,
    ) -> Result<super::super::types::Window, String> {
        Err("此平台的窗口选择尚未适配".into())
    }
    pub fn launch_path(p: &std::path::Path) -> Result<(), String> {
        std::process::Command::new(p)
            .spawn()
            .map(|_| ())
            .map_err(|e| e.to_string())
    }
}
