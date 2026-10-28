// ── Badges: the plan, the account state, how it's billed ───────────────────
// Built on the app's .sc-badge primitive. A badge always carries words, so
// colour is never the only signal.

import { planKey, PLAN_NAME, fmtDate } from "./format";

const PLAN_BADGE = { free: "sc-badge", pro: "sc-badge sc-badge-tint", office: "sc-badge sc-badge-office" } as const;

export function PlanBadge({ plan }: { plan: string | null | undefined }) {
  const k = planKey(plan);
  return <span className={PLAN_BADGE[k]}>{PLAN_NAME[k]}</span>;
}

export function FreeMonthBadge({ until }: { until: string }) {
  return <span className="sc-badge sc-badge-orange" title={`Free month of Pro until ${new Date(until).toLocaleDateString()}`}>Free month · ends {fmtDate(until)}</span>;
}

export function ClosedBadge() {
  return <span className="sc-badge sc-badge-red">Closed</span>;
}

export type Billing = "stripe" | "apple" | "grant" | "office_member" | "none";

const BILLING: Record<Billing, { cls: string; label: string }> = {
  stripe: { cls: "sc-badge sc-badge-green", label: "Paying · Stripe" },
  apple: { cls: "sc-badge sc-badge-green", label: "Paying · Apple" },
  grant: { cls: "sc-badge sc-badge-orange", label: "Free Pro (gift)" },
  office_member: { cls: "sc-badge sc-badge-office", label: "Office member · team pays" },
  none: { cls: "sc-badge", label: "Not billed" },
};

export function BillingBadge({ billing }: { billing: Billing }) {
  const b = BILLING[billing];
  return <span className={b.cls}>{b.label}</span>;
}

export function StatusBadge({ tone, children }: { tone: "good" | "bad" | "warn" | "neutral" | "tint"; children: React.ReactNode }) {
  const cls = { good: "sc-badge sc-badge-green", bad: "sc-badge sc-badge-red", warn: "sc-badge sc-badge-orange", neutral: "sc-badge", tint: "sc-badge sc-badge-tint" }[tone];
  return <span className={cls}>{children}</span>;
}

/** A round initial (or the photo) for a person in a list. */
export function Avatar({ name, photo, size = 36 }: { name: string | null | undefined; photo?: string | null; size?: number }) {
  const initial = ((name || "?").trim()[0] ?? "?").toUpperCase();
  if (photo) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={photo} alt="" width={size} height={size} className="rounded-full object-cover shrink-0" style={{ width: size, height: size }} />;
  }
  return (
    <span aria-hidden className="rounded-full shrink-0 inline-flex items-center justify-center font-semibold"
      style={{ width: size, height: size, fontSize: size * 0.4, background: "var(--sc-tint-soft)", color: "var(--sc-tint)" }}>
      {initial}
    </span>
  );
}
