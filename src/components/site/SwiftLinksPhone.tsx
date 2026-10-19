"use client";

import { useEffect, useRef, useState } from "react";
import InertPreview from "@/components/InertPreview";
import PhoneFrame, { phoneScreenWidth } from "@/components/PhoneFrame";
import SwiftLinkProfile from "@/components/SwiftLinkProfile";
import { usePhotoTone } from "@/components/usePhotoTone";
import { SAMPLE_DATA, DEMO_HEADSHOT } from "@/components/card-templates/types";
import { buildConnectLinks } from "@/lib/social-url";
import { resolveLook } from "@/lib/swiftlink-looks";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://swiftcard.me";

// Marketing phone for the Swift Links section (homepage and
// /products/swiftlinks). Its screen is the REAL Swift Links page: the same
// SwiftLinkProfile the public /links/[username] page renders, fed the demo
// identity, scrolling inside the phone. scrollHost="phone" turns on what a live
// page does as it scrolls (the header photo pinned and fading, the mini header,
// the corner badge), so the phone cannot drift from the product again. It used
// to be a hand-drawn copy, and every Swift Links redesign left it behind
// (owner, 2026-10-19: "it does not look the same anymore, it works
// differently").
//
// Inert: nothing in it can be tapped or focused, but the phone scrolls. The
// scroller sits OUTSIDE the inert subtree, so wheel and touch still reach it.
//
// The page renders at true phone width (390) and is scaled into the screen,
// the way CardScaler scales the previews. Scaled here rather than by
// CardScaler because the scroller must be INSIDE the scaled box: CardScaler
// sizes itself to its content's full height, and a phone screen is a window.

const NATURAL = 390;
const PHONE_WIDTH = 340;
// The scale at the phone's normal size, so the server render and the first
// paint are already right; the phone only measures again when a very narrow
// screen caps it smaller (calc(100vw - 40px) below).
const DEFAULT_SCALE = phoneScreenWidth(PHONE_WIDTH) / NATURAL;

const SOCIALS = buildConnectLinks({
  website: SAMPLE_DATA.website,
  linkedin: SAMPLE_DATA.linkedin,
  instagram: SAMPLE_DATA.instagram,
  tiktok: SAMPLE_DATA.tiktok,
  twitter: SAMPLE_DATA.twitter,
}).map((s) => ({ label: s.label, href: s.href, color: s.color, textColor: s.textColor }));

// All three paid tile sizes plus section headers. The pictures are uploads
// (media), as an owner's own would be, so no tile shows some other site's
// preview image; each row's logo comes from the same /api/link-icon the live
// page uses. Uploads must be https (lib/swiftlink-tiles), so the demo's own
// pictures are addressed on the site's public origin.
const pic = (file: string) => ({ url: `${APP_URL}/marketing/${file}`, type: "image" as const });
const LINKS = [
  { emoji: "", label: "On the market", url: "", kind: "header" as const },
  { emoji: "🎥", label: "Neighborhood tour", url: "https://www.youtube.com", size: "featured" as const, media: pic("ll-video.jpg") },
  { emoji: "🏡", label: "See current listings", url: "https://www.zillow.com", size: "grid" as const, media: pic("ll-listings.jpg") },
  { emoji: "📝", label: "From the blog", url: "https://medium.com", size: "grid" as const, media: pic("ll-blog.jpg") },
  { emoji: "", label: "Work with me", url: "", kind: "header" as const },
  { emoji: "📅", label: "Book a viewing", url: "https://calendly.com", size: "compact" as const },
  { emoji: "⭐", label: "Read client reviews", url: "https://www.google.com/maps", size: "compact" as const },
];

export default function SwiftLinksPhone() {
  // The status bar shows the page's own colour, the way Safari tints it.
  const tone = usePhotoTone(DEMO_HEADSHOT);
  const sheet = resolveLook(undefined, tone).sheet;

  const boxRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(DEFAULT_SCALE);
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const measure = () => { if (box.clientWidth) setScale(box.clientWidth / NATURAL); };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(box);
    return () => ro.disconnect();
  }, []);

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
        width={PHONE_WIDTH}
        statusTone="dark"
        style={{ maxWidth: "calc(100vw - 40px)" }}
        screenStyle={{ height: 610, background: sheet, display: "flex", flexDirection: "column" }}
        indicatorTone="dark"
      >
        <div ref={boxRef} className="relative flex-1 min-h-0 overflow-hidden">
          <div
            className="absolute top-0 left-0 overflow-y-auto rd-scrollbar-none"
            data-swiftlinks-phone-scroll
            style={{
              // The screen's height in PAGE pixels: scaled down, it fills the
              // screen exactly.
              width: NATURAL,
              height: `${100 / scale}%`,
              transform: `scale(${scale})`,
              transformOrigin: "top left",
              overscrollBehavior: "contain",
            }}
          >
            <InertPreview>
              <SwiftLinkProfile
                embedded
                scrollHost="phone"
                name={SAMPLE_DATA.name}
                username="alexmorgan"
                photoUrl={DEMO_HEADSHOT}
                subtitle={[SAMPLE_DATA.title, SAMPLE_DATA.company].join("  ·  ")}
                bio="Bay Area homes, from first tour to closing day. Tap a link below to book a viewing or see what's on the market."
                verified
                paidTiles
                socials={SOCIALS}
                links={LINKS}
                appUrl={APP_URL}
                // Paid page: no "Made with swiftcard.me" footer, as on the
                // live page since 2026-09-02.
                brandingFooter={false}
              />
            </InertPreview>
          </div>
        </div>
      </PhoneFrame>
    </div>
  );
}
