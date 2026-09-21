import { it, expect } from "vitest";
import {
  renderRemoteArtwork,
  artworkPlacement,
  artworkModel,
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

it("crops centered three-column layouts without altering the editor or internal gaps", () => {
  const m = validateModel(structuredClone(model));
  delete m.image;
  m.layout.editorColumns = 5;
  m.layout.width = 320;
  m.layout.buttons = m.layout.buttons
    .slice(0, 3)
    .map((b, i) => ({ ...b, x: 30 + i * 20, width: 16 }));
  const shown = artworkModel(m);
  expect(shown.layout.width).toBe(m.layout.height * 3 / ((m.layout.editorRows ?? 8) + 2));
  expect(shown.layout.buttons.map((b) => b.x)).toEqual([100 / 6, 50, 250 / 3]);
  expect(m.layout.editorColumns).toBe(5);
  expect(m.layout.buttons[0].x).toBe(30);
  expect(artworkModel(shown)).toBe(shown);
  expect(renderRemoteArtwork(m)).toContain(`viewBox="0 0 ${shown.layout.width} `);
  // An empty middle column is intentional spacing, not something to collapse.
  m.layout.buttons.splice(1, 1);
  expect(artworkModel(m).layout.width).toBe(m.layout.height * 3 / ((m.layout.editorRows ?? 8) + 2));
  m.layout.buttons[0].width = 60;
  expect(artworkModel(m).layout.width).toBe(m.layout.height * 4 / ((m.layout.editorRows ?? 8) + 2));
});

it("three-column artwork is slender even when the editor canvas is wide", () => {
  const m = validateModel(structuredClone(model));
  delete m.image;
  m.layout.editorColumns = 3;
  m.layout.editorRows = 8;
  m.layout.width = 900;
  m.layout.buttons = m.layout.buttons.slice(0, 3).map((b, i) => ({...b, x: (i + .5) * 100 / 3, width: 24}));
  const shown = artworkModel(m);
  expect(shown.layout.width / shown.layout.height).toBeCloseTo(.3);
  expect(m.layout.width).toBe(900);
});

it("automatic artwork normalizes outer blank space while retaining key order", () => {
  const m = validateModel(structuredClone(model));
  m.layout.buttons = m.layout.buttons.map(b => ({...b, y: 20 + b.y * .5, height:b.height * .5}));
  const a = artworkPlacement(m);
  const min = Math.min(...m.layout.buttons.map(b => b.y - b.height/2));
  const max = Math.max(...m.layout.buttons.map(b => b.y + b.height/2));
  const top = a.ty + min / 100 * m.layout.height * a.sy;
  const bottom = a.ty + max / 100 * m.layout.height * a.sy;
  expect(top).toBeCloseTo(m.layout.height - bottom);
  expect(bottom - top).toBeGreaterThan(m.layout.height * .7);
});
