"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useIsNativeApp } from "@/lib/platform";
import { redeemAppleOfferCode, syncIapAfterRedeem } from "@/lib/iap";
import MobilePlanTabs, { type PlanTier } from "@/components/MobilePlanTabs";
import { PLAN_LIMITS, TRIAL_DAYS } from "@/lib/plan";
import { PLAN_DESCRIPTIONS } from "@/lib/plan-content";
import ProTrialPrice from "@/components/ProTrialPrice";
import IapSubscribeButton from "@/components/NativePaywall";
import { useIapOffer } from "@/lib/use-iap-price";
import { canOfferExternalPurchase, openExternalPurchase } from "@/lib/external-purchase";
import PromoCodeBox, { usePromoCode } from "@/components/PromoCodeBox";
import {
  BillingToggle, FreePlanCard, ProPlanCard, ProWebPrice, OfficePlanCard, OfficeWebPrice, OfficeSeatPicker, officeTotalLabel,
  PLAN_GRID_CLASS, FREE_CTA_CLASS, PRO_CTA_CLASS, OFFICE_CTA_CLASS, PRO_FINE_PRINT_CLASS, OFFICE_FINE_PRINT_CLASS,
} from "@/components/PlanTierCards";

// The in-product plan chooser used during account creation — the card wizard's
// plan step and the /welcome step, on the web AND in the iPhone app. It draws
// the SAME cards as the public Pricing page (PlanTierCards), with the same
// Free / Pro / Office tabs on a phone (opening on Pro); on the web, the same
// Monthly / Annual switch. It stays presentational — it reports the choice
// via onFree / onPaid and the parent runs signup/checkout.

const OFFICE_MIN_SEATS = PLAN_LIMITS.OFFICE_MIN_SEATS;

export type PaidPlan = "pro" | "office";

type PlanCardsProps = {
  /** Native only: the Office button or the promo code's "Use it on
   *  swiftcard.me" really did open the default browser. The caller uses it to
   *  re-check the plan when the person comes back — they may have paid there. */
  onLeftForWebsite?: () => void;
  /** Phone width: which plan tab is open first. "office" for someone the
   *  app's Office card sent here (NATIVE_OFFICE_PATH) — they came for Office,
   *  so they should not land on Pro and have to find the tab. */
  initialTier?: PlanTier;
  /** False for someone who already had a Pro trial (or has a friend's free
   *  month on offer instead); the Pro card then shows the plain price
   *  instead of promising "14 days free". */
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
};

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
  onLeftForWebsite,
}: PlanCardsProps) {
  const [annual, setAnnual] = useState(false);
  const [seats, setSeats] = useState<number>(OFFICE_MIN_SEATS);
  const disabled = busy !== null;
  const native = useIsNativeApp();
  const [mobileTier, setMobileTier] = useState<PlanTier>(initialTier);

  // NATIVE (App Store 3.1.1 / 3.1.2): the same cards and tabs as the website,
  // with the selling done Apple's way — see NativePlanChooser. No web price,
  // no checkout hand-off (onPaid) ever reaches it.
  if (native) {
    return (
      <NativePlanChooser
        onFree={onFree}
        busy={busy}
        freeLabel={freeLabel}
        trialEligible={trialEligible}
        initialTier={initialTier}
        onIapPurchased={onIapPurchased}
        onCreateAccountForPro={onCreateAccountForPro}
        onLeftForWebsite={onLeftForWebsite}
      />
    );
  }

  return (
    <div>
      {/* Monthly / annual toggle — the Pricing page's own. Hidden (space kept)
          on a phone with the Free tab open, where it changes nothing. */}
      <div className="flex justify-center mb-8">
        <BillingToggle annual={annual} onToggle={() => setAnnual(!annual)} hideOnPhone={mobileTier === "free"} />
      </div>

      <MobilePlanTabs active={mobileTier} onChangeAction={setMobileTier} />

      <div className={PLAN_GRID_CLASS}>
        <FreePlanCard
          offTab={mobileTier !== "free"}
          cta={
            <button type="button" onClick={onFree} disabled={disabled} className={FREE_CTA_CLASS}>
              {busy === "free" ? "Setting up…" : freeLabel}
            </button>
          }
        />

        <ProPlanCard offTab={mobileTier !== "pro"} price={<ProWebPrice annual={annual} trial={trialEligible} />}>
          {/* "Try Pro free for 14 days →", never a bare "Start free →".
              This button sits inches from the Free plan's button, and when
              both read as some flavour of "free" the only genuinely free one
              is indistinguishable from the one that takes a card. That is not
              hypothetical: a guest chose Free, was shown this chooser again
              on /welcome because the stored choice had been consumed, tapped
              this button, and was put on a 14-day Pro trial they had
              explicitly declined a minute earlier (owner report 2026-09-15).
              The word "free" here is bound to Pro and to a time limit. */}
          <button type="button" onClick={() => onPaid("pro", annual, 1)} disabled={disabled} className={PRO_CTA_CLASS}>
            {busy === "pro" ? "Loading…" : trialEligible ? `Try Pro free for ${TRIAL_DAYS} days →` : "Get Pro →"}
          </button>
          {/* Eligibility + billing terms stay here; the price block above
              carries the offer itself. "for new customers" is load-bearing —
              checkout only grants a trial to customers with no prior Stripe
              subscription (pinned by copy-truth.test.ts). */}
          <p className={PRO_FINE_PRINT_CLASS}>
            {trialEligible ? `${TRIAL_DAYS} days free for new customers · card required · renews automatically` : "Renews automatically · cancel anytime"}
          </p>
        </ProPlanCard>

        <OfficePlanCard
          offTab={mobileTier !== "office"}
          price={<OfficeWebPrice annual={annual} seats={seats} />}
          seatPicker={<OfficeSeatPicker seats={seats} onSeats={setSeats} />}
        >
          <button type="button" onClick={() => onPaid("office", annual, seats)} disabled={disabled} className={OFFICE_CTA_CLASS}>
            {busy === "office" ? "Loading…" : `Get Office · ${officeTotalLabel(annual, seats)} →`}
          </button>
        </OfficePlanCard>
      </div>
    </div>
  );
}

/**
 * The iPhone app's plan step: the website's layout, tab for tab — Free / Pro /
 * Office tabs opening on Pro, the same three cards. Owner, 2026-09-30: the app
 * stacked Pro, Free and Office in one long column (scroll to find Free or
 * Office) and drew its own Pro card.
 *
 * No Monthly / Annual switch (owner, 2026-09-30, later): tapping Pro opens
 * Apple's sheet, which offers both periods anyway, so the card shows the
 * monthly price — as the website does until someone flips its switch.
 *
 * What differs is only what App Review requires:
 *   • Pro's prices are StoreKit's (useIapOffer) — never PLAN_PRICES — so the
 *     app can never show a number that differs from the App Store's (3.1.2).
 *   • Office (NativeOffice) is per-seat and Stripe-billed with no IAP product,
 *     so the app can neither sell it nor quote it: no price, no seat picker,
 *     one button that leaves the app for the default browser. A shell that
 *     cannot leave the app has no Office card and so no Office tab.
 *   • A promo code (NativePromoCode) is checked here and used on swiftcard.me,
 *     through the same link-out as Office — never redeemed in the app.
 */
function NativePlanChooser({
  onFree,
  busy,
  freeLabel,
  trialEligible,
  initialTier,
  onIapPurchased,
  onCreateAccountForPro,
  onLeftForWebsite,
}: {
  onFree: () => void;
  busy: "free" | PaidPlan | null;
  freeLabel: string;
  trialEligible: boolean;
  initialTier: PlanTier;
  onIapPurchased?: () => void;
  onCreateAccountForPro?: () => void;
  onLeftForWebsite?: () => void;
}) {
  const [mobileTier, setMobileTier] = useState<PlanTier>(initialTier);
  const canLinkOut = useCanLinkOut();
  // No Office card → no Office tab, and never a tab left open on nothing.
  const tier: PlanTier = !canLinkOut && mobileTier === "office" ? "pro" : mobileTier;
  // The promo code is held HERE, not in its box, because the Pro card above
  // the box has to act on it. Owner, 2026-10-02: the box said a two-months-
  // free code applied, the Pro button then opened Apple's plain subscription,
  // and the code was simply gone.
  const code = useNativePromo(onLeftForWebsite);

  return (
    <div>
      <MobilePlanTabs active={tier} onChangeAction={setMobileTier} tiers={canLinkOut ? undefined : ["free", "pro"]} />

      <div className={canLinkOut ? PLAN_GRID_CLASS : "grid grid-cols-1 md:grid-cols-2 gap-5 items-stretch md:pt-6 max-w-3xl mx-auto"}>
        <FreePlanCard
          offTab={tier !== "free"}
          cta={
            <button type="button" onClick={onFree} disabled={busy !== null} className={FREE_CTA_CLASS}>
              {busy === "free" ? "Setting up…" : freeLabel}
            </button>
          }
        />
        <NativePro
          offTab={tier !== "pro"}
          trialEligible={trialEligible}
          onPurchased={onIapPurchased}
          onNeedsAccount={onCreateAccountForPro}
          code={code}
        />
        <NativeOffice offTab={tier !== "office"} disabled={busy !== null} onLeft={onLeftForWebsite} />
      </div>

      {/* Under the plans, where the website's plan step has its box. */}
      {canLinkOut && <NativePromoCode className="max-w-md mx-auto mt-6 text-center" code={code} />}
    </div>
  );
}

/**
 * The app's Pro card on its own — for /upgrade, where the person is already on
 * Free and Pro is the one thing to buy. The same card as the plan step, so the
 * app has one Pro design.
 */
export function NativeProUpgrade({ trialEligible }: { trialEligible: boolean }) {
  return (
    // md:pt-6 absorbs the card's raised-Pro offset (md:-mt-6), as the plan
    // grids do — on an iPad it otherwise rides up into the heading.
    <div className="max-w-md mx-auto md:pt-6">
      <NativePro trialEligible={trialEligible} />
    </div>
  );
}

/**
 * The native Pro card: the website's Pro card, priced by StoreKit — the same
 * "Free for your first 14 days, then $4.99 / month" block and "Try Pro free
 * for 14 days →" button when Apple confirms the trial, the plain price and
 * "Get Pro →" when it won't (as the website shows an account that already had
 * its trial). While StoreKit is still answering the price block keeps its
 * space (so nothing jumps); when products are unavailable it is simply absent
 * — the card never guesses a number.
 *
 * The CTA is always there. Signed in it opens the In-App Purchase sheet on the
 * monthly plan the card shows (annual is one tap away in the sheet); signed
 * out it starts account creation, and /welcome then offers the purchase. It
 * used to render nothing at all when signed out, leaving a Pro card with a
 * feature list and no way to buy — which is the shape of the 3.1.1 rejection.
 */
function NativePro({
  trialEligible,
  onPurchased,
  onNeedsAccount,
  offTab,
  code,
}: {
  /** The caller's account-level answer (false: already had a free Pro period,
   *  or a friend's free month is on offer instead — WelcomePlan's offerTrial).
   *  Ignoring it showed "Start my free month" and "Try Pro free for 14 days"
   *  side by side. */
  trialEligible?: boolean;
  onPurchased?: () => void;
  /** Guest (signed-out) shell: start account creation instead of a purchase —
   *  there is no account to attribute a subscription to yet. */
  onNeedsAccount?: () => void;
  offTab?: boolean;
  /** The plan step's promo code (NativePlanChooser). A Pro code turns this
   *  card into that offer: redeemed by Apple when Apple has the code, used on
   *  swiftcard.me when it doesn't. Never silently dropped. */
  code?: NativePromo;
}) {
  const offer = useIapOffer();
  const price = offer.monthly;
  // Only promise the trial once StoreKit has confirmed one for this Apple ID
  // AND the account may have it. `trial` is null while StoreKit is still
  // answering, and the button used to read "Try Pro free for 14 days" in
  // exactly that state — then Apple's sheet said Subscribe.
  const offersTrial = offer.trial === true && trialEligible !== false;

  // ── A promo code for Pro ──────────────────────────────────────────────────
  const promo = code?.forPro ?? null;
  // "Two months free" → "two months", for "Free for your first two months".
  const freeFor = promo && /\sfree$/i.test(promo.label) ? promo.label.replace(/\s+free$/i, "").toLowerCase() : null;
  const viaApple = !!promo?.apple;
  // Apple's own price for the plan the code is on (annual-only codes are
  // made on the annual product, lib/apple-offer-codes).
  const promoPrice = promo?.annualOnly ? offer.annual : price;
  const promoPeriod = promo?.annualOnly ? "year" : "month";

  const priceBlock =
    viaApple && freeFor && offer.status !== "loading" ? (
      promoPrice ? <ProTrialPrice price={promoPrice} period={promoPeriod} freeFor={freeFor} /> : null
    ) : offer.status === "loading" ? (
      // Sized BY the real block (an invisible copy, no number in it), so the
      // card does not move when StoreKit answers. Hand-sized bars came out
      // 8px short. visibility:hidden keeps it out of the accessibility tree.
      <div aria-hidden="true" className="relative">
        <div className="invisible"><ProTrialPrice price="—" period="month" /></div>
        <div className="absolute inset-0 flex flex-col justify-between py-0.5">
          <div className="h-[2.4rem] w-28 rounded-xl bg-white/20 animate-pulse" />
          <div className="h-4 w-48 rounded-md bg-white/15 animate-pulse" />
        </div>
      </div>
    ) : !price ? null : offersTrial ? (
      <ProTrialPrice price={price} period="month" />
    ) : (
      <div className="flex items-end gap-1"><span className="text-[2.6rem] font-bold text-white leading-none">{price}</span><span className="text-white/80 text-sm mb-1">/ month</span></div>
    );

  if (promo && viaApple) {
    return (
      <ProPlanCard offTab={offTab} price={priceBlock}>
        <AppleOfferCodeButton
          code={promo.code}
          className={PRO_CTA_CLASS}
          label={freeFor ? `Try Pro free for ${freeFor} →` : `Use ${promo.code} with Apple →`}
          onPurchased={onPurchased}
        />
        <p className={PRO_FINE_PRINT_CLASS}>
          Code {promo.code} · Apple shows your offer before you confirm · renews automatically · cancel anytime in your Apple account
        </p>
      </ProPlanCard>
    );
  }

  if (promo && code) {
    // Apple doesn't have this code (money off, or not set up on Apple yet):
    // it is used on swiftcard.me — said on the button itself, so pressing Pro
    // can never quietly sell the plan without it.
    return (
      <ProPlanCard offTab={offTab} price={priceBlock}>
        <button type="button" onClick={() => code.website.open(promo.code)} disabled={code.website.busy} className={PRO_CTA_CLASS}>
          {code.website.busy ? "Opening swiftcard.me…" : `Use ${promo.code} on swiftcard.me →`}
        </button>
        <p className={PRO_FINE_PRINT_CLASS} role={code.website.failed ? "alert" : undefined}>
          {code.website.failed
            ? "Couldn't open your browser. Go to swiftcard.me, sign in with this account and enter the code there."
            : `${promo.label} with ${promo.code}. Opens swiftcard.me in your browser with the code filled in — sign in there with this account.`}
        </p>
      </ProPlanCard>
    );
  }

  return (
    <ProPlanCard offTab={offTab} price={priceBlock}>
      <IapSubscribeButton
        appearance="card"
        className={PRO_CTA_CLASS}
        period="monthly"
        label={offersTrial ? `Try Pro free for ${TRIAL_DAYS} days →` : "Get Pro →"}
        onPurchased={onPurchased}
        onNeedsAccount={onNeedsAccount}
      />
      <p className={PRO_FINE_PRINT_CLASS}>
        {offersTrial
          ? `${TRIAL_DAYS} days free for new subscribers · renews automatically · cancel anytime in your Apple account`
          : "Renews automatically · cancel anytime in your Apple account"}
      </p>
    </ProPlanCard>
  );
}

/**
 * "Have a promo code?" in the app (owner, 2026-09-30). Pro is bought through
 * Apple in here, and Apple takes no Stripe code — nor may the app switch a
 * paid plan on with a code of its own (3.1.1). So the code is CHECKED here,
 * with the website's own box and rules, and then:
 *
 *   • a Pro code Apple has (the same string made as an Apple offer code, lib/
 *     apple-offer-codes) is redeemed BY APPLE from the Pro card — "Try Pro free
 *     for two months →" opens Apple's code page already filled in, and Apple
 *     bills the offer (owner, 2026-10-02: "it has to work, even if it's billed
 *     through Apple");
 *   • any other code is USED on swiftcard.me: the Pro card's button (or "Use
 *     it on swiftcard.me" for an Office code) opens /welcome in the default
 *     browser with the code already in its box, where it applies to Stripe
 *     checkout (or switches a free-time code on) exactly as on the website.
 *
 * Same link-out, and the same fail-closed rule, as the Office card: only
 * rendered when the shell can open the default browser.
 */
function NativePromoCode({ code, className }: { code: NativePromo; className?: string }) {
  return (
    <PromoCodeBox
      className={className}
      promo={code.promo}
      website={{ ...code.website, proCardAbove: !!code.forPro }}
    />
  );
}

/** The plan step's promo code, shared by its box and the Pro card. */
function useNativePromo(onLeft?: () => void) {
  const promo = usePromoCode({ plan: null, interval: null });
  const [leaving, setLeaving] = useState(false);
  const [failed, setFailed] = useState(false);

  async function openOnWebsite(code: string) {
    setFailed(false);
    setLeaving(true);
    const opened = await openExternalPurchase(`/welcome?promo=${encodeURIComponent(code)}`);
    setLeaving(false);
    if (opened) onLeft?.();
    else setFailed(true);
  }

  const s = promo.state;
  return {
    promo,
    /** The applied code, when it is for Pro — the Pro card takes it over. */
    forPro: s.status === "applied" && s.forPro ? s : null,
    website: { open: (c: string) => { void openOnWebsite(c); }, busy: leaving, failed },
  };
}
type NativePromo = ReturnType<typeof useNativePromo>;

/**
 * Redeem a promo code through Apple, from the Pro card. Apple's code page
 * opens with the code filled in and shows the offer ("2 months free, then
 * $4.99/month") before anything is bought. Coming back to the app pulls the
 * new subscription in and carries on exactly as a purchase from the sheet does
 * (onPurchased); "Continue" does the same by hand for anyone who returns
 * without the app noticing (StoreKit's in-app sheet never leaves the app).
 */
function AppleOfferCodeButton({ code, label, className, onPurchased }: { code: string; label: string; className: string; onPurchased?: () => void }) {
  const [state, setState] = useState<"idle" | "opening" | "waiting" | "checking" | "notyet" | "failed">("idle");
  const waiting = useRef(false);
  const done = useRef(onPurchased);
  useEffect(() => { done.current = onPurchased; }, [onPurchased]);

  const finish = useCallback(async () => {
    setState("checking");
    if (await syncIapAfterRedeem()) {
      waiting.current = false;
      if (done.current) done.current();
      else window.location.reload();
      return;
    }
    // Checked and nothing there yet — say so, rather than a silent no-op.
    setState("notyet");
  }, []);

  useEffect(() => {
    const onReturn = () => { if (waiting.current && document.visibilityState === "visible") void finish(); };
    document.addEventListener("visibilitychange", onReturn);
    return () => document.removeEventListener("visibilitychange", onReturn);
  }, [finish]);

  async function redeem() {
    setState("opening");
    if (!(await redeemAppleOfferCode(code))) { setState("failed"); return; }
    waiting.current = true;
    setState("waiting");
  }

  return (
    <>
      <button type="button" onClick={() => { void redeem(); }} disabled={state === "opening" || state === "checking"} className={className}>
        {state === "opening" ? "Opening Apple…" : state === "checking" ? "Checking your subscription…" : label}
      </button>
      {(state === "waiting" || state === "notyet") && (
        <p className="mt-2 text-center text-xs text-white/85" role={state === "notyet" ? "status" : undefined}>
          {state === "notyet" ? "Pro isn't on yet — finish redeeming on Apple's page, then " : "Redeemed it with Apple? "}
          <button type="button" onClick={() => { void finish(); }} className="font-semibold underline">Continue</button>
        </p>
      )}
      {state === "failed" && (
        <p role="alert" className="mt-2 text-center text-xs text-white/85">Couldn&apos;t open Apple&apos;s code page. Please try again.</p>
      )}
    </>
  );
}

/** Where the app's Office button lands, in the default browser: the same plan
 *  step on the website, opened on its Office tab so the seat picker and
 *  checkout are one tap away (welcome/page.tsx keeps `tier` through sign-in). */
export const NATIVE_OFFICE_PATH = "/welcome?tier=office";

/**
 * The native Office card: the website's Office card — same title, badge and
 * feature list — with no price, no seat picker and no checkout, because none
 * of those may exist inside the app (see NativePlanChooser).
 *
 * One button, and it LEAVES the app: Office is set up and billed on
 * swiftcard.me, in the default browser. Same mechanism and same fail-closed
 * rule as the Team tab's "Add a seat on swiftcard.me": when the shell cannot
 * open the default browser the card is not rendered at all, since a plan card
 * nobody can act on is the shape App Review rejected.
 */
function NativeOffice({ disabled, onLeft, offTab }: { disabled: boolean; onLeft?: () => void; offTab?: boolean }) {
  const canLinkOut = useCanLinkOut();
  const [failed, setFailed] = useState(false);
  if (!canLinkOut) return null;

  async function open() {
    setFailed(false);
    if (await openExternalPurchase(NATIVE_OFFICE_PATH)) onLeft?.();
    else setFailed(true);
  }

  return (
    <OfficePlanCard
      offTab={offTab}
      price={
        <>
          <p className="text-blue-600 text-xs font-semibold">Minimum {OFFICE_MIN_SEATS} users</p>
          <p className="text-slate-500 text-sm mb-7 mt-2">{PLAN_DESCRIPTIONS.office}</p>
        </>
      }
    >
      <button type="button" onClick={() => { void open(); }} disabled={disabled} className={OFFICE_CTA_CLASS}>
        Get Office on swiftcard.me →
      </button>
      <p className={OFFICE_FINE_PRINT_CLASS}>
        {failed
          ? "Couldn't open your browser. Go to swiftcard.me and sign in to set up Office."
          : "Opens swiftcard.me in your browser. Sign in with this account to set up your team — your card is saved either way."}
      </p>
    </OfficePlanCard>
  );
}

/** Whether this shell can open the default browser (Office's only way in).
 *  Read once, during the first render. That is safe only because every
 *  caller sits behind PlanCards' `if (native)` — false on the server and on
 *  the hydration render — so these components are never server-rendered
 *  and there is no server HTML to disagree with. Reading it in an effect
 *  instead drew one frame with no Office card and no Office tab. */
function useCanLinkOut(): boolean {
  const [canLinkOut] = useState(canOfferExternalPurchase);
  return canLinkOut;
}
