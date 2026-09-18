import type { DesktopWindow, InstalledApp, DesktopAdapter } from "./types";
export const inputProfiles = [
  {
    id: "chatgpt",
    label: "ChatGPT",
    processes: ["chatgpt.exe"],
    names: ["随心输入", "询问任何问题", "Ask anything", "Message ChatGPT"],
    ids: ["prompt-textarea"],
  },
  {
    id: "codex",
    label: "Codex",
    processes: ["codex.exe", "chatgpt.exe"],
    names: [
      "随心输入",
      "Ask for follow-up changes",
      "提出后续修改要求",
      "What would you like to do?",
    ],
    ids: ["prompt-textarea"],
  },
  {
    id: "zcode",
    label: "ZCode",
    processes: ["zcode.exe"],
    names: ["提出后续修改要求", "输入消息", "Ask a follow-up"],
    ids: [],
  },
  {
    id: "terminal",
    label: "终端",
    processes: [
      "windowsterminal.exe",
      "powershell.exe",
      "pwsh.exe",
      "cmd.exe",
      "wezterm-gui.exe",
      "alacritty.exe",
    ],
    names: [],
    ids: [],
  },
] as const;

export function profileFor(path: string) {
  const process = path.split(/[\\/]/).at(-1)?.toLowerCase();
  // The Windows Codex distribution can use ChatGPT.exe as its process name.
  if (path.toLowerCase().includes("openai.codex")) return inputProfiles[1];
  return inputProfiles.find((p) =>
    (p.processes as readonly string[]).includes(process ?? ""),
  );
}
export function installedFor(profile: string, apps: InstalledApp[]) {
  const p = inputProfiles.find((p) => p.id === profile);
  if (!p) return undefined;
  const exact = apps.find(
    (a) => a.Name.toLowerCase() === p.label.toLowerCase(),
  );
  if (exact) return exact;
  const prefix =
    profile === "terminal" ? "microsoft.windowsterminal" : `openai.${profile}_`;
  return apps.find((a) => a.AppID.toLowerCase().startsWith(prefix));
}
export function matchesApplication(
  profile: string,
  w: DesktopWindow,
  installed?: InstalledApp,
) {
  if (installed?.AppID.includes("!")) {
    const packageName = installed.AppID.split("_")[0].toLowerCase();
    return w.path.toLowerCase().includes(`\\windowsapps\\${packageName}_`);
  }
  return profileFor(w.path)?.id === profile;
}
export const windows: DesktopAdapter = {
  profileFor,
  installedFor,
  matchesApplication,
  transientFocus: (token) => token.startsWith("0:"),
};
