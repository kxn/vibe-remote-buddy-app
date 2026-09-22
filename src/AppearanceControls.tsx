import {appearanceFields} from "./core/layout-policy";
import React from "react";
import {appearanceOf, withAppearance} from "./core/remote-artwork";
export {appearanceOf, withAppearance} from "./core/remote-artwork";
import type { RemoteModel } from "./core/models";
export function AppearanceControls({
  model,
  change,
  disabled = false,
}: {
  model: RemoteModel;
  change: (m: RemoteModel) => void;
  disabled?: boolean;
}) {
  const a = appearanceOf(model);
  return (
    <fieldset className="appearance-controls" disabled={disabled}>
      <legend>外壳颜色</legend>
      <div className="shell-colors">
        {(
          [
            ["black", "黑"],
            ["silver", "银"],
            ["white", "白"],
          ] as const
        ).map(([color, label]) => (
          <button
            type="button"
            key={color}
            aria-pressed={a.color === color}
            onClick={() => change(withAppearance(model, { color }))}
          >
            <i className={`shell-swatch ${color}`} />
            {label}
          </button>
        ))}
      </div>
      {appearanceFields.map(([key, label, min, max, step]) => (
        <label key={key}>
          <span>
            {label}
            <output>{Math.round(a[key] * 100)}%</output>
          </span>
          <input
            type="range"
            min={min}
            max={max}
            step={step}
            value={a[key]}
            onChange={(e) =>
              change(withAppearance(model, { [key]: Number(e.target.value) }))
            }
          />
        </label>
      ))}
    </fieldset>
  );
}
