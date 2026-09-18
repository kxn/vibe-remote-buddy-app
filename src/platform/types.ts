export interface DesktopWindow {
  token: string;
  title: string;
  process: string;
  path: string;
}
export interface InstalledApp {
  Name: string;
  AppID: string;
}
export interface InputProfile {
  id: string;
  label: string;
  processes: readonly string[];
  names: readonly string[];
  ids: readonly string[];
}
export interface DesktopAdapter {
  profileFor(path: string): InputProfile | undefined;
  installedFor(profile: string, apps: InstalledApp[]): InstalledApp | undefined;
  matchesApplication(
    profile: string,
    w: DesktopWindow,
    installed?: InstalledApp,
  ): boolean;
  transientFocus(token: string): boolean;
}
