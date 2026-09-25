use crate::platform::desktop::{current_token, Window};
use core_foundation::{
    array::{CFArray, CFArrayRef},
    base::{CFType, CFTypeRef, TCFType},
    boolean::CFBoolean,
    dictionary::{CFDictionary, CFDictionaryRef},
    string::{CFString, CFStringRef},
};
use std::{
    ffi::c_void,
    time::{Duration, Instant},
};
type Source = *const c_void;
#[link(name = "Carbon", kind = "framework")]
extern "C" {
    fn TISCreateInputSourceList(properties: CFDictionaryRef, all_installed: u8) -> CFArrayRef;
    fn TISGetInputSourceProperty(source: Source, key: CFStringRef) -> CFTypeRef;
    fn TISSelectInputSource(source: Source) -> i32;
    fn TISCopyCurrentKeyboardInputSource() -> Source;
    static kTISPropertyInputSourceID: CFStringRef;
    static kTISPropertyLocalizedName: CFStringRef;
    static kTISPropertyBundleID: CFStringRef;
    static kTISPropertyInputSourceCategory: CFStringRef;
    static kTISCategoryKeyboardInputSource: CFStringRef;
    static kTISPropertyInputSourceIsSelectCapable: CFStringRef;
}
#[derive(Clone, Debug)]
pub struct InputSource {
    pub id: String,
    pub name: String,
    pub bundle: String,
    pub selectable: bool,
}
fn text(source: Source, key: CFStringRef) -> String {
    let v = unsafe { TISGetInputSourceProperty(source, key) };
    if v.is_null() {
        return String::new();
    }
    unsafe { CFType::wrap_under_get_rule(v) }
        .downcast::<CFString>()
        .map(|s| s.to_string())
        .unwrap_or_default()
}
fn describe(source: Source) -> InputSource {
    unsafe {
        let selectable = TISGetInputSourceProperty(source, kTISPropertyInputSourceIsSelectCapable);
        InputSource {
            id: text(source, kTISPropertyInputSourceID),
            name: text(source, kTISPropertyLocalizedName),
            bundle: text(source, kTISPropertyBundleID),
            selectable: !selectable.is_null()
                && CFType::wrap_under_get_rule(selectable)
                    .downcast::<CFBoolean>()
                    .is_some_and(bool::from),
        }
    }
}
/// Enabled keyboard input sources with their TIS handles. Main thread only.
fn enabled() -> Vec<(InputSource, CFType)> {
    unsafe {
        let key = CFString::wrap_under_get_rule(kTISPropertyInputSourceCategory);
        let value = CFString::wrap_under_get_rule(kTISCategoryKeyboardInputSource);
        let filter = CFDictionary::from_CFType_pairs(&[(key, value)]);
        let raw = TISCreateInputSourceList(filter.as_concrete_TypeRef(), 0);
        if raw.is_null() {
            return vec![];
        }
        let list: CFArray<CFType> = CFArray::wrap_under_create_rule(raw);
        list.iter()
            .map(|s| (describe(s.as_CFTypeRef()), s.clone()))
            .collect()
    }
}
fn current_id() -> String {
    unsafe {
        let s = TISCopyCurrentKeyboardInputSource();
        if s.is_null() {
            return String::new();
        }
        let owned = CFType::wrap_under_create_rule(s);
        text(owned.as_CFTypeRef(), kTISPropertyInputSourceID)
    }
}
/// Selectable sources of a named input method: the source itself, or the
/// modes of an input method whose container carries the name.
fn candidates<'a>(
    all: &'a [(InputSource, CFType)],
    names: &[&str],
) -> Vec<&'a (InputSource, CFType)> {
    let named = |s: &InputSource| names.iter().any(|n| s.name.eq_ignore_ascii_case(n));
    let bundles: Vec<&str> = all
        .iter()
        .filter(|(s, _)| named(s) && !s.bundle.is_empty())
        .map(|(s, _)| s.bundle.as_str())
        .collect();
    all.iter()
        .filter(|(s, _)| s.selectable && (named(s) || bundles.contains(&s.bundle.as_str())))
        .collect()
}
fn guard(window: &Window) -> Result<(), String> {
    if current_token() != window.token {
        return Err("前台窗口已变化，已取消输入法切换".into());
    }
    Ok(())
}
pub fn switch(window: &Window, input_method: &str) -> Result<(), String> {
    let names: &'static [&'static str] = match input_method {
        "doubao" => &[
            "豆包输入法",
            "Doubao Input Method",
            "Doubao IME",
            "DoubaoIme",
        ],
        "wechat" => &[
            "微信输入法",
            "微信键盘",
            "WeChat Input",
            "WeChat Input Method",
            "WeType",
        ],
        _ => return Err("未知的输入法预设".into()),
    };
    guard(window)?;
    let w = window.clone();
    // TIS must run on the main thread on current macOS releases.
    let target = super::sys::on_main(Duration::from_millis(1500), move || {
        let all = enabled();
        let found = candidates(&all, names);
        let current = current_id();
        if found.iter().any(|(s, _)| s.id == current) {
            return Ok(None);
        }
        let (source, handle) = found
            .first()
            .ok_or_else(|| format!("未找到已启用的{}", names[0]))?;
        guard(&w)?;
        let status = unsafe { TISSelectInputSource(handle.as_CFTypeRef()) };
        if status != 0 {
            return Err(format!("切换输入法失败：OSStatus {status}"));
        }
        Ok(Some(source.id.clone()))
    })??;
    let Some(target) = target else {
        return Ok(());
    };
    let deadline = Instant::now() + Duration::from_millis(800);
    loop {
        if super::sys::on_main(Duration::from_millis(500), current_id)? == target {
            return Ok(());
        }
        if Instant::now() >= deadline {
            return Err("输入法切换尚未得到确认".into());
        }
        std::thread::sleep(Duration::from_millis(50));
    }
}

// Read-only: lists enabled sources, never selects one.
#[test]
#[ignore]
fn macos_live_input_sources() {
    let main = objc2::MainThreadMarker::new().is_some();
    println!("on_main_thread={main}");
    // libtest never runs tests on the main thread; reading TIS off the main
    // thread is only for this explicit probe and may be refused by macOS.
    if !main && std::env::var("BUDDY_TIS_PROBE").as_deref() != Ok("1") {
        println!("SKIP: set BUDDY_TIS_PROBE=1 to read TIS off the main thread");
        return;
    }
    println!("current={}", current_id());
    for (s, _) in enabled() {
        println!(
            "  {} | {} | bundle={} | selectable={}",
            s.id, s.name, s.bundle, s.selectable
        );
    }
    let all = enabled();
    for (preset, names) in [
        (
            "doubao",
            &[
                "豆包输入法",
                "Doubao Input Method",
                "Doubao IME",
                "DoubaoIme",
            ][..],
        ),
        (
            "wechat",
            &[
                "微信输入法",
                "微信键盘",
                "WeChat Input",
                "WeChat Input Method",
                "WeType",
            ][..],
        ),
    ] {
        let ids: Vec<_> = candidates(&all, names)
            .iter()
            .map(|(s, _)| s.id.clone())
            .collect();
        println!("{preset} candidates={ids:?}");
    }
}
