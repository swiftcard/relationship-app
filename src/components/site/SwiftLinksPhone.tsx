"use client";

import { useState } from "react";
import SocialIcons from "@/components/SocialIcons";
import { getLook, hexAlpha, fallbackTile } from "@/lib/swiftlink-looks";
import PhoneFrame from "@/components/PhoneFrame";

// Marketing phone for the SwiftLinks section. A plain phone frame whose screen
// replicates the REAL Swift Links page (SwiftLinkProfile + SwiftLinkButtons) —
// the corner bolt badge, a full-bleed hero photo dissolving into the page on
// the live page's long eased fade, a squared sheet, name + verified seal,
// socials, the glowing Connect button, section headers, and all three link
// sizes (featured, grid, compact) — and scrolls inside the phone exactly like
// the live page. Everything is display-only (pointer-events:none); only
// scrolling is live.
//
// Drawn rather than rendered with the real components on purpose: the real
// link tiles fetch a preview for every link (/api/link-preview, /api/img-proxy),
// which would cost every homepage visitor a burst of server requests for a
// picture. Every number below is the live page's own, so keep them in step
// when SwiftLinkProfile / SwiftLinkButtons change. Updated 2026-10-02 to the
// page as it is since the 09-02..09-17 redesign (owner: "update the phone with
// the Swift Links example and remove 'made with swiftcard.me' from there" —
// it is a paid page, and paid pages have no footer since 2026-09-02).
//
// The colors come from the REAL look library, pinned to Nebula (the gradient
// flagship) with squircle/accent icon chips — so the mock showcases the Looks,
// icon styling, and section headers the product actually ships, and follows
// automatically if the Nebula palette is ever retuned.

const LOOK = getLook("nebula");
const SHEET = LOOK.sheet;
const SHEET_TO = LOOK.sheetTo ?? LOOK.sheet;
const PAGE = LOOK.page;
const TEXT = LOOK.text;
const LIGHT = LOOK.mode === "light";

// SwiftLinkProfile's hero → sheet blend: an eased ramp over the hero's lower
// 55% that reaches the sheet colour at 72% and holds it.
const HERO_FADE = `linear-gradient(180deg, ${[
  [0, 0], [10, 0.04], [20, 0.12], [30, 0.25], [40, 0.4], [50, 0.56], [58, 0.7], [65, 0.83], [69, 0.94], [72, 1], [100, 1],
].map(([stop, a]) => `${hexAlpha(SHEET, a)} ${stop}%`).join(", ")})`;

const SOCIALS = [
  { label: "Website", href: "#", color: "#1D4ED8" },
  { label: "LinkedIn", href: "#", color: "#0A66C2" },
  { label: "Instagram", href: "#", color: "#E1306C" },
  { label: "TikTok", href: "#", color: "#010101" },
  { label: "X / Twitter", href: "#", color: "#000000" },
];

// Sample links in the three sizes a paid page offers (Social design → Link
// buttons): a featured video, a grid pair of image previews, a featured tile
// with no picture (built from the Look, as the live page does), and a compact
// row. Section headers render exactly like the live page's chapter titles.
type Tile = {
  label: string;
  kind: "header" | "featured" | "grid" | "compact";
  img?: string;
  video?: boolean;
};
const TILES: Tile[] = [
  { label: "On the market", kind: "header" },
  { label: "Neighborhood tour", kind: "featured", img: "/marketing/ll-video.jpg", video: true },
  { label: "See current listings", kind: "grid", img: "/marketing/ll-listings.jpg" },
  { label: "From the blog", kind: "grid", img: "/marketing/ll-blog.jpg" },
  { label: "Work with me", kind: "header" },
  { label: "Book a viewing", kind: "featured" },
  { label: "Read client reviews", kind: "compact" },
];

function VerifiedBadge({ className = "w-[22px] h-[22px]" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={`${className} shrink-0`} aria-label="Verified">
      <path d="M12 1.5l2.35 2.03 3.08-.45 1.07 2.92 2.92 1.07-.45 3.08L23 12l-2.03 2.35.45 3.08-2.92 1.07-1.07 2.92-3.08-.45L12 23l-2.35-2.03-3.08.45-1.07-2.92-2.92-1.07.45-3.08L1 12l2.03-2.35-.45-3.08 2.92-1.07 1.07-2.92 3.08.45L12 1.5z" fill="#2196F3" />
      <path d="M7.5 12.2l3 3 6-6.2" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
}

function LinkTile({ t, index }: { t: Tile; index: number }) {
  // SwiftLinkButtons' section header: an uppercase chapter title in the Look's
  // text color, not a destination.
  if (t.kind === "header") {
    return (
      <p className="w-full text-left text-[0.6875rem] font-bold uppercase tracking-[0.14em] mt-4 mb-1.5 px-0.5" style={{ color: TEXT, opacity: 0.55 }}>
        {t.label}
      </p>
    );
  }

  // SwiftLinkButtons' COMPACT row on a dark Look: translucent row with a ring,
  // icon well, label, chevron.
  if (t.kind === "compact") {
    return (
      <div className={`w-full mb-2.5 flex items-center gap-3 rounded-[14px] px-3.5 py-3 ${LIGHT ? "ring-1 bg-white ring-black/[0.08] shadow-[0_2px_10px_rgba(15,23,42,0.06)]" : "ring-1 bg-white/[0.07] ring-white/10"}`}>
        {/* The live row's icon well; with no favicon it shows the link glyph. */}
        <span className={`w-[34px] h-[34px] rounded-full shrink-0 flex items-center justify-center ${LIGHT ? "bg-black/[0.05]" : "bg-white/10"}`}>
          <svg viewBox="0 0 24 24" fill="none" stroke={TEXT} strokeOpacity={0.7} strokeWidth={2} className="w-4 h-4">
            <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244" />
          </svg>
        </span>
        <span className="flex-1 min-w-0 text-left text-[0.875rem] font-semibold truncate" style={{ color: TEXT }}>{t.label}</span>
        <svg viewBox="0 0 24 24" fill="none" stroke={TEXT} strokeOpacity={0.4} strokeWidth={2.2} className="w-4 h-4 shrink-0">
          <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
        </svg>
      </div>
    );
  }

  // FEATURED / GRID — the 1.91:1 image card. With no picture the tile is built
  // from the page's own Look (fallbackTile), exactly as the live page does.
  const big = t.kind === "featured";
  const fb = fallbackTile(LOOK, index);
  const lightTile = !t.img && fb.light;
  return (
    <div className={`relative overflow-hidden rounded-[14px] mb-2.5 aspect-[1.91/1] ${big ? "w-full" : "w-[calc(50%-6px)]"}`} style={{ background: LOOK.tile }}>
      {t.img ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={t.img} alt="" className="absolute inset-0 w-full h-full object-cover" />
      ) : (
        <div className="absolute inset-0" style={{ background: fb.background }} />
      )}
      {/* bottom gradient so the title reads over any image */}
      <div
        className="absolute inset-x-0 bottom-0 h-[70%]"
        style={{
          background: lightTile
            ? "linear-gradient(180deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.82) 100%)"
            : "linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0.75) 100%)",
        }}
      />
      {/* play button for a video link */}
      {t.video && (
        <span className="absolute inset-0 z-[6] flex items-center justify-center">
          <span className="w-11 h-11 rounded-full bg-black/55 backdrop-blur-[2px] flex items-center justify-center">
            <svg viewBox="0 0 24 24" fill="#fff" className="w-5 h-5 ml-0.5"><path d="M8 5v14l11-7z" /></svg>
          </span>
        </span>
      )}
      {/* centered title */}
      <span className="absolute inset-x-0 bottom-[7px] z-[6] px-2 flex justify-center">
        <span
          className={`font-semibold text-center leading-[1.3] ${big ? "text-[1.125rem]" : "text-[1rem]"}`}
          style={{ color: lightTile ? "#0F172A" : "#ffffff", textShadow: lightTile ? "0 1px 6px rgba(255,255,255,0.7)" : "0 1px 8px rgba(0,0,0,0.6)" }}
        >
          {t.label}
        </span>
      </span>
      <span className="rd-ll-shine" aria-hidden="true" />
    </div>
  );
}

function Profile() {
  return (
    <div className="relative" style={{ background: SHEET }}>
      {/* The corner bolt badge every live Swift Links page carries (top-left,
          scrolls away with the hero). Below this phone's 39px status bar, the
          way a browser's own chrome sits above a real page. */}
      <div className="absolute top-[53px] left-3.5 z-20 w-10 h-10 flex items-center justify-center rounded-[14px] bg-white/85 backdrop-blur-md border border-black/[0.06] shadow-[0_2px_10px_rgba(15,23,42,0.18)]">
        <svg viewBox="0 0 24 24" className="w-[22px] h-[22px]" aria-hidden="true">
          <path d="M13 2.5L4.5 13.5h6l-1.5 8 8.5-11h-6l1.5-8z" fill="#1d4ed8" stroke="#1d4ed8" strokeWidth="1" strokeLinejoin="round" />
        </svg>
      </div>

      {/* Hero — full-bleed photo, dissolving into the page on the live page's
          long eased fade (no rounded sheet edge since 2026-09-02). */}
      <div className="relative w-full aspect-square overflow-hidden">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/marketing/demo-girl.jpg" alt="Alex Morgan" className="absolute inset-0 w-full h-full object-cover" />
        <div className="absolute inset-x-0 bottom-0 h-[55%] pointer-events-none" style={{ background: HERO_FADE }} />
      </div>

      {/* Sheet — squared top, the exact colour the fade ends on. */}
      <div className="relative -mt-10 px-4 pt-7 pb-9 text-center" style={{ background: `linear-gradient(180deg, ${SHEET} 0%, ${SHEET_TO} 100%)` }}>
        <div className="flex items-start justify-center gap-1.5 px-2">
          <h3 className="font-extrabold min-w-0" style={{ fontSize: 32, letterSpacing: "0.25px", lineHeight: 1.15, color: TEXT }}>Alex Morgan</h3>
          <span className="shrink-0 mt-1.5"><VerifiedBadge /></span>
        </div>
        {/* No @handle line — the live page dropped it (owner order 2026-08-26). */}
        <p className="text-[0.8125rem] font-medium mt-2" style={{ color: TEXT, opacity: 0.6 }}>Realtor®&nbsp;&nbsp;·&nbsp;&nbsp;Coastline Realty</p>
        <p className="text-sm leading-relaxed mt-3 max-w-[340px] mx-auto" style={{ color: TEXT, opacity: 0.75 }}>Building things people love. Tap a link below to connect, book, or take a look</p>

        {/* Social icons (display-only) */}
        {/* Squircle chips in the Look's accent — the icon shape × fill styling
            the product's "Social design" step offers. */}
        <div style={{ pointerEvents: "none" }}>
          <SocialIcons socials={SOCIALS} mode={LIGHT ? "light" : "dark"} shape="squircle" fill="accent" accent={LOOK.accent} accentText={LOOK.accentText} />
        </div>

        {/* Connect (display-only) — ConnectButton's own look: taller and
            bolder than any tile, glowing in the Look's accent. */}
        <div className="w-full mt-6" style={{ pointerEvents: "none" }}>
          <div className="w-full flex items-center justify-center gap-2 py-4 rounded-2xl font-bold text-[0.9375rem]" style={{ background: LOOK.accent, color: LOOK.accentText, boxShadow: `0 8px 24px -6px ${LOOK.accent}59` }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.86 9.86 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" /></svg>
            Connect with Alex
          </div>
        </div>

        {/* Links — featured, grid and compact (display-only) */}
        <div className="w-full mt-6 flex flex-wrap justify-between" style={{ pointerEvents: "none" }}>
          {TILES.map((t, i) => (
            <LinkTile key={t.label} t={t} index={i} />
          ))}
        </div>

        {/* "View SwiftCard →" — and no "Made with" footer: this is a paid page
            (verified seal), and paid pages dropped it on 2026-09-02. */}
        <div className="flex justify-center mt-10">
          <span className="inline-block px-4 py-2 text-xs" style={{ color: TEXT, opacity: 0.5 }}>View SwiftCard →</span>
        </div>
      </div>
    </div>
  );
}

export default function SwiftLinksPhone() {
  const [scrolled, setScrolled] = useState(false);

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="flex items-center gap-1.5 text-slate-400 text-[0.75rem] font-medium">
        <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2}><path d="M12 5v14M12 19l-4-4M12 19l4-4" strokeLinecap="round" strokeLinejoin="round" /></svg>
        Scroll on phone to view
      </div>
      {/* The cap must be a DEFINITE length, and this is the third thing tried —
          the other two were measured and rejected, so the reasoning is recorded:
          this phone is a grid item, and its fixed width sets the grid TRACK to
          340px, which on the single-column mobile layout dragged the sibling
          TEXT column to 340px too and cut the section's heading and paragraph
          off mid-word at 320px.
            • max-w-full (percentage) — no effect: a percentage max-width can't
              reduce an item's contribution to track sizing. Track stayed 340.
            • w-full max-w-[340px] — collapsed the phone to 135px, because with
              no intrinsic width left the track shrank to the text's needs and
              w-full then resolved against that.
          calc(100vw-40px) is definite, so it DOES constrain the track, and it
          mirrors the section's own px-5 (20px each side). Above ~380px viewport
          it exceeds 340 and binds nothing, so every normal phone and desktop
          renders exactly as before. */}
      {/* One shared iPhone for the whole site — see components/PhoneFrame.
          maxWidth goes through `style`, not a class: PhoneFrame sets
          maxWidth:100% inline and spreads `style` after it, so a caller's
          value wins — a Tailwind class would lose to the inline one. */}
      <PhoneFrame
        width={340}
        statusBar="overlay"
        statusTone="light"
        style={{ maxWidth: "calc(100vw - 40px)" }}
        screenStyle={{ height: 610, background: PAGE }}
        indicatorTone="light"
      >
        {/* Sticky mini header — fades in once the hero scrolls away. It sits
            UNDER the status bar and the Dynamic Island, which is how a real app
            behaves: both are the system's, drawn over the app. The 39px top
            padding is this phone's status-bar height, so the header's content
            clears it while its blur still reaches the very top edge. */}
        <div className="absolute top-0 inset-x-0 z-[25] h-[93px] pt-[39px] flex items-center gap-2.5 px-4 transition-opacity duration-300" style={{ background: hexAlpha(SHEET, 0.84), backdropFilter: "blur(14px)", opacity: scrolled ? 1 : 0, pointerEvents: "none" }}>
          <div className="w-8 h-8 rounded-full overflow-hidden shrink-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/marketing/demo-girl.jpg" alt="" className="w-full h-full object-cover" />
          </div>
          <span className="font-bold text-[0.9375rem] truncate" style={{ color: TEXT }}>Alex Morgan</span>
          <VerifiedBadge className="w-4 h-4" />
        </div>
        <div className="absolute inset-0 overflow-y-auto rd-scrollbar-none" onScroll={(e) => setScrolled((e.target as HTMLDivElement).scrollTop > 230)}>
          <Profile />
        </div>
      </PhoneFrame>
    </div>
  );
}
