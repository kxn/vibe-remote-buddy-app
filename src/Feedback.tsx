import { Children, isValidElement, useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

const layer = document.createElement("div");
layer.className = "feedback-layer";
document.body.appendChild(layer);

function messageText(children: ReactNode): string {
  return Children.toArray(children).map(child => {
    if (typeof child === "string" || typeof child === "number") return String(child);
    if (isValidElement<{ children?: ReactNode }>(child))
      return child.type === "button" ? "" : messageText(child.props.children);
    return "";
  }).join("");
}

/** Transient feedback is outside document/dialog flow. */
export function Feedback({
  children,
  error = false,
  within,
  persistent = false,
}: {
  children: ReactNode;
  error?: boolean;
  within?: HTMLElement | null;
  persistent?: boolean;
}) {
  const message = messageText(children);
  const [expired, setExpired] = useState<string>();
  useEffect(() => {
    setExpired(undefined);
    if (persistent) return;
    const timer = window.setTimeout(() => setExpired(message), 8000);
    return () => window.clearTimeout(timer);
  }, [message, persistent]);
  if (!persistent && expired === message) return null;
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
