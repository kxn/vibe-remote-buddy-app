import { labels } from "./layout";
import { type RemoteModel, type ModelKey, validateModel } from "./models";
export const standardKeys: ModelKey[] = Object.entries({
  ...labels,
  15: "播放 / 暂停",
  16: "下一首",
  17: "上一首",
  18: "停止",
}).map(([id, label]) => ({
  id: Number(id),
  label,
  default: defaultBinding(Number(id)),
}));
function defaultBinding(id: number): [number, number, number] {
  if (id === 2) return [5, 0, 1];
  if (id === 9) return [4, 0, 65534];
  if (id === 10) return [4, 0, 65535];
  const usage: Record<number, number> = {
    3: 82,
    4: 81,
    5: 80,
    6: 79,
    7: 40,
    8: 42,
  };
  if (usage[id]) return [1, 0, usage[id]];
  const media: Record<number, number> = {
    12: 0,
    13: 1,
    14: 2,
    15: 3,
    16: 4,
    17: 5,
    18: 6,
  };
  if (id in media) return [2, 0, media[id]];
  return [0, 0, 0];
}
export interface KeyProof {
  report: number;
  usage: number;
  voice?: boolean;
}
export function gridColumns(m: RemoteModel): number {
  return (
    m.layout.editorColumns ??
    Math.max(
      2,
      Math.min(
        5,
        new Set(m.layout.buttons.map((b) => b.x.toFixed(1))).size || 5,
      ),
    )
  );
}
export function cellOf(m: RemoteModel, id: number) {
  const b = m.layout.buttons.find((b) => b.key === id);
  if (b?.cell !== undefined) return b.cell;
  return b
    ? Math.min(
        (m.layout.editorRows ?? 8) - 1,
        Math.floor(b.y / (100 / (m.layout.editorRows ?? 8))),
      ) *
        gridColumns(m) +
        Math.min(gridColumns(m) - 1, Math.floor(b.x / (100 / gridColumns(m))))
    : -1;
}
export function placeKey(
  model: RemoteModel,
  cell: number,
  id: number,
  label?: string,
) {
  if (
    !Number.isInteger(cell) ||
    cell < 0 ||
    cell >= gridColumns(model) * (model.layout.editorRows ?? 8)
  )
    throw Error("布局位置无效");
  const m = structuredClone(model),
    existing = m.keys.find((k) => k.id === id),
    occupied = m.layout.buttons.find((b) => cellOf(m, b.key) === cell);
  if (!existing && occupied) throw Error("这个位置已有按键");
  if (!existing) {
    const standard = standardKeys.find((k) => k.id === id);
    if (!standard && (!label?.trim() || id < 35 || id > 63))
      throw Error("自定义按键无效");
    const name = standard?.label ?? label!.trim();
    if (m.keys.some((k) => k.label.toLowerCase() === name.toLowerCase()))
      throw Error("同名按键已存在");
    if (
      !standard &&
      standardKeys.some((k) => k.label.toLowerCase() === name.toLowerCase())
    )
      throw Error("请使用同名标准按键");
    m.keys.push(
      standard
        ? structuredClone(standard)
        : { id, label: name, default: [0, 0, 0] },
    );
  }
  m.layout.editorColumns = gridColumns(model);
  const b = m.layout.buttons.find((b) => b.key === id),
    x = ((0.5 + (cell % gridColumns(model))) * 100) / gridColumns(model),
    y =
      ((0.5 + Math.floor(cell / gridColumns(model))) * 100) /
      (model.layout.editorRows ?? 8);
  if (b) {
    if (occupied && occupied !== b) {
      occupied.cell = cellOf(m, id);
      occupied.x = b.x;
      occupied.y = b.y;
    }
    b.cell = cell;
    b.x = x;
    b.y = y;
  } else
    m.layout.buttons.push({
      key: id,
      cell,
      x,
      y,
      width: 80 / gridColumns(model),
      height: 80 / (model.layout.editorRows ?? 8),
      radius: 8,
      fill: "#eee8de",
      color: "#34332e",
    });
  return m;
}
export function removeKey(model: RemoteModel, id: number) {
  const m = structuredClone(model);
  m.keys = m.keys.filter((k) => k.id !== id);
  m.raw = m.raw.filter((k) => k.key !== id);
  m.layout.buttons = m.layout.buttons.filter((b) => b.key !== id);
  return m;
}
export function verifiedModel(
  model: RemoteModel,
  proofs: Record<number, KeyProof>,
) {
  for (const k of model.keys) {
    const p = proofs[k.id];
    if (!p || (k.id === 2 && !p.voice)) throw Error("请完成全部按键与语音验证");
  }
  const m = structuredClone(model);
  m.raw = [];
  for (const k of m.keys) {
    const p = proofs[k.id];
    if (p.report === 0) {
      if (m.family !== 1 || k.id !== 2 || p.usage !== 8)
        throw Error("不支持此协议按键");
      continue;
    }
    if (p.report === 248) {
      if (m.family !== 2 || k.id !== 2 || p.usage !== 1)
        throw Error("不支持此协议按键");
      continue;
    }
    m.raw.push({ report: p.report, usage: p.usage, key: k.id });
  }
  return validateModel(m);
}

export function copyLayoutPreset(
  current: RemoteModel,
  preset: RemoteModel,
): RemoteModel {
  const m = structuredClone(current);
  m.keys = structuredClone(preset.keys);
  m.raw = [];
  delete m.image;
  m.layout = structuredClone(preset.layout);
  m.layout.editorColumns = gridColumns(preset);
  m.layout.editorRows =
    preset.layout.editorRows ??
    Math.max(
      8,
      Math.min(
        16,
        new Set(preset.layout.buttons.map((b) => b.y.toFixed(2))).size,
      ),
    );
  const cols = gridColumns(m),
    rows = m.layout.editorRows!;
  const free = new Set(Array.from({ length: cols * rows }, (_, i) => i));
  for (const b of m.layout.buttons) {
    const cell = [...free].sort((a, c) => {
      const d = (i: number) =>
        Math.pow((((i % cols) + 0.5) * 100) / cols - b.x, 2) +
        Math.pow(((Math.floor(i / cols) + 0.5) * 100) / rows - b.y, 2);
      return d(a) - d(c);
    })[0];
    if (cell === undefined) throw Error("预设按键超出网格容量");
    b.cell = cell;
    free.delete(cell);
  }
  delete m.layout.artwork;
  m.layout.artworkButtons = true;
  return m;
}
