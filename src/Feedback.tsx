import type { ReactNode } from "react";
import { createPortal } from "react-dom";

const layer = document.createElement("div");
layer.className = "feedback-layer";
document.body.appendChild(layer);

/** Transient feedback is outside document/dialog flow. */
export function Feedback({
  children,
  error = false,
  within,
}: {
  children: ReactNode;
  error?: boolean;
  within?: HTMLElement | null;
}) {
  const item = (
    <div
      className={`feedback-item${error ? " feedback-error" : ""}`}
      role={error ? "alert" : "status"}
    >
      {children}
    </div>
  );
  // Native modal dialogs occupy the browser top layer; their feedback must too.
  return createPortal(
    within ? <div className="feedback-layer">{item}</div> : item,
    within ?? layer,
  );
}
