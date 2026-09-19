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
/** Deterministic, self-contained artwork; coordinates match the editable layout. */
export function renderRemoteArtwork(model: RemoteModel): string {
  const { width: w, height: h, buttons } = model.layout;
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
  const keys = buttons
    .map((b) => {
      const x = (b.x * w) / 100,
        y = (b.y * h) / 100,
        bw = (b.width * w) / 100,
        bh = (b.height * h) / 100;
      const label = escape(
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
      return `<rect x="${x - bw / 2}" y="${y - bh / 2 + 2}" width="${bw}" height="${bh}" rx="${Math.min(bw, bh) * 0.3}" fill="#8c8175" opacity=".3"/><rect x="${x - bw / 2}" y="${y - bh / 2}" width="${bw}" height="${bh}" rx="${Math.min(bw, bh) * 0.3}" fill="${b.key === 2 ? "url(#voice)" : "url(#key)"}" stroke="#ffffff" stroke-opacity=".18"/>${icon}`;
    })
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}"><defs><linearGradient id="shell" x2="1" y2=".15"><stop stop-color="#b8b0a5"/><stop offset=".12" stop-color="#f5f0e7"/><stop offset=".7" stop-color="#e7dfd2"/><stop offset="1" stop-color="#bcb2a4"/></linearGradient><linearGradient id="key" x2=".4" y2="1"><stop stop-color="#57534c"/><stop offset="1" stop-color="#302e2a"/></linearGradient><linearGradient id="voice" x2=".5" y2="1"><stop stop-color="#ce8967"/><stop offset="1" stop-color="#a95e43"/></linearGradient></defs><rect x="1" y="2" width="${w - 2}" height="${h - 4}" rx="${w * 0.18}" fill="url(#shell)" stroke="#b4aa9c"/><rect x="5" y="5" width="${w - 10}" height="${h - 10}" rx="${w * 0.17}" fill="none" stroke="#fffaf2" stroke-opacity=".65"/>${keys}</svg>`;
}
