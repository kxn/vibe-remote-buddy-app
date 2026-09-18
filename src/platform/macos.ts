import type { DesktopAdapter } from "./types";
import { unsupported } from "./unsupported";
// Native AX/TIS and bundle identities are not implemented yet. Never reuse
// Windows package names or UI Automation matchers for a macOS application.
export const macos: DesktopAdapter = { ...unsupported };
