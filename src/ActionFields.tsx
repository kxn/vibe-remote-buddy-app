import { Feedback } from "./Feedback";
import { useState } from "react";
import { call } from "./native";
import type { Action } from "./core/types";
export function ActionFields({
  action,
  change,
  disabled,
}: {
  action: Action;
  change: (a: Action) => void;
  disabled: boolean;
}) {
  const [error, setError] = useState("");
  return (
    <fieldset disabled={disabled} className="action-fields">
      {action.kind === "app" && (
        <>
          <label className="field">
            应用程序
            <input readOnly value={action.target} />
          </label>
          <button
            onClick={() =>
              void call<string | null>("choose_application")
                .then(
                  (p) =>
                    p &&
                    change({
                      ...action,
                      target: p,
                      label: `切换到 ${p.split(/[\\/]/).at(-1)}`,
                    }),
                )
                .catch((e) => setError(String(e)))
            }
          >
            选择应用文件
          </button>
        </>
      )}
      {action.kind === "web" && (
        <label className="field">
          网址
          <input
            value={action.target}
            placeholder="https://"
            onChange={(e) =>
              change({ ...action, target: e.target.value, label: "打开网页" })
            }
          />
        </label>
      )}
      <p className="muted">需要 Vibe Remote Buddy 在后台运行。</p>
      {error && <Feedback error>{error}</Feedback>}
    </fieldset>
  );
}
