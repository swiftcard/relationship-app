"use client";

import { useState } from "react";
import Link from "next/link";
import CardScaler from "@/components/CardScaler";
import ClassicPro from "@/components/card-templates/ClassicPro";
import ModernBold from "@/components/card-templates/ModernBold";
import PhotoFirst from "@/components/card-templates/PhotoFirst";
import LocalBusiness from "@/components/card-templates/LocalBusiness";
import LuxuryMinimal from "@/components/card-templates/LuxuryMinimal";
import LogoFirst from "@/components/card-templates/LogoFirst";
import { SAMPLE_DATA, withoutSocials } from "@/components/card-templates/types";
import type { CardData } from "@/components/card-templates/types";
import ShareButton from "@/components/ShareButton";
import CardMiniBuilder from "./CardMiniBuilder";
import { cardPageTheme } from "@/lib/card-page-theme";
import DemoSwiftLinks from "./DemoSwiftLinks";
import PhoneFrame, { StatusBar, phoneScreenWidth } from "@/components/PhoneFrame";

// Interactive template gallery for the homepage. It renders the REAL card
// templates (same components, same sample data as /templates and the live
// card pages) so what people see here is identical to the card they'd ship.
// Hovering a template swaps the phone to that template's actual link
// experience — the card plus the Save-contact / Share-info / Swift Links /
// Share sections on the template's own ambient accent wash (cardPageTheme),
// exactly like opening a SwiftCard link. All interactions are local, so
// nothing here ever counts as real traffic.

const CARD: CardData = withoutSocials(SAMPLE_DATA);
const FIRST = SAMPLE_DATA.name.split(" ")[0];
const DEMO_URL = "https://swiftcard.me/alexmorgan";

// Photo First is face-forward, so it gets a real headshot (royalty-free portrait).
const PHOTO_FIRST_DATA: CardData = { ...CARD, photoUrl: "/marketing/demo-girl.jpg" };

// Logo First leads with the company mark, so it gets the demo wordmark for the
// same reason Photo First gets a face: without one it falls back to initials and
// shows nothing of what the template is for.
const LOGO_FIRST_DATA: CardData = { ...CARD, logoUrl: "/marketing/demo-logo.svg" };

type Tmpl = { id: string; name: string; Component: React.ComponentType<{ data: CardData }>; data?: CardData };

const TEMPLATES: Tmpl[] = [
  { id: "classic-pro", name: "Classic Professional", Component: ClassicPro },
  { id: "modern-bold", name: "Modern Bold", Component: ModernBold },
  { id: "photo-first", name: "Photo First", Component: PhotoFirst, data: PHOTO_FIRST_DATA },
  { id: "local-business", name: "Local Business", Component: LocalBusiness },
  { id: "luxury-minimal", name: "Luxury Minimal", Component: LuxuryMinimal },
  { id: "logo-first", name: "Logo First", Component: LogoFirst, data: LOGO_FIRST_DATA },
];

const Panel = "w-full rounded-2xl p-4 shadow-sm";
const panelStyle = { background: "#fff", border: "1px solid #E4DDD4" } as const;

// The full "what you get when you open the link" experience for one template.
// Keyed on the template id by the parent, so switching templates resets state.
function LinkExperience({ id, Component, data }: { id: string; Component: Tmpl["Component"]; data: CardData }) {
  const [saved, setSaved] = useState(false);
  const [shared, setShared] = useState(false);
  // The live page borrows the card's palette — same derivation, same wash —
  // so hovering templates retints the whole page behind the card.
  const theme = cardPageTheme(null, id);

  return (
    <div className="px-4 pt-2 pb-8" style={{ background: theme.pageBackground, ["--sc-accent" as string]: theme.accent, ["--sc-accent-text" as string]: theme.accentText }}>
      <div className="mx-auto max-w-[300px] flex flex-col gap-4">
        {/* The real card template — contact links are display-only in the demo */}
        <div className="rounded-2xl overflow-hidden" style={{ pointerEvents: "none" }}>
          <CardScaler><Component data={data} /></CardScaler>
        </div>

        {/* Save contact — plain bold heading, like the live page (the numbered
            badges were removed in the 2026-08-19 card-page redesign). */}
        <div className={Panel} style={panelStyle}>
          <p className="text-slate-900 font-bold text-[0.8125rem] tracking-tight">Save {FIRST}&apos;s contact</p>
          <p className="text-slate-500 text-[0.6875rem] mt-0.5 mb-2.5">One tap adds them to your phone contacts — no app needed.</p>
          <button
            onClick={() => setSaved(true)}
            className="w-full rounded-full py-2.5 text-white text-[0.78125rem] font-bold flex items-center justify-center gap-1.5 transition-colors"
            style={{ background: saved ? "#16a34a" : theme.accent }}
          >
            {saved ? (
              <><svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.5}><path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" /></svg>Saved to Contacts</>
            ) : (
              <><svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2}><path d="M19 21v-8H5v8M5 3h11l3 3v3M9 3v4h6" strokeLinecap="round" strokeLinejoin="round" /></svg>Save {FIRST}&apos;s contact</>
            )}
          </button>
        </div>

        {/* Share your info back */}
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
                  required, email is optional, and there is a message field. */}
              {["Your name *", "Your phone number *", "Your email (optional)", "Quick message (optional)"].map((ph) => (
                <div key={ph} className="h-9 rounded-lg bg-white flex items-center px-3 text-[0.75rem] text-slate-500" style={{ border: "1px solid #E4DDD4" }}>{ph}</div>
              ))}
              {/* No SMS consent line — the real share form has none (owner,
                  2026-09-20); see LeadCaptureForm. */}
              <button onClick={() => setShared(true)} className="mt-1 w-full h-10 rounded-lg text-white text-[0.78125rem] font-bold flex items-center justify-center" style={{ background: theme.accent }}>Share my info →</button>
            </div>
          )}
        </div>

        {/* Swift Links (the real card section, shared by every mockup) */}
        <div className={Panel} style={panelStyle}>
          <DemoSwiftLinks />
        </div>

        {/* Share this card — just the share button, like the live page (the
            "Show QR Code" control was removed from the card page: a sharer's
            tool sitting in a viewer's flow). */}
        <div className={Panel} style={panelStyle}>
          <ShareButton url={DEMO_URL} text={`Connect with ${FIRST} — save their contact instantly.`} label="Share this card" />
          {/* A conversion path out of the demo, pointing at the builder. It used
              to be a hard link to https://swiftcard.me/?src=card, which on
              production merely reloaded the page you were already on, and from a
              preview deploy or localhost ejected you onto the live site
              mid-demo.
              On the live page this line is Free-only (Pro is sold as "100%
              your brand"); the demo card is a Free card, so showing it here is
              truthful. */}
          <Link href="/cards/new" className="block text-center text-slate-400 hover:text-slate-600 text-[0.6875rem] mt-3 transition-colors">
            Create your card · swiftcard.me
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function TemplateGallery({ linkedinEnabled = false }: { linkedinEnabled?: boolean }) {
  const [active, setActive] = useState(TEMPLATES[0].id);
  const activeT = TEMPLATES.find((t) => t.id === active) ?? TEMPLATES[0];

  return (
    <div className="grid lg:grid-cols-[0.82fr_1.18fr] gap-12 items-start">
      {/* Phone — reflects the hovered template's live link experience */}
      <div className="flex flex-col items-center gap-3 order-2 lg:order-1 lg:sticky lg:top-24">
        <div className="flex items-center gap-1.5 text-slate-500 text-[0.75rem] font-medium">
          <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2}><path d="M12 5v14M12 19l-4-4M12 19l4-4" strokeLinecap="round" strokeLinejoin="round" /></svg>
          Scroll on phone to view
        </div>
        {/* One shared iPhone for the whole site — see components/PhoneFrame. */}
        <PhoneFrame width={300} statusBar={false} screenStyle={{ height: 600, background: "#FAF7F2" }}>
          <div className="absolute inset-0 overflow-y-auto rd-scrollbar-none">
            <StatusBar width={phoneScreenWidth(300)} />
            <LinkExperience key={activeT.id} id={activeT.id} Component={activeT.Component} data={activeT.data ?? CARD} />
          </div>
        </PhoneFrame>
      </div>

      {/* Template grid — every real template, name above each */}
      <div className="order-1 lg:order-2">
        <p className="rd-eyebrow text-slate-600 mb-5" data-reveal="fade">
          {/* "hover" is meaningless on a phone — same sentence, the verb the
              device actually supports (owner mobile pass, 2026-09-17). */}
          Six designer templates — <span className="sm:hidden">tap</span><span className="hidden sm:inline">hover</span> any to see it live
        </p>
        <div className="grid grid-cols-2 gap-x-5 gap-y-7">
          {TEMPLATES.map((t, i) => {
            const on = active === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onMouseEnter={() => setActive(t.id)}
                onFocus={() => setActive(t.id)}
                onClick={() => setActive(t.id)}
                className="text-left outline-none"
                data-reveal
                style={{ transitionDelay: `${i * 70}ms` }}
                aria-pressed={on}
                // The preview inside is a rendered CARD, and a card carries real
                // tel:/mailto:/https: links. pointer-events:none stops them
                // swallowing the click, but VoiceOver still walked into them and
                // announced a button containing three more controls (axe:
                // nested-interactive). Hiding the preview from the tree and
                // naming the button keeps one target with one name — which is
                // also what "tap Modern Bold template" needs to work in Voice
                // Control.
                aria-label={`${t.name} template`}
              >
                <p aria-hidden="true" className={`text-[0.84375rem] font-semibold mb-2 transition-colors ${on ? "text-[#2563EB]" : "text-slate-700"}`}>{t.name}</p>
                <div
                  // See templates/page.tsx: the preview is a real card with real
                  // contact links, so it is inert — out of the a11y tree and out
                  // of the tab order, leaving one named button.
                  inert
                  className="rounded-2xl overflow-hidden transition-all duration-200"
                  style={{
                    outline: on ? "2px solid #2563EB" : "2px solid transparent",
                    outlineOffset: 3,
                    boxShadow: on ? "0 18px 36px -16px rgba(37,99,235,0.55)" : "0 8px 20px -14px rgba(8,10,18,0.4)",
                    transform: on ? "translateY(-3px)" : undefined,
                    // Card contact links (phone/email/website) are display-only here —
                    // pointer events pass through to the selector button.
                    pointerEvents: "none",
                  }}
                >
                  <CardScaler><t.Component data={t.data ?? CARD} /></CardScaler>
                </div>
              </button>
            );
          })}

          {/* After the six templates: "Start from scratch", one grid cell the
              exact size of a template card (see CardMiniBuilder). */}
          <CardMiniBuilder linkedinEnabled={linkedinEnabled} />
        </div>
      </div>
    </div>
  );
}
