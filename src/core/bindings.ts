import spec from "../../resources/bindings.json";
import { chord, media } from "./layout";
export type BindingTuple = [number, number, number];
export interface Binding {
  kind: number;
  modifiers: number;
  value: number;
}
export type VoiceProfile = keyof typeof spec.voicePresets;
export const bindingTuple = (b: Binding): BindingTuple => [
  b.kind,
  b.modifiers,
  b.value,
];
export const bindingObject = ([
  kind,
  modifiers,
  value,
]: readonly number[]): Binding => ({ kind, modifiers, value });
export function validBinding(
  key: number,
  value: unknown,
): value is BindingTuple {
  if (
    !Number.isInteger(key) ||
    key < 1 ||
    key > 63 ||
    !Array.isArray(value) ||
    value.length !== 3 ||
    !value.every(Number.isInteger)
  )
    return false;
  const [kind, mod, v] = value,
    rule = spec.kinds.find((r) => r.id === kind);
  return (
    !!rule &&
    rule.voiceOnly === (key === 2) &&
    mod >= 0 &&
    mod <= 255 &&
    (!rule.zeroModifiers || mod === 0) &&
    ((v >= rule.min && v <= rule.max) ||
      (rule.modifierOnly && v === 0 && mod !== 0))
  );
}
export function defaultForKind(kind: number): BindingTuple {
  const rule = spec.kinds.find((r) => r.id === kind);
  if (!rule) throw Error("未知动作类型");
  return [...rule.default] as BindingTuple;
}
export const voicePresets = Object.fromEntries(
  Object.entries(spec.voicePresets).map(([id, p]) => [
    id,
    { modifiers: p.shortcut[1], value: p.shortcut[2] },
  ]),
) as Record<VoiceProfile, { modifiers: number; value: number }>;
export function voicePreset(
  modifiers: number,
  value: number,
): VoiceProfile | "custom" {
  return (
    (Object.entries(voicePresets).find(
      ([, p]) => p.modifiers === modifiers && p.value === value,
    )?.[0] as VoiceProfile) ?? "custom"
  );
}
export function voiceBinding(profile: VoiceProfile, shortcut = false): Binding {
  const p = spec.voicePresets[profile];
  return bindingObject(shortcut ? p.shortcut : p.binding);
}
export function voiceProfile(b: Binding): VoiceProfile | "custom" {
  return (
    (Object.entries(spec.voicePresets).find(([, p]) =>
      p.binding.every((v, i) => v === bindingTuple(b)[i]),
    )?.[0] as VoiceProfile) ?? "custom"
  );
}
export function selectVoiceProfile(b: Binding, profile: string): Binding {
  if (profile in spec.voicePresets)
    return voiceBinding(profile as VoiceProfile);
  const old = voiceProfile(b);
  return old !== "custom" ? voiceBinding(old, true) : b;
}
export function inputMethodForVoice(
  b: Binding,
): "doubao" | "wechat" | undefined {
  const p =
    b.kind === 5
      ? voiceProfile(b)
      : b.kind === 3
        ? voicePreset(b.modifiers, b.value)
        : "custom";
  return p === "doubao" || p === "wechat" ? p : undefined;
}
export const builtinActions = Object.fromEntries(
  spec.appActions.map((a) => [
    a.id,
    { kind: "command" as const, target: a.command, label: a.label },
  ]),
);
export function resourceBinding(a: Record<string, any>): BindingTuple {
  switch (a.type) {
    case "none":
      return defaultForKind(0);
    case "keyboard":
      return [1, a.modifiers, a.usage];
    case "voice-shortcut":
      return [3, a.modifiers, a.usage];
    case "toggle-voice-mode":
      return defaultForKind(6);
    case "media": {
      const i = spec.media.indexOf(a.command);
      if (i < 0) throw Error("未知媒体动作");
      return [2, 0, i];
    }
    case "app": {
      const v = spec.appActions.find((x) => x.resource === a.command);
      if (!v) throw Error("未知软件动作");
      return [4, 0, v.id];
    }
    case "voice-preset": {
      const p = a.preset === "video-meeting" ? "meeting" : a.preset;
      if (!Object.hasOwn(spec.voicePresets, p)) throw Error("未知语音预设");
      return bindingTuple(voiceBinding(p));
    }
    default:
      throw Error("未知默认动作");
  }
}
export function describeBinding(
  b: Binding,
  actionLabel: (id: number) => string | undefined = () => undefined,
): string {
  if (b.kind === 0) return "不使用";
  if (b.kind === 6) return "切换会议 / 普通模式";
  if (b.kind === 2) return media[b.value] ?? `媒体键 ${b.value}`;
  if (b.kind === 4)
    return (
      actionLabel(b.value) ??
      builtinActions[b.value]?.label ??
      `未配置的功能 #${b.value}`
    );
  if (b.kind === 5) {
    const p = voiceProfile(b);
    if (p !== "custom") return spec.voicePresets[p].label + " · 默认";
  }
  if (b.kind === 3) {
    const p = voicePreset(b.modifiers, b.value);
    if (p !== "custom") return spec.voicePresets[p].label;
  }
  return chord(b.modifiers, b.value);
}

export const FIRST_BUILTIN_ACTION = Math.min(
  ...spec.appActions.map((a) => a.id),
);
