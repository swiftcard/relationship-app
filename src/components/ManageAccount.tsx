"use client";

import { useState } from "react";
import { useIsNativeApp } from "@/lib/platform";
import { createBrowserClient } from "@supabase/ssr";
import DownloadLink from "@/components/DownloadLink";
import { releaseDevice } from "@/lib/device-sign-out";
import {
  reasonsFor,
  reasonById,
  giftEndLabel,
  offerStep,
  keepStep,
  lossLines,
  stepsFor,
  progressLabel,
  type AccountFacts,
  type Eligibility,
  type PlanSource,
  type RetentionPlan,
  type StepId,
} from "@/lib/retention";

// Advanced account settings → Account ownership and deletion.
//
// Deletion is a SEQUENCE, not a switch (owner order 2026-09-04): ask why, ask
// what would have fixed it, offer the save that costs nothing, show what
// deleting destroys in their own numbers, then — the last thing before the
// typed DELETE (owner order 2026-09-30) — the one promotion this account can
// actually be given, once per person. Free and Pro get different
// questions and different offers — see lib/retention.ts, which owns every word
// of it so the copy is testable and the two plans can't drift into each other.
//
// Apple 5.1.1(v): deletion stays reachable and completable. Every step carries
// a button that continues toward deletion, offers are declined by pressing it,
// and no step can trap someone. Apple 3.1.1: inside the shell there are no
// prices, no checkout and no links out — the copy for that comes from
// retention.ts, which is handed `native`.
/** "October 30" — the day the gift ends, from the date the server wrote. */
function formatGiftEnd(iso: string): string {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? new Date(t).toLocaleDateString("en-US", { month: "long", day: "numeric" }) : "";
}

export default function ManageAccount({ isPro, plan = "free", email = "", isOfficeOwner = false }: { isPro: boolean; plan?: string; email?: string; isOfficeOwner?: boolean }) {
  const native = useIsNativeApp();
  const [expanded, setExpanded] = useState(false);
  const [modal, setModal] = useState(false);
  const [step, setStep] = useState<StepId>("why");
  const [reason, setReason] = useState("");
  const [comment, setComment] = useState("");
  const [confirmText, setConfirmText] = useState("");
  const [password, setPassword] = useState("");
  // null = still checking; false = OAuth-only account (no password to re-check).
  const [needsPassword, setNeedsPassword] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  // What the server says this account is and may be offered. Until it answers,
  // the sequence runs on the conservative default: no offers.
  const [facts, setFacts] = useState<AccountFacts | null>(null);
  const [elig, setElig] = useState<Eligibility>({ grant: false, discount: false, downgrade: false });
  const [source, setSource] = useState<PlanSource>(null);
  // Set when an offer is accepted — the modal turns into a confirmation and
  // deletion is off the table for this visit.
  const [saved, setSaved] = useState<string | null>(null);
  // The gift's real end date, as the server wrote it.
  const [savedUntil, setSavedUntil] = useState<string | null>(null);
  // The server has answered (or given up). The step list depends on the
  // answer, so the sequence doesn't start counting until it is known — a fast
  // click-through used to skip the promotion and turn "of 5" into "of 6".
  const [ready, setReady] = useState(false);

  const retPlan: RetentionPlan = isPro || plan !== "free" ? "pro" : "free";
  // Free accounts get a QUIETER entry point (owner order 2026-09-14): the panel
  // and its trigger drop the red, because nothing destructive has happened yet
  // — red belongs on the act, not on the door to it. Location, label and wording
  // are untouched, so Apple 5.1.1(v) findability is unaffected and the knowledge
  // base ("Settings → Advanced account settings → Account ownership and deletion
  // → Delete account") stays true. Pro is deliberately left exactly as it was.
  //
  // text-gray-400 is the SECONDARY token in both themes and is what ghostBtn
  // below already uses. Do not "tidy" it to gray-300: globals.css remaps
  // gray-200/300 to #1F2937 in light mode — primary near-black body text, which
  // would make this control MORE prominent than the neutral copy above it.
  const quietEntry = retPlan === "free";
  const steps = stepsFor(retPlan, elig, native);
  const offer = offerStep(retPlan, elig, native);
  const keep = keepStep(retPlan, elig, source, facts?.proEndsAt ?? null);
  const picked = reasonById(retPlan, reason);

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  async function openModal() {
    setStep("why");
    setReason("");
    setComment("");
    setConfirmText("");
    setPassword("");
    setError("");
    setSaved(null);
    setSavedUntil(null);
    setReady(false);
    setModal(true);
    // Reauthentication is only possible when the account has a password
    // identity — a Google-only account has nothing to re-enter.
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const hasPassword = !!user?.identities?.some((i) => i.provider === "email");
      setNeedsPassword(hasPassword);
    } catch {
      setNeedsPassword(false);
    }
    // Offers and numbers. A failure here is silent on purpose: the sequence
    // still runs, just without offers it can't prove the account qualifies for.
    // Bounded, so a hung request can never hold deletion hostage (5.1.1(v)).
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6000);
    try {
      const res = await fetch("/api/account/retention", { signal: ctrl.signal });
      if (res.ok) {
        const d = await res.json();
        setElig(d.eligibility);
        setSource(d.source ?? null);
        setFacts({ ...d.facts, isOfficeOwner });
      }
    } catch { /* offers stay off */ }
    clearTimeout(timer);
    setReady(true);
  }

  function goNext(from: StepId) {
    const i = steps.indexOf(from);
    const next = steps[i + 1];
    if (next) setStep(next);
  }

  // Step 1 → 2. The reason is the one thing we insist on, and it is recorded
  // immediately: someone who takes an offer at step 3 and stays has still told
  // us why they nearly left, which is the most valuable answer in here.
  function continueFromWhy() {
    if (!ready) return;
    if (!reason) {
      setError("Please pick a reason so we can improve.");
      return;
    }
    setError("");
    goNext("why");
  }

  function continueFromDetail() {
    setError("");
    void fetch("/api/account/retention", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "survey", reason: picked?.label ?? reason, comment }),
    }).catch(() => {});
    goNext("detail");
  }

  async function acceptOffer(action: string) {
    if (loading) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/account/retention", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, reason: picked?.label ?? reason, comment }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Couldn't do that right now. Please try again.");
        setLoading(false);
        return;
      }
      setSavedUntil(typeof data.until === "string" ? data.until : null);
      setSaved(action);
      setLoading(false);
    } catch {
      setError("Couldn't do that right now. Please try again.");
      setLoading(false);
    }
  }

  async function finalizeDelete() {
    if (confirmText.trim().toUpperCase() !== "DELETE" || loading) return;
    setLoading(true);
    setError("");
    try {
      // Reauthenticate first when the account supports it, so a borrowed
      // unlocked session can't delete the account.
      if (needsPassword) {
        if (!password) {
          setError("Enter your password to confirm it's you.");
          setLoading(false);
          return;
        }
        const { error: authErr } = await supabase.auth.signInWithPassword({ email, password });
        if (authErr) {
          setError("That password doesn't match. Please try again.");
          setLoading(false);
          return;
        }
      }
      const res = await fetch("/api/account/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: picked?.label ?? reason, comment }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Couldn't delete the account. Try again.");
        setLoading(false);
        return;
      }
      // The server ended the session; let go of this DEVICE too (push binding,
      // person-scoped state, visitor cookie) — a deleted account's alerts and
      // prefilled share details stayed on the phone (isolation audit
      // 2026-09-24). replace(): Back can't reopen the deleted account's pages.
      await releaseDevice({ serverAlreadySignedOut: true });
      window.location.replace("/account-deleted");
    } catch {
      setError("Couldn't delete the account. Try again.");
      setLoading(false);
    }
  }

  const primaryBtn = "flex-1 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-40 rounded-full py-2.5 transition-colors";
  const ghostBtn = "flex-1 text-sm text-gray-400 hover:text-white border border-gray-700 rounded-full py-2.5 transition-colors";
  const stepLabel = progressLabel(steps, step);

  return (
    <div>
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        aria-expanded={expanded}
        className="w-full flex items-center justify-between text-sm font-semibold text-gray-300 bg-gray-900 hover:bg-gray-800 border border-gray-800 rounded-2xl px-5 py-4 transition-colors"
      >
        <span className="flex items-center gap-2">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-4 h-4 text-gray-500">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.5 20.25a8.25 8.25 0 0115 0" />
          </svg>
          Account ownership and deletion
        </span>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={`w-4 h-4 text-gray-500 transition-transform ${expanded ? "rotate-90" : ""}`}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
      </button>

      {expanded && (
        <div className={`mt-3 bg-gray-900 border rounded-2xl p-5 ${quietEntry ? "border-gray-800" : "border-red-900/40"}`}>
          <p className="text-white text-sm font-semibold">Delete account</p>
          <p className="text-gray-500 text-xs mt-0.5 mb-3 leading-relaxed">
            Permanently deletes your cards and contacts and cancels a subscription billed by SwiftCard (an App Store subscription is cancelled in your Apple subscription settings). Your email can&apos;t be used to sign up again.
          </p>
          {/* Native (App Store 5.1.1 + 3.1.1): the Plan-and-billing section is
              hidden inside the Capacitor shell, so this pointer would be a dead
              anchor referencing subscription management — web only. */}
          {isPro && !native && (
            <p className="text-gray-500 text-[0.6875rem] mb-3 leading-relaxed">
              Just want to stop paying? You can <a href="#billing" className="text-blue-400 hover:text-blue-300 underline">cancel or switch to Free in Plan and billing</a> and keep your account.
            </p>
          )}
          <button
            type="button"
            onClick={openModal}
            className={
              quietEntry
                ? "text-xs text-gray-400 hover:text-white underline underline-offset-2 rounded-sm transition-colors"
                : "text-xs font-semibold text-red-400 hover:text-red-300 border border-red-900/60 hover:border-red-700 rounded-full px-4 py-2 transition-colors"
            }
          >
            Delete account
          </button>
        </div>
      )}

      {/* Modal */}
      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4 pt-[max(1rem,calc(env(safe-area-inset-top)+0.5rem))] pb-[max(1rem,calc(env(safe-area-inset-bottom)+0.5rem))]" style={{ background: "rgba(0,0,0,0.6)" }} onClick={(e) => e.target === e.currentTarget && !loading && setModal(false)}>
          <div className="w-full max-w-sm bg-gray-950 border border-gray-800 rounded-2xl p-5 max-h-[calc(100dvh-env(safe-area-inset-top)-env(safe-area-inset-bottom)-2rem)] overflow-y-auto">
            {/* An accepted offer ends the sequence — nothing left to delete today. */}
            {saved ? (
              <>
                <p className="text-white font-bold text-base mb-2">
                  {saved === "grant" && (savedUntil ? `Pro is on until ${formatGiftEnd(savedUntil)}` : "Pro is on — enjoy it")}
                  {saved === "discount" && "Discount applied"}
                  {saved === "downgrade" && "Pro is cancelled — nothing was deleted"}
                  {saved === "quiet" && "We'll stop emailing you"}
                </p>
                <p className="text-gray-400 text-sm mb-4 leading-relaxed">
                  {saved === "grant" && "Your account is on Pro now, free, and it ends on its own — there's nothing to cancel. Your card, your link and your contacts are exactly where you left them."}
                  {/* Web only (3.1.1): subscribing is a purchase. The checkout
                      bills from the day the gift ends, so saying so is true. */}
                  {saved === "grant" && !native && savedUntil && ` Want to keep Pro after that? Subscribe any time — you won't be charged until ${formatGiftEnd(savedUntil)}.`}
                  {saved === "discount" && "It comes off your next invoices automatically. Nothing else changes — same account, same card, same everything."}
                  {saved === "downgrade" && "You won't be charged again. Pro stays on until the end of the period you've paid for, then you move to Free and choose which card stays live. Every contact you've collected stays here. Changed your mind? Keep Subscription is in Settings → Plan and billing."}
                  {saved === "quiet" && "Every SwiftCard email to you is off. Your card, your link and your contacts are untouched — come back whenever you want."}
                </p>
                <button type="button" onClick={() => setModal(false)} className="w-full text-sm font-semibold text-white bg-gray-800 hover:bg-gray-700 rounded-full py-2.5 transition-colors">
                  Done
                </button>
              </>
            ) : (
              <>
                {/* Held back until the step count is known, so it never changes mid-flow. */}
                <p className="text-gray-600 text-[0.6875rem] font-semibold tracking-wide uppercase mb-2 min-h-[1rem]">{ready ? stepLabel : ""}</p>

                {/* 1 — why */}
                {step === "why" && (
                  <>
                    <p className="text-white font-bold text-base mb-1">Before you go</p>
                    <p className="text-gray-500 text-xs mb-4">
                      {retPlan === "pro"
                        ? "You've been paying for this, so we'd genuinely like to know — what went wrong?"
                        : "Help us improve — why are you deleting your account?"}
                    </p>
                    <div className="space-y-1.5 mb-3">
                      {reasonsFor(retPlan).map((r) => (
                        <label key={r.id} className="flex items-center gap-2.5 text-sm text-gray-300 cursor-pointer">
                          <input type="radio" name="reason" checked={reason === r.id} onChange={() => setReason(r.id)} className="accent-blue-600" />
                          {r.label}
                        </label>
                      ))}
                    </div>
                    {error && <p className="text-red-400 text-xs mt-2">{error}</p>}
                    <div className="flex gap-2 mt-4">
                      <button type="button" onClick={() => setModal(false)} className={ghostBtn}>Cancel</button>
                      <button type="button" onClick={continueFromWhy} disabled={!ready} className={primaryBtn}>{ready ? "Continue" : "One moment…"}</button>
                    </div>
                  </>
                )}

                {/* 2 — the follow-up that changes with the answer */}
                {step === "detail" && (
                  <>
                    <p className="text-white font-bold text-base mb-1">{picked?.followUp ?? "Anything else we should know?"}</p>
                    <p className="text-gray-500 text-xs mb-3">Optional, but it&apos;s the part we actually read.</p>
                    <textarea
                      value={comment}
                      onChange={(e) => setComment(e.target.value)}
                      rows={3}
                      placeholder={picked?.placeholder ?? "Optional"}
                      className="w-full bg-gray-900 border border-gray-700 text-white placeholder-gray-600 rounded-xl px-3 py-2 text-sm resize-none focus:outline-none focus:border-blue-500"
                    />
                    <div className="flex gap-2 mt-4">
                      <button type="button" onClick={() => setStep("why")} className={ghostBtn}>Back</button>
                      <button type="button" onClick={continueFromDetail} className={primaryBtn}>Continue</button>
                    </div>
                  </>
                )}

                {/* 3 — the save that costs nothing */}
                {step === "keep" && (
                  <>
                    <p className="text-white font-bold text-base mb-2">{keep.title}</p>
                    <p className="text-gray-400 text-sm mb-4 leading-relaxed">{keep.body}</p>
                    {error && <p className="text-red-400 text-xs mb-2">{error}</p>}
                    {keep.accept && keep.action && (
                      <button
                        type="button"
                        onClick={() => acceptOffer(keep.action!)}
                        disabled={loading}
                        className="w-full text-sm font-semibold text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-40 rounded-full py-2.5 transition-colors mb-2"
                      >
                        {loading ? "One moment…" : keep.accept}
                      </button>
                    )}
                    <button type="button" onClick={() => goNext("keep")} className="w-full text-xs text-gray-500 hover:text-gray-300 py-1.5 transition-colors">
                      {keep.decline}
                    </button>
                  </>
                )}

                {/* 4 — what deleting actually destroys, in their numbers */}
                {step === "loss" && (
                  <>
                    <p className="text-white font-bold text-base mb-2">Here&apos;s what goes</p>
                    <ul className="text-gray-400 text-sm mb-3 leading-relaxed space-y-2 list-disc pl-4">
                      {lossLines(retPlan, facts ?? { contacts: 0, views: 0, cards: 0, cardUrl: null, since: null, isOfficeOwner }).map((l) => (
                        <li key={l}>{l}</li>
                      ))}
                    </ul>
                    <p className="text-gray-500 text-xs mb-4 leading-relaxed">
                      Everything is held for 30 days first, so you can reopen the account in that window. After that it&apos;s gone for good.
                    </p>
                    {/* Only offered where it actually works: CSV export is a
                        Pro feature, so dangling it in front of a Free account
                        would be a promise that 403s. DownloadLink is what makes
                        it save properly inside the iOS shell too. */}
                    {retPlan === "pro" && facts && facts.contacts > 0 && (
                      <DownloadLink
                        href="/api/leads/export"
                        className="block w-full text-center text-sm font-semibold text-white bg-gray-800 hover:bg-gray-700 rounded-full py-2.5 transition-colors mb-2"
                      >
                        Download my {facts.contacts} contact{facts.contacts === 1 ? "" : "s"} first
                      </DownloadLink>
                    )}
                    <div className="flex gap-2">
                      <button type="button" onClick={() => setModal(false)} className={ghostBtn}>Keep my account</button>
                      <button type="button" onClick={() => goNext("loss")} className="flex-1 text-sm font-semibold text-white bg-red-600 hover:bg-red-500 rounded-full py-2.5 transition-colors">
                        Continue
                      </button>
                    </div>
                  </>
                )}

                {/* 5 — the promotion, last thing before the typed DELETE. Once
                    per person (the server decides); declining is a real button
                    that carries straight on to the confirmation. */}
                {step === "offer" && offer && (
                  <>
                    <div className="rounded-2xl border border-blue-500/30 bg-gradient-to-b from-blue-600/15 to-blue-600/0 p-4 mb-3">
                      {offer.badge && (
                        <span className="inline-block rounded-full bg-blue-600 text-white text-[0.625rem] font-bold uppercase tracking-wider px-2.5 py-1 mb-3">
                          {offer.badge}
                        </span>
                      )}
                      <p className="text-white font-bold text-lg leading-snug text-balance mb-1.5">{offer.title}</p>
                      <p className="text-gray-400 text-sm leading-relaxed">{offer.body}</p>
                      {offer.bullets && offer.bullets.length > 0 && (
                        <ul className="mt-3 space-y-1.5">
                          {offer.bullets.map((b) => (
                            <li key={b} className="flex items-start gap-2 text-sm text-gray-300">
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} aria-hidden="true" className="w-4 h-4 mt-0.5 shrink-0 text-blue-400">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                              </svg>
                              {b}
                            </li>
                          ))}
                        </ul>
                      )}
                      {offer.priceLine && <p className="text-gray-500 text-xs mt-3">{offer.priceLine}</p>}
                    </div>
                    {offer.fineprint && (
                      <p className="text-gray-500 text-xs text-center mb-3 leading-relaxed">
                        {offer.fineprint}
                        {/* Never split the date ("Oct" / "30") across lines. */}
                        {offer.days ? <> <span className="whitespace-nowrap">Ends on its own on {giftEndLabel(offer.days)}.</span></> : null}
                      </p>
                    )}
                    {error && <p className="text-red-400 text-xs mb-2 text-center">{error}</p>}
                    {offer.accept && offer.action && (
                      <button
                        type="button"
                        onClick={() => acceptOffer(offer.action!)}
                        disabled={loading}
                        className="w-full text-sm font-bold text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-40 rounded-full py-3 transition-colors mb-1.5"
                      >
                        {loading ? "One moment…" : offer.accept}
                      </button>
                    )}
                    <button type="button" onClick={() => goNext("offer")} disabled={loading} className="w-full text-xs text-gray-500 hover:text-gray-300 py-2 transition-colors">
                      {offer.decline}
                    </button>
                  </>
                )}

                {/* 6 — the typed confirmation */}
                {step === "confirm" && (
                  <>
                    <p className="text-white font-bold text-base mb-2">Delete account?</p>
                    <div className="text-gray-400 text-sm mb-4 leading-relaxed space-y-2">
                      <p>
                        <span className="text-white font-semibold">Deleted:</span> your account, your cards and their public links, and{" "}
                        <span className="text-white font-semibold">all of your contacts</span>.{" "}
                        {/* We can't cancel what Apple bills. This was the last thing an App
                            Store subscriber read before confirming, and it said the opposite
                            of the step before it — and Apple kept billing them. */}
                        {source === "apple"
                          ? "Your App Store subscription is NOT cancelled by this — turn off auto-renew in your Apple subscription settings, or Apple keeps billing you."
                          : "Any subscription is canceled so you won't be billed again."}
                      </p>
                      <p>
                        <span className="text-white font-semibold">Kept for one month:</span> everything above is held for 30 days so you can reopen your account — after that it&apos;s gone for good and can&apos;t be recovered. Your email can&apos;t be used to sign up again while the account is held.
                      </p>
                      {isOfficeOwner && (
                        <p className="text-amber-300/90">
                          <span className="text-amber-200 font-semibold">You own a team:</span> deleting your account cancels your team&apos;s subscription immediately, and every teammate&apos;s card loses its Office features once your account is gone. Consider removing your team members first, or transferring ownership by contacting support.
                        </p>
                      )}
                    </div>
                    {needsPassword && (
                      <>
                        <label className="block text-xs text-gray-500 mb-1.5">Confirm it&apos;s you — enter your password</label>
                        <input
                          type="password"
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          placeholder="Your password"
                          autoComplete="current-password"
                          className="w-full bg-gray-900 border border-gray-700 text-white placeholder-gray-600 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-red-500 mb-3"
                        />
                      </>
                    )}
                    <label className="block text-xs text-gray-500 mb-1.5">Type DELETE to confirm</label>
                    <input
                      type="text"
                      value={confirmText}
                      onChange={(e) => setConfirmText(e.target.value)}
                      placeholder="DELETE"
                      className="w-full bg-gray-900 border border-gray-700 text-white placeholder-gray-600 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-red-500 mb-3"
                    />
                    {error && <p className="text-red-400 text-xs mb-2">{error}</p>}
                    <div className="flex gap-2">
                      <button type="button" onClick={() => setModal(false)} disabled={loading} className={ghostBtn}>
                        Keep my account
                      </button>
                      <button
                        type="button"
                        onClick={finalizeDelete}
                        disabled={loading || confirmText.trim().toUpperCase() !== "DELETE" || (needsPassword === true && !password)}
                        className="flex-1 text-sm font-semibold text-white bg-red-600 hover:bg-red-500 disabled:opacity-40 rounded-full py-2.5 transition-colors"
                      >
                        {loading ? "Deleting…" : "Delete account"}
                      </button>
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
