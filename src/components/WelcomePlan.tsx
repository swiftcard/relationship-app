"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import EnablePushButton from "@/components/EnablePushButton";
import ShareButton from "@/components/ShareButton";
import QRCodeModal from "@/components/QRCodeModal";
import CopyButton from "@/components/CopyButton";
import { qrScanUrl } from "@/lib/share-source";
import { GetTheAppCard } from "@/components/AppStoreBadge";
import PlanCards, { type PaidPlan } from "@/components/PlanCards";
import FreeDesignChoice from "@/components/FreeDesignChoice";
import { consumePlanIntent, type PlanIntent } from "@/lib/plan-intent";
import { detectNativeApp, useIsNativeApp } from "@/lib/platform";
import { TRIAL_DAYS, PLAN_PRICES, PLAN_LIMITS } from "@/lib/plan";
import { formatUsd, seatSubtotalCents } from "@/lib/currency";
import ReferralGiftPanel from "@/components/ReferralGiftPanel";
import PromoCodeBox, { usePromoCode } from "@/components/PromoCodeBox";

// Onboarding step shown once, right after a brand-new account's first card is
// saved (routed here by GuestDraftClaim → /welcome?card=slug). It turns on
// notifications, then finalizes the plan the visitor picked BEFORE signing up:
// Free → dashboard + guided tour, Pro/Office → Stripe checkout (which returns to
// the same dashboard + tour). If they arrive without a stored choice, it shows
// the full plan chooser instead.

// Where checkout (and the Free choice) send the user: dashboard, welcome popup,
// and an auto-started guided tour — everything a new account should get.
const LANDING = "/dashboard?welcome=1&tour=1";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://swiftcard.me";

export default function WelcomePlan({
  cardSlug,
  cardName = "",
  designConverted = false,
  // What Free will change about the card they just built, in plain English,
  // computed server-side in welcome/page.tsx from the saved row (never from
  // React state, which is a tick behind). Empty for a card that uses nothing
  // Pro — and an empty list is the whole reason `chooseFree` has a fast path.
  proDesignChanges = [],
  presetIntent = null,
  presetPromo = null,
  setupFor = null,
  canceled = false,
  trialEligible = true,
  referralGift = false,
  initialTier = "pro",
}: {
  /** The name on the card, for the QR popup's "Scan to connect with <first name>". */
  cardName?: string;
  /** Phone-width web: open the plan tabs on Office (sent by the app's Office card). */
  initialTier?: "pro" | "office";
  /** A friend's free month of Pro is waiting (referral sign-up). Offered as a
   *  choice here — it used to switch on silently at signup and skip this step. */
  referralGift?: boolean;
  /** Back from a cancelled Stripe checkout. */
  canceled?: boolean;
  /** Whether this account can still get the 14-day Pro trial. */
  trialEligible?: boolean;
  /** Back from Stripe with the plan already paid: open straight on the
   *  "card is live" setup step, then continue to this plan's home. */
  setupFor?: "pro" | "office" | null;
  cardSlug: string | null;
  /** A paid plan picked on /pricing, carried in the URL through signup. */
  presetIntent?: PlanIntent | null;
  /** A promo code in the link with no plan picked yet — the iPhone app's
   *  "Use it on swiftcard.me" (PlanCards NativePromoCode). It opens in the
   *  chooser's box, already checked. */
  presetPromo?: string | null;
  designConverted?: boolean;
  proDesignChanges?: string[];
}) {
  const router = useRouter();
  const native = useIsNativeApp();
  // undefined = not read yet (avoids a hydration flash); null = no stored choice.
  const [intent, setIntent] = useState<PlanIntent | null | undefined>(undefined);
  const [loading, setLoading] = useState<"free" | PaidPlan | null>(null);
  const [error, setError] = useState("");
  // Asked only when there is something to lose; see chooseFree.
  const [pendingFreeConfirm, setPendingFreeConfirm] = useState(false);
  // THE ORDER (owner, 2026-09-16): card → account → PLAN → "your card is live"
  // (notifications, and the app on the web) → dashboard + tour. Notifications
  // used to be offered ABOVE the plan cards, before the card was even live,
  // and nothing asked again after the plan was chosen.
  // Office lands on the owner's OWN dashboard with the tour, same as Pro —
  // never straight into the admin console (owner, 2026-09-22). The team
  // console is one tap away on the dashboard's Admin tab.
  const [setupNext, setSetupNext] = useState<string | null>(
    setupFor ? LANDING + "&upgraded=true" : null,
  );
  function finishSetup() {
    // The web dashboard's "Get the app" popup would repeat the card shown here.
    try { localStorage.setItem("sc_appstore_seen", "1"); } catch { /* ignore */ }
    // They just answered the notifications question on this screen; the
    // dashboard's "Know the moment someone connects" nudge must not ask again
    // seconds later (its activity ask can still come once views arrive).
    try { if (!localStorage.getItem("sc_push_nudge_dismissed")) localStorage.setItem("sc_push_nudge_dismissed", "1"); } catch { /* ignore */ }
    router.push(setupNext ?? LANDING);
  }

  useEffect(() => {
    // NATIVE (App Store 3.1.1): never resume a stored paid-plan intent inside
    // the Capacitor shell — the "Complete your subscription" checkout panel is
    // a selling surface. Native always falls through to the plan step, where
    // PlanCards renders only the free continue action. Web unchanged.
    // presetIntent only: nothing writes the old localStorage plan intent any
    // more, so reading it could resurface a stale "Complete your Pro
    // subscription" from a past visit. Still cleared so it can't linger.
    consumePlanIntent();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time consume of stored intent on mount (reads+clears storage; must not run during render)
    setIntent(detectNativeApp() ? null : presetIntent);
  }, [presetIntent]);

  // Back from Stripe's page restores this one from the back/forward cache
  // exactly as it was left: every button disabled on "Redirecting to
  // checkout…", with nothing to reset it. Clear the busy state on that return.
  useEffect(() => {
    const onShow = (e: PageTransitionEvent) => { if (e.persisted) setLoading(null); };
    window.addEventListener("pageshow", onShow);
    return () => window.removeEventListener("pageshow", onShow);
  }, []);

  // NATIVE: the Office card and the promo code's "Use it on swiftcard.me" send
  // people OUT to swiftcard.me (PlanCards). When they come back the plan may
  // be settled — re-ask the server, which sends a paid account on to its dashboard instead
  // of leaving them on a chooser for a choice they have already made. Only
  // after that button was actually used: an Apple purchase sheet must never be
  // able to trigger this and race the "Your card is live!" step.
  const leftForWebsite = useRef(false);
  useEffect(() => {
    const onReturn = () => { if (leftForWebsite.current && document.visibilityState === "visible") router.refresh(); };
    document.addEventListener("visibilitychange", onReturn);
    return () => document.removeEventListener("visibilitychange", onReturn);
  }, [router]);

  // Straight to the dashboard, settling nothing. Used ONLY after a purchase has
  // already happened (onIapPurchased) — they are on a paid plan, so the free
  // settle below must not run and tell the account otherwise.
  function goFree() {
    setLoading(null);
    setSetupNext(LANDING);
  }

  /**
   * "I'll stay on Free" — the gate, mirroring handleAuthedFirstCardFree in
   * NewCardWizard so the two paths cannot drift.
   *
   * A card that uses nothing Pro has nothing to be warned about, so asking
   * would be a pointless extra screen. A card that DOES is not flattened
   * silently: the panel names what changes and offers to keep it on a trial.
   */
  function chooseFree() {
    if (proDesignChanges.length) { setPendingFreeConfirm(true); return; }
    void confirmFree();
  }

  /**
   * They chose Free with their eyes open — make it real.
   *
   * One endpoint rather than three calls because the three things have to
   * happen together (see api/account/choose-plan): the design is converted for
   * good, the plan is marked settled, and THAT is what releases the welcome
   * email. Navigating without it would leave an account whose plan was never
   * decided and which therefore never gets greeted.
   */
  async function confirmFree() {
    setLoading("free");
    setError("");
    try {
      const res = await fetch("/api/account/choose-plan", { method: "POST" });
      if (res.status === 401) { window.location.href = "/login?next=/welcome"; return; }
      if (!res.ok) {
        const { error: err, message } = await res.json().catch(() => ({ error: null, message: null }));
      // `error` is the MACHINE CODE in this codebase's convention and `message`
      // is the sentence written for the reader (api/cards/route.ts:52 returns
      // {error:"limit", message:"Ready for a second card?…"}). Read in the
      // wrong order, a user is shown the literal word "limit" in a red box.
        setError(message || err || "Couldn't save your plan. Please try again.");
        setLoading(null);
        return;
      }
      setPendingFreeConfirm(false);
      setLoading(null);
      setSetupNext(LANDING);
    } catch {
      setError("Couldn't reach the server. Please try again.");
      setLoading(null);
    }
  }

  // "Start my free month of Pro" — the referral gift. No payment: the server
  // verifies the gift is still pending and starts the month.
  async function startGiftMonth() {
    setLoading("pro");
    setError("");
    try {
      const res = await fetch("/api/account/choose-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ referralMonth: true }),
      });
      if (res.status === 401) { window.location.href = "/login?next=/welcome"; return; }
      if (!res.ok) {
        const { error: err, message } = await res.json().catch(() => ({ error: null, message: null }));
      // `error` is the MACHINE CODE in this codebase's convention and `message`
      // is the sentence written for the reader (api/cards/route.ts:52 returns
      // {error:"limit", message:"Ready for a second card?…"}). Read in the
      // wrong order, a user is shown the literal word "limit" in a red box.
        setError(message || err || "Couldn't start your free month. Please try again.");
        setLoading(null);
        return;
      }
      setPendingFreeConfirm(false);
      setLoading(null);
      setSetupNext(LANDING);
    } catch {
      setError("Couldn't reach the server. Please try again.");
      setLoading(null);
    }
  }

  // With a friend's free month on offer, the Pro card must not ALSO promise
  // the 14-day trial: two different free offers side by side, and the account
  // only ever gets one free Pro period (lib/trial-eligibility).
  const offerTrial = trialEligible && !referralGift;

  const giftPanel = referralGift ? (
    <ReferralGiftPanel onStart={startGiftMonth} busy={loading !== null} starting={loading === "pro"} />
  ) : null;

  const paidIntent = intent && (intent.plan === "pro" || intent.plan === "office") ? intent : null;

  // ── "Have a promo code?" ──────────────────────────────────────────────────
  // The same box as the order page (/checkout). A new account paying here
  // used to have nowhere to type a code: only one carried over from /pricing
  // was sent, silently. With a plan already picked (/pricing → signup) the
  // code is checked against it; on the open chooser it is checked for
  // validity and its fit is settled when a plan card is pressed.
  const promo = usePromoCode({
    plan: paidIntent?.plan === "office" ? "office" : paidIntent ? "pro" : null,
    interval: paidIntent ? (paidIntent.annual ? "annual" : "monthly") : null,
    initialCode: paidIntent?.promo ?? presetPromo,
  });
  // The last plan pressed, so "Continue without the code" retries exactly it.
  const lastCheckout = useRef<{ plan: PaidPlan; annual: boolean; seats: number } | null>(null);

  async function checkout(plan: PaidPlan, annual: boolean, seats: number, opts?: { withoutPromo?: boolean }) {
    // A code refused at checkout stays on screen with its two ways out
    // (remove it, or continue without it) — never a full price behind
    // the person's back.
    if (promo.blocksPurchase && !opts?.withoutPromo) {
      setError(promo.state.status === "checking" ? "Still checking your promo code…" : "Your promo code couldn't be applied — remove it or continue without it above.");
      return;
    }
    const code = opts?.withoutPromo ? undefined : promo.appliedCode;
    lastCheckout.current = { plan, annual, seats };
    setLoading(plan);
    setError("");
    try {
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // Unified {plan, interval, seats} — price resolves server-side.
          plan: plan === "office" ? "office" : "pro",
          interval: annual ? "annual" : "monthly",
          seats: plan === "office" ? seats : 1,
          ...(code ? { promoCode: code } : {}),
          // Office owners go to the Office dashboard after payment; Pro keeps the
          // guided-tour landing. (The card was already created before payment in
          // this guest flow, so no post-payment card step is needed here.)
          // Back through the "card is live" setup step, then on to the
          // Office dashboard (office) or the dashboard + tour (pro).
          successPath: plan === "office" ? "/welcome?step=setup&for=office" : "/welcome?step=setup&for=pro",
        }),
      });
      if (res.status === 401) { window.location.href = "/login?next=/welcome"; return; }
      const { url, error: err, message, redirect, promoUnusable, grant } = await res.json();
      if (url) { window.location.href = url; return; }
      // 409 already_subscribed: this account paid (often in another tab) — go
      // where the server says, never show the raw error code.
      if (res.status === 409 && typeof redirect === "string" && redirect.startsWith("/")) { window.location.href = redirect; return; }
      // The code doesn't apply to THIS purchase (the other plan, expired, the
      // last use went): say so in the box, with "Continue without the code".
      if (res.status === 409 && promoUnusable && code) {
        promo.refuseAtCheckout(code, err || "That code can't be used for this purchase.", grant === true);
        setLoading(null);
        return;
      }
      setError(message || err || "Couldn't start checkout. Please try again.");
      setLoading(null);
    } catch {
      setError("Couldn't reach the server. Please try again.");
      setLoading(null);
    }
  }

  const planName = paidIntent?.plan === "office" ? "Office" : "Pro";
  // What they will pay, from plan.ts — the same arithmetic /checkout and
  // Stripe use (unit price × seats), so this panel never shows another number.
  const paidSeats = paidIntent?.plan === "office" ? Math.max(PLAN_LIMITS.OFFICE_MIN_SEATS, paidIntent.seats ?? PLAN_LIMITS.OFFICE_MIN_SEATS) : 1;
  const paidTotal = paidIntent
    ? paidIntent.plan === "office"
      ? seatSubtotalCents(paidIntent.annual ? PLAN_PRICES.OFFICE_ANNUAL_PER_SEAT_CENTS : PLAN_PRICES.OFFICE_MONTHLY_PER_SEAT_CENTS, paidSeats)
      : paidIntent.annual ? PLAN_PRICES.PRO_ANNUAL_CENTS : PLAN_PRICES.PRO_MONTHLY_CENTS
    : 0;

  const continueWithoutCode = () => {
    const last = lastCheckout.current;
    if (last) void checkout(last.plan, last.annual, last.seats, { withoutPromo: true });
  };

  // Routes are case-insensitive, so the pretty slug shown on screen is also
  // the link that is shared and encoded in the QR.
  const liveUrl = `${APP_URL}/${cardSlug ?? ""}`;
  const ownerFirstName = cardName.trim().split(/\s+/)[0] || "me";

  return (
    <main className="sc-app min-h-screen bg-gray-950 px-5 py-12">
      <div className="max-w-6xl mx-auto">
        {setupNext !== null ? (
          // ── Step after the plan: the card is live now ───────────────────
          <div className="max-w-md mx-auto text-center">
            <div className="w-14 h-14 rounded-full bg-green-900/40 border border-green-700/40 flex items-center justify-center mx-auto mb-4">
              <svg className="w-7 h-7 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
            </div>
            {/* No card yet: the plan was bought here, on swiftcard.me, from the
                app's builder (its "Use it on swiftcard.me" or Office button),
                and the app saves the card when they go back to it. */}
            <h1 className="text-white font-bold text-2xl sm:text-3xl">{cardSlug ? "Your card is live!" : "You're all set!"}</h1>
            {cardSlug && (
              <div className="mt-2 inline-flex max-w-full items-center gap-2 bg-gray-800/60 border border-gray-700/60 rounded-xl pl-3 pr-1.5 py-1.5">
                <span className="text-blue-400 text-sm font-mono truncate">swiftcard.me/{cardSlug}</span>
                <CopyButton text={liveUrl} />
              </div>
            )}
            <p className="text-gray-400 text-sm mt-3">
              {cardSlug ? "We also sent you an email with your link." : "Your plan is on. Finish your card in the SwiftCard app, or from your dashboard here."}
            </p>
            {/* Share first — the card exists to be handed to people. The
                notifications switch and the app offer follow (they used to
                lead, before anyone had shared anything; audit 2026-09-30). */}
            {cardSlug && (
              <div className="mt-6 space-y-2 text-left">
                <QRCodeModal url={qrScanUrl(liveUrl)} firstName={ownerFirstName} label="Show QR" variant="primary" />
                <ShareButton url={liveUrl} title="My SwiftCard" text="Save my contact and connect with me instantly." label="Share link" variant="ghost" ownCard />
              </div>
            )}
            {/* One notifications control: it carries its own heading and, in an
                iPhone browser, its own Add-to-Home-Screen guide. A second
                "Turn on notifications" box above it said the same thing twice. */}
            <div className="mt-5 mb-3"><EnablePushButton /></div>
            <GetTheAppCard className="mt-3" />
            <button
              type="button"
              onClick={finishSetup}
              className="mt-6 w-full bg-blue-600 hover:bg-blue-500 text-white font-semibold py-3.5 rounded-full transition-colors text-sm"
            >
              Go to my dashboard →
            </button>
          </div>
        ) : (
        <>
        {/* Header */}
        <div className="text-center mb-8">
          {/* NOT "live" yet: a new account's card goes live when a plan is
              chosen, not before (owner, 2026-09-16; lib/card-active rule 5). */}
          <h1 className="text-white font-bold text-2xl sm:text-3xl">Your account is ready</h1>
          {cardSlug && <p className="text-blue-400 text-sm mt-1.5 font-mono">swiftcard.me/{cardSlug}</p>}
          <p className="text-gray-400 text-sm mt-3 max-w-md mx-auto">{paidIntent && !pendingFreeConfirm ? "Finish checkout below and your card goes live at this link." : "Choose your plan below and your card goes live at this link."}</p>
        </div>

        {/* Plan finalize / chooser */}
        {intent === undefined ? (
          <div className="flex justify-center py-8"><div className="h-7 w-7 animate-spin rounded-full border-2 border-gray-700 border-t-blue-500" /></div>
        ) : paidIntent && !pendingFreeConfirm ? (
          // `!pendingFreeConfirm`: "Actually, start on the free plan instead"
          // below runs chooseFree, which opens "Before you go Free" when the
          // card uses Pro design. This branch used to be checked first, so
          // that panel was set but never drawn and the link did nothing.
          // They picked a paid plan before signing up → complete payment.
          <div className="max-w-md mx-auto text-center">
            {canceled && (
              <p className="mb-5 text-sm text-gray-400 bg-gray-900 border border-gray-800 rounded-xl px-4 py-3">
                Checkout was cancelled and nothing was charged. Your selection is saved — continue whenever you&apos;re ready.
              </p>
            )}
            <h2 className="text-white font-bold text-xl">Complete your {planName} subscription</h2>
            {/* The 14-day trial is the offer /pricing sold them. It used to show
                only in the fine print, under "Pay securely with Stripe to
                unlock it" — which reads as a charge today. */}
            <p className="text-gray-400 text-sm mt-1.5">
              {paidIntent.plan === "pro" && trialEligible
                ? <>You picked Pro · free for your first {TRIAL_DAYS} days, then {formatUsd(paidTotal)}/{paidIntent.annual ? "year" : "month"}. Add a card with Stripe to start your trial.</>
                : <>You picked {planName}{paidIntent.plan === "office" ? ` · ${paidSeats} seats (incl. you)` : ""} · {formatUsd(paidTotal)}/{paidIntent.annual ? "year" : "month"}. Pay securely with Stripe to unlock it.</>}
            </p>
            <PromoCodeBox className="mt-4" promo={promo} busy={loading !== null} onContinueWithoutCode={continueWithoutCode} />
            <button
              onClick={() => checkout(paidIntent.plan as PaidPlan, !!paidIntent.annual, paidSeats)}
              disabled={loading !== null || promo.blocksPurchase}
              className="sc-dark-sheet mt-5 w-full py-3.5 rounded-full text-sm font-bold text-white transition-colors disabled:opacity-50"
              style={{ background: "var(--rd-aurora)" }}
            >
              {loading ? "Redirecting to checkout…" : `Continue to secure checkout →`}
            </button>
            <p className="mt-3 text-[0.6875rem] leading-relaxed text-gray-500">
              {paidIntent.plan === "pro" && trialEligible ? `${TRIAL_DAYS} days free for new customers · card required · renews automatically. ` : ""}
              By continuing you agree to our{" "}
              <Link href="/terms" className="underline hover:text-gray-300">Terms</Link> and{" "}
              <Link href="/privacy" className="underline hover:text-gray-300">Privacy Policy</Link>.
            </p>
            {/* chooseFree, not goFree: backing out of checkout is still a
                choice of Free, so it has to settle the plan like any other —
                otherwise this one path leaves an account whose plan was never
                decided, and the welcome email waits forever on a decision that
                already happened. */}
            <button onClick={chooseFree} disabled={loading !== null} className="mt-3 text-gray-500 hover:text-gray-300 text-xs transition-colors">
              Actually, start on the free plan instead →
            </button>
          </div>
        ) : pendingFreeConfirm ? (
          // Free, on a card built with Pro design. Asked HERE because this is
          // where the plan is actually decided — and because the card was
          // stored exactly as designed, "keep it" is a real offer rather than
          // an undo of something already flattened.
          <div className="max-w-md mx-auto">
            <div className="text-center mb-5">
              <h2 className="text-white font-bold text-xl">Before you go Free</h2>
              <p className="text-gray-400 text-sm mt-1.5">One thing to know about the card you just designed.</p>
            </div>
            {giftPanel}
            <FreeDesignChoice
              changes={proDesignChanges}
              // Keep the billing period they picked on /pricing — this always
              // started a MONTHLY subscription, even for an annual buyer.
              onKeepWithTrial={() => checkout("pro", paidIntent?.plan === "pro" && !!paidIntent.annual, 1)}
              trialEligible={offerTrial}
              onContinueFree={confirmFree}
              onIapPurchased={goFree}
              busy={loading !== null}
            />
            {/* No "← Back" (owner, 2026-09-18). Once Free is picked on a card
                that uses Pro design there are two ways on, and only two: keep
                the card exactly as built (the trial), or continue with Free
                and redesign with free features. */}
          </div>
        ) : (
          // THE plan step. Every account passes through here exactly once, with
          // the card already saved and the account already made — so the answer
          // has somewhere real to go the moment it is given.
          <>
            <div className="text-center mb-6">
              <h2 className="text-white font-bold text-xl">Choose your plan</h2>
              <p className="text-gray-400 text-sm mt-1">Your card is saved either way — pick how you want to run it.</p>
            </div>
            {canceled && (
              <p className="max-w-md mx-auto mb-5 text-center text-sm text-gray-400 bg-gray-900 border border-gray-800 rounded-xl px-4 py-3">
                Checkout was cancelled and nothing was charged. Pick a plan below whenever you&apos;re ready.
              </p>
            )}
            {giftPanel}
            <PlanCards onFree={chooseFree} onPaid={checkout} busy={loading} onIapPurchased={goFree} freeLabel="Continue with Free →" trialEligible={offerTrial} initialTier={initialTier} onLeftForWebsite={() => { leftForWebsite.current = true; }} />
            {/* Under the plans, like /pricing — the code rides along with
                whichever paid card is pressed. Web only: the app sells
                through the App Store, where codes are Apple's (3.1.1). */}
            {!native && (
              <PromoCodeBox className="max-w-md mx-auto mt-6 text-center" promo={promo} busy={loading !== null} onContinueWithoutCode={continueWithoutCode} />
            )}
          </>
        )}

        </>
        )}

        {error && <p className="text-red-400 text-sm text-center mt-5">{error}</p>}
      </div>
    </main>
  );
}
