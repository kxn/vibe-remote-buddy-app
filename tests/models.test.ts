import { describe, it, expect, beforeEach } from "vitest";
import {
  loadModels,
  remoteModels,
  validateModel,
  modelBytes,
  syncModels,
} from "../src/core/models";
import xiaomi from "../resources/remotes/xiaomi.rc003/model.json";
import unicom from "../resources/remotes/unicom.hid_ico.v1/model.json";
import { crc32c } from "../src/core/wire";
const source = (model: unknown) => ({ model, source: "fixture" });
beforeEach(() => remoteModels.clear());
describe("external model packages", () => {
  it("loads current remotes without compiled model branches", () => {
    expect(loadModels([source(xiaomi), source(unicom)])).toEqual([]);
    expect(remoteModels.get(xiaomi.id)?.keys).toHaveLength(13);
    expect(remoteModels.get(unicom.id)?.keys).toHaveLength(28);
  });
  it("adds a vendor/name variant and a model without number buttons by resources only", () => {
    const keys = unicom.keys.filter((k) => k.id < 23);
    const variant = {
      schema: 1,
      id: "example.unicom-mini",
      extends: unicom.id,
      title: "示例遥控器",
      revision: 1,
      matches: [{ name: "Example Voice", company: 1234 }],
      keys,
      layout: {
        ...unicom.layout,
        buttons: unicom.layout.buttons.filter((b) => b.key < 23),
      },
    };
    expect(loadModels([source(variant), source(unicom)])).toEqual([]);
    const m = remoteModels.get(variant.id)!;
    expect(m.family).toBe(2);
    expect(m.keys).toHaveLength(16);
    expect(m.matches).toEqual(variant.matches);
    const wire = JSON.parse(new TextDecoder().decode(modelBytes(m)));
    expect(wire.layout).toBeUndefined();
    expect(wire.keys[0].label).toBeUndefined();
    expect(wire.id).toBe(variant.id);
  });
  it("supports extra physical buttons without compiled catalog changes", () => {
    const model = structuredClone(unicom);
    model.keys.push({ id: 35, label: "快捷应用", default: [0, 0, 0] });
    model.layout.buttons.push({
      key: 35,
      x: 18,
      y: 4.166666666666667,
      width: 24,
      height: 6.5,
      radius: 50,
    });
    model.raw = [{ report: 1, usage: 42, key: 35 }] as never;
    expect(validateModel(model).keys.at(-1)?.id).toBe(35);
  });
  it("isolates invalid/cyclic/conflicting packages", () => {
    expect(
      loadModels([
        source(xiaomi),
        source({ ...unicom, extends: "missing" }),
        source({ id: "a", extends: "b" }),
        source({ id: "b", extends: "a" }),
      ]),
    ).toHaveLength(3);
    expect([...remoteModels.keys()]).toEqual([xiaomi.id]);
    expect(loadModels([source(xiaomi), source(xiaomi)])).not.toHaveLength(0);
    expect(remoteModels.size).toBe(0);
  });
  it("validates bounds, IDs, default actions, report formats and layout coverage", () => {
    const mutate = (fn: (v: any) => void) => {
      const v = structuredClone(unicom);
      fn(v);
      expect(() => validateModel(v)).toThrow();
    };
    mutate((v) => (v.matches = [{ name: "a", vendor_id: 1 }]));
    mutate((v) => v.keys.push(v.keys[0]));
    mutate((v) => (v.keys[0].default = [3, 64, 0]));
    mutate((v) => v.layout.buttons.pop());
    mutate((v) => (v.layout.buttons[0].y = 101));
    mutate((v) => (v.raw = [{ report: 252, usage: 1, key: 1 }]));
  });
  it("syncs only changed operational bytes and aborts failed uploads", async () => {
    loadModels([source(xiaomi)]);
    const m = remoteModels.get(xiaomi.id)!;
    const calls: number[] = [];
    await syncModels(async (op) => {
      calls.push(op);
      return { id: m.id, crc: crc32c(modelBytes(m)) };
    }, 1);
    expect(calls).toEqual([0x430]);
    calls.length = 0;
    await expect(
      syncModels(async (op) => {
        calls.push(op);
        if (op === 0x430) throw { status: 6 };
        if (op === 0x431) return { token: 7 };
        if (op === 0x432) throw Error("unplugged");
        return {};
      }, 1),
    ).rejects.toThrow("未安装");
    expect(calls).toEqual([0x430, 0x431, 0x432, 0x434]);
  });
});
