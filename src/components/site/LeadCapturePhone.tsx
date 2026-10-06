"use client";

import { useState } from "react";
import CardScaler from "@/components/CardScaler";
import PhotoFirst from "@/components/card-templates/PhotoFirst";
import { SAMPLE_DATA, withoutSocials } from "@/components/card-templates/types";
import type { CardData } from "@/components/card-templates/types";
import ShareButton from "@/components/ShareButton";
import DemoSwiftLinks from "./DemoSwiftLinks";
import DemoGetCardButton from "./DemoGetCardButton";
import { cardPageTheme } from "@/lib/card-page-theme";
import PhoneFrame, { StatusBar, phoneScreenWidth } from "@/components/PhoneFrame";

// The lead-capture page phone: the REAL card-open experience exactly as a
// visitor sees it when they open a SwiftCard link — the real card template plus
// the real card-page sections (Save contact, Swift Links, Share your info,
// Share this card), built from the same components the live card page uses,
// on the same ambient accent-washed background the live page paints.
// The Save-contact and Share-your-info buttons work for view (local state, no
// network); everything else is display-only. Nothing here ever counts as real
// traffic.

const CARD: CardData = { ...withoutSocials(SAMPLE_DATA), photoUrl: "/marketing/demo-girl.jpg" };
const FIRST = SAMPLE_DATA.name.split(" ")[0];
const DEMO_URL = "https://swiftcard.me/alexmorgan";

// The live page borrows the card's palette — same derivation, same wash.
const THEME = cardPageTheme(null, "photo-first");

const Panel = "w-full rounded-2xl p-4 shadow-sm";
const panelStyle = { background: "#fff", border: "1px solid #E4DDD4" } as const;

function LinkExperience() {
  const [saved, setSaved] = useState(false);
  const [shared, setShared] = useState(false);

  return (
    <div className="px-4 pt-2 pb-8" style={{ background: THEME.pageBackground, ["--sc-accent" as string]: THEME.accent, ["--sc-accent-text" as string]: THEME.accentText }}>
      <div className="mx-auto max-w-[300px] flex flex-col gap-4">
        {/* The real card template — contact links are display-only in the demo */}
        <div className="rounded-2xl overflow-hidden" style={{ pointerEvents: "none" }}>
          <CardScaler><PhotoFirst data={CARD} /></CardScaler>
        </div>

        {/* Save contact — plain bold heading, like the live page (the numbered
            badges were removed in the 2026-08-19 card-page redesign). */}
        <div className={Panel} style={panelStyle}>
          <p className="text-slate-900 font-bold text-[0.8125rem] tracking-tight">Save {FIRST}&apos;s contact</p>
          <p className="text-slate-500 text-[0.6875rem] mt-0.5 mb-2.5">One tap adds them to your phone contacts — no app needed.</p>
          <button
            onClick={() => setSaved(true)}
            className="w-full rounded-full py-2.5 text-white text-[0.78125rem] font-bold flex items-center justify-center gap-1.5 transition-colors"
            style={{ background: saved ? "#16a34a" : THEME.accent }}
          >
            {saved ? (
              <><svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.5}><path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" /></svg>Saved to Contacts!</>
            ) : (
              <><svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2}><path d="M19 21v-8H5v8M5 3h11l3 3v3M9 3v4h6" strokeLinecap="round" strokeLinejoin="round" /></svg>Save Contact</>
            )}
          </button>
        </div>

        {/* Swift Links (the real card section, shared by every mockup) —
            right after Save contact, as on the live page since 2026-09-22. */}
        <div className={Panel} style={panelStyle}>
          <DemoSwiftLinks />
        </div>

        {/* Share your info back (the lead-capture handshake) */}
        <div className={Panel} style={panelStyle}>
          <p className="text-slate-900 font-bold text-[0.8125rem] tracking-tight mb-2">Share your info with {FIRST}</p>
          {shared ? (
            <div className="py-3 text-center">
              <div className="w-10 h-10 mx-auto mb-1.5 rounded-full bg-green-100 flex items-center justify-center">
                <svg viewBox="0 0 24 24" className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" strokeWidth={2.5}><path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </div>
              <p className="text-slate-900 font-bold text-[0.8125rem]">Info shared!</p>
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              {/* The real form's fields, in the real order: name and PHONE are
                  required, email is optional, and there is a message field.
                  The mock previously showed name → email → phone with nothing
                  marked required, which is not the form a visitor meets. */}
              {["Your name *", "Your phone number *", "Your email (optional)", "Quick message (optional)"].map((ph) => (
                <div key={ph} className="h-9 rounded-lg bg-white flex items-center px-3 text-[0.75rem] text-slate-500" style={{ border: "1px solid #E4DDD4" }}>{ph}</div>
              ))}
              {/* No SMS consent line: the real form has none either (owner,
                  2026-09-20). Sharing details is not subscribing to texts —
                  see the note in LeadCaptureForm. This mock must keep matching
                  the live form, which is what tests/demo-consent-fidelity
                  checks. */}
              <button
                onClick={() => setShared(true)}
                className="mt-1 w-full h-10 rounded-lg text-white text-[0.78125rem] font-bold flex items-center justify-center"
                style={{ background: THEME.accent, border: "1.5px solid #ffffff", boxShadow: `0 0 0 2px ${THEME.accent}, 0 0 0 5px ${THEME.accent}2E` }}
              >
                Share My Info
              </button>
            </div>
          )}
        </div>

        {/* Share this card — just the share button, like the live page (the
            "Show QR Code" control was removed from the card page: a sharer's
            tool sitting in a viewer's flow). */}
        <div className={Panel} style={panelStyle}>
          <ShareButton url={DEMO_URL} text={`Connect with ${FIRST} — save their contact instantly.`} label="Share this card" />
          <DemoGetCardButton />
        </div>
      </div>
    </div>
  );
}

export default function LeadCapturePhone() {
  return (
    <div className="flex flex-col items-center gap-3">
      <div className="flex items-center gap-1.5 text-white/45 text-[0.75rem] font-medium">
        <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2}><path d="M12 5v14M12 19l-4-4M12 19l4-4" strokeLinecap="round" strokeLinejoin="round" /></svg>
        Exactly what they see when they open your card
      </div>
      {/* One shared iPhone for the whole site — see components/PhoneFrame.
          650, not 600. The screen is a scrolling viewport over a ~1190px card
          page, so where it cuts is a choice — and it should cut on a boundary,
          not mid-control. Since Swift Links moved above "Share your info"
          (2026-09-22, the live page's order) 650 lands just under the first
          Swift Links row, with the next one peeking so the page reads as
          scrollable; the share form is the next thing a scroll reveals. */}
      <PhoneFrame width={300} statusBar={false} screenStyle={{ height: 650, background: "#FAF7F2" }}>
        <div className="absolute inset-0 overflow-y-auto rd-scrollbar-none">
          <StatusBar width={phoneScreenWidth(300)} />
          <LinkExperience />
        </div>
      </PhoneFrame>
    </div>
  );
}
