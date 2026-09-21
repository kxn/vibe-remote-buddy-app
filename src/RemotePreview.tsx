import React from "react";
import type { RemoteModel } from "./core/models";
import {
  artworkModel,
  artworkPlacement,
  renderRemoteArtwork,
} from "./core/remote-artwork";
export function RemotePreview({
  model,
  verified = [],
  onKey,
}: {
  model: RemoteModel;
  verified?: number[];
  onKey?: (id: number) => void;
}) {
  const visual = artworkModel(model);
  const generated = !model.image || visual.layout.artworkButtons;
  const image = generated ? renderRemoteArtwork(model) : model.image!;
  const placement = generated
    ? artworkPlacement(visual)
    : { tx: 0, ty: 0, sx: 1, sy: 1 };
  return (
    <div
      className="onboarding-remote"
      style={{ aspectRatio: `${visual.layout.width}/${visual.layout.height}` }}
    >
      <img
        draggable={false}
        src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(image)}`}
        alt={model.title}
      />
      {visual.layout.buttons.map((b) => (
        <button
          key={b.key}
          type="button"
          className={verified.includes(b.key) ? "verified" : ""}
          style={{
            left: `${(placement.tx / visual.layout.width) * 100 + b.x * placement.sx}%`,
            top: `${(placement.ty / visual.layout.height) * 100 + b.y * placement.sy}%`,
            width: `${b.width * placement.sx}%`,
            height: `${b.height * placement.sy}%`,
            borderRadius: `${b.radius}%`,
          }}
          aria-label={model.keys.find((k) => k.id === b.key)?.label}
          title={model.keys.find((k) => k.id === b.key)?.label}
          onClick={() => onKey?.(b.key)}
          tabIndex={onKey ? 0 : -1}
        >
          {verified.includes(b.key) ? "✓" : ""}
        </button>
      ))}
    </div>
  );
}
