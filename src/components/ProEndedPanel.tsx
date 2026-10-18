"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useIsAndroidApp, useIsNativeApp } from "@/lib/platform";
import IapSubscribeButton from "@/components/NativePaywall";

/**
 * Pro just ended — a trial that wasn't kept, a cancelled subscription, an Apple
 * subscription that expired, or a free month that ran out. The account is on
 * Free already; this is where the person decides what that means for them.
 *
 * Owner's rule (2026-09-16): say it plainly, offer to keep Pro, and if they
 * continue on Free let them CHOOSE which card stays live, name what changes
 * about the design, and never delete anything. Until they choose, the defaults
 * already hold on every public page: the oldest card stays live, Pro design is
 * hidden but kept.
 *
 * A card on the dashboard, not a modal — the product keeps working underneath.
 * It stays until they choose, because the choice is theirs and only they can
 * make it. NATIVE (App Store 3.1.1): no price and no website; keeping Pro is
 * the StoreKit button.
 */
export default function ProEndedPanel({
  wasTrial,
  cards,
  defaultLiveCardId,
  designChanges,
}: {
  wasTrial: boolean;
  /** Every card on the account, oldest first. */
  cards: { id: string; label: string }[];
  /** The card live right now (the chosen one, else the oldest). */
  defaultLiveCardId: string | null;
  /** From describeFreeDesignChanges + proLinkFeaturesInUse, across all cards. */
  designChanges: string[];
}) {
  const native = useIsNativeApp();
  // ANDROID sells nothing (owner, 2026-10-08): no "Keep Pro" there, and no
  // sentence offering it. What ended and what is kept is still said plainly.
  const android = useIsAndroidApp();
  const router = useRouter();
  const [choosingFree, setChoosingFree] = useState(false);
  const [liveCardId, setLiveCardId] = useState<string | null>(defaultLiveCardId ?? cards[0]?.id ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const multipleCards = cards.length > 1;

  async function continueOnFree() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/account/choose-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ liveCardId }),
      });
      if (!res.ok) throw new Error(String(res.status));
      router.refresh();
    } catch {
      setError("That didn't save. Please try again.");
      setBusy(false);
    }
  }

  return (
    <section
      aria-labelledby="pro-ended-title"
      className="rounded-2xl border border-blue-800/40 bg-blue-950/30 px-5 py-5 mb-5"
    >
      <p id="pro-ended-title" className="text-white font-bold text-base">
        {wasTrial ? "Your Pro trial has ended" : "Your Pro plan has ended"}
      </p>
      <p className="text-blue-200/80 text-[0.8125rem] mt-1 leading-snug">
        {android
          ? multipleCards
            ? "Your account is on Free now, which includes one live card. Nothing has been deleted."
            : "Your account is on Free now. Nothing has been deleted."
          : multipleCards
          ? "Keep Pro to keep every card live and your design exactly as it is, or continue on Free with one card. Nothing has been deleted."
          : "Keep Pro to keep your design exactly as it is, or continue on Free. Nothing has been deleted."}
      </p>

      {!choosingFree && (
        <div className="mt-4 flex flex-col sm:flex-row gap-2.5">
          {android ? null : native ? (
            <IapSubscribeButton label="Keep Pro" sublabel="" className="sm:w-auto" />
          ) : (
            <Link
              href="/upgrade"
              className="text-center py-3 px-6 rounded-full text-sm font-bold bg-blue-600 hover:bg-blue-500 text-white transition-colors"
            >
              Keep Pro →
            </Link>
          )}
          <button
            type="button"
            onClick={() => setChoosingFree(true)}
            className="py-3 px-6 rounded-full text-sm font-semibold bg-gray-800/60 border border-transparent text-gray-200 hover:bg-gray-700 transition-colors"
          >
            Continue on Free
          </button>
        </div>
      )}

      {choosingFree && (
        <div className="mt-4">
          {multipleCards && (
            <fieldset>
              <legend className="text-white text-sm font-semibold">Which card stays live?</legend>
              <p className="text-gray-400 text-xs mt-0.5">
                {android ? "Free includes one live card. The others stay saved." : "Free includes one live card. The others stay saved and come back if you upgrade."}
              </p>
              <div className="mt-2.5 space-y-2">
                {cards.map((c) => (
                  <label
                    key={c.id}
                    className={`flex items-center gap-3 rounded-xl border px-4 py-3 cursor-pointer transition-colors ${
                      liveCardId === c.id ? "border-blue-600 bg-blue-600/10" : "border-gray-700 bg-gray-900"
                    }`}
                  >
                    <input
                      type="radio"
                      name="live-card"
                      value={c.id}
                      checked={liveCardId === c.id}
                      onChange={() => setLiveCardId(c.id)}
                      className="accent-blue-600"
                    />
                    <span className="text-sm text-white truncate">{c.label}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}

          {designChanges.length > 0 && (
            <div className={multipleCards ? "mt-4" : ""}>
              <p className="text-white text-sm font-semibold">On Free, the look changes:</p>
              <ul className="mt-2 space-y-1.5">
                {designChanges.map((line) => (
                  <li key={line} className="flex items-start gap-2.5 text-[0.8125rem] text-blue-100 leading-snug">
                    <span aria-hidden className="text-blue-400/70 mt-[1px] shrink-0">→</span>
                    <span>{line}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {error && <p role="alert" className="text-amber-400 text-xs mt-3">{error}</p>}

          <div className="mt-4 flex flex-col sm:flex-row gap-2.5">
            <button
              type="button"
              onClick={continueOnFree}
              disabled={busy}
              className="py-3 px-6 rounded-full text-sm font-bold bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white transition-colors"
            >
              {busy ? "Saving…" : "Confirm — continue on Free"}
            </button>
            <button
              type="button"
              onClick={() => setChoosingFree(false)}
              disabled={busy}
              className="py-3 px-6 rounded-full text-sm font-semibold text-gray-400 hover:text-gray-300 transition-colors"
            >
              Back
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
