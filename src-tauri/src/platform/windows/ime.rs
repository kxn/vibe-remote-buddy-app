use crate::platform::desktop::Window;
use std::time::{Duration, Instant};
use windows::{
    core::Interface,
    Win32::{
        Foundation::*,
        System::Com::*,
        UI::{
            Input::{Ime::*, KeyboardAndMouse::HKL},
            TextServices::*,
            WindowsAndMessaging::*,
        },
    },
};
fn guard(window: &Window) -> Result<HWND, String> {
    let current = crate::platform::desktop::foreground()?;
    if current.token != window.token || !current.path.eq_ignore_ascii_case(&window.path) {
        return Err("前台窗口已变化，已取消输入法切换".into());
    }
    Ok(unsafe { GetForegroundWindow() })
}
unsafe fn ime_window(window: &Window) -> Result<HWND, String> {
    let hwnd = guard(window)?;
    let tid = GetWindowThreadProcessId(hwnd, None);
    let mut info = GUITHREADINFO {
        cbSize: std::mem::size_of::<GUITHREADINFO>() as u32,
        ..Default::default()
    };
    GetGUIThreadInfo(tid, &mut info).map_err(|e| format!("读取输入焦点失败：{e}"))?;
    let focus = if info.hwndFocus.is_invalid() {
        hwnd
    } else {
        info.hwndFocus
    };
    let ime = ImmGetDefaultIMEWnd(focus);
    if ime.is_invalid() {
        return Err("当前输入框没有可用的输入法窗口".into());
    }
    Ok(ime)
}
unsafe fn control(window: &Window, command: usize, value: isize) -> Result<usize, String> {
    let ime = ime_window(window)?;
    let mut result = 0;
    let sent = SendMessageTimeoutW(
        ime,
        WM_IME_CONTROL,
        WPARAM(command),
        LPARAM(value),
        SMTO_ABORTIFHUNG | SMTO_BLOCK,
        250,
        Some(&mut result),
    );
    if sent.0 == 0 {
        return Err(format!(
            "输入法未响应中文状态请求（IMC={command}）：{}",
            windows::core::Error::from_win32()
        ));
    }
    Ok(result)
}
pub fn switch(window: &Window, input_method: &str) -> Result<(), String> {
    let names: &[&str] = match input_method {
        "doubao" => &["豆包输入法", "Doubao Input Method", "Doubao IME"],
        "wechat" => &[
            "微信输入法",
            "微信键盘",
            "WeChat Input",
            "WeChat Input Method",
            "WeType",
        ],
        _ => return Err("未知的输入法预设".into()),
    };
    let selected = profiles()?
        .into_iter()
        .find(|(name, p)| {
            p.catid == GUID_TFCAT_TIP_KEYBOARD
                && p.dwFlags & TF_IPP_FLAG_ENABLED != 0
                && names.iter().any(|n| name.eq_ignore_ascii_case(n))
        })
        .ok_or_else(|| format!("未找到已启用的{}", names[0]))?
        .1;
    guard(window)?;
    unsafe {
        CoInitializeEx(None, COINIT_APARTMENTTHREADED)
            .ok()
            .map_err(|e| e.to_string())?;
        struct Com;
        impl Drop for Com {
            fn drop(&mut self) {
                unsafe { CoUninitialize() }
            }
        }
        let _com = Com;
        let profiles: ITfInputProcessorProfiles =
            CoCreateInstance(&CLSID_TF_InputProcessorProfiles, None, CLSCTX_INPROC_SERVER)
                .map_err(|e| e.to_string())?;
        let mgr: ITfInputProcessorProfileMgr = profiles.cast().map_err(|e| e.to_string())?;
        guard(window)?;
        profiles
            .ChangeCurrentLanguage(selected.langid)
            .map_err(|e| format!("切换输入语言失败：{e}"))?;
        guard(window)?;
        // User-approved desktop scope. Never change installed/enabled/default profiles.
        mgr.ActivateProfile(
            selected.dwProfileType,
            selected.langid,
            &selected.clsid,
            &selected.guidProfile,
            HKL::default(),
            TF_IPPMF_FORSESSION,
        )
        .map_err(|e| format!("切换输入法失败：{e}"))?;
        let mut active = TF_INPUTPROCESSORPROFILE::default();
        mgr.GetActiveProfile(&GUID_TFCAT_TIP_KEYBOARD, &mut active)
            .map_err(|e| e.to_string())?;
        if active.clsid != selected.clsid || active.guidProfile != selected.guidProfile {
            return Err("输入法切换尚未得到确认".into());
        }
        // Modern input methods may apply desktop activation asynchronously.
        let deadline = Instant::now() + Duration::from_millis(1200);
        loop {
            guard(window)?;
            let mode = control(window, 1, 0)?; // IMC_GETCONVERSIONMODE
            control(window, 6, 1)?; // IMC_SETOPENSTATUS
            control(window, 2, (mode | IME_CMODE_NATIVE.0 as usize) as isize)?;
            if control(window, 5, 0)? != 0
                && control(window, 1, 0)? & IME_CMODE_NATIVE.0 as usize != 0
            {
                return Ok(());
            }
            if Instant::now() >= deadline {
                return Err("输入法已切换，但未能确认中文打开状态".into());
            }
            std::thread::sleep(Duration::from_millis(50));
        }
    }
}
pub fn profiles() -> Result<Vec<(String, TF_INPUTPROCESSORPROFILE)>, String> {
    unsafe {
        CoInitializeEx(None, COINIT_APARTMENTTHREADED)
            .ok()
            .map_err(|e| e.to_string())?;
        struct Com;
        impl Drop for Com {
            fn drop(&mut self) {
                unsafe { CoUninitialize() }
            }
        }
        let _com = Com;
        let profiles: ITfInputProcessorProfiles =
            CoCreateInstance(&CLSID_TF_InputProcessorProfiles, None, CLSCTX_INPROC_SERVER)
                .map_err(|e| e.to_string())?;
        let mgr: ITfInputProcessorProfileMgr = profiles.cast().map_err(|e| e.to_string())?;
        let list = mgr.EnumProfiles(0x0804).map_err(|e| e.to_string())?;
        let mut result = Vec::new();
        loop {
            let mut items = [TF_INPUTPROCESSORPROFILE::default()];
            let mut fetched = 0;
            list.Next(&mut items, &mut fetched)
                .map_err(|e| e.to_string())?;
            if fetched == 0 {
                break;
            }
            let p = items[0];
            if p.dwProfileType != TF_PROFILETYPE_INPUTPROCESSOR {
                continue;
            }
            let name = profiles
                .GetLanguageProfileDescription(&p.clsid, p.langid, &p.guidProfile)
                .map_err(|e| e.to_string())?
                .to_string();
            result.push((name, p));
        }
        Ok(result)
    }
}
// Explicit live test: requires ZCode, Weasel and Doubao; changes desktop IME.
#[test]
#[ignore]
fn live_switch_from_weasel() {
    assert_eq!(std::env::var("BUDDY_IME_LIVE_TEST").as_deref(), Ok("1"));
    let target = crate::platform::desktop::list()
        .unwrap()
        .into_iter()
        .find(|w| w.process.eq_ignore_ascii_case("zcode.exe"))
        .unwrap();
    crate::platform::desktop::activate(&target).unwrap();
    crate::platform::desktop::focus(
        &target,
        &crate::platform::desktop::Focus {
            names: vec![
                "提出后续修改要求".into(),
                "输入消息".into(),
                "Ask a follow-up".into(),
            ],
            ids: vec![],
            terminal: false,
            wait_ms: Some(2200),
        },
    )
    .unwrap();
    let other = profiles()
        .unwrap()
        .into_iter()
        .find(|(n, p)| n == "小狼毫" && p.dwFlags & TF_IPP_FLAG_ENABLED != 0)
        .unwrap()
        .1;
    unsafe {
        CoInitializeEx(None, COINIT_APARTMENTTHREADED).ok().unwrap();
        let profiles: ITfInputProcessorProfiles =
            CoCreateInstance(&CLSID_TF_InputProcessorProfiles, None, CLSCTX_INPROC_SERVER).unwrap();
        let mgr: ITfInputProcessorProfileMgr = profiles.cast().unwrap();
        guard(&target).unwrap();
        profiles.ChangeCurrentLanguage(other.langid).unwrap();
        mgr.ActivateProfile(
            other.dwProfileType,
            other.langid,
            &other.clsid,
            &other.guidProfile,
            HKL::default(),
            TF_IPPMF_FORSESSION,
        )
        .unwrap();
        let mut active = TF_INPUTPROCESSORPROFILE::default();
        mgr.GetActiveProfile(&GUID_TFCAT_TIP_KEYBOARD, &mut active)
            .unwrap();
        assert_eq!(active.clsid, other.clsid);
        drop(mgr);
        drop(profiles);
        CoUninitialize();
        control(&target, 6, 0).unwrap();
        assert_eq!(control(&target, 5, 0).unwrap(), 0);
    }
    switch(&target, "doubao").unwrap();
    unsafe {
        assert_ne!(control(&target, 5, 0).unwrap(), 0);
        assert_ne!(
            control(&target, 1, 0).unwrap() & IME_CMODE_NATIVE.0 as usize,
            0
        );
    }
    assert!(switch(&target, "wechat").unwrap_err().contains("未找到"));
    let mut stale = target.clone();
    stale.token = "0:0".into();
    assert!(switch(&stale, "doubao")
        .unwrap_err()
        .contains("前台窗口已变化"));
    println!(
        "PASS: Weasel -> Doubao; Chinese enabled; missing WeChat and stale foreground rejected"
    );
}
#[test]
#[ignore]
fn installed_profiles() {
    for (name, p) in profiles().unwrap() {
        println!(
            "{} substitute={:x} hkl={:x} flags={:x}",
            name, p.hklSubstitute.0 as usize, p.hkl.0 as usize, p.dwFlags
        );
    }
}
