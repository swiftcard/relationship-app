"use client";

import { useEffect, useState } from "react";
import { useIsNativeApp } from "@/lib/platform";
import { useIsMobile } from "@/lib/use-is-mobile";
import MobilePlanTabs, { type PlanTier } from "@/components/MobilePlanTabs";
import { PLAN_LIMITS, PLAN_PRICES, TRIAL_DAYS } from "@/lib/plan";
import { PLAN_FEATURES, PLAN_DESCRIPTIONS, money } from "@/lib/plan-content";
import ProTrialPrice from "@/components/ProTrialPrice";
import IapSubscribeButton from "@/components/NativePaywall";
import { useIapOffer } from "@/lib/use-iap-price";
import { canOfferExternalPurchase, openExternalPurchase } from "@/lib/external-purchase";
import { formatCents, formatUsd, seatSubtotalCents, perMonthCents } from "@/lib/currency";

// The in-product plan chooser used during account creation — the card wizard's
// plan step and the /welcome step. Visually and content-wise it mirrors the
// public Pricing page (/pricing): the same highlighted Pro card (aurora fill,
// "MOST POPULAR", radial sheen + glisten sweep), the same full feature lists and
// descriptions (from plan-content), the same monthly/annual toggle with a
// SAVE 10% badge, and the same Office seat picker. It stays presentational —
// it reports the choice via onFree / onPaid and the parent runs signup/checkout.

const PRO_MONTHLY = PLAN_PRICES.PRO_MONTHLY_CENTS / 100;
const PRO_ANNUAL = PLAN_PRICES.PRO_ANNUAL_CENTS / 100;
const OFFICE_MIN_SEATS = PLAN_LIMITS.OFFICE_MIN_SEATS;
const PRO_ANNUAL_PER_MO = money(PRO_ANNUAL / 12);

export type PaidPlan = "pro" | "office";

function Check({ pro }: { pro?: boolean }) {
  return (
    <span className="w-4 h-4 rounded-full flex items-center justify-center shrink-0 mt-0.5" style={{ background: pro ? "rgba(255,255,255,0.22)" : "rgba(37,99,235,0.10)" }}>
      <svg viewBox="0 0 20 20" className="w-3 h-3" fill="none" stroke={pro ? "#ffffff" : "#2563EB"} strokeWidth={2.6}>
        <path d="M4 10.5l4 4 8-9" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

export default function PlanCards({
  onFree,
  onPaid,
  busy = null,
  // "Continue with Free →", not "Get started free →". The DEFAULT matters more
  // than any single call site: the wizard passed an explicit override to dodge
  // the collision with the Pro button, /welcome did not, and /welcome is the
  // screen that actually charged someone. A safe default means the next caller
  // cannot reintroduce it by forgetting a prop.
  freeLabel = "Continue with Free →",
  onIapPurchased,
  onCreateAccountForPro,
  trialEligible = true,
  initialTier = "pro",
  onLeftForOffice,
}: {
  /** Native only: the Office button really did open the default browser. The
   *  caller uses it to re-check the plan when the person comes back. */
  onLeftForOffice?: () => void;
  /** Web, phone width: which plan tab is open first. "office" for someone the
   *  app's Office card sent here (NATIVE_OFFICE_PATH) — they came for Office,
   *  so they should not land on Pro and have to find the tab. */
  initialTier?: PlanTier;
  /** Web: false for someone who already had a Pro trial; the Pro card then
   *  shows the plain price instead of promising "14 days free". */
  trialEligible?: boolean;
  onFree: () => void;
  onPaid: (plan: PaidPlan, annual: boolean, seats: number) => void;
  busy?: "free" | PaidPlan | null;
  freeLabel?: string;
  /** Native only: continue the caller's flow after an In-App Purchase
   *  succeeds (entitlement already synced). Default reloads the page. */
  onIapPurchased?: () => void;
  /** Native + SIGNED OUT only: begin account creation from the Pro card.
   *  Deliberately its own prop rather than reusing onPaid — onPaid is the web
   *  checkout hand-off, and the native branch must never be able to reach it
   *  (pinned by tests/wallet-hardening.test.ts). This one only ever starts
   *  signup; the purchase itself happens later, in-app, through StoreKit. */
  onCreateAccountForPro?: () => void;
}) {
  const [annual, setAnnual] = useState(false);
  const [seats, setSeats] = useState<number>(OFFICE_MIN_SEATS);
  // What is being TYPED in the Custom box, clamped only on blur. Clamping each
  // keystroke turned the "1" of "12" into 2, so 10–19 could not be typed.
  const [seatsDraft, setSeatsDraft] = useState<string | null>(null);
  const disabled = busy !== null;
  const native = useIsNativeApp();
  const isMobile = useIsMobile();
  const [mobileTier, setMobileTier] = useState<PlanTier>(initialTier);

  // NATIVE (App Store 3.1.1): this is the shared selling widget — prices, paid
  // plans, checkout hand-off. None of that may render inside the Capacitor
  // shell. Native gets ONLY the free continue action so every caller
  // (/welcome, the card wizard's guest plan step) still has a way forward.
  // Web is byte-identical (native is false on SSR and the first paint).
  if (native) {
    // IAP era. The shell shows the SAME Pro and Free cards as the website —
    // aurora Pro card with the owner-approved ProTrialPrice block, Free
    // Forever beneath it. Two deliberate differences, both required by
    // App Review:
    //   • Pro's price comes from StoreKit (NativePro reads the live package),
    //     never from PLAN_PRICES, so the app can never show a number that
    //     differs from the App Store's (3.1.2).
    //   • Office (NativeOffice, under Free — owner, 2026-09-18: "what if I
    //     wanted to get an Office account?") is per-seat and Stripe-billed with
    //     no IAP product, so the app can neither sell it nor quote it. Its card
    //     carries NO price and NO checkout hand-off: the one button leaves the
    //     app for the default browser, which is the remedy App Review itself
    //     named for the US storefront (lib/external-purchase). Fails closed —
    //     a shell that cannot leave the app renders no Office card at all.
    return (
      <div className="max-w-md mx-auto flex flex-col gap-4">
        <NativePro
          features={PLAN_FEATURES.pro}
          trialEligible={trialEligible}
          onPurchased={onIapPurchased}
          onNeedsAccount={onCreateAccountForPro}
        />

        {/* Free — identical to the website's card */}
        <div className="rounded-[28px] p-7 flex flex-col bg-white border border-slate-200 shadow-[0_18px_40px_-24px_rgba(15,23,42,0.5)]">
          <p className="text-[1.35rem] font-extrabold tracking-tight text-slate-900 mb-3">Free <span className="text-slate-500">Forever</span></p>
          <div className="flex items-end gap-1 mb-1"><span className="text-[2.4rem] font-bold text-slate-900 leading-none">$0</span><span className="text-slate-500 text-sm mb-1">/ month</span></div>
          <p className="text-slate-500 text-sm mb-6 mt-2">{PLAN_DESCRIPTIONS.free}</p>
          <ul className="space-y-2.5 mb-7 flex-1">
            {PLAN_FEATURES.free.map((f) => (<li key={f} className="flex items-start gap-2.5 text-[0.8125rem] text-slate-600"><Check />{f}</li>))}
          </ul>
          <button onClick={onFree} disabled={disabled} className="w-full text-center font-bold py-3.5 rounded-full text-sm bg-slate-900 hover:bg-slate-800 text-white transition-colors disabled:opacity-50">
            {busy === "free" ? "Setting up…" : freeLabel}
          </button>
        </div>

        <NativeOffice features={PLAN_FEATURES.office} disabled={disabled} onLeft={onLeftForOffice} />
      </div>
    );
  }

  return (
    <div>
      {/* Monthly / annual toggle — matches the Pricing page */}
      {/* On a phone with the Free tab open the switch changes nothing on
          screen, so it is hidden — `invisible`, not removed, so the tabs below
          do not jump when switching (2026-09-22 signup review). */}
      <div className={`flex justify-center mb-8 ${isMobile && mobileTier === "free" ? "invisible" : ""}`} aria-hidden={isMobile && mobileTier === "free" ? true : undefined}>
        {/* Theme classes (gray-*), not white/NN: this chooser renders on /welcome
            and the builder's plan gate, which are LIGHT for most people, and
            the light theme remaps gray-* but not white-with-opacity — the
            inactive label was white-on-cream, invisible (2026-09-16 web run). */}
        <div className="inline-flex items-center gap-4 rounded-full px-5 py-2.5 border border-gray-800 bg-gray-900/40">
          <span className={`text-sm font-medium transition-colors ${!annual ? "text-white" : "text-gray-500"}`}>Monthly</span>
          <button onClick={() => setAnnual(!annual)} aria-label="Toggle annual billing" className="relative w-11 h-6 rounded-full transition-colors duration-200" style={{ background: annual ? "#2563EB" : "#475569" }}>
            <div className="absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200" style={{ transform: annual ? "translateX(22px)" : "translateX(2px)" }} />
          </button>
          <span className={`text-sm font-medium transition-colors ${annual ? "text-white" : "text-gray-500"}`}>
            Annual <span className="ml-1 text-[0.625rem] font-black text-emerald-300 bg-emerald-400/15 px-1.5 py-0.5 rounded-full">SAVE 10%</span>
          </span>
        </div>
      </div>

      <MobilePlanTabs active={mobileTier} onChangeAction={setMobileTier} dark />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5 items-stretch">
        {/* Free */}
        <div className={`${isMobile && mobileTier !== "free" ? "hidden" : ""} rounded-[28px] p-7 flex flex-col bg-white border border-slate-200 shadow-[0_18px_40px_-24px_rgba(15,23,42,0.5)]`}>
          {/* "Forever" inherits the heading's size/weight/font from this <p>;
              the span overrides ONLY the color (slate-400 — the same light gray
              this card already uses for "/ month"). Mirrors /pricing. */}
          <p className="text-[1.35rem] font-extrabold tracking-tight text-slate-900 mb-3">Free <span className="text-slate-500">Forever</span></p>
          <div className="flex items-end gap-1 mb-1"><span className="text-[2.4rem] font-bold text-slate-900 leading-none">$0</span><span className="text-slate-500 text-sm mb-1">/ month</span></div>
          <p className="text-slate-500 text-sm mb-6 mt-2">{PLAN_DESCRIPTIONS.free}</p>
          <ul className="space-y-2.5 mb-7 flex-1">
            {PLAN_FEATURES.free.map((f) => (<li key={f} className="flex items-start gap-2.5 text-[0.8125rem] text-slate-600"><Check />{f}</li>))}
          </ul>
          <button onClick={onFree} disabled={disabled} className="w-full text-center font-bold py-3.5 rounded-full text-sm bg-slate-900 hover:bg-slate-800 text-white transition-colors disabled:opacity-50">
            {busy === "free" ? "Setting up…" : freeLabel}
          </button>
        </div>

        {/* Pro — highlighted, glistening */}
        <div className={`${isMobile && mobileTier !== "pro" ? "hidden" : ""} relative rounded-[28px] p-7 flex flex-col overflow-hidden`} style={{ background: "var(--rd-aurora)", boxShadow: "0 40px 90px -30px rgba(37,99,235,0.6)" }}>
          <div className="absolute inset-0 opacity-25" style={{ background: "radial-gradient(120% 90% at 20% -10%, rgba(255,255,255,0.6), transparent 55%)" }} />
          <div className="absolute top-6 right-6 z-[4] bg-white/25 text-white text-[0.6875rem] font-bold px-3 py-1 rounded-full">MOST POPULAR</div>
          <div className="relative z-[2] flex flex-col flex-1">
            <p className="text-[1.35rem] font-extrabold tracking-tight text-black mb-3">Pro</p>
            {/* "Free for your first 14 days, then $X" — owner-approved
                2026-08-19; identical block on /pricing and /upgrade. */}
            {!trialEligible ? (
              <div className="flex items-end gap-1"><span className="text-[2.4rem] font-bold text-white leading-none">{annual ? `$${PRO_ANNUAL}` : `$${PRO_MONTHLY}`}</span><span className="text-white/80 text-sm mb-1">/ {annual ? "year" : "month"}</span></div>
            ) : annual ? (
              <ProTrialPrice price={`$${PRO_ANNUAL}`} period="year" note={`~$${PRO_ANNUAL_PER_MO}/mo · Save 10%`} />
            ) : (
              <ProTrialPrice price={`$${PRO_MONTHLY}`} period="month" />
            )}
            <p className="text-white/80 text-sm mb-6 mt-4">{PLAN_DESCRIPTIONS.pro}</p>
            <ul className="space-y-2.5 mb-7 flex-1">
              {PLAN_FEATURES.pro.map((f) => (<li key={f} className="flex items-start gap-2.5 text-[0.8125rem] text-white"><Check pro />{f}</li>))}
            </ul>
            {/* "Try Pro free for 14 days →", never a bare "Start free →".
                This button sits inches from the Free plan's button, and when
                both read as some flavour of "free" the only genuinely free one
                is indistinguishable from the one that takes a card. That is not
                hypothetical: a guest chose Free, was shown this chooser again
                on /welcome because the stored choice had been consumed, tapped
                this button, and was put on a 14-day Pro trial they had
                explicitly declined a minute earlier (owner report 2026-09-15).
                The word "free" here is bound to Pro and to a time limit. */}
            <button onClick={() => onPaid("pro", annual, 1)} disabled={disabled} className="w-full bg-white hover:bg-white/90 disabled:opacity-50 text-[#2450d8] font-bold py-3.5 rounded-full transition-colors text-sm shadow-lg">
              {busy === "pro" ? "Loading…" : trialEligible ? `Try Pro free for ${TRIAL_DAYS} days →` : "Get Pro →"}
            </button>
            {/* Eligibility + billing terms stay here; ProTrialCallout above
                carries the offer itself. "for new customers" is load-bearing —
                checkout only grants a trial to customers with no prior Stripe
                subscription (pinned by copy-truth.test.ts). */}
            <p className="text-white/70 text-[0.6875rem] text-center mt-2.5 leading-relaxed">
              {trialEligible ? `${TRIAL_DAYS} days free for new customers · card required · renews automatically` : "Renews automatically · cancel anytime"}
            </p>
          </div>
          <span className="rd-glisten-sweep" aria-hidden="true" />
        </div>

        {/* Office */}
        <div className={`${isMobile && mobileTier !== "office" ? "hidden" : ""} rounded-[28px] p-7 flex flex-col bg-white border border-slate-200 shadow-[0_18px_40px_-24px_rgba(15,23,42,0.5)]`}>
          <p className="text-[1.35rem] font-extrabold tracking-tight text-slate-900 mb-3">Office</p>
          <div className="mb-1">
            <div className="flex items-end gap-1"><span className="text-[2.4rem] font-bold text-slate-900 leading-none">${annual ? formatCents(perMonthCents(PLAN_PRICES.OFFICE_ANNUAL_PER_SEAT_CENTS)) : formatCents(PLAN_PRICES.OFFICE_MONTHLY_PER_SEAT_CENTS)}</span><span className="text-slate-500 text-sm mb-1">/ mo per user</span></div>
            <p className="text-blue-600 text-xs font-semibold mt-1.5">Minimum {OFFICE_MIN_SEATS} users{annual ? " · billed annually, save 10%" : ""}</p>
            <p className="text-slate-800 font-bold text-[0.8125rem] mt-1">{seats} users → {annual
              ? `${formatUsd(seatSubtotalCents(PLAN_PRICES.OFFICE_ANNUAL_PER_SEAT_CENTS, seats))}/yr`
              : `${formatUsd(seatSubtotalCents(PLAN_PRICES.OFFICE_MONTHLY_PER_SEAT_CENTS, seats))}/mo`}</p>
          </div>
          <div className="mt-4 mb-5">
            <label className="text-xs text-slate-600 font-medium block mb-2">Team size</label>
            <div className="flex gap-2 flex-wrap">
              {[2, 5, 10, 25, 50].map((n) => (
                <button key={n} onClick={() => setSeats(n)} className="px-3 py-1.5 rounded-full text-xs font-semibold transition-colors"
                  style={{ background: seats === n ? "#2563EB" : "#f1f5f9", color: seats === n ? "#fff" : "#475569", border: seats === n ? "none" : "1px solid #e2e8f0" }}>{n} users</button>
              ))}
            </div>
            <div className="mt-2 flex items-center gap-2">
              {/* A bare number box with "Custom:" beside it as plain text has
                  no accessible name at all — a screen reader announced an
                  unlabelled spin button on the purchase screen. The identical
                  control on /pricing has carried htmlFor + aria-label since it
                  was written; these two copies never picked it up. */}
              <label htmlFor="office-seats-plancards" className="text-xs text-slate-400">Custom:</label>
              <input id="office-seats-plancards" aria-label="Number of team seats" type="number" min={OFFICE_MIN_SEATS} value={seatsDraft ?? seats}
                onChange={(e) => { setSeatsDraft(e.target.value); const n = Math.floor(Number(e.target.value)); if (n >= OFFICE_MIN_SEATS) setSeats(n); }}
                onBlur={() => setSeatsDraft(null)}
                className="w-20 rounded-lg px-2.5 py-1.5 text-xs text-slate-900 bg-white border border-slate-200 focus:outline-none" />
              <span className="text-xs text-slate-400">users</span>
            </div>
          </div>
          <ul className="space-y-2.5 mb-7 flex-1">
            {PLAN_FEATURES.office.map((f) => (<li key={f} className="flex items-start gap-2.5 text-[0.8125rem] text-slate-600"><Check />{f}</li>))}
          </ul>
          <button onClick={() => onPaid("office", annual, seats)} disabled={disabled} className="w-full font-bold py-3.5 px-3 rounded-full text-sm leading-tight bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white transition-colors break-words">
            {busy === "office" ? "Loading…" : `Get Office · ${annual
              ? `${formatUsd(seatSubtotalCents(PLAN_PRICES.OFFICE_ANNUAL_PER_SEAT_CENTS, seats))}/yr`
              : `${formatUsd(seatSubtotalCents(PLAN_PRICES.OFFICE_MONTHLY_PER_SEAT_CENTS, seats))}/mo`} →`}
          </button>
        </div>
      </div>
    </div>
  );
}


/**
 * The native Pro card: the website's aurora card, but its price is the LIVE
 * StoreKit price for the monthly product. While StoreKit is still answering
 * (or when products are unavailable) the price line is simply absent — the
 * card never guesses a number.
 *
 * The CTA is always there. Signed in it opens the In-App Purchase sheet;
 * signed out (the guest card wizard, i.e. the first thing a new download
 * does) it starts account creation, and /welcome then offers the purchase.
 * It used to render nothing at all when signed out, leaving a Pro card with a
 * feature list and no way to buy — which is the shape of the 3.1.1 rejection.
 */
function NativePro({
  features,
  trialEligible,
  onPurchased,
  onNeedsAccount,
}: {
  features: readonly string[];
  /** The caller's account-level answer (false: already had a free Pro period,
   *  or a friend's free month is on offer instead — WelcomePlan's offerTrial).
   *  The web card honoured it; this one ignored it, so the app showed "Start
   *  my free month" and "Try Pro free for 14 days" side by side. */
  trialEligible?: boolean;
  onPurchased?: () => void;
  /** Guest (signed-out) shell: start account creation instead of a purchase —
   *  there is no account to attribute a subscription to yet. */
  onNeedsAccount?: () => void;
}) {
  // Prices from StoreKit; the trial only for an Apple ID that can get it.
  const { monthly: price, annual, trial } = useIapOffer();
  // Only promise the trial once StoreKit has confirmed one for this Apple ID
  // AND the account may have it. `trial` is null while StoreKit is still
  // answering (or never answers), and the button used to read "Try Pro free
  // for 14 days" in exactly that state — then Apple's sheet said Subscribe.
  const offersTrial = trial === true && trialEligible !== false;
  return (
    <div className="relative rounded-[28px] p-7 flex flex-col overflow-hidden" style={{ background: "var(--rd-aurora)", boxShadow: "0 40px 90px -30px rgba(37,99,235,0.6)" }}>
      <div className="absolute inset-0 opacity-25" style={{ background: "radial-gradient(120% 90% at 20% -10%, rgba(255,255,255,0.6), transparent 55%)" }} />
      <div className="absolute top-6 right-6 z-[4] bg-white/25 text-white text-[0.6875rem] font-bold px-3 py-1 rounded-full">MOST POPULAR</div>
      <div className="relative z-[2] flex flex-col flex-1">
        <p className="text-[1.35rem] font-extrabold tracking-tight text-black mb-3">Pro</p>
        {price ? (
          offersTrial
            ? <ProTrialPrice price={price} period="month" />
            : <div className="flex items-end gap-1"><span className="text-[2.4rem] font-bold text-white leading-none">{price}</span><span className="text-white/80 text-sm mb-1">/ month</span></div>
        ) : null}
        {annual && <p className="text-white/80 text-xs mt-2">or {annual} / year</p>}
        <p className="text-white/80 text-sm mb-6 mt-4">{PLAN_DESCRIPTIONS.pro}</p>
        <ul className="space-y-2.5 mb-7 flex-1">
          {features.map((f) => (<li key={f} className="flex items-start gap-2.5 text-[0.8125rem] text-white"><Check pro />{f}</li>))}
        </ul>
        <IapSubscribeButton
          className="!w-full !py-3.5 !text-sm !bg-white !text-[#2450d8]"
          label={offersTrial ? `Try Pro free for ${TRIAL_DAYS} days →` : "Get Pro →"}
          sublabel={offersTrial ? `${TRIAL_DAYS} days free, then billed by Apple` : "Billed by Apple · monthly or yearly"}
          onPurchased={onPurchased}
          onNeedsAccount={onNeedsAccount}
        />
        <p className="text-white/70 text-[0.6875rem] text-center mt-2.5 leading-relaxed">
          {offersTrial
            ? `${TRIAL_DAYS} days free for new subscribers · renews automatically · cancel anytime in your Apple account`
            : "Renews automatically · cancel anytime in your Apple account"}
        </p>
      </div>
      <span className="rd-glisten-sweep" aria-hidden="true" />
    </div>
  );
}

/** Where the app's Office button lands, in the default browser: the same plan
 *  step on the website, opened on its Office tab so the seat picker and
 *  checkout are one tap away (welcome/page.tsx keeps `tier` through sign-in). */
export const NATIVE_OFFICE_PATH = "/welcome?tier=office";

/**
 * The native Office card: the website's white Office card — same title, same
 * feature list — with no price, no seat picker and no checkout, because none of
 * those may exist inside the app (see the note in the native branch above).
 *
 * One button, and it LEAVES the app: Office is set up and billed on
 * swiftcard.me, in the default browser. Same mechanism and same fail-closed
 * rule as the Team tab's "Add a seat on swiftcard.me": when the shell cannot
 * open the default browser the card is not rendered at all, since a plan card
 * nobody can act on is the shape App Review rejected.
 */
function NativeOffice({ features, disabled, onLeft }: { features: readonly string[]; disabled: boolean; onLeft?: () => void }) {
  // Read after mount: the plugin is window-only, so deciding during render
  // would disagree with the server HTML.
  const [canLinkOut, setCanLinkOut] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- window-only value, hydration-safe by design
    setCanLinkOut(canOfferExternalPurchase());
  }, []);
  if (!canLinkOut) return null;

  async function open() {
    setFailed(false);
    if (await openExternalPurchase(NATIVE_OFFICE_PATH)) onLeft?.();
    else setFailed(true);
  }

  return (
    <div className="rounded-[28px] p-7 flex flex-col bg-white border border-slate-200 shadow-[0_18px_40px_-24px_rgba(15,23,42,0.5)]">
      <p className="text-[1.35rem] font-extrabold tracking-tight text-slate-900 mb-3">Office</p>
      <p className="text-blue-600 text-xs font-semibold">Minimum {OFFICE_MIN_SEATS} users</p>
      <p className="text-slate-500 text-sm mb-6 mt-2">{PLAN_DESCRIPTIONS.office}</p>
      <ul className="space-y-2.5 mb-7 flex-1">
        {features.map((f) => (<li key={f} className="flex items-start gap-2.5 text-[0.8125rem] text-slate-600"><Check />{f}</li>))}
      </ul>
      <button onClick={() => { void open(); }} disabled={disabled} className="w-full font-bold py-3.5 px-3 rounded-full text-sm leading-tight bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white transition-colors break-words">
        Get Office on swiftcard.me →
      </button>
      <p className="text-slate-500 text-[0.6875rem] text-center mt-2.5 leading-relaxed">
        {failed
          ? "Couldn't open your browser. Go to swiftcard.me and sign in to set up Office."
          : "Opens swiftcard.me in your browser. Sign in with this account to set up your team — your card is saved either way."}
      </p>
    </div>
  );
}
