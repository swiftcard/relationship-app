"use client";

import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { nudgeCopy } from "@/lib/referral";
import { useIsNativeApp } from "@/lib/platform";
import { getVisitorInfo } from "@/lib/visitor";
import SwiftLinksPromoSheet from "@/components/SwiftLinksPromoSheet";

// Does the visitor already have a SwiftCard account? The "create your free
// card" nudge must never show to an existing customer (owner request). The
// endpoint answers yes when the caller is signed in OR the email they shared
// is tied to an account. Fails OPEN (shows the nudge) so a network hiccup
// never suppresses a genuine new-visitor signup.
//
// Cached IN MEMORY with a short TTL — deliberately NOT sessionStorage. The
// persisted "1" survived sign-out for the rest of the tab session (the
// sign-out cleanup exempts device-preference keys), so a device someone had
// merely been signed in on kept reading "existing customer" and the nudge
// never appeared for the anonymous visitor now holding it.
let acctCache: { exists: boolean; at: number } | null = null;
const ACCT_CACHE_TTL_MS = 5 * 60 * 1000;

async function visitorHasAccount(): Promise<boolean> {
  if (acctCache && Date.now() - acctCache.at < ACCT_CACHE_TTL_MS) return acctCache.exists;
  try {
    const email = getVisitorInfo()?.email || "";
    const r = await fetch("/api/account-exists", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const d = await r.json();
    const exists = !!d?.exists;
    acctCache = { exists, at: Date.now() };
    return exists;
  } catch {
    return false; // fail open
  }
}

// ── Nudge frequency: each moment invites ONCE, ever ─────────────────────────
//
// Owner order 2026-09-02 (supersedes the 2026-08-25 "bulletproof, every time"
// rule): the first time a visitor ever hits a moment — pressing Connect
// (share), saving a contact / arriving by QR and saving (save), or tapping a
// link (incidental) — the invite shows. After that it never comes back, on
// any card, in any session: the flags live in localStorage, per browser.
//
// One flag PER CLASS, not one global flag, deliberately: a visitor who tapped
// a link yesterday (and spent the incidental invite) must still get the
// invite at the save moment — the one that actually converts. Each class
// spends only its own.
//
// Flags are written only when a popup actually RENDERS — writing them up
// front meant a slow account-check or a navigation ate the invite with
// nothing shown.
const NUDGE_CLASS: Record<string, string> = {
  vcard: "save",
  save_contact: "save",
  save_contact_cta: "save",
  share_info: "share",
};
const nudgeClassOf = (src: string) => NUDGE_CLASS[src] ?? "link";
const slotKey = (cls: string) => `sc_nudged_ever:${cls}`;

// EXCEPT the save moment, which now invites EVERY time (owner, 2026-10-05:
// the Save Contact / QR-scan popups "need to work every single time"). Once
// ever meant a second save — on this card or any other — ended at "Share your
// info" with no invite, which read as the popup being broken. Incidental link
// taps and share-info keep their once-ever flag.
const EVERY_TIME_CLASSES = new Set(["save"]);

// The conversion funnel's denominator: without impression/click events the
// popup's absence was invisible in data — there was literally no number that
// could reveal it wasn't showing. Attributed to the card that hosted the
// moment. Best-effort; must never affect whether the popup shows.
function trackNudge(cardUsername: string | undefined, eventType: string, source: string): void {
  if (!cardUsername) return;
  fetch("/api/analytics/event", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: cardUsername, event_type: eventType, event_data: { source } }),
  }).catch(() => {});
}

// The hero: a REAL SwiftCard, tilted and floating on the Swift Links indigo
// gradient (same visual family as the links promo sheet) — the popup SHOWS the
// product (the Blinq loop: you just used a card this smooth, here's yours).
//
// It used to be a hand-drawn stand-in ("YOU", "Your Name", grey bars). Owner,
// 2026-09-23: "make the design example card on that pop-up much nicer and more
// realistic" — so it is the real Portrait Pro template with a designed persona
// (components/SignupCardExample), loaded lazily and warmed while the page is
// idle, so it is ready long before anyone triggers the invite. Until it has
// loaded, a card-shaped glass slot holds the space: the popup never jumps.
const SignupCardExample = lazy(() => import("@/components/SignupCardExample"));

/** The card's width; a SwiftCard is 1.75:1. Capped on the narrowest phones. */
const EXAMPLE_W = 244;

function HeroCardMockup() {
  return (
    // pt-14 keeps the tilted card clear of the ✕ (which ends 48px down) at
    // every width; px-9 keeps it inside the panel on a 320px phone.
    <div className="relative flex justify-center pt-14 pb-8 px-9" aria-hidden="true">
      {/* Color bloom the card floats on */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-72 h-36 rounded-full bg-gradient-to-r from-sky-400/30 via-fuchsia-400/30 to-amber-300/20 blur-3xl" />

      {/* Sparkles */}
      <svg viewBox="0 0 24 24" className="absolute left-[9%] top-6 w-3.5 h-3.5 text-sky-300 sc-twinkle"><path fill="currentColor" d="M12 0l2.4 9.6L24 12l-9.6 2.4L12 24l-2.4-9.6L0 12l9.6-2.4z"/></svg>
      <svg viewBox="0 0 24 24" className="absolute right-[8%] bottom-7 w-2.5 h-2.5 text-fuchsia-300 sc-twinkle" style={{ animationDelay: "0.7s" }}><path fill="currentColor" d="M12 0l2.4 9.6L24 12l-9.6 2.4L12 24l-2.4-9.6L0 12l9.6-2.4z"/></svg>

      {/* The card */}
      <div className="sc-float relative" style={{ width: EXAMPLE_W, maxWidth: "100%" }}>
        {/* a second card behind it, for depth */}
        <div className="absolute inset-0 translate-x-2.5 translate-y-2 rotate-[5deg] rounded-[14px] bg-white/10 ring-1 ring-white/10" />
        <div
          className="relative rounded-[14px] overflow-hidden ring-1 ring-white/25"
          style={{ boxShadow: "0 26px 50px -14px rgba(8,8,20,0.75), 0 8px 18px -6px rgba(8,8,20,0.35)" }}
        >
          {/* shine sweep */}
          <div className="sc-shine pointer-events-none absolute inset-0 z-10" />
          <Suspense fallback={<div className="w-full bg-white/10" style={{ aspectRatio: "1.75 / 1", minHeight: 1 }} />}>
            <SignupCardExample />
          </Suspense>
        </div>
      </div>
    </div>
  );
}

// Mounted once on public pages. Listens for `triggerSignupNudge(source)`
// events and shows a friendly signup popup — once per source CLASS per
// session (vcard/save, share-info, incidental link taps), at most two per
// session — never blocking the action that triggered it. Deliberately does
// NOT gate on whether a SwiftCard session cookie is present — that check used
// to suppress the popup for anyone with a stale/leftover cookie (including
// the site owner testing their own card); the server-side account check in
// visitorHasAccount is the one gate, and only a rendered popup spends a slot.
//
// Design: a hero moment, not a banner — glowing product mockup up top, bold
// centered headline, gradient CTA with a shine sweep, trust row underneath.
// variant "links" — a Swift Links page. Every invite there is the SAME sheet the
// page's corner badge opens (components/SwiftLinksPromoSheet; owner,
// 2026-09-23: "the exact same pop-up as what's in the icon on the top left").
// The when-to-show rules below are unchanged; only what is shown differs.
export default function SignupNudgeHost({
  cardUsername,
  variant = "card",
}: { cardUsername?: string; variant?: "card" | "links" } = {}) {
  const [source, setSource] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Serializes overlapping nudges across the account-check await — without it
  // two triggers in quick succession could both pass the guards and both
  // count/track, since the slot is only written at render time now.
  const deciding = useRef(false);
  // Is a popup on screen right now? With the save moment unrationed, a second
  // trigger for the same save (a backdrop tap during "Info shared!", then its
  // timer) must not re-open it or count a second impression.
  const open = useRef(false);
  const native = useIsNativeApp();

  // Warm the example card while the page is idle, so the invite never opens
  // on an empty slot. A Swift Links page never shows it, so never loads it.
  useEffect(() => {
    if (variant !== "card" || native) return;
    const warm = () => { void import("@/components/SignupCardExample"); };
    const w = window as Window & { requestIdleCallback?: (cb: () => void) => number };
    if (w.requestIdleCallback) { w.requestIdleCallback(warm); return; }
    const t = setTimeout(warm, 1500);
    return () => clearTimeout(t);
  }, [variant, native]);

  useEffect(() => {
    async function onNudge(e: Event) {
      const src = (e as CustomEvent).detail?.source ?? "default";
      if (deciding.current || open.current) return;
      deciding.current = true;
      try {
        const cls = nudgeClassOf(src);
        const key = slotKey(cls);
        const onceEver = !EVERY_TIME_CLASSES.has(cls);
        // Once EVER per class per browser (owner order 2026-09-02) — save
        // excepted, above. Fails open on blocked storage — a private-mode
        // visitor still gets the invite, it just can't be remembered.
        try {
          if (onceEver && localStorage.getItem(key)) return;
        } catch { /* private mode — show anyway */ }
        // Existing SwiftCard customers are never nudged to create a card —
        // they already have one. Checked BEFORE the flag is spent, so a slow
        // or failed check can no longer eat the invite invisibly.
        if (await visitorHasAccount()) return;
        // The popup is actually going to render — spend this class's
        // lifetime invite.
        if (onceEver) {
          try { localStorage.setItem(key, "1"); } catch { /* private mode */ }
        }
        open.current = true;
        trackNudge(cardUsername, "nudge_impression", src);
        // A newer nudge can arrive while an older one's dismiss-fade is still
        // scheduled — cancel that stale timer so it can't clear the new popup.
        if (dismissTimer.current) {
          clearTimeout(dismissTimer.current);
          dismissTimer.current = null;
        }
        setClosing(false);
        setSource(src);
      } finally {
        deciding.current = false;
      }
    }
    window.addEventListener("sc:nudge", onNudge as EventListener);
    return () => {
      window.removeEventListener("sc:nudge", onNudge as EventListener);
      if (dismissTimer.current) clearTimeout(dismissTimer.current);
    };
  }, [cardUsername]);

  // Native app: never show the public-page "create your free card" signup nudge,
  // regardless of login state.
  if (!source || native) return null;
  const copy = nudgeCopy(source);
  const ctaHref = `/cards/new?src=${encodeURIComponent(source)}`;

  if (variant === "links") {
    return (
      <SwiftLinksPromoSheet
        onClose={() => { open.current = false; setSource(null); }}
        ctaHref={ctaHref}
        onCta={() => trackNudge(cardUsername, "nudge_cta_click", source)}
        exploreHref={`/?src=${encodeURIComponent(source)}`}
      />
    );
  }

  function dismiss() {
    open.current = false;
    setClosing(true);
    dismissTimer.current = setTimeout(() => setSource(null), 220);
  }

  return createPortal(
    /* PORTALED to <body>: transformed scroll-reveal ancestors on the card
       pages otherwise cage this fixed overlay to their own box, which parked
       the popup at the bottom of the DOCUMENT on desktop — visitors had to
       scroll to even see it (owner bug report, 2026-08-25). Bottom-anchored
       card on phones; centered dialog with a dimmed backdrop on md+, where a
       toast at the screen's foot reads as ignorable rather than an invite. */
    <div
      className="fixed inset-x-0 bottom-0 md:inset-0 z-[80] flex items-end md:items-center justify-center px-4 pb-[max(16px,env(safe-area-inset-bottom))] md:pb-4 pointer-events-none md:pointer-events-auto md:bg-black/40"
      role="dialog"
      aria-label="Create your own SwiftCard"
      onClick={(e) => { if (e.target === e.currentTarget) dismiss(); }}
    >
      <div
        className={`pointer-events-auto w-full max-w-sm rounded-[28px] overflow-hidden bg-white ${closing ? "sc-nudge-out" : "sc-nudge-in"}`}
        style={{
          border: "1px solid rgba(148,163,184,0.25)",
          boxShadow: "0 30px 70px -12px rgba(15,23,42,0.4), 0 6px 20px rgba(15,23,42,0.1)",
        }}
      >
        {/* The Swift Links indigo gradient behind the hero — the same family
            as the links promo sheet, so the product's invites read as one
            brand. */}
        <div
          className="relative overflow-hidden"
          style={{ background: "linear-gradient(160deg, #181538 0%, #2A2466 55%, #4338ca 100%)" }}
        >
          <button
            onClick={dismiss}
            aria-label="Dismiss"
            className="absolute top-3 right-3 z-20 w-9 h-9 flex items-center justify-center rounded-full bg-white/15 backdrop-blur text-white/80 hover:text-white hover:bg-white/25 transition-colors"
          >
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4"><path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" /></svg>
          </button>
          <HeroCardMockup />
        </div>

        <div className="px-6 pt-4 pb-5 text-center">
          {/* text-balance: no headline ends on one orphaned word ("…could be / you"). */}
          <p className="text-slate-900 text-[1.3125rem] font-extrabold leading-tight tracking-tight text-balance">{copy.title}</p>
          <p className="text-slate-500 text-[0.84375rem] mt-1.5 leading-snug max-w-[300px] mx-auto">{copy.sub}</p>

          <a
            href={ctaHref}
            // No wipe on click: same as "Get started free" in the site header.
            // The builder asks "Continue your card / Start a new card" itself
            // when an unfinished card exists (owner rule 2026-09-16).
            onClick={() => trackNudge(cardUsername, "nudge_cta_click", source)}
            className="relative overflow-hidden mt-4 flex items-center justify-center gap-1.5 w-full py-3.5 rounded-full text-[0.9375rem] font-bold text-white bg-gradient-to-r from-blue-700 to-sky-500 transition-all active:scale-[0.98] hover:brightness-110"
            style={{ boxShadow: "0 10px 26px -6px rgba(37,99,235,0.55)" }}
          >
            <span className="sc-shine pointer-events-none absolute inset-0" />
            {copy.cta}
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4"><path fillRule="evenodd" d="M3 10a.75.75 0 01.75-.75h10.638L10.23 5.29a.75.75 0 111.04-1.08l5.5 5.25a.75.75 0 010 1.08l-5.5 5.25a.75.75 0 11-1.04-1.08l4.158-3.96H3.75A.75.75 0 013 10z" clipRule="evenodd" /></svg>
          </a>

          {/* Trust row — answers the hesitation at the exact moment it happens.
              flex-wrap + gap (no literal dot separators) so it wraps cleanly to
              two centered lines on narrow phones instead of clipping. */}
          <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 mt-2.5 text-[0.6875rem] text-slate-400">
            <span className="flex items-center gap-1 whitespace-nowrap">
              <svg viewBox="0 0 20 20" fill="#16a34a" className="w-3 h-3 shrink-0"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clipRule="evenodd"/></svg>
              100% free to start
            </span>
            <span className="whitespace-nowrap">No credit card</span>
            <span className="whitespace-nowrap">Live in 60 seconds</span>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes sc-nudge-in {
          0%   { transform: translateY(110%); opacity: 0; }
          60%  { transform: translateY(-8px); opacity: 1; }
          100% { transform: translateY(0); opacity: 1; }
        }
        @keyframes sc-nudge-out {
          from { transform: translateY(0); opacity: 1; }
          to   { transform: translateY(30px); opacity: 0; }
        }
        .sc-nudge-in  { animation: sc-nudge-in 0.5s cubic-bezier(0.22, 1, 0.36, 1); }
        .sc-nudge-out { animation: sc-nudge-out 0.22s ease-in forwards; }

        @keyframes sc-float {
          0%, 100% { transform: translateY(0) rotate(-3deg); }
          50%      { transform: translateY(-5px) rotate(-3deg); }
        }
        .sc-float { animation: sc-float 3.2s ease-in-out infinite; }

        @keyframes sc-shine {
          0%, 55% { transform: translateX(-130%) skewX(-18deg); }
          85%, 100% { transform: translateX(230%) skewX(-18deg); }
        }
        .sc-shine {
          background: linear-gradient(105deg, transparent 38%, rgba(255,255,255,0.5) 50%, transparent 62%);
          width: 60%;
          animation: sc-shine 3.4s ease-in-out infinite;
        }

        @keyframes sc-twinkle {
          0%, 100% { opacity: 0.25; transform: scale(0.8); }
          50%      { opacity: 1; transform: scale(1.15); }
        }
        .sc-twinkle { animation: sc-twinkle 2.2s ease-in-out infinite; }

        @media (prefers-reduced-motion: reduce) {
          .sc-nudge-in, .sc-nudge-out, .sc-float, .sc-shine, .sc-twinkle { animation: none; }
        }
      `}</style>
    </div>,
    document.body,
  );
}
