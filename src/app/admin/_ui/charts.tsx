// ── The admin's charts: few, quiet, and the same everywhere ────────────────
// Built to the dataviz rules: thin bars (≤24px) with a rounded data-end and a
// square baseline, a 2px surface gap between touching marks, one axis, a
// legend whenever there are two series, labels in text colours (never the
// series colour), a hover/focus tooltip on every mark, and a hidden table so
// a screen reader gets the numbers too. Colours are the validated palette in
// admin.css (--adm-*). No hooks: server and client components both use these.

import { fmtNum } from "./format";

const compact = (n: number) =>
  n >= 1_000_000 ? `${+(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${+(n / 1000).toFixed(1)}K` : String(n);

/**
 * The next "clean" top for an axis at or above n, chosen so the halfway
 * gridline is a whole number too: small counts round up to an even number
 * (5 → 6, so the middle line reads 3, not a "3" drawn at 2.5), larger ones to
 * 2, 4, 5 or 10 × 10^k.
 */
function niceCeil(n: number): number {
  if (n <= 10) return Math.max(2, Math.ceil(n / 2) * 2);
  const p = 10 ** Math.floor(Math.log10(n));
  for (const m of [1, 2, 4, 5, 10]) if (m * p >= n) return m * p;
  return 10 * p;
}

const shortDate = (d: string) =>
  new Date(`${d.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

export type TrendSeries = { label: string; color: string };

/**
 * Daily columns. One series, or two drawn as `overlay` (the first behind as a
 * wash, the second in front — visitors inside pageviews) or `stack` (views
 * with contacts on top).
 */
export function TrendBars({
  data, series, mode = "overlay", height = 160, caption,
}: {
  data: { date: string; values: number[] }[];
  series: TrendSeries[];
  mode?: "overlay" | "stack";
  height?: number;
  caption: string;
}) {
  const totals = data.map((d) => (mode === "stack" ? d.values.reduce((a, b) => a + b, 0) : Math.max(0, ...d.values)));
  const top = niceCeil(Math.max(0, ...totals));
  const ticks = [top, top / 2, 0];
  const n = data.length;
  const mid = Math.floor((n - 1) / 2);

  return (
    <figure className="min-w-0">
      {series.length > 1 && (
        <figcaption className="flex flex-wrap gap-x-4 gap-y-1 mb-3 sc-t-caption adm-muted" aria-hidden>
          {series.map((s) => (
            <span key={s.label} className="inline-flex items-center gap-1.5">
              <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: s.color }} />
              {s.label}
            </span>
          ))}
        </figcaption>
      )}
      <div className="relative" style={{ height }}>
        {/* Gridlines + y labels: three clean ticks, hairline, recessive. */}
        {ticks.map((t, i) => (
          <div key={i} className="absolute left-0 right-0 flex items-center gap-2" style={{ top: `${(i / 2) * 100}%`, transform: "translateY(-50%)" }} aria-hidden>
            <span className="w-7 text-right sc-t-caption adm-faint adm-num shrink-0">{compact(Math.round(t))}</span>
            <span className={`flex-1 ${i === 2 ? "border-t" : "adm-grid-line"}`} style={i === 2 ? { borderColor: "var(--sc-separator)" } : undefined} />
          </div>
        ))}
        <div className="absolute top-0 bottom-0 right-0 left-9 flex items-end gap-[2px]">
          {data.map((d, i) => {
            const tipSide = i < n / 3 ? "left-0" : i > (2 * n) / 3 ? "right-0" : "left-1/2 -translate-x-1/2";
            return (
              <div key={d.date} tabIndex={0} className="group relative flex-1 h-full flex items-end justify-center outline-none min-w-0">
                {/* The day highlights on hover; the hit target is the whole column. */}
                <span aria-hidden className="absolute inset-0 rounded-md group-hover:bg-[var(--adm-hover)] group-focus-visible:bg-[var(--adm-hover)] pointer-events-none" />
                {mode === "stack" ? (
                  <div className="relative w-full max-w-[24px] h-full flex flex-col-reverse gap-[2px]">
                    {d.values.map((v, s) =>
                      v > 0 ? (
                        <div key={s} className={s === d.values.length - 1 || d.values.slice(s + 1).every((x) => x === 0) ? "adm-bar-v" : ""}
                          style={{ height: `${(v / top) * 100}%`, minHeight: 2, background: series[s]?.color }} />
                      ) : null,
                    )}
                  </div>
                ) : (
                  <div className="relative w-full max-w-[24px] h-full">
                    {d.values.map((v, s) =>
                      v > 0 ? (
                        <div key={s} className="adm-bar-v absolute bottom-0 left-0 right-0"
                          style={{ height: `${(v / top) * 100}%`, minHeight: 2, background: series[s]?.color }} />
                      ) : null,
                    )}
                  </div>
                )}
                <div className={`adm-tip pointer-events-none absolute -top-1 -translate-y-full ${tipSide} z-10 hidden group-hover:block group-focus-visible:block whitespace-nowrap px-2.5 py-1.5`}>
                  <span className="block sc-t-caption opacity-75">{shortDate(d.date)}</span>
                  {series.map((s, si) => (
                    <span key={s.label} className="flex items-center gap-1.5 sc-t-caption font-semibold adm-num">
                      <span className="inline-block w-2 h-2 rounded-sm" style={{ background: s.color }} />
                      {fmtNum(d.values[si] ?? 0)} {s.label.toLowerCase()}
                    </span>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      {n > 0 && (
        <div className="flex justify-between pl-9 mt-1.5 sc-t-caption adm-faint" aria-hidden>
          <span>{shortDate(data[0].date)}</span>
          {n > 2 && <span>{shortDate(data[mid].date)}</span>}
          <span>{shortDate(data[n - 1].date)}</span>
        </div>
      )}
      {/* The numbers for a screen reader. In a div: a <table> ignores the 1px
          height sr-only gives it and stretched the page by its full length. */}
      <div className="sr-only">
        <table>
          <caption>{caption}</caption>
          <thead><tr><th>Day</th>{series.map((s) => <th key={s.label}>{s.label}</th>)}</tr></thead>
          <tbody>{data.map((d) => <tr key={d.date}><td>{shortDate(d.date)}</td>{d.values.map((v, i) => <td key={i}>{v}</td>)}</tr>)}</tbody>
        </table>
      </div>
    </figure>
  );
}

/** A tiny trend line for a KPI tile: the shape, not the values. */
export function Sparkline({ values, className = "" }: { values: number[]; className?: string }) {
  const w = 64, h = 24, pad = 4;
  const max = Math.max(1, ...values);
  const pts = values.map((v, i) => [pad + (i / Math.max(1, values.length - 1)) * (w - 2 * pad), h - pad - (v / max) * (h - 2 * pad)]);
  const last = pts[pts.length - 1];
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className={className} aria-hidden>
      <polyline points={pts.map((p) => p.join(",")).join(" ")} fill="none" stroke="var(--adm-series-1)" strokeOpacity={0.45} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      {last && <circle cx={last[0]} cy={last[1]} r={3} fill="var(--adm-series-1)" stroke="var(--sc-bg-elevated)" strokeWidth={2} />}
    </svg>
  );
}

export type BarRow = { key?: string; label: string; value: number; note?: string };

/**
 * A ranked list with a bar under each label. Label and number share a line,
 * the bar sits beneath — so it reads the same on a phone and never overflows.
 */
export function BarList({
  rows, color = "var(--adm-series-1)", format = fmtNum, empty = "Nothing yet.", showShare = false,
}: {
  rows: BarRow[]; color?: string; format?: (n: number) => string; empty?: string; showShare?: boolean;
}) {
  if (!rows.length) return <p className="adm-muted sc-t-subhead py-2">{empty}</p>;
  const max = Math.max(1, ...rows.map((r) => r.value));
  const total = rows.reduce((n, r) => n + r.value, 0);
  return (
    <ul className="space-y-3">
      {rows.map((r) => (
        <li key={r.key ?? r.label} className="min-w-0">
          <div className="flex items-baseline justify-between gap-3">
            <span className="sc-t-subhead truncate min-w-0" title={r.label}>{r.label}</span>
            <span className="shrink-0 flex items-baseline gap-2">
              {r.note && <span className="sc-t-caption adm-muted">{r.note}</span>}
              {showShare && total > 0 && <span className="sc-t-caption adm-muted adm-num">{Math.round((r.value / total) * 100)}%</span>}
              <span className="sc-t-subhead font-semibold adm-num">{format(r.value)}</span>
            </span>
          </div>
          <div className="adm-track h-1.5 mt-1.5 overflow-hidden">
            <div className="h-full rounded-full" style={{ width: `${(r.value / max) * 100}%`, minWidth: r.value > 0 ? 4 : 0, background: color }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Free / Pro / Office as one stacked bar, then a legend with counts and shares. */
export function PlanMixBar({ free, pro, office }: { free: number; pro: number; office: number }) {
  const total = free + pro + office;
  const parts = [
    { label: "Free", n: free, color: "var(--adm-plan-free)" },
    { label: "Pro", n: pro, color: "var(--adm-plan-pro)" },
    { label: "Office", n: office, color: "var(--adm-plan-office)" },
  ];
  return (
    <div>
      <div className="flex h-3 gap-[2px] rounded-full overflow-hidden adm-track" role="img"
        aria-label={parts.map((p) => `${p.label} ${p.n}`).join(", ")}>
        {total > 0 && parts.filter((p) => p.n > 0).map((p) => (
          <div key={p.label} style={{ width: `${(p.n / total) * 100}%`, background: p.color }} />
        ))}
      </div>
      <ul className="mt-4 space-y-2.5">
        {parts.map((p) => (
          <li key={p.label} className="flex items-center gap-2.5 sc-t-subhead">
            <span aria-hidden className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: p.color }} />
            <span className="flex-1">{p.label}</span>
            <span className="font-semibold adm-num">{fmtNum(p.n)}</span>
            <span className="adm-muted adm-num w-12 text-right">{total ? `${Math.round((p.n / total) * 100)}%` : "—"}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * A few steps of a journey with how many made it from each step to the next.
 * A step can exceed the one before it (people join mid-way); that shows as
 * ">100%" in grey rather than a celebratory green.
 */
export function MiniFunnel({ steps }: { steps: { label: string; value: number; hint?: string }[] }) {
  return (
    <ol className="grid gap-3 grid-cols-2 lg:grid-cols-4">
      {steps.map((s, i) => {
        const prev = i > 0 ? steps[i - 1].value : null;
        const pct = prev && prev > 0 ? Math.round((s.value / prev) * 100) : null;
        return (
          <li key={s.label} className="adm-inset p-3.5 sm:p-4 min-w-0">
            <p className="sc-t-caption adm-muted truncate" title={s.hint ?? s.label}>{i + 1}. {s.label}</p>
            <p className="adm-kpi-value mt-1">{fmtNum(s.value)}</p>
            <p className="sc-t-caption mt-1 adm-num">
              {i === 0 ? <span className="adm-faint">Start</span>
                : pct === null ? <span className="adm-faint">—</span>
                : pct > 100 ? <span className="adm-faint" title="More than the step before: some people join here directly.">&gt;100% of step {i}</span>
                : <span className={pct >= 50 ? "adm-good" : pct >= 20 ? "adm-warn" : "adm-bad"}>{pct}% of step {i}</span>}
            </p>
          </li>
        );
      })}
    </ol>
  );
}

/** An inline share bar for a table cell. */
export function ShareBar({ value, max, color = "var(--adm-series-1)" }: { value: number; max: number; color?: string }) {
  return (
    <div className="adm-track h-1.5 w-full min-w-[3rem] overflow-hidden" aria-hidden>
      <div className="h-full rounded-full" style={{ width: `${max ? (value / max) * 100 : 0}%`, minWidth: value > 0 ? 3 : 0, background: color }} />
    </div>
  );
}
