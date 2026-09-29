"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  canOfferIap,
  ensureIapConfigured,
  getIapPackages,
  prefetchIapPackages,
  purchaseIap,
  restoreIap,
  type IapPackage,
} from "@/lib/iap";
import { TRIAL_DAYS } from "@/lib/plan";
import { useIapOffer } from "@/lib/use-iap-price";
import { detectNativeApp } from "@/lib/platform";

// Short, countable unlocks for the sheet — no prices, no numbers that could
// drift from StoreKit.
const PERKS = [
  "Unlimited cards, leads & contacts",
  "AI follow-up drafts and business-card scanning",
  "Custom designer, colors and fonts",
  "Detailed analytics — who viewed, where, when",
  "No SwiftCard branding on your messages",
];

/**
 * The In-App Purchase paywall, iOS shell only.
 *
 * This replaced ExternalPurchaseButton as PlanNotice's purchase path after the
 * 1.0.0 (7) rejection: App Review requires the Pro subscription to be
 * purchasable via IAP (3.1.1 / 3.1.3(b)); the US link-out defense was made and
 * did not survive contact with a reviewer.
 *
 * Review-compliance invariants, each one a past or telegraphed rejection:
 *   • Prices come ONLY from StoreKit (pkg.priceString). Nothing here may
 *     hardcode a dollar amount — App Store price and shown price must be the
 *     same number by construction (3.1.2 metadata truthfulness).
 *   • Restore Purchases is always present alongside the buy buttons (3.1.2).
 *   • Terms of Use + Privacy Policy links are always present (3.1.2 / EULA
 *     requirement for auto-renewable subscriptions).
 *   • The auto-renewal disclosure sentence is always visible, not tucked
 *     behind a disclosure toggle.
 *   • No mention of the website, web pricing, or "cheaper elsewhere" — the
 *     external-purchase link is deliberately absent from this build to keep
 *     one clean purchase story in review.
 *
 * Visibility rule — REWRITTEN after the 2026-08-31 rejection (submission
 * d6815dee, reviewed on an iPad Air).
 *
 * The old rule was "fail closed": if StoreKit returned no products, the
 * subscribe button rendered NOTHING. The subscriptions had not been attached
 * to that version's submission, so in the reviewer's sandbox StoreKit had no
 * products — and the app they saw was one that locks Pro features behind a
 * gate with no way to buy anything. That is the literal text of 3.1.1, and
 * our own silence produced it.
 *
 * The rule now: inside the shell, a signed-in user ALWAYS sees the purchase
 * path. What fails closed is the SHEET's content, not its existence — it
 * shows StoreKit's prices when they load and an explicit "not available
 * right now" when they don't. No price is ever invented (3.1.2 is about the
 * numbers being true, not about hiding the button), and a reviewer who taps
 * always gets an answer instead of a dead end.
 */
// Resolved once per page: after the first button has done the work, every
// later mount (another gate, a route change) renders instantly instead of
// re-running the session read + SDK configure.
//
//   "ready"         → native, signed in: show the real purchase button.
//   "needs-account" → native, signed out: there is nothing to attribute a
//                     purchase to yet. Callers that can start account creation
//                     pass onNeedsAccount and still render a CTA; the guest
//                     card wizard used to render the Pro card with NO button
//                     at all, which is a price and a feature list and no way
//                     to buy — the 3.1.1 dead end, on the very first run.
//   "unavailable"   → not the shell. Web sells through Stripe elsewhere.
export type IapStatus = "ready" | "needs-account" | "unavailable";

let statusOnce: Promise<IapStatus> | null = null;

async function resolveStatus(): Promise<IapStatus> {
  // Not the shell (or no bridge at all) → no purchase UI here.
  if (!detectNativeApp()) return "unavailable";
  // The RevenueCat identity must be the Supabase uid BEFORE any purchase — it
  // is how the webhook maps the sub to a profile. Read from the LOCAL session
  // (no network): getUser() cost a server round trip on every mount, which is
  // why the button used to pop in late.
  //
  // Loaded here, not at the top of the file: this module is reached from
  // PlanGate, which every editor and the homepage's mini builders render, so
  // a static import shipped the whole Supabase client (~65KB compressed) to
  // every marketing visitor. Only the iPhone shell ever gets past the
  // detectNativeApp() check above, so only it pays for the download.
  const { createBrowserClient } = await import("@supabase/ssr");
  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
  const { data: { session } } = await supabase.auth.getSession();
  const uid = session?.user?.id;
  if (!uid) return "needs-account";

  // Best effort, and DELIBERATELY not part of the visibility decision. The
  // rule this component documents is "only "not native" and "not signed in"
  // hide the button", but the code used to bail on canOfferIap() too — so a
  // missing NEXT_PUBLIC_RC_APPLE_API_KEY, or one failed chunk fetch for the
  // RevenueCat module, silently removed every purchase path in the app and
  // left the gates behind. That is indistinguishable from the app App Review
  // rejected. What fails closed is the SHEET's content, never its existence:
  // it shows StoreKit's prices when they load and says so plainly when they
  // do not.
  if (await canOfferIap()) {
    if (await ensureIapConfigured(uid)) prefetchIapPackages(); // prices ready before the tap
  }
  return "ready";
}

/** Shared mount logic: resolves once, re-checks after a signed-out result. */
function useIapStatus(): IapStatus {
  const [status, setStatus] = useState<IapStatus>("unavailable");
  useEffect(() => {
    let cancelled = false;
    if (!statusOnce) statusOnce = resolveStatus();
    statusOnce.then((s) => {
      // Signed out is transient — a sign-in later in the same document must
      // light the buttons up without a reload.
      if (s === "needs-account") statusOnce = null;
      if (!cancelled) setStatus(s);
    });
    return () => { cancelled = true; };
  }, []);
  return status;
}

export default function IapSubscribeButton({
  className = "",
  label = "Upgrade to Pro",
  sublabel,
  onPurchased,
  onNeedsAccount,
}: {
  className?: string;
  label?: string;
  /** Small second line under the label; pass "" to hide. Omitted, it names
   *  the free trial only when StoreKit confirms this Apple ID gets one — it
   *  used to say "14-day free trial" to everyone, including accounts the sheet
   *  then charged from day one. */
  sublabel?: string;
  /** Called after a successful purchase (entitlement synced). Default: reload
   *  so every plan-gated surface re-reads the profile. */
  onPurchased?: () => void;
  /** Signed-out surfaces that CAN start account creation (the guest card
   *  wizard) pass this: the same button renders and begins signup, after
   *  which /welcome offers the real purchase. Without it a signed-out surface
   *  renders nothing, which is right for gates that have nowhere to send
   *  anyone. */
  onNeedsAccount?: () => void;
}) {
  const status = useIapStatus();
  const [open, setOpen] = useState(false);
  const { trial } = useIapOffer();
  const line = sublabel ?? (trial === true ? `${TRIAL_DAYS}-day free trial` : "");

  const needsAccount = status === "needs-account";
  if (status === "unavailable" || (needsAccount && !onNeedsAccount)) return null;

  return (
    <>
      {/* Compact aurora pill: gradient, spark, a slow glisten sweep and a soft
          blue glow. Inline by default (sits under the gate copy without
          stretching across the card); callers that want a full-width block
          pass `!w-full` and their own colors. */}
      <button
        type="button"
        onClick={() => (needsAccount ? onNeedsAccount!() : setOpen(true))}
        className={`sc-dark-sheet relative inline-flex flex-col items-center justify-center overflow-hidden rounded-full px-5 py-1.5 text-[0.8125rem] font-bold leading-tight text-white transition-[transform,box-shadow] duration-150 active:scale-[0.97] ${className}`}
        style={{ background: "var(--rd-aurora)", boxShadow: "0 8px 22px -10px rgba(37,99,235,0.85), inset 0 1px 0 rgba(255,255,255,0.28)" }}
      >
        <span className="relative z-[4]">{label}</span>
        {line && <span className="relative z-[4] text-[0.625rem] font-semibold text-white/85">{line}</span>}
        <span className="rd-glisten-sweep" aria-hidden="true" />
      </button>
      {open && !needsAccount && <PaywallSheet onClose={() => setOpen(false)} onPurchased={onPurchased} />}
    </>
  );
}

/**
 * Inline "PRO" pill that opens the paywall — for the row-level gates (an
 * integration row, the Zapier header) where a full notice has no room. Falls
 * back to a plain static badge whenever a purchase can't be offered, so it is
 * never a dead tap target.
 */
export function IapProPill({ tier = "pro" }: { tier?: "pro" | "office" }) {
  const available = useIapStatus() === "ready";
  const [open, setOpen] = useState(false);
  const label = tier === "office" ? "OFFICE" : "PRO";
  if (!available || tier === "office") {
    return (
      <span className="shrink-0 rounded-full bg-[#3B82F6] px-1.5 py-0.5 text-[0.5625rem] font-bold uppercase leading-none tracking-wide text-white">
        {label}
      </span>
    );
  }
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="sc-dark-sheet inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[0.625rem] font-bold uppercase leading-none tracking-wide text-white transition-transform active:scale-95"
        style={{ background: "var(--rd-aurora)" }}
      >
        <Spark className="h-2.5 w-2.5" />
        Get Pro
      </button>
      {open && <PaywallSheet onClose={() => setOpen(false)} />}
    </>
  );
}

/**
 * The QUIET Pro marker for a locked row.
 *
 * Owner, 2026-09-11, looking at five stacked "GET PRO" buttons on the CRM
 * screen: "it's like they're trying to spam the Get Pro button in my face."
 * He was right — a list of five identical shouting buttons is not an offer,
 * it is nagging, and it made the whole screen feel hostile to the people we
 * most want to convert.
 *
 * So a locked row now wears this: a small padlock and the word Pro, in the
 * page's own muted ink. It still OPENS the paywall when tapped — nothing is
 * hidden and nothing is harder to reach — but the selling is done once, by
 * the single card above the list, instead of five times down it.
 */
export function IapProLock({ label = "Pro" }: { label?: string }) {
  const available = useIapStatus() === "ready";
  const [open, setOpen] = useState(false);
  const chip = (
    <span className="inline-flex items-center gap-1 rounded-full border border-[#D4C8B8] bg-[#F0EBE1] px-2 py-1 text-[0.6875rem] font-semibold text-slate-500">
      <Lock className="h-2.5 w-2.5" />
      {label}
    </span>
  );
  if (!available) return <span className="shrink-0">{chip}</span>;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Get Pro to connect this integration"
        className="shrink-0 transition-opacity active:opacity-70"
      >
        {chip}
      </button>
      {open && <PaywallSheet onClose={() => setOpen(false)} />}
    </>
  );
}

export function Lock({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className={className} aria-hidden="true">
      <path d="M10 1.5A3.75 3.75 0 006.25 5.25V8H6a1.5 1.5 0 00-1.5 1.5v7A1.5 1.5 0 006 18h8a1.5 1.5 0 001.5-1.5v-7A1.5 1.5 0 0014 8h-.25V5.25A3.75 3.75 0 0010 1.5zm2.25 6.5h-4.5V5.25a2.25 2.25 0 014.5 0V8z" />
    </svg>
  );
}

export function Spark({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className={className} aria-hidden="true">
      <path d="M10 2l1.8 5.2L17 9l-5.2 1.8L10 16l-1.8-5.2L3 9l5.2-1.8L10 2z" />
    </svg>
  );
}

function PaywallSheet({ onClose, onPurchased }: { onClose: () => void; onPurchased?: () => void }) {
  const [packages, setPackages] = useState<IapPackage[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState<"purchase" | "restore" | null>(null);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const pkgs = await getIapPackages();
      if (cancelled) return;
      setPackages(pkgs);
      // Annual pre-selected: better deal for the user, better retention for us.
      setSelected(pkgs.find((p) => p.period === "annual")?.identifier ?? pkgs[0]?.identifier ?? null);
    })();
    return () => { cancelled = true; };
  }, []);

  async function buy() {
    if (!selected || busy) return;
    setBusy("purchase");
    setNotice("");
    const result = await purchaseIap(selected);
    setBusy(null);
    if (result === "purchased") {
      // Entitlement is already synced server-side (purchaseIap awaits
      // /api/iap/sync). Callers mid-flow (card wizard, /welcome) continue in
      // place; everywhere else a reload re-reads the profile for every gate.
      if (onPurchased) onPurchased();
      else window.location.reload();
      return;
    }
    if (result === "failed") setNotice("The purchase didn't go through. You have not been charged beyond any existing subscription.");
  }

  async function restore() {
    if (busy) return;
    setBusy("restore");
    setNotice("");
    const restored = await restoreIap();
    setBusy(null);
    if (restored) {
      window.location.reload();
      return;
    }
    setNotice("No previous purchase was found for this Apple account.");
  }

  const hasProducts = (packages?.length ?? 0) > 0;
  const hasTrial = !!packages?.some((p) => p.introPriceString === "free trial");

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="iap-paywall-title"
      className="fixed inset-0 z-[120] flex items-end justify-center px-3 pt-[max(0.75rem,calc(env(safe-area-inset-top)+0.5rem))] pb-[max(0.75rem,calc(env(safe-area-inset-bottom)+0.5rem))] sm:items-center sm:pb-3"
      style={{ background: "rgba(0,0,0,0.65)" }}
    >
      {/* sc-dark-sheet: this panel is dark ON PURPOSE. Without it the light
          theme flips .bg-gray-900 to white and .text-gray-300 to near-black,
          which is what the owner photographed on 2026-09-11: a see-through
          sheet with the settings page showing through it. */}
      <div className="sc-dark-sheet w-full max-w-sm max-h-[calc(100dvh-env(safe-area-inset-top)-env(safe-area-inset-bottom)-2rem)] overflow-y-auto rounded-3xl border border-gray-800 bg-gray-900 shadow-2xl">
        {/* Aurora header — the same gradient the Pro card wears everywhere else. */}
        <div className="sc-dark-sheet relative px-6 pt-6 pb-5" style={{ background: "var(--rd-aurora)" }}>
          <div className="absolute inset-0 opacity-25" style={{ background: "radial-gradient(120% 90% at 20% -10%, rgba(255,255,255,0.6), transparent 55%)" }} />
          <div className="relative z-[2]">
            <span className="inline-block rounded-full bg-white/25 px-2.5 py-0.5 text-[0.625rem] font-bold uppercase tracking-wide text-white">SwiftCard</span>
            <p id="iap-paywall-title" className="mt-2 text-2xl font-extrabold tracking-tight text-white">
              Go Pro
            </p>
            <p className="mt-1 text-[0.8125rem] text-white/85">
              Everything, unlimited — cards, contacts, AI drafts, the scanner and the custom designer.
            </p>
          </div>
        </div>

        <div className="p-5">
          <ul className="space-y-1.5">
            {PERKS.map((perk) => (
              <li key={perk} className="flex items-start gap-2 text-[0.8125rem] text-gray-300">
                <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-blue-600/25">
                  <svg viewBox="0 0 20 20" className="h-2.5 w-2.5" fill="none" stroke="#93c5fd" strokeWidth={2.6}>
                    <path d="M4 10.5l4 4 8-9" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
                {perk}
              </li>
            ))}
          </ul>

          {packages === null && (
            <p className="mt-5 text-center text-[0.8125rem] text-gray-500">Loading plans…</p>
          )}

          {packages !== null && !hasProducts && (
            <p className="mt-5 text-center text-[0.8125rem] text-gray-500">
              Plans aren&apos;t available right now. Please try again later.
            </p>
          )}

          {hasProducts && (
            <>
              <div className="mt-5 flex flex-col gap-2">
                {packages!.map((pkg) => {
                  const on = selected === pkg.identifier;
                  return (
                    <button
                      key={pkg.identifier}
                      type="button"
                      onClick={() => setSelected(pkg.identifier)}
                      aria-pressed={on}
                      className={`flex items-center gap-3 rounded-2xl border px-4 py-3 text-left transition-colors ${
                        on ? "border-blue-500 bg-blue-600/15" : "border-gray-800 bg-gray-900 hover:border-gray-700"
                      }`}
                    >
                      <span className={`flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-full border-2 ${on ? "border-blue-500" : "border-gray-600"}`} style={{ width: 18, height: 18 }}>
                        {on && <span className="h-2 w-2 rounded-full bg-blue-500" />}
                      </span>
                      <span className="flex-1">
                        <span className="flex items-center gap-2 text-sm font-semibold text-white">
                          {pkg.period === "annual" ? "Annual" : "Monthly"}
                          {pkg.period === "annual" && (
                            <span className="rounded-full bg-blue-600/30 px-2 py-0.5 text-[0.625rem] font-bold uppercase tracking-wide text-blue-200">Best value</span>
                          )}
                        </span>
                        {hasTrial && <span className="block text-[0.6875rem] text-gray-500">Free for your first {TRIAL_DAYS} days</span>}
                      </span>
                      {/* Price straight from StoreKit — never typed here. */}
                      <span className="text-right text-sm font-semibold text-white">
                        {pkg.priceString}
                        <span className="block text-[0.6875rem] font-normal text-gray-500">per {pkg.period === "annual" ? "year" : "month"}</span>
                      </span>
                    </button>
                  );
                })}
              </div>

              <button
                type="button"
                onClick={buy}
                disabled={busy !== null || !selected}
                className="mt-4 w-full rounded-full bg-blue-600 py-3.5 text-sm font-bold text-white transition-[background-color,transform] duration-150 hover:bg-blue-500 active:scale-[0.98] disabled:opacity-60"
              >
                {busy === "purchase" ? "Purchasing…" : hasTrial ? "Start free trial" : "Subscribe"}
              </button>
            </>
          )}

          <div className="mt-2 flex items-center justify-center gap-4">
            <button
              type="button"
              onClick={restore}
              disabled={busy !== null}
              className="py-2 text-[0.8125rem] font-semibold text-gray-400 transition-colors hover:text-white disabled:opacity-60"
            >
              {busy === "restore" ? "Restoring…" : "Restore Purchases"}
            </button>
            <span className="text-gray-700">·</span>
            <button
              type="button"
              onClick={onClose}
              disabled={busy !== null}
              className="py-2 text-[0.8125rem] text-gray-500 transition-colors hover:text-gray-300 disabled:opacity-60"
            >
              Not now
            </button>
          </div>

          {notice && <p className="mt-2 text-center text-xs text-red-400">{notice}</p>}

          {/* Auto-renewal disclosure + legal links: required for auto-renewable
              subscriptions, and kept visible rather than collapsed. */}
          <p className="mt-3 text-center text-[0.6875rem] leading-relaxed text-gray-500">
            Subscriptions renew automatically unless canceled at least 24 hours
            before the end of the current period. Manage or cancel anytime in your
            App Store account settings.
          </p>
          <p className="mt-1.5 text-center text-[0.6875rem] text-gray-500">
            <Link href="/terms" className="underline">Terms of Use</Link>
            <span className="mx-1.5">·</span>
            <Link href="/privacy" className="underline">Privacy Policy</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
