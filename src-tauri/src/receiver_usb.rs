//! USB identities supported by the receiver's CDC management interface.
pub const LEGACY_ID: (u16, u16) = (0xcafe, 0x4016);
pub const NATIVE_FN_ID: (u16, u16) = (0x05ac, 0x0220);

pub fn supports_management(vid: u16, pid: u16) -> bool {
    matches!((vid, pid), LEGACY_ID | NATIVE_FN_ID)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_old_and_native_fn_receivers_without_broadening_vendor_matching() {
        assert!(supports_management(0xcafe, 0x4016));
        assert!(supports_management(0x05ac, 0x0220));
        for (vid, pid) in [
            (0xcafe, 0x0220),
            (0x05ac, 0x4016),
            (0x05ac, 0x0221),
            (0x303a, 0x1001),
        ] {
            assert!(!supports_management(vid, pid));
        }
        // New firmware relies on native macOS Fn events, never the legacy bridge.
        assert_ne!(NATIVE_FN_ID, LEGACY_ID);
    }
}
