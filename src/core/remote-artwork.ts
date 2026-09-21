import { labels } from "./layout";
import type { RemoteModel } from "./models";

const escape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      })[c]!,
  );
/** Trim only empty outer grid columns; preserve gaps and the editable canvas. */
export function artworkModel(model: RemoteModel): RemoteModel {
  const { layout } = model;
  if (layout.appearance)
    return {
      ...model,
      layout: { ...layout, width: layout.height * layout.appearance.ratio },
    };
  const cols = layout.editorColumns;
  if (
    !cols ||
    !layout.buttons.length ||
    (model.image && !layout.artworkButtons)
  )
    return model;
  const left = Math.max(
    0,
    Math.floor(
      (Math.min(...layout.buttons.map((b) => b.x - b.width / 2)) * cols) / 100 +
        1e-8,
    ),
  );
  const right = Math.min(
    cols,
    Math.ceil(
      (Math.max(...layout.buttons.map((b) => b.x + b.width / 2)) * cols) / 100 -
        1e-8,
    ),
  );
  const used = right - left;
  if (used <= 0) return model;
  return {
    ...model,
    layout: {
      ...layout,
      // Remove grid metadata from this display-only projection so it is idempotent.
      editorColumns: undefined,
      // Grid artwork has a physical proportion independent of the editor canvas.
      width: (layout.height * used) / ((layout.editorRows ?? 8) + 2),
      buttons: layout.buttons.map((b) => ({
        ...b,
        x: ((b.x - (left * 100) / cols) * cols) / used,
        width: (b.width * cols) / used,
      })),
    },
  };
}
/** Keep complete button boxes inside the rounded shell, with a visible gutter. */
export function artworkPlacement(model: RemoteModel) {
  const { width: w, height: h, buttons } = model.layout;
  const minX = Math.min(0, ...buttons.map((b) => b.x - b.width / 2));
  const maxX = Math.max(100, ...buttons.map((b) => b.x + b.width / 2));
  const minY = buttons.length
    ? Math.min(...buttons.map((b) => b.y - b.height / 2))
    : 0;
  const maxY = buttons.length
    ? Math.max(...buttons.map((b) => b.y + b.height / 2))
    : 100;
  const appearance = model.layout.appearance;
  const top = appearance?.top ?? 0.07,
    bottom = appearance?.bottom ?? 0.07;
  let sx = 84 / (maxX - minX),
    sy = ((1 - top - bottom) * 100) / (maxY - minY);
  const margin = Math.min(w, h) * 0.045;
  const radius = Math.min(w * (appearance?.radius ?? 0.18), (h - 4) / 2);
  const inside = (x: number, y: number) => {
    if (x < margin || x > w - margin || y < margin || y > h - margin)
      return false;
    const cx = Math.max(radius, Math.min(w - radius, x));
    const cy = Math.max(radius, Math.min(h - radius, y));
    return Math.hypot(x - cx, y - cy) <= radius - margin;
  };
  for (let i = 0; i < 150; i++) {
    const tx = w / 2 - (((minX + maxX) * w) / 200) * sx;
    const ty =
      h * (top + (1 - top - bottom) / 2) - (((minY + maxY) * h) / 200) * sy;
    const fits = buttons.every((b) =>
      [-1, 1].every((dx) =>
        [-1, 1].every((dy) =>
          inside(
            tx + (((b.x + (dx * b.width) / 2) * w) / 100) * sx,
            ty + (((b.y + (dy * b.height) / 2) * h) / 100) * sy,
          ),
        ),
      ),
    );
    if (fits) return { tx, ty, sx, sy };
    sx *= 0.98;
    sy *= 0.98;
  }
  throw Error("按键布局无法放入遥控器边界");
}
/** Deterministic, self-contained artwork; coordinates match the editable layout. */
export function renderRemoteArtwork(model: RemoteModel): string {
  model = artworkModel(model);
  const { width: w, height: h, buttons } = model.layout;
  const { tx, ty, sx, sy } = artworkPlacement(model);
  const symbols: Record<number, string> = {
    1: "⏻",
    2: "●",
    3: "▲",
    4: "▼",
    5: "◀",
    6: "▶",
    7: "OK",
    8: "↶",
    9: "⌂",
    10: "≡",
    11: "TV",
    12: "+",
    13: "−",
    14: "×",
  };
  const appearance = model.layout.appearance;
  const colors =
    appearance?.color === "silver"
      ? ["#899194", "#d6dcde", "#b9c1c4", "#858e92"]
      : appearance?.color === "white"
        ? ["#cbcdd0", "#ffffff", "#f2f2f0", "#c3c7c9"]
        : ["#15181b", "#42474b", "#272c30", "#101315"];
  const radius = w * (appearance?.radius ?? 0.18);
  const keys = buttons
    .map((b) => {
      const x = (b.x * w) / 100,
        y = (b.y * h) / 100,
        bw = (b.width * w) / 100,
        bh = (b.height * h) / 100;
      const label = escape(
        (model.keys.find((k) => k.id === b.key)?.label !== labels[b.key]
          ? model.keys.find((k) => k.id === b.key)?.label
          : undefined) ||
          b.symbol ||
          symbols[b.key] ||
          model.keys.find((k) => k.id === b.key)?.label ||
          "",
      );
      const size = Math.min(
        bh * 0.36,
        bw / (Math.max(2, [...label].length) * 0.65),
      );
      const icon =
        b.key === 2
          ? `<g transform="translate(${x} ${y})" fill="none" stroke="#fff8ef" stroke-width="${bh * 0.045}" stroke-linecap="round"><rect x="${-bh * 0.075}" y="${-bh * 0.21}" width="${bh * 0.15}" height="${bh * 0.28}" rx="${bh * 0.075}"/><path d="M ${-bh * 0.14} 0 Q ${-bh * 0.14} ${bh * 0.17} 0 ${bh * 0.17} Q ${bh * 0.14} ${bh * 0.17} ${bh * 0.14} 0 M 0 ${bh * 0.17} V ${bh * 0.25}"/></g>`
          : `<text x="${x}" y="${y}" dy=".35em" text-anchor="middle" font-family="Segoe UI,Arial,sans-serif" font-size="${size}" fill="#f9f4ea">${label}</text>`;
      return `<rect x="${x - bw / 2}" y="${y - bh / 2 + 2}" width="${bw}" height="${bh}" rx="${Math.min(bw, bh) * Math.min(0.5, Math.max(0.18, b.radius / 100))}" fill="#8c8175" opacity=".3"/><rect x="${x - bw / 2}" y="${y - bh / 2}" width="${bw}" height="${bh}" rx="${Math.min(bw, bh) * Math.min(0.5, Math.max(0.18, b.radius / 100))}" fill="${b.key === 2 ? "url(#voice)" : "url(#key)"}" stroke="#ffffff" stroke-opacity=".18"/>${icon}`;
    })
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}"><defs><linearGradient id="shell" x2="1" y2=".15"><stop stop-color="${colors[0]}"/><stop offset=".12" stop-color="${colors[1]}"/><stop offset=".7" stop-color="${colors[2]}"/><stop offset="1" stop-color="${colors[3]}"/></linearGradient><linearGradient id="key" x2=".4" y2="1"><stop stop-color="#57534c"/><stop offset="1" stop-color="#302e2a"/></linearGradient><linearGradient id="voice" x2=".5" y2="1"><stop stop-color="#ce8967"/><stop offset="1" stop-color="#a95e43"/></linearGradient></defs><rect x="1" y="2" width="${w - 2}" height="${h - 4}" rx="${radius}" fill="url(#shell)" stroke="#b4aa9c"/><rect x="5" y="5" width="${w - 10}" height="${h - 10}" rx="${Math.max(1, radius - 4)}" fill="none" stroke="#fffaf2" stroke-opacity=".65"/><g transform="translate(${tx} ${ty}) scale(${sx} ${sy})">${keys}</g></svg>`;
}
