"use client";

// "Share my contact information" on a contact's detail view. Small but
// noticeable: sits beside Call / Save contact. Tapping it opens a four-way
// picker. Every option hands off to the OWNER'S OWN PHONE — nothing is sent
// through SwiftCard's Twilio number or email sender, and nothing is logged.
//
//   • Share by text   — opens Messages addressed to THIS contact with the
//                       message already written; the owner just presses send.
//   • Share by email  — opens Mail addressed to THIS contact with the subject,
//                       the message and the owner's signature already written.
//   • Share by both   — SENT BY US, both channels at once, through the same
//                       Twilio number and Resend sender the automations use
//                       (POST /api/leads/share-card, channel "both").
//
// "Both" is the one option that does NOT hand off to the owner's phone, and it
// cannot be: one tap can open one app. The old version opened Messages and then
// waited for the owner to come back and tap "Now email →", which on iOS meant
// the second half was usually never sent — leaving the owner believing they had
// shared by both when only the text had gone (owner report, 2026-09-09). A
// channel that silently drops half its messages is worse than one that says
// plainly who it is from, so "both" now goes through our own senders and
// reports exactly what was delivered.
//   • Share from my phone — the OS share sheet with the bare card link, for
//                       WhatsApp / AirDrop / anything else. Not pre-addressed:
//                       navigator.share has no recipient field. On a computer
//                       it reads "Copy my card link" and copies it instead.
//
// The owner asked for exactly this (2026-09-08): a share should open the
// contact's thread on his phone, pre-filled, so the message goes from HIS
// number and HIS mailbox. That also side-steps the deliverability problems of
// mail sent on someone's behalf — a message from the owner's own address is
// never "via SwiftCard".
//
// Two things the platform will not allow, so this code does not pretend to:
//   1. A mailto: body is plain text. The Swift Signature IMAGE cannot ride in
//      it, so the email signs off with the same details as text (name, title ·
//      company, phone, email). The recipient gets the card picture the moment
//      they open the link.
//   2. Neither an sms: nor a mailto: hand-off tells us whether the owner sent
//      it, so none of these write to the contact's Activity & Messages thread.
//      Recording an unverified "Sent" is the exact bug the Twilio
//      delivery-status work removed.

import { useEffect, useRef, useState } from "react";
import { detectNativeApp } from "@/lib/platform";
import { shareNatively } from "@/lib/native-share";
import { warmSharePreview } from "@/lib/share-preview";
import { prefersShareSheet } from "@/lib/save-image";

// Pinned to the SwiftCard domain, NOT window.location.origin — same reason
// LoginForm pins it. On a Vercel preview host, origin would hand the recipient
// a *.vercel.app link that 404s once the preview is torn down. The card link
// must be canonical wherever it is shared from.
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://swiftcard.me";

/** The card the contact belongs to — what the messages are signed with. */
export type CardSigner = {
  name: string | null;
  title: string | null;
  company: string | null;
  phone: string | null;
  email: string | null;
  /** True when this card is switched off. A dark card's page 404s and its link
   *  previews as the generic SwiftCard brand image — so it must never be sent. */
  offline?: boolean;
};

type Props = {
  firstName: string;
  /** The contact's own channels — the sms:/mailto: hand-offs are addressed to these. */
  phone: string | null;
  email: string | null;
  /** Card slug the contact belongs to — the link every option hands over. */
  cardOwner: string | null;
  signer: CardSigner | null;
  /** The contact's row id. "Share by both" sends server-side and needs it;
   *  without one that option is unavailable and the hand-offs still work. */
  leadId?: string | null;
  /** Called after a server-side send so the caller can refresh the thread —
   *  "both" writes two real rows into Activity & Messages. */
  onSent?: () => void;
};

type Action = "sms" | "email" | "both" | "phone";

/** "Hi john@acme.com," is worse than "Hi," — greet by nothing rather than noise. */
function greetingName(firstName: string): string {
  const w = (firstName || "").trim();
  return /^[\p{L}'’-]{2,}$/u.test(w) ? w : "";
}

/**
 * The text the owner sends. The link is the LAST line on its own: iMessage
 * renders the rich card preview for a link at the start or end of a message,
 * and drops it for one buried in the middle.
 */
export function shareTextBody(opts: { firstName: string; ownerName: string; cardUrl: string }): string {
  const first = greetingName(opts.firstName);
  return `${first ? `Hi ${first}! ` : ""}${opts.ownerName} here - save my contact information in the link below.\n${opts.cardUrl}`;
}

/** Subject + plain-text body for the mailto: hand-off, signature included. */
export function shareEmail(opts: { firstName: string; signer: CardSigner | null; ownerName: string; cardUrl: string }): { subject: string; body: string } {
  const first = greetingName(opts.firstName);
  const s = opts.signer;
  const signature = [
    opts.ownerName,
    [s?.title, s?.company].filter(Boolean).join(" · "),
    s?.phone,
    s?.email,
  ].filter((v): v is string => !!v && v.trim().length > 0);
  const body = [
    first ? `Hi ${first},` : "Hi,",
    "",
    "Save my contact information in the link below. It opens my digital business card, and you can add me to your phone with one tap.",
    "",
    opts.cardUrl,
    "",
    ...signature,
  ].join("\r\n"); // RFC 6068: line breaks in a mailto: body are %0D%0A
  return { subject: `Contact information from ${opts.ownerName}`, body };
}

/** sms: deep link addressed to one number with the message pre-filled.
 *  `?&body=` is the form both iOS (wants `&`) and Android (wants `?`) accept. */
export function smsHref(phone: string, body: string): string {
  return `sms:${phone.replace(/[^\d+]/g, "")}?&body=${encodeURIComponent(body)}`;
}

export function mailtoHref(email: string, subject: string, body: string): string {
  return `mailto:${encodeURIComponent(email.trim())}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export default function ShareMyInfoButton({ firstName, phone, email, cardOwner, signer, leadId, onSent }: Props) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<"idle" | "copied" | "sending" | "sent" | "partial" | "error">("idle");
  // What to say after a server-side send — "Texted and emailed", or the honest
  // half of it. Never a generic success: the whole point of this rewrite is
  // that the owner is told which channels actually went.
  const [note, setNote] = useState<string>("");
  const wrapRef = useRef<HTMLDivElement>(null);
  // Double-tap guard. `state` cannot do this job: React batches state updates,
  // so two taps in the same tick both read "idle" and both fire. A ref is
  // written synchronously and is already true when the second tap reads it.
  // The server enforces the same thing independently (one share per contact
  // per minute) — this stops the request, that stops the send.
  const sending = useRef(false);

  // Close the picker on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Clear the result badge after it has been read. An error stays longer than
  // a success — it asks something of the owner.
  useEffect(() => {
    if (state !== "sent" && state !== "partial" && state !== "error") return;
    const t = setTimeout(() => { setState("idle"); setNote(""); }, state === "sent" ? 4000 : 8000);
    return () => clearTimeout(t);
  }, [state]);

  const hasPhone = !!phone;
  const hasEmail = !!email;
  // The link carries ?shared=1: the owner pressed Share on a contact they
  // already HAVE, so the card page tells the recipient their info has already
  // been shared instead of asking them to fill the share-back form.
  const cardUrl = cardOwner ? `${APP_URL}/${cardOwner}?shared=1` : null;
  const ownerName = signer?.name?.trim() || "SwiftCard user";

  // ── A dark card must never leave the building ─────────────────────────────
  // The contact belongs to whichever card captured it, and that card may since
  // have been switched off (an office removal does this, and so does the owner).
  // An offline card 404s — "Couldn't find that card" — and its link preview
  // falls back to the generic SwiftCard brand image with no name, headshot or
  // logo. Reported 2026-09-08 as "the preview is missing my headshot"; the
  // preview was fine, the card was off. Sending it costs the owner the
  // introduction, so every path below refuses and says why.
  const isDark = signer?.offline === true;

  // Open the contact's thread in Messages, message already written. Nothing
  // is awaited first: the navigation must ride on the tap itself.
  function openText() {
    if (!phone || !cardUrl || isDark) return;
    warmSharePreview(cardUrl);
    window.location.assign(smsHref(phone, shareTextBody({ firstName, ownerName, cardUrl })));
  }

  // Open a new email to the contact in the owner's mail app — subject, message
  // and signature already written.
  function openEmail() {
    if (!email || !cardUrl || isDark) return;
    warmSharePreview(cardUrl);
    const { subject, body } = shareEmail({ firstName, signer, ownerName, cardUrl });
    window.location.assign(mailtoHref(email, subject, body));
  }

  function shareText() {
    setOpen(false);
    setState("idle");
    openText();
    noteShared();
  }

  function shareEmailNow() {
    setOpen(false);
    setState("idle");
    openEmail();
    noteShared();
  }

  // Handing your card to a real contact counts toward the App Store rating
  // moment (lib/app-review.ts). Records only — the sheet is never shown from a tap.
  function noteShared() {
    if (!isDark) import("@/lib/app-review").then((m) => m.noteReviewMoment("card_shared")).catch(() => {});
  }

  // Send BOTH through our own senders, in one request. No app opens; the
  // contact gets a text and an email from the same infrastructure the
  // automations use, and both are written to Activity & Messages.
  async function shareBoth() {
    if (!leadId || isDark || sending.current) return;
    sending.current = true;
    setOpen(false);
    setState("sending");
    setNote("");
    try {
      const res = await fetch("/api/leads/share-card", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId, channel: "both" }),
      });
      const d = (await res.json().catch(() => ({}))) as {
        ok?: boolean; sent?: string[]; skipped?: string[]; smsDeclined?: boolean;
        sms?: string; email?: string; error?: string; message?: string;
      };
      if (!res.ok || !d.ok) {
        // The server's own wording where it has any — it knows whether this was
        // an opt-out, a missing channel or a provider failure.
        setState("error");
        setNote(d.message || d.error || "Couldn't send. Please try again.");
        return;
      }
      const sent = d.sent ?? [];
      const both = sent.includes("sms") && sent.includes("email");
      onSent?.();
      if (sent.length) noteShared();
      if (both) {
        setState("sent");
        setNote(`Texted and emailed ${firstName}`);
        return;
      }
      // Exactly one went. Say which, and why the other did not — a partial
      // share reported as a success is the failure this feature was built to
      // stop happening.
      const why = (ch: "sms" | "email") =>
        d.smsDeclined && ch === "sms" ? "they haven't opted in to texts"
          : (d.skipped ?? []).includes(ch) ? `no ${ch === "sms" ? "phone number" : "email address"} on file`
          : d[ch] === "opted_out" ? `they opted out of ${ch === "sms" ? "texts" : "emails"}`
          : d[ch] === "not_configured" ? `${ch === "sms" ? "texting" : "email"} isn't switched on`
          : `the ${ch === "sms" ? "text" : "email"} didn't go through`;
      setState("partial");
      setNote(sent.includes("email") ? `Emailed ${firstName} — no text: ${why("sms")}` : `Texted ${firstName} — no email: ${why("email")}`);
    } catch {
      setState("error");
      setNote("Couldn't reach SwiftCard. Check your connection and try again.");
    } finally {
      sending.current = false;
    }
  }

  // Hand the card link to the device's own share sheet. Nothing is sent by us
  // and nothing is logged — the owner picks the app and the recipient, and we
  // never learn whether they went through with it.
  async function sharePhone() {
    setOpen(false);
    if (!cardOwner || isDark) return;
    const url = `${APP_URL}/${cardOwner}?shared=1`;
    warmSharePreview(url);

    // Native shell: WKWebView often lacks navigator.share. Only a missing
    // plugin falls through — closing the sheet used to open the web sheet
    // right after it (lib/native-share.ts).
    if (detectNativeApp()) {
      if ((await shareNatively({ url })) !== "unavailable") return;
    }
    // A phone opens its share sheet; a computer copies — the same rule as the
    // dashboard's Share link (lib/save-image prefersShareSheet), so a Mac or
    // Windows share panel never appears under a label that promises a copy.
    if (prefersShareSheet() && typeof navigator !== "undefined" && navigator.share) {
      // Bare URL only — iMessage and most messengers render the rich card
      // preview only when the message is just the link.
      try { await navigator.share({ url }); } catch { /* cancelled */ }
      return;
    }
    // Computer: put the link on the clipboard.
    try {
      await navigator.clipboard.writeText(url);
      setState("copied");
      setTimeout(() => setState("idle"), 2500);
    } catch {
      window.prompt("Copy your card link:", url);
    }
  }

  // One reason, shown on every option, so the owner learns the cause once
  // instead of finding four separately-broken buttons.
  const darkHint = "This card is turned off — bring it back online in Settings → My Cards";
  // The fourth option says what it will do ON THIS DEVICE (owner, 2026-10-07):
  // "Share from my phone · Opens your phone's share sheet" on a computer was
  // a promise of a sheet that then silently copied the link. Read only while
  // the menu is open — always after hydration — so server and client agree.
  const onComputer = open && !prefersShareSheet();
  const OPTIONS: { action: Action; label: string; enabled: boolean; hint: string }[] = [
    { action: "email", label: "Share by email", enabled: !isDark && hasEmail && !!cardUrl, hint: isDark ? darkHint : hasEmail ? `Opens an email to ${firstName}, ready to send` : "No email on this contact" },
    { action: "sms", label: "Share by text", enabled: !isDark && hasPhone && !!cardUrl, hint: isDark ? darkHint : hasPhone ? `Opens a text to ${firstName}, ready to send` : "No phone on this contact" },
    // Sent by SwiftCard, not handed to an app — so the hint says so plainly.
    // The owner should never be surprised about which number a text came from.
    { action: "both", label: "Share by both", enabled: !isDark && hasPhone && hasEmail && !!cardUrl && !!leadId && state !== "sending", hint: isDark ? darkHint : !leadId ? "Open this contact to share by both" : hasPhone && hasEmail ? "Texts and emails them now, from SwiftCard" : "Needs both a phone and an email" },
    // Enabled regardless of what channels the CONTACT has — this shares from
    // the owner's own phone, so it only needs a card link to hand over.
    { action: "phone", label: onComputer ? "Copy my card link" : "Share from my phone", enabled: !isDark && !!cardOwner, hint: isDark ? darkHint : !cardOwner ? "No card linked to this contact" : onComputer ? "Copies your card link to paste into an email or message" : "Opens your phone's share sheet" },
  ];

  const run = (action: Action) => {
    if (isDark) return;
    if (action === "sms") shareText();
    else if (action === "email") shareEmailNow();
    else if (action === "both") void shareBoth();
    else sharePhone();
  };

  return (
    <div ref={wrapRef} className="relative shrink-0">
      <button
        type="button"
        // Disabled while a send is in flight — the ref above is what actually
        // prevents a second send; this is what tells the owner why.
        disabled={state === "sending"}
        onClick={() => state === "idle" && setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-busy={state === "sending"}
        title={note || `Share your contact information with ${firstName}`}
        className={`flex items-center justify-center gap-1.5 text-sm font-semibold py-2.5 px-4 rounded-xl transition-colors ${
          state === "copied" || state === "sent"
            ? "bg-emerald-600/20 border border-emerald-600/50 text-emerald-300"
            : state === "partial"
            ? "bg-amber-600/20 border border-amber-600/50 text-amber-300"
            : state === "error"
            ? "bg-red-600/20 border border-red-600/50 text-red-300"
            : "bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-70"
        }`}
      >
        {state === "copied" ? (
          <>Link copied!</>
        ) : state === "sending" ? (
          <>Sending…</>
        ) : state === "sent" ? (
          <>Sent ✓</>
        ) : state === "partial" ? (
          <>Partly sent</>
        ) : state === "error" ? (
          <>Didn&apos;t send</>
        ) : (
          <>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v13M8 7l4-4 4 4M5 13v6a2 2 0 002 2h10a2 2 0 002-2v-6" />
            </svg>
            Share
          </>
        )}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-2 z-30 w-56 rounded-xl border border-gray-700 bg-gray-900 shadow-2xl overflow-hidden"
        >
          <p className="px-3.5 pt-3 pb-2 text-[0.625rem] font-bold text-gray-500 uppercase tracking-widest border-b border-gray-800">
            Share my contact info
          </p>
          {OPTIONS.map((o) => (
            <button
              key={o.action}
              role="menuitem"
              type="button"
              disabled={!o.enabled}
              onClick={() => run(o.action)}
              // The phone option is separated: the three above are addressed
              // to this contact, this one lets the owner pick any app.
              className={`w-full text-left px-3.5 py-2.5 hover:bg-gray-800 disabled:hover:bg-transparent disabled:cursor-not-allowed transition-colors ${
                o.action === "phone" ? "border-t border-gray-800" : ""
              }`}
            >
              <span className={`block text-[0.8125rem] font-semibold ${o.enabled ? "text-gray-100" : "text-gray-600"}`}>{o.label}</span>
              <span className={`block text-[0.6875rem] ${o.enabled ? "text-gray-500" : "text-gray-700"}`}>{o.hint}</span>
            </button>
          ))}
        </div>
      )}

      {/* The outcome in words. The button face has room for two ("Partly
          sent"), and "partly" without "which part" is not an answer — this is
          where the owner reads what actually reached the contact. aria-live so
          a screen reader announces it: the send is asynchronous, so there is no
          focus change to carry the news. */}
      <p
        role="status"
        aria-live="polite"
        className={`absolute right-0 top-full mt-1.5 z-20 w-64 text-right text-[0.6875rem] leading-snug ${
          note ? "" : "sr-only"
        } ${state === "error" ? "text-red-300" : state === "partial" ? "text-amber-300" : "text-emerald-300"}`}
      >
        {note}
      </p>
    </div>
  );
}
