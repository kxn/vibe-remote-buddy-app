/** A modal owns scrolling even when the pointer is over its backdrop.
 * Route within the top dialog only; never chain to an underlying page/dialog. */
export function installModalScroll() {
  function topModal(): HTMLElement | undefined {
    const visible = Array.from(document.querySelectorAll<HTMLElement>(
      '[role="dialog"][aria-modal="true"], dialog[open]',
    )).filter(e => e.getClientRects().length && getComputedStyle(e).visibility !== "hidden");
    const native = visible.filter(e => e.matches("dialog:modal"));
    return (native.length ? native : visible).at(-1);
  }
  function scrollable(e: HTMLElement, horizontal: boolean) {
    const style = getComputedStyle(e);
    return /auto|scroll/.test(horizontal ? style.overflowX : style.overflowY) &&
      (horizontal ? e.scrollWidth > e.clientWidth : e.scrollHeight > e.clientHeight);
  }
  const wheel = (event: WheelEvent) => {
    const root = topModal();
    if (!root || event.ctrlKey) return; // Preserve browser accessibility zoom.
    event.preventDefault();
    const horizontal = Math.abs(event.deltaX) > Math.abs(event.deltaY) || event.shiftKey;
    const amount = (horizontal ? event.deltaX || event.deltaY : event.deltaY) *
      (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? root.clientHeight : 1);
    let target = event.target instanceof HTMLElement ? event.target : null;
    if (!target || !root.contains(target)) {
      // Prefer the main scrolling region over a tiny list/control in the dialog.
      target = [root, ...root.querySelectorAll<HTMLElement>("*")]
        .filter(e => e.getClientRects().length && scrollable(e, horizontal))
        .sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0] ?? root;
    }
    while (target && root.contains(target)) {
      if (scrollable(target, horizontal)) {
        const before = horizontal ? target.scrollLeft : target.scrollTop;
        if (horizontal) target.scrollLeft += amount;
        else target.scrollTop += amount;
        if ((horizontal ? target.scrollLeft : target.scrollTop) !== before) return;
      }
      if (target === root) break;
      target = target.parentElement;
    }
  };
  const sync = () => document.documentElement.classList.toggle("modal-open", !!topModal());
  const observer = new MutationObserver(sync);
  observer.observe(document.body, { childList: true, subtree: true, attributes: true,
    attributeFilter: ["open", "aria-modal", "hidden"] });
  document.addEventListener("wheel", wheel, { capture: true, passive: false });
  sync();
  return () => {
    observer.disconnect();
    document.removeEventListener("wheel", wheel, true);
    document.documentElement.classList.remove("modal-open");
  };
}
