"use client";
import { useEffect, useRef, type RefObject } from "react";

/**
 * The three things every overlay owes the keyboard and the screen reader,
 * in one place so no popup has to remember them on its own:
 *
 *   • Escape closes it.
 *   • Focus moves INTO it when it opens (to the element in `initialFocus`, or
 *     the first focusable control inside `panel`), so a keyboard or VoiceOver
 *     user is not left on a button under the backdrop.
 *   • Focus goes BACK to whatever opened it when it closes.
 *
 * Pair it with `role="dialog" aria-modal="true"` and an accessible name on the
 * panel — the hook handles behaviour, the markup handles semantics. Nothing
 * here touches layout, so a component that adopts it looks exactly as before.
 *
 * `open` false → the hook does nothing at all, so it is safe to call
 * unconditionally in a component that renders its overlay only when open.
 */
export function useDialogA11y(
  open: boolean,
  onClose: () => void,
  panel: RefObject<HTMLElement | null>,
  initialFocus?: RefObject<HTMLElement | null>,
) {
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    const node = panel.current;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); onCloseRef.current(); }
    };
    document.addEventListener("keydown", onKey);
    const target =
      initialFocus?.current ??
      node?.querySelector<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) ??
      node;
    target?.focus?.({ preventScroll: true });
    return () => {
      document.removeEventListener("keydown", onKey);
      // Only hand focus back if it is still somewhere inside the overlay (or
      // nowhere) — a click that moved focus elsewhere on the page keeps it.
      const active = document.activeElement;
      if (!active || active === document.body || node?.contains(active)) {
        opener?.focus?.({ preventScroll: true });
      }
    };
    // panel/initialFocus are refs — stable for the life of the mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
}
