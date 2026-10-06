"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { detectNativeApp, useIsNativeApp } from "@/lib/platform";
import SiteNav from "@/components/site/SiteNav";
import SiteFooter from "@/components/site/SiteFooter";
import ScrollReveal from "@/components/ScrollReveal";
import ScrollProgress from "@/components/ScrollProgress";
import { PLAN_LIMITS, TRIAL_DAYS } from "@/lib/plan";
import { promoLabel, promoFitsPurchase, promoSeats, scopeLabel, seatsLabel, type PromoRow } from "@/lib/promo";
import MobilePlanTabs, { type PlanTier } from "@/components/MobilePlanTabs";
import {
  BillingToggle, FreePlanCard, ProPlanCard, ProWebPrice, OfficePlanCard, OfficeWebPrice, OfficeSeatPicker, officeTotalLabel,
  PLAN_GRID_CLASS, FREE_CTA_CLASS, PRO_CTA_CLASS, PRO_CTA_LINK_CLASS, OFFICE_CTA_CLASS, OFFICE_CTA_LINK_CLASS, PRO_FINE_PRINT_CLASS,
} from "@/components/PlanTierCards";
import HomeHeadingReveal from "@/components/site/HomeHeadingReveal";
import "@/app/home.css";


// The cards themselves (and their prices, from PLAN_PRICES — the same
// constants the checkout route validates the real Stripe price against) are
// PlanTierCards, shared with every other plan chooser so none can drift.
const OFFICE_MIN_SEATS = PLAN_LIMITS.OFFICE_MIN_SEATS;

// No couponId here on purpose. The Stripe coupon id used to be handed to the
// client, put in the URL, and passed to checkout unvalidated — so lifting one
// from a shared link applied it to anyone's purchase. The CODE travels instead;
// the server re-resolves it.
type PromoState = {
  code: string; status: "idle" | "checking" | "valid" | "invalid"; message: string;
  appliedCode?: string; discountLabel?: string;
  /** The offer itself, so each plan button can say whether it applies here. */
  row?: PromoRow;
};

export default function PricingPage() {
  const router = useRouter();
  // Native app: the pricing page is a selling surface and must not appear.
  // Redirect to the dashboard on mount. This also cleanly covers the Office
  // team-management gate: a non-Office user who hits /office/admin is redirected
  // server-side to /pricing (unchanged on web), and on native that lands here
  // and bounces straight to /dashboard — no selling shown. Server-side native
  // detection isn't reliable in a Capacitor webview, so this client redirect is
  // the safe approach. On web this effect is a no-op.
  useEffect(() => {
    if (detectNativeApp()) router.replace("/dashboard");
  }, [router]);
  // Render guard on top of the redirect: without it, the full pricing page
  // (every price + checkout CTA) paints in the shell for a frame before the
  // redirect commits (App Review 3.1.1). Hydration-safe: false on SSR/web.
  const native = useIsNativeApp();
  const [mobileTier, setMobileTier] = useState<PlanTier>("pro");

  const [annual, setAnnual] = useState(false);
  const [pickedSeats, setSeats] = useState<number>(OFFICE_MIN_SEATS);
  const [loading, setLoading] = useState<"pro" | "enterprise" | null>(null);
  const [checkoutErr, setCheckoutErr] = useState<string | null>(null);
  const [promo, setPromo] = useState<PromoState>({ code: "", status: "idle", message: "" });
  // A SIGNED-IN account that already had its free Pro period (the trial or a
  // friend's referral month) is not offered another — the same rule checkout
  // enforces. Signed out, or on any error, the answer is true.
  // An Office team member has nothing to buy — their seat is their plan, and
  // /upgrade and /checkout already send them home — so this page does too.
  const [trialOk, setTrialOk] = useState(true);
  // The plan the signed-in account is already on. An Office account was sold
  // Pro here as if it were a new customer — and paying would have swapped its
  // Office for Pro. A paying account's own plan reads "Your current plan".
  const [acctPlan, setAcctPlan] = useState<{ plan: string; onGrant: boolean } | null>(null);
  // The page is static HTML that shows the trial offer (right for everyone
  // signed out). For a signed-in visitor, the root boot script marks <html>
  // data-sc-authed before paint and home.css keeps the [data-acct-gate] parts
  // invisible until this answer lands — so an account that has had its trial
  // never sees "Free for 14 days" flash and then turn into $4.99 (owner,
  // 2026-09-28). `acctReady` releases them on any outcome, error included.
  const [acctReady, setAcctReady] = useState(false);
  useEffect(() => {
    let cancelled = false;
    // Never leave the prices hidden behind a slow network.
    const giveUp = setTimeout(() => { if (!cancelled) setAcctReady(true); }, 4000);
    fetch("/api/iap/trial-eligible", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { eligible?: unknown; teamMember?: unknown; plan?: unknown; onGrant?: unknown } | null) => {
        if (cancelled) return;
        if (d?.teamMember === true) { router.replace("/dashboard"); return; }
        if (d?.eligible === false) setTrialOk(false);
        if (typeof d?.plan === "string") setAcctPlan({ plan: d.plan, onGrant: d.onGrant === true });
        setAcctReady(true);
      })
      .catch(() => { if (!cancelled) setAcctReady(true); });
    return () => { cancelled = true; clearTimeout(giveUp); };
  }, [router]);
  // Office includes all of Pro, so an Office account — however it got Office —
  // has no Pro to buy. A Pro that PAYS (Stripe or Apple) is the current plan;
  // granted free days are not, so that account can still subscribe to keep it.
  const onOffice = acctPlan?.plan === "enterprise";
  const onPaidOffice = onOffice && !acctPlan?.onGrant;
  const onPaidPro = acctPlan?.plan === "pro" && !acctPlan.onGrant;
  const gate = { "data-acct-gate": "", "data-acct-ready": acctReady ? "" : undefined };
  const BILLING_HREF = "/settings/flows?billing=1#billing";

  // The plan buttons navigate away with a full page load, leaving `loading`
  // set. Back from the card builder restores this page from the back/forward
  // cache exactly as it was left — both buttons disabled on "Loading…" and
  // nothing to reset them.
  useEffect(() => {
    const onShow = (e: PageTransitionEvent) => { if (e.persisted) setLoading(null); };
    window.addEventListener("pageshow", onShow);
    return () => window.removeEventListener("pageshow", onShow);
  }, []);

  async function applyPromo() {
    if (!promo.code.trim()) return;
    setPromo((p) => ({ ...p, status: "checking", message: "" }));
    try {
      const res = await fetch("/api/promo/redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: promo.code.trim() }),
      });
      const data = await res.json();
      // A GRANT code is not a discount to carry to checkout — the plan is
      // already open by the time this returns, so say so and go to the app
      // rather than leaving the person on a pricing page they no longer need.
      if (res.ok && data.granted) {
        const planName = data.granted.plan === "enterprise" ? "Office" : "Pro";
        setPromo((p) => ({ ...p, status: "valid", message: `${planName} is on for ${data.granted.days} days — opening your dashboard…`, appliedCode: "", discountLabel: "", row: undefined }));
        setTimeout(() => { window.location.href = "/dashboard"; }, 1200);
        return;
      }
      if (res.ok) {
        const d = data.promo;
        // Shared with the admin list so a code is described identically in both.
        const discountLabel = promoLabel(d);
        setPromo((p) => ({ ...p, status: "valid", message: d.description || discountLabel, appliedCode: d.code, discountLabel, row: d }));
      } else {
        setPromo((p) => ({ ...p, status: "invalid", message: data.error || "Invalid code" }));
      }
    } catch {
      setPromo((p) => ({ ...p, status: "invalid", message: "Something went wrong" }));
    }
  }

  // A code carries the plan and billing period it was made for (lib/promo), so
  // an Office-only code must not decorate the Pro button and then quietly not
  // apply at checkout (owner, 2026-09-17).
  const promoRow = promo.status === "valid" ? promo.row ?? {} : null;
  const promoOnPro = !!promoRow && promoFitsPurchase(promoRow, { plan: "pro", interval: annual ? "annual" : "monthly" });
  const promoOnOffice = !!promoRow && promoFitsPurchase(promoRow, { plan: "office", interval: annual ? "annual" : "monthly" });
  // An Office code made for a team of N fixes the order at N seats (lib/promo
  // promoSeats): the picker locks to it, and checkout refuses any other count.
  const promoSeatLock = promoRow ? promoSeats(promoRow) : null;
  const seats = promoSeatLock ?? pickedSeats;

  function handleUpgrade(plan: "pro" | "enterprise") {
    setLoading(plan);
    setCheckoutErr(null);
    // Unified flow: even a plan-specific CTA builds the card FIRST, then account,
    // then payment for the pre-selected plan (no plan chooser again). Route to
    // the card builder carrying the exact selection in the URL. A logged-in user
    // who already has a card is redirected straight to /checkout by the builder's
    // server page, so they don't rebuild.
    const planKey = plan === "enterprise" ? "office" : "pro";
    const qs = new URLSearchParams({ plan: planKey, interval: annual ? "annual" : "monthly" });
    if (plan === "enterprise") qs.set("seats", String(seats));
    if (promo.status === "valid" && promo.appliedCode) qs.set("promo", promo.appliedCode);
    window.location.href = `/cards/new?${qs.toString()}`;
  }

  // After all hooks (React rules): never paint the selling surface natively.
  if (native) return null;

  return (
    <div className="bg-white text-slate-900 min-h-screen">
      <ScrollProgress />
      <ScrollReveal />
      <HomeHeadingReveal />
      <SiteNav />

      <main className="hp overflow-clip">
        {/* Hero */}
        <section className="hp-page-hero pt-28 pb-14 sm:pt-40 sm:pb-16 text-center">
          <div className="relative max-w-3xl mx-auto px-5 sm:px-6">
            <div data-hp-head>
              <h1 className="rd-display text-slate-900 text-[clamp(2.4rem,5.5vw,4rem)]">
                Simple, honest <span className="hp-fill">pricing.</span>
              </h1>
              <p className="hp-lede mt-5 max-w-lg mx-auto">
                Free forever to start. Upgrade when your network grows — no contracts, cancel anytime.
              </p>
            </div>

            {/* Monthly / Annual toggle */}
            {/* Hidden (space kept) on a phone with the Free tab open, where it
                changes nothing — same rule as PlanCards. */}
            <BillingToggle annual={annual} onToggle={() => setAnnual(!annual)} hideOnPhone={mobileTier === "free"} className="mt-8" reveal />
          </div>
        </section>

        {/* Plans — Pro is deliberately not a peer of the other two: it sits
            taller, on top, and is the only card with the aurora fill, so the
            eye lands on it first and the free plan reads as the trial it is. */}
        <div className="hp-soft pt-10 sm:pt-14">
        <div className="max-w-6xl mx-auto w-full px-5 sm:px-6">
          <MobilePlanTabs active={mobileTier} onChangeAction={setMobileTier} />
        </div>
        <section className={`max-w-6xl mx-auto w-full px-5 sm:px-6 pb-14 ${PLAN_GRID_CLASS}`}>
          <FreePlanCard offTab={mobileTier !== "free"} reveal
            cta={<Link href="/cards/new" className={FREE_CTA_CLASS}>Get started free →</Link>} />

          {/* An account that has had its free Pro period sees the plain
              price — the same branch PlanCards uses. "Free for your first
              14 days" above a "billing starts today" button contradicted
              itself. */}
          <ProPlanCard offTab={mobileTier !== "pro"} reveal
            price={<div {...gate}><ProWebPrice annual={annual} trial={trialOk && !onOffice && !onPaidPro} /></div>}>
              <div {...gate}>
              {onOffice || onPaidPro ? (
                // Nothing to buy: the account is on Pro already, or on Office,
                // which includes all of Pro. Plan changes live in Billing.
                <Link href={BILLING_HREF} className={PRO_CTA_LINK_CLASS}>
                  {onOffice ? "Included in your Office plan" : "Your current plan"} · Manage →
                </Link>
              ) : (
              <button onClick={() => handleUpgrade("pro")} disabled={loading !== null} className={PRO_CTA_CLASS}>
                {/* Not "Start free →": the Free plan's own button two columns
                    left reads "Get started free →", and side by side the two
                    were indistinguishable — one genuinely free, one a
                    subscription that takes a card. See PlanCards for the
                    incident this comes from. */}
                {loading === "pro" ? "Loading…" : promoOnPro ? `Get Pro Plan · ${promo.discountLabel} →` : trialOk ? `Try Pro free for ${TRIAL_DAYS} days →` : "Get Pro →"}
              </button>
              )}
              {/* Fine print keeps the ELIGIBILITY condition and the billing
                  terms; the callout above carries the offer. Checkout grants a
                  trial only to customers with no prior Stripe subscription, so
                  "for new customers" must survive here no matter how the
                  headline is worded (pinned by copy-truth.test.ts). */}
              <p className={PRO_FINE_PRINT_CLASS}>
                {onOffice ? <>Your account is on Office, which includes everything in Pro</>
                  : onPaidPro ? <>Your account is on Pro · change or cancel it in Billing</>
                  : trialOk ? <>{TRIAL_DAYS} days free for new customers · card required · renews automatically</> : <>Your account has had its free Pro period · billing starts today · renews automatically</>}
              </p>
              </div>
              {checkoutErr && loading === null && (
                <p className="text-center text-[0.75rem] font-semibold mt-2 rounded-lg py-2 px-3" style={{ background: "rgba(254,226,226,0.95)", color: "#b91c1c" }}>{checkoutErr}</p>
              )}
          </ProPlanCard>

          <OfficePlanCard offTab={mobileTier !== "office"} reveal
            price={<OfficeWebPrice annual={annual} seats={seats} />}
            seatPicker={<OfficeSeatPicker seats={seats} onSeats={setSeats} lockedSeats={promoSeatLock} />}>
            <div {...gate}>
            {onPaidOffice ? (
              // Already paying for Office: seats and billing are changed in
              // Billing, not by starting a second purchase.
              <Link href={BILLING_HREF} className={OFFICE_CTA_LINK_CLASS}>
                Your current plan · Manage seats →
              </Link>
            ) : (
            <button onClick={() => handleUpgrade("enterprise")} disabled={loading !== null} className={OFFICE_CTA_CLASS}>
              {loading === "enterprise" ? "Loading…" : promoOnOffice ? `Get Office · ${promo.discountLabel} →` : `Get Office · ${officeTotalLabel(annual, seats)} →`}
            </button>
            )}
            </div>
          </OfficePlanCard>
        </section>

        {/* Promo code — under the plans */}
        <section className="max-w-sm mx-auto w-full px-6 pb-24">
          {promo.status === "valid" ? (
            <div className="flex items-center gap-3 rounded-2xl px-4 py-3 border border-emerald-200 bg-emerald-50">
              <svg viewBox="0 0 20 20" fill="#10b981" className="w-5 h-5 shrink-0"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clipRule="evenodd" /></svg>
              <div className="flex-1">
                <p className="text-emerald-700 text-sm font-semibold">{promo.discountLabel} applied</p>
                <p className="text-emerald-600/80 text-xs">{promo.message}</p>
                {/* Where it applies, in the same words the admin picked. */}
                {promoRow && (promoRow.applies_to !== "any" || promoRow.interval_target !== "any") && (
                  <p className="text-emerald-700/90 text-xs mt-0.5 font-medium">{scopeLabel(promoRow)}</p>
                )}
                {promoSeatLock && <p className="text-emerald-700/90 text-xs mt-0.5 font-medium">For {seatsLabel(promoSeatLock)}</p>}
                {promoRow && !promoOnPro && !promoOnOffice && (
                  <p className="text-amber-700 text-xs mt-0.5 font-medium">
                    Switch to {promoRow.interval_target === "annual" ? "annual" : "monthly"} billing above to use it.
                  </p>
                )}
              </div>
              <button onClick={() => setPromo({ code: "", status: "idle", message: "" })} className="text-emerald-600/70 hover:text-emerald-700 text-xs">Remove</button>
            </div>
          ) : (
            <details className="group">
              <summary className="cursor-pointer text-sm text-slate-500 hover:text-slate-800 transition-colors list-none flex items-center gap-1.5 justify-center">
                <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4"><path fillRule="evenodd" d="M5.5 9A3.5 3.5 0 0 1 9 5.5H10V3H9a6 6 0 1 0 6 6v-1h-2.5v1a3.5 3.5 0 0 1-7 0V9Zm4 0a.5.5 0 0 0-1 0v5a.5.5 0 0 0 1 0V9Z" clipRule="evenodd" /></svg>
                Have a promo code?
              </summary>
              <div className="mt-3 flex gap-2">
                {/* A placeholder is not a label — it disappears the moment you
                    type, and VoiceOver users get an unnamed box. The invalid
                    state was also colour-only (a red border) and silent; it is
                    now announced and pointed at by the field itself. */}
                <input type="text" placeholder="Enter code" value={promo.code}
                  aria-label="Promo code"
                  aria-invalid={promo.status === "invalid"}
                  aria-describedby={promo.status === "invalid" ? "promo-error" : undefined}
                  onChange={(e) => setPromo((p) => ({ ...p, code: e.target.value.toUpperCase(), status: "idle", message: "" }))}
                  onKeyDown={(e) => e.key === "Enter" && applyPromo()}
                  className="flex-1 rounded-xl px-4 py-2.5 text-sm text-slate-900 bg-white border focus:outline-none transition-colors"
                  style={{ borderColor: promo.status === "invalid" ? "#f87171" : "#e2e8f0" }} />
                <button onClick={applyPromo} disabled={promo.status === "checking" || !promo.code.trim()} className="font-bold text-sm px-5 py-2.5 rounded-full bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-40 transition-colors">
                  {promo.status === "checking" ? "…" : "Apply"}
                </button>
              </div>
              {promo.status === "invalid" && (
                <p id="promo-error" role="alert" className="text-red-600 text-xs mt-1.5 text-center flex items-center justify-center gap-1">
                  {/* An icon as well as the colour: red-alone is exactly what
                      "Differentiate Without Color Alone" rules out. */}
                  <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5 shrink-0" aria-hidden="true">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm-1-5a1 1 0 112 0 1 1 0 01-2 0zm.25-7.25a.75.75 0 011.5 0v4.5a.75.75 0 01-1.5 0v-4.5z" clipRule="evenodd" />
                  </svg>
                  {promo.message}
                </p>
              )}
            </details>
          )}
        </section>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
