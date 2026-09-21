import React, { useLayoutEffect, useRef, useState } from "react";
import {
  Mic,
  Power,
  ArrowUp,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  Check,
  Home,
  Menu,
  Undo2,
} from "lucide-react";
import { labels } from "./core/layout";
import type { RemoteModel, RemoteAppearance } from "./core/models";
import {
  artworkModel,
  artworkPlacement,
  renderRemoteArtwork,
} from "./core/remote-artwork";
export function RemotePreview({
  model,
  verified = [],
  onKey,
  onInsets,
  insets,
}: {
  model: RemoteModel;
  insets?: RemoteAppearance;
  onInsets?: (patch: Partial<RemoteAppearance>) => void;
  verified?: number[];
  onKey?: (id: number) => void;
}) {
  // Authored illustrations contain structural pieces; their key overlays are
  // part of the same design and must be drawn together, at original coordinates.
  const generated =
    !model.image || !!model.layout.artworkButtons || !!model.layout.appearance;
  const visual = artworkModel(model);
  const image = generated ? renderRemoteArtwork(model) : model.image!;
  const placement = generated
    ? artworkPlacement(visual)
    : { tx: 0, ty: 0, sx: 1, sy: 1 };
  const icons: Record<number, typeof Mic> = {
    1: Power,
    2: Mic,
    3: ArrowUp,
    4: ArrowDown,
    5: ArrowLeft,
    6: ArrowRight,
    7: Check,
    8: Undo2,
    9: Home,
    10: Menu,
  };
  const container = useRef<HTMLDivElement>(null);
  const [space, setSpace] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const element = container.current!;
    const observer = new ResizeObserver(([entry]) => {
      setSpace({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const scale = Math.max(
    0,
    Math.min(
      space.width / visual.layout.width,
      space.height / visual.layout.height,
    ),
  );
  return (
    <div className="remote-preview-fit" ref={container}>
      <div
        className="onboarding-remote"
        style={{
          width: visual.layout.width * scale,
          height: visual.layout.height * scale,
          flexShrink: 0,
        }}
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
              ...(!generated
                ? {
                    background: b.fill ?? "transparent",
                    color: b.color ?? "#d5dbdc",
                    border: `1px solid ${b.border ?? "transparent"}`,
                    fontSize: Math.max(
                      5,
                      Math.min(
                        b.height * visual.layout.height * scale * 0.35,
                        (b.width * visual.layout.width * scale) / 100 / 3,
                      ),
                    ),
                  }
                : {}),
            }}
            aria-label={model.keys.find((k) => k.id === b.key)?.label}
            title={model.keys.find((k) => k.id === b.key)?.label}
            onClick={() => onKey?.(b.key)}
            tabIndex={onKey ? 0 : -1}
          >
            {verified.includes(b.key)
              ? "✓"
              : !generated
                ? (() => {
                    const key = model.keys.find((k) => k.id === b.key);
                    const Icon = icons[b.key];
                    const symbol =
                      b.symbol ||
                      (
                        { 11: "TV", 12: "+", 13: "−" } as Record<number, string>
                      )[b.key];
                    if (key && key.label !== labels[b.key]) return key.label;
                    if (symbol) return symbol;
                    return Icon ? (
                      <Icon style={{ width: "55%", height: "55%" }} />
                    ) : (
                      key?.label
                    );
                  })()
                : ""}
          </button>
        ))}
        {onInsets &&
          insets &&
          (["top", "bottom"] as const).map((edge) => (
            <button
              key={edge}
              className="appearance-boundary"
              aria-label={edge === "top" ? "顶部留白" : "底部留白"}
              style={{
                top: `${(edge === "top" ? insets.top : 1 - insets.bottom) * 100}%`,
              }}
              onPointerDown={(e) => {
                e.preventDefault();
                e.currentTarget.setPointerCapture(e.pointerId);
              }}
              onPointerMove={(e) => {
                if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
                const rect =
                  e.currentTarget.parentElement!.getBoundingClientRect();
                const position = (e.clientY - rect.top) / rect.height;
                onInsets({
                  [edge]: Math.max(
                    0.04,
                    Math.min(
                      edge === "top" ? 0.3 : 0.5,
                      edge === "top" ? position : 1 - position,
                    ),
                  ),
                });
              }}
              onPointerUp={(e) =>
                e.currentTarget.releasePointerCapture(e.pointerId)
              }
              onKeyDown={(e) => {
                if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
                e.preventDefault();
                const delta =
                  (e.key === "ArrowDown" ? 1 : -1) *
                  (edge === "bottom" ? -1 : 1) *
                  0.01;
                onInsets({
                  [edge]: Math.max(
                    0.04,
                    Math.min(edge === "top" ? 0.3 : 0.5, insets[edge] + delta),
                  ),
                });
              }}
            >
              ↕
            </button>
          ))}
      </div>
    </div>
  );
}
