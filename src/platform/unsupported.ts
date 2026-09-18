import type { DesktopAdapter } from "./types";
export const unsupported: DesktopAdapter = {
  profileFor: () => undefined,
  installedFor: () => undefined,
  matchesApplication: () => false,
  transientFocus: (token) => token === "",
};
