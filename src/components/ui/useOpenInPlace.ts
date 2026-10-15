"use client";

// Opening one group of an accordion CLEANLY — shared by the two Look pickers
// (Social design's, in SwiftLinkDesign, and the card's, CardLookPicker), which
// are the same control on two screens.
//
// Measured in tests/render/look-picker-open.interactive.test.ts, two things
// went wrong on every tap (owner, 2026-09-29):
//   1. Only one group is open at a time, so opening Glass while Solid is open
//      collapses Solid's ten looks ABOVE it and the row you tapped flew ~500px
//      up the screen, out from under your finger — the next tap could land on
//      a different row.
//   2. Opening a group in the lower half of the screen left its looks below
//      the fold, so it looked like nothing had happened.
// Fix: remember where the tapped row was; after React commits (before paint),
// scroll by however far it moved so it stays put — instantly, so there is
// nothing to see — then glide just far enough to show the looks.

import { useLayoutEffect, useRef } from "react";

export function useOpenInPlace<K extends string>(open: K | null) {
  const rowRefs = useRef<Partial<Record<K, HTMLButtonElement | null>>>({});
  const groupRefs = useRef<Partial<Record<K, HTMLDivElement | null>>>({});
  const tapped = useRef<{ key: K; top: number } | null>(null);

  /** Call on the row's tap, BEFORE the state change that opens or closes it. */
  function noteTap(key: K, isOpen: boolean) {
    const row = rowRefs.current[key];
    tapped.current = !isOpen && row ? { key, top: row.getBoundingClientRect().top } : null;
  }

  useLayoutEffect(() => {
    const t = tapped.current;
    tapped.current = null;
    if (!t || open !== t.key) return;
    const row = rowRefs.current[t.key];
    const group = groupRefs.current[t.key];
    if (!row || !group) return;
    // 1 — keep the row where it was. Whatever scrolls this panel: the page in
    // the editors, a scrolling pop-up in the website builder.
    const moved = row.getBoundingClientRect().top - t.top;
    if (Math.abs(moved) > 1) {
      const scroller = scrollParentOf(row);
      if (scroller) scroller.scrollTop += moved;
      else window.scrollBy(0, moved);
    }
    // 2 — then bring the opened looks on screen: the least scroll that shows
    // the whole group, but never so far that the row you tapped slides under
    // something pinned at the top. The visible area is MEASURED, not assumed:
    // the website builder pins a live preview over the top of its pop-up on a
    // phone, and Office branding has the tab bar along the bottom.
    const raf = requestAnimationFrame(() => {
      const scroller = scrollParentOf(row);
      const { top: safeTop, bottom: safeBottom } = visibleBand(row, scroller);
      const g = group.getBoundingClientRect();
      const r = row.getBoundingClientRect();
      const need = g.bottom - safeBottom;
      if (need <= 0) return;
      const by = Math.min(need, Math.max(0, r.top - safeTop));
      if (by < 1) return;
      const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      const opts: ScrollToOptions = { top: by, behavior: reduce ? "auto" : "smooth" };
      if (scroller) scroller.scrollBy(opts);
      else window.scrollBy(opts);
    });
    return () => cancelAnimationFrame(raf);
  }, [open]);

  return { rowRefs, groupRefs, noteTap };
}

/** The nearest ancestor that scrolls (a pop-up's body), or null for the page. */
function scrollParentOf(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p && p !== document.body && p !== document.documentElement; p = p.parentElement) {
    const oy = getComputedStyle(p).overflowY;
    if ((oy === "auto" || oy === "scroll") && p.scrollHeight > p.clientHeight) return p;
  }
  return null;
}

/**
 * The part of the screen `el` can actually be seen in: its scroller's box (or
 * the window), less anything pinned over the top or bottom of it — a sticky
 * header or live preview, a fixed tab bar. Pinned things are found by what
 * they ARE (position sticky/fixed, overlapping this column, not an ancestor of
 * `el`), so a new bar anywhere in the product is respected without a number
 * here to keep in sync. 8px of air on each side.
 */
function visibleBand(el: HTMLElement, scroller: HTMLElement | null): { top: number; bottom: number } {
  const box = scroller?.getBoundingClientRect();
  let top = box ? box.top : 0;
  let bottom = box ? box.bottom : window.innerHeight;
  const mid = (top + bottom) / 2;
  const col = el.getBoundingClientRect();
  const scope = scroller ?? document.body;
  for (const n of scope.querySelectorAll<HTMLElement>('[class*="sticky"], [class*="fixed"]')) {
    if (n.contains(el)) continue;
    const pos = getComputedStyle(n).position;
    if (pos !== "sticky" && pos !== "fixed") continue;
    const b = n.getBoundingClientRect();
    if (b.width === 0 || b.height === 0 || b.right <= col.left || b.left >= col.right) continue;
    if (b.bottom <= top || b.top >= bottom) continue;
    // A full-screen layer is a BACKDROP (the wizard's dimmed overlay behind
    // its pop-up), not a bar — it covers nothing the person can see past.
    if (b.height >= (bottom - top) * 0.9) continue;
    if ((b.top + b.bottom) / 2 < mid) top = Math.max(top, b.bottom);
    else bottom = Math.min(bottom, b.top);
  }
  return { top: top + 8, bottom: bottom - 8 };
}
