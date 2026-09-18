//! Stable desktop boundary. Main/IPC and protocol code contain no OS handles.
#[cfg(target_os = "macos")]
mod macos;
pub mod types;
#[cfg(not(windows))]
#[allow(dead_code)]
mod unsupported;
#[cfg(windows)]
mod windows;
#[cfg(target_os = "macos")]
pub use macos::*;
#[cfg(not(any(windows, target_os = "macos")))]
pub use unsupported::*;
#[cfg(windows)]
pub use windows::*;
