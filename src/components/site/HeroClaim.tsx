"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { SwiftCardIcon } from "@/components/SwiftCardLogo";

// ── The homepage hero claim box ──────────────────────────────────────────────
//
// Owner request 2026-08-19, modeled on link.me's hero: a white pill holding
// the brand mark, an inline first-name input, and an attached "Start for
// free" button. Enter or the button routes into the card builder with the
// typed name pre-filled (?name=…), so the visitor's first act of typing is
// already the first field of their card — the CTA IS the product.
//
// Empty submits still go to the builder: an empty box must never be a wall
// between a willing visitor and the wizard.

export default function HeroClaim() {
  const router = useRouter();
  const [name, setName] = useState("");

  function go(e: React.FormEvent) {
    e.preventDefault();
    const v = name.trim().slice(0, 80);
    router.push(v ? `/cards/new?name=${encodeURIComponent(v)}&src=hero_claim` : "/cards/new?src=hero_claim");
  }

  // Reads as the URL they are claiming: "SwiftCard.me/" in solid dark ink
  // (never faded), the typed name completing it; the placeholder "full name"
  // sits in light gray until they type (owner spec 2026-08-19). Sized up to a
  // comfortable hero weight.
  return (
    <form
      onSubmit={go}
      // Works before hydration too (AGENTS.md: everything is interactive
      // before it is hydrated). With no handler yet, a submit takes the HTML
      // default; without an action that was a reload of "/?" and the typed
      // name was lost (2026-10-19 audit). Same URL the handler builds.
      action="/cards/new"
      method="get"
      // Ask the floating chat launcher to get off this row. On a short viewport
      // the launcher lands exactly on "Start for free" — 36.7% of it on an
      // iPhone 13 Mini — and a tap there opened support chat instead of
      // starting a signup. See lib/chat-avoid.ts.
      data-chat-avoid=""
      // Phone spacing is measured, not eyeballed. On a 390px phone the pill is
      // 350 wide and every pixel of it is spoken for: 14 padding + 112 for
      // "SwiftCard.me/" + the field + 8 gap + 124 button + 6 padding. That left
      // the field at 86px while "Alex Morgan" needs 97, so the name scrolled
      // and the URL read "SwiftCard.me/lex Morgan" — the start of someone's own
      // name cut off, in the one element whose entire job is to show it.
      // Trimming the padding, the gap and the button's own padding below sm
      // returns 14px and the field reaches 100. Desktop keeps its roomier
      // spacing untouched.
      className="sc-claim relative overflow-hidden flex items-center gap-1.5 sm:gap-3 rounded-full pl-3 sm:pl-5 pr-1 sm:pr-2.5 py-2 sm:py-2.5 w-full sm:w-auto"
      style={{
        // A whisper of a vertical gradient instead of flat white: it gives the
        // glare sweep something to read against, and the pill a hint of glass.
        // The shadow and the focus ring live in globals.css (.sc-claim) — an
        // inline box-shadow cannot answer :focus-within.
        background: "linear-gradient(180deg, #FFFFFF 0%, #F7F9FC 100%)",
      }}
    >
      {/* The mark is desktop-only. On a phone it sits 8px from the words
          "SwiftCard.me/" and says the same thing twice, while costing 34px of
          the one field the pill exists to collect — which, once both halves of
          the URL went to 16px for the touch floor above, had been squeezed to
          64px, narrow enough that "Alex Morgan" scrolled inside it. Dropping
          the duplicate gives the name room to actually be read. */}
      <span className="hidden sm:flex shrink-0"><SwiftCardIcon size={28} /></span>
      <label className="flex items-baseline min-w-0 flex-1 cursor-text" htmlFor="hero-claim-name">
        {/* 16px on phones, NOT 14. globals.css floors every form control at
            16px under `any-pointer: coarse`, because iOS zooms the page in on
            a smaller one and will not zoom back. That floor reached the input
            and not this label, so on a phone the typed name rendered 16px
            beside a 14px "SwiftCard.me/" and its box sat 2px higher — the
            misalignment the owner reported on 2026-09-10, visible only once
            you start typing because until then the input holds a placeholder
            in the same lighter grey. Matching the two here is the fix; raising
            the input instead would bring the zoom back. */}
        <span className="text-slate-900 font-semibold text-base sm:text-[1.0625rem] whitespace-nowrap select-none">SwiftCard.me/</span>
        <input
          id="hero-claim-name"
          name="name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="full name"
          aria-label="Your full name"
          autoComplete="name"
          maxLength={80}
          // A name longer than the field scrolls inside it while you type,
          // because the browser keeps the caret in view. That is right during
          // typing and wrong the moment you stop: the pill goes back to
          // advertising a URL, and a URL that begins mid-word ("SwiftCard.me/
          // xandra Morgan") reads as a bug. Rewinding on blur means the claim
          // always starts where the name starts.
          onBlur={(e) => { e.currentTarget.scrollLeft = 0; }}
          // sc-claim-field opts this control out of the global 16px control
          // floor — see globals.css. It is inline body text, not a form field
          // in a form, and it must match the words it continues.
          className="sc-claim-field min-w-[64px] flex-1 sm:w-[150px] bg-transparent text-slate-900 placeholder-slate-300 text-base sm:text-[1.0625rem] font-semibold focus:outline-none"
        />
      </label>
      <button type="submit" className="rd-btn rd-btn-aurora shrink-0 !py-2.5 !px-2.5 sm:!py-3 sm:!px-6 text-[0.8125rem] sm:text-[0.9375rem] whitespace-nowrap">
        Start for free
      </button>
      {/* Very light glare, sweeping the whole pill (button included) on a slow
          cycle. Above the content (the whole point of a glare), inert to the
          pointer, and killed for reduced-motion in globals.css. */}
      <span aria-hidden="true" className="rd-claim-glare" />
      <input type="hidden" name="src" value="hero_claim" />
    </form>
  );
}
