import { windows } from "./windows";
import { macos } from "./macos";
import { unsupported } from "./unsupported";
import type { DesktopAdapter } from "./types";
export { inputProfiles } from "./windows";
export type { DesktopWindow, InstalledApp } from "./types";
// Native platform identity is installed before the management session starts.
let active: DesktopAdapter = windows;
export function configurePlatform(name: string) {
  active =
    name === "windows" ? windows : name === "macos" ? macos : unsupported;
}
export const profileFor: DesktopAdapter["profileFor"] = (...args) =>
  active.profileFor(...args);
export const installedFor: DesktopAdapter["installedFor"] = (...args) =>
  active.installedFor(...args);
export const matchesApplication: DesktopAdapter["matchesApplication"] = (
  ...args
) => active.matchesApplication(...args);
export const transientFocus: DesktopAdapter["transientFocus"] = (...args) =>
  active.transientFocus(...args);
