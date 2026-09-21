import React, { useState } from "react";
import type { BuddyService } from "./core/service";
import { ModelDefaults } from "./ModelDefaults";
import { RemotePreview } from "./RemotePreview";
import { Feedback } from "./Feedback";
import { call } from "./native";
export function ModelLibrary({
  service,
  close,
  add,
}: {
  service: BuddyService;
  close: () => void;
  add: (id: string) => void;
}) {
  const [query, setQuery] = useState(""),
    [selected, setSelected] = useState(service.pairingModels[0]?.id ?? ""),
    [editing, setEditing] = useState(false),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState(false),
    [, refresh] = useState(0),
    [reset, setReset] = useState(false);
  const model = service.pairingModels.find((m) => m.id === selected);
  async function run(work: () => Promise<void>, done: string) {
    setBusy(true);
    setMessage("");
    try {
      await work();
      refresh((x) => x + 1);
      setError(false);
      setMessage(done);
    } catch (e) {
      setError(true);
      setMessage(String(e));
    } finally {
      setBusy(false);
    }
  }
  if (editing && model)
    return (
      <ModelDefaults
        model={model}
        service={service}
        close={() => {
          setEditing(false);
          refresh((x) => x + 1);
        }}
      />
    );
  return (
    <div className="shade">
      <section
        className="dialog model-library"
        role="dialog"
        aria-modal="true"
        aria-label="机型库"
      >
        <header>
          <h2>机型库</h2>
          <button disabled={busy} onClick={close}>
            关闭
          </button>
        </header>
        <div className="library-toolbar">
          <input
            aria-label="搜索机型"
            placeholder="搜索机型"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button
            disabled={busy}
            onClick={() =>
              void run(() => service.updateCatalog(), "机型库已更新")
            }
          >
            检查更新
          </button>
          <button
            disabled={busy || service.snapshot.info?.catalog_api !== 2}
            onClick={() =>
              void run(() => service.installCatalog(), "已同步到接收器")
            }
          >
            同步到接收器
          </button>
        </div>
        <div className="library-body">
          <div className="library-list">
            {service.pairingModels
              .filter((m) =>
                `${m.title} ${m.id}`
                  .toLowerCase()
                  .includes(query.toLowerCase()),
              )
              .map((m) => (
                <button
                  key={m.id}
                  className={selected === m.id ? "selected" : ""}
                  onClick={() => setSelected(m.id)}
                >
                  <strong>{m.title}</strong>
                  <small>
                    {service.overriddenModels.has(m.id)
                      ? "本地已修改"
                      : `版本 ${m.revision}`}
                  </small>
                </button>
              ))}
          </div>
          <div className="library-detail">
            {model ? (
              <>
                <RemotePreview model={model} />
                <h3>{model.title}</h3>
                <small>{model.keys.length} 个按键</small>
              </>
            ) : (
              <p>暂无机型</p>
            )}
          </div>
        </div>
        <footer>
          <button
            disabled={busy || !model || !service.overriddenModels.has(selected)}
            onClick={() => setReset(true)}
          >
            恢复库默认值
          </button>
          <button
            disabled={busy || !model || !service.snapshot.board}
            onClick={() => add(selected)}
          >
            连接验证
          </button>
          <button
            className="primary"
            disabled={busy || !model}
            onClick={() => setEditing(true)}
          >
            编辑默认配置
          </button>
        </footer>
        {message && <Feedback error={error}>{message}</Feedback>}
        {reset && (
          <div className="probe-modal-layer">
            <section
              className="probe-modal"
              role="dialog"
              aria-modal="true"
              aria-label="恢复库默认值"
            >
              <h3>恢复库默认值？</h3>
              <p>将移除此机型的本地修改，已配对设备不受影响。</p>
              <footer>
                <button disabled={busy} onClick={() => setReset(false)}>
                  取消
                </button>
                <button
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await call("save_model_override", {
                        id: selected,
                        value: null,
                      });
                      await service.reloadModels(!!service.snapshot.board);
                      setReset(false);
                    }, "已恢复默认配置")
                  }
                >
                  恢复
                </button>
              </footer>
            </section>
          </div>
        )}
      </section>
    </div>
  );
}
