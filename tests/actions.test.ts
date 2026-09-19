import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  validAction,
  installedFor,
  matchesApplication,
  voicePresets,
  voicePreset,
  inputMethodForVoice,
} from "../src/core/actions";
const mocks = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock("../src/native", () => ({ call: mocks.call }));
import { runAction } from "../src/action-runner";
const app = { Name: "ChatGPT", AppID: "OpenAI.ChatGPT_abc!App" };
const win = {
  token: "1:2",
  path: "C:\\Program Files\\WindowsApps\\OpenAI.ChatGPT_2.0\\ChatGPT.exe",
  process: "ChatGPT.exe",
  title: "ChatGPT",
};
const action = {
  kind: "input" as const,
  target: "",
  profile: "chatgpt",
  label: "切换到 ChatGPT",
};
const base = async (cmd: string) =>
  cmd === "desktop_focus_token"
    ? "origin"
    : cmd === "installed_applications"
      ? [app]
      : cmd === "desktop_windows"
        ? [win]
        : undefined;
beforeEach(() => {
  mocks.call.mockReset();
  mocks.call.mockImplementation(base);
});
afterEach(() => vi.useRealTimers());
describe("named application actions", () => {
  it("requires only an application identity, not an executable or process", () => {
    expect(validAction(action)).toBe(true);
    expect(validAction({ ...action, profile: "unknown" })).toBe(false);
    expect(validAction({ kind: "app", target: "cmd.exe", label: "" })).toBe(
      false,
    );
  });
  it("resolves installed identities independently of package versions", () => {
    expect(installedFor("chatgpt", [app])).toEqual(app);
    expect(matchesApplication("chatgpt", win, app)).toBe(true);
    expect(
      matchesApplication(
        "chatgpt",
        { ...win, path: "C:\\WindowsApps\\OpenAI.Codex_2\\ChatGPT.exe" },
        app,
      ),
    ).toBe(false);
  });
  it("activates an existing window without launching a duplicate", async () => {
    await runAction(action);
    const calls = mocks.call.mock.calls.map((c) => c[0]);
    expect(calls).not.toContain("launch_installed_application");
    expect(calls.slice(-2)).toEqual(["desktop_activate", "desktop_focus"]);
  });
  it("launches a closed app once and focuses its new window", async () => {
    let launched = false;
    mocks.call.mockImplementation(async (cmd) => {
      if (cmd === "launch_installed_application") {
        launched = true;
        return;
      }
      if (cmd === "desktop_windows") return launched ? [win] : [];
      return base(cmd);
    });
    await runAction(action);
    expect(
      mocks.call.mock.calls.filter(
        (c) => c[0] === "launch_installed_application",
      ),
    ).toEqual([["launch_installed_application", { appId: app.AppID }]]);
    expect(mocks.call.mock.calls.at(-1)![1].matcher.wait_ms).toBe(8000);
  });
  it("reports an uninstalled app without launching an arbitrary executable", async () => {
    mocks.call.mockImplementation(async (cmd) =>
      ["desktop_windows", "installed_applications"].includes(cmd)
        ? []
        : base(cmd),
    );
    await expect(runAction(action)).rejects.toThrow("未找到已安装");
    expect(
      mocks.call.mock.calls.some(
        (c) => c[0] === "launch_installed_application",
      ),
    ).toBe(false);
  });
  it("does not continue when foreground changes during discovery", async () => {
    let n = 0;
    mocks.call.mockImplementation(async (cmd) =>
      cmd === "desktop_focus_token" ? (n++ ? "other" : "origin") : base(cmd),
    );
    await expect(runAction(action)).rejects.toThrow("前台窗口已变化");
    expect(mocks.call.mock.calls.some((c) => c[0] === "desktop_activate")).toBe(
      false,
    );
  });
  it("does not focus when activation is rejected", async () => {
    mocks.call.mockImplementation(async (cmd) => {
      if (cmd === "desktop_activate") throw Error("denied");
      return base(cmd);
    });
    await expect(runAction(action)).rejects.toThrow("denied");
    expect(mocks.call.mock.calls.some((c) => c[0] === "desktop_focus")).toBe(
      false,
    );
  });
  it("bounds waiting for a launched app and never relaunches it", async () => {
    vi.useFakeTimers();
    mocks.call.mockImplementation(async (cmd) =>
      cmd === "desktop_windows" ? [] : base(cmd),
    );
    const result = expect(runAction(action)).rejects.toThrow("未及时出现");
    await vi.advanceTimersByTimeAsync(13000);
    await result;
    expect(
      mocks.call.mock.calls.filter(
        (c) => c[0] === "launch_installed_application",
      ),
    ).toHaveLength(1);
  });
  it("does not enqueue overlapping actions", async () => {
    let resolve!: (v: unknown) => void;
    mocks.call.mockImplementation(() => new Promise((r) => (resolve = r)));
    const first = runAction({
      kind: "command",
      target: "window_picker",
      label: "",
    });
    await expect(runAction(action)).rejects.toThrow("尚未结束");
    resolve(undefined);
    await first;
  });
  it("encodes both input method presets and recognizes them on reload", () => {
    expect(voicePresets.doubao).toEqual({ modifiers: 64, value: 0 });
    expect(voicePresets.wechat).toEqual({ modifiers: 9, value: 0 });
    expect(voicePreset(9, 0)).toBe("wechat");
    expect(voicePreset(64, 0)).toBe("doubao");
    expect(voicePreset(9, 44)).toBe("custom");
  });
});

describe("per-remote input method", () => {
  it("uses only enabled recognized voice mappings", () => {
    const map = { key: 2, kind: 3, modifiers: 64, value: 0, revision: 1 };
    expect(inputMethodForVoice(map)).toBe("doubao");
    expect(
      inputMethodForVoice({ ...map, kind: 5, modifiers: 0, value: 1 }),
    ).toBe("doubao");
    expect(
      inputMethodForVoice({ ...map, kind: 5, modifiers: 0, value: 2 }),
    ).toBe("wechat");
    expect(
      inputMethodForVoice({ ...map, kind: 5, modifiers: 0, value: 3 }),
    ).toBeUndefined();
    expect(inputMethodForVoice({ ...map, modifiers: 9 })).toBe("wechat");
    expect(inputMethodForVoice({ ...map, kind: 0 })).toBeUndefined();
    expect(inputMethodForVoice({ ...map, modifiers: 1 })).toBeUndefined();
  });
  it("switches only after successfully focusing the selected application", async () => {
    await runAction(action, "doubao");
    expect(mocks.call.mock.calls.slice(-2).map((c) => c[0])).toEqual([
      "desktop_focus",
      "desktop_input_method",
    ]);
    expect(mocks.call.mock.calls.at(-1)).toEqual([
      "desktop_input_method",
      { window: win, inputMethod: "doubao" },
    ]);
  });
  it("does not switch when input focus fails", async () => {
    mocks.call.mockImplementation(async (cmd) => {
      if (cmd === "desktop_focus") throw Error("focus failed");
      return base(cmd);
    });
    await expect(runAction(action, "wechat")).rejects.toThrow("focus failed");
    expect(
      mocks.call.mock.calls.some((c) => c[0] === "desktop_input_method"),
    ).toBe(false);
  });
  it("reports IME errors without replaying the action", async () => {
    mocks.call.mockImplementation(async (cmd) => {
      if (cmd === "desktop_input_method") throw Error("输入法未安装");
      return base(cmd);
    });
    await expect(runAction(action, "wechat")).rejects.toThrow("输入法未安装");
    expect(
      mocks.call.mock.calls.filter((c) => c[0] === "desktop_activate"),
    ).toHaveLength(1);
  });
  it("leaves unrelated window actions alone", async () => {
    await runAction(
      { kind: "command", target: "window_picker", label: "" },
      "doubao",
    );
    expect(mocks.call.mock.calls).toEqual([["show_window_picker"]]);
  });
});

it("meeting voice shortcut does not select an input method", () => {
  expect(
    inputMethodForVoice({
      kind: 3,
      modifiers: 0,
      value: 44,
    } as import("../src/core/types").Mapping),
  ).toBeUndefined();
});
