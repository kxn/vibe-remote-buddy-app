use serde::{Deserialize, Serialize};
#[derive(Clone, Serialize, Deserialize)]
pub struct Window {
    pub token: String,
    pub title: String,
    pub process: String,
    pub path: String,
}
#[derive(Clone, Deserialize)]
pub struct Focus {
    pub names: Vec<String>,
    pub ids: Vec<String>,
    pub terminal: bool,
    pub wait_ms: Option<u64>,
}

#[cfg(windows)]
mod win {
    use super::*;
    use std::{
        sync::Mutex,
        time::{Duration, Instant},
    };
    use windows::{
        core::{Interface, BOOL},
        Win32::{
            Foundation::*,
            Graphics::Dwm::*,
            System::{Com::*, Threading::*, Variant::VARIANT},
            UI::{Accessibility::*, Input::KeyboardAndMouse::*, WindowsAndMessaging::*},
        },
    };
    static CYCLE: Mutex<Option<(bool, Vec<Window>, String, Instant)>> = Mutex::new(None);
    fn err(e: windows::core::Error) -> String {
        e.to_string()
    }
    unsafe fn path(w: HWND) -> Option<(u32, String)> {
        let mut pid = 0;
        GetWindowThreadProcessId(w, Some(&mut pid));
        let p = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
        let mut buf = vec![0u16; 32768];
        let mut len = buf.len() as u32;
        let result = QueryFullProcessImageNameW(
            p,
            PROCESS_NAME_WIN32,
            windows::core::PWSTR(buf.as_mut_ptr()),
            &mut len,
        );
        let _ = CloseHandle(p);
        result.ok()?;
        Some((pid, String::from_utf16_lossy(&buf[..len as usize])))
    }
    unsafe extern "system" fn visit(w: HWND, l: LPARAM) -> BOOL {
        if !IsWindowVisible(w).as_bool()
            || GetWindowLongPtrW(w, GWL_EXSTYLE) & WS_EX_TOOLWINDOW.0 as isize != 0
        {
            return true.into();
        }
        let mut cloaked = 0u32;
        let _ = DwmGetWindowAttribute(w, DWMWA_CLOAKED, &mut cloaked as *mut _ as _, 4);
        if cloaked != 0 {
            return true.into();
        }
        let mut buf = [0u16; 2048];
        let n = GetWindowTextW(w, &mut buf);
        if n == 0 {
            return true.into();
        }
        if let Some((pid, p)) = path(w) {
            if pid == std::process::id() {
                return true.into();
            }
            let title = String::from_utf16_lossy(&buf[..n as usize]);
            if title == "Program Manager" {
                return true.into();
            }
            let process = std::path::Path::new(&p)
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .into_owned();
            (&mut *(l.0 as *mut Vec<Window>)).push(Window {
                token: format!("{}:{}", w.0 as usize, pid),
                title,
                process,
                path: p,
            });
        }
        true.into()
    }
    pub fn list() -> Result<Vec<Window>, String> {
        let mut out = Vec::new();
        unsafe {
            EnumWindows(Some(visit), LPARAM(&mut out as *mut _ as isize)).map_err(err)?;
        }
        Ok(out)
    }
    fn handle(window: &Window) -> Result<HWND, String> {
        let mut p = window.token.split(':');
        let h = p
            .next()
            .and_then(|s| s.parse::<usize>().ok())
            .ok_or("窗口标识无效")?;
        let pid = p
            .next()
            .and_then(|s| s.parse::<u32>().ok())
            .ok_or("窗口标识无效")?;
        let w = HWND(h as _);
        let actual = unsafe { path(w) }.ok_or("窗口已关闭")?;
        if actual.0 != pid
            || !actual.1.eq_ignore_ascii_case(&window.path)
            || !unsafe { IsWindow(Some(w)) }.as_bool()
        {
            return Err("窗口已变化".into());
        }
        Ok(w)
    }
    pub fn current_token() -> String {
        unsafe {
            let w = GetForegroundWindow();
            let mut pid = 0;
            GetWindowThreadProcessId(w, Some(&mut pid));
            format!("{}:{}", w.0 as usize, pid)
        }
    }
    pub fn foreground() -> Result<Window, String> {
        let h = unsafe { GetForegroundWindow() };
        list()?
            .into_iter()
            .find(|w| w.token.starts_with(&format!("{}:", h.0 as usize)))
            .ok_or("当前窗口不可操作".into())
    }
    pub fn activate(window: &Window) -> Result<(), String> {
        let w = handle(window)?;
        unsafe {
            let previous = GetForegroundWindow();
            if previous == w {
                return Ok(());
            }
            if IsIconic(w).as_bool() {
                let _ = ShowWindow(w, SW_RESTORE);
            }
            let wait = |ms: u64| -> Result<bool, String> {
                let deadline = Instant::now() + Duration::from_millis(ms);
                loop {
                    let actual = GetForegroundWindow();
                    if actual == w {
                        return Ok(true);
                    }
                    if !actual.0.is_null() && actual != previous {
                        return Err("前台窗口已变化，已取消切换".into());
                    }
                    if Instant::now() >= deadline {
                        return Ok(false);
                    }
                    std::thread::sleep(Duration::from_millis(10));
                }
            };
            let _ = SetForegroundWindow(w);
            if wait(100)? {
                return Ok(());
            }
            // Alt unlocks foreground activation. Submit both edges together, never
            // hold it across IPC/UIA, and refuse while any physical modifier is held.
            combo(&[0xa4])?;
            std::thread::sleep(Duration::from_millis(40));
            let actual = GetForegroundWindow();
            if !actual.0.is_null() && actual != previous && actual != w {
                return Err("前台窗口已变化，已取消切换".into());
            }
            let _ = SetForegroundWindow(w);
            if !wait(400)? {
                return Err("Windows 未允许切换到目标窗口".into());
            }
        }
        Ok(())
    }
    pub fn focus(window: &Window, matcher: &Focus) -> Result<(), String> {
        let w = handle(window)?;
        if unsafe { GetForegroundWindow() } != w {
            return Err("输入目标已切换，已取消聚焦".into());
        }
        if matcher.terminal {
            return Ok(());
        }
        unsafe {
            CoInitializeEx(None, COINIT_MULTITHREADED)
                .ok()
                .map_err(err)?;
        }
        struct Com;
        impl Drop for Com {
            fn drop(&mut self) {
                unsafe { CoUninitialize() }
            }
        }
        let _com = Com;
        unsafe {
            let uia: IUIAutomation =
                CoCreateInstance(&CUIAutomation8, None, CLSCTX_INPROC_SERVER).map_err(err)?;
            let uia2: IUIAutomation2 = uia.cast().map_err(err)?;
            uia2.SetConnectionTimeout(500).map_err(err)?;
            uia2.SetTransactionTimeout(700).map_err(err)?;
            let cond = uia
                .CreatePropertyCondition(
                    UIA_ControlTypePropertyId,
                    &VARIANT::from(UIA_EditControlTypeId.0),
                )
                .map_err(err)?;
            let deadline = Instant::now()
                + Duration::from_millis(matcher.wait_ms.unwrap_or(2200).clamp(500, 8000));
            loop {
                if GetForegroundWindow() != w {
                    return Err("输入目标已切换，已取消聚焦".into());
                }
                handle(window)?;
                let root = uia.ElementFromHandle(w).map_err(err)?;
                let edits = root.FindAll(TreeScope_Descendants, &cond).map_err(err)?;
                let mut matches = Vec::new();
                for i in 0..edits.Length().map_err(err)?.min(256) {
                    if Instant::now() >= deadline || GetForegroundWindow() != w {
                        return Err("聚焦已过期或输入目标已切换".into());
                    }
                    let e = edits.GetElement(i).map_err(err)?;
                    if !e.CurrentIsEnabled().map_err(err)?.as_bool()
                        || !e.CurrentIsKeyboardFocusable().map_err(err)?.as_bool()
                        || e.CurrentIsPassword().map_err(err)?.as_bool()
                        || e.CurrentIsOffscreen().map_err(err)?.as_bool()
                    {
                        continue;
                    }
                    let name = e.CurrentName().map_err(err)?.to_string();
                    let id = e.CurrentAutomationId().map_err(err)?.to_string();
                    if matcher.names.iter().any(|s| s.eq_ignore_ascii_case(&name))
                        || matcher.ids.iter().any(|s| !s.is_empty() && s == &id)
                    {
                        matches.push(e)
                    }
                }
                if matches.len() > 1 {
                    return Err("找到多个输入框，未自动移动光标".into());
                }
                if let Some(e) = matches.pop() {
                    if Instant::now() > deadline || GetForegroundWindow() != w {
                        return Err("聚焦已过期或输入目标已切换".into());
                    }
                    e.SetFocus().map_err(err)?;
                    loop {
                        if GetForegroundWindow() != w {
                            return Err("输入目标已切换，已取消聚焦".into());
                        }
                        if e.CurrentHasKeyboardFocus().map_err(err)?.as_bool() {
                            return Ok(());
                        }
                        if Instant::now() >= deadline {
                            return Err("应用未确认输入框焦点".into());
                        }
                        std::thread::sleep(Duration::from_millis(20));
                    }
                }
                if Instant::now() >= deadline {
                    return Err("未找到该应用的对话输入框；窗口已切换".into());
                }
                std::thread::sleep(Duration::from_millis(120));
            }
        }
    }
    fn combo(keys: &[u16]) -> Result<(), String> {
        unsafe {
            for k in [0x10, 0x11, 0x12, 0x5b, 0x5c] {
                if GetAsyncKeyState(k) < 0 {
                    return Err("修饰键仍按住，已取消快捷操作".into());
                }
            }
            let make = |k: u16, up: bool| INPUT {
                r#type: INPUT_KEYBOARD,
                Anonymous: INPUT_0 {
                    ki: KEYBDINPUT {
                        wVk: VIRTUAL_KEY(k),
                        dwFlags: if up {
                            KEYEVENTF_KEYUP
                        } else {
                            KEYBD_EVENT_FLAGS(0)
                        },
                        ..Default::default()
                    },
                },
            };
            let mut events: Vec<_> = keys.iter().map(|k| make(*k, false)).collect();
            events.extend(keys.iter().rev().map(|k| make(*k, true)));
            let n = SendInput(&events, std::mem::size_of::<INPUT>() as i32) as usize;
            if n != events.len() {
                let release: Vec<_> = keys.iter().rev().map(|k| make(*k, true)).collect();
                SendInput(&release, std::mem::size_of::<INPUT>() as i32);
                return Err("Windows 未完整接收快捷操作".into());
            }
            Ok(())
        }
    }
    pub fn command(id: &str) -> Result<(), String> {
        match id {
            "show_desktop" => return combo(&[0x5b, 0x44]),
            "task_view" => return combo(&[0x5b, 0x09]),
            "space_left" => return combo(&[0x5b, 0x11, 0x25]),
            "space_right" => return combo(&[0x5b, 0x11, 0x27]),
            "screenshot" => return combo(&[0x5b, 0x10, 0x53]),
            _ => (),
        }
        let current = foreground()?;
        let w = handle(&current)?;
        if matches!(
            id,
            "next_app_window"
                | "previous_app_window"
                | "next_global_window"
                | "previous_global_window"
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
                fresh.iter().any(|f| f.token == v.token)
                    && (!app || v.path.eq_ignore_ascii_case(&current.path))
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
        let code = match id {
            "toggle_maximize" => {
                if unsafe { IsZoomed(w) }.as_bool() {
                    SC_RESTORE
                } else {
                    SC_MAXIMIZE
                }
            }
            "minimize_window" => SC_MINIMIZE,
            "close_window" => SC_CLOSE,
            _ => return Err("未知窗口操作".into()),
        };
        unsafe {
            PostMessageW(Some(w), WM_SYSCOMMAND, WPARAM(code as usize), LPARAM(0)).map_err(err)
        }
    }
}
#[cfg(windows)]
pub use win::*;
#[cfg(not(windows))]
pub fn list() -> Result<Vec<Window>, String> {
    Err("此平台的窗口操作尚未适配".into())
}
#[cfg(not(windows))]
pub fn foreground() -> Result<Window, String> {
    Err("此平台的窗口操作尚未适配".into())
}
#[cfg(not(windows))]
pub fn activate(_: &Window) -> Result<(), String> {
    Err("此平台的窗口操作尚未适配".into())
}
#[cfg(not(windows))]
pub fn focus(_: &Window, _: &Focus) -> Result<(), String> {
    Err("此平台的输入框聚焦尚未适配".into())
}
#[cfg(not(windows))]
pub fn command(_: &str) -> Result<(), String> {
    Err("此平台的窗口操作尚未适配".into())
}

#[cfg(not(windows))]
pub fn current_token() -> String {
    String::new()
}
