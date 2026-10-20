import type { AgentDef } from "../agent-def";
import { failedPayments, revenueChecks, stripeReader, type PaymentIssue } from "../sources/stripe-read";
import { closeMissing, fingerprintOf, reportFindings, type RawFinding } from "../watch/findings";

// ── W7 The payments pair (read-only Stripe) ─────────────────────────────────
// Payments watch: failed charges and past-due subscriptions.
// Revenue check: trials about to end with no card, people paying in Stripe
// whom the app shows as Free, and referral upgrades. Nothing fails silently;
// nothing is charged, refunded or changed by an agent.

export function paymentFindings(issues: PaymentIssue[], source: string): RawFinding[] {
  return issues.map((i) => ({ fingerprint: `${source}:${fingerprintOf(i.key)}`, kind: "payment" as const, source, title: i.title, detail: { ...i.detail, kind: i.kind } }));
}

const base = { team: "watchdog" as const, role: "worker" as const, tier: "sonnet" as const, needs: ["CREW_ANTHROPIC_API_KEY" as const, "CREW_STRIPE_READ_KEY" as const], maxPending: 6, approvalKind: "ask" as const };
const TAIL = "The Stripe link is in the card. Tap Approve once it's handled.";

export const watchPayments: AgentDef = {
  ...base,
  id: "watch-payments",
  name: "Payments watch",
  schedule: { kind: "every", minutes: 360 },
  dailyUsd: 0.5,
  purpose: "Every 6 hours, checks Stripe for failed or late payments so none fail silently.",
  async run(ctx) {
    const stripe = stripeReader();
    if (!stripe) return { summary: "Needs CREW_STRIPE_READ_KEY.", status: "skipped" };
    const raws = paymentFindings(await failedPayments(stripe, ctx.now()), "stripe-payments");
    const r = await reportFindings(ctx, raws, { approvalKind: "ask", tail: TAIL, maxTriage: 6 });
    await closeMissing(ctx, "stripe-payments", new Set(raws.map((x) => x.fingerprint)));
    ctx.stat("payment_problems", raws.length);
    return { summary: raws.length ? `${raws.length} payment problems; ${r.fresh} new.` : "No failed or late payments." };
  },
};

export const watchRevenue: AgentDef = {
  ...base,
  id: "watch-revenue",
  name: "Revenue check",
  schedule: { kind: "every", minutes: 360 },
  dailyUsd: 0.5,
  purpose: "Makes sure free trials turn into charges, paying people get Pro, and referral upgrades are counted.",
  async run(ctx) {
    const stripe = stripeReader();
    if (!stripe) return { summary: "Needs CREW_STRIPE_READ_KEY.", status: "skipped" };
    const { issues, counts } = await revenueChecks(stripe, ctx.now());
    const raws = paymentFindings(issues, "stripe-revenue");
    const r = await reportFindings(ctx, raws, { approvalKind: "ask", tail: TAIL, maxTriage: 6 });
    await closeMissing(ctx, "stripe-revenue", new Set(raws.map((x) => x.fingerprint)));
    return { summary: `${counts.active} paying, ${counts.trialing} on trial (${counts.trials_ending_48h} ending soon). ${raws.length} problems, ${r.fresh} new.` };
  },
};
