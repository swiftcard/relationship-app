"use client";

import { TRIAL_DAYS } from "@/lib/plan";
import { useIsAndroidApp, useIsNativeApp } from "@/lib/platform";
import IapSubscribeButton from "@/components/NativePaywall";
import { useIapOffer } from "@/lib/use-iap-price";

/**
 * The moment someone picks Free after building with Pro design.
 *
 * It used to work like this: they chose Free, their card was rewritten, and
 * THEN a grey sentence appeared saying "Custom colors and premium design
 * options are available on Pro" with a single Continue button. The decision
 * was already made, the card was already changed, the sentence described the
 * plan rather than their card, and there was no way back.
 *
 * That is the highest-intent moment in the entire product and it was being
 * spent on a disclaimer. Someone who has just spent ten minutes on a card
 * feels it is theirs — so the honest and the persuasive thing are the same
 * thing here: tell them exactly what is about to change, before it changes,
 * and offer the one option that keeps it.
 *
 * Three rules this component follows:
 *
 *  1. It only appears when the card ACTUALLY changes. `changes` comes from the
 *     converter, so tapping a Free Look never triggers this.
 *  2. Free is a real exit, not a dark pattern. The secondary button is plainly
 *     labelled, says what is kept, and is one tap.
 *  3. NATIVE (the iOS shell) offers the SAME choice through Apple: the trial
 *     button is the In-App Purchase sheet (IapSubscribeButton — StoreKit price,
 *     Restore, renewal terms), never Stripe, and its fine print names Apple.
 *     (It used to hide the offer entirely, from before in-app purchase existed;
 *     owner, 2026-09-16: "the same exact way that it does on the web app".)
 *  4. ANDROID offers no purchase at all — the Android app sells nothing (owner,
 *     2026-10-08). The panel still says exactly what changes, and Free is the
 *     one way on; there is no trial button and no renewal fine print.
 */
export default function FreeDesignChoice({
  changes,
  onKeepWithTrial,
  onContinueFree,
  onIapPurchased,
  busy = false,
  trialEligible = true,
}: {
  /** Web: no trial left for this account; offer Pro without "days free". */
  trialEligible?: boolean;
  /** NATIVE: after Pro was bought through Apple (entitlement already synced). */
  onIapPurchased?: () => void;
  /** Plain-English lines from describeFreeDesignChanges(). Never empty. */
  changes: string[];
  /** Start the Pro trial so the card is kept exactly as built. */
  onKeepWithTrial: () => void;
  /** Proceed on Free, applying the conversion. */
  onContinueFree: () => void;
  busy?: boolean;
}) {
  const native = useIsNativeApp();
  const android = useIsAndroidApp();
  const { trial } = useIapOffer();
  // Apple's answer AND the account's: null (StoreKit still answering) used to
  // promise the free trial — the same rule as the Pro plan card.
  const offersTrial = trial === true && trialEligible;

  return (
    <div className="max-w-md mx-auto">
      <div className="rounded-2xl border border-blue-800/40 bg-blue-950/30 px-5 py-5">
        <p className="text-white font-bold text-base">Your card uses Pro design</p>
        <p className="text-blue-200/80 text-[0.8125rem] mt-1 leading-snug">
          Everything you typed is saved either way. On Free, the look changes:
        </p>

        <ul className="mt-3.5 space-y-2">
          {changes.map((line) => (
            // text-blue-100 (not /90): the light-theme layer in globals.css
            // remaps a fixed list of blue text shades, and an opacity variant
            // it doesn't list stays near-invisible on a light background.
            <li key={line} className="flex items-start gap-2.5 text-[0.8125rem] text-blue-100 leading-snug">
              {/* An arrow, not a cross: these are changes, not errors, and a red
                  cross beside four lines would read as four things going wrong. */}
              <span aria-hidden className="text-blue-400/70 mt-[1px] shrink-0">→</span>
              <span>{line}</span>
            </li>
          ))}
        </ul>
      </div>

      {!native && (
        <>
          <button
            onClick={onKeepWithTrial}
            disabled={busy}
            className="mt-4 w-full py-3.5 rounded-full text-sm font-bold bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white transition-colors"
          >
            {busy ? "Saving…" : trialEligible ? `Keep my card exactly like this (${TRIAL_DAYS} days free) →` : "Keep my card exactly like this with Pro →"}
          </button>
          {/* The same disclosure the plan cards carry. A trial that takes a card
              and renews has to say so at every point it is offered, not only on
              the pricing page. */}
          {/* gray-400, not the gray-500/600 the rest of the app uses for small
              print: measured against this backdrop those are 3.97:1 and 2.54:1,
              under the 4.5:1 floor. This is the line that says a card is taken
              and the subscription renews — the one piece of text here that has
              to be legible whether or not anyone wants to read it. 7.56:1. */}
          <p className="text-gray-400 text-[0.625rem] text-center mt-2 leading-snug">
            {trialEligible ? `${TRIAL_DAYS} days free for new customers · card required · renews automatically · cancel anytime` : "Renews automatically · cancel anytime"}
          </p>
        </>
      )}

      {native && !android && onIapPurchased && (
        <>
          <IapSubscribeButton
            className="!mt-4 !w-full !py-3.5 !text-sm !font-bold"
            label={offersTrial ? `Keep my card exactly like this (${TRIAL_DAYS} days free)` : "Keep my card exactly like this with Pro"}
            sublabel={offersTrial ? "then billed by Apple" : "Billed by Apple"}
            onPurchased={onIapPurchased}
          />
          <p className="text-gray-400 text-[0.625rem] text-center mt-2 leading-snug">
            {offersTrial ? `${TRIAL_DAYS} days free for new subscribers · renews automatically · cancel anytime in your Apple account` : "Renews automatically · cancel anytime in your Apple account"}
          </p>
        </>
      )}

      {/* Says what Free MEANS for this card (owner, 2026-09-18): the design
          goes back to free features, and they redesign it from the editor.
          It is one of exactly two ways off this panel — there is no Back
          (neither caller renders one): keep the card as built, or this.
          Long enough to wrap on a phone, so it is padded and line-spaced for
          two lines rather than squeezed onto one. */}
      <button
        onClick={onContinueFree}
        disabled={busy}
        className={`w-full py-3 px-5 rounded-full text-sm leading-snug font-semibold border border-gray-700 text-gray-300 hover:text-white hover:border-gray-500 disabled:opacity-50 transition-colors ${native && (android || !onIapPurchased) ? "mt-4" : "mt-3"}`}
      >
        {busy ? "Saving…" : "Continue with Free and redesign using free features only"}
      </button>
      {/* The reassurance under the exit. Whatever makes Free feel safe has to
          be as readable as what makes Pro attractive, or the choice is only
          balanced on paper. */}
      <p className="text-gray-400 text-[0.625rem] text-center mt-2 leading-snug">
        You keep your card, your link, your QR code and everything you typed.
      </p>
    </div>
  );
}
