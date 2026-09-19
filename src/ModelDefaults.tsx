import React, { useState } from "react";
import { ModelEditor } from "./ModelEditor";
import { Feedback } from "./Feedback";
import { call } from "./native";
import { type RemoteModel, validateModel } from "./core/models";
import { renderRemoteArtwork } from "./core/remote-artwork";
import { type BuddyService } from "./core/service";
export function ModelDefaults({
  model,
  service,
  close,
}: {
  model: RemoteModel;
  service: BuddyService;
  close: () => void;
}) {
  const [draft, setDraft] = useState(() => structuredClone(model)),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function save() {
    setBusy(true);
    setError("");
    try {
      const m = validateModel({ ...draft, revision: model.revision + 1 });
      const visualChanged = JSON.stringify(m.layout) !== JSON.stringify(model.layout) ||
        m.keys.some(k => k.label !== model.keys.find(old => old.id === k.id)?.label);
      if (visualChanged || !model.image) m.layout.artworkButtons = true;
      await call("update_remote_model", {
        model: m,
        image: visualChanged || !model.image ? renderRemoteArtwork(m) : model.image,
      });
      await service.reloadModels();
      close();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="shade">
      <section
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label="型号默认配置"
      >
        <h2>型号默认配置</h2>
        <p className="muted">用于新配对和恢复默认；现有个人设置保持不变。</p>
        <fieldset disabled={busy}>
          <ModelEditor model={draft} update={setDraft} existing />
        </fieldset>
        <footer>
          <button disabled={busy} onClick={close}>
            取消
          </button>
          <button
            disabled={busy}
            className="primary"
            onClick={() => void save()}
          >
            保存
          </button>
        </footer>
        {error && <Feedback error>{error}</Feedback>}
      </section>
    </div>
  );
}
