import {gridRows,gridLimits} from "./core/layout-policy";
import {
  AppearanceControls,
  withAppearance,
  appearanceOf,
} from "./AppearanceControls";
import { RemotePreview } from "./RemotePreview";
import { Feedback } from "./Feedback";
import React, { useState } from "react";
import { type RemoteModel } from "./core/models";
import {
  standardKeys,
  gridColumns,
  resizeGrid,
  cellOf,
  placeKey,
  removeKey,
  type KeyProof,
} from "./core/probe-layout";

export function ProbeLayout({
  model,
  proofs,
  change,
  verify,
  disabled,
  preview,
  loadPreview,
  cancelPreview,
}: {
  model: RemoteModel;
  preview?: RemoteModel;
  loadPreview?: () => void;
  cancelPreview?: () => void;
  proofs: Record<number, KeyProof>;
  change: (m: RemoteModel) => void;
  verify: (key: number) => void;
  disabled: boolean;
}) {
  const [tab, setTab] = useState<"keys" | "appearance">("keys");
  const [adding, setAdding] = useState<number>(),
    [type, setType] = useState(""),
    [name, setName] = useState(""),
    [error, setError] = useState("");
  const put = (cell: number, id: number, label?: string) => {
    try {
      change(placeKey(model, cell, id, label));
      setError("");
      return true;
    } catch (e) {
      setError(String(e));
      return false;
    }
  };
  const open = (cell: number) => {
    if (disabled) return;
    setAdding(cell);
    setType("");
    setName("");
    setError("");
  };
  return (
    <>
      <div className="probe-designer">
        <section className="layout-canvas-panel">
          {preview && (
            <div
              className="layout-preview-overlay"
              role="region"
              aria-label="布局预览"
            >
              <header>
                <strong>布局预览</strong>
                <button disabled={disabled} onClick={cancelPreview}>
                  取消
                </button>
              </header>
              <div className="layout-preview-art">
                <RemotePreview model={preview} />
              </div>
              <footer>
                <span>{preview.title}</span>
                <button
                  className="primary"
                  disabled={disabled}
                  onClick={loadPreview}
                >
                  加载此布局
                </button>
              </footer>
            </div>
          )}
          {tab === "appearance" && (
            <div className="appearance-canvas">
              <RemotePreview
                model={model}
                onInsets={
                  disabled || preview
                    ? undefined
                    : (patch) => change(withAppearance(model, patch))
                }
                insets={appearanceOf(model)}
              />
            </div>
          )}
          <div
            className="layout-canvas-editor"
            hidden={tab !== "keys"}
            inert={!!preview}
          >
            <div className="layout-grid-toolbar">
              <strong>按键布局</strong>
              <div className="grid-dimensions">
                {(["列", "行"] as const).map((label, index) => {
                  const value = index
                    ? gridRows(model)
                    : gridColumns(model);
                  const limits = index ? gridLimits.rows : gridLimits.columns;
                  const minimum = limits.min, maximum = limits.max;
                  const resize = (delta: number) => {
                    try {
                      change(
                        resizeGrid(
                          model,
                          index ? gridColumns(model) : value + delta,
                          index
                            ? value + delta
                            : gridRows(model),
                        ),
                      );
                      setError("");
                    } catch (e) {
                      setError(String(e));
                    }
                  };
                  return (
                    <div className="grid-stepper" key={label}>
                      <button
                        aria-label={`减少${label}`}
                        disabled={disabled || value <= minimum}
                        onClick={() => resize(-1)}
                      >
                        −
                      </button>
                      <span>
                        {value} {label}
                      </span>
                      <button
                        aria-label={`增加${label}`}
                        disabled={disabled || value >= maximum}
                        onClick={() => resize(1)}
                      >
                        +
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
            <p className="muted layout-instruction">
              拖入右侧按键，或点击空格添加；点击按键验证。
            </p>
            <div className="layout-canvas-scroll">
              <div
                className="probe-grid"
                style={{
                  gridTemplateColumns: `repeat(${gridColumns(model)}, minmax(0, 1fr))`,
                }}
                aria-label="遥控器布局"
              >
                {Array.from(
                  {
                    length: gridColumns(model) * gridRows(model),
                  },
                  (_, cell) => {
                    const k = model.keys.find(
                      (k) => cellOf(model, k.id) === cell,
                    );
                    return (
                      <div
                        key={cell}
                        className="probe-cell"
                        onDragOver={(e) => {
                          if (!disabled) e.preventDefault();
                        }}
                        onDrop={(e) => {
                          e.preventDefault();
                          if (disabled) return;
                          const id = Number(
                            e.dataTransfer.getData("application/buddy-key"),
                          );
                          if (id) put(cell, id);
                        }}
                      >
                        {k ? (
                          <button
                            key={`key-${k.id}`}
                            disabled={disabled}
                            className={
                              proofs[k.id] && (k.id !== 2 || proofs[k.id].voice)
                                ? "verified"
                                : ""
                            }
                            draggable={!disabled}
                            onDragStart={(e) =>
                              e.dataTransfer.setData(
                                "application/buddy-key",
                                String(k.id),
                              )
                            }
                            onClick={() => verify(k.id)}
                          >
                            {k.label}
                            {proofs[k.id] && (k.id !== 2 || proofs[k.id].voice)
                              ? " ✓"
                              : ""}
                          </button>
                        ) : (
                          <button
                            key={`empty-${cell}`}
                            disabled={disabled}
                            className="empty"
                            aria-label={`空格 ${cell + 1}`}
                            onClick={() => open(cell)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                open(cell);
                              }
                            }}
                          />
                        )}
                      </div>
                    );
                  },
                )}
              </div>
            </div>
          </div>
        </section>
        <aside className="layout-palette-panel">
          <div className="layout-tabs" role="tablist" aria-label="布局编辑">
            <button
              role="tab"
              aria-selected={tab === "keys"}
              onClick={() => setTab("keys")}
            >
              常用按键
            </button>
            <button
              role="tab"
              disabled={disabled || !!preview}
              aria-selected={tab === "appearance"}
              onClick={() => {
                if (!model.layout.appearance) change(withAppearance(model, {}));
                setTab("appearance");
              }}
            >
              外观
            </button>
          </div>
          {tab === "appearance" && (
            <AppearanceControls
              model={model}
              change={change}
              disabled={disabled || !!preview}
            />
          )}
          <div className="palette-content" hidden={tab !== "keys"}>
            <div className="probe-palette">
              {standardKeys.map((k) => (
                <button
                  key={k.id}
                  disabled={disabled || model.keys.some((x) => x.id === k.id)}
                  draggable={
                    !disabled && !model.keys.some((x) => x.id === k.id)
                  }
                  onDragStart={(e) =>
                    e.dataTransfer.setData(
                      "application/buddy-key",
                      String(k.id),
                    )
                  }
                >
                  {k.label}
                </button>
              ))}
            </div>
            <div
              className="probe-trash"
              onDragOver={(e) => {
                if (!disabled) e.preventDefault();
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (!disabled)
                  change(
                    removeKey(
                      model,
                      Number(e.dataTransfer.getData("application/buddy-key")),
                    ),
                  );
              }}
            >
              拖到这里移除
            </div>
          </div>
        </aside>
      </div>
      {error && adding === undefined && <Feedback error>{error}</Feedback>}
      {adding !== undefined && (
        <div
          className="probe-modal-layer"
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Escape") setAdding(undefined);
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-label="添加按键"
            className="probe-modal"
          >
            <h3>添加按键</h3>
            <label>
              按键类型
              <select
                autoFocus
                value={type}
                onChange={(e) => setType(e.target.value)}
              >
                <option value="">选择常用按键</option>
                {standardKeys.map((k) => (
                  <option
                    key={k.id}
                    value={k.id}
                    disabled={model.keys.some((x) => x.id === k.id)}
                  >
                    {k.label}
                  </option>
                ))}
                <option value="custom">自定义</option>
              </select>
            </label>
            {type === "custom" && (
              <label>
                名称
                <input
                  maxLength={24}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
            )}
            {error && <Feedback error>{error}</Feedback>}
            <div className="probe-actions">
              <button onClick={() => setAdding(undefined)}>取消</button>
              <button
                disabled={!type}
                onClick={() => {
                  let id = Number(type);
                  if (type === "custom")
                    id =
                      Array.from({ length: 29 }, (_, i) => i + 35).find(
                        (id) => !model.keys.some((k) => k.id === id),
                      ) ?? 0;
                  if (put(adding, id, name)) setAdding(undefined);
                }}
              >
                添加
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
