"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { triggerSignupNudge } from "@/lib/nudge";
import { getVisitorId, getVisitorInfo, markSharedWith } from "@/lib/visitor";
import { outbox, isQueuedOffline } from "@/lib/offline-outbox";

export default function ConnectButton({
  cardOwner,
  ownerFirstName,
  accent = "#1D4ED8",
  accentText = "#FFFFFF",
}: {
  cardOwner: string;
  ownerFirstName: string;
  /** The page Look's action color — this button is the page's hero action
   *  (lead capture is what a SwiftLink does that a Linktree can't), so it
   *  wears the Look's accent rather than a fixed brand blue. Defaults keep
   *  every non-Looks caller byte-for-byte as before. */
  accent?: string;
  accentText?: string;
}) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", phone: "", email: "", message: "" });
  // SMS opt-in. MUST default to false and MUST NOT gate submission — Twilio
  // A2P review requires the box be unchecked by default and optional.
  // True when we already know who the visitor is (they shared with this owner
  // before) — we collapse the contact fields so they're never asked twice.
  const [knownInfo, setKnownInfo] = useState(false);
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [error, setError] = useState("");
  // No signal: kept on this phone and sent once there is (lib/offline-outbox.ts).
  const [queued, setQueued] = useState(false);

  function openModal() {
    const v = getVisitorInfo();
    setForm({ name: v?.name ?? "", phone: v?.phone ?? "", email: v?.email ?? "", message: "" });
    // Collapse the contact fields whenever we already know this visitor — even
    // if they shared with a DIFFERENT owner before. Once someone has shared
    // their info anywhere, no SwiftLink re-asks for it; they just add a message
    // and send. (hasSharedWith stays imported for back-compat callers.)
    setKnownInfo(!!v);
    setStatus("idle");
    setError("");
    setOpen(true);
  }

  // Whatever way the modal closes — X, backdrop, or Done after sending — the
  // visitor gets the join-for-free invite (the host shows it once per session).
  function closeModal() {
    setOpen(false);
    triggerSignupNudge("share_info");
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim() || !form.phone.trim()) return;
    setStatus("loading");
    setError("");
    setQueued(false);
    try {
      const res = await outbox.fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name.trim(),
          phone: form.phone.trim(),
          email: form.email.trim() || null,
          message: form.message.trim() || null,
          card_owner: cardOwner,
          // Joins this contact to their own card_events — see SaveContactButton.
          visitor_id: getVisitorId(),
          source: "swift_connect",
          // Submitting the share form IS the consent (the disclosure sits right
          // above the Send button) — so every share opts in to text + email.
        }),
      }, { timeoutMs: 20_000 });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message || data.error || "Couldn't send your message. Try again.");
        setStatus("error");
        return;
      }
      markSharedWith(cardOwner, form);
      setStatus("done");
      // Sent successfully → briefly show the confirmation, then auto-surface the
      // "Create your free account" invite (same as the exit path). No extra tap.
      setTimeout(() => closeModal(), 1400);
    } catch (err) {
      if (isQueuedOffline(err)) {
        // It will arrive, so it counts as shared. Left open (no auto-close) so
        // the "no signal" note is actually read; Done closes it.
        markSharedWith(cardOwner, form);
        setQueued(true);
        setStatus("done");
        return;
      }
      setError("Couldn't send your message. Try again.");
      setStatus("error");
    }
  }

  const inputCls =
    "w-full bg-white border border-gray-200 text-gray-900 placeholder-gray-400 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-blue-400";

  return (
    <>
      <button
        type="button"
        onClick={openModal}
        // The page's HERO action, styled like one. Lead capture is what a
        // SwiftLink does that a Linktree can't — hoo.be's pages end in a shop,
        // ours ends in a relationship — so this is taller and bolder than any
        // tile, and it glows in the Look's own accent rather than a generic
        // drop shadow (a fixed dark shadow reads as dirt on the light Looks).
        className="w-full flex items-center justify-center gap-2 py-4 rounded-2xl font-bold text-[0.9375rem] transition-all active:scale-[0.98] hover:brightness-110"
        style={{ background: accent, color: accentText, boxShadow: `0 8px 24px -6px ${accent}59` }}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
          <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.86 9.86 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
        </svg>
        Connect with {ownerFirstName}
      </button>

      {/* Portalled: on a glass/aura Swift Links page this button sits inside a
          backdrop-filter section, which traps a fixed overlay inside it — the
          sheet opened clipped in the middle of the page (2026-09-16 audit). */}
      {open && typeof document !== "undefined" && createPortal(
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center pt-[env(safe-area-inset-top)]" style={{ background: "rgba(0,0,0,0.5)" }} onClick={(e) => e.target === e.currentTarget && closeModal()}>
          <div className="w-full max-w-sm rounded-t-3xl sm:rounded-3xl p-6 max-h-[calc(100dvh-env(safe-area-inset-top))] overflow-y-auto" style={{ background: "#FAF7F2", border: "1px solid #E4DDD4", paddingBottom: "calc(1.5rem + env(safe-area-inset-bottom))" }}>
            {status === "done" ? (
              <div className="text-center py-4">
                <div className="w-12 h-12 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-3">
                  <svg className="w-6 h-6 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <p className="text-slate-900 font-bold text-base">{queued ? "Saved on your phone" : "Info shared!"}</p>
                {queued && (
                  <p className="text-slate-500 text-sm mt-1">
                    No signal right now. Leave this page open and it sends to {ownerFirstName} by itself once you&apos;re back online.
                  </p>
                )}
                <button type="button" onClick={closeModal} className="mt-5 w-full font-semibold py-3 rounded-full text-white text-sm" style={{ background: accent, color: accentText }}>
                  Done
                </button>
              </div>
            ) : (
              <>
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <p className="text-slate-900 font-bold text-base leading-snug">Reach out to {ownerFirstName}</p>
                    <p className="text-slate-500 text-sm mt-1">
                      {knownInfo ? "Just type your message — we've got your details." : "Send your details and a quick message."}
                    </p>
                  </div>
                  <button onClick={closeModal} className="text-slate-400 hover:text-slate-600 text-2xl leading-none ml-3" aria-label="Close">×</button>
                </div>
                <form onSubmit={submit} className="space-y-3">
                  {knownInfo ? (
                    <div className="flex items-center justify-between bg-white border border-gray-200 rounded-xl px-4 py-3">
                      <p className="text-gray-700 text-sm truncate">
                        Sending as <span className="font-semibold text-gray-900">{form.name}</span>
                        <span className="text-gray-400"> · {form.phone}</span>
                      </p>
                      <button type="button" onClick={() => setKnownInfo(false)} className="text-blue-600 text-xs font-semibold shrink-0 ml-3">
                        Edit
                      </button>
                    </div>
                  ) : (
                    <>
                      <input type="text" placeholder="Your name *" required value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} className={inputCls} />
                      <input type="tel" placeholder="Your phone *" required value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} className={inputCls} />
                      <input type="email" placeholder="Your email (optional)" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} className={inputCls} />
                    </>
                  )}
                  <textarea rows={3} placeholder={`Message for ${ownerFirstName}…`} value={form.message} onChange={(e) => setForm((f) => ({ ...f, message: e.target.value }))} className={`${inputCls} resize-none`} />
                  {error && <p className="text-red-500 text-xs">{error}</p>}
                  {/* SMS consent — separate affirmative opt-in (unchecked by
                      default, optional); same block as every capture surface. */}
                  <button type="submit" disabled={status === "loading"} className="w-full font-bold py-3 rounded-full text-white text-sm disabled:opacity-50" style={{ background: accent, color: accentText }}>
                    {status === "loading" ? "Sending…" : "Send message"}
                  </button>
                </form>
              </>
            )}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
