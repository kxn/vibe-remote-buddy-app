import type { RemoteModel } from "./models";
// Editor geometry policy; rendering dimensions and saved explicit values stay separate.
export const gridLimits = {
  columns: { min: 2, max: 5, initial: 3 },
  rows: { min: 8, max: 16, initial: 8 },
} as const;
export function gridColumns(model: Pick<RemoteModel, "layout">): number {
  return (
    model.layout.editorColumns ??
    Math.max(
      gridLimits.columns.min,
      Math.min(
        gridLimits.columns.max,
        new Set(model.layout.buttons.map((b) => b.x.toFixed(1))).size ||
          gridLimits.columns.initial,
      ),
    )
  );
}
export function gridRows(model: Pick<RemoteModel, "layout">): number {
  return model.layout.editorRows ?? gridLimits.rows.initial;
}
export const appearanceFields = [
  ["ratio", "宽窄", 0.18, 0.5, 0.01],
  ["radius", "圆角", 0.04, 0.45, 0.01],
  ["top", "顶部留白", 0.04, 0.3, 0.01],
  ["bottom", "底部留白", 0.04, 0.5, 0.01],
] as const;
export const maximumInsets = 0.7;
