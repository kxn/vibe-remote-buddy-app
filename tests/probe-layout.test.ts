import tauriConfig from "../src-tauri/tauri.conf.json";
import { it, expect } from "vitest";
import xiaomi from "../resources/remotes/xiaomi.rc003/model.json";
import { validateModel } from "../src/core/models";
import {
  placeKey,
  removeKey,
  cellOf,
  verifiedModel,
} from "../src/core/probe-layout";
import {
  decodeKey,
  pcmWav,
  readProbeAudio,
  ProbeClient,
  type ProbeCommand,
  type ProbeVoiceStatus,
} from "../src/core/probe";
const blank = () => ({
  ...structuredClone(validateModel(xiaomi)),
  keys: [],
  raw: [],
  layout: { width: 320, height: 560, buttons: [] },
});
it("grid swap preserves functional ids, only placed keys are exported", () => {
  let m = placeKey(blank(), 0, 3);
  m = placeKey(m, 1, 2);
  m = placeKey(m, 1, 3);
  expect(cellOf(m, 3)).toBe(1);
  expect(cellOf(m, 2)).toBe(0);
  expect(() =>
    verifiedModel(m, {
      3: { report: 1, usage: 82 },
      2: { report: 1, usage: 62 },
    }),
  ).toThrow("语音验证");
  const valid = verifiedModel(m, {
    3: { report: 1, usage: 82 },
    2: { report: 1, usage: 62, voice: true },
  });
  expect(valid.raw).toEqual([
    { report: 1, usage: 82, key: 3 },
    { report: 1, usage: 62, key: 2 },
  ]);
  expect(removeKey(valid, 3).raw).toEqual([{ report: 1, usage: 62, key: 2 }]);
});
it("rejects occupied cells, reserved custom ids and standard names", () => {
  const m = placeKey(blank(), 0, 3);
  expect(() => placeKey(m, 0, 2)).toThrow("已有");
  expect(() => placeKey(m, 1, 35, "上")).toThrow();
  expect(() => placeKey(m, 1, 64, "Test")).toThrow();
  expect(() => placeKey(m, 40, 2)).toThrow();
  expect(placeKey(m, 1, 35, "Netflix").keys.at(-1)?.id).toBe(35);
});
it("Unicom voice is protocol F8, never a fabricated keyboard usage", () => {
  const r = {
    sequence: 1,
    lost: 0,
    time_ms: 0,
    handle: 5,
    length: 20,
    hex: "820301" + "00".repeat(17),
  };
  const attrs = [
    {
      index: 0,
      kind: 3,
      handle: 6,
      parent: 5,
      end: 0,
      properties: 0,
      uuid: "0x2908",
      length: 2,
      complete: true,
      hex: "f801",
    },
  ];
  expect(decodeKey(r, attrs)).toEqual({ report: 248, usages: [1] });
  let m = placeKey(blank(), 0, 2);
  m.family = 2;
  expect(
    verifiedModel(m, { 2: { report: 248, usage: 1, voice: true } }).raw,
  ).toEqual([]);
  m.family = 1;
  expect(() =>
    verifiedModel(m, { 2: { report: 248, usage: 1, voice: true } }),
  ).toThrow();
});
it("duplicate raw codes are rejected even when both buttons were individually captured", () => {
  const m = placeKey(placeKey(blank(), 0, 2), 1, 3);
  expect(() =>
    verifiedModel(m, {
      2: { report: 1, usage: 62, voice: true },
      3: { report: 1, usage: 62 },
    }),
  ).toThrow("重复");
});
it("PCM WAV headers match mono16 sample bytes", async () => {
  const b = pcmWav(new Uint8Array([1, 0, 255, 127]), 16000);
  const v = new DataView(await b.arrayBuffer());
  expect(v.byteLength).toBe(48);
  expect(v.getUint32(24, true)).toBe(16000);
  expect(v.getUint32(40, true)).toBe(4);
  expect(v.getInt16(46, true)).toBe(32767);
});
it("audio read rejects stale epochs, incomplete release and cancellation", async () => {
  const status = {
    armed: false,
    recording: false,
    released: true,
    samples: 2,
    rate: 16000,
    capture: 8,
    error: "",
    decode_error: 0,
  } as ProbeVoiceStatus;
  const c = new ProbeClient((async () => ({
    capture: 7,
    offset: 0,
    hex: "00000000",
  })) as ProbeCommand);
  await expect(
    readProbeAudio(
      c,
      status,
      () => {},
      () => false,
    ),
  ).rejects.toThrow("不一致");
  await expect(
    readProbeAudio(
      c,
      status,
      () => {},
      () => true,
    ),
  ).rejects.toThrow("取消");
  await expect(
    readProbeAudio(
      c,
      { ...status, released: false },
      () => {},
      () => false,
    ),
  ).rejects.toThrow("未完成");
});

it("Windows main webview allows the layout editor HTML drag and drop", () => {
  expect(
    tauriConfig.app.windows.find((w) => w.label === "main")?.dragDropEnabled,
  ).toBe(false);
});
