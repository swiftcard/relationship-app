import { TRIAL_DAYS } from "@/lib/plan";

// ── The Pro card's price block: "Free for your first 14 days" ───────────────
//
// Owner-approved design 2026-08-19 (mockup round): the price block leads with
// the word FREE — big, bold, plain white, deliberately NOT a colored badge or
// a strikethrough ("I don't want this to look like a scam") — followed by the
// qualifier in quiet white, then the real price stated plainly underneath.
// Reads as one honest sentence: "Free for your first 14 days, then $4.99 a
// month, cancel anytime."
//
// This REPLACES both the old price row and the emerald ProTrialCallout pill on
// every Pro card (pricing page, signup PlanCards, upgrade page), so the offer
// reads identically wherever someone meets it.
//
// Compliance copy contract (tests/copy-truth.test.ts): the day count comes
// from TRIAL_DAYS, and the "for new customers" qualifier + billing terms stay
// in the fine print under each card's CTA — this block carries the offer, not
// the conditions.

export default function ProTrialPrice({
  price,
  period,
  note,
  freeFor,
  className = "",
}: {
  /** The real price alone: "$4.99" or "$53.99". Rendered emphasized. */
  price: string;
  /** The billing period: "month" or "year". */
  period: string;
  /** Optional extra after the price, e.g. "~$4.50/mo · Save 10%". */
  note?: string;
  /** The free period, when it isn't the standard trial — a promo code's
   *  ("two months") on the app's Pro card. Defaults to the ${TRIAL_DAYS}-day trial. */
  freeFor?: string;
  className?: string;
}) {
  // Two anchors, one quiet voice between them: "Free" carries the offer, the
  // PRICE carries the commitment (owner request 2026-08-19: bigger, black,
  // bolder — the number must not hide), and the connective words stay calm.
  return (
    <div className={className}>
      <div className="flex items-baseline gap-2.5 flex-wrap">
        <span className="text-[2.6rem] font-bold text-black leading-none tracking-tight">Free</span>
        <span className="text-white/70 text-sm">for your first {freeFor ?? `${TRIAL_DAYS} days`}</span>
      </div>
      <p className="text-white/70 text-sm mt-2">
        then <span className="text-black font-extrabold text-[1.0625rem]">{price}</span> / {period} · cancel anytime
      </p>
      {note && <p className="text-white/60 text-xs mt-1">{note}</p>}
    </div>
  );
}
