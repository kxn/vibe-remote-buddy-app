import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolveCatalog } from "./catalog";
import {
  modelCandidates,
  inputShapes,
  KeyConfirmation,
  scanKnown,
} from "./onboarding";
import { makeOverride, applyOverride } from "./model-overrides";
import type { ProbeAttribute, ProbeCandidate, ProbeReport } from "./probe";
const root = "resources/catalog/";
const catalog = resolveCatalog(
  JSON.parse(readFileSync(root + "catalog.json", "utf8")).resources.map(
    (r: any) => JSON.parse(readFileSync(root + r.path, "utf8")),
  ),
);
function fixture(family: number) {
  const entry = catalog.find((m) => m.model.family === family)!;
  const r = entry.fingerprints[0].required;
  const attrs: ProbeAttribute[] = [];
  const add = (
    uuid: string,
    kind: number,
    hex = "",
    properties = 0,
    parent = 0,
  ) => {
    const handle = attrs.length + 1;
    const a = {
      index: attrs.length,
      uuid,
      kind,
      hex,
      properties,
      parent,
      handle,
      end: 255,
      length: hex.length / 2,
      complete: true,
    };
    attrs.push(a);
    return handle;
  };
  for (const uuid of r.services) add(uuid, 1);
  add("0x2a4b", 2, r.report_map.hex);
  const p = r.pnp;
  const b = [
    p?.source ?? 1,
    p?.vendor ?? 0,
    (p?.vendor ?? 0) >> 8,
    p?.product ?? 0,
    (p?.product ?? 0) >> 8,
    p?.version ?? 0,
    (p?.version ?? 0) >> 8,
  ];
  add(
    "0x2a50",
    2,
    b.map((x) => (x & 255).toString(16).padStart(2, "0")).join(""),
  );
  for (const ref of r.reports) {
    const h = add(
      "0x2a4d",
      2,
      "",
      ref.type === 2 || (ref.id === 4 && family === 3) ? 12 : 16,
    );
    add(
      "0x2908",
      3,
      ref.id.toString(16).padStart(2, "0") +
        ref.type.toString(16).padStart(2, "0"),
      0,
      h,
    );
  }
  if (family === 1)
    for (const n of [2, 3, 4])
      add(`ab5e000${n}-5a21-4f05-bc7d-af01f617b664`, 2, "", n === 2 ? 12 : 16);
  return { entry, attrs };
}
describe("unified onboarding", () => {
  it("ranks measured models and keeps protocol families separate", () => {
    for (const family of [1, 2, 3]) {
      const { entry, attrs } = fixture(family);
      const results = modelCandidates(attrs, catalog);
      expect(
        results.some(
          (c) =>
            c.model.id === entry.model.id && c.match === "exact" && !c.variant,
        ),
        `family ${family} ${JSON.stringify(results)}`,
      ).toBe(true);
      expect(results.every((c) => c.model.family === family)).toBe(true);
    }
  });
  it("rejects missing transport properties and incomplete identity", () => {
    const { attrs } = fixture(1);
    attrs.find((a) => a.uuid.startsWith("ab5e0002"))!.properties = 2;
    expect(modelCandidates(attrs, catalog)).toEqual([]);
    attrs.find((a) => a.uuid === "0x2a4b")!.complete = false;
    expect(() => modelCandidates(attrs, catalog)).toThrow("未读完整");
  });
  it("allows non-input Map differences as verified templates, never direct binding", () => {
    const { attrs } = fixture(2);
    const a = attrs.find((a) => a.uuid === "0x2a4b")!;
    a.hex += "0501857e750895019102";
    a.length = a.hex.length / 2;
    const candidates = modelCandidates(attrs, catalog);
    expect(candidates.length).toBeGreaterThan(0);
    expect(
      candidates.every(
        (c) => c.match === "compatible" && c.variant && c.confirmKeys,
      ),
    ).toBe(true);
  });
  it("changed PnP cannot reuse a binding fingerprint even when the Map matches", () => {
    const { attrs } = fixture(3);
    attrs.find((a) => a.uuid === "0x2a50")!.hex = "01010002000000";
    expect(
      modelCandidates(attrs, catalog).every((c) => c.variant && c.confirmKeys),
    ).toBe(true);
  });
  it("distinguishes bit layout changes instead of comparing similar bytes", () => {
    expect(inputShapes("05078501750895018100").get(1)).not.toEqual(
      inputShapes("05078501750495018100").get(1),
    );
  });
  it("scan admission does not treat the name as final identity", () => {
    const { entry } = fixture(3);
    expect(
      scanKnown(
        { name: entry.model.matches[0].name, company: 999 } as ProbeCandidate,
        [entry.model],
      ),
    ).toBe(true);
  });
  it("requires a matching press/release and ignores duplicates or release-only reports", () => {
    const { entry, attrs } = fixture(2),
      check = new KeyConfirmation(entry.model),
      raw = entry.model.raw.find((r) => r.report === 1)!;
    const ref = attrs.find((a) => a.uuid === "0x2908" && a.hex === "0101")!;
    const report = (usage: number, lost = 0) =>
      ({
        handle: ref.parent,
        length: 8,
        hex: `0000${usage.toString(16).padStart(2, "0")}0000000000`,
        lost,
      }) as ProbeReport;
    check.accept(report(0), attrs);
    expect(check.verified.size).toBe(0);
    check.accept(report(raw.usage), attrs);
    expect(check.verified.size).toBe(0);
    check.accept(report(0), attrs);
    expect([...check.verified]).toEqual([raw.key]);
    check.accept(report(raw.usage), attrs);
    check.accept(report(0, 1), attrs);
    expect(check.verified.size).toBe(1);
  });
  it("recognizes the dedicated ICO voice release without recording audio", () => {
    const { entry, attrs } = fixture(2),
      check = new KeyConfirmation(entry.model),
      ref = attrs.find((a) => a.hex === "f801")!;
    const report = (n: number) =>
      ({
        handle: ref.parent,
        length: 20,
        hex: `82030${n}` + "00".repeat(17),
        lost: 0,
      }) as ProbeReport;
    check.accept(report(1), attrs);
    expect(check.verified.size).toBe(0);
    check.accept(report(0), attrs);
    expect(check.verified.has(2)).toBe(true);
  });
});
describe("local defaults are independent of identity and bindings", () => {
  it("overlays editable defaults without changing the base or fingerprint", () => {
    const base = catalog[0].model,
      draft = structuredClone(base);
    draft.title = "Local";
    draft.keys[0].label = "Mine";
    const o = makeOverride(base, draft),
      m = applyOverride(base, o);
    expect(m.title).toBe("Local");
    expect(base.title).not.toBe("Local");
    expect(m.raw).toEqual(base.raw);
    expect(m.map_crc).toEqual(base.map_crc);
  });
  it("rejects identity changes and preserves new keys from library updates", () => {
    const base = catalog[0].model,
      draft = structuredClone(base);
    draft.raw[0].usage++;
    expect(() => makeOverride(base, draft)).toThrow("指纹");
    const o = makeOverride(base, base),
      next = structuredClone(base);
    next.keys.push({ id: 63, label: "New", default: [0, 0, 0] });
    next.layout.buttons.push({ ...next.layout.buttons[0], key: 63, cell: undefined });
    expect(applyOverride(next, o).keys.at(-1)?.label).toBe("New");
  });
});
