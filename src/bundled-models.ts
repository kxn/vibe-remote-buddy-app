import type { ModelSource } from "./core/models";
import type { CatalogSnapshot } from "./core/catalog";
const packages = import.meta.glob("../resources/remotes/*/model.json", {
  eager: true,
  import: "default",
});
const artwork = import.meta.glob<string>("../resources/remotes/*/*.svg", {
  eager: true,
  query: "?raw",
  import: "default",
});
export function bundledModelSources(): ModelSource[] {
  return Object.entries(packages).map(([source, model]) => ({
    source,
    model,
    image:
      artwork[
        source.replace("model.json", (model as any).layout?.artwork ?? "")
      ],
  }));
}
export function bundledCatalog(): CatalogSnapshot {
  return structuredClone(__BUNDLED_CATALOG__);
}
