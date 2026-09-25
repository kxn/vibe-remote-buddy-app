// Native AppKit/CG/AX/TIS implementation; never fall through to Win32.
pub mod activate;
pub mod desktop;
pub mod ime;
pub mod installed_apps;
pub mod shell;
mod sys;
pub const DESKTOP_AVAILABLE: bool = true;
pub const TRAY_MENU_ON_LEFT_CLICK: bool = true;
