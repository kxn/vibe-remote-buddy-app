/* Shared remote rendering: the same artwork view the home screen and key
 * list use, extracted so other surfaces (adapt tool preview) reuse the
 * identical styles instead of reinventing them. */
import type { ComponentType } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Check,
  House,
  Menu,
  Mic,
  Power,
  Radio,
  Settings as SettingsIcon,
  Undo2,
  Volume1,
  Volume2,
  VolumeX,
} from "lucide-react";
import { remoteModels } from "./core/models";
import { labels } from "./core/layout";
import { artworkModel, renderRemoteArtwork } from "./core/remote-artwork";

const icons: Record<number, ComponentType<{ size?: number }>> = {
  1: Power,
  2: Mic,
  3: ArrowUp,
  4: ArrowDown,
  5: ArrowLeft,
  6: ArrowRight,
  7: Check,
  8: Undo2,
  9: House,
  10: Menu,
  12: Volume2,
  13: Volume1,
  14: VolumeX,
  19: SettingsIcon,
};
export function KeyIcon({ id }: { id: number }) {
  const Icon = icons[id];
  return Icon ? <Icon size={17} /> : <span>{labels[id] ?? id}</span>;
}
export function ModelRemote({
  model,
  mini = false,
  onKey,
  keys,
}: {
  model: string;
  mini?: boolean;
  onKey?: (id: number) => void;
  keys?: number[];
}) {
  const resource = remoteModels.get(model);
  if (!resource)
    return (
      <div className="muted">
        {mini ? <Radio size={32} /> : "此型号使用按键列表"}
      </div>
    );
  const layout = artworkModel(resource).layout;
  const drawnKeys = resource.keys.filter((k) => !keys || keys.includes(k.id));
  const buttons = layout.buttons.filter((b) =>
    drawnKeys.some((k) => k.id === b.key),
  );
  // Built-in artwork contains structural pieces (direction ring / volume rocker).
  // Its transparent hit areas must remain transparent, including thumbnails.
  const generated = !resource.image || layout.artworkButtons;
  const artwork =
    mini && generated
      ? renderRemoteArtwork({
          ...resource,
          keys: drawnKeys,
          layout: { ...layout, buttons },
        })
      : !generated
        ? resource.image
        : undefined;
  const image = artwork
    ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(artwork)}`
    : undefined;
  return (
    <div
      className={`model-remote ${mini ? "model-mini" : "model-full"} ${image ? "has-artwork" : ""}`}
      aria-hidden={mini || undefined}
      style={{
        aspectRatio: `${layout.width}/${layout.height}`,
        width: mini
          ? Math.min(66, (170 * layout.width) / layout.height)
          : undefined,
        transform: mini ? `rotate(${layout.angle ?? -9}deg)` : undefined,
      }}
    >
      {image && (
        <img className="model-artwork" src={image} alt="" draggable={false} />
      )}
      {(!mini || !generated) &&
        buttons.map((b) => {
          const definition = resource.keys.find((k) => k.id === b.key)!;
          const props = {
            className: `model-button ${b.key === 2 ? "voice" : ""}`,
            style: {
              left: `${b.x}%`,
              top: `${b.y}%`,
              width: `${b.width}%`,
              height: `${b.height}%`,
              borderRadius: `${b.radius}%`,
              background: b.fill,
              color: b.color,
              borderColor: b.border,
              fontSize: mini
                ? Math.min(
                    6,
                    (Math.min(66, (170 * layout.width) / layout.height) *
                      b.width) /
                      100 /
                      (Math.max(
                        1,
                        [...(b.symbol || labels[b.key] || definition.label)]
                          .length,
                      ) *
                        1.2),
                  )
                : undefined,
            },
          };
          const renamed = definition.label !== labels[b.key];
          const symbol = renamed ? (
            <span>{definition.label}</span>
          ) : b.symbol ? (
            <span>{b.symbol}</span>
          ) : b.key === 11 ? (
            <span>TV</span>
          ) : b.key === 12 ? (
            <span>+</span>
          ) : b.key === 13 ? (
            <span>−</span>
          ) : (
            <KeyIcon id={b.key} />
          );
          return mini ? (
            <span key={b.key} {...props}>
              {symbol}
            </span>
          ) : (
            <button
              key={b.key}
              {...props}
              aria-label={definition.label}
              disabled={keys && !keys.includes(b.key)}
              onClick={() => onKey?.(b.key)}
            >
              {symbol}
            </button>
          );
        })}
    </div>
  );
}
