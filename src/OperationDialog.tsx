import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** Blocking operations live in the top layer, independently of page scroll. */
export function OperationDialog({
  title,
  children,
  close,
}: {
  title: string;
  children: ReactNode;
  close?: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = ref.current!;
    dialog.showModal();
    return () => {
      dialog.close();
      previous?.focus({ preventScroll: true });
    };
  }, []);
  return createPortal(
    <dialog
      ref={ref}
      className="operation-dialog"
      aria-label={title}
      onKeyDown={(e) => e.stopPropagation()}
      onCancel={(e) => {
        e.preventDefault();
        close?.();
      }}
    >
      <h2>{title}</h2>
      <div className="operation-content">{children}</div>
      {close && (
        <footer>
          <button onClick={close}>关闭</button>
        </footer>
      )}
    </dialog>,
    document.body,
  );
}
