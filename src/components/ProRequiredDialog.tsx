"use client";

import { useEffect } from "react";
import { TRIAL_DAYS } from "@/lib/plan";
import { ProOfferBlock, ProOfferCta } from "@/components/ProOffer";
import { useIsAndroidApp } from "@/lib/platform";

/**
 * Save Changes, blocked because the card is using Pro design.
 *
 * The old behaviour was silent: a Free account could pick Brushed, drop in a
 * background video, press Save Changes, get a success message — and then find
 * a flat card on the live link, because the server sanitized the Pro keys away
 * on the way in. Nothing lied exactly, but the person was never told, and the
 * one moment they most wanted the feature was spent teaching them the product
 * does not do what they just watched it do.
 *
 * So the preview stays open — every Pro finish and the photo/video picker are
 * still tappable on Free, the card still renders them in the editor, that is
 * the demo — and the wall moves to Save. This is what stands at the wall.
 *
 * THE TRIAL IS THE OFFER (owner, 2026-09-11)
 * A 14-day free trial first, and the monthly price second. The offer box and
 * the button both come from components/ProOffer, which is also what the Add
 * card sheet renders — so the wording, the price and the destination are one
 * implementation and cannot drift between the two sheets or between platforms.
 *
 * `trialEligible` is resolved on the SERVER by the page that renders the
 * editor, using lib/trial-eligibility — the identical helper the checkout API
 * enforces with. Someone who has ever had a subscription is not offered a
 * second trial here, and their button carries `trial=0` so the checkout page's
 * copy matches. The promise on the button and the session it creates cannot
 * drift, which is the whole reason that helper is shared rather than re-guessed.
 *
 * THE SAME SHEET ON BOTH PLATFORMS
 * This dialog used to render one thing on the web and something else entirely
 * in the shell — a different component, different words, a different shape —
 * which is exactly what the owner reported. It does not any more: the badge,
 * the headline, the sentence, the list, the offer box and the button are one
 * set of markup. Only two things differ, and both are forced (see
 * components/ProOffer): the price comes from StoreKit on iOS because Apple
 * charges it in the viewer's own currency and must match what is shown
 * (3.1.2), and the button goes to in-app purchase rather than a website
 * (3.1.3(b)). Neither is visible as a difference in layout or wording.
 */
export default function ProRequiredDialog({
  features,
  onSaveWithoutPro,
  onCancel,
  busy = false,
  trialEligible = false,
}: {
  /** Names from proFeaturesInUse(). Never empty. */
  features: string[];
  /** Save anyway, letting the Free conversion apply. */
  onSaveWithoutPro: () => void;
  /** Go back to editing with everything still selected. */
  onCancel: () => void;
  busy?: boolean;
  /** First-time subscriber → offer the free trial. Resolved server-side. */
  trialEligible?: boolean;
}) {
  // No trial and no "keep them with Pro" in the Android app — it sells nothing
  // (owner, 2026-10-08). The dialog still names the features and saves without them.
  const android = useIsAndroidApp();
  const offerTrial = trialEligible && !android;

  // Esc closes, and the page behind must not scroll under the sheet on a phone.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onCancel();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onCancel, busy]);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pro-required-title"
    >
      <button
        type="button"
        aria-label="Close"
        className="absolute inset-0 bg-slate-950/70 backdrop-blur-[2px]"
        onClick={busy ? undefined : onCancel}
      />

      {/* A bottom sheet on a phone and a centred card from `sm` up. The phone
          case is the one that matters: `items-end` + `max-h` + the safe-area
          padding keep it off the home indicator, and the sheet scrolls inside
          itself rather than pushing the buttons off the screen on a short
          phone with four Pro features listed. */}
      <div
        className="sc-dark-sheet relative w-full sm:max-w-[26rem] sm:mx-4 max-h-[88vh] flex flex-col rounded-t-3xl sm:rounded-3xl shadow-2xl"
        style={{
          background: "linear-gradient(180deg, #101728 0%, #0B1120 46%)",
          border: "1px solid rgba(148,163,184,0.16)",
          paddingBottom: "max(1.25rem, env(safe-area-inset-bottom))",
        }}
      >
        {/* Grab handle — phones only. It is what makes a sheet read as a sheet. */}
        <div className="sm:hidden flex justify-center pt-2.5 pb-1">
          <span className="w-9 h-1 rounded-full bg-white/20" />
        </div>

        {/* The reading half scrolls; the actions below do not. On a 320px
            phone with four Pro features listed the sheet is taller than the
            screen, and if the buttons scroll with the text the upgrade CTA —
            the entire point of this dialog — starts below the fold. */}
        <div className="px-5 pt-4 sm:pt-6 overflow-y-auto">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-500/15 border border-blue-400/25 px-2.5 py-1 text-[0.6875rem] font-bold tracking-wide text-blue-300">
            <svg viewBox="0 0 24 24" className="w-3 h-3" fill="currentColor" aria-hidden="true">
              <path d="M12 2l2.9 6.3 6.9.8-5.1 4.7 1.4 6.8L12 17.3 5.9 20.6l1.4-6.8L2.2 9.1l6.9-.8L12 2z" />
            </svg>
            PRO DESIGN
          </span>

          <h2 id="pro-required-title" className="text-white font-bold text-[1.3125rem] leading-tight mt-3">
            {features.length === 1 ? "That finish is part of Pro" : "Those touches are part of Pro"}
          </h2>
          {/* ONE sentence, both platforms. The shell used to get a different
              one, which is half of why the two popups did not match. */}
          <p className="text-slate-300/90 text-[0.875rem] leading-snug mt-1.5">
            {offerTrial
              ? `The features you selected are part of Pro. Try it free for ${TRIAL_DAYS} days and keep them on your live card:`
              : android
                ? "The features you selected are only available on Pro:"
                : "The features you selected are only available on Pro. Keep them on your live card with Pro:"}
          </p>

          <ul className="mt-3.5 space-y-1.5">
            {features.map((f) => (
              <li key={f} className="flex items-start gap-2.5">
                <span className="mt-[3px] shrink-0 w-4 h-4 rounded-full bg-blue-500/20 flex items-center justify-center">
                  <svg viewBox="0 0 24 24" className="w-2.5 h-2.5 text-blue-300" fill="none" stroke="currentColor" strokeWidth={3.2} aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                </span>
                <span className="text-[0.875rem] text-slate-100 leading-snug">{f}</span>
              </li>
            ))}
          </ul>

          {/* The offer. One component, so the sheet on a phone is the sheet
              on a laptop — see components/ProOffer. */}
          <div className="mt-5">
            <ProOfferBlock
              trialEligible={offerTrial}
              blurb="Every finish, any color, photo and video backgrounds, unlimited links, and no SwiftCard branding on your Swift Links page."
            />
          </div>
        </div>

        <div className="px-5 pt-4 mt-auto shrink-0 flex flex-col gap-2 border-t border-white/[0.07]">
          <ProOfferCta trialEligible={offerTrial} />

          {/* The way out is plainly labelled and says what actually happens. */}
          <button
            type="button"
            onClick={onSaveWithoutPro}
            disabled={busy}
            className="w-full py-3 rounded-full text-[0.875rem] font-semibold text-slate-200 bg-white/[0.06] border border-white/10 hover:bg-white/[0.1] transition-colors disabled:opacity-60"
          >
            {busy ? "Saving…" : "Save without them"}
          </button>

          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="w-full py-2 text-[0.8125rem] font-medium text-slate-400 hover:text-slate-200 transition-colors disabled:opacity-60"
          >
            Keep editing
          </button>
        </div>
      </div>
    </div>
  );
}
