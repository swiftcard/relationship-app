"use client";

import { useEffect, useRef } from "react";

// ── Keeps the current tab in view ──────────────────────────────────────────
// On a phone the tab row is wider than the screen and scrolls sideways; a
// later tab (Retention, Data quality, Closed accounts) opened from a link sat
// off the right edge, so the page didn't show which tab you were on. This
// slides the row so the current tab is centred. Only the row scrolls — never
// the page. `layout` changes whenever the tabs' text does (a count arriving
// widens every tab after it), so the row re-centres then too.

export function TabScroller({ active, layout = "" }: { active: string; layout?: string }) {
  const probe = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const row = probe.current?.closest(".adm-tabs") as HTMLElement | null;
    const tab = row?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!row || !tab || row.scrollWidth <= row.clientWidth) return;
    row.scrollLeft = Math.max(0, tab.offsetLeft - (row.clientWidth - tab.offsetWidth) / 2);
  }, [active, layout]);
  return <span ref={probe} hidden />;
}
