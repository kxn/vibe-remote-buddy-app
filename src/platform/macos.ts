import type {
  DesktopAdapter,
  DesktopWindow,
  InputProfile,
  InstalledApp,
} from "./types";
// macOS identifies applications by bundle identifier. `processes` holds bundle
// ids in preference order; never reuse Windows executable or package rules.
// Profile ids match Windows so saved actions keep working across platforms.
export const inputProfiles: readonly InputProfile[] = [
  {
    id: "chatgpt",
    label: "ChatGPT",
    // Newer ChatGPT desktop builds ship under the Codex bundle id.
    processes: ["com.openai.chat", "com.openai.codex"],
    names: [
      "随心输入",
      "询问任何问题",
      "Ask anything",
      "Message ChatGPT",
      "Do anything",
    ],
    ids: ["prompt-textarea"],
  },
  {
    id: "codex",
    label: "Codex",
    processes: ["com.openai.codex"],
    names: [
      "随心输入",
      "Do anything",
      "Ask for follow-up changes",
      "提出后续修改要求",
      "What would you like to do?",
    ],
    ids: ["prompt-textarea"],
  },
  {
    id: "zcode",
    label: "ZCode",
    processes: ["dev.zcode.app"],
    names: ["提出后续修改要求", "输入消息", "Ask a follow-up"],
    ids: [],
  },
  {
    id: "terminal",
    label: "终端",
    processes: [
      "com.apple.Terminal",
      "com.googlecode.iterm2",
      "com.github.wez.wezterm",
      "org.alacritty",
      "com.mitchellh.ghostty",
      "net.kovidgoyal.kitty",
      "dev.warp.Warp-Stable",
    ],
    names: [],
    ids: [],
  },
];
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
/** Accepts a bundle identifier; bundle paths carry no reliable identity. */
export function profileFor(bundleId: string) {
  // Exact owner first: com.openai.codex is Codex even though ChatGPT accepts it.
  return (
    inputProfiles.find((p) => same(p.processes[0], bundleId)) ??
    inputProfiles.find((p) => p.processes.some((b) => same(b, bundleId)))
  );
}
export function installedFor(profile: string, apps: InstalledApp[]) {
  const p = inputProfiles.find((p) => p.id === profile);
  for (const bundle of p?.processes ?? []) {
    const app = apps.find((a) => same(a.AppID, bundle));
    if (app) return app;
  }
  return undefined;
}
export function matchesApplication(
  profile: string,
  w: DesktopWindow,
  installed?: InstalledApp,
) {
  if (installed) return same(w.process, installed.AppID);
  const p = inputProfiles.find((p) => p.id === profile);
  return !!p?.processes.some((b) => same(b, w.process));
}
export const macos: DesktopAdapter = {
  profileFor,
  installedFor,
  matchesApplication,
  // `pid:0`: the application is front but has not shown a window yet.
  transientFocus: (token) => token === "" || token.endsWith(":0"),
};
