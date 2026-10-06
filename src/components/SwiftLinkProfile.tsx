"use client";

// Link-in-bio profile layout modeled on link.me: a full-bleed hero photo that a
// dark rounded "sheet" scrolls up over, big bold name + verified badge,
// @username, a brand-colored social icon row, then rich featured-link cards.
// Mobile-first (this lives in Instagram/TikTok/X bios) — on desktop the same
// column renders centered at phone width.

import { useEffect, useState } from "react";
import ConnectButton from "@/components/ConnectButton";
import SocialIcons, { type BrandSocial } from "@/components/SocialIcons";
import { SwiftCardIcon } from "@/components/SwiftCardLogo";
import SwiftLinkButtons from "@/components/SwiftLinkButtons";
import SwiftLinksPromoBadge from "@/components/SwiftLinksPromoBadge";
import { getLook, hexAlpha, normalizeIconShape, normalizeIconFill, normalizeHeroStyle, normalizeHeroContent, normalizeButtonStyle, pageMediaUrl, normalizePageMediaType, normalizePageDim, PAGE_MEDIA_BASE, washGradient } from "@/lib/swiftlink-looks";

// Owner-picked "Social design": a named Look (every plan — Free gets the free
// pair, see lib/swiftlink-looks) plus optional Pro fine-tuning (bg/text/font)
// layered on top of it. No style at all → the default Look ("Paper", light).
// heroStyle ("cover"/"avatar") and buttonStyle/buttonColor are the 2026-09-01
// Linktree-informed additions — see lib/swiftlink-looks for the vocabulary.
export type SwiftLinkPageStyle = {
  look?: string; bg?: string; text?: string; font?: string;
  iconShape?: string; iconFill?: string;
  heroStyle?: string; heroContent?: string; heroImage?: string;
  /** "video" when heroImage is a short video (plays muted on a loop). */
  heroMediaType?: string;
  buttonStyle?: string; buttonColor?: string;
  /** Overrides the Look's accent: the Connect button, and social icons set to
   *  "Accent". Link rows fall back to it when they have no colour of their
   *  own, so one choice moves every call to action together. */
  accent?: string;
  /** Page BACKGROUND media — a photo or short video behind the whole page,
   *  behind every header style. See lib/swiftlink-looks. */
  bgMedia?: string; bgMediaType?: string; bgDim?: number; glass?: boolean;
};

type LinkItem = { emoji: string; label: string; url: string; size?: "featured" | "grid" | "compact"; kind?: "link" | "header"; rowStyle?: "tile" | "solid" | "outline"; media?: { url: string; type: "image" | "video" }; glass?: boolean };

// Perceived lightness of a hex surface — decides whether neutral chrome
// (rings, hover wells) should be dark-on-light or light-on-dark when a Pro
// custom background replaces the Look's sheet.
function isLightHex(hex: string): boolean {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex);
  if (!m) return false;
  const n = parseInt(m[1], 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 > 0.5;
}

/**
 * The alpha ramp that dissolves a cover/banner photo into a GLASS look's wash.
 *
 * Eased rather than linear, and fully transparent by 92% rather than 100%: a
 * straight ramp leaves a faint but perfectly straight band of photo at the very
 * bottom edge, which reads as a line for the same reason the colour fade did.
 * Ending early means the last few percent are already empty when the sheet's
 * top edge overlaps them.
 */
const HERO_DISSOLVE =
  "linear-gradient(180deg, rgba(0,0,0,1) 0%, rgba(0,0,0,1) 38%, rgba(0,0,0,0.88) 52%, rgba(0,0,0,0.6) 66%, rgba(0,0,0,0.28) 80%, rgba(0,0,0,0) 92%, rgba(0,0,0,0) 100%)";

function initialsOf(name: string) {
  return name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2);
}

function VerifiedBadge({ className = "w-[22px] h-[22px]" }: { className?: string }) {
  // Blue scalloped verified seal with a white check.
  return (
    <svg viewBox="0 0 24 24" className={`${className} shrink-0`} aria-label="Verified">
      <path
        d="M12 1.5l2.35 2.03 3.08-.45 1.07 2.92 2.92 1.07-.45 3.08L23 12l-2.03 2.35.45 3.08-2.92 1.07-1.07 2.92-3.08-.45L12 23l-2.35-2.03-3.08.45-1.07-2.92-2.92-1.07.45-3.08L1 12l2.03-2.35-.45-3.08 2.92-1.07 1.07-2.92 3.08.45L12 1.5z"
        fill="#2196F3"
      />
      <path d="M7.5 12.2l3 3 6-6.2" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
}

export default function SwiftLinkProfile({
  name,
  username,
  photoUrl,
  logoUrl = null,
  subtitle,
  bio,
  verified,
  socials,
  links,
  appUrl,
  pageStyle,
  embedded = false,
  paidTiles = false,
  showCardLink = true,
  brandingFooter = true,
  trackFor = null,
  trackSource = "swift_links",
  suppressTracking = false,
}: {
  name: string;
  username: string;
  photoUrl: string | null;
  /** The card's logo, used for the hero ONLY when there is no headshot.
   *  Optional so any caller that has no logo keeps the initials fallback. */
  logoUrl?: string | null;
  subtitle: string;
  bio: string;
  verified: boolean;
  socials: BrandSocial[];
  links: LinkItem[];
  appUrl: string;
  /** Owner's "Social design" (Pro) — falls back to the stock dark look. */
  pageStyle?: SwiftLinkPageStyle;
  /** Rendered inside a live PREVIEW (card wizard/editor, mini-builders) rather
   *  than as the standalone page: flow at the container width with no full-page
   *  height/background/margins, and skip the scroll-driven mini header (there's
   *  no page scroll to drive it). Everything else — hero, bio, socials, link
   *  cards, footer — is byte-for-byte the real page, so the preview is exact. */
  embedded?: boolean;
  /** Paid owner: featured/grid image tiles + inline video. Defaults FALSE —
   *  fails closed to the Free rendering (every link compact). */
  paidTiles?: boolean;
  /** The CARD SLUG this page belongs to, for outbound-link tracking. Null (the
   *  default) records nothing — this component also renders inside the live
   *  designer and the marketing mocks, where a tap is not a visitor's tap. */
  trackFor?: string | null;
  /** The page's own ?source= attribution, inherited by every tap on it. */
  trackSource?: string;
  /** Owner looking at their own Swift Links page. */
  suppressTracking?: boolean;
  /** Owner toggle (Social design step): the faint "View SwiftCard →" link at
   *  the bottom. ON by default — hiding it is the owner's explicit choice. */
  showCardLink?: boolean;
  /** "Made with swiftcard.me" footer — FREE plan only (owner order
   *  2026-09-02, superseding the 2026-08-11 every-plan rule for THIS surface:
   *  the top-left bolt badge now carries the invite on every plan, so paid
   *  pages drop the footer). Defaults true so a caller that doesn't know the
   *  plan fails toward attribution. */
  brandingFooter?: boolean;
}) {
  // Header layout: "cover" (default — the original full-photo hero the sheet
  // slides over), "banner" (the same at a third of the screen), "avatar"
  // (compact circle on the sheet) or "none" (one flat page, no header).
  const heroStyle = normalizeHeroStyle(pageStyle?.heroStyle);
  const heroBanner = heroStyle === "banner";
  const heroAvatar = heroStyle === "avatar";
  // Avatar and none both start the sheet at the very top of the page.
  const flatTop = heroStyle === "avatar" || heroStyle === "none";

  // What the header SHOWS — the owner's explicit pick, falling down the auto
  // chain (headshot → logo → initials) whenever the picked asset doesn't
  // exist, so the header can never render empty.
  const heroContent = normalizeHeroContent(pageStyle?.heroContent);
  // "custom" is an owner-uploaded header photo (https-only — the URL comes
  // through client-writable customization, so anything else falls through to
  // the auto chain rather than rendering an arbitrary scheme on a public
  // page). It renders exactly like a headshot: cover-cropped in the hero,
  // circle-cropped in the compact avatar.
  const customHero = heroContent === "custom" && pageStyle?.heroImage && /^https:\/\//.test(pageStyle.heroImage)
    ? pageStyle.heroImage
    : null;
  // A header VIDEO renders where a photo would — cover-cropped in the hero,
  // circle-cropped in the compact avatar — autoplaying, muted, on a loop.
  const hero: { kind: "photo" | "video" | "logo" | "initials"; url: string | null } =
    customHero ? { kind: pageStyle?.heroMediaType === "video" ? "video" : "photo", url: customHero } :
    heroContent === "initials" ? { kind: "initials" as const, url: null } :
    heroContent === "photo" && photoUrl ? { kind: "photo" as const, url: photoUrl } :
    heroContent === "logo" && logoUrl ? { kind: "logo" as const, url: logoUrl } :
    photoUrl ? { kind: "photo" as const, url: photoUrl } :
    logoUrl ? { kind: "logo" as const, url: logoUrl } :
    { kind: "initials" as const, url: null };

  // ── Page background media ─────────────────────────────────────────────────
  // A photo or short video behind the WHOLE page, under every header style
  // (owner, 2026-09-17). With a cover or banner the hero dissolves into it —
  // see the mask on the hero below.
  //
  // https-only (pageMediaUrl): the URL comes through client-writable
  // customization and is printed into a src on a public page.
  const bgMedia = pageMediaUrl(pageStyle?.bgMedia);
  const bgMediaVideo = bgMedia !== null && normalizePageMediaType(pageStyle?.bgMediaType) === "video";
  const bgDim = normalizePageDim(pageStyle?.bgDim);

  // Mini header fades in once the hero scrolls out from under it. Not in a
  // preview: there's no page scroll, so it would just sit invisible. Shorter
  // headers get proportionally earlier thresholds.
  const scrollThreshold = heroStyle === "cover" ? 230 : heroBanner ? 150 : heroAvatar ? 96 : 60;
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    if (embedded) return;
    const onScroll = () => setScrolled(window.scrollY > scrollThreshold);
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, [embedded, scrollThreshold]);

  const firstName = name.split(" ")[0] || username;
  const initials = initialsOf(name || username);

  // Resolved page look: the named Look supplies the whole scheme, and the Pro
  // fine-tune keys (bg/text) override it individually where set.
  const look = getLook(pageStyle?.look);
  // With background media the sheet is TRANSPARENT and this colour only shows
  // in the moment before the photo decodes (or forever, if it 404s). It is
  // pinned near-black rather than following the Look or the owner's custom
  // colour because the text over it is forced white below — a light sheet
  // there would be an unreadable page, which is precisely the failure a
  // background feature must not be able to produce.
  const sheetBg = bgMedia ? PAGE_MEDIA_BASE : (pageStyle?.bg || look.sheet);
  // Same reason: a light Look's near-black body text is invisible on a dimmed
  // photo. The owner's own explicit text colour still wins — they can see the
  // result live in the preview.
  const textColor = pageStyle?.text || (bgMedia ? "#ffffff" : look.text);
  const pageFont = pageStyle?.font;
  // Gradient and Aura are properties of the LOOK's surface, so a Pro custom
  // background (which replaces that surface) turns them off — otherwise the
  // custom color would paint over half the effect and leave the rest orphaned.
  const sheetTo = pageStyle?.bg || bgMedia ? undefined : look.sheetTo;
  // Aura is the owner's headshot blurred behind a glass sheet. Background
  // media replaces exactly that surface, so the two cannot both run — the
  // same reason a custom background colour turns Aura off.
  const auraOn = !pageStyle?.bg && !bgMedia && !!look.aura && !!photoUrl;
  // The GLASS family's colour wash — the same mechanic as Aura with a designed
  // gradient behind the frost instead of the owner's photo, so it needs no
  // headshot to look like anything. Turned off by the same two things that
  // turn Aura off, for the same reason: both replace this exact surface.
  const wash = !pageStyle?.bg && !bgMedia && !auraOn ? washGradient(look) : null;
  // One flag for "the sheet is frosted glass over something", so every piece
  // of chrome that has to meet that surface is computed once rather than
  // asking about Aura and the wash separately and eventually disagreeing.
  const glassOn = auraOn || !!wash;
  // Aura's 0.42 is kept exactly — existing Aura pages must not shift. A wash
  // look carries its own alpha, which is part of its AA sum (swiftlink-looks).
  const glassAlpha = auraOn ? 0.42 : (look.frost ?? 0.7);
  // The one color the sheet's chrome (hero fade end-stop, glass tint) meets:
  // solid for normal looks, a translucent tint of the same hex for glass ones
  // so what is behind glows through.
  const sheetMeet = glassOn ? hexAlpha(sheetBg, glassAlpha) : sheetBg;
  // A custom Pro background can flip the effective mode out from under the
  // Look, and the neutral chrome (rings, hovers, hero fade edge) must follow
  // the SURFACE, not the label — judge the sheet actually in use.
  // Neutral chrome (rings, hover wells, the icon set) follows the SURFACE in
  // use. Over dimmed media that surface is dark, whatever the Look says.
  const light = bgMedia ? false : pageStyle?.bg ? isLightHex(pageStyle.bg) : look.mode === "light";

  // The accent — the Connect button and any social chip set to "Accent".
  //
  // The Look's own accent/accentText pair is AA-tested against each other
  // (swiftlink-looks). An owner's custom colour cannot be, so its label colour
  // is DERIVED from its lightness the same way the Solid/Outline link rows
  // already derive theirs. Anything that is not a plain 6-digit hex falls back
  // to the Look rather than reaching a public page: this value arrives through
  // client-writable customization.
  const customAccent = pageStyle?.accent && /^#[0-9a-fA-F]{6}$/.test(pageStyle.accent) ? pageStyle.accent : null;
  const accent = customAccent ?? look.accent;
  const accentText = customAccent ? (isLightHex(customAccent) ? "#111827" : "#FFFFFF") : look.accentText;

  // Hero → sheet fade: an EASED multi-stop ramp of the same sheet color the
  // old two-stop linear fade used (owner order 2026-09-02: the hard band
  // where the header met the information below read as "a very clear line").
  // Same start (transparent sheet hex) and same end (sheetMeet — the exact
  // surface the sheet opens with, 0.42 alpha on Aura), so no color anywhere
  // changes; only the ramp between them is smooth instead of linear.
  // The ramp reaches FULL opacity at 72% and HOLDS it to the end — buried
  // edges everywhere a discontinuity could show (owner report 2026-09-02,
  // second pass: "a very visible line"). Two edges matter: the image's own
  // hard bottom cut-off, and the SHEET's top edge, which overlaps the hero's
  // last 40px (-mt-10). The sheet top sits at (fadeH-40)/fadeH — ~83% of the
  // fade on a cover, ~72% on the short banner — so a ramp still translucent
  // there made the sheet's edge itself read as a line. Full opacity by 72%
  // covers the worst case; everything below it is one solid sheet color.
  const fadeMax = glassOn ? glassAlpha : 1;

  // A frosted sheet has a HARD TOP EDGE, and under a cover/banner hero that
  // edge is a line across the page.
  //
  // Measured on a 390px render: the sheet starts at y=353 (it overlaps the
  // hero's last 40px), and its tint appears there all at once — a row-to-row
  // luminance step of 24 on Aurora, 33 on Frost and 40 on AURA, which has
  // shipped with it since the day it launched. An opaque look has no step
  // because its hero fade has already reached the sheet colour by then; a
  // translucent one cannot, because it never reaches full opacity at all.
  //
  // Ramping the tint in over the first 64px removes the edge without touching
  // a single colour: same hex, same alpha from 64px down, and `hexAlpha(.., 0)`
  // starts from the SAME hue at zero alpha so nothing shifts on the way in.
  // Only where a hero sits above it — with the compact-circle and no-header
  // layouts the sheet starts at the top of the page, where there is no edge to
  // hide and a ramp would just wash the first 64px out.
  const sheetGlassBg = flatTop
    ? sheetMeet
    : `linear-gradient(180deg, ${hexAlpha(sheetBg, 0)} 0px, ${sheetMeet} 64px)`;
  const heroFade = `linear-gradient(180deg, ${[
    [0, 0], [10, 0.04], [20, 0.12], [30, 0.25], [40, 0.4], [50, 0.56], [58, 0.7], [65, 0.83], [69, 0.94], [72, 1], [100, 1],
  ].map(([stop, a]) => `${hexAlpha(sheetBg, a * fadeMax)} ${stop}%`).join(", ")})`;

  // THE BLACK BAND AT THE BOTTOM OF A PHONE (owner, 2026-10-06). Two causes:
  // • The phone `zoom: 0.92` shrinks the sheet's own min-h-[100dvh] to 92% of
  //   the screen, so a short page ended ~68px early and the Look's darker page
  //   colour showed beneath it. The sheet now GROWS to fill main instead — flex
  //   sizing comes from the parent, so the zoom cannot shorten it.
  // • Under the page sat the site's canvas — near-black on a dark-mode phone —
  //   and Safari shows it beneath its bottom toolbar, behind the home indicator
  //   and in the bounce. The canvas now takes the colour at the bottom of the
  //   page: the sheet on a phone, the Look's page colour around the desktop card.
  // Never when embedded: that is the designer's preview, inside the app.
  // Hex only: a custom background is client-written, and this goes into a
  // stylesheet, where anything but a plain colour must not reach.
  const hex = (c: string | undefined, fallback: string) => (c && /^#[0-9a-fA-F]{6}$/.test(c) ? c : fallback);
  const lastWash = look.wash?.[look.wash.length - 1];
  const sheetHex = hex(sheetBg, look.sheet);
  const canvasPhone = wash && lastWash
    ? `color-mix(in srgb, ${sheetHex} ${Math.round(glassAlpha * 100)}%, ${hex(lastWash, sheetHex)})`
    : hex(!glassOn && sheetTo ? sheetTo : sheetBg, look.sheet);
  const canvasCss = embedded ? "" : ` :root:has(main.sc-sl-page), :root:has(main.sc-sl-page) body { background: ${hex(look.page, sheetHex)}; } @media (max-width: 767px) { :root:has(main.sc-sl-page), :root:has(main.sc-sl-page) body { background: ${canvasPhone}; } }`;

  return (
    <main className={embedded ? "" : "sc-sl-page min-h-[100dvh] flex flex-col"} style={{ background: embedded ? "transparent" : look.page }}>
      <style>{`@media (max-width: 767px) { .sc-sl-sheet { zoom: 0.92; } }${canvasCss}`}</style>
      <div
        className={`sc-sl-sheet relative mx-auto w-full max-w-[430px] overflow-hidden ${
          embedded
            ? "rounded-[30px]"
            : "grow shrink-0 md:grow-0 min-h-[100dvh] md:min-h-0 md:my-8 md:rounded-[30px] md:shadow-[0_24px_80px_rgba(0,0,0,0.6)]"
        }`}
        style={{ background: sheetBg, fontFamily: pageFont }}
      >
        {/* Page background media — the owner's photo or short video behind the
            whole page. First child so every sibling paints above it.

            FULL-HEIGHT COVER, not a viewport-locked backdrop. The reference
            page pins its video to the viewport with position:fixed; that is
            not available here and the alternatives are worse:
              • position:fixed escapes this container's overflow-hidden, so on
                desktop the media would spill past the phone-width card's
                rounded edges and margins, and in the live PREVIEW it would
                cover the editor around it.
              • position:sticky cannot reach the viewport either — measured:
                overflow-hidden on this sheet makes it the scrollport, and a
                sticky child inside a scrollport that never scrolls just moves
                away with the page.
            So the layer spans the sheet and the media covers it. The trade is
            a tighter crop on a very long page (the media's height is stretched
            to the whole scroll height); in exchange it is undistorted, clipped
            correctly on every surface, identical in the preview and the live
            page, and immune to the iOS toolbar bugs a fixed backdrop invites.

            aria-hidden + pointer-events-none: it is decoration, and it must
            never intercept a tap meant for a link above it. */}
        {bgMedia && (
          <div data-sc-pagebg aria-hidden className="absolute inset-0 pointer-events-none overflow-hidden">
            {bgMediaVideo ? (
              // Muted + playsInline + autoPlay is what iOS Safari and the
              // native shell's WKWebView require before they will start a
              // video without a tap. preload="auto" additionally leaves the
              // first frame painted when autoplay is refused anyway (Low
              // Power Mode), so the page still has its background instead of
              // a black rectangle. Same recipe as the link tiles.
              <video
                src={`${bgMedia}#t=0.001`}
                className="absolute inset-0 w-full h-full object-cover"
                autoPlay
                muted
                loop
                playsInline
                preload="auto"
                tabIndex={-1}
              />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={bgMedia} alt="" className="absolute inset-0 w-full h-full object-cover" />
            )}
            {/* The scrim. This is the only thing standing between an arbitrary
                holiday snap and unreadable white text, so it is owner-
                controlled (0-80%) with a sane default rather than fixed. */}
            <div data-sc-scrim className="absolute inset-0" style={{ background: `rgba(0,0,0,${bgDim / 100})` }} />
          </div>
        )}

        {/* The GLASS family's colour wash — the page's atmosphere, behind the
            frosted sheet and everything on it. A designed gradient rather than
            the owner's photo, which is the whole point: it looks composed on a
            card that has no headshot at all. */}
        {wash && (
          <div aria-hidden className="absolute inset-0 pointer-events-none" style={{ background: wash }} />
        )}

        {/* Aura — the owner's own photo, blurred and dimmed, as the page
            atmosphere behind everything (the glass sheet included). First
            child so every sibling paints above it; scale-125 hides the blur's
            washed-out edges outside the rounded clip. */}
        {auraOn && (
          <div aria-hidden className="absolute inset-0 pointer-events-none">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={photoUrl!} alt="" className="absolute inset-0 w-full h-full object-cover scale-125" style={{ filter: "blur(48px) saturate(1.25)" }} />
            <div className="absolute inset-0" style={{ background: "rgba(8,8,12,0.5)" }} />
          </div>
        )}

        {/* Linktree-style corner badge — invite to create your own Swift
            Links. Real page only: in a preview it's noise, and it would open
            a signup sheet inside the owner's own editor. */}
        {!embedded && <SwiftLinksPromoBadge username={username} appUrl={appUrl} />}

        {/* Sticky mini header — zero-height wrapper so it draws over the hero.
            Skipped in a preview (no page scroll to reveal it). */}
        {!embedded && (
          <div className="sticky top-0 z-30 h-0">
            <div
              className={`flex items-center gap-2.5 px-4 h-[54px] transition-opacity duration-300 md:rounded-t-[30px] ${
                scrolled ? "opacity-100" : "opacity-0 pointer-events-none"
              }`}
              style={{ background: hexAlpha(sheetBg, 0.84), backdropFilter: "blur(14px)", WebkitBackdropFilter: "blur(14px)" }}
            >
              <div className="w-8 h-8 rounded-full overflow-hidden shrink-0" style={{ background: light ? "rgba(17,24,39,0.08)" : "#2c2d2d" }}>
                {photoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={photoUrl} alt="" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-[0.6875rem] font-bold" style={{ color: textColor, opacity: 0.8 }}>{initials}</div>
                )}
              </div>
              <span className="font-bold text-[0.9375rem] truncate" style={{ color: textColor }}>{name}</span>
              {verified && <VerifiedBadge className="w-4 h-4" />}
            </div>
          </div>
        )}

        {/* Hero — the photo the sheet scrolls over ("cover", or "banner" at a
            third of the screen; "avatar" renders a compact circle inside the
            sheet instead, "none" renders nothing). What it shows is the
            resolved `hero` above — the owner's pick, or the auto chain:
            headshot, then the card's LOGO, then the initials. A business card
            without a face is usually a company card, and its logo is the
            right identity to lead with. */}
        {/* No rounding of its own (owner order 2026-09-02: the page's top
            corners must not curve in) — on desktop/embedded the OUTER card's
            overflow-hidden clips these corners, and on the phone the page is
            full-bleed square. */}
        {(heroStyle === "cover" || heroBanner) && (
        <div
          className={`relative w-full overflow-hidden ${heroBanner ? "h-[260px]" : "aspect-square max-h-[520px]"}`}
          // GLASS looks dissolve the hero into the page instead of washing it
          // with a sheet-coloured overlay.
          //
          // The colour fade below cannot work here, and the failure was ugly:
          // it ramps to `sheetMeet`, which for a glass look is the sheet at
          // ~50% alpha. So the photo was still half-visible where it ended,
          // while immediately below it the same 50% tint sat over the WASH
          // instead of over the photo — two different colours meeting at the
          // photo's bottom edge, i.e. a hard horizontal line across the page.
          // Aura never showed it because the blurred photo behind the sheet is
          // the same image the hero is fading into, so both sides matched.
          //
          // Masking the hero's own alpha removes the colour-matching problem
          // rather than solving it: the photo fades to TRANSPARENT and what
          // shows through is the wash itself, which is exactly what continues
          // below. There is nothing left to mismatch.
          // Background media dissolves the hero the same way: the fade below
          // ends on a solid colour, and over a photo or video that colour
          // would be a hard band across the page.
          style={wash || bgMedia ? {
            maskImage: HERO_DISSOLVE,
            WebkitMaskImage: HERO_DISSOLVE,
          } : undefined}
        >
          {hero.kind === "video" ? (
            <video
              src={`${hero.url}#t=0.001`}
              className={`absolute inset-0 w-full h-full object-cover ${heroBanner ? "object-top" : ""}`}
              autoPlay
              muted
              loop
              playsInline
              preload="auto"
              aria-label={name}
            />
          ) : hero.kind === "photo" ? (
            // A headshot is a photo of a person: fill the frame and crop, which
            // is what makes the link.me hero look right. The BANNER anchors the
            // crop to the TOP of the photo (faces live in the upper part of a
            // portrait) — centered cropping cut the head off and kept the torso.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={hero.url!} alt={name} className={`absolute inset-0 w-full h-full object-cover ${heroBanner ? "object-top" : ""}`} />
          ) : hero.kind === "logo" ? (
            // A LOGO is not a headshot and must not be treated like one.
            // object-cover would crop a wide wordmark down to its middle
            // letters, so it is object-CONTAIN, centred, on the same gradient
            // the initials use — the logo is shown whole, at its own aspect
            // ratio, never cut. p-[18%] keeps it clear of the rounded top
            // corners and of the sheet's fade at the bottom, so nothing eats
            // into it. A transparent PNG sits on the gradient; a square logo
            // reads as a centred emblem rather than a stretched background.
            <div
              // pb is a FIXED length, not a percentage, and that is the whole
              // point: the thing it clears — the fade below — is itself a fixed
              // height at every width, while a percentage only clears it at one
              // width (the old pb-[36%] let a square logo's bottom ~13px wash
              // out at 320px). Padding-top stays a percentage — it clears the
              // top corners, which DO scale with width.
              // Measured 2026-09-02 for the hold-opaque wash (h-[55%] of the
              // hero, fully opaque from 72% of the fade): the logo's bottom
              // edge must sit where the ramp is ≤~0.3 alpha (≤35% into the
              // fade), which is ≥65% up from the hero's bottom — 160px at
              // the widest cover, 100px on the banner, at every width.
              // Banner: fixed 56px top clearance keeps the plate out from
              // under the corner bolt badge, which floats over the short
              // banner's top-left.
              className={`absolute inset-0 flex items-center justify-center ${heroBanner ? "px-[8%] pt-[56px] pb-[100px]" : "p-[16%] pb-[160px]"}`}
              style={{ background: "linear-gradient(160deg, #181538 0%, #2A2466 60%, #4338ca 100%)" }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={hero.url!}
                alt={name}
                className="max-w-full max-h-full w-auto h-auto object-contain"
              />
            </div>
          ) : (
            <div
              className="absolute inset-0 flex items-center justify-center"
              style={{ background: "linear-gradient(160deg, #181538 0%, #2A2466 60%, #4338ca 100%)" }}
            >
              <span className={`text-white/90 font-extrabold tracking-wide ${heroBanner ? "text-5xl" : "text-7xl"}`}>{initials}</span>
            </div>
          )}
          {/* Soft fade into the sheet — ends at exactly the surface the sheet
              opens with: the solid sheet hex normally, the same hex's glass
              tint on Aura, and a gradient look's 0% stop IS the sheet hex.
              A LONG eased wash over the hero's lower half (owner reference
              2026-09-02: link.me's Daps page) — the page color gradually
              takes the image over, and the squared sheet below continues it
              invisibly, so the content just emerges out of the photo. */}
          {/* Skipped for glass looks — the mask above does this job, and an
              overlay inside a masked box would simply be masked with it. */}
          {!wash && !bgMedia && (
            <div
              className="absolute inset-x-0 bottom-0 h-[55%] pointer-events-none"
              style={{ background: heroFade }}
            />
          )}
        </div>
        )}

        {/* Sheet — with the avatar/none headers there's no hero above it, so
            it starts at the very top: no -mt overlap, a touch more padding. */}
        <div
          // No rounded top anywhere any more (owner reference 2026-09-02, the
          // link.me blend): the sheet's squared top edge is the exact color
          // the fade ends on, so the seam is invisible and the content reads
          // as emerging from the photo — a curve here drew a visible line
          // through the blend. flatTop (avatar/none) was already square.
          className={`relative px-4 pb-9 text-center ${flatTop ? "pt-10" : "-mt-10 pt-7"}`}
          style={{
            // Over background media the sheet paints NOTHING — it is the layer
            // the content sits on, and the media is behind it. Painting sheetBg
            // here would cover the photo with a solid rectangle from the
            // avatar down, which is the whole page.
            background: bgMedia
              ? "transparent"
              : glassOn
                ? sheetGlassBg
                : sheetTo
                  ? `linear-gradient(180deg, ${sheetBg} 0%, ${sheetTo} 100%)`
                  : sheetBg,
            // The blur is what makes it frosted glass rather than a tinted
            // pane: without it the wash reads as a flat colour behind a flat
            // colour, and the whole family loses its reason to exist.
            ...(glassOn ? { backdropFilter: "blur(28px)", WebkitBackdropFilter: "blur(28px)" } : {}),
            // A soft shadow under every piece of text on the page, but only
            // over media. The scrim alone cannot cover the case that actually
            // happens: one bright patch of an otherwise dark photo landing
            // exactly behind the section headers or the bio, which are the
            // lightest-weight text here. Measured against a 35% scrim on a
            // sky/rock photo, where "CLICK BELOW TO CONNECT WITH ME" was
            // barely legible and is now clean. Inherited, so it reaches the
            // name, bio, headers, labels and footer at once; invisible over
            // flat areas, which is why it can be left on unconditionally.
            ...(bgMedia ? { textShadow: "0 1px 12px rgba(0,0,0,0.5)" } : {}),
          }}
        >
          {/* Compact circular avatar — the "avatar" header style. Shows the
              same resolved `hero`: headshot (cropped), or logo (contained, on
              a white plate so any mark reads), or initials on the indigo
              gradient. */}
          {heroAvatar && (
            <div className="flex justify-center mb-4">
              <div className={`w-28 h-28 rounded-full overflow-hidden shrink-0 ring-4 ${light ? "ring-black/[0.06]" : "ring-white/15"}`}>
                {hero.kind === "video" ? (
                  <video src={`${hero.url}#t=0.001`} className="w-full h-full object-cover" autoPlay muted loop playsInline preload="auto" aria-label={name} />
                ) : hero.kind === "photo" ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={hero.url!} alt={name} className="w-full h-full object-cover" />
                ) : hero.kind === "logo" ? (
                  <div className="w-full h-full bg-white flex items-center justify-center p-3.5">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={hero.url!} alt={name} className="max-w-full max-h-full w-auto h-auto object-contain" />
                  </div>
                ) : (
                  <div className="w-full h-full flex items-center justify-center" style={{ background: "linear-gradient(160deg, #181538 0%, #2A2466 60%, #4338ca 100%)" }}>
                    <span className="text-white/90 font-extrabold text-4xl tracking-wide">{initials}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Name + verified badge */}
          {/* items-start so the badge sits with the FIRST line once the name
              wraps, rather than drifting to the vertical middle of a two-line
              block. */}
          <div className="flex items-start justify-center gap-1.5 px-2">
            <h1
              // The name WRAPS; it is never truncated. This used to be
              // "overflow-hidden whitespace-nowrap text-ellipsis", so a long
              // name was cut off with an ellipsis — the page is someone's
              // identity, and a clipped name is the one thing here that must
              // never happen. break-words additionally splits a single
              // unbroken token (a very long one-word name) instead of letting
              // it spill past the sheet.
              // min-w-0 is required for break-words to do anything here: a flex
              // item defaults to min-width:auto, so the box GROWS to fit an
              // unbreakable token instead of constraining the line, and the
              // word then runs past the sheet. Measured — without it a
              // 34-character single-word name still overflowed the edge.
              className="font-extrabold break-words min-w-0"
              style={{ fontSize: 32, letterSpacing: "0.25px", lineHeight: 1.15, color: textColor }}
            >
              {name}
            </h1>
            {/* shrink-0: the badge must keep its size and let the name take the
                remaining width, otherwise the flex row squeezes the badge. */}
            {verified && <span className="shrink-0 mt-1.5"><VerifiedBadge /></span>}
          </div>
          {/* The @username line under the name was removed (owner order
              2026-08-26) — the slug reads as "first-last-company" noise; the
              name above and the subtitle below carry the identity. */}

          {subtitle && <p className="text-[0.8125rem] font-medium mt-2" style={{ color: textColor, opacity: 0.6 }}>{subtitle}</p>}
          {bio && <p className="text-sm leading-relaxed mt-3 max-w-[340px] mx-auto whitespace-pre-wrap" style={{ color: textColor, opacity: 0.75 }}>{bio}</p>}

          {/* Social icons — brand-colored, deep-link into apps on mobile */}
          {/* Zero-height section anchors: the pinned editor preview scrolls to
              the part of the page being edited (PinnedCardPreview). */}
          <span data-sl-section="socials" aria-hidden className="block h-0" />
          <SocialIcons
            socials={socials}
            mode={light ? "light" : "dark"}
            shape={normalizeIconShape(pageStyle?.iconShape)}
            fill={normalizeIconFill(pageStyle?.iconFill)}
            accent={accent}
            accentText={accentText}
            trackFor={embedded ? null : trackFor}
            trackSurface="links"
            trackSource={trackSource}
            suppressTracking={suppressTracking}
          />

          {/* Connect (lead capture) — the page's hero action. Its one-line
              value prompt below the button was removed 2026-08-18 on the
              owner's request; the button stands alone. */}
          <span data-sl-section="connect" aria-hidden className="block h-0" />
          <div className="w-full mt-6">
            <ConnectButton cardOwner={username} ownerFirstName={firstName} accent={accent} accentText={accentText} />
          </div>

          {/* Featured links — rich preview cards */}
          {links.length > 0 && <span data-sl-section="links" aria-hidden className="block h-0" />}
          <SwiftLinkButtons
            links={links}
            tileBg={look.tile}
            mode={light ? "light" : "dark"}
            textColor={textColor}
            paid={paidTiles}
            buttonStyle={normalizeButtonStyle(pageStyle?.buttonStyle)}
            buttonColor={pageStyle?.buttonColor}
            // Only with media behind them: a backdrop-filter over a flat sheet
            // colour has nothing to blur, and the row would just look washed
            // out for no reason. `bgMedia` is already gated on the
            // compact-circle and no-header layouts, so this follows it.
            glass={!!bgMedia && !!pageStyle?.glass}
            overMedia={!!bgMedia}
            accent={accent}
            accentText={accentText}
            // `embedded` is the live-preview/designer rendering, where a tap is
            // the OWNER arranging their page, not a visitor pressing a link.
            trackFor={embedded ? null : trackFor}
            trackSource={trackSource}
            suppressTracking={suppressTracking}
          />

          {/* Faint link to this person's full SwiftCard — owner-toggleable from
              the Social design step (hideCardLink in customization). */}
          {showCardLink && (
            <div className="flex justify-center mt-10">
              <a
                href={`/${username}`}
                className={`inline-block px-4 py-2 text-xs rounded-lg transition-colors ${"" /* hover well must be visible on BOTH modes */}${light ? "hover:bg-black/[0.06]" : "hover:bg-white/10"}`}
                style={{ color: textColor, opacity: 0.5 }}
              >
                View SwiftCard →
              </a>
            </div>
          )}

          {/* Footer — "Made with swiftcard.me" attribution, FREE plan only
              since 2026-09-02 (owner order): paid plans drop it, and the
              top-left bolt badge carries the invite on every plan instead.
              Wording from 2026-08-18 (owner request): the brand word is the
              DOMAIN, underlined, so visitors can tell it's a tappable link —
              plain "SwiftCard" read as a label and nobody knew to tap it. */}
          {brandingFooter && (
          <div className="flex justify-center mt-5">
            <a
              href={`${appUrl}/?src=badge`}
              className="flex items-center gap-2 text-[0.8125rem] transition-opacity opacity-50 hover:opacity-80"
              style={{ color: textColor }}
            >
              <span className="shrink-0 rounded-[4px] overflow-hidden flex"><SwiftCardIcon size={16} /></span>
              <span>Made with <span className="underline underline-offset-2">swiftcard.me</span></span>
            </a>
          </div>
          )}
        </div>
      </div>
    </main>
  );
}
