"use client";

import { useEffect, useRef } from "react";

// ── Keeps the current tab in view ──────────────────────────────────────────
// On a phone the tab row is wider than the screen and scrolls sideways; a
// later tab (Retention, Data quality, Closed accounts) opened from a link sat
// off the right edge, so the page didn't show which tab you were on. This
// slides the row so the current tab is centred. Only the row scrolls — never
// the page. `layout` changes whenever the tabs' text does (a count arriving
// widens every tab after it), so the row re-centres then too.
//
// 2026-10-28: and whenever a tab changes size for any other reason — the web
// font swapping in after first paint widens every tab, and a row centred on
// the fallback font's widths left the current tab off the edge again. The
// position is measured on screen (getBoundingClientRect), not offsetLeft,
// which counts from whatever ancestor happens to be positioned.

export function TabScroller({ active, layout = "" }: { active: string; layout?: string }) {
  const probe = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const row = probe.current?.closest(".adm-tabs") as HTMLElement | null;
    if (!row) return;
    const centre = () => {
      const tab = row.querySelector<HTMLElement>('[aria-current="page"]');
      if (!tab || row.scrollWidth <= row.clientWidth) return;
      const r = row.getBoundingClientRect();
      const t = tab.getBoundingClientRect();
      row.scrollLeft = Math.max(0, row.scrollLeft + (t.left - r.left) - (r.width - t.width) / 2);
    };
    centre();
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => centre());
    for (const child of Array.from(row.children)) ro?.observe(child);
    let live = true;
    void document.fonts?.ready.then(() => { if (live) centre(); });
    return () => { live = false; ro?.disconnect(); };
  }, [active, layout]);
  return <span ref={probe} hidden />;
}
