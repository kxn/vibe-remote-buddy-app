import { windows, inputProfiles as windowsProfiles } from "./windows";
import { macos, inputProfiles as macosProfiles } from "./macos";
import { unsupported } from "./unsupported";
import type { DesktopAdapter, InputProfile } from "./types";
// Live binding: macOS matches bundle ids and its own accessibility names.
export let inputProfiles: readonly InputProfile[] = windowsProfiles;
export type { DesktopWindow, InstalledApp } from "./types";
// Native platform identity is installed before the management session starts.
let active: DesktopAdapter = windows;
export function configurePlatform(name: string) {
  active =
    name === "windows" ? windows : name === "macos" ? macos : unsupported;
  inputProfiles = name === "macos" ? macosProfiles : windowsProfiles;
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
