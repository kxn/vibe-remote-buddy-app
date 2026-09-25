import { it, expect, afterEach } from "vitest";
import {
  configurePlatform,
  inputProfiles,
  profileFor,
  installedFor,
  matchesApplication,
  transientFocus,
} from "../src/platform";
import { inputProfiles as windowsProfiles } from "../src/platform/windows";
afterEach(() => configurePlatform("windows"));
const win = (process: string, path = `/Applications/${process}.app`) => ({
  token: "42:7",
  title: "",
  process,
  path,
});
it("uses macOS profiles with the same ids and restores Windows profiles", () => {
  configurePlatform("macos");
  expect(inputProfiles.map((p) => p.id)).toEqual(
    windowsProfiles.map((p) => p.id),
  );
  expect(inputProfiles).not.toBe(windowsProfiles);
  configurePlatform("windows");
  expect(inputProfiles).toBe(windowsProfiles);
});
it("maps bundle identifiers, not bundle paths or Windows names", () => {
  configurePlatform("macos");
  expect(profileFor("com.openai.chat")?.id).toBe("chatgpt");
  expect(profileFor("com.openai.codex")?.id).toBe("codex");
  expect(profileFor("dev.zcode.app")?.id).toBe("zcode");
  expect(profileFor("com.apple.Terminal")?.id).toBe("terminal");
  expect(profileFor("com.googlecode.iterm2")?.id).toBe("terminal");
  expect(profileFor("com.mitchellh.ghostty")?.id).toBe("terminal");
  expect(profileFor("/Applications/ChatGPT.app")).toBeUndefined();
  expect(profileFor("chatgpt.exe")).toBeUndefined();
  expect(profileFor("windowsterminal.exe")).toBeUndefined();
});
it("resolves installed apps by bundle id in preference order", () => {
  configurePlatform("macos");
  const classic = { Name: "ChatGPT", AppID: "com.openai.chat" };
  const codex = { Name: "ChatGPT", AppID: "com.openai.codex" };
  const terminal = { Name: "终端", AppID: "com.apple.Terminal" };
  expect(installedFor("chatgpt", [codex, classic])).toBe(classic);
  expect(installedFor("chatgpt", [codex])).toBe(codex);
  expect(installedFor("codex", [classic, codex])).toBe(codex);
  expect(installedFor("codex", [classic])).toBeUndefined();
  expect(installedFor("terminal", [classic, terminal])).toBe(terminal);
  expect(
    installedFor("chatgpt", [{ Name: "ChatGPT", AppID: "OpenAI.ChatGPT_abc!App" }]),
  ).toBeUndefined();
  expect(installedFor("unknown", [classic])).toBeUndefined();
});
it("matches windows by bundle id of the installed app or profile", () => {
  configurePlatform("macos");
  const codex = { Name: "ChatGPT", AppID: "com.openai.codex" };
  expect(matchesApplication("chatgpt", win("com.openai.codex"), codex)).toBe(
    true,
  );
  expect(matchesApplication("chatgpt", win("com.openai.chat"), codex)).toBe(
    false,
  );
  expect(matchesApplication("terminal", win("com.apple.Terminal"))).toBe(true);
  expect(matchesApplication("terminal", win("com.apple.Safari"))).toBe(false);
  expect(
    matchesApplication(
      "chatgpt",
      win("chatgpt.exe", "C:\\Program Files\\WindowsApps\\OpenAI.ChatGPT_1\\ChatGPT.exe"),
    ),
  ).toBe(false);
});
it("treats an application without a front window as transient", () => {
  configurePlatform("macos");
  expect(transientFocus("")).toBe(true);
  expect(transientFocus("123:0")).toBe(true);
  expect(transientFocus("123:4567")).toBe(false);
  expect(transientFocus("0:123")).toBe(false);
});
