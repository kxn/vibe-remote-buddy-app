import { useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { call } from "./native";
import type { DesktopWindow } from "./core/actions";
export function WindowPicker() {
  const [windows, setWindows] = useState<DesktopWindow[]>([]),
    [index, setIndex] = useState(0),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  const closing = useRef(false),
    activating = useRef(false);
  const close = () => {
    if (closing.current) return;
    closing.current = true;
    void getCurrentWindow()
      .close()
      .catch((e) => {
        closing.current = false;
        setError(String(e));
      });
  };
  const activate = async (w: DesktopWindow) => {
    if (activating.current) return;
    activating.current = true;
    setBusy(true);
    try {
      await call("desktop_activate", { window: w });
      close();
    } catch (e) {
      setError(String(e));
      setBusy(false);
      activating.current = false;
      if (!document.hasFocus()) close();
    }
  };
  useEffect(() => {
    void call<DesktopWindow[]>("desktop_windows")
      .then(setWindows)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    list.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [index]);
  // This is a normal focused window: firmware HID arrows/Enter operate it without a global hook.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (
        [
          "ArrowUp",
          "ArrowDown",
          "ArrowLeft",
          "ArrowRight",
          "Enter",
          "Escape",
          "Backspace",
        ].includes(e.key)
      ) {
        e.preventDefault();
        e.stopPropagation();
        if (busy) return;
        if (e.key === "Escape" || e.key === "Backspace") close();
        else if (e.key === "Enter" && windows[index])
          void activate(windows[index]);
        else if (windows.length)
          setIndex(
            (i) =>
              (i +
                (["ArrowUp", "ArrowLeft"].includes(e.key) ? -1 : 1) +
                windows.length) %
              windows.length,
          );
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [windows, index, busy]);
  useEffect(() => {
    if (loading) return;
    let disposed = false,
      armed = false,
      confirming = false;
    const blur = () => {
      if (armed && !activating.current) close();
    };
    window.addEventListener("blur", blur);
    const confirm = () => {
      if (disposed || armed || confirming || !document.hasFocus()) return;
      list.current?.focus({ preventScroll: true });
      confirming = true;
      void call("picker_confirm")
        .then(() => {
          armed = true;
          if (!document.hasFocus()) blur();
        })
        .catch(() => {})
        .finally(() => {
          confirming = false;
        });
    };
    void call("picker_prepared", { error: error || null }).catch((e) =>
      setError(String(e)),
    );
    const timer = window.setInterval(confirm, 25);
    return () => {
      disposed = true;
      clearInterval(timer);
      window.removeEventListener("blur", blur);
    };
  }, [loading]);
  return (
    <main className="window-picker">
      <header>
        <h1>窗口选择</h1>
        <button onClick={close} aria-label="关闭">
          ×
        </button>
      </header>
      {loading ? (
        <p>正在读取窗口…</p>
      ) : !windows.length ? (
        <p>暂无可切换窗口</p>
      ) : (
        <div
          ref={list}
          tabIndex={-1}
          className="window-list"
          role="listbox"
          aria-label="打开的窗口"
        >
          {windows.map((w, i) => (
            <button
              key={w.token}
              role="option"
              aria-selected={i === index}
              disabled={busy}
              onFocus={() => setIndex(i)}
              onMouseEnter={() => setIndex(i)}
              onClick={() => void activate(w)}
            >
              <strong>{w.title}</strong>
              <span>{w.process}</span>
            </button>
          ))}
        </div>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </main>
  );
}
