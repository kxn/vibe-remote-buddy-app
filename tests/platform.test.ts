import { it, expect, afterEach } from "vitest";
import {
  configurePlatform,
  profileFor,
  installedFor,
  transientFocus,
} from "../src/platform";
afterEach(() => configurePlatform("windows"));
it("does not apply Windows executable or package matching on other platforms", () => {
  const apps = [{ Name: "ChatGPT", AppID: "OpenAI.ChatGPT_abc!App" }];
  configurePlatform("windows");
  expect(profileFor("C:/apps/ChatGPT.exe")?.id).toBe("chatgpt");
  expect(installedFor("chatgpt", apps)).toBeDefined();
  for (const platform of ["macos", "linux"]) {
    configurePlatform(platform);
    expect(profileFor("C:/apps/ChatGPT.exe")).toBeUndefined();
    expect(installedFor("chatgpt", apps)).toBeUndefined();
    expect(transientFocus("0:123")).toBe(false);
  }
});
