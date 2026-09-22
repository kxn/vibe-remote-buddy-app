import { it, expect, vi } from "vitest";
import {
  validBinding,
  resourceBinding,
  voiceBinding,
  bindingTuple,
  describeBinding,
  selectVoiceProfile,
  defaultForKind,
} from "../src/core/bindings";
import {
  ModelRepository,
  syncModelRepository,
} from "../src/core/model-repository";
import { familyEvidence, transportReady } from "../src/core/voice-protocols";
import protocols from "../resources/voice-protocols.json";
import type { ProbeAttribute } from "../src/core/probe";
import type { Info } from "../src/core/types";
import source from "../resources/remotes/xiaomi.rc003/model.json";
import { OP } from "../src/core/session";
it("resource actions, editor presets and tuple validation share meaning", () => {
  for (const p of ["doubao", "wechat", "meeting"] as const) {
    const b = voiceBinding(p);
    expect(
      resourceBinding({
        type: "voice-preset",
        preset: p === "meeting" ? "video-meeting" : p,
      }),
    ).toEqual(bindingTuple(b));
    expect(validBinding(2, bindingTuple(b))).toBe(true);
    expect(validBinding(1, bindingTuple(b))).toBe(false);
    expect(selectVoiceProfile(b, p)).toEqual(b);
    expect(describeBinding(b)).not.toBe("");
  }
  for (const k of [0, 1, 2, 4, 6])
    expect(validBinding(1, defaultForKind(k))).toBe(true);
  for (const b of [
    [1, 0, 0],
    [1, 256, 40],
    [3, 0, 224],
    [5, 0, 3],
    [6, 1, 0],
    [6, 0, 1],
    [4, 0, 0],
    [2, 0, 8],
    [99, 0, 0],
  ])
    expect(validBinding(b[0] === 3 || b[0] === 5 ? 2 : 1, b)).toBe(false);
  expect(resourceBinding({ type: "app", command: "task-view" })).toEqual([
    4, 0, 65534,
  ]);
});
const attr = (patch: Partial<ProbeAttribute>): ProbeAttribute =>
  ({
    kind: 0,
    uuid: "",
    handle: 0,
    parent: 0,
    properties: 0,
    complete: true,
    hex: "",
    length: 0,
    ...patch,
  }) as ProbeAttribute;
function attributes(family: number) {
  const p = protocols.protocols.find((p) => p.family === family)!;
  let handle = 10;
  return [
    ...p.services.map((uuid) => attr({ kind: 1, uuid })),
    ...p.reports.flatMap((r) => {
      const h = handle++;
      return [
        attr({ kind: 2, uuid: "2a4d", handle: h, properties: r.properties }),
        attr({
          uuid: "2908",
          parent: h,
          hex:
            r.id.toString(16).padStart(2, "0") +
            r.type.toString(16).padStart(2, "0"),
        }),
      ];
    }),
    ...p.characteristics.map((c) =>
      attr({
        kind: 2,
        uuid: c.uuid,
        handle: handle++,
        properties: c.properties,
      }),
    ),
  ];
}
it("all voice families use strict required reports but allow unrelated extensions", () => {
  for (const family of [1, 2, 3]) {
    const a = attributes(family);
    expect(familyEvidence(a)).toBe(family);
    expect(transportReady(a, family)).toBe(true);
    expect(
      transportReady([...a, attr({ kind: 2, uuid: "abcd" })], family),
    ).toBe(true);
    const report = a.find((x) => x.uuid === "2908")!;
    expect(
      transportReady(
        a.filter((x) => x !== report),
        family,
      ),
    ).toBe(false);
    expect(transportReady([...a, report], family)).toBe(false);
  }
  const a = attributes(2);
  const output = a.find((x) => x.kind === 2 && x.properties === 8)!;
  output.properties = 4;
  expect(transportReady(a, 2)).toBe(false);
  const atvv = attributes(1);
  atvv.find((x) => x.uuid.startsWith("ab5e0002"))!.properties = 4;
  expect(transportReady(atvv, 1)).toBe(true);
});
it("repository serializes reloads and snapshots cannot mutate source inputs", async () => {
  const repo = new ModelRepository();
  let release!: () => void;
  const first = repo.reload({
    models: async () => {
      await new Promise<void>((r) => (release = r));
      return [{ source: "first", model: source }];
    },
  });
  let secondRead = false;
  const second = repo.reload({
    models: async () => {
      secondRead = true;
      return [{ source: "second", model: { ...source, title: "second" } }];
    },
  });
  await Promise.resolve();
  expect(secondRead).toBe(false);
  release();
  await first;
  await second;
  expect(repo.snapshot.models.get(source.id)?.title).toBe("second");
  expect(Object.isFrozen(repo.snapshot.models.get(source.id)?.keys)).toBe(true);
  expect((repo.snapshot.models as any).set).toBeUndefined();
  expect((repo.snapshot.overridden as any).add).toBeUndefined();
  const before = repo.snapshot;
  await expect(
    repo.reload({ models: async () => [{ source: "broken", model: {} }] }),
  ).rejects.toThrow();
  expect(repo.snapshot).toBe(before);
});
it("connect, scan and explicit sync share one capability policy", async () => {
  const repo = new ModelRepository();
  await repo.reload({
    models: async () => [{ source: "base", model: source }],
  });
  const request = vi.fn(async (op: number) => {
    if (op === OP.MODEL_GET) return { id: source.id, crc: 0 };
    return { token: 1 };
  });
  const info = { catalog_api: 2, catalog_generation: 7 } as Info;
  expect(
    await syncModelRepository(request, info, repo.snapshot, "connect"),
  ).toBe(false);
  expect(await syncModelRepository(request, info, repo.snapshot, "scan")).toBe(
    false,
  );
  expect(request).not.toHaveBeenCalled();
  await expect(
    syncModelRepository(request, {} as Info, repo.snapshot, "explicit"),
  ).rejects.toThrow("更新固件");
  await syncModelRepository(
    request,
    { model_api: 1, model_capacity: 1 } as Info,
    repo.snapshot,
    "explicit",
  );
  expect(request.mock.calls.some(([op]) => op === OP.MODEL_COMMIT)).toBe(true);
});

it("explicit onboarding configuration overrides family defaults in either direction",async()=>{
 const {keyConfirmation}=await import("../src/core/voice-protocols");
 expect(keyConfirmation({family:2})).toBe("required");
 expect(keyConfirmation({family:1})).toBe("skip");
 expect(keyConfirmation({family:2,onboarding:{keyConfirmation:"skip"}})).toBe("skip");
 expect(keyConfirmation({family:1,onboarding:{keyConfirmation:"required"}})).toBe("required");
});

// Check intended product behavior, not just agreement between potentially stale copies.
it("every bundled model retains the agreed navigation defaults", async () => {
  const { bundledCatalog } = await import("../src/bundled-models");
  const { resolveCatalog } = await import("../src/core/catalog");
  const expected: Record<string, number[]> = {
    返回: [1, 0, 42], 主页: [4, 0, 65534], 菜单: [4, 0, 65535],
  };
  for (const { model } of resolveCatalog(bundledCatalog().resources)) {
    for (const key of model.keys) {
      if (expected[key.label]) expect(key.default, `${model.id}: ${key.label}`).toEqual(expected[key.label]);
    }
  }
});

it("same named factory keys share defaults across the entire catalog and standard palette", async () => {
  const { bundledCatalog } = await import("../src/bundled-models");
  const { resolveCatalog } = await import("../src/core/catalog");
  const { default: standards } = await import("../resources/standard-keys.json");
  const byName = new Map(standards.keys.map(k => [k.label, { value: k.default, source: "standard palette" }]));
  for (const { model } of resolveCatalog(bundledCatalog().resources)) {
    for (const key of model.keys) {
      const previous = byName.get(key.label);
      if (previous) expect(key.default, `${key.label}: ${previous.source} vs ${model.id}`).toEqual(previous.value);
      else byName.set(key.label, { value: key.default, source: model.id });
    }
  }
});
