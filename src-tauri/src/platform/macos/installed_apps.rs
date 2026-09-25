pub use crate::platform::types::InstalledApp;
use objc2_foundation::{NSBundle, NSFileManager, NSString};
use std::{
    path::{Path, PathBuf},
    time::{Duration, Instant},
};
fn roots() -> Vec<PathBuf> {
    let mut roots: Vec<PathBuf> = [
        "/Applications",
        "/Applications/Utilities",
        "/System/Applications",
        "/System/Applications/Utilities",
    ]
    .into_iter()
    .map(PathBuf::from)
    .collect();
    if let Some(home) = std::env::var_os("HOME").map(PathBuf::from) {
        roots.push(home.join("Applications"));
        roots.push(home.join("Applications/Utilities"));
    }
    roots
}
fn describe(path: &Path) -> Option<InstalledApp> {
    objc2::rc::autoreleasepool(|_| {
        let p = NSString::from_str(path.to_str()?);
        let app_id = NSBundle::bundleWithPath(&p)?
            .bundleIdentifier()?
            .to_string();
        let display = NSFileManager::defaultManager()
            .displayNameAtPath(&p)
            .to_string();
        let name = display.strip_suffix(".app").unwrap_or(&display).to_string();
        (!app_id.is_empty()).then_some(InstalledApp { name, app_id })
    })
}
/// `.app` bundles in the standard application folders; AppID is the bundle identifier.
pub fn list() -> Result<Vec<InstalledApp>, String> {
    let mut out: Vec<InstalledApp> = Vec::new();
    for root in roots() {
        let Ok(entries) = std::fs::read_dir(&root) else {
            continue;
        };
        let mut paths: Vec<PathBuf> = entries.filter_map(|e| Some(e.ok()?.path())).collect();
        paths.sort();
        for path in paths {
            if path.extension().is_some_and(|e| e == "app") && path.is_dir() {
                if let Some(app) = describe(&path) {
                    if !out.iter().any(|a| a.app_id == app.app_id) {
                        out.push(app);
                    }
                }
            }
        }
    }
    out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(out)
}
pub fn launch(app_id: &str) -> Result<(), String> {
    if !list()?.iter().any(|a| a.app_id == app_id) {
        return Err("应用已卸载或启动入口已变化".into());
    }
    let mut child = std::process::Command::new("/usr/bin/open")
        .args(["-b", app_id])
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| e.to_string())?;
    let deadline = Instant::now() + Duration::from_secs(8);
    loop {
        if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
            if status.success() {
                return Ok(());
            }
            let out = child.wait_with_output().map_err(|e| e.to_string())?;
            return Err(format!(
                "启动应用失败：{}",
                String::from_utf8_lossy(&out.stderr).trim()
            ));
        }
        if Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            return Err("启动应用超时".into());
        }
        std::thread::sleep(Duration::from_millis(30));
    }
}

#[test]
fn macos_lists_terminal_bundle() {
    let apps = list().unwrap();
    let terminal = apps
        .iter()
        .find(|a| a.app_id == "com.apple.Terminal")
        .expect("Terminal.app in /System/Applications/Utilities");
    assert!(!terminal.name.is_empty());
    assert!(apps.iter().all(|a| !a.app_id.is_empty()));
}
