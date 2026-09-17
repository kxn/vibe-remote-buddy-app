export const labels: Record<number, string> = {
  1: "电源",
  2: "语音",
  3: "上",
  4: "下",
  5: "左",
  6: "右",
  7: "确认",
  8: "返回",
  9: "主页",
  10: "菜单",
  11: "电视",
  12: "音量 +",
  13: "音量 −",
  14: "静音",
  19: "设置",
  20: "本地",
  21: "频道 +",
  22: "频道 −",
  23: "0",
  24: "1",
  25: "2",
  26: "3",
  27: "4",
  28: "5",
  29: "6",
  30: "7",
  31: "8",
  32: "9",
  33: "*",
  34: "#",
};
export const layouts: Record<string, (number | null)[][]> = {
  "xiaomi.rc003": [
    [1, null, 2],
    [null, 3, null],
    [5, 7, 6],
    [null, 4, null],
    [8, null, 12],
    [9, null, 13],
    [10, null, 11],
  ],
  "unicom.hid_ico.v1": [
    [null, null, 1],
    [14, null, 19],
    [null, 3, null],
    [5, 7, 6],
    [null, 4, null],
    [9, 20, 8],
    [12, 2, 21],
    [13, null, 22],
    [24, 25, 26],
    [27, 28, 29],
    [30, 31, 32],
    [33, 23, 34],
  ],
};
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
