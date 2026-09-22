import { OperationDialog } from "./OperationDialog";
import {
  Children,
  isValidElement,
  useEffect,
  useState,
  useRef,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

const layer = document.createElement("div");
layer.className = "feedback-layer";
document.body.appendChild(layer);

function messageText(children: ReactNode): string {
  return Children.toArray(children)
    .map((child) => {
      if (typeof child === "string" || typeof child === "number")
        return String(child);
      if (isValidElement<{ children?: ReactNode }>(child))
        return child.type === "button" ? "" : messageText(child.props.children);
      return "";
    })
    .join("");
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
  const [details, setDetails] = useState(false);
  const [truncated, setTruncated] = useState(false);
  const summary = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const element = summary.current;
    if (!element) return;
    const check = () =>
      setTruncated(element.scrollHeight > element.clientHeight + 1);
    const observer = new ResizeObserver(check);
    observer.observe(element);
    check();
    return () => observer.disconnect();
  }, [message]);
  const [expired, setExpired] = useState<string>();
  useEffect(() => {
    setExpired(undefined);
    if (persistent) return;
    const timer = window.setTimeout(() => setExpired(message), 8000);
    return () => window.clearTimeout(timer);
  }, [message, persistent]);
  if (!persistent && expired === message && !details) return null;
  const item = (
    <div
      className={`feedback-item${error ? " feedback-error" : ""}`}
      role={error ? "alert" : "status"}
    >
      <div className="feedback-summary">
        <span className="feedback-text" ref={summary}>
          {Children.toArray(children).filter(
            (child) => !isValidElement(child) || child.type !== "button",
          )}
        </span>
        {Children.toArray(children).filter(
          (child) => isValidElement(child) && child.type === "button",
        )}
      </div>
      {(truncated || message.length > 100) && (
        <button className="quiet" onClick={() => setDetails(true)}>
          详情
        </button>
      )}
    </div>
  );
  // Native modal dialogs occupy the browser top layer; their feedback must too.
  return (
    <>
      {details && (
        <OperationDialog
          title={error ? "错误详情" : "提示详情"}
          close={() => setDetails(false)}
        >
          <p className="feedback-detail">{message}</p>
        </OperationDialog>
      )}
      {createPortal(
        within ? <div className="feedback-layer">{item}</div> : item,
        within ?? layer,
      )}
    </>
  );
}
