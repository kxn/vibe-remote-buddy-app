import { inputProfiles } from "../platform";
export {
  inputProfiles,
  profileFor,
  installedFor,
  matchesApplication,
} from "../platform";
export type { DesktopWindow, InstalledApp } from "../platform";
import type { Action } from "./types";

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

export {voicePresets, voicePreset, inputMethodForVoice, builtinActions} from "./bindings";
export type VoiceInputMethod = "doubao" | "wechat";
