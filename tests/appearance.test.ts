import { it, expect } from "vitest";
import source from "../resources/remotes/xiaomi.rc003/model.json";
import { validateModel } from "../src/core/models";
import { appearanceOf, withAppearance } from "../src/AppearanceControls";
import {
  artworkModel,
  artworkPlacement,
  renderRemoteArtwork,
} from "../src/core/remote-artwork";
import { copyLayoutPreset, resizeGrid } from "../src/core/probe-layout";
import { makeOverride, applyOverride } from "../src/core/model-overrides";
const base = () => validateModel(structuredClone(source));
it("persists appearance through JSON, defaults and copying without changing identity", () => {
  const original = base(),
    m = withAppearance(original, { color: "silver", bottom: 0.34 });
  expect(appearanceOf(original).color).toBe("black");
  expect(original.layout.appearance).toBeUndefined();
  expect(m.raw).toEqual(original.raw);
  expect(m.keys).toEqual(original.keys);
  expect(m.matches).toEqual(original.matches);
  const stored = validateModel(JSON.parse(JSON.stringify(m)));
  expect(stored.layout.appearance).toEqual(m.layout.appearance);
  expect(
    applyOverride(original, makeOverride(original, stored)).layout.appearance,
  ).toEqual(m.layout.appearance);
  expect(copyLayoutPreset(original, stored).layout.appearance).toEqual(
    m.layout.appearance,
  );
  expect(resizeGrid(stored, 5, 16).layout.appearance).toEqual(
    m.layout.appearance,
  );
});
it("rejects unsupported appearance versions, colors and invalid geometry", () => {
  for (const patch of [
    { version: 2 },
    { color: "red" },
    { ratio: 0 },
    { radius: NaN },
    { top: 0.3, bottom: 0.5 },
  ]) {
    const m = withAppearance(base(), {});
    Object.assign(m.layout.appearance!, patch);
    expect(() => validateModel(m)).toThrow();
  }
});
it("keeps intentional grip space and aspect ratio after projection", () => {
  const m = withAppearance(base(), { bottom: 0.34, top: 0.08, ratio: 0.28 });
  m.layout.editorColumns = 5;
  const visual = artworkModel(m),
    p = artworkPlacement(visual),
    h = visual.layout.height;
  expect(visual.layout.width / h).toBeCloseTo(0.28);
  expect(artworkModel(visual).layout).toEqual(visual.layout);
  for (const b of visual.layout.buttons) {
    const top = p.ty + (((b.y - b.height / 2) * h) / 100) * p.sy;
    const bottom = p.ty + (((b.y + b.height / 2) * h) / 100) * p.sy;
    expect(top / h).toBeGreaterThanOrEqual(0.08 - 1e-8);
    expect(bottom / h).toBeLessThanOrEqual(0.66 + 1e-8);
  }
});
it("renders deterministic black, silver and white shells", () => {
  const images = ["black", "silver", "white"].map((color) => {
    const m = withAppearance(base(), {
      color: color as "black" | "silver" | "white",
    });
    const svg = renderRemoteArtwork(m);
    expect(renderRemoteArtwork(m)).toBe(svg);
    return svg;
  });
  expect(new Set(images).size).toBe(3);
});

it("renders all slider endpoints including nearly square shell corners",()=>{
 for(const ratio of [.18,.5]) for(const radius of [.04,.45]) for(const top of [.04,.3]) for(const bottom of [.04,.5]) {
  const m=withAppearance(base(),{ratio,radius,top,bottom});
  expect(()=>validateModel(m)).not.toThrow();
  expect(()=>renderRemoteArtwork(m)).not.toThrow();
 }
});
