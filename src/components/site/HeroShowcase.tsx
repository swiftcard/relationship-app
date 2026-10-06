"use client";

import { useEffect, useRef, useState } from "react";
import CardScaler from "@/components/CardScaler";
import SocialIcons, { type BrandSocial } from "@/components/SocialIcons";
import ClassicPro from "@/components/card-templates/ClassicPro";
import ModernBold from "@/components/card-templates/ModernBold";
import PhotoFirst from "@/components/card-templates/PhotoFirst";
import LocalBusiness from "@/components/card-templates/LocalBusiness";
import LuxuryMinimal from "@/components/card-templates/LuxuryMinimal";
import LogoFirst from "@/components/card-templates/LogoFirst";
import type { CardData } from "@/components/card-templates/types";
import { getLook, hexAlpha, fallbackTile, washGradient, type SwiftLinkLook } from "@/lib/swiftlink-looks";
import PlatformIcon from "@/components/PlatformIcon";
import PhoneFrame from "@/components/PhoneFrame";

// ── The hero's rotating persona showcase (owner order 2026-08-26, modeled on
//    link.me's front page) ────────────────────────────────────────────────────
//
// Three panels per persona, and each one is a faithful miniature of the REAL
// product surface (owner order 2026-08-26: "have to look exactly like" the
// real thing, nothing tucked under the phone, everything noticeable):
//   CENTER — the SwiftCard link as a visitor opens it: the real template
//            render inside a phone on the card page's cream wash, with the
//            page's Save Contact / Share your info actions in the card accent.
//   LEFT   — the persona's full Swift Links page, rebuilt from the live
//            page's own markup (hero photo/logo with the fade-into-sheet,
//            32px name + verified seal, @handle, the REAL SocialIcons brand
//            row, the Connect button, compact link rows and a featured tile
//            with the shine sweep, the Made-with footer) rendered at the
//            page's natural 430px width and scaled down as one unit.
//   RIGHT  — their Swift Signature as it sits in a received email: message
//            lines, the sign-off, and the same card as the clickable image.
//
// Three personas lead with a headshot (Unsplash-licensed) and three with a
// company logo — matching how real cards split. Display-only: pointer-events
// are dead across the whole stage; nothing here downloads, posts, or
// navigates. Respects prefers-reduced-motion (no timer, first persona static).

type Persona = {
  key: string;
  job: string;
  Template: React.ComponentType<{ data: CardData }>;
  data: CardData;
  look: SwiftLinkLook;
  handle: string;
  subtitle: string;
  bio: string;
  /** Subject line of the email the Swift Signature sits in. */
  subject: string;
  /** The reply itself, two or three short lines above the sign-off. */
  message: string;
  accent: string;
  socials: BrandSocial[];
  /** The page's ONE featured tile - full width, the thing they most want tapped. */
  featured: string;
  /** Two half-width grid tiles, side by side under the featured one. */
  grid: string[];
  /** One compact row - the quiet link at the bottom of a real page. */
  compact: string;
  signoff: string;
};

const p = (partial: Omit<CardData, "initials"> & { initials?: string }): CardData => ({
  initials: partial.name.split(" ").map((n) => n[0]).join("").slice(0, 2),
  photoUrl: null,
  logoUrl: null,
  ...partial,
});

// The live page stores each social's brand color on the row (SocialIcons
// falls back to a washed neutral without one) — mirror that here.
const BRAND: Record<string, string> = {
  LinkedIn: "#0A66C2", Facebook: "#1877F2", YouTube: "#FF0000",
  "X / Twitter": "#000000", TikTok: "#010101",
};
const soc = (labels: Array<[string, string]>): BrandSocial[] =>
  labels.map(([label, href]) => ({ label, href, color: BRAND[label] }));

const SERIF = "Georgia, 'Times New Roman', serif";

// Every example is DESIGNED, not default (owner, 2026-09-17: "make all those
// designs much nicer... play with all the features"). Each persona uses the
// real systems a paying customer has:
//   - the card's style controls (bgColor / surfaceColor / textColor /
//     fontFamily) plus a finish (sheen, frosted, brushed, carbon, gilt, halo),
//     the same values the named presets in lib/template-style-presets.ts carry;
//   - a Swift Links Look from lib/swiftlink-looks - the glass and gradient
//     ones, not just the flat defaults;
//   - the whole link-tile system: one FEATURED tile, a GRID pair and a COMPACT
//     row, which is what SwiftLinkButtons renders for a paid page.
const PERSONAS: Persona[] = [
  {
    key: "realtor", job: "Realtor", Template: PhotoFirst, handle: "mayasellshomes",
    subtitle: "Realtor® · Harbor & Vine Realty", accent: "#6D28D9",
    bio: "Helping Bay Area families find home for 12 years. 200+ closings and counting.",
    subject: "Re: 12 Harbor Lane — Saturday showing",
    message: "Saturday at 11 works. I'll meet you out front, and I'll bring the disclosures and the HOA packet.",
    data: p({
      name: "Maya Castillo", title: "Realtor®", company: "Harbor & Vine Realty",
      phone: "(415) 555-0132", email: "maya@harborvine.com", website: "harborvine.com",
      cardUrl: "swiftcard.me/mayacastillo", photoUrl: "/showcase/maya.jpg",
      // "Royal Violet" info panel, lit with a soft sheen.
      customization: { accentColor: "#6D28D9", bgColor: "linear-gradient(145deg, #4f46e5 0%, #7c3aed 60%, #6d28d9 100%)", textColor: "#ffffff", finish: "sheen" },
    }),
    look: getLook("aurora"),
    socials: soc([["Instagram", "#"], ["LinkedIn", "#"], ["Facebook", "#"], ["YouTube", "#"]]),
    featured: "Just listed · 12 Harbor Lane",
    grid: ["Open houses", "What's my home worth?"],
    compact: "Book a private showing",
    signoff: "Talk soon,",
  },
  {
    key: "electrician", job: "Electrician", Template: LocalBusiness, handle: "delgadoelectric",
    subtitle: "Licensed & insured · Austin, TX", accent: "#B45309",
    bio: "Licensed master electrician. Same-week service, upfront pricing, 5-star rated.",
    subject: "Re: Your panel upgrade quote",
    message: "Your quote is attached: 200A panel, permit and inspection included. I can start Tuesday morning.",
    data: p({
      name: "Ray Delgado", title: "Master Electrician", company: "Delgado Electric",
      phone: "(512) 555-0177", email: "ray@delgadoelectric.com", website: "delgadoelectric.com",
      cardUrl: "swiftcard.me/raydelgado", logoUrl: "/showcase/delgado-electric.svg",
      // "Warm Amber" header stripe over a warm body.
      customization: { accentColor: "#B45309", bgColor: "linear-gradient(100deg, #b45309 0%, #d97706 60%, #f59e0b 100%)", surfaceColor: "#FFFBF3", textColor: "#ffffff", finish: "sheen" },
    }),
    look: getLook("linen"),
    socials: soc([["Instagram", "#"], ["Facebook", "#"], ["YouTube", "#"]]),
    featured: "Same-week service · Book today",
    grid: ["Free quote", "EV chargers"],
    compact: "Read our 5-star reviews",
    signoff: "Thanks,",
  },
  {
    key: "insurance", job: "Insurance agent", Template: ClassicPro, handle: "danawhitfield",
    subtitle: "Insurance Advisor · Beacon Mutual", accent: "#2F6F8F",
    bio: "Coverage that actually fits your life — home, auto, and everything in between.",
    subject: "Re: Your coverage review",
    message: "Bundling home and auto lowers your premium and your deductible. Want to go over it Thursday?",
    data: p({
      name: "Dana Whitfield", title: "Insurance Advisor", company: "Beacon Mutual",
      phone: "(303) 555-0149", email: "dana@beaconins.com", website: "beaconins.com",
      cardUrl: "swiftcard.me/danawhitfield", photoUrl: "/showcase/dana.jpg",
      // "Sea Glass": frosted navy panel, pale ink, bright info surface.
      customization: { accentColor: "#2F6F8F", bgColor: "linear-gradient(160deg, #1c3a5e 0%, #2f6f8f 100%)", textColor: "#f2fbff", surfaceColor: "#f8fafc", finish: "frosted" },
    }),
    look: getLook("tide"),
    socials: soc([["LinkedIn", "#"], ["Facebook", "#"], ["X / Twitter", "#"]]),
    featured: "Free 10-minute coverage review",
    grid: ["Home + auto", "Life insurance"],
    compact: "Start a claim",
    signoff: "Best regards,",
  },
  {
    key: "banker", job: "Private banker", Template: LuxuryMinimal, handle: "prestoncole",
    subtitle: "Private Banker · Meridian Private Bank", accent: "#8C6D3F",
    bio: "Discreet wealth management for founders, families, and funds.",
    subject: "Re: Q3 portfolio review",
    message: "Your Q3 summary is attached. Happy to walk through the rebalancing whenever suits you.",
    data: p({
      name: "Preston Cole", title: "Private Banker", company: "Meridian Private Bank",
      phone: "(212) 555-0186", email: "pcole@meridianpb.com", website: "meridianpb.com",
      cardUrl: "swiftcard.me/prestoncole", logoUrl: "/showcase/meridian-bank.svg",
      // "Ivory & Gold", set in a serif, with the gilt edge.
      customization: { accentColor: "#8C6D3F", bgColor: "#FAFAF6", textColor: "#1C1612", fontFamily: SERIF, finish: "gilt" },
    }),
    look: getLook("chrome"),
    socials: soc([["LinkedIn", "#"], ["X / Twitter", "#"]]),
    featured: "Q3 market briefing",
    grid: ["Book a consultation", "Wealth guide"],
    compact: "Client portal",
    signoff: "Kind regards,",
  },
  {
    key: "lawyer", job: "Attorney", Template: ModernBold, handle: "adlergrant",
    subtitle: "Managing Partner · Adler & Grant LLP", accent: "#5B8DEF",
    bio: "Trial-tested counsel for businesses and the people who run them.",
    subject: "Re: Your consultation on Thursday",
    message: "Confirmed for Thursday at 10. Please bring the signed engagement letter and any notices you've received.",
    data: p({
      name: "Simone Adler", title: "Managing Partner", company: "Adler & Grant LLP",
      phone: "(646) 555-0121", email: "sadler@adlergrant.law", website: "adlergrant.law",
      cardUrl: "swiftcard.me/simoneadler", photoUrl: "/showcase/simone.jpg",
      // "Carbon": woven black, cool blue accent.
      customization: { accentColor: "#5B8DEF", bgColor: "#0B0F16", textColor: "#ffffff", finish: "carbon" },
    }),
    look: getLook("graphite"),
    socials: soc([["LinkedIn", "#"], ["X / Twitter", "#"], ["Instagram", "#"]]),
    featured: "Free case evaluation",
    grid: ["Practice areas", "Client results"],
    compact: "In the news",
    signoff: "Sincerely,",
  },
  {
    key: "cars", job: "Car salesperson", Template: LogoFirst, handle: "tonymarchetti",
    subtitle: "Sales Manager · Marchetti Motors", accent: "#DC2626",
    bio: "Your guy for new & certified pre-owned. No games, just great deals.",
    subject: "Re: Your test drive this weekend",
    message: "The blue one is reserved for you Saturday. It'll be detailed and waiting out front at 10.",
    data: p({
      name: "Tony Marchetti", title: "Sales Manager", company: "Marchetti Motors",
      phone: "(702) 555-0166", email: "tony@marchettimotors.com", website: "marchettimotors.com",
      cardUrl: "swiftcard.me/tonymarchetti", logoUrl: "/showcase/marchetti-motors.svg",
      // "Brushed Steel" - machined metal behind the logo panel.
      customization: { accentColor: "#DC2626", bgColor: "#39414F", textColor: "#ffffff", finish: "brushed" },
    }),
    look: getLook("ember"),
    socials: soc([["Instagram", "#"], ["TikTok", "#"], ["YouTube", "#"], ["Facebook", "#"]]),
    featured: "This week's deals",
    grid: ["New inventory", "Trade-in value"],
    compact: "Book a test drive",
    signoff: "Drive safe,",
  },
];

// Personas that exist for the /for/<industry> landing pages only - the
// homepage rotation stays the six above.
const VERTICAL_PERSONAS: Persona[] = [
  {
    key: "loan-officer", job: "Loan officer", Template: ClassicPro, handle: "marcuswebbloans",
    subtitle: "Senior Loan Officer · Summit Home Loans", accent: "#0F766E",
    bio: "From pre-approval to clear-to-close — I keep buyers, agents, and files moving.",
    subject: "Re: Your pre-approval letter",
    message: "Great news, you're pre-approved! The letter is attached, so send it along with your offer.",
    data: p({
      name: "Marcus Webb", title: "Senior Loan Officer", company: "Summit Home Loans",
      phone: "(214) 555-0198", email: "marcus@summithl.com", website: "summithl.com",
      cardUrl: "swiftcard.me/MarcusWebb-SummitHomeLoans", photoUrl: "/showcase/marcus.jpg",
      customization: { accentColor: "#0F766E", bgColor: "#052E2B", textColor: "#ffffff", surfaceColor: "#F7FBFA", finish: "sheen" },
    }),
    look: getLook("meadow"),
    socials: soc([["LinkedIn", "#"], ["Instagram", "#"], ["Facebook", "#"]]),
    featured: "Get pre-approved in 10 minutes",
    grid: ["Payment calculator", "Agent partners"],
    compact: "Client reviews",
    signoff: "Talk soon,",
  },
  {
    key: "photographer", job: "Photographer", Template: PhotoFirst, handle: "lenabrooksphoto",
    subtitle: "Wedding & Portrait Photographer", accent: "#BE123C",
    bio: "Weddings, portraits, and brand shoots — natural light, real moments.",
    subject: "Re: Your gallery is ready",
    message: "Your gallery is live! Every favorite downloads in full resolution, with no watermark.",
    data: p({
      name: "Lena Brooks", title: "Photographer", company: "Lena Brooks Photography",
      phone: "(503) 555-0143", email: "hello@lenabrooks.photo", website: "lenabrooks.photo",
      cardUrl: "swiftcard.me/LenaBrooks-LenaBrooksPhotography", photoUrl: "/showcase/lena.jpg",
      customization: { accentColor: "#BE123C", bgColor: "linear-gradient(145deg, #be123c 0%, #f43f5e 100%)", textColor: "#ffffff", finish: "sheen" },
    }),
    look: getLook("bloom"),
    socials: soc([["Instagram", "#"], ["TikTok", "#"], ["YouTube", "#"], ["Facebook", "#"]]),
    featured: "2026 wedding dates",
    grid: ["Portfolio", "Mini sessions"],
    compact: "Client galleries",
    signoff: "With love,",
  },
  {
    key: "barber", job: "Barber & stylist", Template: ModernBold, handle: "zoecuts",
    subtitle: "Master Stylist · Fade District Studio", accent: "#7C3AED",
    bio: "Cuts, color, and fades by appointment. Walk out sharp, every time.",
    subject: "Re: Saturday 2:00 confirmed",
    message: "You're all set for Saturday at 2. Running late? Just reply and I'll move things around.",
    data: p({
      name: "Zoe Okafor", title: "Master Stylist", company: "Fade District Studio",
      phone: "(404) 555-0169", email: "zoe@fadedistrict.com", website: "fadedistrict.com",
      cardUrl: "swiftcard.me/ZoeOkafor-FadeDistrictStudio", photoUrl: "/showcase/zoe.jpg",
      customization: { accentColor: "#7C3AED", bgColor: "linear-gradient(135deg, #111827 0%, #6d28d9 100%)", textColor: "#ffffff", finish: "halo" },
    }),
    look: getLook("orchid"),
    socials: soc([["Instagram", "#"], ["TikTok", "#"], ["YouTube", "#"]]),
    featured: "Book a chair this week",
    grid: ["Price list", "Transformations"],
    compact: "Products I use",
    signoff: "See you soon,",
  },
];

export const ALL_PERSONAS: Persona[] = [...PERSONAS, ...VERTICAL_PERSONAS];

const ROTATE_MS = 4600;

/** The stage's own width. 724, not 692: the extra 32px is the clear gap
 *  between the centre phone and the signature panel. Callers that size a box
 *  around the stage read it from here rather than retyping it. */
export const STAGE_W = 724;

// The Swift Links page's natural column width — the mini renders the page at
// this width and scales the whole thing down as one unit, so every proportion
// (name size, chip size, tile radius) is exactly the live page's.
const LINKS_NATURAL_W = 430;
const LINKS_NATURAL_H = 1150; // taller since the page gained a featured tile + compact row
const LINKS_SCALE = 0.46;
const LINKS_W = Math.round(LINKS_NATURAL_W * LINKS_SCALE); // 198
const LINKS_H = Math.round(LINKS_NATURAL_H * LINKS_SCALE); // 529
// The PHONE's screen, shorter than the page it shows (owner, 2026-09-24: the
// Swift Links phone was "awkwardly long and skinny"). Sized to the whole page,
// its body stood 213×544 — 2.55:1 beside the centre phone's 2.14:1. 441 gives
// it the centre phone's proportions at the same small width; the page keeps
// its size and simply continues below the fold, as it would on a real phone.
const LINKS_SCREEN_H = 441;

/** The blue scalloped verified seal from the live Swift Links page. */
function Verified({ size = 22 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" style={{ width: size, height: size }} className="shrink-0" aria-hidden="true">
      <path d="M12 1.5l2.35 2.03 3.08-.45 1.07 2.92 2.92 1.07-.45 3.08L23 12l-2.03 2.35.45 3.08-2.92 1.07-1.07 2.92-3.08-.45L12 23l-2.35-2.03-3.08.45-1.07-2.92-2.92-1.07.45-3.08L1 12l2.03-2.35-.45-3.08 2.92-1.07 1.07-2.92 3.08.45L12 1.5z" fill="#2196F3" />
      <path d="M7.5 12.2l3 3 6-6.2" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
}

/** LEFT — the persona's Swift Links page, the live page's own layout at 430px scaled down. */
/** The card page's ambient accent wash — the real page's own background. */
const phoneScreenWash = (accent: string) =>
  `linear-gradient(180deg, ${hexAlpha(accent, 0.14)} 0%, rgba(250,247,242,0) 46%), #FAF7F2`;

// The live page's hero → sheet blend (SwiftLinkProfile): an eased ramp over
// the hero's lower 55% that reaches the sheet colour at 72% and holds it, and
// for GLASS looks a mask that dissolves the photo into the wash instead. The
// mini used to end its hero on a short linear fade under a sheet with rounded
// top corners — a visible card edge across the photo that the real page
// dropped on 2026-09-02. Same numbers as the live page, so they match.
const HERO_FADE_STOPS: Array<[number, number]> = [
  [0, 0], [10, 0.04], [20, 0.12], [30, 0.25], [40, 0.4], [50, 0.56], [58, 0.7], [65, 0.83], [69, 0.94], [72, 1], [100, 1],
];
const HERO_DISSOLVE =
  "linear-gradient(180deg, rgba(0,0,0,1) 0%, rgba(0,0,0,1) 38%, rgba(0,0,0,0.88) 52%, rgba(0,0,0,0.6) 66%, rgba(0,0,0,0.28) 80%, rgba(0,0,0,0) 92%, rgba(0,0,0,0) 100%)";

function MiniLinks({ persona }: { persona: Persona }) {
  const L = persona.look;
  const text = L.text;
  const first = persona.data.name.split(" ")[0];
  // Glass looks: a colour wash fills the page and the sheet is frosted glass
  // over it, ramped in over its first 64px so its top edge never shows.
  const wash = washGradient(L);
  const sheetMeet = wash ? hexAlpha(L.sheet, L.frost ?? 0.7) : L.sheet;
  const sheetBg = wash
    ? `linear-gradient(180deg, ${hexAlpha(L.sheet, 0)} 0px, ${sheetMeet} 64px)`
    : L.sheetTo ? `linear-gradient(180deg, ${L.sheet} 0%, ${L.sheetTo} 100%)` : L.sheet;
  const heroFade = `linear-gradient(180deg, ${HERO_FADE_STOPS.map(([stop, a]) => `${hexAlpha(L.sheet, a)} ${stop}%`).join(", ")})`;
  return (
    <div style={{ width: LINKS_W, height: LINKS_H }} className="overflow-hidden">
      <div
        className="relative origin-top-left flex flex-col"
        style={{ width: LINKS_NATURAL_W, height: LINKS_NATURAL_H, transform: `scale(${LINKS_SCALE})`, background: L.sheet }}
      >
        {wash && <div aria-hidden className="absolute inset-0" style={{ background: wash }} />}
        {/* The corner bolt badge every live Swift Links page carries
            (SwiftLinksPromoBadge), top-left over the hero — below this phone's
            overlaid status bar (~53px at this page's natural scale: the 340px
            phone's 39px bar × 213/340 ÷ 0.46), where a browser's own chrome
            puts it on a real phone. */}
        <div aria-hidden className="absolute top-[67px] left-3.5 z-20 w-10 h-10 flex items-center justify-center rounded-[14px] bg-white/85 border border-black/[0.06] shadow-[0_2px_10px_rgba(15,23,42,0.18)]">
          <svg viewBox="0 0 24 24" className="w-[22px] h-[22px]">
            <path d="M13 2.5L4.5 13.5h6l-1.5 8 8.5-11h-6l1.5-8z" fill="#1d4ed8" stroke="#1d4ed8" strokeWidth="1" strokeLinejoin="round" />
          </svg>
        </div>
        {/* Hero — headshot cropped full-bleed, or the company logo shown whole
            on the page's gradient, exactly the live fallback order. Square,
            like the live cover hero at a phone's width. */}
        <div
          className="relative w-full aspect-square shrink-0 overflow-hidden"
          style={wash ? { maskImage: HERO_DISSOLVE, WebkitMaskImage: HERO_DISSOLVE } : undefined}
        >
          {persona.data.photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={persona.data.photoUrl} alt="" className="absolute inset-0 w-full h-full object-cover" />
          ) : (
            <div
              className="absolute inset-0 flex items-center justify-center p-[16%] pb-[160px]"
              // Derived from the page's own Look (2026-09-17). It used to be a
              // fixed indigo ramp, so an amber electrician or a gilt banker got
              // a purple header that belonged to neither of them.
              // p-[16%] pb-[160px] is the live page's own padding: it keeps a
              // wordmark above the long fade below, which half-erased the
              // banker's "MERIDIAN" at the old pb-[136px].
              style={{ background: `linear-gradient(160deg, ${hexAlpha(L.accent, 0.92)} 0%, ${hexAlpha(L.accent, 0.55)} 55%, ${L.sheet} 100%)` }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={persona.data.logoUrl!} alt="" className="max-w-full max-h-full w-auto h-auto object-contain" />
            </div>
          )}
          {!wash && <div className="absolute inset-x-0 bottom-0 h-[55%]" style={{ background: heroFade }} />}
        </div>

        {/* Sheet — squared top, the exact colour the fade ends on, so the
            content emerges from the photo with no seam. No backdrop blur:
            behind it is only the wash, already a smooth gradient, and a blur
            inside a drifting layer would repaint every frame for nothing. */}
        <div className="relative -mt-10 px-4 pt-7 pb-9 text-center flex-1" style={{ background: sheetBg }}>
          <div className="flex items-start justify-center gap-1.5 px-2">
            <h3 className="font-extrabold" style={{ fontSize: 32, letterSpacing: "0.25px", lineHeight: 1.15, color: text }}>
              {persona.data.name}
            </h3>
            <span className="shrink-0 mt-1.5"><Verified /></span>
          </div>
          {/* No @handle line — the live page dropped it (owner order 2026-08-26). */}
          <p className="text-[0.8125rem] font-medium mt-2" style={{ color: text, opacity: 0.6 }}>{persona.subtitle}</p>
          <p className="text-sm leading-relaxed mt-3 max-w-[340px] mx-auto" style={{ color: text, opacity: 0.75 }}>{persona.bio}</p>

          {/* The REAL brand icon row */}
          <SocialIcons socials={persona.socials} mode={L.mode} accent={L.accent} accentText={L.accentText} />

          {/* Connect — the page's hero action, ConnectButton's own look:
              chat bubble, glowing in the Look's accent. */}
          <div className="w-full mt-6 flex items-center justify-center gap-2 py-4 rounded-2xl font-bold text-[0.9375rem]" style={{ background: L.accent, color: L.accentText, boxShadow: `0 8px 24px -6px ${L.accent}59` }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.86 9.86 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
            Connect with {first}
          </div>

          {/* Links — all THREE sizes the live tile system renders for a paid
              page (owner, 2026-09-17: "play with all the features"): one
              full-width FEATURED tile, a GRID pair beneath it, then a COMPACT
              row. Gradient fallback, bottom scrim, centered title and the
              shine sweep are SwiftLinkButtons' own. */}
          <div className="w-full mt-6">
            {[{ label: persona.featured, full: true }, ...persona.grid.map((label) => ({ label, full: false }))].map(({ label, full }, i) => {
              // Same call the live page makes, so these tiles ARE the tiles a
              // visitor sees: one brand-derived ramp, indexed so neighbours
              // differ.
              const fb = fallbackTile(L, i);
              return (
              <div
                key={label}
                className={`relative overflow-hidden rounded-[14px] mb-2.5 ${full ? "block w-full aspect-[1.91/1]" : "inline-block align-top aspect-[1.91/1] w-[calc(50%-6px)]"} ${!full && i === 1 ? "mr-[12px]" : ""}`}
                style={{ background: L.tile }}
              >
                <div className="absolute inset-0" style={{ background: fb.background }} />
                <div
                  className="absolute inset-x-0 bottom-0 h-[70%]"
                  style={{
                    background: fb.light
                      ? "linear-gradient(180deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.82) 100%)"
                      : "linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0.75) 100%)",
                  }}
                />
                <span className="absolute inset-x-0 bottom-[7px] z-[6] px-2 flex justify-center">
                  <span className="font-semibold text-center leading-[1.3]" style={{ fontSize: full ? "1.25rem" : "1rem", color: fb.light ? "#0F172A" : "#ffffff", textShadow: fb.light ? "0 1px 6px rgba(255,255,255,0.7)" : "0 1px 8px rgba(0,0,0,0.6)", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                    {label}
                  </span>
                </span>
                <span className="sc-hs-shine" aria-hidden="true" />
              </div>
              );
            })}

            {/* The compact row: the quiet link at the foot of a real page —
                SwiftLinkButtons' own row (ring, icon well, label, chevron). */}
            <div
              className={`w-full mb-2.5 flex items-center gap-3 rounded-[14px] px-3.5 py-3 ${L.mode === "light" ? "ring-1 bg-white ring-black/[0.08] shadow-[0_2px_10px_rgba(15,23,42,0.06)]" : "ring-1 bg-white/[0.07] ring-white/10"}`}
            >
              <span
                className="w-[34px] h-[34px] rounded-full shrink-0 grid place-items-center text-[0.8125rem] font-bold"
                style={{ background: L.mode === "light" ? "rgba(0,0,0,0.05)" : "rgba(255,255,255,0.10)", color: text }}
              >
                {(persona.data.website || "s").charAt(0).toUpperCase()}
              </span>
              <span className="flex-1 min-w-0 text-left font-semibold text-[0.875rem] truncate" style={{ color: text }}>{persona.compact}</span>
              <svg viewBox="0 0 24 24" fill="none" stroke={text} strokeOpacity={0.4} strokeWidth={2.2} className="w-4 h-4 shrink-0" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
              </svg>
            </div>
          </div>

          {/* "View SwiftCard →", and no "Made with" footer: these are paid
              pages (verified seal), and paid pages dropped it on 2026-09-02 —
              the corner badge carries the invite instead. */}
          <div className="flex justify-center mt-10">
            <span className="inline-block px-4 py-2 text-xs" style={{ color: text, opacity: 0.5 }}>View SwiftCard →</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/** RIGHT — the Swift Signature exactly where it lives: at the foot of a
 *  received email, under the sender's reply. */
function MiniSignature({ persona }: { persona: Persona }) {
  const { Template } = persona;
  const first = persona.data.name.split(" ")[0];
  return (
    // Owner, 2026-10-01: "much clearer and much more realistic". So: a real
    // mail client's message view with real words in it (it used to be grey
    // placeholder bars and 7px labels), every line set at a size you can read
    // on the stage, and the signature exactly as EmailSignatureBox builds it —
    // the card image with a bold blue "Contact me" link under it, nothing else.
    <div className="w-[212px] rounded-[14px] overflow-hidden bg-white flex flex-col">
      {/* The mail app's window bar: traffic lights, then the message actions. */}
      <div className="flex items-center gap-[5px] px-3 h-[24px] bg-[#F6F6F8] border-b border-black/[0.07]" aria-hidden="true">
        <span className="w-[7px] h-[7px] rounded-full bg-[#ff5f57] ring-[0.5px] ring-black/10" />
        <span className="w-[7px] h-[7px] rounded-full bg-[#febc2e] ring-[0.5px] ring-black/10" />
        <span className="w-[7px] h-[7px] rounded-full bg-[#28c840] ring-[0.5px] ring-black/10" />
        <span className="ml-auto flex items-center gap-[9px] text-slate-400">
          {[
            "M4 7h16M5 7v11a2 2 0 002 2h10a2 2 0 002-2V7M4 4h16v3H4zM10 11h4",
            "M5 7h14M10 11v6M14 11v6M6 7l1 12a2 2 0 002 2h6a2 2 0 002-2l1-12M9 7V4h6v3",
            "M10 9L5 13l5 4M5 13h9a5 5 0 015 5v1",
            "M14 9l5 4-5 4M19 13h-9a5 5 0 00-5 5v1",
          ].map((d) => (
            <svg key={d} viewBox="0 0 24 24" className="w-[10px] h-[10px]" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>
          ))}
        </span>
      </div>
      {/* Message header: subject first, then sender, recipient and time —
          the order every desktop mail client reads in. */}
      <div className="px-3.5 pt-2.5 pb-2.5 border-b border-slate-100">
        <p className="text-[0.71875rem] font-bold text-slate-900 leading-tight truncate">{persona.subject}</p>
        <div className="mt-2 flex items-center gap-2">
          {persona.data.photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={persona.data.photoUrl} alt="" className="w-[24px] h-[24px] rounded-full object-cover shrink-0" />
          ) : (
            <span className="w-[24px] h-[24px] rounded-full grid place-items-center text-[0.5625rem] font-bold text-white shrink-0" style={{ background: persona.accent }}>
              {persona.data.initials}
            </span>
          )}
          <span className="min-w-0 flex-1">
            <span className="flex items-baseline justify-between gap-2">
              <span className="text-[0.65625rem] font-semibold text-slate-900 leading-tight truncate">{persona.data.name}</span>
              <span className="shrink-0 text-[0.5625rem] text-slate-400 leading-tight">9:41 AM</span>
            </span>
            <span className="block text-[0.5625rem] text-slate-500 leading-tight truncate">To: me</span>
          </span>
        </div>
      </div>
      {/* The reply, the sign-off, then the Swift Signature itself. */}
      <div className="px-3.5 pt-2.5 pb-3">
        <p className="text-[0.625rem] text-slate-700 leading-[1.5]">{persona.message}</p>
        <p className="mt-2 text-[0.625rem] text-slate-700 leading-[1.4]">{persona.signoff}</p>
        <p className="text-[0.625rem] text-slate-700 leading-[1.4]">{first}</p>
        <div className="mt-2 rounded-[7px] overflow-hidden shadow-[0_1px_3px_rgba(15,23,42,0.14)]">
          <CardScaler>
            <Template data={persona.data} />
          </CardScaler>
        </div>
        <p className="mt-1.5 text-[0.625rem] font-bold leading-none" style={{ color: "#2563eb" }}>Contact me</p>
      </div>
    </div>
  );
}

// The live card page rendered at its natural phone width and scaled down as
// one unit — every class below is the real page's own. What fits (owner:
// "do what you could fit", no scrolling): the card, Save {first}'s contact,
// the Share-your-info form, and the Swift Links box (bio, website capsule,
// brand discs). The share-this-card section and CTA don't fit and are the
// page's least-identifying pieces.
// 375 × 0.70 = 262.5, the 280px frame's own screen width: the page fills the
// glass edge to edge, as it does on a real phone, and every line is 6% larger
// than at the old 390 × 0.66 (owner, 2026-10-01: "much clearer").
const PHONE_NATURAL_W = 375;
const PHONE_NATURAL_H = 800;
const PHONE_SCALE = 0.7;

/** Safari's compact address bar, floating over the bottom of the page. It is
 *  what tells a visitor this phone is showing a LINK someone opened — the
 *  SwiftCard link — and not an app screen. Static: it belongs to the browser,
 *  so it stays put while the page inside crossfades between people. */
function SafariBar() {
  return (
    // The toolbar is its own frosted strip across the full width, as Safari
    // draws it — page content stops at its top edge instead of peeking out
    // between the pill and the home indicator.
    <div
      className="absolute inset-x-0 bottom-0 z-[27] h-[58px] pointer-events-none"
      aria-hidden="true"
      style={{
        background: "rgba(247,245,241,0.94)",
        backdropFilter: "blur(16px)",
        WebkitBackdropFilter: "blur(16px)",
        boxShadow: "inset 0 0.5px 0 rgba(15,23,42,0.10)",
      }}
    >
      <div
        className="absolute left-[12px] right-[12px] top-[8px] h-[30px] rounded-full flex items-center px-3 bg-white"
        style={{ boxShadow: "0 0 0 0.5px rgba(15,23,42,0.09), 0 1px 3px rgba(15,23,42,0.08)" }}
      >
        <span className="text-[0.625rem] font-semibold text-slate-800 leading-none tracking-[-0.02em]">
          <span className="text-[0.5rem]">A</span>A
        </span>
        <span className="flex-1 flex items-center justify-center gap-[3px] text-[0.6875rem] font-medium text-slate-900 leading-none">
          <svg viewBox="0 0 24 24" className="w-[8px] h-[8px] text-slate-500" fill="currentColor"><path d="M7 10V7a5 5 0 0110 0v3h1a1 1 0 011 1v9a1 1 0 01-1 1H6a1 1 0 01-1-1v-9a1 1 0 011-1h1zm2 0h6V7a3 3 0 00-6 0v3z" /></svg>
          swiftcard.me
        </span>
        <svg viewBox="0 0 24 24" className="w-[11px] h-[11px] text-slate-800" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 12a8 8 0 11-2.34-5.66M20 4v5h-5" />
        </svg>
      </div>
    </div>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return <p className="text-slate-900 font-bold text-[0.9375rem] tracking-tight">{children}</p>;
}

/** CENTER — the SwiftCard link, as a visitor opens it on their phone. */
function PhoneCard({ persona }: { persona: Persona }) {
  const { Template } = persona;
  const first = persona.data.name.split(" ")[0];
  const domain = persona.data.website || "";
  return (
    <div className="w-full h-full flex flex-col">
      {/* the page, natural width, scaled as one unit */}
      <div className="mx-auto overflow-hidden" style={{ width: PHONE_NATURAL_W * PHONE_SCALE, height: PHONE_NATURAL_H * PHONE_SCALE }}>
        <div className="origin-top-left flex flex-col items-center px-4 pt-2 pb-4 gap-4" style={{ width: PHONE_NATURAL_W, height: PHONE_NATURAL_H, transform: `scale(${PHONE_SCALE})` }}>

          {/* Business card */}
          <div className="w-full max-w-sm">
            <CardScaler>
              <Template data={persona.data} />
            </CardScaler>
          </div>

          {/* ── Save Contact — the page's primary action ── */}
          <div className="w-full max-w-sm rounded-2xl p-4 shadow-sm" style={{ background: "#fff", border: "1px solid #E4DDD4" }}>
            <SectionHeading>Save {first}&apos;s contact</SectionHeading>
            <div className="mt-3 w-full text-white font-semibold py-3 px-4 rounded-full text-sm flex items-center justify-center gap-2 whitespace-nowrap" style={{ background: persona.accent }}>
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.5 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
              </svg>
              Save Contact
            </div>
          </div>

          {/* ── Swift Links — bio, website capsule, brand discs ──
              Right after Save contact, as on the live page since 2026-09-22. */}
          <div className="w-full max-w-sm rounded-2xl p-4 shadow-sm" style={{ background: "#fff", border: "1px solid #E4DDD4" }}>
            <div className="flex items-center justify-between gap-3 mb-2.5">
              <SectionHeading>Swift Links</SectionHeading>
              <span className="shrink-0 text-[0.6875rem] font-medium text-slate-500 rounded-full px-2.5 py-1 bg-[#FAF7F2]" style={{ boxShadow: "inset 0 0 0 1px #EFE9E1" }}>
                View Swift Link page →
              </span>
            </div>
            <p className="text-slate-600 text-[0.8125rem] leading-[1.6]">{persona.bio}</p>
            <div className="h-px bg-[#EFE9E1] my-3" />
            <div className="flex flex-col gap-2.5">
              <span className="inline-flex self-start items-center gap-2 max-w-full h-10 rounded-full pl-1.5 pr-3 bg-white" style={{ boxShadow: "inset 0 0 0 1px #E7E0D7, 0 1px 2px rgba(15,23,42,0.04)" }}>
                <span className="shrink-0 w-7 h-7 rounded-full bg-white grid place-items-center overflow-hidden text-[0.6875rem] font-bold text-slate-500" style={{ boxShadow: "inset 0 0 0 1px #EDE6DC" }}>
                  {domain.charAt(0).toUpperCase()}
                </span>
                <span className="truncate lowercase font-medium text-[0.78125rem] tracking-[-0.004em] text-[#334155]">{domain}</span>
              </span>
              <div className="flex flex-wrap items-center gap-1.5">
                {persona.socials.map((so) => (
                  <span
                    key={so.label}
                    className="relative w-10 h-10 rounded-full grid place-items-center text-white"
                    style={{
                      background: so.label === "Instagram" ? "radial-gradient(circle at 30% 107%, #fdf497 0%, #fdf497 5%, #fd5949 45%, #d6249f 60%, #285AEB 90%)" : so.color || "rgba(15,23,42,0.85)",
                      boxShadow: "inset 0 1px 0 rgba(255,255,255,0.28), inset 0 0 0 1px rgba(15,23,42,0.06), 0 1px 2px rgba(15,23,42,0.14)",
                    }}
                  >
                    <PlatformIcon label={so.label} className="w-[18px] h-[18px] shrink-0" />
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* ── Share Your Info Back ── */}
          <div className="w-full max-w-sm rounded-2xl p-4 shadow-sm" style={{ background: "#fff", border: "1px solid #E4DDD4" }}>
            <SectionHeading>Share your info with {first}</SectionHeading>
            <div className="mt-3 space-y-2.5">
              <div className="w-full bg-white border border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-400 shadow-sm">Your name *</div>
              <div className="w-full bg-white border border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-400 shadow-sm">Your phone number *</div>
              <div className="w-full text-white font-semibold py-3 px-6 rounded-full text-sm text-center" style={{ background: persona.accent }}>
                Share My Info
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** The three-panel stage for ONE persona — shared by the rotating homepage
 *  hero and the static per-industry showcase on /for/<industry>. */
function Stage({ persona, entered, preload }: { persona: Persona; entered: boolean; preload: Persona[] }) {
  return (
    <div className="relative h-[680px] select-none pointer-events-none" style={{ width: STAGE_W }} aria-label={`Example SwiftCard: ${persona.job}`}>
      {/* Every persona's photo/logo, loaded once up front — panels remount on
          each swap, and without this the hero flashes empty for the first
          cycle while the next image fetches. */}
      <div className="hidden" aria-hidden="true">
        {preload.flatMap((pp) => [pp.data.photoUrl, pp.data.logoUrl]).filter(Boolean).map((src) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={src} src={src!} alt="" />
        ))}
      </div>

      {/* job tag */}
      <div className="absolute top-0 left-[350px] -translate-x-1/2 z-40">
        <span
          key={persona.key + "-tag"}
          className={`sc-hs-fade inline-block rounded-full bg-white/90 backdrop-blur px-3.5 py-1 text-[0.6875rem] font-bold text-slate-700 shadow-sm border border-slate-200/70 ${entered ? "" : "sc-hs-hidden"}`}
        >
          {persona.job}
        </span>
      </div>

      {/* CENTER — the phone. Crossfades between personas (link.me's center).
          The shell is the shared PhoneFrame: real iPhone geometry, Dynamic
          Island, titanium rail, glass. 582 + the frame's own 17px of rail and
          bezel lands back on the 600px height this stage was laid out around,
          so nothing else on the stage moves. */}
      <div className="absolute left-[210px] top-[34px] z-20">
        <PhoneFrame
          width={280}
          // SQUARE TO THE PAGE. Owner's call, 2026-09-11: -1.6° → -0.8° →
          // straight. Depth on this stage is carried by four cues (scale,
          // angle, shadow, air — see the note below); the phone gives up the
          // angle and keeps the other three, and the flanking panels still sit
          // at -2° and +1.6°, so the group does not read as flat.
          //
          // 0 and not a tiny value: PhoneFrame treats a falsy tilt as "no
          // transform at all" rather than rotate(0deg), so the phone is not
          // promoted to its own compositor layer for a rotation of nothing.
          tilt={0}
          screenStyle={{ height: 582, background: phoneScreenWash(persona.accent) }}
          ariaLabel="A SwiftCard link open on a phone"
        >
          <div key={persona.key + "-phone"} className={`sc-hs-fade w-full h-full ${entered ? "" : "sc-hs-hidden"}`}>
            <PhoneCard persona={persona} />
          </div>
          <SafariBar />
        </PhoneFrame>
      </div>

      {/* THE THREE OBJECTS SIT AT THREE DEPTHS.
          Before this they did not: same shadow, same scale, same dead-flat
          angle on all three, which is why a phone and two panels read as three
          stickers laid on the page instead of a photograph of a desk.
          Depth here is carried by four cues at once, all of them small:
            • SCALE     — the far panel is 94.5%, the near one full size.
            • ANGLE     — a couple of degrees each way. Nothing in a real
                          photograph is perfectly square to the lens.
            • SHADOW    — far = wide, soft and weak; near = tighter and darker;
                          the phone (PhoneFrame) darkest of all. Distance is
                          mostly read from how hard a shadow is.
          There used to be a fifth, AIR: the far phone desaturated and lowered
          in contrast. Dropped 2026-10-01 — the owner asked for all three to be
          "much clearer", and a washed-out screen is the opposite. The angles
          came down too (-2.4° → -2°, +2.1° → +1.6°): small text on a tilt
          is rasterised soft, and these panels are mostly small text.
          The static depth transform has to live on its own element because the
          drift keyframes animate `transform` — one element cannot hold both. */}

      {/* LEFT flanker — the full Swift Links page, furthest back. IN FRONT of
          the phone's edge (owner: nothing may hide under the phone).
          It now sits in a REAL phone (owner, 2026-09-17: "make these look way
          more realistic") — a Swift Links page is something you open on a
          phone, and a second device reads as a desk instead of a floating
          slab. 213px body ≈ the 198px page width this panel is drawn at. */}
      <div
        // 140, not 96: the phone lost 88px of height, and half of it goes to
        // the top so the device keeps the same centre on the stage.
        className="absolute left-0 top-[140px] z-10"
        // 0.9, not 0.945: the page is in a phone body now (213px wide), and at
        // 0.945 its right edge slipped under the centre phone — the owner’s
        // standing rule is that nothing hides under it. Smaller also reads as
        // further away, which is the point of this panel.
        style={{ transform: "rotate(-2deg) scale(0.9)", transformOrigin: "left center" }}
      >
        {/* The shadow the device casts on the surface it rests on. */}
        <span className="sc-hs-ground" style={{ left: "6%", right: "6%", bottom: -14, height: 26 }} aria-hidden="true" />
        <div className="sc-hs-drift">
          <PhoneFrame
            width={213}
            tilt={0}
            statusBar="overlay"
            statusTone={persona.look.mode === "light" ? "dark" : "light"}
            indicatorTone={persona.look.mode === "light" ? "dark" : "light"}
            screenStyle={{ height: LINKS_SCREEN_H, background: persona.look.sheet }}
            ariaLabel="A Swift Links page open on a phone"
          >
            <div key={persona.key + "-links"} className={`sc-hs-slide-l ${entered ? "" : "sc-hs-hidden-l"}`}>
              <MiniLinks persona={persona} />
            </div>
          </PhoneFrame>
        </div>
      </div>

      {/* RIGHT flanker — Swift Signature, nearest the viewer, sits low.
          Clear of the phone (owner, 2026-10-01: it was "touching behind the
          phone" — its left edge sat on the phone's power button). The stage
          is STAGE_W wide so that this panel, pinned to the right, starts 22px
          past the phone's right edge with nothing tucked under anything. */}
      <div
        className="absolute right-0 bottom-[70px] z-10"
        style={{ transform: "rotate(1.6deg)", transformOrigin: "right center" }}
      >
        <span className="sc-hs-ground" style={{ left: "8%", right: "8%", bottom: -12, height: 22 }} aria-hidden="true" />
        <div className="rounded-[14px] shadow-[0_18px_38px_-12px_rgba(8,10,18,0.5),0_3px_8px_-2px_rgba(8,10,18,0.32)] ring-1 ring-black/5 sc-hs-drift" style={{ animationDelay: "1.4s", animationDuration: "5.1s" }}>
          <div key={persona.key + "-sig"} className={`sc-hs-slide-r ${entered ? "" : "sc-hs-hidden-r"}`}>
            <MiniSignature persona={persona} />
          </div>
        </div>
      </div>

      <style>{`
        /* The hand-off between people. The three objects do not move as one
           block: the far phone leads, the near signature follows a beat later,
           and each drifts a little as it fades, the way a rack focus moves
           between things at different distances. */
        .sc-hs-fade { transition: opacity 0.42s ease, transform 0.42s cubic-bezier(0.25,1,0.5,1); opacity: 1; transform: scale(1); transition-delay: 0.06s; }
        .sc-hs-hidden { opacity: 0; transform: scale(0.985); transition-delay: 0s; }
        .sc-hs-slide-l { transition: opacity 0.46s ease, transform 0.46s cubic-bezier(0.25,1,0.5,1); opacity: 1; transform: translate3d(0,0,0) scale(1); }
        .sc-hs-hidden-l { opacity: 0; transform: translate3d(-26px,8px,0) scale(0.97); }
        .sc-hs-slide-r { transition: opacity 0.46s ease 0.12s, transform 0.46s cubic-bezier(0.25,1,0.5,1) 0.12s; opacity: 1; transform: translate3d(0,0,0) scale(1); }
        .sc-hs-hidden-r { opacity: 0; transform: translate3d(26px,10px,0) scale(0.97); transition-delay: 0s; }
        /* Contact shadow: what a device resting on a surface actually casts. */
        .sc-hs-ground { position: absolute; z-index: -1; border-radius: 9999px; pointer-events: none;
          background: radial-gradient(60% 50% at 50% 50%, rgba(8,10,18,0.30), rgba(8,10,18,0) 72%); filter: blur(6px); }
        @keyframes sc-hs-drift { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-6px); } }
        .sc-hs-drift { animation: sc-hs-drift 4.2s ease-in-out infinite; }
        @keyframes sc-hs-shine { 0% { transform: translateX(-160%) skewX(-18deg); } 55%, 100% { transform: translateX(320%) skewX(-18deg); } }
        .sc-hs-shine { position: absolute; top: -10%; bottom: -10%; left: 0; width: 45%; pointer-events: none;
          background: linear-gradient(105deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.25) 50%, rgba(255,255,255,0) 100%);
          animation: sc-hs-shine 3.8s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) {
          .sc-hs-fade, .sc-hs-slide-l, .sc-hs-slide-r { transition: none; }
          .sc-hs-drift, .sc-hs-shine { animation: none; }
        }
      `}</style>
    </div>
  );
}

export default function HeroShowcase() {
  const [idx, setIdx] = useState(0);
  const [entered, setEntered] = useState(true);
  const reduced = useRef(false);

  useEffect(() => {
    try {
      reduced.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch { /* default: animate */ }
    if (reduced.current) return;
    const t = setInterval(() => {
      setEntered(false);
      // Brief out-phase (flankers slide back out, center fades) then swap.
      setTimeout(() => {
        setIdx((i) => (i + 1) % PERSONAS.length);
        setEntered(true);
      }, 380);
    }, ROTATE_MS);
    return () => clearInterval(t);
  }, []);

  return <Stage persona={PERSONAS[idx]} entered={entered} preload={PERSONAS} />;
}

/** One persona, standing still — the /for/<industry> hero. `scale` draws the
 *  STAGE_W×680 stage smaller while keeping its layout box the scaled size. */
export function PersonaShowcase({ personaKey, scale = 1 }: { personaKey: string; scale?: number }) {
  const persona = ALL_PERSONAS.find((pp) => pp.key === personaKey);
  if (!persona) return null;
  return (
    <div style={{ width: Math.round(STAGE_W * scale), height: Math.round(680 * scale) }}>
      <div className="origin-top-left" style={{ transform: `scale(${scale})` }}>
        <Stage persona={persona} entered preload={[persona]} />
      </div>
    </div>
  );
}
