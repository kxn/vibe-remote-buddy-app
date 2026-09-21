import React, { useLayoutEffect, useRef, useState } from "react";
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
  // A library illustration can be a shell-only background. Key previews must
  // always render the actual layout, independently of the decorative image.
  const source = {...model, image: undefined, layout: {...model.layout, artworkButtons: true}};
  const visual = artworkModel(source);
  const image = renderRemoteArtwork(source);
  const placement = artworkPlacement(visual);
  const container = useRef<HTMLDivElement>(null);
  const [space, setSpace] = useState({width: 0, height: 0});
  useLayoutEffect(() => {
    const element = container.current!;
    const observer = new ResizeObserver(([entry]) => {
      setSpace({width: entry.contentRect.width, height: entry.contentRect.height});
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const scale = Math.max(0, Math.min(space.width / visual.layout.width, space.height / visual.layout.height));
  return (
    <div className="remote-preview-fit" ref={container}>
    <div
      className="onboarding-remote"
      style={{ width: visual.layout.width * scale, height: visual.layout.height * scale, flexShrink: 0 }}
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
    </div>
  );
}
