// ── Tabs that switch in place ──────────────────────────────────────────────
// Same look as <Tabs> (./links.tsx), for pages that already hold all their
// data in the browser (Users, a user's page), so switching never refetches.
// The caller mirrors the choice into ?tab= so a reload or a shared link lands
// on the same tab. No next/link: the Users render tests bundle this without
// Next's router.

import type { TabItem } from "./links";
import { TabScroller } from "./TabScroller";

export function TabButtons({ items, active, onSelect, label = "Sections" }: { items: TabItem[]; active: string; onSelect: (key: string) => void; label?: string }) {
  return (
    <div role="tablist" aria-label={label} className="adm-tabs -mx-4 px-4 sm:mx-0 sm:px-0">
      {items.map((t) => (
        <button
          key={t.key}
          type="button"
          role="tab"
          aria-selected={t.key === active}
          aria-current={t.key === active ? "page" : undefined}
          onClick={() => onSelect(t.key)}
          className="adm-tab"
        >
          {t.label}
          {typeof t.count === "number" && <span className="adm-tab-count">{t.count.toLocaleString("en-US")}</span>}
        </button>
      ))}
      <TabScroller active={active} layout={items.map((t) => `${t.label}${t.count ?? ""}`).join("|")} />
    </div>
  );
}
