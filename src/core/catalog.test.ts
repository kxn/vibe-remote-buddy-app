import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";
import {
  compileCatalog,
  mergeCatalogCopies,
  matchingArtwork,
  resolveCatalog,
  packModel,
  type CatalogModel,
} from "./catalog";
import { crc32c } from "./wire";
function fixture() {
  const root = resolve("resources/catalog");
  const index = JSON.parse(readFileSync(join(root, "catalog.json"), "utf8"));
  return resolveCatalog(
    index.resources.map((r: any) =>
      JSON.parse(readFileSync(join(root, r.path), "utf8")),
    ),
  );
}
describe("board catalog", () => {
  it("resolves the captured library without conflating related keymaps", () => {
    const models = fixture();
    expect(models.length).toBe(4);
    const unicom = models.find((m) => m.model.id === "unicom.sample-28")!,
      cmcc = models.find((m) => m.model.id === "cmcc.sample-28")!;
    expect(unicom.model.family).toBe(cmcc.model.family);
    expect(unicom.model.layout).toEqual(cmcc.model.layout);
    expect(unicom.model.raw).not.toEqual(cmcc.model.raw);
    expect(unicom.model.keys.find((k) => k.id === 8)?.default).toEqual([
      1, 0, 42,
    ]);
    for (const m of models)
      expect(packModel(m.model).length).toBeLessThan(2048);
  });
  it("keeps Xiaomi HID voice triggers and operator F8 voice events distinct", () => {
    const models = fixture();
    for (const id of ["xiaomi.rc003", "xiaomi.legacy-32ba"]) {
      const m = models.find(m => m.model.id === id)!.model;
      expect(m.raw).toContainEqual({ report: 1, usage: 62, key: 2 });
      expect(m.raw).toHaveLength(m.keys.length);
    }
    for (const id of ["unicom.sample-28", "cmcc.sample-28"]) {
      const m = models.find(m => m.model.id === id)!.model;
      expect(m.raw).toHaveLength(27);
      expect(m.raw.some(k => k.key === 2)).toBe(false);
      expect(m.keys).toHaveLength(28);
    }
  });
  it("compiles 1024 models with bounded indexes and validates a header-covering checksum", () => {
    const base = fixture();
    const models: CatalogModel[] = Array.from({ length: 1024 }, (_, i) => ({
      ...base[i % 4],
      model: { ...base[i % 4].model, id: `scale.model-${i}` },
    }));
    const image = compileCatalog(models, 42),
      view = new DataView(image.bytes.buffer);
    expect(image.indexBytes).toBeLessThan(64 * 1024);
    expect(image.bytes.length).toBeLessThan(1536 * 1024);
    expect(view.getUint32(20, true)).toBe(1024);
    const copy = image.bytes.slice(),
      expected = view.getUint32(48, true);
    new DataView(copy.buffer).setUint32(48, 0, true);
    expect(crc32c(copy)).toBe(expected);
    expect(compileCatalog(models.reverse(), 42).bytes).toEqual(image.bytes);
  });
  it("accepts the 4096-entry boundary with compact models and rejects bad identity evidence", () => {
    const base = fixture()[0];
    const tiny = {
      ...base.model,
      keys: base.model.keys.filter((k) => k.id === 2),
      raw: base.model.raw.filter((k) => k.key === 2),
    };
    const all = Array.from({ length: 4096 }, (_, i) => ({
      ...base,
      model: { ...tiny, id: `boundary.${i}` },
    }));
    const result = compileCatalog(all, 1);
    expect(result.count).toBe(4096);
    expect(result.bytes.length).toBeLessThan(1536 * 1024);
    const invalid = structuredClone(base);
    invalid.fingerprints[0].required.report_map.crc32c = "00000000";
    expect(() => compileCatalog([invalid], 1)).toThrow("摘要");
  });
  it("rejects duplicate identities and overflowing counts", () => {
    const m = fixture()[0];
    expect(() => compileCatalog([m, m], 1)).toThrow("重复");
    expect(() => compileCatalog(Array(4097).fill(m), 1)).toThrow("条目");
    expect(() => compileCatalog([m], 0)).toThrow("代次");
  });
  it("compiles measured unassigned PnP sources and still bounds the u8 field", () => {
    const base = fixture()[0];
    const withSource = (source: number) => {
      const m = structuredClone(base);
      m.fingerprints[0].required.pnp = { source, vendor: 1046, product: 768 };
      return m;
    };
    expect(compileCatalog([withSource(5)], 1).count).toBe(1);
    expect(compileCatalog([withSource(255)], 1).count).toBe(1);
    expect(() => compileCatalog([withSource(256)], 1)).toThrow("PnP");
  });
});

it("preserves shipped artwork only for unchanged public geometry", () => {
  const model = fixture().find((m) => m.model.id === "xiaomi.rc003")!.model;
  const original = JSON.parse(
    readFileSync("resources/remotes/xiaomi.rc003/model.json", "utf8"),
  );
  expect(matchingArtwork(model, { model: original, image: "svg" })).toBe("svg");
  const changed = structuredClone(model);
  changed.layout.buttons[0].x++;
  expect(
    matchingArtwork(changed, { model: original, image: "svg" }),
  ).toBeUndefined();
});


describe("migrated catalog copies", () => {
  it("publishes four canonical models when an old CMCC copy is still present", () => {
    const base = fixture();
    const cmcc = base.find(m => m.model.id === "cmcc.sample-28")!;
    const local = structuredClone(cmcc);
    local.model.id = "remote.old-copy";
    for (const f of local.fingerprints) {
      delete f.required.report_map.sha256;
      delete f.required.report_map.length;
      f.required.services.reverse(); f.required.reports.reverse();
    }
    const result = mergeCatalogCopies([...base, local], new Set(base.map(m => m.model.id)));
    expect(result.map(m => m.model.id)).toEqual(base.map(m => m.model.id));
    expect(compileCatalog(result, 1).count).toBe(4);
    expect(local.model.id).toBe("remote.old-copy");
  });
  it("preserves explicit personal edits under the canonical identity", () => {
    const base=fixture(), local=structuredClone(base[0]);local.model.id="remote.edited";
    local.model.keys[0].label="My label";
    const result=mergeCatalogCopies([...base,local],new Set(base.map(m=>m.model.id)),new Set([local.model.id]));
    expect(result).toHaveLength(4);expect(result[0].model.keys[0].label).toBe("My label");
    expect(base[0].model.keys[0].label).not.toBe("My label");
  });
  it("never merges a different map, PnP identity or physical key mapping", () => {
    for(const change of [
      (m:CatalogModel)=>{m.fingerprints[0].required.report_map.hex += "00"},
      (m:CatalogModel)=>{m.fingerprints[0].required.pnp={source:1,vendor:1,product:2}},
      (m:CatalogModel)=>{m.model.raw[0].usage += 1},
    ]) {
      const base=fixture(),local=structuredClone(base[0]);local.model.id="remote.other";change(local);
      expect(mergeCatalogCopies([...base,local],new Set(base.map(m=>m.model.id)))).toHaveLength(5);
    }
  });
});
