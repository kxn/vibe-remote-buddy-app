import React, { useEffect, useState } from "react";
import { validateModel, type RemoteModel } from "./core/models";
import { usages, media, modifiers } from "./core/layout";
export function ModelEditor({
  model,
  update,
}: {
  model: RemoteModel;
  update: (m: RemoteModel) => void;
}) {
  const [key, setKey] = useState(2),
    [draft, setDraft] = useState(() => structuredClone(model)),
    [error, setError] = useState("");
  useEffect(() => setDraft(structuredClone(model)), [model]);
  const k = draft.keys.find((k) => k.id === key) ?? draft.keys[0],
    b = draft.layout.buttons.find((b) => b.key === k.id)!;
  function change(fn: (m: RemoteModel) => void) {
    const m = structuredClone(draft);
    fn(m);
    setDraft(m);
  }
  function apply(m = draft) {
    try {
      update(validateModel(m));
      setError("");
    } catch (e) {
      setError(String(e));
    }
  }
  return (
    <div className="probe-editor">
      <label>
        按钮
        <select value={k.id} onChange={(e) => setKey(Number(e.target.value))}>
          {draft.keys.map((k) => (
            <option key={k.id} value={k.id}>
              {k.label}（{k.id}）
            </option>
          ))}
        </select>
      </label>
      <label>
        名称
        <input
          value={k.label}
          onChange={(e) =>
            change((m) => {
              m.keys.find((x) => x.id === k.id)!.label = e.target.value;
            })
          }
        />
      </label>
      <label>
        默认功能
        <select
          value={k.default[0]}
          onChange={(e) =>
            change((m) => {
              const v = Number(e.target.value);
              m.keys.find((x) => x.id === k.id)!.default =
                v === 0
                  ? [0, 0, 0]
                  : v === 1
                    ? [1, 0, 40]
                    : v === 2
                      ? [2, 0, 0]
                      : v === 3
                        ? [3, 64, 0]
                        : v === 4
                          ? [4, 0, 1]
                          : [5, 0, 1];
            })
          }
        >
          {(k.id === 2
            ? [
                [5, "输入法预设"],
                [3, "语音快捷键"],
              ]
            : [
                [0, "不执行"],
                [1, "键盘快捷键"],
                [2, "媒体键"],
                [4, "应用事件"],
              ]
          ).map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
      </label>
      {k.default[0] === 5 && (
        <label>
          输入法
          <select
            value={k.default[2]}
            onChange={(e) =>
              change((m) => {
                m.keys.find((x) => x.id === k.id)!.default[2] = Number(
                  e.target.value,
                );
              })
            }
          >
            <option value={1}>豆包输入法</option>
            <option value={2}>微信输入法</option>
          </select>
        </label>
      )}
      {[1, 3].includes(k.default[0]) && (
        <>
          <label>
            键
            <select
              value={k.default[2]}
              onChange={(e) =>
                change((m) => {
                  m.keys.find((x) => x.id === k.id)!.default[2] = Number(
                    e.target.value,
                  );
                })
              }
            >
              {usages.map(([v, l]) => (
                <option value={v} key={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <div className="probe-modifiers">
            {modifiers.map((l, i) => (
              <label key={l}>
                <input
                  type="checkbox"
                  checked={!!(k.default[1] & (1 << i))}
                  onChange={() =>
                    change((m) => {
                      m.keys.find((x) => x.id === k.id)!.default[1] ^= 1 << i;
                    })
                  }
                />
                {l}
              </label>
            ))}
          </div>
        </>
      )}
      {k.default[0] === 2 && (
        <label>
          媒体功能
          <select
            value={k.default[2]}
            onChange={(e) =>
              change((m) => {
                m.keys.find((x) => x.id === k.id)!.default[2] = Number(
                  e.target.value,
                );
              })
            }
          >
            {media.map((l, i) => (
              <option value={i} key={l}>
                {l}
              </option>
            ))}
          </select>
        </label>
      )}
      {k.default[0] === 4 && (
        <label>
          事件编号
          <input
            type="number"
            min={1}
            max={65535}
            value={k.default[2]}
            onChange={(e) =>
              change((m) => {
                m.keys.find((x) => x.id === k.id)!.default[2] = Number(
                  e.target.value,
                );
              })
            }
          />
        </label>
      )}
      <div className="probe-coordinates">
        {(
          [
            ["x", "横向位置"],
            ["y", "纵向位置"],
            ["width", "宽度"],
            ["height", "高度"],
            ["radius", "圆角"],
          ] as const
        ).map(([field, label]) => (
          <label key={field}>
            {label}
            <input
              type="number"
              min={0}
              max={100}
              step={0.5}
              value={b[field]}
              onChange={(e) =>
                change((m) => {
                  m.layout.buttons.find((x) => x.key === k.id)![field] = Number(
                    e.target.value,
                  );
                })
              }
            />
          </label>
        ))}
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="probe-actions">
        <button onClick={() => apply()}>保存按钮</button>
        <button
          onClick={() => {
            const m = structuredClone(draft);
            let id = 35;
            while (id <= 63 && m.keys.some((k) => k.id === id)) id++;
            if (id > 63) {
              setError("没有可用的按钮编号");
              return;
            }
            m.keys.push({ id, label: `按钮 ${id}`, default: [0, 0, 0] });
            m.layout.buttons.push({
              key: id,
              x: 50,
              y: 90,
              width: 18,
              height: 6,
              radius: 20,
            });
            apply(m);
            setKey(id);
          }}
        >
          新增按钮
        </button>
        <button
          disabled={k.id === 2}
          onClick={() => {
            const m = structuredClone(draft);
            m.keys = m.keys.filter((x) => x.id !== k.id);
            m.raw = m.raw.filter((x) => x.key !== k.id);
            m.layout.buttons = m.layout.buttons.filter((x) => x.key !== k.id);
            apply(m);
            setKey(2);
          }}
        >
          删除按钮
        </button>
      </div>
    </div>
  );
}
