//! Minimal CoreGraphics / Accessibility / libdispatch bindings and helpers.
use core_foundation::{
    array::{CFArray, CFArrayRef},
    base::{CFEqual, CFGetTypeID, CFType, CFTypeRef, TCFType},
    boolean::CFBoolean,
    dictionary::{CFDictionary, CFDictionaryRef},
    number::CFNumber,
    string::{CFString, CFStringRef},
};
use std::{
    ffi::c_void,
    sync::{
        atomic::{AtomicU8, Ordering},
        mpsc, Arc,
    },
    time::Duration,
};

type AXUIElementRef = *const c_void;
const AX_SUCCESS: i32 = 0;

#[link(name = "ApplicationServices", kind = "framework")]
extern "C" {
    fn AXIsProcessTrusted() -> u8;
    fn AXIsProcessTrustedWithOptions(options: CFDictionaryRef) -> u8;
    static kAXTrustedCheckOptionPrompt: CFStringRef;
    fn AXUIElementGetTypeID() -> usize;
    fn AXUIElementCreateApplication(pid: i32) -> AXUIElementRef;
    fn AXUIElementCopyAttributeValue(e: AXUIElementRef, a: CFStringRef, v: *mut CFTypeRef) -> i32;
    fn AXUIElementSetAttributeValue(e: AXUIElementRef, a: CFStringRef, v: CFTypeRef) -> i32;
    fn AXUIElementPerformAction(e: AXUIElementRef, a: CFStringRef) -> i32;
    fn AXUIElementSetMessagingTimeout(e: AXUIElementRef, seconds: f32) -> i32;
    // Private but long-stable mapping from an AX window to its CGWindowID.
    fn _AXUIElementGetWindow(e: AXUIElementRef, id: *mut u32) -> i32;
}
#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CGWindowListCopyWindowInfo(option: u32, relative: u32) -> CFArrayRef;
    fn CGEventSourceFlagsState(state: i32) -> u64;
    fn CGEventCreateKeyboardEvent(source: *const c_void, key: u16, down: bool) -> *mut c_void;
    fn CGEventSetFlags(event: *mut c_void, flags: u64);
    fn CGEventSetType(event: *mut c_void, kind: u32);
    fn CGEventPost(tap: u32, event: *mut c_void);
}
extern "C" {
    static _dispatch_main_q: u8;
    fn dispatch_async_f(queue: *const c_void, ctx: *mut c_void, work: extern "C" fn(*mut c_void));
}

pub const AX_PERMISSION: &str =
    "需要在 系统设置 › 隐私与安全性 › 辅助功能 中允许 Vibe Remote Buddy";
static PROMPTED: std::sync::Once = std::sync::Once::new();
/// Fails with a recognisable error; asks macOS to show the permission prompt once per run.
pub fn require_trusted() -> Result<(), String> {
    if unsafe { AXIsProcessTrusted() } != 0 {
        return Ok(());
    }
    PROMPTED.call_once(|| unsafe {
        let key = CFString::wrap_under_get_rule(kAXTrustedCheckOptionPrompt);
        let options = CFDictionary::from_CFType_pairs(&[(key, CFBoolean::true_value())]);
        AXIsProcessTrustedWithOptions(options.as_concrete_TypeRef());
    });
    Err(AX_PERMISSION.into())
}
pub fn trusted() -> bool {
    unsafe { AXIsProcessTrusted() != 0 }
}

pub struct Ax(CFType);
impl Ax {
    pub fn app(pid: i32) -> Ax {
        let e = Ax(unsafe { CFType::wrap_under_create_rule(AXUIElementCreateApplication(pid)) });
        unsafe { AXUIElementSetMessagingTimeout(e.raw(), 0.5) };
        e
    }
    fn raw(&self) -> AXUIElementRef {
        self.0.as_CFTypeRef()
    }
    pub fn attr(&self, name: &str) -> Option<CFType> {
        let key = CFString::new(name);
        let mut value: CFTypeRef = std::ptr::null();
        let r = unsafe {
            AXUIElementCopyAttributeValue(self.raw(), key.as_concrete_TypeRef(), &mut value)
        };
        (r == AX_SUCCESS && !value.is_null())
            .then(|| unsafe { CFType::wrap_under_create_rule(value) })
    }
    pub fn string(&self, name: &str) -> Option<String> {
        self.attr(name)?
            .downcast::<CFString>()
            .map(|s| s.to_string())
    }
    pub fn bool(&self, name: &str) -> Option<bool> {
        self.attr(name)?.downcast::<CFBoolean>().map(bool::from)
    }
    pub fn element(&self, name: &str) -> Option<Ax> {
        let v = self.attr(name)?;
        (unsafe { CFGetTypeID(v.as_CFTypeRef()) } == unsafe { AXUIElementGetTypeID() })
            .then_some(Ax(v))
    }
    pub fn elements(&self, name: &str) -> Vec<Ax> {
        let Some(v) = self.attr(name).and_then(|v| v.downcast::<CFArray>()) else {
            return vec![];
        };
        let id = unsafe { AXUIElementGetTypeID() };
        v.iter()
            .filter(|e| !e.is_null() && unsafe { CFGetTypeID(**e) } == id)
            .map(|e| Ax(unsafe { CFType::wrap_under_get_rule(*e) }))
            .collect()
    }
    pub fn set_bool(&self, name: &str, value: bool) -> bool {
        let key = CFString::new(name);
        let v = if value {
            CFBoolean::true_value()
        } else {
            CFBoolean::false_value()
        };
        unsafe {
            AXUIElementSetAttributeValue(self.raw(), key.as_concrete_TypeRef(), v.as_CFTypeRef())
                == AX_SUCCESS
        }
    }
    pub fn perform(&self, action: &str) -> bool {
        let key = CFString::new(action);
        unsafe { AXUIElementPerformAction(self.raw(), key.as_concrete_TypeRef()) == AX_SUCCESS }
    }
    pub fn window_id(&self) -> Option<u32> {
        let mut id = 0;
        (unsafe { _AXUIElementGetWindow(self.raw(), &mut id) } == AX_SUCCESS && id != 0)
            .then_some(id)
    }
    pub fn same(&self, other: &Ax) -> bool {
        unsafe { CFEqual(self.raw(), other.raw()) != 0 }
    }
}

pub struct CgWindow {
    pub number: u32,
    pub pid: i32,
    pub layer: i64,
    pub name: Option<String>,
    pub alpha: f64,
    pub width: f64,
    pub height: f64,
}
pub const ON_SCREEN: u32 = 1 << 0;
pub const INCLUDING_WINDOW: u32 = 1 << 3;
pub const EXCLUDE_DESKTOP: u32 = 1 << 4;
/// Front-to-back window records. Titles need Screen Recording permission for
/// other applications and are then absent rather than an error.
pub fn cg_windows(option: u32, relative: u32) -> Vec<CgWindow> {
    let raw = unsafe { CGWindowListCopyWindowInfo(option, relative) };
    if raw.is_null() {
        return vec![];
    }
    let list: CFArray<CFDictionary<CFString, CFType>> =
        unsafe { CFArray::wrap_under_create_rule(raw) };
    let num = |d: &CFDictionary<CFString, CFType>, k: &str| {
        d.find(CFString::new(k))
            .and_then(|v| v.downcast::<CFNumber>())
            .and_then(|n| n.to_f64())
    };
    list.iter()
        .filter_map(|d| {
            let bounds = d
                .find(CFString::new("kCGWindowBounds"))
                .and_then(|v| v.downcast::<CFDictionary>())
                .map(|b| unsafe {
                    CFDictionary::<CFString, CFType>::wrap_under_get_rule(b.as_concrete_TypeRef())
                });
            Some(CgWindow {
                number: num(&d, "kCGWindowNumber")? as u32,
                pid: num(&d, "kCGWindowOwnerPID")? as i32,
                layer: num(&d, "kCGWindowLayer").unwrap_or(0.0) as i64,
                name: d
                    .find(CFString::new("kCGWindowName"))
                    .and_then(|v| v.downcast::<CFString>())
                    .map(|s| s.to_string())
                    .filter(|s| !s.is_empty()),
                alpha: num(&d, "kCGWindowAlpha").unwrap_or(1.0),
                width: bounds.as_ref().and_then(|b| num(b, "Width")).unwrap_or(0.0),
                height: bounds
                    .as_ref()
                    .and_then(|b| num(b, "Height"))
                    .unwrap_or(0.0),
            })
        })
        .collect()
}

const FLAGS_CHANGED: u32 = 12;
pub const SHIFT: u64 = 0x20000;
pub const CONTROL: u64 = 0x40000;
const OPTION: u64 = 0x80000;
pub const COMMAND: u64 = 0x100000;
pub const ARROW: u64 = 0x200000 | 0x800000; // numeric pad + function, as hardware arrows report
/// Posts one complete key press. Refuses while the user holds a modifier.
/// Modifiers are pressed and released as their own flagsChanged events; flags
/// only on the key events leave macOS believing the modifiers stay held.
pub fn key(code: u16, flags: u64) -> Result<(), String> {
    require_trusted()?;
    if unsafe { CGEventSourceFlagsState(1) } & (SHIFT | CONTROL | OPTION | COMMAND) != 0 {
        return Err("修饰键仍按住，已取消快捷操作".into());
    }
    // (flag, virtual key code) for ⌃ ⌥ ⇧ ⌘.
    let modifiers: Vec<(u64, u16)> = [(CONTROL, 59), (OPTION, 58), (SHIFT, 56), (COMMAND, 55)]
        .into_iter()
        .filter(|(f, _)| flags & f != 0)
        .collect();
    let extra = flags & !(SHIFT | CONTROL | OPTION | COMMAND);
    let post = |code: u16, down: bool, flags: u64, modifier: bool| unsafe {
        let e = CGEventCreateKeyboardEvent(std::ptr::null(), code, down);
        if e.is_null() {
            return false;
        }
        if modifier {
            CGEventSetType(e, FLAGS_CHANGED);
        }
        CGEventSetFlags(e, flags);
        CGEventPost(0, e);
        core_foundation::base::CFRelease(e as CFTypeRef);
        true
    };
    let mut held = 0;
    let mut ok = true;
    for (f, c) in &modifiers {
        held |= f;
        ok &= post(*c, true, held, true);
    }
    ok &= post(code, true, held | extra, false);
    ok &= post(code, false, held | extra, false);
    // Always release, even after a failure above.
    for (f, c) in modifiers.iter().rev() {
        held &= !f;
        post(*c, false, held, true);
    }
    if ok {
        Ok(())
    } else {
        Err("macOS 未能创建按键事件".into())
    }
}

extern "C" fn run_job(ctx: *mut c_void) {
    let job = unsafe { Box::from_raw(ctx as *mut Box<dyn FnOnce() + Send>) };
    let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(job));
}
/// Runs AppKit/TIS work on the main queue with a bounded wait. A job that has
/// not started before the timeout is cancelled and never runs late.
pub fn on_main<T: Send + 'static>(
    timeout: Duration,
    f: impl FnOnce() -> T + Send + 'static,
) -> Result<T, String> {
    if objc2::MainThreadMarker::new().is_some() {
        return Ok(f());
    }
    let state = Arc::new(AtomicU8::new(0)); // 0 pending, 1 started, 2 cancelled
    let (tx, rx) = mpsc::sync_channel(1);
    let s = state.clone();
    let job: Box<dyn FnOnce() + Send> = Box::new(move || {
        if s.compare_exchange(0, 1, Ordering::SeqCst, Ordering::SeqCst)
            .is_ok()
        {
            let _ = tx.send(f());
        }
    });
    unsafe {
        dispatch_async_f(
            &_dispatch_main_q as *const u8 as *const c_void,
            Box::into_raw(Box::new(job)) as *mut c_void,
            run_job,
        )
    };
    match rx.recv_timeout(timeout) {
        Ok(v) => Ok(v),
        Err(_)
            if state
                .compare_exchange(0, 2, Ordering::SeqCst, Ordering::SeqCst)
                .is_ok() =>
        {
            Err("macOS 主线程未及时响应".into())
        }
        // Already running: it is short, wait for its real result.
        Err(_) => rx.recv().map_err(|_| "macOS 主线程任务失败".to_string()),
    }
}
