"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import CardScaler from "@/components/CardScaler";
import PhotoFirst from "@/components/card-templates/PhotoFirst";
import { withoutSocials, SAMPLE_DATA, SAMPLE_DATA_WITH_PHOTO, DEMO_HEADSHOT } from "@/components/card-templates/types";
import type { CardData } from "@/components/card-templates/types";
import SaveContactButton from "@/components/SaveContactButton";
import ShareButton from "@/components/ShareButton";
import DemoSwiftLinks from "./DemoSwiftLinks";
import DemoGetCardButton from "./DemoGetCardButton";
import { cardPageTheme } from "@/lib/card-page-theme";

// Email Signature showcase: a wide, realistic email whose signature is the REAL
// SwiftCard — the PhotoFirst template rendered exactly as we ship it, with the
// person's photo. Clicking the signature pops up that same SwiftCard exactly as
// a recipient sees it: the identical card plus the real card-page boxes
// (Save contact, Share your info, Swift Links, Share this card) built from the
// same components the live /card page uses. Display-only here (no downloads,
// posts, or nav) — just an accurate preview.

// Same demo identity as SAMPLE_DATA (card-templates/types.tsx) and every other
// marketing demo (SwiftLinksPhone, TeamsDashboard, DashboardDemo) — one person,
// one company, everywhere on the site.
//
// DERIVED, not retyped. This block used to restate every field by hand and
// dropped `address` on the way, so the card in the signature rendered without
// the street line that the SwiftCard example in the template gallery shows —
// two cards for the same person that didn't match. Reading from SAMPLE_DATA is
// what makes that impossible: a field added there now reaches both.
const IDENTITY = SAMPLE_DATA;
const FIRST = SAMPLE_DATA.name.split(" ")[0];
const CARD_URL = "https://swiftcard.me/alexmorgan";

// Byte-for-byte the gallery's Photo First card (see TemplateGallery's
// PHOTO_FIRST_DATA): the shared sample, socials stripped, demo headshot on.
const CARD_DATA: CardData = withoutSocials(SAMPLE_DATA_WITH_PHOTO);

// The live page borrows the card's palette — same derivation, same wash.
const THEME = cardPageTheme(null, "photo-first");

const PERSON = {
  name: IDENTITY.name, title: IDENTITY.title, company: IDENTITY.company,
  // CardData types these as optional; Person requires `website`. The sample
  // always sets it — the fallback just keeps the demo honest if it ever stops.
  email: IDENTITY.email, phone: IDENTITY.phone, website: IDENTITY.website ?? "",
  linkedin: IDENTITY.linkedin, instagram: IDENTITY.instagram, twitter: IDENTITY.twitter, tiktok: IDENTITY.tiktok,
  photoUrl: DEMO_HEADSHOT,
};

const PANEL = "w-full rounded-2xl p-5 shadow-sm";
const panelStyle = { background: "#fff", border: "1px solid #E4DDD4" } as const;
// The boxes are a faithful preview — disable interaction so the marketing page
// never triggers a vCard download, a lead POST, or a stacked full-screen modal.
const showOnly = { pointerEvents: "none" as const };

// The SwiftCard exactly as a recipient gets it — the same card and the same
// card-page boxes, built from the live components.
function SwiftCardPopup({ onClose }: { onClose: () => void }) {
  return (
    <>
    {/* Dim + blur backdrop as its OWN fixed layer, behind the scroll container.
        Critical: backdrop-filter must NOT live on the same element as
        overflow-y-auto — on iOS Safari that combination silently kills touch
        scrolling. Keeping it on a separate non-scrolling layer lets the popup
        scroll again while preserving the frosted look. */}
    <div
      className="fixed inset-0 z-[88]"
      style={{ background: "rgba(4,7,15,0.72)", backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)" }}
      aria-hidden
    />
    {/* Faded grey X — the reliable way out on a phone, where the tall card fills
        the screen and leaves almost no backdrop to tap. Sits above the scroll
        container and stays pinned to the viewport corner. */}
    <button
      onClick={onClose}
      aria-label="Close preview"
      className="fixed top-4 right-4 z-[95] w-9 h-9 rounded-full flex items-center justify-center bg-white/10 text-white/60 hover:bg-white/20 hover:text-white/90 backdrop-blur-sm transition-colors"
    >
      <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2}><path d="M6 18L18 6M6 6l12 12" strokeLinecap="round" /></svg>
    </button>
    {/* Clean scroll container — no backdrop-filter here, so touch scroll works. */}
    <div className="fixed inset-0 z-[90] overflow-y-auto" onClick={onClose}>
      <div className="min-h-full flex items-start justify-center py-8 px-4">
        <div className="relative w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
          <div className="flex flex-col items-center gap-5 rounded-3xl px-4 py-6" style={{ background: THEME.pageBackground, ["--sc-accent" as string]: THEME.accent, ["--sc-accent-text" as string]: THEME.accentText }}>
            {/* The SwiftCard — identical PhotoFirst card as the signature */}
            <div className="w-full" style={showOnly}>
              <CardScaler><PhotoFirst data={CARD_DATA} /></CardScaler>
            </div>

            {/* Save contact — plain bold heading, like the live page (the
                numbered badges were removed in the 2026-08-19 redesign). */}
            <div className={PANEL} style={panelStyle}>
              <p className="text-slate-900 font-bold text-[0.9375rem] tracking-tight">Save {FIRST}&apos;s contact</p>
              <p className="text-slate-500 text-xs mt-1 mb-4">One tap adds them to your phone contacts — no app needed.</p>
              <div style={showOnly}>
                <SaveContactButton person={PERSON} username="alexmorgan" source="signature_demo" cardOwner="alexmorgan" ownerFirstName={FIRST} suppressTracking />
              </div>
            </div>

            {/* Swift Links (the real card section, shared by every mockup) —
                right after Save contact, as on the live page since 2026-09-22. */}
            <div className={PANEL} style={panelStyle}>
              <DemoSwiftLinks compact={false} />
            </div>

            {/* Share your info */}
            <div className={PANEL} style={panelStyle}>
              <p className="text-slate-900 font-bold text-[0.9375rem] tracking-tight mb-4">Share your info with {FIRST}</p>
              <div style={showOnly}>
                {/* Blank form — a faithful copy of the real LeadCaptureForm, empty. */}
                <div className="w-full space-y-3">
                  <input type="text" placeholder="Your name *" readOnly className="w-full bg-white border border-gray-200 text-gray-900 placeholder-gray-400 rounded-xl px-4 py-3 text-sm focus:outline-none shadow-sm" />
                  <input type="tel" placeholder="Your phone number *" readOnly className="w-full bg-white border border-gray-200 text-gray-900 placeholder-gray-400 rounded-xl px-4 py-3 text-sm focus:outline-none shadow-sm" />
                  <input type="email" placeholder="Your email (optional)" readOnly className="w-full bg-white border border-gray-200 text-gray-900 placeholder-gray-400 rounded-xl px-4 py-3 text-sm focus:outline-none shadow-sm" />
                  <textarea placeholder="Quick message (optional)" rows={2} readOnly className="w-full bg-white border border-gray-200 text-gray-900 placeholder-gray-400 rounded-xl px-4 py-3 text-sm focus:outline-none shadow-sm resize-none" />
                  <button type="button" className="w-full text-white font-semibold py-3 px-6 rounded-full text-sm" style={{ background: THEME.accent }}>Share My Info</button>
                  {/* No consent line here either: the live share form no
                      longer has one (owner, 2026-09-20). This demo has to keep
                      matching it — tests/demo-consent-fidelity. */}
                </div>
              </div>
            </div>

            {/* Share this card — the share button and the live page's
                "Create your free SwiftCard" button under it (the "Show QR
                Code" control was removed from the card page). */}
            <div className={PANEL} style={panelStyle}>
              <ShareButton url={CARD_URL} text={`Connect with ${FIRST} — save their contact instantly.`} label="Share this card" />
              <DemoGetCardButton />
            </div>
          </div>
        </div>
      </div>
    </div>
    </>
  );
}

export default function SignatureDemo() {
  const [open, setOpen] = useState(false);
  return (
    <div>
      {/* Works everywhere */}
      <div className="flex flex-wrap items-center justify-center gap-2.5 mb-5" data-reveal="fade">
        <span className="text-slate-500 text-[0.9375rem] font-medium">Works on all platforms —</span>
        {["Gmail", "Outlook", "Yahoo", "Hotmail", "Apple Mail"].map((p) => (
          <span key={p} className="rd-pill rd-pill-l text-[0.8125rem]">{p}</span>
        ))}
        <span className="text-slate-500 text-[0.9375rem] font-medium">all of it.</span>
      </div>

      {/* Click hint — on top of the email box */}
      <p className="text-center text-[0.9375rem] font-semibold mb-4 flex items-center justify-center gap-1.5" style={{ color: "#2563EB" }} data-reveal="fade">
        Click the signature and see what happens
        <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2}><path d="M12 5v14M12 19l-4-4M12 19l4-4" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </p>

      {/* Wide email mockup */}
      <div className="rd-card-l overflow-hidden max-w-3xl mx-auto" data-reveal="scale">
        <div className="flex items-center gap-2 px-4 h-11 border-b border-slate-100 bg-slate-50">
          <span className="w-3 h-3 rounded-full bg-[#ff5f57]" /><span className="w-3 h-3 rounded-full bg-[#febc2e]" /><span className="w-3 h-3 rounded-full bg-[#28c840]" />
          <span className="ml-3 text-[0.75rem] text-slate-500 font-medium">New Message</span>
        </div>
        <div className="p-6 sm:p-8 text-slate-700">
          <div className="text-[0.8125rem] space-y-1.5 pb-3 border-b border-slate-100">
            <p><span className="text-slate-400">To:</span> sarah@acme.com</p>
            <p><span className="text-slate-400">Subject:</span> Great connecting today</p>
          </div>
          <div className="pt-5 text-[0.90625rem] leading-relaxed space-y-3">
            <p>Hi Sarah,</p>
            <p>Really enjoyed chatting earlier. My details are in my signature below — feel free to reach out anytime.</p>
            <p>Best,</p>
          </div>

          {/* signature */}
          <div className="mt-5 pt-5 border-t border-slate-100">
            <p className="text-[0.875rem] text-slate-900 mb-2"><strong>Alex Morgan</strong> <span className="text-slate-500">| Coastline Realty</span></p>
            <div className="relative w-[300px] max-w-full transition-transform hover:-translate-y-0.5">
              <div className="rounded-2xl overflow-hidden shadow-[0_10px_30px_-14px_rgba(8,10,18,0.4)]" style={{ pointerEvents: "none", background: "#FAF7F2" }}>
                <CardScaler><PhotoFirst data={CARD_DATA} /></CardScaler>
              </div>
              <button onClick={() => setOpen(true)} aria-label="Open Alex Morgan's SwiftCard" className="absolute inset-0 z-10 rounded-2xl cursor-pointer" />
            </div>
            <button onClick={() => setOpen(true)} className="inline-block mt-2 text-[0.875rem] font-bold no-underline" style={{ color: "#2563eb" }}>Contact me →</button>
          </div>
        </div>
      </div>

      {open && typeof document !== "undefined" && createPortal(<SwiftCardPopup onClose={() => setOpen(false)} />, document.body)}
    </div>
  );
}
