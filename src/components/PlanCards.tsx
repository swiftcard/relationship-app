"use client";

import { useEffect, useState } from "react";
import { useIsNativeApp } from "@/lib/platform";
import MobilePlanTabs, { type PlanTier } from "@/components/MobilePlanTabs";
import { PLAN_LIMITS, TRIAL_DAYS } from "@/lib/plan";
import { PLAN_DESCRIPTIONS } from "@/lib/plan-content";
import ProTrialPrice from "@/components/ProTrialPrice";
import IapSubscribeButton from "@/components/NativePaywall";
import { useIapOffer, type IapOffer } from "@/lib/use-iap-price";
import { canOfferExternalPurchase, openExternalPurchase } from "@/lib/external-purchase";
import {
  BillingToggle, FreePlanCard, ProPlanCard, ProWebPrice, OfficePlanCard, OfficeWebPrice, OfficeSeatPicker, officeTotalLabel,
  PLAN_GRID_CLASS, FREE_CTA_CLASS, PRO_CTA_CLASS, OFFICE_CTA_CLASS, PRO_FINE_PRINT_CLASS, OFFICE_FINE_PRINT_CLASS,
} from "@/components/PlanTierCards";

// The in-product plan chooser used during account creation — the card wizard's
// plan step and the /welcome step, on the web AND in the iPhone app. It draws
// the SAME cards as the public Pricing page (PlanTierCards), with the same
// Free / Pro / Office tabs on a phone (opening on Pro) and the same Monthly /
// Annual switch. It stays presentational — it reports the choice via onFree /
// onPaid and the parent runs signup/checkout.

const OFFICE_MIN_SEATS = PLAN_LIMITS.OFFICE_MIN_SEATS;

export type PaidPlan = "pro" | "office";

type PlanCardsProps = {
  /** Native only: the Office button really did open the default browser. The
   *  caller uses it to re-check the plan when the person comes back. */
  onLeftForOffice?: () => void;
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
  onLeftForOffice,
}: PlanCardsProps) {
  const [annual, setAnnual] = useState(false);
  const [seats, setSeats] = useState<number>(OFFICE_MIN_SEATS);
  const disabled = busy !== null;
  const native = useIsNativeApp();
  const [mobileTier, setMobileTier] = useState<PlanTier>(initialTier);

  // NATIVE (App Store 3.1.1 / 3.1.2): the same cards, tabs and switch as the
  // website, with the selling done Apple's way — see NativePlanChooser. No
  // web price, no checkout hand-off (onPaid) ever reaches it.
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
        onLeftForOffice={onLeftForOffice}
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
 * The iPhone app's plan step: the website's layout, tab for tab — Monthly /
 * Annual switch, Free / Pro / Office tabs opening on Pro, the same three
 * cards. Owner, 2026-09-30: the app stacked Pro, Free and Office in one long
 * column (scroll to find Free or Office), had no Monthly / Annual choice, and
 * drew its own Pro card.
 *
 * What differs is only what App Review requires:
 *   • Pro's prices are StoreKit's (useIapOffer) — never PLAN_PRICES — so the
 *     app can never show a number that differs from the App Store's (3.1.2).
 *     The SAVE badge and the annual per-month line are worked out from
 *     StoreKit's own numbers, and absent until they are known.
 *   • Office (NativeOffice) is per-seat and Stripe-billed with no IAP product,
 *     so the app can neither sell it nor quote it: no price, no seat picker,
 *     one button that leaves the app for the default browser. A shell that
 *     cannot leave the app has no Office card and so no Office tab.
 */
function NativePlanChooser({
  onFree,
  busy,
  freeLabel,
  trialEligible,
  initialTier,
  onIapPurchased,
  onCreateAccountForPro,
  onLeftForOffice,
}: {
  onFree: () => void;
  busy: "free" | PaidPlan | null;
  freeLabel: string;
  trialEligible: boolean;
  initialTier: PlanTier;
  onIapPurchased?: () => void;
  onCreateAccountForPro?: () => void;
  onLeftForOffice?: () => void;
}) {
  const [annual, setAnnual] = useState(false);
  const [mobileTier, setMobileTier] = useState<PlanTier>(initialTier);
  const offer = useIapOffer();
  const canLinkOut = useCanLinkOut();
  // No Office card → no Office tab, and never a tab left open on nothing.
  const tier: PlanTier = !canLinkOut && mobileTier === "office" ? "pro" : mobileTier;

  return (
    <div>
      <div className="flex justify-center mb-8">
        <BillingToggle
          annual={annual}
          onToggle={() => setAnnual(!annual)}
          hideOnPhone={tier === "free"}
          saveBadge={offer.annualSavePct ? `SAVE ${offer.annualSavePct}%` : null}
        />
      </div>

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
          annual={annual}
          offer={offer}
          trialEligible={trialEligible}
          onPurchased={onIapPurchased}
          onNeedsAccount={onCreateAccountForPro}
        />
        <NativeOffice offTab={tier !== "office"} disabled={busy !== null} onLeft={onLeftForOffice} />
      </div>
    </div>
  );
}

/**
 * The app's Pro card on its own, with the Monthly / Annual switch — for
 * /upgrade, where the person is already on Free and Pro is the one thing to
 * buy. The same card as the plan step, so the app has one Pro design.
 */
export function NativeProUpgrade({ trialEligible, onPurchased }: { trialEligible: boolean; onPurchased?: () => void }) {
  const [annual, setAnnual] = useState(false);
  const offer = useIapOffer();
  return (
    <div>
      <div className="flex justify-center mb-8">
        <BillingToggle annual={annual} onToggle={() => setAnnual(!annual)} saveBadge={offer.annualSavePct ? `SAVE ${offer.annualSavePct}%` : null} />
      </div>
      <div className="max-w-md mx-auto">
        <NativePro annual={annual} offer={offer} trialEligible={trialEligible} onPurchased={onPurchased} />
      </div>
    </div>
  );
}

/**
 * The native Pro card: the website's Pro card, priced by StoreKit for the
 * period the switch shows. While StoreKit is still answering the price block
 * keeps its space (so nothing jumps); when products are unavailable it is
 * simply absent — the card never guesses a number.
 *
 * The CTA is always there. Signed in it opens the In-App Purchase sheet on
 * the period the card shows; signed out it starts account creation, and
 * /welcome then offers the purchase. It used to render nothing at all when
 * signed out, leaving a Pro card with a feature list and no way to buy —
 * which is the shape of the 3.1.1 rejection.
 */
function NativePro({
  annual,
  offer,
  trialEligible,
  onPurchased,
  onNeedsAccount,
  offTab,
}: {
  annual: boolean;
  offer: IapOffer;
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
}) {
  const price = annual ? offer.annual : offer.monthly;
  const period = annual ? "year" : "month";
  // Only promise the trial once StoreKit has confirmed one for this Apple ID
  // AND the account may have it. `trial` is null while StoreKit is still
  // answering, and the button used to read "Try Pro free for 14 days" in
  // exactly that state — then Apple's sheet said Subscribe.
  const offersTrial = offer.trial === true && trialEligible !== false;
  const note = annual && offer.annualPerMonth
    ? `~${offer.annualPerMonth}/mo${offer.annualSavePct ? ` · Save ${offer.annualSavePct}%` : ""}`
    : undefined;

  const priceBlock =
    offer.status === "loading" ? (
      <div aria-hidden="true">
        <div className="h-[2.6rem] w-28 rounded-xl bg-white/20 animate-pulse" />
        <div className="mt-2.5 h-4 w-48 rounded-md bg-white/15 animate-pulse" />
      </div>
    ) : !price ? null : offersTrial ? (
      <ProTrialPrice price={price} period={period} note={note} />
    ) : (
      <div>
        <div className="flex items-end gap-1"><span className="text-[2.6rem] font-bold text-white leading-none">{price}</span><span className="text-white/80 text-sm mb-1">/ {period}</span></div>
        {note && <p className="text-white/60 text-xs mt-1">{note}</p>}
      </div>
    );

  return (
    <ProPlanCard offTab={offTab} price={priceBlock}>
      <IapSubscribeButton
        appearance="card"
        period={annual ? "annual" : "monthly"}
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
 *  Read after mount: the plugin is window-only, so deciding during render
 *  would disagree with the server HTML. */
function useCanLinkOut(): boolean {
  const [canLinkOut, setCanLinkOut] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- window-only value, hydration-safe by design
    setCanLinkOut(canOfferExternalPurchase());
  }, []);
  return canLinkOut;
}
