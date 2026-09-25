use super::sys::{
    self, cg_windows, require_trusted, Ax, EXCLUDE_DESKTOP, INCLUDING_WINDOW, ON_SCREEN,
};
pub use crate::platform::types::{Focus, Window};
use objc2_app_kit::{
    NSApplication, NSApplicationActivationOptions, NSApplicationActivationPolicy,
    NSRunningApplication, NSWindowOrderingMode, NSWorkspace,
};
use std::{
    collections::HashMap,
    sync::Mutex,
    time::{Duration, Instant},
};
static CYCLE: Mutex<Option<(bool, Vec<Window>, String, Instant)>> = Mutex::new(None);

pub(super) struct AppInfo {
    pub regular: bool,
    pub name: String,
    pub process: String,
    pub path: String,
}
pub(super) fn app_info(pid: i32) -> Option<AppInfo> {
    objc2::rc::autoreleasepool(|_| {
        let app = NSRunningApplication::runningApplicationWithProcessIdentifier(pid)?;
        if app.isTerminated() {
            return None;
        }
        let exe = app
            .executableURL()
            .and_then(|u| u.path())
            .map(|p| p.to_string());
        let path = app
            .bundleURL()
            .and_then(|u| u.path())
            .map(|p| p.to_string())
            .or(exe.clone())?;
        let process = app
            .bundleIdentifier()
            .map(|s| s.to_string())
            .or_else(|| {
                exe.as_deref()
                    .and_then(|e| e.rsplit('/').next())
                    .map(str::to_string)
            })
            .unwrap_or_default();
        Some(AppInfo {
            regular: app.activationPolicy() == NSApplicationActivationPolicy::Regular,
            name: app
                .localizedName()
                .map(|s| s.to_string())
                .unwrap_or_default(),
            process,
            path,
        })
    })
}
pub(super) fn pid_of(token: &str) -> Option<i32> {
    token.split(':').next()?.parse().ok()
}
fn front_pid() -> Option<i32> {
    objc2::rc::autoreleasepool(|_| {
        NSWorkspace::sharedWorkspace()
            .frontmostApplication()
            .map(|a| a.processIdentifier())
    })
}
fn own_pid() -> i32 {
    std::process::id() as i32
}
fn usable(w: &sys::CgWindow) -> bool {
    w.layer == 0 && w.alpha > 0.0 && w.width >= 40.0 && w.height >= 40.0
}
/// Visible, ordinary windows of regular applications, front to back.
pub fn list() -> Result<Vec<Window>, String> {
    let mut apps: HashMap<i32, Option<AppInfo>> = HashMap::new();
    let mut titles: HashMap<i32, HashMap<u32, String>> = HashMap::new();
    let ax = sys::trusted();
    let mut out = Vec::new();
    for w in cg_windows(ON_SCREEN | EXCLUDE_DESKTOP, 0) {
        if w.pid == own_pid() || !usable(&w) {
            continue;
        }
        let Some(info) = apps.entry(w.pid).or_insert_with(|| app_info(w.pid)) else {
            continue;
        };
        if !info.regular {
            continue;
        }
        // CG titles of other apps require Screen Recording; AX titles only need
        // the Accessibility permission that window actions already use.
        let title = w
            .name
            .clone()
            .or_else(|| {
                ax.then(|| {
                    titles
                        .entry(w.pid)
                        .or_insert_with(|| {
                            Ax::app(w.pid)
                                .elements("AXWindows")
                                .into_iter()
                                .filter_map(|e| Some((e.window_id()?, e.string("AXTitle")?)))
                                .filter(|(_, t)| !t.is_empty())
                                .collect()
                        })
                        .get(&w.number)
                        .cloned()
                })
                .flatten()
            })
            .unwrap_or_else(|| info.name.clone());
        out.push(Window {
            token: format!("{}:{}", w.pid, w.number),
            title,
            process: info.process.clone(),
            path: info.path.clone(),
        });
    }
    Ok(out)
}
/// `pid:windowNumber` of the front window of the frontmost application;
/// `pid:0` while that application shows no ordinary window.
pub fn current_token() -> String {
    let Some(pid) = front_pid() else {
        return String::new();
    };
    let me = pid == own_pid();
    // Our own foreground window is AppKit's key window (e.g. the just-ordered
    // picker); window server ordering can still list the main window first.
    if me {
        let key = sys::on_main(Duration::from_millis(300), || {
            let mtm = objc2::MainThreadMarker::new().expect("main thread");
            NSApplication::sharedApplication(mtm)
                .keyWindow()
                .map(|w| w.windowNumber())
                .unwrap_or(0)
        });
        if let Some(number) = key.ok().filter(|n| *n > 0) {
            return format!("{pid}:{number}");
        }
    }
    let number = cg_windows(ON_SCREEN | EXCLUDE_DESKTOP, 0)
        .into_iter()
        // Our always-on-top picker is floating (layer 3); the tray item (25) is not a window.
        .find(|w| w.pid == pid && (usable(w) || me && (0..=3).contains(&w.layer) && w.alpha > 0.0))
        .map(|w| w.number)
        .unwrap_or(0);
    format!("{pid}:{number}")
}
pub fn foreground() -> Result<Window, String> {
    let token = current_token();
    list()?
        .into_iter()
        .find(|w| w.token == token)
        .ok_or("当前窗口不可操作".into())
}
fn handle(window: &Window) -> Result<(i32, u32), String> {
    let mut p = window.token.split(':');
    let pid = p
        .next()
        .and_then(|s| s.parse::<i32>().ok())
        .ok_or("窗口标识无效")?;
    let number = p
        .next()
        .and_then(|s| s.parse::<u32>().ok())
        .filter(|n| *n != 0)
        .ok_or("窗口标识无效")?;
    let info = app_info(pid).ok_or("窗口已关闭")?;
    if info.path != window.path {
        return Err("窗口已变化".into());
    }
    // A window of ours that was just shown may not be in the window server list
    // yet; activate_self checks it through AppKit instead.
    if pid == own_pid() {
        return Ok((pid, number));
    }
    if !cg_windows(INCLUDING_WINDOW, number)
        .iter()
        .any(|w| w.number == number && w.pid == pid)
    {
        return Err("窗口已关闭".into());
    }
    Ok((pid, number))
}
fn ax_window(pid: i32, number: u32) -> Result<(Ax, Ax), String> {
    let app = Ax::app(pid);
    let window = app
        .elements("AXWindows")
        .into_iter()
        .find(|e| e.window_id() == Some(number))
        .ok_or("辅助功能无法访问目标窗口")?;
    Ok((app, window))
}
/// Orders one of our windows front as the key window; false if it is gone.
fn key_front(number: u32, activate: bool) -> Result<bool, String> {
    sys::on_main(Duration::from_millis(500), move || {
        let mtm = objc2::MainThreadMarker::new().expect("main thread");
        let app = NSApplication::sharedApplication(mtm);
        let Some(w) = app.windowWithWindowNumber(number as isize) else {
            return false;
        };
        w.makeKeyAndOrderFront(None);
        if activate {
            #[allow(deprecated)]
            app.activateIgnoringOtherApps(true);
        }
        true
    })
}
/// Our windows set aside while the picker is shown, and the app that was front.
static SET_ASIDE: std::sync::Mutex<Option<(Vec<isize>, Option<i32>)>> = std::sync::Mutex::new(None);
/// Before a picker is created: order out every window of this app.
pub fn set_aside() {
    set_aside_except(0);
}
/// Activating this app from the background brings its other windows forward;
/// order them out first so only the requested window appears.
fn set_aside_except(number: u32) {
    let origin = front_pid();
    if origin == Some(own_pid()) {
        return;
    }
    let hidden = sys::on_main(Duration::from_millis(500), move || {
        let mtm = objc2::MainThreadMarker::new().expect("main thread");
        let mut hidden = Vec::new();
        for w in NSApplication::sharedApplication(mtm).windows().iter() {
            if w.windowNumber() != number as isize && w.isVisible() {
                w.orderOut(None);
                hidden.push(w.windowNumber());
            }
        }
        hidden
    })
    .unwrap_or_default();
    if let Ok(mut slot) = SET_ASIDE.lock() {
        let previous = slot.take();
        // Keep the first record if a picker is reopened before restoring.
        *slot = Some(match previous {
            Some((mut old, o)) => {
                old.extend(hidden);
                (old, o)
            }
            None => (hidden, origin),
        });
    }
}
/// Puts set-aside windows back behind other applications' windows, and returns
/// focus to the previous application if the picker closed without switching.
pub fn restore_set_aside() {
    let Some((hidden, origin)) = SET_ASIDE.lock().ok().and_then(|mut s| s.take()) else {
        return;
    };
    let _ = sys::on_main(Duration::from_millis(500), move || {
        let mtm = objc2::MainThreadMarker::new().expect("main thread");
        let app = NSApplication::sharedApplication(mtm);
        for n in hidden {
            if let Some(w) = app.windowWithWindowNumber(n) {
                w.orderWindow_relativeTo(NSWindowOrderingMode::Below, 0);
            }
        }
    });
    if let Some(pid) = origin.filter(|_| front_pid() == Some(own_pid())) {
        if let Some(running) = NSRunningApplication::runningApplicationWithProcessIdentifier(pid) {
            running.activateWithOptions(NSApplicationActivationOptions::empty());
            if sys::trusted() {
                Ax::app(pid).set_bool("AXFrontmost", true);
            }
        }
    }
}
fn activate_self(number: u32) -> Result<(), String> {
    // Never query our own AX tree here: the main thread may be the caller.
    set_aside_except(number);
    key_front(number, true)?.then_some(()).ok_or("窗口已关闭")?;
    // macOS 14+ ignores self-activation that no user input in this app caused
    // (a remote key press). AXFrontmost is not cooperative; only set it off the
    // main thread, which must stay free to answer our own AX request.
    if objc2::MainThreadMarker::new().is_none() && sys::trusted() {
        Ax::app(own_pid()).set_bool("AXFrontmost", true);
    }
    Ok(())
}
pub fn activate(window: &Window) -> Result<(), String> {
    let (pid, number) = handle(window)?;
    let previous = current_token();
    if previous == window.token {
        return Ok(());
    }
    let raise: Box<dyn Fn()> = if pid == own_pid() {
        activate_self(number)?;
        // Activation restores the previously key window (the main window);
        // make the requested window key again.
        Box::new(move || {
            let _ = key_front(number, false);
        })
    } else {
        require_trusted()?;
        let (app, win) = ax_window(pid, number)?;
        if win.bool("AXMinimized") == Some(true) {
            win.set_bool("AXMinimized", false);
        }
        win.set_bool("AXMain", true);
        win.perform("AXRaise");
        let running = NSRunningApplication::runningApplicationWithProcessIdentifier(pid)
            .ok_or("窗口已关闭")?;
        running.activateWithOptions(NSApplicationActivationOptions::empty());
        // AXFrontmost is not subject to the cooperative activation of NSRunningApplication.
        app.set_bool("AXFrontmost", true);
        Box::new(move || {
            win.set_bool("AXMain", true);
            win.perform("AXRaise");
        })
    };
    let deadline = Instant::now() + Duration::from_millis(800);
    let mut last_raise = Instant::now();
    loop {
        let actual = current_token();
        if actual == window.token {
            return Ok(());
        }
        let actual_pid = pid_of(&actual);
        if actual != previous && actual_pid.is_some() && actual_pid != Some(pid) {
            return Err("前台窗口已变化，已取消切换".into());
        }
        if Instant::now() >= deadline {
            return Err("macOS 未允许切换到目标窗口".into());
        }
        if actual_pid == Some(pid) && last_raise.elapsed() > Duration::from_millis(120) {
            // The application is front but another of its windows is on top.
            raise();
            last_raise = Instant::now();
        }
        std::thread::sleep(Duration::from_millis(15));
    }
}
const TEXT_ROLES: [&str; 3] = ["AXTextArea", "AXTextField", "AXComboBox"];
const NAME_ATTRS: [&str; 4] = ["AXDescription", "AXTitle", "AXPlaceholderValue", "AXLabel"];
const ID_ATTRS: [&str; 2] = ["AXIdentifier", "AXDOMIdentifier"];
fn has_focus(app: &Ax, e: &Ax) -> bool {
    if e.bool("AXFocused") == Some(true) {
        return true;
    }
    let mut cur = app.element("AXFocusedUIElement");
    for _ in 0..32 {
        match cur {
            Some(c) if c.same(e) => return true,
            Some(c) => cur = c.element("AXParent"),
            None => return false,
        }
    }
    false
}
pub fn focus(window: &Window, matcher: &Focus) -> Result<(), String> {
    let (pid, number) = handle(window)?;
    let front = || current_token() == window.token;
    if !front() {
        return Err("输入目标已切换，已取消聚焦".into());
    }
    if matcher.terminal {
        return Ok(());
    }
    require_trusted()?;
    let deadline =
        Instant::now() + Duration::from_millis(matcher.wait_ms.unwrap_or(2200).clamp(500, 8000));
    let app = Ax::app(pid);
    // Electron/Chromium build their AX tree only for assistive clients.
    app.set_bool("AXManualAccessibility", true);
    loop {
        if !front() {
            return Err("输入目标已切换，已取消聚焦".into());
        }
        handle(window)?;
        let (_, root) = ax_window(pid, number)?;
        let mut matches = Vec::new();
        let mut queue = std::collections::VecDeque::from([(root, 0u32)]);
        let mut visited = 0;
        while let Some((e, depth)) = queue.pop_front() {
            visited += 1;
            if visited > 8000 {
                break;
            }
            if visited % 64 == 0 && (Instant::now() >= deadline || !front()) {
                return Err("聚焦已过期或输入目标已切换".into());
            }
            let role = e.string("AXRole").unwrap_or_default();
            if TEXT_ROLES.contains(&role.as_str())
                && e.string("AXSubrole").as_deref() != Some("AXSecureTextField")
                && e.bool("AXEnabled") != Some(false)
            {
                let named = NAME_ATTRS
                    .iter()
                    .filter_map(|a| e.string(a))
                    .any(|v| matcher.names.iter().any(|n| n.eq_ignore_ascii_case(&v)));
                let id = ID_ATTRS
                    .iter()
                    .filter_map(|a| e.string(a))
                    .any(|v| matcher.ids.iter().any(|n| !n.is_empty() && *n == v));
                if named || id {
                    matches.push(e);
                    continue;
                }
            }
            if depth < 64 {
                queue.extend(e.elements("AXChildren").into_iter().map(|c| (c, depth + 1)));
            }
        }
        if matches.len() > 1 {
            return Err("找到多个输入框，未自动移动光标".into());
        }
        if let Some(e) = matches.pop() {
            if Instant::now() > deadline || !front() {
                return Err("聚焦已过期或输入目标已切换".into());
            }
            e.set_bool("AXFocused", true);
            loop {
                if !front() {
                    return Err("输入目标已切换，已取消聚焦".into());
                }
                if has_focus(&app, &e) {
                    return Ok(());
                }
                if Instant::now() >= deadline {
                    return Err("应用未确认输入框焦点".into());
                }
                std::thread::sleep(Duration::from_millis(20));
            }
        }
        if Instant::now() >= deadline {
            return Err("未找到该应用的对话输入框".into());
        }
        std::thread::sleep(Duration::from_millis(120));
    }
}
fn mission_control(arg: Option<&str>) -> Result<(), String> {
    let app = "/System/Applications/Mission Control.app";
    if !std::path::Path::new(app).exists() {
        return Err("此命令在 macOS 上不可用".into());
    }
    // System apps are launch-constrained: executing the binary directly is
    // killed (SIGKILL), so go through LaunchServices.
    let mut c = std::process::Command::new("/usr/bin/open");
    c.arg("-a").arg(app);
    if let Some(a) = arg {
        c.arg("--args").arg(a);
    }
    let status = c.status().map_err(|e| e.to_string())?;
    if !status.success() {
        return Err(format!("无法打开调度中心：{status}"));
    }
    Ok(())
}
pub fn command(id: &str) -> Result<(), String> {
    match id {
        "show_desktop" => return mission_control(Some("1")),
        "task_view" => return mission_control(None),
        // Default Mission Control shortcuts ^← / ^→.
        "space_left" => return sys::key(123, sys::CONTROL | sys::ARROW),
        "space_right" => return sys::key(124, sys::CONTROL | sys::ARROW),
        // ⌃⇧⌘4: system area capture to the clipboard.
        "screenshot" => return sys::key(21, sys::CONTROL | sys::SHIFT | sys::COMMAND),
        "toggle_maximize" | "minimize_window" | "close_window" => return window_op(id),
        _ => (),
    }
    let current = foreground()?;
    if matches!(
        id,
        "next_app_window" | "previous_app_window" | "next_global_window" | "previous_global_window"
    ) {
        let app = id.contains("app_window");
        let backward = id.starts_with("previous");
        let mut cycle = CYCLE.lock().map_err(|e| e.to_string())?;
        let fresh = list()?;
        let reusable = cycle.as_ref().is_some_and(|(a, _, last, t)| {
            *a == app && *last == current.token && t.elapsed() < Duration::from_secs(3)
        });
        let mut windows = if reusable {
            cycle.as_ref().unwrap().1.clone()
        } else {
            fresh.clone()
        };
        windows.retain(|v| {
            fresh.iter().any(|f| f.token == v.token) && (!app || v.path == current.path)
        });
        if windows.len() < 2 {
            return Err("没有其他可切换窗口".into());
        }
        let index = windows
            .iter()
            .position(|v| v.token == current.token)
            .unwrap_or(0);
        let next = if backward {
            (index + windows.len() - 1) % windows.len()
        } else {
            (index + 1) % windows.len()
        };
        activate(&windows[next])?;
        let last = windows[next].token.clone();
        *cycle = Some((app, windows, last, Instant::now()));
        return Ok(());
    }
    Err("未知窗口操作".into())
}
/// Acts on the front application's focused window through AX. A full-screen
/// window lives in its own Space, where the window-server number lookup used
/// for switching cannot reach it, so restoring it would otherwise fail.
fn window_op(id: &str) -> Result<(), String> {
    require_trusted()?;
    let pid = front_pid().ok_or("没有前台应用")?;
    if pid == own_pid() {
        return Err("当前窗口不可操作".into());
    }
    let app = Ax::app(pid);
    let win = app
        .element("AXFocusedWindow")
        .or_else(|| app.element("AXMainWindow"))
        .ok_or("当前应用没有可操作的窗口")?;
    let done = match id {
        // macOS equivalent of maximize/restore: the window's full-screen state.
        "toggle_maximize" => {
            let full = win.bool("AXFullScreen").ok_or("此窗口不支持全屏")?;
            win.set_bool("AXFullScreen", !full)
        }
        "minimize_window" => win.set_bool("AXMinimized", true),
        _ => win
            .element("AXCloseButton")
            .ok_or("此窗口没有关闭按钮")?
            .perform("AXPress"),
    };
    if done {
        Ok(())
    } else {
        Err("应用拒绝了窗口操作".into())
    }
}

// Read-only live probe: `cargo test -- --ignored --nocapture macos_live_desktop`.
#[test]
#[ignore]
fn macos_live_desktop() {
    println!("AXIsProcessTrusted={}", sys::trusted());
    let windows = list().unwrap();
    println!("windows={}", windows.len());
    for w in windows.iter().take(12) {
        println!("  {} [{}] {} | {}", w.token, w.process, w.title, w.path);
    }
    println!("current_token={}", current_token());
    match foreground() {
        Ok(w) => println!("foreground={} [{}] {}", w.token, w.process, w.title),
        Err(e) => println!("foreground error: {e}"),
    }
    if let Some(w) = windows.first() {
        let mut stale = w.clone();
        stale.path = "/nonexistent.app".into();
        assert_eq!(activate(&stale).unwrap_err(), "窗口已变化");
    }
    assert!(command("unknown").is_err());
}
// Read-only: prints text-input candidates of one app's front window.
// `BUDDY_AX_PROBE=<bundle id> cargo test -- --ignored --nocapture macos_live_text_inputs`
#[test]
#[ignore]
fn macos_live_text_inputs() {
    let Ok(bundle) = std::env::var("BUDDY_AX_PROBE") else {
        println!("SKIP: set BUDDY_AX_PROBE");
        return;
    };
    let w = list()
        .unwrap()
        .into_iter()
        .find(|w| w.process == bundle)
        .expect("window");
    let (pid, number) = handle(&w).unwrap();
    let (_, root) = ax_window(pid, number).unwrap();
    let mut queue = std::collections::VecDeque::from([(root, 0u32)]);
    let mut visited = 0;
    while let Some((e, depth)) = queue.pop_front() {
        visited += 1;
        if visited > 8000 {
            break;
        }
        let role = e.string("AXRole").unwrap_or_default();
        if TEXT_ROLES.contains(&role.as_str()) {
            let attrs: Vec<String> = NAME_ATTRS
                .iter()
                .chain(ID_ATTRS.iter())
                .filter_map(|a| Some(format!("{a}={:?}", e.string(a)?)))
                .collect();
            println!("  {role} depth={depth} {}", attrs.join(" "));
        }
        if depth < 64 {
            queue.extend(e.elements("AXChildren").into_iter().map(|c| (c, depth + 1)));
        }
    }
    println!("visited={visited}");
}
