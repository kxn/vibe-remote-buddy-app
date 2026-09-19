import { it, expect } from "vitest";
import {
  renderRemoteArtwork,
  artworkPlacement,
} from "../src/core/remote-artwork";
import { validateModel } from "../src/core/models";
import model from "../resources/remotes/xiaomi.rc003/model.json";
it("generates deterministic standalone SVG with escaped custom labels", () => {
  const m = validateModel(structuredClone(model));
  m.layout.buttons[0].symbol = '<&"';
  const svg = renderRemoteArtwork(m);
  expect(svg).toBe(renderRemoteArtwork(m));
  expect(svg).toContain(
    'viewBox="0 0 ' + m.layout.width + " " + m.layout.height + '"',
  );
  expect(svg).toContain("&lt;&amp;&quot;");
  expect(svg).not.toMatch(/<script|href=|<foreignObject/);
  expect(svg.match(/<rect /g)!.length).toBeGreaterThan(m.keys.length);
});

it("keeps the entire corner button boxes inside rounded shells", () => {
  for (const [w, h] of [
    [320, 560],
    [600, 200],
    [200, 600],
  ]) {
    const m = validateModel(structuredClone(model));
    m.layout.width = w;
    m.layout.height = h;
    m.layout.buttons = [...m.layout.buttons.slice(0, 4)].map((b, i) => ({
      ...b,
      x: i % 2 ? 95 : 5,
      y: i < 2 ? 5 : 95,
      width: 22,
      height: 18,
    }));
    const { tx, ty, sx, sy } = artworkPlacement(m);
    const r = Math.min(w * 0.18, (h - 4) / 2),
      margin = Math.min(w, h) * 0.045;
    for (const b of m.layout.buttons)
      for (const dx of [-1, 1])
        for (const dy of [-1, 1]) {
          const x = tx + (((b.x + (dx * b.width) / 2) * w) / 100) * sx,
            y = ty + (((b.y + (dy * b.height) / 2) * h) / 100) * sy;
          expect(x).toBeGreaterThanOrEqual(margin);
          expect(y).toBeGreaterThanOrEqual(margin);
          expect(
            Math.hypot(
              x - Math.max(r, Math.min(w - r, x)),
              y - Math.max(r, Math.min(h - r, y)),
            ),
          ).toBeLessThanOrEqual(r - margin + 0.0001);
        }
  }
});
