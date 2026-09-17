import type { Settings } from "./types";
import { validAction } from "./actions";
export function validateSettings(value: unknown): Settings {
  if (!value || typeof value !== "object") throw Error("不是有效的配置文件");
  const v = value as Settings;
  if (
    v.schema !== 1 ||
    typeof v.background !== "boolean" ||
    !v.boards ||
    typeof v.boards !== "object" ||
    Array.isArray(v.boards)
  )
    throw Error("配置格式或版本不支持");
  if (Object.keys(v.boards).length > 64) throw Error("配置中的接收器过多");
  for (const [serial, b] of Object.entries(v.boards)) {
    if (!serial || serial.length > 256 || !b || typeof b !== "object")
      throw Error("接收器配置无效");
    for (const prop of [
      "aliases",
      "actions",
      "authorizations",
      "shared",
      "followers",
    ] as const)
      if (!b[prop] || typeof b[prop] !== "object" || Array.isArray(b[prop]))
        throw Error("缺少配置字段 " + prop);
    for (const name of Object.values(b.aliases))
      if (typeof name !== "string" || name.length > 64)
        throw Error("遥控器名称无效");
    for (const [id, a] of Object.entries(b.actions))
      if (
        !/^\d+$/.test(id) ||
        Number(id) < 1 ||
        Number(id) > 65535 ||
        !validAction(a)
      )
        throw Error("软件动作无效");
    for (const m of Object.values(b.shared))
      if (
        !Number.isInteger(m.key) ||
        m.key < 1 ||
        m.key > 63 ||
        ![0, 1, 2, 3].includes(m.kind) ||
        !Number.isInteger(m.modifiers) ||
        m.modifiers < 0 ||
        m.modifiers > 255 ||
        !Number.isInteger(m.value) ||
        m.value < 0 ||
        m.value > 65535 ||
        (m.key === 2) !== (m.kind === 3)
      )
        throw Error("通用按键配置无效");
    for (const keys of Object.values(b.followers))
      if (
        !Array.isArray(keys) ||
        keys.some((k) => !Number.isInteger(k) || k < 1 || k > 63)
      )
        throw Error("按键继承关系无效");
  }
  return v;
}
