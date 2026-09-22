import standards from "../../resources/standard-keys.json";
export const labels: Record<number, string> = Object.fromEntries(standards.keys.map(k => [k.id, k.label]));
export const modifiers = [
  "左 Ctrl",
  "左 Shift",
  "左 Alt",
  "左 Win / Command",
  "右 Ctrl",
  "右 Shift",
  "右 Alt",
  "右 Win / Command",
];
export const usages: [number, string][] = [
  [0, "仅修饰键"],
  ...Array.from(
    { length: 26 },
    (_, i) => [i + 4, String.fromCharCode(65 + i)] as [number, string],
  ),
  ...Array.from(
    { length: 9 },
    (_, i) => [30 + i, String(i + 1)] as [number, string],
  ),
  [39, "0"],
  [40, "Enter"],
  [41, "Esc"],
  [42, "Backspace"],
  [43, "Tab"],
  [44, "空格"],
  [74, "Home"],
  [77, "End"],
  [75, "Page Up"],
  [78, "Page Down"],
  [76, "Delete"],
  [79, "右"],
  [80, "左"],
  [81, "下"],
  [82, "上"],
  [101, "菜单"],
  ...Array.from(
    { length: 12 },
    (_, i) => [58 + i, `F${i + 1}`] as [number, string],
  ),
  ...Array.from(
    { length: 12 },
    (_, i) => [104 + i, `F${i + 13}`] as [number, string],
  ),
];
export const media = [
  "音量 +",
  "音量 −",
  "静音",
  "播放 / 暂停",
  "下一首",
  "上一首",
  "停止",
  "浏览器主页",
];
export function chord(mod: number, usage: number) {
  return (
    [
      ...modifiers.filter((_, i) => mod & (1 << i)),
      ...(usage
        ? [usages.find(([n]) => n === usage)?.[1] ?? `键码 ${usage}`]
        : []),
    ].join(" + ") || "无按键"
  );
}
