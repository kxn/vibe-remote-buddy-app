import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { compileCatalog, resolveCatalog, packModel, type CatalogModel } from "./catalog";
import { crc32c } from "./wire";
function fixture() {
  const root = resolve("resources/catalog");
  const index = JSON.parse(readFileSync(join(root, "catalog.json"), "utf8"));
  return resolveCatalog(index.resources.map((r: any) => JSON.parse(readFileSync(join(root, r.path), "utf8"))));
}
describe("board catalog", () => {
  it("resolves the captured library without conflating related keymaps", () => {
    const models = fixture(); expect(models.length).toBe(4);
    const unicom = models.find(m => m.model.id === "unicom.sample-28")!, cmcc = models.find(m => m.model.id === "cmcc.sample-28")!;
    expect(unicom.model.family).toBe(cmcc.model.family);
    expect(unicom.model.layout).toEqual(cmcc.model.layout);
    expect(unicom.model.raw).not.toEqual(cmcc.model.raw);
    expect(unicom.model.keys.find(k => k.id === 8)?.default).toEqual([1, 0, 42]);
    for (const m of models) expect(packModel(m.model).length).toBeLessThan(2048);
  });
  it("compiles 1024 models with bounded indexes and validates a header-covering checksum", () => {
    const base = fixture();
    const models: CatalogModel[] = Array.from({ length: 1024 }, (_, i) => ({ ...base[i % 4], model: { ...base[i % 4].model, id: `scale.model-${i}` } }));
    const image = compileCatalog(models, 42), view = new DataView(image.bytes.buffer);
    expect(image.indexBytes).toBeLessThan(64 * 1024);
    expect(image.bytes.length).toBeLessThan(1536 * 1024);
    expect(view.getUint32(20, true)).toBe(1024);
    const copy = image.bytes.slice(), expected = view.getUint32(48, true); new DataView(copy.buffer).setUint32(48, 0, true);
    expect(crc32c(copy)).toBe(expected);
    expect(compileCatalog(models.reverse(), 42).bytes).toEqual(image.bytes);
  });
  it("rejects duplicate identities and overflowing counts", () => {
    const m = fixture()[0]; expect(() => compileCatalog([m, m], 1)).toThrow("重复");
    expect(() => compileCatalog(Array(4097).fill(m), 1)).toThrow("条目");
    expect(() => compileCatalog([m], 0)).toThrow("代次");
  });
});
