import { crc32c } from "./wire";
import { validateModel, type RemoteModel } from "./models";
import { OP } from "./session";

export const CATALOG_API = 2;
export const CATALOG_FORMAT = 1;
export const CATALOG_MAX_MODELS = 4096;
export const CATALOG_MAX_BYTES = 1536 * 1024;
type Resource = Record<string, any>;
export interface CatalogModel {
  model: RemoteModel;
  fingerprints: Resource[];
  buttons: { id: string; semantic: string; key: number }[];
}
export interface CatalogSnapshot {
  commit: string;
  version: string;
  resources: Resource[];
}
const utf8 = new TextEncoder();
function check(ok: unknown, reason: string): asserts ok {
  if (!ok) throw Error(reason);
}
function action(a: Resource): [number, number, number] {
  switch (a.type) {
    case "none":
      return [0, 0, 0];
    case "keyboard":
      return [1, a.modifiers, a.usage];
    case "voice-shortcut":
      return [3, a.modifiers, a.usage];
    case "media": {
      const n = [
        "volume-up",
        "volume-down",
        "mute",
        "play-pause",
        "next",
        "previous",
        "stop",
        "browser-home",
      ].indexOf(a.command);
      check(n >= 0, "未知媒体动作");
      return [2, 0, n];
    }
    case "app":
      check(["task-view", "window-picker"].includes(a.command), "未知软件动作");
      return [4, 0, a.command === "task-view" ? 65534 : 65535];
    case "voice-preset":
      check(
        ["doubao", "wechat", "video-meeting"].includes(a.preset),
        "未知语音预设",
      );
      return a.preset === "video-meeting"
        ? [3, 0, 44]
        : [5, 0, a.preset === "doubao" ? 1 : 2];
    default:
      throw Error("未知默认动作");
  }
}
/** Resolve a complete immutable resource graph. Names never establish identity. */
export function resolveCatalog(resources: Resource[]): CatalogModel[] {
  const graph = new Map<string, Resource>();
  for (const r of resources) {
    check(
      r.format_version === 2 &&
        typeof r.id === "string" &&
        Number.isInteger(r.revision) &&
        r.revision > 0,
      "不支持的机型库格式",
    );
    const id = `${r.kind}/${r.id}`;
    check(!graph.has(id), "机型库包含重复 ID");
    graph.set(id, r);
  }
  const get = (kind: string, id: string) => {
    const r = graph.get(`${kind}/${id}`);
    check(r, `机型库缺少 ${kind}/${id}`);
    return r;
  };
  return resources
    .filter((r) => r.kind === "model")
    .map((m) => {
      const p = get("protocol", m.protocol),
        k = get("keymap", m.keymap),
        d = get("defaults", m.defaults),
        l = get("layout", m.layout);
      check(
        p.driver_api === 1 && p.sample_rate === 16000,
        "不支持的语音协议版本",
      );
      const family = (
        { atvv: 1, "hid-ico": 2, "xiaomi-hid-msbc": 3 } as Record<
          string,
          number
        >
      )[p.driver];
      check(family, "接收器不支持此协议");
      const used = new Set<number>();
      const buttons = m.buttons.map((b: Resource) => {
        // Wire IDs are part of the persistent binding ABI. Never renumber them
        // from array order when a later library revision inserts a new button.
        const n = /^b\d\d$/.test(b.id) ? Number(b.id.slice(1)) : b.wire_id;
        check(
          Number.isInteger(n) &&
            n > 0 &&
            n <= 63 &&
            !used.has(n) &&
            (n === 2) === (b.semantic === "voice"),
          "按键需要唯一且固定的 wire_id（1–63，语音为 2）",
        );
        used.add(n);
        return { id: String(b.id), semantic: String(b.semantic), key: n };
      });
      check(
        new Set(buttons.map((b: { id: string }) => b.id)).size ===
          buttons.length,
        "重复按键 ID",
      );
      const key = (id: string) => {
        const b = buttons.find((b: { id: string }) => b.id === id);
        check(b, "引用了不存在的按键");
        return b.key;
      };
      const fps = resources.filter(
        (r) => r.kind === "fingerprint" && r.model === m.id,
      );
      check(fps.length && fps.length <= 8, "机型缺少识别指纹");
      const matches = fps
        .flatMap((f) => f.scan_hints)
        .filter(
          (v, i, a) =>
            a.findIndex((x) => JSON.stringify(x) === JSON.stringify(v)) === i,
        );
      const model = validateModel({
        schema: 1,
        id: m.id,
        title: m.title,
        revision: Math.max(
          m.revision,
          p.revision,
          k.revision,
          d.revision,
          l.revision,
          ...fps.map((f) => f.revision),
        ),
        family,
        matches,
        map_crc: Number.parseInt(fps[0].required.report_map.crc32c, 16),
        keys: buttons.map((b: { id: string; key: number }) => {
          const value = d.buttons[b.id];
          check(value, "机型缺少默认按键");
          return {
            id: b.key,
            label: value.label,
            default: action(value.action),
          };
        }),
        raw: k.entries.map((e: Resource) => ({
          report: e.report_id,
          usage: e.usage,
          key: key(e.button),
        })),
        layout: {
          ...l.geometry,
          buttons: l.geometry.buttons.map((b: Resource) => {
            const { button, ...geometry } = b;
            return { ...geometry, key: key(button) };
          }),
        },
      });
      return { model, fingerprints: fps, buttons };
    });
}

/** Collapse migrated local copies only when full identity AND wire keys agree.
 * Labels/default actions/layout are personal data, never device identity. */
export function mergeCatalogCopies(
  models: CatalogModel[], officialIds: Set<string>, editedIds = new Set<string>(),
): CatalogModel[] {
  const sorted = (values: unknown[]) => [...new Set(values.map(v => JSON.stringify(v)))].sort();
  const identity = (m: CatalogModel) => m.fingerprints.length ? JSON.stringify({
    family: m.model.family,
    raw: sorted(m.model.raw.map(r => [r.report, r.usage, r.key])),
    fingerprints: sorted(m.fingerprints.map(f => {
      const r = f.required;
      return {
        map: r.report_map?.hex?.toLowerCase(),
        pnp: Object.entries(r.pnp ?? {}).sort(([a], [b]) => a.localeCompare(b)),
        services: sorted(r.services ?? []),
        reports: sorted((r.reports ?? []).map((v: any) => [v.id, v.type])),
      };
    })),
  }) : undefined;
  const official = models.filter(m => officialIds.has(m.model.id));
  const replacements = new Map<string, CatalogModel>();
  const aliases = new Set<string>();
  for (const local of models.filter(m => !officialIds.has(m.model.id))) {
    const id = identity(local);
    const matches = id ? official.filter(m => identity(m) === id) : [];
    if (matches.length !== 1) continue;
    const canonical = matches[0];
    if (editedIds.has(local.model.id)) {
      if (editedIds.has(canonical.model.id) || replacements.has(canonical.model.id))
        throw Error("同一机型存在多份个人修改，请在机型管理中合并");
      replacements.set(canonical.model.id, {
        ...canonical,
        model: { ...local.model, id: canonical.model.id },
      });
    }
    aliases.add(local.model.id);
  }
  return models.filter(m => !aliases.has(m.model.id))
    .map(m => replacements.get(m.model.id) ?? m);
}

class Bytes {
  data: number[] = [];
  put(n: number, width: number) {
    for (let i = 0; i < width; i++) this.data.push((n >>> (i * 8)) & 255);
  }
  string(s: string) {
    const b = utf8.encode(s);
    check(b.length < 48, "板端字符串过长");
    this.put(b.length, 1);
    this.data.push(...b);
  }
  result() {
    return Uint8Array.from(this.data);
  }
}
export function packModel(m: RemoteModel): Uint8Array {
  const w = new Bytes();
  w.put(2, 1);
  w.put(m.family, 1);
  w.put(m.revision, 4);
  w.put(m.map_crc, 4);
  w.string(m.id);
  w.put(m.matches.length, 1);
  w.put(m.keys.length, 1);
  w.put(m.raw.length, 1);
  for (const h of m.matches) {
    w.string(h.name ?? "");
    w.string(h.prefix ?? "");
    w.put(h.company ?? 0xffffffff, 4);
  }
  for (const k of m.keys) {
    w.put(k.id, 1);
    w.put(k.default[0], 1);
    w.put(k.default[1], 1);
    w.put(k.default[2], 2);
    w.string(k.label);
  }
  for (const k of m.raw) {
    w.put(k.report, 1);
    w.put(k.usage, 2);
    w.put(k.key, 1);
  }
  return w.result();
}
export interface CompiledCatalog {
  bytes: Uint8Array;
  count: number;
  indexBytes: number;
  generation: number;
}
/** VRBC/1: 64-byte header, 16-byte model directory, two 12-byte lookup
 * indexes, then interned objects. Digest matches always require full comparison. */
export function compileCatalog(
  models: CatalogModel[],
  generation: number,
): CompiledCatalog {
  check(
    Number.isInteger(generation) && generation > 0 && generation <= 0xffffffff,
    "无效机型库代次",
  );
  check(models.length <= CATALOG_MAX_MODELS, "机型库条目过多");
  check(
    new Set(models.map((m) => m.model.id)).size === models.length,
    "重复机型 ID",
  );
  const sorted = [...models].sort(
    (a, b) =>
      crc32c(utf8.encode(a.model.id)) - crc32c(utf8.encode(b.model.id)) ||
      a.model.id.localeCompare(b.model.id),
  );
  const fingerprints: { hash: number; model: number; data: Uint8Array }[] = [],
    hints: typeof fingerprints = [];
  sorted.forEach((m, index) => {
    for (const fp of m.fingerprints) {
      check(
        fp.required &&
          Object.keys(fp.required).every((k) =>
            ["report_map", "pnp", "services", "reports"].includes(k),
          ),
        "不支持的识别条件",
      );
      const required = fp.required;
      if (required.services)
        check(
          Array.isArray(required.services) &&
            required.services.length <= 32 &&
            required.services.every(
              (u: any) =>
                typeof u === "string" &&
                /^(?:0x[0-9a-f]{4}|[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12})$/.test(
                  u,
                ),
            ),
          "服务指纹无效",
        );
      if (required.pnp)
        check(
          Object.entries(required.pnp).every(
            ([k, v]) =>
              ["source", "vendor", "product", "version"].includes(k) &&
              Number.isInteger(v) &&
              Number(v) >= 0 &&
              Number(v) <= (k === "source" ? 2 : 65535),
          ),
          "PnP 指纹无效",
        );
      if (required.reports)
        check(
          Array.isArray(required.reports) &&
            required.reports.length <= 32 &&
            required.reports.every(
              (r: any) =>
                Number.isInteger(r.id) &&
                r.id >= 0 &&
                r.id <= 255 &&
                [1, 2, 3].includes(r.type),
            ),
          "Report 指纹无效",
        );
      const map = required.report_map;
      check(
        map &&
          typeof map.hex === "string" &&
          /^(?:[0-9a-f]{2})+$/.test(map.hex) &&
          map.hex.length <= 8192,
        "机型缺少完整 Report Map",
      );
      const raw = Uint8Array.from(map.hex.match(/../g)!, (h: string) =>
        Number.parseInt(h, 16),
      );
      check(
        map.length === raw.length &&
          /^[0-9a-f]{8}$/.test(map.crc32c) &&
          crc32c(raw) === Number.parseInt(map.crc32c, 16),
        "Report Map 摘要不一致",
      );
      check(
        Array.isArray(fp.scan_hints) && fp.scan_hints.length <= 8,
        "机型广播提示无效",
      );
      for (const h of fp.scan_hints)
        check(
          h &&
            (typeof h.name === "string") !== (typeof h.prefix === "string") &&
            utf8.encode(h.name ?? h.prefix).length > 0 &&
            utf8.encode(h.name ?? h.prefix).length < 48,
          "机型广播提示无效",
        );
      fingerprints.push({
        hash: Number.parseInt(fp.required.report_map.crc32c, 16),
        model: index,
        data: utf8.encode(JSON.stringify(fp.required)),
      });
      for (const h of fp.scan_hints)
        hints.push({
          hash: crc32c(utf8.encode(h.name ?? h.prefix)),
          model: index,
          data: utf8.encode(JSON.stringify(h)),
        });
    }
  });
  for (const a of [fingerprints, hints])
    a.sort((a, b) => a.hash - b.hash || a.model - b.model);
  const directory = 64,
    fpAt = directory + sorted.length * 16,
    hintsAt = fpAt + fingerprints.length * 12,
    objectsAt = hintsAt + hints.length * 12;
  const objects = new Bytes(),
    interned = new Map<string, number>();
  const intern = (data: Uint8Array, prefix: boolean) => {
    const key = `${prefix}:` + Array.from(data).join(",");
    const old = interned.get(key);
    if (old !== undefined) return old;
    const at = objectsAt + objects.data.length;
    if (prefix) objects.put(data.length, 4);
    objects.data.push(...data);
    interned.set(key, at);
    return at;
  };
  const entries = sorted.map((m) => {
    const b = packModel(m.model);
    return {
      hash: crc32c(utf8.encode(m.model.id)),
      offset: intern(b, false),
      length: b.length,
      revision: m.model.revision,
    };
  });
  const lookups = [fingerprints, hints].map((a) =>
    a.map((e) => ({ ...e, offset: intern(e.data, true) })),
  );
  const w = new Bytes();
  w.data.push(...utf8.encode("VRBC"));
  for (const n of [
    CATALOG_FORMAT,
    64,
    objectsAt + objects.data.length,
    generation,
    sorted.length,
    fingerprints.length,
    hints.length,
    directory,
    fpAt,
    hintsAt,
    objectsAt,
    0,
    0,
    0,
    0,
  ])
    w.put(n, 4);
  for (const e of entries)
    for (const n of [e.hash, e.offset, e.length, e.revision]) w.put(n, 4);
  for (const a of lookups)
    for (const e of a) for (const n of [e.hash, e.model, e.offset]) w.put(n, 4);
  // Avoid spreading a megabyte-sized array into a function call.
  const bytes = new Uint8Array(objectsAt + objects.data.length);
  bytes.set(w.result());
  bytes.set(objects.result(), objectsAt);
  check(bytes.length <= CATALOG_MAX_BYTES, "机型库超过接收器容量");
  new DataView(bytes.buffer).setUint32(48, crc32c(bytes), true);
  return {
    bytes,
    count: sorted.length,
    indexBytes: objectsAt - 64,
    generation,
  };
}

export async function uploadCatalog(
  request: (op: number, body?: Record<string, unknown>) => Promise<any>,
  models: CatalogModel[],
) {
  const before = await request(OP.DB_STATUS);
  check(
    before.catalog_api === 2 && before.catalog_available,
    "请先更新接收器固件",
  );
  const generation = (before.catalog_generation ?? 0) + 1;
  const image = compileCatalog(models, generation);
  check(
    image.count <= before.catalog_max_count &&
      image.bytes.length <= before.catalog_max_bytes,
    "机型库超过接收器容量",
  );
  const { token } = await request(OP.DB_BEGIN, { length: image.bytes.length });
  try {
    for (let offset = 0; offset < image.bytes.length; offset += 192) {
      const hex = Array.from(image.bytes.subarray(offset, offset + 192), (b) =>
        b.toString(16).padStart(2, "0"),
      ).join("");
      await request(OP.DB_DATA, { token, offset, hex });
    }
    try {
      await request(OP.DB_COMMIT, { token });
    } catch (error) {
      // A lost reply is not proof that activation failed. Query instead of
      // replaying an erase or a completed transaction.
      const status = await request(OP.DB_STATUS).catch(() => null);
      if (
        status?.catalog_generation !== generation ||
        status?.catalog_bytes !== image.bytes.length
      )
        throw error;
    }
    return image;
  } catch (error) {
    await request(OP.DB_ABORT, { token }).catch(() => {});
    throw error;
  }
}

/** Reuse shipped structural artwork only when the public geometry is identical.
 * A changed layout must generate new art instead of overlaying stale shapes. */
export function matchingArtwork(
  model: RemoteModel,
  source?: { model: unknown; image?: string },
): string | undefined {
  if (!source?.image) return undefined;
  const old = source.model as RemoteModel;
  if (
    old.id !== model.id ||
    !old.layout ||
    old.layout.artworkButtons ||
    old.layout.width !== model.layout.width ||
    old.layout.height !== model.layout.height ||
    old.layout.buttons.length !== model.layout.buttons.length
  )
    return undefined;
  const fields = ["x", "y", "width", "height", "radius"] as const;
  if (
    !model.layout.buttons.every((b) => {
      const prior = old.layout.buttons.find((p) => p.key === b.key);
      return prior && fields.every((k) => prior[k] === b[k]);
    })
  )
    return undefined;
  return source.image;
}
