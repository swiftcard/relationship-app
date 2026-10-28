// ── The pieces that navigate: tabs, "See all →", clickable KPI tiles ───────
// Real links (next/link), so a tab works before hydration, can be bookmarked,
// and the Back button walks back through tabs. Kept apart from layout.tsx
// because the render tests bundle some admin clients without Next's router.

import Link from "next/link";
import { Kpi } from "./layout";
import { Icon } from "./icons";
import { TabScroller } from "./TabScroller";

export type TabItem = { key: string; label: string; count?: number | null };

/** The section's sub-pages as `?tab=` links. `base` is the page's path. */
export function Tabs({ base, items, active, extra = {} }: { base: string; items: TabItem[]; active: string; extra?: Record<string, string> }) {
  return (
    <nav aria-label="Sections" className="adm-tabs -mx-4 px-4 sm:mx-0 sm:px-0">
      {items.map((t, i) => {
        const qs = new URLSearchParams({ ...extra, ...(i === 0 ? {} : { tab: t.key }) }).toString();
        return (
          <Link key={t.key} href={qs ? `${base}?${qs}` : base} scroll={false} className="adm-tab" aria-current={t.key === active ? "page" : undefined}>
            {t.label}
            {typeof t.count === "number" && <span className="adm-tab-count">{t.count.toLocaleString("en-US")}</span>}
          </Link>
        );
      })}
      <TabScroller active={active} layout={items.map((t) => `${t.label}${t.count ?? ""}`).join("|")} />
    </nav>
  );
}

export function SeeAll({ href, children = "See all" }: { href: string; children?: React.ReactNode }) {
  return (
    <Link href={href} className="adm-link sc-t-footnote inline-flex items-center gap-0.5 min-h-[28px]">
      {children}
      <Icon name="chevron" className="w-3.5 h-3.5" />
    </Link>
  );
}

/** A KPI tile that opens the page behind the number. */
export function KpiLink({ href, ...props }: React.ComponentProps<typeof Kpi> & { href: string }) {
  return (
    <Link href={href} className="adm-card adm-kpi block group">
      <Kpi {...props} />
    </Link>
  );
}

/** "← Users" — the way back up from a detail page. */
export function BackLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="adm-link sc-t-subhead inline-flex items-center gap-1.5 min-h-[36px]">
      <Icon name="back" className="w-4 h-4" />
      {children}
    </Link>
  );
}
