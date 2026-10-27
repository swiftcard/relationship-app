// ── The page skeleton every admin screen is built from ─────────────────────
// PageHeader → tabs → KPI row → main chart → breakdowns → detail → footnote.
// Same order, same spacing, same card on every page: that sameness is what
// makes the console read as organized. No hooks and no next/link here, so
// these work in server components and in the render tests' bare bundles.

import type { Delta } from "./format";
import { fmtPct } from "./format";
import { Sparkline } from "./charts";

export function PageHeader({ title, description, actions }: { title: string; description: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="sc-t-title1">{title}</h1>
        <p className="adm-muted sc-t-subhead mt-1 max-w-2xl">{description}</p>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2 shrink-0">{actions}</div>}
    </header>
  );
}

/** Vertical rhythm for a page or a tab: 24px on a phone, 32px from sm up. */
export function Stack({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`space-y-6 sm:space-y-8 ${className}`}>{children}</div>;
}

/** Two columns from lg up, one on a phone. `wide` makes the first column 2/3. */
export function Columns({ children, wide = false }: { children: React.ReactNode; wide?: boolean }) {
  return <div className={`grid gap-4 sm:gap-5 grid-cols-1 ${wide ? "lg:grid-cols-3 lg:[&>*:first-child]:col-span-2" : "lg:grid-cols-2"}`}>{children}</div>;
}

/**
 * A card with a title, a one-line "what this tells you", and an optional
 * action (always top-right, e.g. "See all →").
 */
export function Section({
  title, hint, action, children, flush = false, className = "", id,
}: {
  title?: React.ReactNode; hint?: React.ReactNode; action?: React.ReactNode;
  children: React.ReactNode; flush?: boolean; className?: string; id?: string;
}) {
  const head = title || hint || action;
  return (
    <section id={id} className={`adm-card ${className}`}>
      {head && (
        <div className="px-4 sm:px-5 pt-4 sm:pt-5">
          <div className="flex items-start justify-between gap-3">
            {title && <h2 className="sc-t-headline min-w-0">{title}</h2>}
            {action && <div className="shrink-0">{action}</div>}
          </div>
          {hint && <p className="adm-muted sc-t-footnote mt-0.5">{hint}</p>}
        </div>
      )}
      <div className={flush ? (head ? "mt-3" : "") : `px-4 sm:px-5 pb-4 sm:pb-5 ${head ? "pt-4" : "pt-4 sm:pt-5"}`}>{children}</div>
    </section>
  );
}

export function KpiGrid({ children, cols = 4 }: { children: React.ReactNode; cols?: 2 | 3 | 4 | 5 | 6 }) {
  const lg = { 2: "lg:grid-cols-2", 3: "lg:grid-cols-3", 4: "lg:grid-cols-4", 5: "lg:grid-cols-5", 6: "lg:grid-cols-6" }[cols];
  const sm = cols >= 3 ? "sm:grid-cols-3" : "sm:grid-cols-2";
  return <div className={`grid gap-3 sm:gap-4 grid-cols-2 ${sm} ${lg}`}>{children}</div>;
}

/** The ▲/▼ chip. `goodWhen: "down"` for numbers where less is better (closed accounts). */
export function DeltaChip({ delta, goodWhen = "up", vs = "the previous 7 days" }: { delta: Delta; goodWhen?: "up" | "down"; vs?: string }) {
  if (delta.pct === null) {
    if (delta.cur === 0) return null;
    return <span className="adm-delta adm-delta-flat" title={`Nothing in ${vs}`}>New</span>;
  }
  const r = Math.round(delta.pct);
  if (r === 0) return <span className="adm-delta adm-delta-flat" title={`Same as ${vs} (${delta.prev.toLocaleString("en-US")})`}>±0%</span>;
  const up = r > 0;
  const good = up === (goodWhen === "up");
  return (
    <span className={`adm-delta ${good ? "adm-delta-good" : "adm-delta-bad"}`} title={`vs ${vs}: ${delta.prev.toLocaleString("en-US")}`}>
      <span aria-hidden>{up ? "▲" : "▼"}</span>
      <span className="sr-only">{up ? "up" : "down"} </span>
      {fmtPct(Math.abs(r))}
    </span>
  );
}

/**
 * One headline number. Label, value, an optional change chip and sparkline,
 * and a sub-line saying what it's made of. Pass `notTracked` for a number the
 * product doesn't measure yet — it draws the placeholder instead.
 */
export function Kpi({
  label, value, sub, delta, goodWhen, trend, tone,
}: {
  label: string; value: React.ReactNode; sub?: React.ReactNode;
  delta?: Delta; goodWhen?: "up" | "down"; trend?: number[];
  tone?: "good" | "bad" | "warn";
}) {
  return (
    <div className="p-4 sm:p-5 h-full flex flex-col">
      <p className="sc-t-footnote font-medium" style={{ color: "var(--sc-label-muted)" }}>{label}</p>
      <div className="mt-1.5 flex items-end justify-between gap-2">
        <p className={`adm-kpi-value ${tone ? `adm-${tone}` : ""}`}>{value}</p>
        {trend && trend.length > 1 && <Sparkline values={trend} className="mb-1.5 shrink-0" />}
      </div>
      {(delta || sub) && (
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
          {delta && <DeltaChip delta={delta} goodWhen={goodWhen} />}
          {sub && <span className="sc-t-caption adm-muted">{sub}</span>}
        </div>
      )}
    </div>
  );
}

/** A Kpi on its own card. (KpiLink in ./links.tsx is the clickable version.) */
export function KpiCard(props: React.ComponentProps<typeof Kpi>) {
  return <div className="adm-card"><Kpi {...props} /></div>;
}
