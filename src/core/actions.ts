import type { Action, Mapping } from "./types";

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

export const commands = [
  { id: "window_picker", label: "窗口选择器", group: "窗口" },
  { id: "focus_input", label: "聚焦当前应用输入框", group: "输入" },
  { id: "next_app_window", label: "同应用下一个窗口", group: "窗口" },
  { id: "previous_app_window", label: "同应用上一个窗口", group: "窗口" },
  { id: "next_global_window", label: "下一个窗口", group: "窗口" },
  { id: "previous_global_window", label: "上一个窗口", group: "窗口" },
  { id: "toggle_maximize", label: "最大化 / 还原", group: "窗口" },
  { id: "minimize_window", label: "最小化窗口", group: "窗口" },
  { id: "close_window", label: "关闭窗口", group: "窗口" },
  { id: "show_desktop", label: "显示桌面", group: "桌面" },
  { id: "task_view", label: "任务视图", group: "桌面" },
  { id: "space_left", label: "上一个虚拟桌面", group: "桌面" },
  { id: "space_right", label: "下一个虚拟桌面", group: "桌面" },
  { id: "screenshot", label: "区域截图", group: "桌面" },
] as const;

export interface DesktopWindow {
  token: string;
  title: string;
  process: string;
  path: string;
}
export function profileFor(path: string) {
  const process = path.split(/[\\/]/).at(-1)?.toLowerCase();
  // The Windows Codex distribution can use ChatGPT.exe as its process name.
  if (path.toLowerCase().includes("openai.codex")) return inputProfiles[1];
  return inputProfiles.find((p) =>
    (p.processes as readonly string[]).includes(process ?? ""),
  );
}
export function validAction(a: Action): boolean {
  if (
    !a ||
    typeof a.target !== "string" ||
    a.target.length > 8192 ||
    typeof a.label !== "string" ||
    a.label.length > 256
  )
    return false;
  if (a.kind === "command") return commands.some((c) => c.id === a.target);
  if (a.kind === "web") {
    try {
      return ["http:", "https:"].includes(new URL(a.target).protocol);
    } catch {
      return false;
    }
  }
  if (a.kind === "input") return inputProfiles.some((p) => p.id === a.profile);
  return (
    ["app", "input"].includes(a.kind) &&
    /^(?:[A-Za-z]:[\\/]|\/|\\\\)/.test(a.target)
  );
}

export interface InstalledApp {
  Name: string;
  AppID: string;
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
export const voicePresets = {
  doubao: { modifiers: 64, value: 0 },
  wechat: { modifiers: 9, value: 0 },
};
export function voicePreset(modifiers: number, value: number) {
  return (
    Object.entries(voicePresets).find(
      ([, p]) => p.modifiers === modifiers && p.value === value,
    )?.[0] ?? "custom"
  );
}

export type VoiceInputMethod = "doubao" | "wechat";
export function inputMethodForVoice(
  map: Mapping,
): VoiceInputMethod | undefined {
  if (map.kind === 5 && map.modifiers === 0)
    return map.value === 1 ? "doubao" : map.value === 2 ? "wechat" : undefined;
  if (map.kind !== 3) return undefined;
  const preset = voicePreset(map.modifiers, map.value);
  return preset === "doubao" || preset === "wechat" ? preset : undefined;
}
