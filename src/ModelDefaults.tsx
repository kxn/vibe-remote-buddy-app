import {keyConfirmation} from "./core/voice-protocols";
import { AppearanceControls } from "./AppearanceControls";
import { RemotePreview } from "./RemotePreview";
import { makeOverride } from "./core/model-overrides";
import React, { useState } from "react";
import { ModelEditor } from "./ModelEditor";
import { Feedback } from "./Feedback";
import { call } from "./native";
import { type RemoteModel, validateModel } from "./core/models";

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
      const m = validateModel({ ...draft, revision: model.revision });
      const visualChanged =
        JSON.stringify(m.layout) !== JSON.stringify(model.layout) ||
        m.keys.some(
          (k) => k.label !== model.keys.find((old) => old.id === k.id)?.label,
        );
      if (visualChanged || !model.image) m.layout.artworkButtons = true;
      await call("save_model_override", {
        id: m.id,
        value: makeOverride(model, m),
      });
      await service.reloadModels(!!service.snapshot.board);
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
        className="dialog model-defaults"
        role="dialog"
        aria-modal="true"
        aria-label="型号默认配置"
      >
        <h2>型号默认配置</h2>
        <p className="muted">用于新配对和恢复默认；现有个人设置保持不变。</p>
        <div className="defaults-body">
          <fieldset disabled={busy}>
            <label>
              机型名称
              <input
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              />
            </label>
            <label>
              添加时确认按键
              <select
                value={
                  keyConfirmation(draft)
                }
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    onboarding: {
                      keyConfirmation: e.target.value as "required" | "skip",
                    },
                  })
                }
              >
                <option value="required">需要</option>
                <option value="skip">不需要</option>
              </select>
            </label>
            <details><summary>外观</summary><AppearanceControls model={draft} change={setDraft} disabled={busy}/></details>
            <ModelEditor model={draft} update={setDraft} existing />
          </fieldset>
          <div className="defaults-preview">
            <RemotePreview
              model={{
                ...draft,
                image: draft.image,
                layout: {
                  ...draft.layout,
                  artworkButtons:
                    JSON.stringify(draft.layout) !==
                      JSON.stringify(model.layout) ||
                    draft.keys.some(
                      (k) =>
                        k.label !==
                        model.keys.find((old) => old.id === k.id)?.label,
                    ) ||
                    draft.layout.artworkButtons,
                },
              }}
            />
          </div>
        </div>
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
