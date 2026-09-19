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
  const usage: Record<number, number> = {
    3: 82,
    4: 81,
    5: 80,
    6: 79,
    7: 40,
    8: 41,
    9: 74,
    10: 101,
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
export function cellOf(m: RemoteModel, id: number) {
  const b = m.layout.buttons.find((b) => b.key === id);
  return b
    ? Math.min(
        (m.layout.editorRows ?? 8) - 1,
        Math.floor(b.y / (100 / (m.layout.editorRows ?? 8))),
      ) *
        5 +
        Math.floor(b.x / 20)
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
    cell >= 5 * (model.layout.editorRows ?? 8)
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
  const b = m.layout.buttons.find((b) => b.key === id),
    x = 10 + (cell % 5) * 20,
    y = ((0.5 + Math.floor(cell / 5)) * 100) / (model.layout.editorRows ?? 8);
  if (b) {
    if (occupied && occupied !== b) {
      occupied.x = b.x;
      occupied.y = b.y;
    }
    b.x = x;
    b.y = y;
  } else
    m.layout.buttons.push({
      key: id,
      x,
      y,
      width: 17,
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
  const rows = Math.max(
    8,
    Math.min(
      16,
      new Set(preset.layout.buttons.map((b) => b.y.toFixed(2))).size,
    ),
  );
  m.layout = {
    width: 320,
    height: rows * 70,
    editorRows: rows,
    thumbnailSymbols: true,
    buttons: [],
  };
  const free = new Set(Array.from({ length: rows * 5 }, (_, i) => i));
  for (const b of [...preset.layout.buttons].sort(
    (a, b) => a.y - b.y || a.x - b.x,
  )) {
    const cell = [...free].sort((a, c) => {
      const distance = (i: number) =>
        Math.pow(((i % 5) + 0.5) * 20 - b.x, 2) +
        Math.pow(((Math.floor(i / 5) + 0.5) * 100) / rows - b.y, 2);
      return distance(a) - distance(c);
    })[0];
    if (cell === undefined) throw Error("预设按键超出网格容量");
    free.delete(cell);
    m.layout.buttons.push({
      ...b,
      x: ((cell % 5) + 0.5) * 20,
      y: ((Math.floor(cell / 5) + 0.5) * 100) / rows,
      width: 17,
      height: 80 / rows,
    });
  }
  return m;
}
