import { OP } from "./session";
import { crc32c } from "./wire";
export interface ModelKey {
  id: number;
  label: string;
  default: [number, number, number];
}
export interface ModelLayout {
  width: number;
  height: number;
  artwork?: string;
  thumbnailSymbols?: boolean;
  artworkButtons?: boolean;
  angle?: number;
  buttons: {
    key: number;
    x: number;
    y: number;
    width: number;
    height: number;
    radius: number;
    fill?: string;
    color?: string;
    border?: string;
    symbol?: string;
  }[];
}
export interface RemoteModel {
  schema: 1;
  id: string;
  title: string;
  revision: number;
  family: 1 | 2;
  matches: { name?: string; prefix?: string; company?: number }[];
  keys: ModelKey[];
  raw: { report: number; usage: number; key: number }[];
  map_crc: number;
  layout: ModelLayout;
  image?: string;
}
export interface ModelSource {
  model: unknown;
  image?: string;
  source: string;
  error?: string;
}
export const remoteModels = new Map<string, RemoteModel>();
const ids = /^[a-z0-9][a-z0-9._-]{0,46}$/;
function require(ok: unknown, message: string): asserts ok {
  if (!ok) throw Error(message);
}
function integer(v: unknown, max: number, min = 0): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;
}
function text(v: unknown, max: number): v is string {
  return (
    typeof v === "string" &&
    v.length > 0 &&
    new TextEncoder().encode(v).length <= max &&
    !/[\x00-\x1f]/.test(v)
  );
}
function object(v: unknown): v is Record<string, any> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}
export function validateModel(v: unknown): RemoteModel {
  require(object(v), "型号必须是对象");
  require(Object.keys(v).every((k) =>
    [
      "$schema",
      "schema",
      "id",
      "title",
      "revision",
      "family",
      "matches",
      "keys",
      "raw",
      "map_crc",
      "layout",
      "image",
    ].includes(k),
  ), "未知型号字段");
  require(v.schema === 1 &&
    typeof v.id === "string" &&
    ids.test(v.id), "型号 schema/id 无效");
  require(text(v.title, 120) &&
    integer(v.revision, 0xffffffff, 1) &&
    (v.family === 1 || v.family === 2), "型号名称、版本或协议无效");
  require(integer(v.map_crc, 0xffffffff), "map_crc 无效");
  require(Array.isArray(v.matches) &&
    v.matches.length > 0 &&
    v.matches.length <= 8, "识别规则须为 1–8 条");
  for (const m of v.matches) {
    require(object(m) &&
      text(m.name, 47) !==
        text(m.prefix, 47), "识别规则必须提供 name 或 prefix");
    require(m.company === undefined ||
      integer(m.company, 65535), "company 必须是广播厂商 ID");
    require(Object.keys(m).every((k) =>
      ["name", "prefix", "company"].includes(k),
    ), "不支持的识别字段");
  }
  require(Array.isArray(v.keys) &&
    v.keys.length > 0 &&
    v.keys.length <= 63, "按键数量无效");
  const keys = new Set<number>();
  for (const k of v.keys) {
    require(object(k) &&
      integer(k.id, 63, 1) &&
      !keys.has(k.id) &&
      text(k.label, 80), "重复或不支持的按钮");
    keys.add(k.id);
    const d = k.default;
    require(Array.isArray(d) &&
      d.length === 3 &&
      integer(d[0], 5) &&
      integer(d[1], 255) &&
      integer(d[2], 65535), "默认按键无效");
    const [kind, mod, value] = d;
    require(k.id === 2
      ? kind === 3 || kind === 5
      : kind !== 3 && kind !== 5, "语音配置只能用于语音键");
    require(kind === 0
      ? !mod && !value
      : kind === 1 || kind === 3
        ? value <= 223 && (value >= 4 || (!value && mod))
        : kind === 2
          ? !mod && value < 8
          : kind === 4
            ? !mod && value > 0
            : !mod && (value === 1 || value === 2), "默认动作参数无效");
  }
  require(keys.has(2), "现有协议需要语音键");
  require(Array.isArray(v.raw) && v.raw.length <= 64, "原始映射数量无效");
  const raw = new Set<string>();
  for (const k of v.raw) {
    require(object(k) &&
      (k.report === 1 || k.report === 3) &&
      integer(k.usage, k.report === 1 ? 255 : 65535, 1) &&
      keys.has(k.key), "原始按键映射无效");
    const id = `${k.report}:${k.usage}`;
    require(!raw.has(id), "原始按键映射重复");
    raw.add(id);
  }
  const l = v.layout;
  require(object(l) &&
    integer(l.width, 2000, 50) &&
    integer(l.height, 4000, 50) &&
    Array.isArray(l.buttons), "布局无效");
  require(l.angle === undefined ||
    (typeof l.angle === "number" &&
      Number.isFinite(l.angle) &&
      Math.abs(l.angle) <= 30), "缩略图角度无效");
  require(l.artworkButtons === undefined ||
    typeof l.artworkButtons === "boolean", "图片按键设置无效");
  require(l.thumbnailSymbols === undefined ||
    typeof l.thumbnailSymbols === "boolean", "缩略图设置无效");
  const placed = new Set<number>();
  for (const b of l.buttons) {
    require(object(b) &&
      keys.has(b.key) &&
      !placed.has(b.key), "布局按键缺失或重复");
    placed.add(b.key);
    for (const color of ["fill", "color", "border"])
      require(b[color] === undefined ||
        (typeof b[color] === "string" &&
          /^(transparent|#[0-9a-fA-F]{6})$/.test(b[color])), "按钮颜色无效");
    require(b.symbol === undefined || text(b.symbol, 16), "按钮符号无效");
    for (const field of ["x", "y", "width", "height", "radius"])
      require(typeof b[field] === "number" &&
        Number.isFinite(b[field]) &&
        b[field] >= 0 &&
        b[field] <= 100, "布局坐标无效");
    require(b.width > 0 &&
      b.height > 0 &&
      b.x >= b.width / 2 &&
      b.x + b.width / 2 <= 100 &&
      b.y >= b.height / 2 &&
      b.y + b.height / 2 <= 100, "按钮超出布局范围");
  }
  require(placed.size === keys.size, "布局必须包含每个按钮");
  return v as unknown as RemoteModel;
}
export function loadModels(sources: ModelSource[]): string[] {
  const errors: string[] = [];
  const pending = new Map<string, ModelSource>();
  const duplicate = new Set<string>();
  remoteModels.clear();
  for (const source of sources) {
    try {
      if (source.error) throw Error(source.error);
      require(object(source.model) &&
        typeof source.model.id === "string", "缺少型号 ID");
      const id = source.model.id;
      if (pending.has(id)) {
        duplicate.add(id);
        throw Error(`型号 ID 重复：${id}`);
      }
      pending.set(id, source);
    } catch (e) {
      errors.push(`${source.source}: ${String(e)}`);
    }
  }
  const visiting = new Set<string>();
  function resolve(id: string): RemoteModel {
    const cached = remoteModels.get(id);
    if (cached) return cached;
    require(!duplicate.has(id), `型号 ID 重复：${id}`);
    require(!visiting.has(id), "型号继承循环");
    require(visiting.size < 8, "型号继承过深");
    const source = pending.get(id);
    require(source && object(source.model), `缺少基础型号 ${id}`);
    visiting.add(id);
    try {
      const raw = source.model;
      let value = { ...raw };
      let image = source.image;
      if (raw.extends) {
        require(typeof raw.extends === "string", "extends 无效");
        const base = resolve(raw.extends);
        value = { ...base, ...raw };
        if (raw.layout === undefined) image = base.image;
        require(raw.family === undefined ||
          raw.family === base.family, "变种不能覆盖协议类型");
      }
      delete value.extends;
      const model = validateModel(value);
      model.image = image;
      remoteModels.set(id, model);
      return model;
    } finally {
      visiting.delete(id);
    }
  }
  for (const id of pending.keys())
    try {
      resolve(id);
    } catch (e) {
      errors.push(`${id}: ${String(e)}`);
    }
  return errors;
}
export function operationalModel(m: RemoteModel) {
  return {
    schema: m.schema,
    id: m.id,
    revision: m.revision,
    family: m.family,
    matches: m.matches,
    keys: m.keys.map((k) => ({ id: k.id, default: k.default })),
    raw: m.raw,
    map_crc: m.map_crc,
  };
}
export function modelBytes(m: RemoteModel) {
  return new TextEncoder().encode(JSON.stringify(operationalModel(m)));
}
export async function syncModels(
  request: (op: number, body: Record<string, unknown>) => Promise<any>,
  capacity: number,
) {
  require(integer(capacity, 64, 1), "接收器型号容量无效");
  const installed = new Map<string, number>();
  for (let index = 0; index < capacity; index++)
    try {
      const r = await request(OP.MODEL_GET, { index });
      installed.set(r.id, r.crc);
    } catch (e) {
      if ((e as { status?: number }).status !== 6) throw e;
    }
  for (const model of remoteModels.values()) {
    const bytes = modelBytes(model);
    require(bytes.length < 6144, `${model.id}: 运行配置过大`);
    if (installed.get(model.id) === crc32c(bytes)) continue;
    const { token } = await request(OP.MODEL_BEGIN, { length: bytes.length });
    try {
      for (let offset = 0; offset < bytes.length; offset += 160) {
        const chunk = bytes.slice(offset, offset + 160);
        await request(OP.MODEL_DATA, {
          token,
          offset,
          hex: Array.from(chunk, (b) => b.toString(16).padStart(2, "0")).join(
            "",
          ),
        });
      }
      await request(OP.MODEL_COMMIT, { token });
    } catch (e) {
      await request(OP.MODEL_ABORT, { token }).catch(() => {});
      if (e instanceof Error) {
        e.message = `${model.id}: 型号配置未安装，${e.message}`;
        throw e;
      }
      throw Error(`${model.id}: 型号配置未安装，${String(e)}`);
    }
  }
}
