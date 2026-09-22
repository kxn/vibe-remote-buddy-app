import unicom from "../resources/remotes/unicom.sample-28/model.json";
import { renderRemoteArtwork } from "../src/core/remote-artwork";
import tauriConfig from "../src-tauri/tauri.conf.json";
import { it, expect } from "vitest";
import xiaomi from "../resources/remotes/xiaomi.rc003/model.json";
import { validateModel, type RemoteModel } from "../src/core/models";
import {
  standardKeys,
  copyLayoutPreset,
  resizeGrid,
  gridColumns,
  placeKey,
  removeKey,
  cellOf,
  verifiedModel,
} from "../src/core/probe-layout";
import {
  decodeKey,
  decodeProbeKey,
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
  ).rejects.toThrow("不完整");
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

it("HID/ICO voice captures dedicated F8 edges, ignoring keyboard echoes in either order", () => {
  const attrs = [1, 248].map((id, i) => ({
    index: i,
    kind: 3,
    handle: 6 + i * 2,
    parent: 5 + i * 2,
    end: 0,
    properties: 0,
    uuid: "2908",
    length: 2,
    complete: true,
    hex: id.toString(16).padStart(2, "0") + "01",
  }));
  const packet = (handle: number, hex: string) => ({
    sequence: 1,
    lost: 0,
    time_ms: 0,
    handle,
    length: hex.length / 2,
    hex,
  });
  const keyboardDown = packet(5, "0000ea0000000000"),
    keyboardUp = packet(5, "0000000000000000");
  const voiceDown = packet(7, "820301" + "00".repeat(17)),
    voiceUp = packet(7, "820300" + "00".repeat(17));
  for (const packets of [
    [keyboardDown, voiceDown, voiceUp, keyboardUp],
    [voiceDown, keyboardDown, keyboardUp, voiceUp],
  ]) {
    expect(
      packets.map((p) => decodeProbeKey(p, attrs, 2, 2)).filter(Boolean),
    ).toEqual([
      { report: 248, usages: [1] },
      { report: 248, usages: [] },
    ]);
  }
  expect(decodeProbeKey(keyboardDown, attrs, 3, 2)).toEqual({
    report: 1,
    usages: [234],
  });
  expect(decodeProbeKey(voiceDown, attrs, 3, 2)).toBeUndefined();
  expect(decodeProbeKey(keyboardDown, attrs, 2, 1)).toEqual({
    report: 1,
    usages: [234],
  });
  expect(decodeProbeKey(keyboardDown, attrs.slice(0, 1), 2, 2)).toEqual({
    report: 1,
    usages: [234],
  });
});

it("copies layout without borrowing device identity or verified key codes", () => {
  const source = validateModel(structuredClone(xiaomi));
  const current = blank();
  current.family = 2;
  current.id = "mobile.test";
  current.map_crc = 123;
  const copy = copyLayoutPreset(current, source);
  expect(copy.id).toBe(current.id);
  expect(copy.family).toBe(2);
  expect(copy.map_crc).toBe(123);
  expect(copy.matches).toEqual(current.matches);
  expect(copy.raw).toEqual([]);
  expect(new Set(copy.keys.map((k) => cellOf(copy, k.id))).size).toBe(
    copy.keys.length,
  );
  copy.keys[0].label = "changed";
  expect(source.keys[0].label).not.toBe("changed");
  expect(() => verifiedModel(copy, {})).toThrow("验证");
});

it("preserves three-column preset geometry and renamed symbols", () => {
  const source = validateModel(unicom);
  const copy = copyLayoutPreset(source, source);
  expect(copy.layout.editorColumns).toBe(3);
  expect(copy.layout.buttons.map(({ cell, ...b }) => b)).toEqual(
    source.layout.buttons,
  );
  copy.keys.find((k) => k.id === 20)!.label = "M";
  expect(renderRemoteArtwork(copy)).toContain(">M</text>");
  expect(renderRemoteArtwork(copy)).not.toContain(">本地</text>");
  expect(new Set(copy.keys.map((k) => cellOf(copy, k.id))).size).toBe(
    copy.keys.length,
  );
});

it("ATVV control-only voice proof is not exported as a fake HID key", () => {
  const m = placeKey(blank(), 0, 2);
  expect(
    verifiedModel(m, { 2: { report: 0, usage: 8, voice: true } }).raw,
  ).toEqual([]);
  expect(() => verifiedModel(m, { 2: { report: 0, usage: 8 } })).toThrow();
  m.family = 2;
  expect(() =>
    verifiedModel(m, { 2: { report: 0, usage: 8, voice: true } }),
  ).toThrow();
});

it("new canvas uses three columns; growing preserves physical cells and proofs", () => {
  let m: RemoteModel = blank();
  expect(gridColumns(m)).toBe(3);
  m = placeKey(m, 7, 2);
  const bigger = resizeGrid(m, 4, 9);
  expect(cellOf(bigger, 2)).toBe(9);
  expect(bigger.keys).toEqual(m.keys);
  expect(bigger.raw).toEqual(m.raw);
  expect(cellOf(resizeGrid(bigger, 3, 8), 2)).toBe(7);
  expect(m.layout.editorRows).toBeUndefined();
});
it("shrinking never silently discards edge keys", () => {
  const m = placeKey(resizeGrid(blank(), 4, 9), 35, 2);
  expect(() => resizeGrid(m, 3, 9)).toThrow("移走边缘");
  expect(() => resizeGrid(m, 4, 8)).toThrow("移走边缘");
  expect(cellOf(m, 2)).toBe(35);
});

it("new standard number and media keys carry usable defaults", () => {
 const get=(id:number)=>standardKeys.find(k=>k.id===id)!.default;
 expect(get(23)).toEqual([1,0,39]);
 for(let id=24;id<=32;id++)expect(get(id)).toEqual([1,0,id+6]);
 expect(get(33)).toEqual([1,2,37]);
 expect(get(34)).toEqual([1,2,32]);
 for(let id=12;id<=18;id++)expect(get(id)).toEqual([2,0,id-12]);
});

it("validation uses the editor's inferred columns instead of a hidden five-column default",()=>{
 const m=structuredClone(validateModel(xiaomi));
 delete m.layout.editorColumns;m.layout.editorRows=8;
 m.layout.buttons.forEach(b=>{b.x=50;delete b.cell;});
 expect(gridColumns(m)).toBe(2);
 m.layout.buttons[0].cell=16;
 expect(()=>validateModel(m)).toThrow("网格位置无效");
 m.layout.buttons[0].cell=15;
 expect(validateModel(m).layout.buttons[0].cell).toBe(15);
});
