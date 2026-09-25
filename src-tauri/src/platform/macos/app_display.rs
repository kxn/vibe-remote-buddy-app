//! Display name and icon of an application bundle, for pickers that would
//! otherwise show a bundle identifier.
use core_foundation::{
    base::{CFRelease, TCFType},
    data::{CFData, CFDataRef},
    string::{CFString, CFStringRef},
};
use objc2::{
    class, msg_send,
    rc::autoreleasepool,
    runtime::AnyObject,
    Encoding, RefEncode,
};
use objc2_foundation::{NSPoint, NSRect, NSSize, NSString};
use serde::Serialize;
use std::{collections::HashMap, ffi::c_void, sync::Mutex};

#[derive(Clone, Serialize)]
pub struct AppDisplay {
    pub name: String,
    /// PNG data URL, 64×64 pixels.
    pub icon: Option<String>,
}

#[repr(C)]
pub struct CGImage([u8; 0]);
unsafe impl RefEncode for CGImage {
    const ENCODING_REF: Encoding = Encoding::Pointer(&Encoding::Struct("CGImage", &[]));
}
#[repr(C)]
#[derive(Clone, Copy)]
struct CGRect {
    x: f64,
    y: f64,
    w: f64,
    h: f64,
}
const SIDE: usize = 64;
#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CGColorSpaceCreateDeviceRGB() -> *mut c_void;
    fn CGColorSpaceRelease(space: *mut c_void);
    fn CGBitmapContextCreate(
        data: *mut c_void,
        width: usize,
        height: usize,
        bits: usize,
        row: usize,
        space: *mut c_void,
        info: u32,
    ) -> *mut c_void;
    fn CGContextDrawImage(ctx: *mut c_void, rect: CGRect, image: *const CGImage);
    fn CGBitmapContextCreateImage(ctx: *mut c_void) -> *mut c_void;
    fn CGContextRelease(ctx: *mut c_void);
    fn CGImageRelease(image: *mut c_void);
}
#[link(name = "ImageIO", kind = "framework")]
extern "C" {
    fn CGImageDestinationCreateWithData(
        data: *mut c_void,
        kind: CFStringRef,
        count: usize,
        options: *const c_void,
    ) -> *mut c_void;
    fn CGImageDestinationAddImage(dest: *mut c_void, image: *mut c_void, props: *const c_void);
    fn CGImageDestinationFinalize(dest: *mut c_void) -> bool;
}
#[link(name = "CoreFoundation", kind = "framework")]
extern "C" {
    fn CFDataCreateMutable(alloc: *const c_void, capacity: isize) -> *mut c_void;
}

static CACHE: Mutex<Option<HashMap<String, Option<AppDisplay>>>> = Mutex::new(None);

pub fn get(path: &str) -> Option<AppDisplay> {
    if !path.ends_with(".app") || !std::path::Path::new(path).is_dir() {
        return None;
    }
    if let Some(hit) = CACHE.lock().ok()?.get_or_insert_with(HashMap::new).get(path) {
        return hit.clone();
    }
    let value = autoreleasepool(|_| unsafe { load(path) });
    CACHE
        .lock()
        .ok()?
        .get_or_insert_with(HashMap::new)
        .insert(path.to_string(), value.clone());
    value
}

unsafe fn load(path: &str) -> Option<AppDisplay> {
    let ns_path = NSString::from_str(path);
    let fm: *mut AnyObject = msg_send![class!(NSFileManager), defaultManager];
    let display: *mut NSString = msg_send![fm, displayNameAtPath: &*ns_path];
    let name = display.as_ref()?.to_string();
    let name = name.strip_suffix(".app").unwrap_or(&name).to_string();
    let ws: *mut AnyObject = msg_send![class!(NSWorkspace), sharedWorkspace];
    let image: *mut AnyObject = msg_send![ws, iconForFile: &*ns_path];
    let icon = image.as_ref().and_then(|image| png(image));
    Some(AppDisplay { name, icon })
}

unsafe fn png(image: &AnyObject) -> Option<String> {
    let mut rect = NSRect::new(NSPoint::new(0.0, 0.0), NSSize::new(SIDE as f64, SIDE as f64));
    let source: *const CGImage = msg_send![
        image,
        CGImageForProposedRect: &mut rect,
        context: std::ptr::null::<AnyObject>(),
        hints: std::ptr::null::<AnyObject>()
    ];
    if source.is_null() {
        return None;
    }
    let space = CGColorSpaceCreateDeviceRGB();
    // kCGImageAlphaPremultipliedLast
    let ctx = CGBitmapContextCreate(std::ptr::null_mut(), SIDE, SIDE, 8, 0, space, 1);
    CGColorSpaceRelease(space);
    if ctx.is_null() {
        return None;
    }
    let side = SIDE as f64;
    CGContextDrawImage(ctx, CGRect { x: 0.0, y: 0.0, w: side, h: side }, source);
    let scaled = CGBitmapContextCreateImage(ctx);
    CGContextRelease(ctx);
    if scaled.is_null() {
        return None;
    }
    let data = CFDataCreateMutable(std::ptr::null(), 0);
    let kind = CFString::new("public.png");
    let dest = CGImageDestinationCreateWithData(data, kind.as_concrete_TypeRef(), 1, std::ptr::null());
    let ok = !dest.is_null() && {
        CGImageDestinationAddImage(dest, scaled, std::ptr::null());
        CGImageDestinationFinalize(dest)
    };
    if !dest.is_null() {
        CFRelease(dest as *const c_void);
    }
    CGImageRelease(scaled);
    let data = CFData::wrap_under_create_rule(data as CFDataRef);
    ok.then(|| format!("data:image/png;base64,{}", base64(data.bytes())))
}

fn base64(bytes: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for c in bytes.chunks(3) {
        let n = (c[0] as u32) << 16 | (*c.get(1).unwrap_or(&0) as u32) << 8 | *c.get(2).unwrap_or(&0) as u32;
        for i in 0..4 {
            out.push(if i <= c.len() { T[(n >> (18 - 6 * i) & 63) as usize] as char } else { '=' });
        }
    }
    out
}

#[cfg(test)]
mod tests {
    #[test]
    fn base64_matches_rfc4648() {
        assert_eq!(super::base64(b"f"), "Zg==");
        assert_eq!(super::base64(b"fo"), "Zm8=");
        assert_eq!(super::base64(b"foobar"), "Zm9vYmFy");
    }
    #[test]
    fn finder_has_name_and_icon() {
        let d = super::get("/System/Library/CoreServices/Finder.app").expect("Finder");
        assert!(!d.name.is_empty());
        assert!(d.icon.unwrap().starts_with("data:image/png;base64,iVBOR"));
    }
}
