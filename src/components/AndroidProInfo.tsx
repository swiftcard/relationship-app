import Link from "next/link";
import { PLAN_FEATURES } from "@/lib/plan-content";

/**
 * /upgrade inside the ANDROID app — what Pro is, with nothing to buy.
 *
 * The Android app sells nothing (owner, 2026-10-08). There is no StoreKit on
 * Android, no Play Billing product, and a link to a web checkout is what Google
 * Play calls steering. But plenty still points here — a locked feature, the
 * card cap, the bell's "See who and where", "Keep Pro" on a trial — and each
 * of those used to land on the iPhone's In-App Purchase card: "Get Pro →",
 * Apple's renewal terms, a sheet that said "Plans aren't available right now".
 *
 * So Android gets this instead: the same honest description of Pro the plan
 * cards carry, said plainly that it isn't sold in this app, and a way back.
 * No price, no button that buys, no website. An account that already has Pro
 * from anywhere never reaches this page (page.tsx sends it to billing).
 */
export default function AndroidProInfo({ from }: { from?: string }) {
  const heading =
    from === "card-limit" || from === "claim"
      ? "Free covers one card"
      : from === "notification"
        ? "Names and places are part of Pro"
        : "This is part of Pro";
  const lede =
    from === "claim"
      ? "Your card is saved — nothing was lost. Your account is on Free, which includes one card."
      : from === "card-limit"
        ? "You already have a card on this account, and Free includes one. Nothing you have built is affected."
        : "Your account is on the Free plan. Here is what Pro adds.";
  const features = PLAN_FEATURES.pro.filter((f) => !/:$/.test(f));

  return (
    <div className="mx-auto max-w-md">
      <div className="text-center mb-6">
        <span className="inline-block rounded-full bg-[#1D4ED8] px-3 py-1 text-[0.6875rem] font-bold uppercase tracking-wide text-white">SwiftCard Pro</span>
        <h1 className="mt-4 text-2xl font-bold text-white">{heading}</h1>
        <p className="mt-2 text-sm text-gray-400 leading-relaxed">{lede}</p>
      </div>
      <div className="rounded-2xl border border-gray-800 bg-gray-900 px-5 py-5">
        <p className="text-sm font-semibold text-white">Pro includes</p>
        <ul className="mt-3 space-y-2.5">
          {features.map((f) => (
            <li key={f} className="flex items-start gap-2.5 text-[0.84375rem] leading-snug text-gray-300">
              <svg viewBox="0 0 24 24" className="mt-[3px] h-3.5 w-3.5 shrink-0 text-blue-400" fill="none" stroke="currentColor" strokeWidth={3} aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              <span>{f}</span>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-[0.75rem] leading-relaxed text-gray-500">Pro isn&apos;t sold in the Android app. Everything on Free keeps working here.</p>
      </div>
      <Link
        href="/dashboard"
        className="mt-5 block w-full rounded-full bg-blue-600 py-3.5 text-center text-sm font-semibold text-white transition-colors hover:bg-blue-500"
      >
        Back to my dashboard
      </Link>
    </div>
  );
}
