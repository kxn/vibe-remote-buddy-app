//! The receiver sends the Apple Fn voice preset as vendor usage 0xFF/0x03 in its
//! keyboard report. macOS ignores that usage from non-Apple keyboards, so mirror
//! the receiver's own press/release into a system Fn modifier event.
use core_foundation::{
    base::TCFType,
    dictionary::CFDictionary,
    number::CFNumber,
    runloop::{kCFRunLoopDefaultMode, CFRunLoop},
    string::{CFString, CFStringRef},
};
use std::{
    ffi::c_void,
    sync::atomic::{AtomicBool, Ordering},
};

type Ref = *mut c_void;
const LISTEN_EVENT: u32 = 1; // kIOHIDRequestTypeListenEvent
const ACCESS_GRANTED: u32 = 0;
const HID_SYSTEM_STATE: i32 = 1;
const FLAGS_CHANGED: u32 = 12;
const FN_KEY: u16 = 63; // kVK_Function
const FN_FLAG: u64 = 0x800000; // kCGEventFlagMaskSecondaryFn

#[link(name = "IOKit", kind = "framework")]
extern "C" {
    fn IOHIDManagerCreate(alloc: *const c_void, options: u32) -> Ref;
    fn IOHIDManagerSetDeviceMatching(m: Ref, matching: *const c_void);
    fn IOHIDManagerRegisterInputValueCallback(
        m: Ref,
        callback: extern "C" fn(*mut c_void, i32, *mut c_void, Ref),
        ctx: *mut c_void,
    );
    fn IOHIDManagerRegisterDeviceRemovalCallback(
        m: Ref,
        callback: extern "C" fn(*mut c_void, i32, *mut c_void, Ref),
        ctx: *mut c_void,
    );
    fn IOHIDManagerScheduleWithRunLoop(m: Ref, run_loop: *const c_void, mode: CFStringRef);
    fn IOHIDManagerOpen(m: Ref, options: u32) -> i32;
    fn IOHIDValueGetElement(v: Ref) -> Ref;
    fn IOHIDValueGetIntegerValue(v: Ref) -> isize;
    fn IOHIDElementGetUsagePage(e: Ref) -> u32;
    fn IOHIDElementGetUsage(e: Ref) -> u32;
    fn IOHIDCheckAccess(request: u32) -> u32;
    fn IOHIDRequestAccess(request: u32) -> bool;
}
#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CGEventSourceFlagsState(state: i32) -> u64;
    fn CGEventCreateKeyboardEvent(source: *const c_void, key: u16, down: bool) -> Ref;
    fn CGEventSetType(event: Ref, kind: u32);
    fn CGEventSetFlags(event: Ref, flags: u64);
    fn CGEventPost(tap: u32, event: Ref);
}

/// True only while this bridge holds a synthesized Fn press.
static HELD: AtomicBool = AtomicBool::new(false);

fn post(down: bool) {
    unsafe {
        let e = CGEventCreateKeyboardEvent(std::ptr::null(), FN_KEY, down);
        if e.is_null() {
            return;
        }
        CGEventSetType(e, FLAGS_CHANGED);
        CGEventSetFlags(e, if down { FN_FLAG } else { 0 });
        CGEventPost(0, e);
        core_foundation::base::CFRelease(e as *const c_void);
    }
}

extern "C" fn value(_: *mut c_void, _: i32, _: *mut c_void, v: Ref) {
    let (page, usage, pressed) = unsafe {
        let e = IOHIDValueGetElement(v);
        (
            IOHIDElementGetUsagePage(e),
            IOHIDElementGetUsage(e),
            IOHIDValueGetIntegerValue(v) != 0,
        )
    };
    if page != 0xff || usage != 0x03 {
        return;
    }
    if pressed {
        // Posting needs Accessibility; never duplicate an Fn that macOS already honors.
        if super::sys::require_trusted().is_err()
            || unsafe { CGEventSourceFlagsState(HID_SYSTEM_STATE) } & FN_FLAG != 0
            || HELD.swap(true, Ordering::SeqCst)
        {
            return;
        }
        post(true);
    } else if HELD.swap(false, Ordering::SeqCst) {
        post(false);
    }
}

// Unplugging mid-press must not leave Fn held.
extern "C" fn removed(_: *mut c_void, _: i32, _: *mut c_void, _: Ref) {
    if HELD.swap(false, Ordering::SeqCst) {
        post(false);
    }
}

/// Watches the receiver keyboard interface for the lifetime of the process.
pub fn start() {
    std::thread::spawn(|| unsafe {
        if IOHIDCheckAccess(LISTEN_EVENT) != ACCESS_GRANTED && !IOHIDRequestAccess(LISTEN_EVENT) {
            eprintln!("Fn bridge: Input Monitoring permission not granted");
            return;
        }
        let m = IOHIDManagerCreate(std::ptr::null(), 0);
        let matching = CFDictionary::from_CFType_pairs(&[
            (CFString::new("VendorID"), CFNumber::from(0xcafe_i32)),
            (CFString::new("ProductID"), CFNumber::from(0x4016_i32)),
        ]);
        IOHIDManagerSetDeviceMatching(m, matching.as_concrete_TypeRef() as *const c_void);
        IOHIDManagerRegisterInputValueCallback(m, value, std::ptr::null_mut());
        IOHIDManagerRegisterDeviceRemovalCallback(m, removed, std::ptr::null_mut());
        let run_loop = CFRunLoop::get_current();
        IOHIDManagerScheduleWithRunLoop(
            m,
            run_loop.as_concrete_TypeRef() as *const c_void,
            kCFRunLoopDefaultMode,
        );
        let status = IOHIDManagerOpen(m, 0);
        if status != 0 {
            eprintln!("Fn bridge: IOHIDManagerOpen failed 0x{status:x}");
            return;
        }
        CFRunLoop::run_current();
    });
}
