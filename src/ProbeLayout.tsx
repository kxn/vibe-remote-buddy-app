import { Feedback } from "./Feedback";
import React, { useState } from "react";
import { type RemoteModel } from "./core/models";
import {
  standardKeys,
  gridColumns,
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
}: {
  model: RemoteModel;
  proofs: Record<number, KeyProof>;
  change: (m: RemoteModel) => void;
  verify: (key: number) => void;
  disabled: boolean;
}) {
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
      <div className="probe-layout-tip">
        <strong>将右侧常用按键拖入网格</strong>
        <span>已有按键优先使用常用类型；也可单击空格选择按键。</span>
      </div>
      <div className="probe-designer">
        <section>
          <div
            className="probe-grid"
            style={{
              gridTemplateColumns: `repeat(${gridColumns(model)}, minmax(0, 1fr))`,
            }}
            aria-label="遥控器布局"
          >
            {Array.from(
              { length: gridColumns(model) * (model.layout.editorRows ?? 8) },
              (_, cell) => {
                const k = model.keys.find((k) => cellOf(model, k.id) === cell);
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
          <small>单击空格添加 · 单击按键验证 · 拖动调整位置</small>
        </section>
        <aside>
          <strong>常用按键</strong>
          <div className="probe-palette">
            {standardKeys.map((k) => (
              <button
                key={k.id}
                disabled={disabled || model.keys.some((x) => x.id === k.id)}
                draggable={!disabled && !model.keys.some((x) => x.id === k.id)}
                onDragStart={(e) =>
                  e.dataTransfer.setData("application/buddy-key", String(k.id))
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
