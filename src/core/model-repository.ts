import {
  loadModels,
  validateModel,
  type RemoteModel,
  type ModelSource,
} from "./models";
import {
  resolveCatalog,
  matchingArtwork,
  mergeCatalogCopies,
  type CatalogModel,
  type CatalogSnapshot,
  uploadCatalog,
} from "./catalog";
import {
  applyOverride,
  applyEditedModel,
  type ModelOverride,
} from "./model-overrides";
import { syncModels } from "./models";
import type { Info } from "./types";
export interface ModelSnapshot {
  readonly models: ReadonlyMap<string, RemoteModel>;
  readonly origins: ReadonlyMap<string, string>;
  readonly catalog: CatalogModel[];
  readonly aliases: ReadonlyMap<string, string>;
  readonly overridden: ReadonlySet<string>;
  readonly version: string;
}
export interface ModelSourceProvider {
  models?: () => Promise<ModelSource[]>;
  catalog?: () => Promise<CatalogSnapshot>;
  overrides?: () => Promise<ModelOverride[]>;
}
function compose(
  sources: ModelSource[],
  current: CatalogSnapshot | undefined,
  overrides: ModelOverride[],
): ModelSnapshot {
  const resolved = current ? resolveCatalog(current.resources) : [];
  const defaults = new Map(resolved.map((m) => [m.model.id, m]));
  const local = sources.filter(
    (s) => !defaults.has((s.model as any)?.id) || s.edited,
  );
  const models = new Map<string, RemoteModel>();
  const origins = new Map<string, string>();
  const aliases = new Map<string, string>();
  const overridden = new Set<string>();
  const errors = loadModels(
    [
      ...resolved.map((m) => ({
        source: "catalog",
        model: m.model,
        image: matchingArtwork(
          m.model,
          sources.find((s) => (s.model as any)?.id === m.model.id),
        ),
      })),
      ...local.filter((s) => !defaults.has((s.model as any)?.id)),
    ],
    models,
    origins,
  );
  if (errors.length) throw Error(errors.join("\n"));
  // A locally edited model is a private default definition; the official
  // resource graph remains immutable and does not acquire personal changes.
  for (const s of local.filter((s) => defaults.has((s.model as any)?.id)))
    models.set(
      (s.model as any).id,
      applyEditedModel(
        { ...defaults.get((s.model as any).id)!.model, image: s.image },
        validateModel(s.model),
      ),
    );
  let catalogModels = [...models.values()].map((model) => {
    const official = defaults.get(model.id);
    if (official) return { ...official, model };
    const source = local.find((s) => (s.model as any)?.id === model.id);
    const attrs = source?.evidence?.attributes ?? [];
    const map = attrs.find(
      (a: any) => a.complete && /^(?:0x)?2a4b$/i.test(a.uuid),
    );
    const required: Record<string, any> = map
      ? {
          report_map: {
            hex: map.hex.toLowerCase(),
            length: map.hex.length / 2,
            crc32c: model.map_crc.toString(16).padStart(8, "0"),
          },
        }
      : {};
    if (map) {
      required.services = attrs
        .filter((a: any) => a.kind === 1)
        .map((a: any) => a.uuid.toLowerCase());
      const pnp = attrs.find(
        (a: any) =>
          a.complete && /^(?:0x)?2a50$/i.test(a.uuid) && a.hex.length === 14,
      );
      if (pnp) {
        const b = Uint8Array.from(pnp.hex.match(/../g), (h: any) =>
          parseInt(h, 16),
        );
        required.pnp = {
          source: b[0],
          vendor: b[1] | (b[2] << 8),
          product: b[3] | (b[4] << 8),
        };
      }
      required.reports = attrs
        .filter(
          (a: any) =>
            a.complete && /^(?:0x)?2908$/i.test(a.uuid) && a.hex.length === 4,
        )
        .map((a: any) => ({
          id: parseInt(a.hex.slice(0, 2), 16),
          type: parseInt(a.hex.slice(2), 16),
        }));
    }
    const fingerprints = map
      ? [{ model: model.id, scan_hints: model.matches, required }]
      : [];
    return {
      model,
      fingerprints,
      buttons: model.keys.map((k) => ({
        id: `b${k.id.toString().padStart(2, "0")}`,
        key: k.id,
        semantic: k.id === 2 ? "voice" : "custom",
      })),
    };
  });
  catalogModels = mergeCatalogCopies(
    catalogModels,
    new Set(defaults.keys()),
    new Set(local.filter((s) => s.edited).map((s) => (s.model as any).id)),
    aliases,
  );
  // Keep legacy IDs available to render existing binding snapshots, while
  // publishing only canonical identities to discovery and the board catalog.
  for (const entry of catalogModels) models.set(entry.model.id, entry.model);
  for (const override of overrides) {
    const entry = catalogModels.find((e) => e.model.id === override.id);
    if (!entry) continue;
    entry.model = applyOverride(entry.model, override);
    models.set(entry.model.id, entry.model);
    overridden.add(entry.model.id);
  }

  return {
    models,
    origins,
    catalog: catalogModels,
    aliases,
    overridden,
    version: current?.version ?? "",
  };
}
function freezeSnapshot<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    if (value instanceof Map) {
      for (const item of value.values()) freezeSnapshot(item);
      return Object.freeze(view(() => value)) as T;
    }
    if (value instanceof Set) {
      const readonly: ReadonlySet<unknown> = {
        size: value.size,
        has: (k) => value.has(k),
        entries: () => value.entries(),
        keys: () => value.keys(),
        values: () => value.values(),
        forEach: (f, t) => value.forEach((v) => f.call(t, v, v, readonly)),
        [Symbol.iterator]: () => value[Symbol.iterator](),
      };
      return Object.freeze(readonly) as T;
    }
    for (const [key, item] of Object.entries(value))
      (value as Record<string, unknown>)[key] = freezeSnapshot(item);
    Object.freeze(value);
  }
  return value;
}
const empty = (): ModelSnapshot => ({
  models: new Map(),
  origins: new Map(),
  catalog: [],
  aliases: new Map(),
  overridden: new Set(),
  version: "",
});
export class ModelRepository {
  private state = freezeSnapshot(empty());
  private tail: Promise<unknown> = Promise.resolve();
  get snapshot() {
    return this.state;
  }
  // Serialize complete source reads: an older reload cannot overwrite a newer one.
  reload(provider: ModelSourceProvider): Promise<void> {
    const job = this.tail.then(async () => {
      const [sources, current, overrides] = await Promise.all([
        provider.models?.() ?? [],
        provider.catalog?.(),
        provider.overrides?.() ?? [],
      ]);
      const next = compose(sources, current, overrides);
      this.state = freezeSnapshot(structuredClone(next));
    });
    this.tail = job.catch(() => {});
    return job;
  }
}
export const modelRepository = new ModelRepository();
// Read-only live views preserve existing UI imports without another mutable store.
function view<K, V>(get: () => ReadonlyMap<K, V>): ReadonlyMap<K, V> {
  return {
    get size() {
      return get().size;
    },
    get: (k) => get().get(k),
    has: (k) => get().has(k),
    entries: () => get().entries(),
    keys: () => get().keys(),
    values: () => get().values(),
    forEach: (f, t) => get().forEach((v, k) => f.call(t, v, k, view(get))),
    [Symbol.iterator]: () => get()[Symbol.iterator](),
  };
}
export const remoteModels = view(() => modelRepository.snapshot.models);
export const modelOrigins = view(() => modelRepository.snapshot.origins);
export type SyncIntent = "connect" | "scan" | "explicit";
/** One capability boundary. Legacy transfer only serializes the same published models. */
export async function syncModelRepository(
  request: (op: number, body?: Record<string, unknown>) => Promise<any>,
  info: Info,
  snapshot: ModelSnapshot,
  intent: SyncIntent,
) {
  if (!snapshot.models.size) return false;
  if (info.catalog_api === 2) {
    if (intent !== "explicit" && info.catalog_generation) return false;
    await uploadCatalog(request, snapshot.catalog);
    return true;
  }
  if (info.model_api === 1) {
    await syncModels(request, info.model_capacity ?? 16, snapshot.models);
    return true;
  }
  throw Error("接收器固件不支持外部型号，请先更新固件");
}
