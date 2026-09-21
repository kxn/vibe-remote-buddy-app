import { validateModel, type RemoteModel } from "./models";
export interface ModelOverride {
  format_version: 1;
  id: string;
  revision: number;
  title: string;
  keys: RemoteModel["keys"];
  layout: RemoteModel["layout"];
  onboarding?: RemoteModel["onboarding"];
}
export function makeOverride(
  base: RemoteModel,
  draft: RemoteModel,
): ModelOverride {
  const m = validateModel(draft);
  for (const field of ["id", "family", "raw", "matches", "map_crc"] as const)
    if (JSON.stringify(base[field]) !== JSON.stringify(m[field]))
      throw Error("编辑默认配置不能改变设备指纹或键码");
  if (
    base.keys.length !== m.keys.length ||
    base.keys.some((k) => !m.keys.some((n) => n.id === k.id))
  )
    throw Error("增删按键请通过添加遥控器重新适配");
  return {
    format_version: 1,
    id: m.id,
    revision: Math.max(base.revision, m.revision) + 1,
    title: m.title,
    keys: structuredClone(m.keys),
    layout: structuredClone(m.layout),
    onboarding: m.onboarding,
  };
}
export function applyOverride(
  base: RemoteModel,
  o: ModelOverride,
): RemoteModel {
  if (o.format_version !== 1 || o.id !== base.id)
    throw Error("本地默认配置格式无效");
  // Library updates may add keys. Preserve new definitions and overlay only surviving IDs.
  const keys = base.keys.map((k) => o.keys.find((n) => n.id === k.id) ?? k);
  const layout = structuredClone(base.layout);
  layout.buttons = base.keys.map(
    (k) =>
      o.layout.buttons.find((b) => b.key === k.id) ??
      base.layout.buttons.find((b) => b.key === k.id)!,
  );
  if (base.keys.every((k) => o.keys.some((n) => n.id === k.id)))
    Object.assign(layout, o.layout, { buttons: layout.buttons });

  return validateModel({
    ...base,
    title: o.title,
    revision: Math.max(base.revision, o.revision),
    keys,
    layout,
    onboarding: o.onboarding ?? base.onboarding,
    image: layout.artworkButtons ? undefined : base.image,
  });
}
