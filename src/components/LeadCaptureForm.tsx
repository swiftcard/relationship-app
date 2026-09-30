"use client";

import { useEffect, useState } from "react";
import { getVisitorId, getVisitorInfo, hasSharedWith, markSharedWith } from "@/lib/visitor";
import { triggerSignupNudgeWhenVisible } from "@/lib/nudge";

type Status = "idle" | "loading" | "done" | "error" | "offline";

export default function LeadCaptureForm({
  cardOwner,
  source = "direct_link",
}: {
  cardOwner: string;
  source?: string;
}) {
  const [status, setStatus] = useState<Status>("idle");
  const [alreadyShared, setAlreadyShared] = useState(false);
  const [form, setForm] = useState({ name: "", phone: "", email: "", message: "" });
  // Which required box is empty. Pressing "Share My Info" with a blank name or
  // phone used to `return` silently, so the button simply did nothing — with
  // no message, no outline and no focus move, on the one form whose whole job
  // is to capture a stranger mid-handshake.
  const [missing, setMissing] = useState<"name" | "phone" | null>(null);
  // SMS opt-in. MUST default to false and MUST NOT gate submission — Twilio
  // A2P review requires the box be unchecked by default and optional.

  // If this visitor shared with this owner before, don't ask again — and
  // pre-fill their details in case they use another form on the page.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time hydration read from localStorage
    setAlreadyShared(hasSharedWith(cardOwner));
    const v = getVisitorInfo();
    if (v) setForm((prev) => ({ ...prev, name: v.name, phone: v.phone, email: v.email }));
  }, [cardOwner]);

  function handleChange(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) {
      setMissing("name");
      document.getElementById("sc-lead-name")?.focus();
      return;
    }
    if (!form.phone.trim()) {
      setMissing("phone");
      document.getElementById("sc-lead-phone")?.focus();
      return;
    }
    setMissing(null);
    setStatus("loading");

    let res: Response;
    try {
      res = await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          card_owner: cardOwner,
          source,
          visitor_id: getVisitorId(),
        }),
      });
    } catch {
      setStatus("offline");
      return;
    }

    // NOTE: there is deliberately no cap branch here. /api/leads never rejects
    // a share — a Free owner over their monthly limit still has the contact
    // captured and stored, just flagged locked until they upgrade (see
    // api/leads/route.ts). This used to read `if (res.status === 402)` and paint
    // "Card at capacity — this person's card is full. Ask them to upgrade to
    // SwiftCard Pro." at a visitor who was mid-handshake: it leaked the owner's
    // plan to their own warm lead and blamed them for it. The endpoint has never
    // returned 402, so it was also unreachable.
    if (res.ok) {
      // Remember the share so nothing on this owner's pages asks again.
      markSharedWith(cardOwner, form);
      setStatus("done");
      // Same signup popup as every other "shared their info" moment on the card.
      // Visibility-aware: if the page is backgrounded (keyboard dismiss/app
      // switch), the nudge waits for the visitor to come back instead of
      // spending its slot on a page nobody is looking at.
      triggerSignupNudgeWhenVisible("share_info", 900);
    } else {
      setStatus("error");
    }
  }

  if (status === "done") {
    return (
      <div className="text-center py-3">
        <div className="w-12 h-12 rounded-full bg-green-50 border border-green-100 flex items-center justify-center mx-auto mb-3">
          <svg className="w-6 h-6 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <p className="text-slate-900 font-bold text-base">Info shared!</p>
      </div>
    );
  }

  // They already shared with this owner — never ask for their info twice.
  if (alreadyShared) {
    return (
      <div className="text-center py-2">
        <p className="text-slate-900 font-semibold text-sm">✓ You&apos;ve already shared your info</p>
        <p className="text-slate-500 text-xs mt-1">They have your details — no need to send them again.</p>
      </div>
    );
  }

  return (
    // method="post": before React hydrates there is no submit handler, so the
    // HTML default runs — and without a method that default is GET, which would
    // put a visitor's name, phone and email into the URL, their history and the
    // access log. Same rule the sign-in form follows for passwords.
    <form onSubmit={handleSubmit} method="post" className="w-full space-y-3">
      {/* The placeholders were the only labels these boxes had, and a
          placeholder disappears the moment someone types. */}
      <div>
        <label htmlFor="sc-lead-name" className="sr-only">Your name (required)</label>
        <input
          id="sc-lead-name"
          type="text"
          name="name"
          required
          autoComplete="name"
          aria-invalid={missing === "name" || undefined}
          aria-describedby={missing === "name" ? "sc-lead-name-err" : undefined}
          placeholder="Your name *"
          value={form.name}
          onChange={handleChange}
          className={`w-full bg-white border text-gray-900 placeholder-gray-400 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-blue-400 transition-colors shadow-sm ${missing === "name" ? "border-red-400" : "border-gray-200"}`}
        />
        {missing === "name" && (
          <p id="sc-lead-name-err" role="alert" className="text-red-500 text-xs mt-1.5 px-1">Add your name so they know who shared.</p>
        )}
      </div>
      <div>
        <label htmlFor="sc-lead-phone" className="sr-only">Your phone number (required)</label>
        <input
          id="sc-lead-phone"
          type="tel"
          name="phone"
          required
          autoComplete="tel"
          aria-invalid={missing === "phone" || undefined}
          aria-describedby={missing === "phone" ? "sc-lead-phone-err" : undefined}
          placeholder="Your phone number *"
          value={form.phone}
          onChange={handleChange}
          className={`w-full bg-white border text-gray-900 placeholder-gray-400 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-blue-400 transition-colors shadow-sm ${missing === "phone" ? "border-red-400" : "border-gray-200"}`}
        />
        {missing === "phone" && (
          <p id="sc-lead-phone-err" role="alert" className="text-red-500 text-xs mt-1.5 px-1">Add a phone number so they can reach you.</p>
        )}
      </div>
      <div>
        <label htmlFor="sc-lead-email" className="sr-only">Your email (optional)</label>
        <input
          id="sc-lead-email"
          type="email"
          name="email"
          autoComplete="email"
          placeholder="Your email (optional)"
          value={form.email}
          onChange={handleChange}
          className="w-full bg-white border text-gray-900 placeholder-gray-400 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-blue-400 transition-colors shadow-sm border-gray-200"
        />
      </div>
      <div>
        <label htmlFor="sc-lead-message" className="sr-only">Quick message (optional)</label>
        <textarea
          id="sc-lead-message"
          name="message"
          placeholder="Quick message (optional)"
          value={form.message}
          onChange={handleChange}
          rows={2}
          className="w-full bg-white border text-gray-900 placeholder-gray-400 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-blue-400 transition-colors shadow-sm border-gray-200 resize-none"
        />
      </div>
      {(status === "error" || status === "offline") && (
        <p role="alert" className="text-red-500 text-xs text-center">
          {status === "offline"
            ? "Couldn't send — check your connection and try again."
            : "Something went wrong. Please try again."}
        </p>
      )}
      {/* NO SMS consent box here any more (owner, 2026-09-20): "All you're
          asking the person to do is share their information back with the user,
          rather than the user just typing it in themselves." This form hands
          over contact details; it does not enrol anyone in text messages, and
          it never claimed to. Nothing it posts can grant SMS consent — the
          public leads endpoint ignores a consent flag entirely, and an
          automated text still requires the SwiftCard user to confirm, in the
          app, that they have permission to text that contact (the sms-ok flag,
          set only from an authenticated request). Email consent is still by
          submission, and every email carries an unsubscribe link. */}
      <button
        type="submit"
        disabled={status === "loading"}
        className="w-full hover:opacity-90 disabled:opacity-50 text-white font-semibold py-3 px-6 rounded-full transition-all text-sm active:scale-[0.98]"
        style={{ background: "var(--sc-accent, #1D4ED8)" }}
      >
        {status === "loading" ? "Sending…" : "Share My Info"}
      </button>
    </form>
  );
}
