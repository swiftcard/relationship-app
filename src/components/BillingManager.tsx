"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { PLAN_PRICES, PLAN_LIMITS } from "@/lib/plan";
import { formatUsd, seatSubtotalCents } from "@/lib/currency";
import ManageBillingButton from "@/components/ManageBillingButton";
import { useIsNativeApp } from "@/lib/platform";
import IapSubscribeButton from "@/components/NativePaywall";
import { manageIapSubscription } from "@/lib/iap";
import { trialStatusLine } from "@/lib/billing-state";
import { dayLabel, trialExtensionOffer } from "@/lib/retention";
import { canOfferExternalPurchase, openExternalPurchase } from "@/lib/external-purchase";

// ── In-app subscription manager (Settings > Billing) ─────────────────────────
// Native UI over our own /api/stripe/subscription/* endpoints — NOT the Stripe
// hosted portal — so we fully control the copy and the flows the owner asked
// for: separate Change Plan / Cancel / Keep actions, a reason prompt + 50%
// retention offer on cancel, and Office seat management. The Stripe portal is
// still offered for payment-method + invoice history, where its copy is fine.

type Sub = {
  plan: "free" | "pro" | "office";
  planSource?: "apple" | "stripe" | null;
  interval: "monthly" | "annual" | null;
  status: string | null;
  seats: number | null;
  activeMembers: number | null;
  pendingInvites: number | null;
  ownerSeats: number;
  scheduledSeats: number | null;
  scheduledSeatsAt: string | null;
  minSeats: number;
  currentPeriodEnd: string | null;
  /** Card-backed trial converting to paid on this date (null unless trialing). */
  trialEnd?: string | null;
  /** Free-Pro grant (referral / retention days, no subscription) ending on this date. */
  grantEndsAt?: string | null;
  cancelAtPeriodEnd: boolean;
  renewalCents: number | null;
  retentionUsed: boolean;
  /** The 50%-off coupon can go on this subscription: active, monthly, and no
      discount already on it (lib/retention-discount — the route refuses the rest). */
  discountOfferable?: boolean;
  /** A card trial that can run on free to a full month from its start
      (lib/trial-extension) — the cancel flow offers it before cancelling. */
  trialExtension?: { until: string; currentEnd: string; extraDays: number; chargeCents: number | null; chargeInterval: "month" | "year" } | null;
  paymentFailed: boolean;
  hasStripeSubscription: boolean;
  hasCustomer: boolean;
  /** Office sub-user viewing their OWN leftover subscription — render the
      trimmed personal view, never the plan manager (see the GET route). */
  personalSubOnly?: boolean;
  /** A delegated billing admin looking at the ORGANISATION's subscription
      (api/stripe/subscription) — the owner's seat is not "you" for them. */
  managingOrgBilling?: boolean;
};

const CANCEL_REASONS = [
  "Too expensive",
  "Not using it enough",
  "Missing a feature I need",
  "Found a better alternative",
  "Just testing it out",
  "Other",
];

// A price cut only changes a price-driven decision. Offering 50% off to someone
// leaving over a missing feature or "just testing" burns margin on people it
// won't keep, so the discount is reserved for genuinely price-sensitive reasons.
// (The Office→Pro save below is offered to every Office canceller — it's a real
// downgrade to a cheaper plan, not a giveaway.)
const PRICE_SENSITIVE_REASONS = ["Too expensive", "Found a better alternative"];

function fmtDate(iso: string | null): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
  } catch {
    return "";
  }
}

const planLabel = (p: Sub["plan"]) => (p === "office" ? "Office" : p === "pro" ? "Pro" : "Free");

// What a paid account actually loses when it drops to Free. These are the real,
// code-enforced consequences (card-active kill-switch, sanitizeCustomizationForPlan
// at render, the Free monthly meters) — NOT scare copy. Nothing is deleted, but
// access to everything past the Free tier stops the moment the plan lapses, which
// is exactly what the visitor is deciding to give up. Listing it plainly is both
// honest and the strongest reason to stay.
function downgradeLosses(plan: Sub["plan"]): string[] {
  const losses: string[] = [];
  if (plan === "office") {
    // What the lapse cascade actually does (webhook customer.subscription
    // .deleted): members are released, not switched off. This said every
    // teammate's card goes offline, which was not true.
    losses.push("All seats are released. Each teammate moves to their own plan — Free, or their own Pro if they pay for it — keeping their first card live without your company branding.");
    losses.push("You lose the Admin console: team analytics, the team's leads and inbox, and company branding.");
  }
  losses.push(
    plan === "office"
      ? "Only your own first card stays live; your unified team branding is removed."
      : "Only your first card stays live — every other card's links, QR codes, NFC taps, Apple Wallet passes and lead capture stop working.",
  );
  losses.push(`Your live card reverts to the Free design and keeps just ${PLAN_LIMITS.FREE_MAX_LINKS} additional links — Pro styling and your extra action buttons disappear from it.`);
  losses.push(`New contacts are capped at ${PLAN_LIMITS.FREE_LEADS_PER_MONTH}/month again — anything past that is locked until you upgrade.`);
  losses.push("AI card scanning and AI-written follow-ups switch off.");
  return losses;
}

export default function BillingManager() {
  const [sub, setSub] = useState<Sub | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [showChange, setShowChange] = useState(false);
  const [showCancel, setShowCancel] = useState(false);
  // Whether this app build can leave for the website (the External Purchase
  // link-out the seat flow uses). Read after mount: the plugin is window-only.
  const [canLinkOut, setCanLinkOut] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- window-only value, hydration-safe by design
    setCanLinkOut(canOfferExternalPurchase());
  }, []);
  // Backstop (App Review 3.1.1): today the only render site is the Settings
  // billing section, which is already hideOnNative — but if this component is
  // ever mounted anywhere else, it must still never paint plan prices, seat
  // purchase, retention offers, or the Stripe portal inside the iOS shell.
  const native = useIsNativeApp();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/stripe/subscription");
      if (!res.ok) throw new Error();
      setSub(await res.json());
    } catch {
      setErr("Couldn't load your billing details. Refresh to try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch-on-mount. load() awaits /api/stripe/subscription before it setStates,
  // so nothing is set synchronously here; the rule fires on the call, not on
  // real cascading renders. Billing state comes from Stripe at runtime, so it
  // cannot be derived during render or passed in as a prop.
  // eslint-disable-next-line react-hooks/set-state-in-effect -- async fetch-on-mount
  useEffect(() => { load(); }, [load]);

  // Deep-link from receipt / payment emails (?billing=1) → scroll Billing into view.
  useEffect(() => {
    try {
      if (new URLSearchParams(window.location.search).get("billing") === "1") {
        document.getElementById("billing")?.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    } catch { /* noop */ }
  }, []);

  async function keepSubscription() {
    setBusy("keep"); setErr(null); setNotice(null);
    try {
      const res = await fetch("/api/stripe/subscription/keep", { method: "POST" });
      const data = await res.json();
      if (!res.ok) { setErr(data.error || "Something went wrong."); return; }
      setNotice(`Your subscription is active again${data.renewalAt ? ` and renews on ${fmtDate(data.renewalAt)}` : ""}.`);
      await load();
    } catch {
      setErr("Couldn't reach the server. Try again.");
    } finally {
      setBusy(null);
    }
  }

  // ── Native app: the compliant subscription panel (App Review 3.1.1) ───────
  // Third iteration. Hidden panel → rejected (paid content, no purchase path).
  // External link to swiftcard.me → rejected (App Review requires IAP under
  // 3.1.3(b) regardless of the US link-out allowance). Now:
  //   • Free            → the In-App Purchase paywall (NativePaywall).
  //   • Pro via Apple   → "Manage subscription" opening the App Store's own
  //                       subscription management — Apple-billed subs are
  //                       canceled there, never in the Stripe portal.
  //   • Pro/Office via  → a neutral sentence naming where the subscription
  //     Stripe             lives. Deliberately NO link out and no portal: one
  //                       purchase story in review, and steering to web
  //                       checkout from the app is itself a 3.1.1 risk.
  // Still no prices, renewal amounts, plan switcher, seats, or retention
  // offers on native — those stay web-only below.
  if (native) {
    if (loading) {
      return <div className="rounded-2xl border border-gray-800 bg-gray-900 p-5 text-sm text-gray-500">Loading your plan…</div>;
    }
    // Couldn't load: say so. Falling through with plan "free" showed the
    // Apple "Upgrade to Pro" purchase to accounts already paying for Office or
    // Pro — and an Apple Pro bought on an Office account buys nothing.
    if (!sub) {
      return <div className="rounded-2xl border border-gray-800 bg-gray-900 p-5 text-sm text-gray-400">{err ?? "Couldn't load your plan — pull down to refresh, or try again in a moment."}</div>;
    }
    // A team member's OWN subscription from before they joined. The panel below
    // would call their plan "Office" and say Apple bills it — true of neither:
    // the team pays for their plan, and what Apple (or a card) bills is their
    // personal Pro. Say that, and where to stop it.
    if (sub.personalSubOnly) {
      const viaApple = sub.planSource === "apple" && !sub.hasStripeSubscription;
      return (
        <div className="rounded-2xl border border-gray-800 bg-gray-900 p-5">
          <p className="text-sm font-semibold text-white">Your own Pro subscription</p>
          <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-gray-400">
            {viaApple
              ? "Your team plan already includes everything in Pro. The Pro subscription you had before joining is still billed through your Apple account — cancel it there and you lose nothing, or keep it for if you ever leave the team."
              : "Your team plan already includes everything in Pro. You also have your own Pro subscription from before you joined. It isn't billed through Apple, so it isn't managed in your Apple account settings."}
          </p>
          {viaApple && (
            <button
              type="button"
              onClick={() => manageIapSubscription()}
              className="mt-3 w-full rounded-full bg-gray-800 border border-gray-700 py-2.5 text-xs font-semibold text-white transition-colors hover:bg-gray-700"
            >
              Manage subscription
            </button>
          )}
        </div>
      );
    }
    const nPlan = sub.plan ?? "free";
    const nPaid = nPlan === "pro" || nPlan === "office";
    const appleBilled = sub?.planSource === "apple";
    // Is there actually a subscription being billed SOMEWHERE else? Not the
    // same question as "is this account paid". The Pro review account is a
    // manual grant — planSource null, hasStripeSubscription false, no Stripe
    // customer — and the panel still told App Review "your subscription is
    // billed by card, outside the App Store", which was both untrue for that
    // account and a near-verbatim recital of Guideline 3.1.1. Say only what
    // is true of the account in front of us.
    const externallyBilled = sub?.planSource === "stripe" || sub?.hasStripeSubscription === true;
    return (
      <div className="rounded-2xl border border-gray-800 bg-gray-900 p-5">
        <p className="text-sm font-semibold text-white">
          Your plan: {nPlan === "office" ? "Office" : nPlan === "pro" ? "Pro" : "Free"}
        </p>
        <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-gray-400">
          {appleBilled
            ? "Your subscription is billed through your Apple account."
            : externallyBilled
              // A real subscription billed elsewhere. 3.1.3(b) permits
              // honouring it precisely because Pro is also purchasable in the
              // app; the sentence just should not read as a confession. Same
              // facts, no framing: it is active, Apple is not the biller, so
              // the Apple subscription settings are not where to manage it.
              // No template literal: the native branch carries no dollar sign
              // (tests/ios-final-audit — a price can't slip in).
              ? (nPlan === "office"
                ? "Your Office subscription is active on this account. It isn't billed through Apple, so it isn't managed in your Apple account settings."
                : "Your Pro subscription is active on this account. It isn't billed through Apple, so it isn't managed in your Apple account settings.")
              : nPaid
                // Paid with nothing billing it anywhere: a comp, a grant, or
                // an org membership. Claiming a purchase here would be a lie.
                ? nPlan === "office"
                  ? "Office is enabled on this account."
                  : "Pro is enabled on this account."
                : "Unlock everything in SwiftCard with Pro."}
        </p>
        {/* A declined renewal: the push opens this screen, which used to say
            only "active". Where to fix it, with no price and no link out
            (3.1.1) — the payment method lives on swiftcard.me. */}
        {nPaid && !appleBilled && (sub.paymentFailed || sub.status === "past_due" || sub.status === "unpaid") && (
          <div className="mt-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2">
            <p className="text-[0.75rem] leading-relaxed text-amber-200">
              Your last payment didn&apos;t go through. Update the card on your subscription to keep {nPlan === "office" ? "Office" : "Pro"} — your access continues in the meantime.
            </p>
            {canLinkOut && (
              <button
                type="button"
                onClick={() => { void openExternalPurchase("/settings/flows?billing=1#billing"); }}
                className="mt-2 w-full rounded-full bg-gray-800 border border-gray-700 py-2 text-xs font-semibold text-white hover:bg-gray-700"
              >
                Update payment method
              </button>
            )}
          </div>
        )}
        {/* Trial / grant end — a date, never a price (3.1.1). */}
        {nPaid && sub?.trialEnd && (
          <p className="mt-1 text-[0.8125rem] text-gray-400">{trialStatusLine({ trialEndsAt: sub.trialEnd, native: true })}</p>
        )}
        {nPaid && !sub?.trialEnd && sub?.grantEndsAt && (
          <p className="mt-1 text-[0.8125rem] text-gray-400">Free {nPlan === "office" ? "Office" : "Pro"} · ends {fmtDate(sub.grantEndsAt)}</p>
        )}
        {appleBilled ? (
          <button
            type="button"
            onClick={() => manageIapSubscription()}
            className="mt-3 w-full rounded-full bg-gray-800 border border-gray-700 py-2.5 text-xs font-semibold text-white transition-colors hover:bg-gray-700"
          >
            Manage subscription
          </button>
        ) : !nPaid ? (
          // Fail-closed: renders nothing when signed out or without StoreKit
          // products, leaving a plain informational panel.
          <IapSubscribeButton className="mt-3 !w-full !py-3" />
        ) : null}
      </div>
    );
  }
  if (loading) {
    return <div className="rounded-2xl border border-gray-800 bg-gray-900 p-5 text-sm text-gray-500">Loading billing…</div>;
  }
  if (!sub) {
    return <div className="rounded-2xl border border-gray-800 bg-gray-900 p-5 text-sm text-red-400">{err ?? "Unavailable."}</div>;
  }

  const isPaid = sub.plan === "pro" || sub.plan === "office";
  const renewalLine = sub.renewalCents != null
    ? `${formatUsd(sub.renewalCents)}/${sub.interval === "annual" ? "yr" : "mo"}`
    : null;

  // ── Office sub-user with their OWN leftover subscription ──────────────────
  // Their seat already covers everything, so this personal sub only costs them
  // money. Before this view existed the billing section was hidden entirely for
  // sub-users, which meant the subscription kept charging with no way to even
  // SEE it in the app — the definition of a billing trap. Show exactly two
  // things: what they're paying, and the way out. No plan switcher, no seats —
  // team billing is the org's, not theirs.
  if (sub.personalSubOnly && sub.planSource === "apple" && !sub.hasStripeSubscription) {
    // Bought in the iPhone app before joining: Apple bills it, so there is no
    // cancel button this page could offer — only where to find Apple's.
    return (
      <div className="rounded-2xl border border-gray-800 bg-gray-900 p-5">
        <div className="flex items-center justify-between mb-1">
          <p className="text-sm text-gray-400">Your personal subscription</p>
          <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-blue-500/15 text-blue-300">Pro</span>
        </div>
        <p className="text-xs text-gray-500 leading-relaxed">
          Your team&apos;s Office seat already includes everything in Pro, so the Pro subscription you bought
          in the iPhone app isn&apos;t adding anything while you&apos;re on the team. Apple bills it, and it keeps
          renewing until you cancel it on your iPhone in Settings → Apple ID → Subscriptions — or keep it
          for if you ever leave the team.
        </p>
      </div>
    );
  }
  if (sub.personalSubOnly) {
    return (
      <PersonalSubCard
        sub={sub}
        busy={busy}
        err={err}
        notice={notice}
        renewalLine={renewalLine}
        onKeep={keepSubscription}
        onCancelled={load}
        setErr={setErr}
        setNotice={setNotice}
        setBusy={setBusy}
      />
    );
  }

  return (
    <div className="rounded-2xl border border-gray-800 bg-gray-900 p-5">
      {/* Current plan */}
      <div className="flex items-center justify-between mb-1">
        <p className="text-sm text-gray-400">Current plan</p>
        <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${isPaid ? "bg-blue-500/15 text-blue-300" : "bg-gray-800 text-gray-400"}`}>
          {planLabel(sub.plan)}{sub.plan === "office" && sub.seats ? ` · ${sub.seats} seats` : ""}
        </span>
      </div>

      {/* Three different truths share this line: a trial about to convert
          (say when, and for how much), a free-Pro grant with no subscription
          behind it (say when it ends — there is nothing to renew), and a
          normal renewal. It used to print "Renews " with no date for grants. */}
      {isPaid && !sub.cancelAtPeriodEnd && sub.trialEnd && (
        <p className="text-xs text-gray-500 mb-4">
          {trialStatusLine({ trialEndsAt: sub.trialEnd, amountCents: sub.renewalCents, native: false })}
        </p>
      )}
      {isPaid && !sub.cancelAtPeriodEnd && !sub.trialEnd && sub.grantEndsAt && (
        <p className="text-xs text-gray-500 mb-4">Free {planLabel(sub.plan)} · ends {fmtDate(sub.grantEndsAt)}</p>
      )}
      {isPaid && !sub.cancelAtPeriodEnd && !sub.trialEnd && !sub.grantEndsAt && (
        <p className="text-xs text-gray-500 mb-4">
          {renewalLine ? `${renewalLine} · ` : ""}Renews {fmtDate(sub.currentPeriodEnd)}
        </p>
      )}
      {!isPaid && <p className="text-xs text-gray-500 mb-4">Pro unlocks unlimited cards and contacts, text and AI-written follow-ups, custom card design, and full stats on who viewed your card.</p>}

      {sub.paymentFailed && (
        <div className="mb-4 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3.5 py-3">
          <p className="text-amber-300 text-xs font-semibold">Your last payment didn&apos;t go through.</p>
          <p className="text-amber-200/80 text-[0.6875rem] mt-0.5">Update your payment method to keep {planLabel(sub.plan)} — your access continues during the grace period.</p>
        </div>
      )}

      {/* Scheduled-cancellation banner + Keep Subscription */}
      {sub.cancelAtPeriodEnd && (
        <div className="mb-4 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3.5 py-3">
          <p className="text-amber-300 text-xs font-semibold">
            Scheduled to cancel on {fmtDate(sub.currentPeriodEnd)}
          </p>
          <p className="text-amber-200/80 text-[0.6875rem] mt-0.5 mb-3">
            You&apos;ll keep {planLabel(sub.plan)} until then, after which your account moves to Free.
          </p>
          <button
            onClick={keepSubscription}
            disabled={busy === "keep"}
            className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold text-sm py-2.5 rounded-full transition-colors"
          >
            {busy === "keep" ? "Reactivating…" : "Keep Subscription"}
          </button>
        </div>
      )}

      {notice && <p className="mb-3 rounded-lg bg-emerald-500/10 border border-emerald-500/25 text-emerald-300 text-xs px-3 py-2">{notice}</p>}
      {err && <p className="mb-3 rounded-lg bg-red-500/10 border border-red-500/25 text-red-300 text-xs px-3 py-2">{err}</p>}

      {/* Office seat management */}
      {sub.plan === "office" && !sub.cancelAtPeriodEnd && (
        <SeatManager sub={sub} onChanged={load} />
      )}

      {/* Actions — ONE door for a paid subscriber.
          There used to be three: "Change Plan", "Manage subscription & payment"
          (the Stripe portal, which by default also cancels and switches plans),
          and "Cancel subscription". All three ended somewhere you could cancel,
          which is what made them feel like the same button three times.
          Now: this opens everything — switch plan, payment method, invoices, and
          the downgrade-to-Free path — and cancelling is a deliberate step INSIDE
          it, behind the reason prompt and the retention offer, rather than a
          one-click exit sitting on the surface. */}
      <div className="space-y-2.5 mt-4">
        {/* In-product upgrade — /upgrade, not the marketing /pricing page: no
            Free column to re-pick and no trial offer, since they're already a
            user. Just Pro or Office, start and pay. */}
        {(!isPaid || (!sub.hasStripeSubscription && !!sub.grantEndsAt)) && (
          <Link href="/upgrade" className="block text-center bg-blue-600 hover:bg-blue-500 text-white font-bold text-sm py-2.5 rounded-full transition-colors">
            Upgrade →
          </Link>
        )}

        {/* Apple-billed Pro has nothing to manage here — Stripe knows nothing
            about it. Say where it lives instead of a button that cannot work. */}
        {isPaid && !sub.hasStripeSubscription && sub.planSource === "apple" && (
          <p className="text-xs text-gray-400">Your Pro subscription is billed through your Apple account. Manage or cancel it in your iPhone&apos;s Settings → Apple ID → Subscriptions.</p>
        )}

        {isPaid && sub.hasStripeSubscription && (
          <button
            onClick={() => { setShowChange(true); setErr(null); setNotice(null); }}
            className="w-full bg-gray-800 hover:bg-gray-700 text-white font-semibold text-sm py-2.5 rounded-full transition-colors"
          >
            Manage subscription &amp; payment
          </button>
        )}

        {/* A cancelled/Free account keeps its Stripe customer — it still needs a
            way to read past invoices, and has no subscription modal to find it in. */}
        {!isPaid && sub.hasCustomer && <ManageBillingButton />}
      </div>

      {showChange && (
        <ChangePlanModal
          sub={sub}
          onClose={() => setShowChange(false)}
          onCancelInstead={() => { setShowChange(false); setShowCancel(true); }}
          onChanged={async (msg) => { setShowChange(false); setNotice(msg); await load(); }}
        />
      )}
      {showCancel && (
        <CancelModal
          sub={sub}
          onClose={() => setShowCancel(false)}
          onDone={async (msg) => { setShowCancel(false); setNotice(msg); await load(); }}
        />
      )}
    </div>
  );
}

// ── Office seat manager ───────────────────────────────────────────────────────
function SeatManager({ sub, onChanged }: { sub: Sub; onChanged: () => Promise<void> }) {
  const [seats, setSeats] = useState(sub.seats ?? sub.minSeats);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const active = sub.activeMembers ?? 0;
  const pending = sub.pendingInvites ?? 0;
  const used = 1 /* owner */ + active + pending; // seats in use — can't reduce below this
  const available = Math.max(0, (sub.seats ?? sub.minSeats) - used);
  const floor = Math.max(sub.minSeats, used);
  const changed = seats !== (sub.seats ?? sub.minSeats);

  const current = sub.seats ?? sub.minSeats;
  const perSeatCents = sub.interval === "annual" ? PLAN_PRICES.OFFICE_ANNUAL_PER_SEAT_CENTS : PLAN_PRICES.OFFICE_MONTHLY_PER_SEAT_CENTS;
  const per = sub.interval === "annual" ? "yr" : "mo";

  async function submit(targetSeats: number) {
    setBusy(true); setMsg(null);
    try {
      const res = await fetch("/api/stripe/subscription/seats", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ seats: targetSeats }),
      });
      const data = await res.json();
      if (!res.ok) { setMsg(data.error || "Couldn't update seats."); return; }
      if (data.mode === "increased") setMsg(`Seats increased to ${data.seats}. Your next invoice is prorated.`);
      else if (data.mode === "scheduled") setMsg(`Scheduled to reduce to ${data.scheduledSeats} on ${fmtDate(data.effectiveAt)}. Current seats stay until then.`);
      else if (data.mode === "unchanged") setMsg("Scheduled reduction canceled — you'll keep your current seats.");
      await onChanged();
    } catch {
      setMsg("Couldn't reach the server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-950/50 p-3.5 mb-2">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-semibold text-gray-300">Team seats</p>
        <p className="text-[0.6875rem] text-gray-500">{available} available · min {sub.minSeats}</p>
      </div>
      <p className="text-[0.6875rem] text-gray-500 mb-2">
        {current} purchased · {sub.managingOrgBilling ? "owner" : "you"} + {active} active + {pending} pending = {used} used
      </p>

      {/* Scheduled reduction banner (spec §5) — current vs future clearly distinct */}
      {sub.scheduledSeats != null && (
        <div className="mb-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5">
          <p className="text-amber-300 text-[0.6875rem] font-semibold">
            Scheduled to reduce {current} → {sub.scheduledSeats} seats on {fmtDate(sub.scheduledSeatsAt)}
          </p>
          <p className="text-amber-200/80 text-[0.6875rem] mt-0.5">
            {formatUsd(seatSubtotalCents(perSeatCents, current))}/{per} now → {formatUsd(seatSubtotalCents(perSeatCents, sub.scheduledSeats))}/{per} after. You keep {current} seats until then.
          </p>
          <button onClick={() => submit(current)} disabled={busy}
            className="mt-2 text-[0.6875rem] font-semibold text-white bg-gray-800 hover:bg-gray-700 disabled:opacity-50 px-3 py-1.5 rounded-full">
            {busy ? "…" : "Cancel scheduled reduction"}
          </button>
        </div>
      )}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <button onClick={() => setSeats((s) => Math.max(floor, s - 1))} disabled={seats <= floor}
            className="w-8 h-8 rounded-lg bg-gray-800 hover:bg-gray-700 disabled:opacity-40 text-white font-bold">−</button>
          <span className="w-10 text-center text-white font-bold tabular-nums">{seats}</span>
          <button onClick={() => setSeats((s) => s + 1)}
            className="w-8 h-8 rounded-lg bg-gray-800 hover:bg-gray-700 text-white font-bold">+</button>
        </div>
        <span className="text-xs text-gray-500">
          {`${formatUsd(seatSubtotalCents(sub.interval === "annual" ? PLAN_PRICES.OFFICE_ANNUAL_PER_SEAT_CENTS : PLAN_PRICES.OFFICE_MONTHLY_PER_SEAT_CENTS, seats))}/${sub.interval === "annual" ? "yr" : "mo"}`}
        </span>
        {changed && (
          <button onClick={() => submit(seats)} disabled={busy}
            className="ml-auto bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-bold px-3 py-1.5 rounded-full">
            {busy ? "Saving…" : seats > current ? "Add seats" : "Schedule reduction"}
          </button>
        )}
      </div>
      {changed && seats < current && (
        <p className="text-[0.6875rem] text-gray-500 mt-1.5">Reductions take effect at the end of your billing period; you keep {current} seats until then.</p>
      )}
      {msg && <p className="text-[0.6875rem] text-gray-400 mt-2">{msg}</p>}
      {floor > sub.minSeats && seats <= floor && (
        <p className="text-[0.6875rem] text-gray-600 mt-1.5">Remove members or retract invitations to go below {floor} seats.</p>
      )}
    </div>
  );
}

// ── Change Plan modal ─────────────────────────────────────────────────────────
function ChangePlanModal({ sub, onClose, onCancelInstead, onChanged }: {
  sub: Sub;
  onClose: () => void;
  onCancelInstead: () => void;
  onChanged: (msg: string) => Promise<void>;
}) {
  const [interval, setInterval] = useState<"monthly" | "annual">(sub.interval ?? "monthly");
  const [seats, setSeats] = useState(sub.seats ?? PLAN_LIMITS.OFFICE_MIN_SEATS);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // Office → Pro ends the team. It was one click on the Pro row with no word
  // about the teammates, while the same move offered from the cancel flow did
  // warn. Now the row opens this confirmation first.
  const [confirmPro, setConfirmPro] = useState(false);
  // "Current" means this plan AND this billing period — otherwise the toggle
  // showed Office/Pro as Current on the other interval and there was no way to
  // switch monthly ↔ annual at all (the API supports it).
  const onInterval = (sub.interval ?? "monthly") === interval;

  async function choose(plan: "pro" | "office") {
    // One plan change at a time. With the Pro confirm open, both switch buttons
    // are on screen and each only disabled ITSELF, so tapping one then the other
    // sent two change-plan requests to Stripe at once (bug audit 2026-10-06).
    if (busy) return;
    setBusy(plan); setErr(null);
    // A change that CHARGES today — Pro → Office, or any move to annual — goes
    // through the /checkout review page, which asks Stripe for the real
    // amount, shows "Due today" and waits for a confirm. This used to call
    // change-plan straight from here: one tap charged an annual Office upgrade
    // (hundreds of dollars) with no amount shown and no confirmation.
    // Moves that only produce a credit (Office → Pro, annual → monthly) stay
    // here with their own confirm.
    const charges = (plan === "office" && sub.plan !== "office") || (interval === "annual" && (sub.interval ?? "monthly") !== "annual");
    if (charges) {
      const qs = new URLSearchParams({ plan, interval });
      if (plan === "office") qs.set("seats", String(sub.plan === "office" ? (sub.seats ?? seats) : seats));
      window.location.href = `/checkout?${qs.toString()}`;
      return;
    }
    try {
      const res = await fetch("/api/stripe/subscription/change-plan", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan, interval, seats: plan === "office" ? seats : undefined }),
      });
      const data = await res.json();
      if (res.status === 409 && data.needsCheckout) {
        // No subscription yet → send them through checkout to add a card.
        // /upgrade, not /pricing: this person is signed in and already in
        // billing, so the public marketing page (with its Free column) is the
        // wrong surface — same convention as every other in-app upsell.
        window.location.href = "/upgrade";
        return;
      }
      if (!res.ok) { setErr(data.error || "Couldn't change plan."); return; }
      await onChanged(
        sub.plan === "office" && plan === "pro"
          ? `You're now on Pro (${interval}). Your teammates have moved to their own plans, and the unused part of Office is credited to your next invoice.`
          : `You're now on ${plan === "office" ? "Office" : "Pro"} (${interval}). Charges are prorated.`,
      );
    } catch {
      setErr("Couldn't reach the server.");
    } finally {
      setBusy(null);
    }
  }

  const proMo = interval === "annual"
    ? `${formatUsd(PLAN_PRICES.PRO_ANNUAL_CENTS)}/yr` : `${formatUsd(PLAN_PRICES.PRO_MONTHLY_CENTS)}/mo`;
  const officePer = interval === "annual"
    ? `${formatUsd(PLAN_PRICES.OFFICE_ANNUAL_PER_SEAT_CENTS)}/yr` : `${formatUsd(PLAN_PRICES.OFFICE_MONTHLY_PER_SEAT_CENTS)}/mo`;

  return (
    <Modal onClose={onClose} title="Manage subscription">
      <div className="flex items-center justify-center gap-2 mb-4">
        {(["monthly", "annual"] as const).map((iv) => (
          <button key={iv} onClick={() => setInterval(iv)}
            className={`text-xs font-semibold px-3 py-1.5 rounded-full transition-colors ${interval === iv ? "bg-blue-600 text-white" : "bg-gray-800 text-gray-400"}`}>
            {iv === "monthly" ? "Monthly" : "Annual · save 10%"}
          </button>
        ))}
      </div>

      <div className="space-y-2.5">
        {/* Pro */}
        <PlanRow
          name="Pro" price={proMo} desc="Unlimited everything, for one person."
          current={sub.plan === "pro" && onInterval}
          switchLabel={sub.plan === "pro" ? (interval === "annual" ? "Switch to annual" : "Switch to monthly") : undefined}
          busy={busy === "pro"}
          onSelect={() => (sub.plan === "office" ? setConfirmPro(true) : choose("pro"))}
        />
        {confirmPro && (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3.5">
            <p className="text-amber-200 text-sm font-semibold">Switch to Pro and end your team?</p>
            <ul className="mt-2 space-y-1.5 text-amber-200/80 text-[0.6875rem] leading-relaxed list-disc pl-4">
              <li>Your Office plan ends now and your seats are released.</li>
              <li>Each teammate moves to their own plan — Free, or their own Pro if they pay for it. Their first card stays live, without your company branding, and they&apos;re told in the app.</li>
              <li>You lose the Admin console. Your own cards, design and contacts stay exactly as they are.</li>
              <li>The unused part of Office is credited to your next invoice.</li>
              <li>Switch back to Office any time and your team and branding come back.</li>
            </ul>
            <div className="flex gap-2 mt-3">
              <button onClick={() => setConfirmPro(false)} className="flex-1 bg-gray-800 hover:bg-gray-700 text-white text-xs font-bold py-2 rounded-full">Keep Office</button>
              <button onClick={() => choose("pro")} disabled={busy !== null} className="flex-1 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white text-xs font-bold py-2 rounded-full">
                {busy === "pro" ? "Switching…" : "Switch to Pro"}
              </button>
            </div>
          </div>
        )}
        {/* Office */}
        <div className="rounded-xl border border-gray-800 bg-gray-950/50 p-3.5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-white font-semibold text-sm">Office <span className="text-gray-500 font-normal">· {officePer}/seat</span></p>
              <p className="text-gray-500 text-[0.6875rem]">One brand across your whole team.</p>
            </div>
            {sub.plan === "office" && onInterval
              ? <span className="text-[0.6875rem] font-bold text-blue-300">Current</span>
              : (
                <button onClick={() => choose("office")} disabled={busy !== null}
                  className="bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-white text-xs font-bold px-3 py-1.5 rounded-full">
                  {busy === "office" ? "…" : sub.plan === "office" ? (interval === "annual" ? "Switch to annual" : "Switch to monthly") : "Switch"}
                </button>
              )}
          </div>
          {(sub.plan !== "office") && (
            <div className="flex items-center gap-2 mt-2.5">
              <span className="text-[0.6875rem] text-gray-500">Seats:</span>
              <button onClick={() => setSeats((s) => Math.max(PLAN_LIMITS.OFFICE_MIN_SEATS, s - 1))}
                className="w-6 h-6 rounded bg-gray-800 text-white text-sm">−</button>
              <span className="w-6 text-center text-white text-xs tabular-nums">{seats}</span>
              <button onClick={() => setSeats((s) => s + 1)} className="w-6 h-6 rounded bg-gray-800 text-white text-sm">+</button>
            </div>
          )}
        </div>

        {/* Payment method + invoices. The portal opens the Stripe Dashboard's
            default configuration (api/stripe/portal), so whatever it allows
            beyond payment method and invoices is set there, not here; the
            webhook reconciles any plan or seat change made in it. */}
        {sub.hasCustomer && (
          <div className="pt-1">
            <ManageBillingButton />
          </div>
        )}

        {/* Move to Free = cancel. Kept as a separate, honest, visually quiet action
            (it's the one path that loses the customer value — no reason to dress it
            up). The copy states the real downgrade consequence instead of the old,
            misleading "keeps your cards & contacts". */}
        <button onClick={onCancelInstead}
          className="w-full text-left rounded-xl border border-gray-800/70 bg-gray-950/40 p-3.5 hover:border-gray-700 transition-colors">
          <p className="text-gray-300 font-semibold text-sm">Switch to Free</p>
          <p className="text-gray-500 text-[0.6875rem]">Downgrades your account — extra cards go offline and your card loses its Pro design. See exactly what changes first.</p>
        </button>
      </div>

      {err && <p className="mt-3 text-red-400 text-xs text-center">{err}</p>}
    </Modal>
  );
}

function PlanRow({ name, price, desc, current, busy, onSelect, switchLabel }: {
  name: string; price: string; desc: string; current: boolean; busy: boolean; onSelect: () => void;
  /** Button text when it isn't just "Switch" (e.g. "Switch to annual"). */
  switchLabel?: string;
}) {
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-950/50 p-3.5 flex items-center justify-between">
      <div>
        <p className="text-white font-semibold text-sm">{name} <span className="text-gray-500 font-normal">· {price}</span></p>
        <p className="text-gray-500 text-[0.6875rem]">{desc}</p>
      </div>
      {current
        ? <span className="text-[0.6875rem] font-bold text-blue-300">Current</span>
        : (
          <button onClick={onSelect} disabled={busy}
            className="bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-white text-xs font-bold px-3 py-1.5 rounded-full">
            {busy ? "…" : switchLabel ?? "Switch"}
          </button>
        )}
    </div>
  );
}

// ── Cancel flow: reason → 50% offer → confirm ─────────────────────────────────
function CancelModal({ sub, onClose, onDone }: {
  sub: Sub;
  onClose: () => void;
  onDone: (msg: string) => Promise<void>;
}) {
  const [step, setStep] = useState<"reason" | "offer" | "confirming">("reason");
  const [reason, setReason] = useState("");
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // What we can offer to keep them, decided by plan + reason:
  //  • Office → downgrade to Pro instead of churning to $0 (keeps their card +
  //    their money, just drops the team). Offered to every Office canceller.
  //  • 50% off for 3 months → only for price-sensitive reasons, once per customer.
  const canOfferPro = sub.plan === "office";
  // Not during a free trial: there is no invoice yet to take 50% off, and the
  // delete-account flow already holds this back for trials (retention route).
  // Nor on an annual plan (a 3-month coupon lapses before a yearly renewal) or
  // over a discount they already have — `discountOfferable` says so.
  const canOfferDiscount = !sub.retentionUsed && !sub.trialEnd && sub.discountOfferable === true && PRICE_SENSITIVE_REASONS.includes(reason);
  // On a card trial: stretch it to a full month from its start instead —
  // for every reason, the same offer the delete flow makes (owner, 2026-10-02).
  // This modal only exists on the web, so the copy is the web form.
  const ext = sub.plan === "pro" ? sub.trialExtension ?? null : null;
  const extOffer = ext ? trialExtensionOffer(ext, false, "No thanks, continue canceling") : null;
  const canOfferExtension = !!extOffer;

  const proCents = (sub.interval ?? "monthly") === "annual" ? PLAN_PRICES.PRO_ANNUAL_CENTS : PLAN_PRICES.PRO_MONTHLY_CENTS;
  const proLabel = `${formatUsd(proCents)}/${(sub.interval ?? "monthly") === "annual" ? "yr" : "mo"}`;

  function next() {
    if (!reason) { setErr("Please pick a reason so we can improve."); return; }
    setErr(null);
    // Only interrupt with the save step if we actually have something to offer.
    setStep(canOfferPro || canOfferDiscount || canOfferExtension ? "offer" : "confirming");
  }

  async function switchToPro() {
    setBusy("pro"); setErr(null);
    try {
      const res = await fetch("/api/stripe/subscription/change-plan", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan: "pro", interval: sub.interval ?? "monthly" }),
      });
      const data = await res.json();
      if (!res.ok) { setErr(data.error || "Couldn't switch to Pro. Please try again."); return; }
      await onDone(`You're now on Pro (${proLabel}) — your own card stays active. Your team's seats have ended and their cards revert to their own plans.`);
    } catch {
      setErr("Couldn't reach the server.");
    } finally { setBusy(null); }
  }

  async function acceptOffer() {
    setBusy("offer"); setErr(null);
    try {
      const res = await fetch("/api/stripe/subscription/discount", { method: "POST" });
      const data = await res.json();
      if (!res.ok) { setErr(data.error || "Couldn't apply the discount."); return; }
      await onDone("Great news — 50% off for your next 3 months is applied. Your plan stays active.");
    } catch {
      setErr("Couldn't reach the server.");
    } finally { setBusy(null); }
  }

  async function acceptExtension() {
    setBusy("extend"); setErr(null);
    try {
      const res = await fetch("/api/stripe/subscription/extend-trial", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(data.error || "Couldn't extend your trial. Please try again."); return; }
      const until = typeof data.until === "string" ? dayLabel(data.until) : "";
      await onDone(until
        ? `Your trial now runs until ${until}. Your first charge moves to that day — cancel any time before then and you pay nothing.`
        : "Your trial is extended.");
    } catch {
      setErr("Couldn't reach the server.");
    } finally { setBusy(null); }
  }

  async function confirmCancel() {
    setBusy("cancel"); setErr(null);
    try {
      const res = await fetch("/api/stripe/subscription/cancel", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason, comment }),
      });
      const data = await res.json();
      if (!res.ok) { setErr(data.error || "Couldn't schedule cancellation."); return; }
      await onDone(`Your plan is scheduled to end on ${fmtDate(data.cancelAt)}. You keep ${sub.plan === "office" ? "Office" : "Pro"} until then.`);
    } catch {
      setErr("Couldn't reach the server.");
    } finally { setBusy(null); }
  }

  return (
    <Modal onClose={onClose} title={step === "offer" ? "Before you go" : "Cancel subscription"}>
      {step === "reason" && (
        <>
          <p className="text-gray-400 text-sm mb-3">What&apos;s making you cancel? This helps us improve.</p>
          <div className="space-y-1.5 mb-3">
            {CANCEL_REASONS.map((r) => (
              <button key={r} onClick={() => setReason(r)}
                className={`w-full text-left text-sm px-3.5 py-2.5 rounded-xl border transition-colors ${reason === r ? "border-blue-500 bg-blue-500/10 text-white" : "border-gray-800 bg-gray-950/50 text-gray-300 hover:border-gray-700"}`}>
                {r}
              </button>
            ))}
          </div>
          <textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={2}
            placeholder="Anything else? (optional)"
            className="w-full rounded-xl bg-gray-950 border border-gray-800 text-sm text-white px-3.5 py-2.5 mb-3 focus:outline-none focus:border-gray-600" />
          {err && <p className="text-red-400 text-xs mb-3">{err}</p>}
          <div className="flex gap-2.5">
            <button onClick={onClose} className="flex-1 bg-blue-600 hover:bg-blue-500 text-white font-bold text-sm py-2.5 rounded-full">Never mind, keep it</button>
            <button onClick={next} className="flex-1 bg-gray-800 hover:bg-gray-700 text-gray-300 font-semibold text-sm py-2.5 rounded-full">Continue</button>
          </div>
        </>
      )}

      {step === "offer" && (
        <>
          {/* Office → Pro: keep your own card on a cheaper plan instead of losing
              everything to Free. The strongest save for a single owner who no
              longer needs a whole team. */}
          {canOfferPro && (
            <div className="rounded-2xl border border-blue-700/40 bg-blue-950/30 p-4 mb-3">
              <p className="text-white font-bold text-base">Don&apos;t need the team? Switch to Pro</p>
              <p className="text-gray-300 text-sm mt-1">Keep your own card and every Pro feature for just <span className="text-white font-semibold">{proLabel}</span> — instead of dropping all the way to Free.</p>
              <p className="text-gray-500 text-[0.6875rem] mt-1.5">Your team&apos;s seats end and each teammate moves to their own plan, keeping their first card live without your branding. The unused part of Office is credited to your next invoice, and switching back to Office brings your team back.</p>
              <button onClick={switchToPro} disabled={busy !== null}
                className="mt-3 w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-bold text-sm py-3 rounded-full">
                {busy === "pro" ? "Switching…" : `Switch to Pro · ${proLabel}`}
              </button>
            </div>
          )}

          {/* 50% off — only surfaced for price-sensitive reasons (see next()). */}
          {canOfferDiscount && (
            <div className="rounded-2xl border border-emerald-600/30 bg-emerald-950/20 p-4 mb-3">
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 shrink-0 rounded-full bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center">
                  <span className="text-emerald-300 font-black text-sm">50%</span>
                </div>
                <div>
                  <p className="text-white font-bold text-sm">{canOfferPro ? "Or keep it at 50% off" : "Stay for 50% off — 3 months"}</p>
                  <p className="text-gray-400 text-xs mt-0.5">Half price on {sub.plan === "office" ? "Office" : "Pro"} for your next 3 billing cycles. One-time offer.</p>
                </div>
              </div>
              <button onClick={acceptOffer} disabled={busy !== null}
                className="mt-3 w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold text-sm py-3 rounded-full">
                {busy === "offer" ? "Applying…" : "Apply 50% off & keep my plan"}
              </button>
            </div>
          )}

          {/* A card trial → run on free to a full month from its start. */}
          {extOffer && (
            <div className="rounded-2xl border border-blue-700/40 bg-blue-950/30 p-4 mb-3">
              {extOffer.badge && (
                <span className="inline-block rounded-full bg-blue-600 text-white text-[0.625rem] font-bold uppercase tracking-wider px-2.5 py-1 mb-2">
                  {extOffer.badge}
                </span>
              )}
              <p className="text-white font-bold text-base leading-snug text-balance">{extOffer.title}</p>
              <p className="text-gray-300 text-sm mt-1">{extOffer.body}</p>
              {extOffer.priceLine && <p className="text-gray-500 text-xs mt-2">{extOffer.priceLine}</p>}
              {extOffer.fineprint && <p className="text-gray-500 text-[0.6875rem] mt-1">{extOffer.fineprint}</p>}
              <button onClick={acceptExtension} disabled={busy !== null}
                className="mt-3 w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-bold text-sm py-3 rounded-full">
                {busy === "extend" ? "One moment…" : extOffer.accept}
              </button>
            </div>
          )}

          {err && <p className="text-red-400 text-xs mb-3 text-center">{err}</p>}
          <button onClick={() => { setStep("confirming"); setErr(null); }} disabled={busy !== null}
            className="w-full text-gray-500 hover:text-gray-300 disabled:opacity-50 font-semibold text-xs py-1.5">
            No thanks, continue canceling
          </button>
        </>
      )}

      {step === "confirming" && (
        <>
          <p className="text-gray-300 text-sm mb-3">
            You keep {sub.plan === "office" ? "Office" : "Pro"} until <strong className="text-white">{fmtDate(sub.currentPeriodEnd)}</strong> (no further charges). After that your account drops to Free and:
          </p>
          <ul className="space-y-1.5 mb-3">
            {downgradeLosses(sub.plan).map((loss, i) => (
              <li key={i} className="flex gap-2 text-gray-400 text-xs leading-relaxed">
                <span className="mt-0.5 text-red-400/90 shrink-0" aria-hidden>✕</span>
                <span>{loss}</span>
              </li>
            ))}
          </ul>
          <p className="text-gray-500 text-[0.6875rem] mb-4">{sub.plan === "office"
            ? "Nothing is deleted — re-subscribe to Office anytime and your team comes back as it was, company branding included (as many people as your seats allow)."
            // Not "it all switches back on": when Pro ends and they choose
            // Continue on Free, the card's DESIGN converts to the closest free
            // look for good (owner rule — content is never deleted, design
            // converts; see api/account/choose-plan). Say what is true.
            : "Nothing is deleted — your cards, links and contacts all stay, and re-subscribing switches every Pro feature back on. If you continue on Free, your card's design moves to the closest free look."}</p>
          {err && <p className="text-red-400 text-xs mb-3">{err}</p>}
          {/* Primary emphasis on staying (the profitable choice); downgrade is a
              plain, always-available secondary action — clear, not hidden. */}
          <div className="space-y-2.5">
            <button onClick={onClose}
              className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold text-sm py-3 rounded-full">
              Keep my {sub.plan === "office" ? "Office" : "Pro"} plan
            </button>
            <button onClick={confirmCancel} disabled={busy !== null}
              className="w-full text-gray-500 hover:text-gray-300 disabled:opacity-50 font-semibold text-xs py-1.5">
              {busy === "cancel" ? "Downgrading…" : "Downgrade to Free anyway"}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}

// ── Shared modal shell ────────────────────────────────────────────────────────
// Trimmed billing card for an Office sub-user who still pays for a personal
// subscription from before they joined the team. Their seat covers Pro, so the
// only decisions that are theirs: cancel it, or keep it (some deliberately keep
// it as a soft landing for if they ever leave — memberFallbackPlan returns them
// to Pro on teardown precisely because this sub survived). Cancelling here is
// two-step but skips the reason prompt and retention offer: those exist to keep
// someone from LOSING access, and this person loses nothing.
function PersonalSubCard({ sub, busy, err, notice, renewalLine, onKeep, onCancelled, setErr, setNotice, setBusy }: {
  sub: Sub;
  busy: string | null;
  err: string | null;
  notice: string | null;
  renewalLine: string | null;
  onKeep: () => Promise<void>;
  onCancelled: () => Promise<void>;
  setErr: (v: string | null) => void;
  setNotice: (v: string | null) => void;
  setBusy: (v: string | null) => void;
}) {
  const [confirming, setConfirming] = useState(false);

  async function cancelPersonal() {
    setBusy("cancel-personal"); setErr(null); setNotice(null);
    try {
      const res = await fetch("/api/stripe/subscription/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "Covered by team Office seat" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(data.error || "Something went wrong."); return; }
      setConfirming(false);
      setNotice(
        data.periodEnd
          ? `Done — your personal subscription ends on ${fmtDate(data.periodEnd)} and you won't be charged again after that. Your team seat keeps every Pro feature working.`
          : "Done — your personal subscription won't renew. Your team seat keeps every Pro feature working.",
      );
      await onCancelled();
    } catch {
      setErr("Couldn't reach the server. Try again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="rounded-2xl border border-gray-800 bg-gray-900 p-5">
      <div className="flex items-center justify-between mb-1">
        <p className="text-sm text-gray-400">Your personal subscription</p>
        <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-blue-500/15 text-blue-300">{planLabel(sub.plan)}</span>
      </div>

      <p className="text-xs text-gray-500 mb-4 leading-relaxed">
        Your team&apos;s Office seat already includes everything in Pro, so this personal subscription
        {renewalLine ? ` (${renewalLine})` : ""} isn&apos;t adding anything while you&apos;re on the team.
        You can cancel it and lose nothing — or keep it as your own plan for if you ever leave the team.
      </p>

      {sub.cancelAtPeriodEnd ? (
        <div className="mb-1 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3.5 py-3">
          <p className="text-amber-300 text-xs font-semibold">Ends on {fmtDate(sub.currentPeriodEnd)} — you won&apos;t be charged again.</p>
          <p className="text-amber-200/80 text-[0.6875rem] mt-0.5 mb-3">Your team seat keeps every Pro feature working after that.</p>
          <button
            onClick={onKeep}
            disabled={busy === "keep"}
            className="w-full bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-white font-semibold text-sm py-2.5 rounded-full transition-colors"
          >
            {busy === "keep" ? "Reactivating…" : "Keep my personal subscription"}
          </button>
        </div>
      ) : confirming ? (
        <div className="rounded-xl border border-gray-700 bg-gray-800/60 px-3.5 py-3">
          <p className="text-gray-300 text-xs mb-3">
            Cancel your personal {planLabel(sub.plan)} subscription? You&apos;ll keep it until the end of the period
            you&apos;ve paid for, then it simply stops billing. Nothing about your team access changes.
          </p>
          <div className="flex gap-2">
            <button
              onClick={cancelPersonal}
              disabled={busy === "cancel-personal"}
              className="flex-1 bg-red-600/80 hover:bg-red-600 disabled:opacity-50 text-white font-semibold text-sm py-2.5 rounded-full transition-colors"
            >
              {busy === "cancel-personal" ? "Cancelling…" : "Yes, cancel it"}
            </button>
            <button
              onClick={() => setConfirming(false)}
              disabled={busy === "cancel-personal"}
              className="flex-1 bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-gray-300 font-semibold text-sm py-2.5 rounded-full transition-colors"
            >
              Never mind
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => { setConfirming(true); setErr(null); setNotice(null); }}
          className="w-full bg-gray-800 hover:bg-gray-700 text-white font-semibold text-sm py-2.5 rounded-full transition-colors"
        >
          Cancel my personal subscription
        </button>
      )}

      {notice && <p className="mt-3 rounded-lg bg-emerald-500/10 border border-emerald-500/25 text-emerald-300 text-xs px-3 py-2">{notice}</p>}
      {err && <p className="mt-3 rounded-lg bg-red-500/10 border border-red-500/25 text-red-300 text-xs px-3 py-2">{err}</p>}
    </div>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = ""; };
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center px-5">
      <button aria-label="Close" onClick={onClose} className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
      <div className="relative w-full max-w-sm rounded-2xl border border-gray-800 bg-gray-900 p-6 shadow-2xl max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-white font-bold text-lg">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="text-gray-500 hover:text-gray-300 text-xl leading-none">×</button>
        </div>
        {children}
      </div>
    </div>
  );
}
