import { call } from "./native";
import {
  inputProfiles,
  installedFor,
  matchesApplication,
  type InstalledApp,
  type VoiceInputMethod,
  profileFor,
  validAction,
  type DesktopWindow,
} from "./core/actions";
import type { Action } from "./core/types";

let running = false;
async function focus(window: DesktopWindow, profile: string, launched = false) {
  const p = inputProfiles.find((p) => p.id === profile);
  if (!p) throw Error("未配置此应用的输入框适配");
  await call("desktop_focus", {
    window,
    matcher: {
      names: p.names,
      ids: p.ids,
      terminal: p.id === "terminal",
      wait_ms: launched ? 8000 : 2200,
    },
  });
}
export async function runAction(a: Action, inputMethod?: VoiceInputMethod) {
  if (!validAction(a)) throw Error("软件动作配置无效");
  if (running) throw Error("上一个窗口操作尚未结束");
  running = true;
  try {
    if (a.kind === "command") {
      if (a.target === "window_picker") await call("show_window_picker");
      else if (a.target === "focus_input") {
        const window = await call<DesktopWindow>("desktop_foreground");
        const profile = profileFor(window.path);
        if (!profile) throw Error("当前应用还没有输入框适配");
        await focus(window, profile.id);
        if (inputMethod)
          await call("desktop_input_method", { window, inputMethod });
      } else await call("desktop_command", { id: a.target });
    } else if (a.kind === "input") {
      const profile = a.profile!;
      const origin = await call<string>("desktop_focus_token");
      const apps = await call<InstalledApp[]>("installed_applications");
      const installed = installedFor(profile, apps);
      const find = async () =>
        (await call<DesktopWindow[]>("desktop_windows")).find((w) =>
          matchesApplication(profile, w, installed),
        );
      let window = await find();
      let launched = false;
      if ((await call<string>("desktop_focus_token")) !== origin)
        throw Error("前台窗口已变化，已取消操作");
      if (!window) {
        if (!installed)
          throw Error(
            `未找到已安装的 ${inputProfiles.find((p) => p.id === profile)!.label}`,
          );
        await call("launch_installed_application", { appId: installed.AppID });
        launched = true;
        const deadline = performance.now() + 12000;
        while (!window && performance.now() < deadline) {
          window = await find();
          const current = await call<string>("desktop_focus_token");
          if (
            current !== origin &&
            current !== window?.token &&
            !current.startsWith("0:")
          )
            throw Error("前台窗口已变化，已取消聚焦");
          if (!window) await new Promise((r) => setTimeout(r, 100));
        }
        if (!window) throw Error("应用已启动，但未及时出现可用窗口");
      }
      await call("desktop_activate", { window });
      await focus(window, profile, launched);
      if (inputMethod)
        await call("desktop_input_method", { window, inputMethod });
    } else await call("run_action", { kind: a.kind, target: a.target });
  } finally {
    running = false;
  }
}
