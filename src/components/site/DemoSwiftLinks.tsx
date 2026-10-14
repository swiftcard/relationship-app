"use client";

import SocialLinkIntercept from "@/components/SocialLinkIntercept";
import CardActionLinks from "@/components/CardActionLinks";
import { SAMPLE_DATA } from "@/components/card-templates/types";
import { buildConnectLinks } from "@/lib/social-url";

// The card page's "Swift Links" box, as the marketing mockups show it.
//
// This exists because the box lives inside THREE phone mockups (TemplateGallery
// on the homepage and /products/digital-cards, LeadCapturePhone, SignatureDemo)
// and every one of them had its own hand-copied version. They drifted: the card
// page moved to the ghost chip, the website capsule, the brand discs and the
// action-link table, and all three mockups were still showing the retired
// full-width "bars" list with a "Go to Swift Links →" footnote. One component,
// used by all three, is what stops that happening again.
//
// The structure below mirrors src/app/[username]/page.tsx's Swift Links
// section exactly — the dark "View my Swift Link page →" pill where the
// heading used to be (owner change 2026-10-14), bio, rule, socials rail,
// rule, action links — and the pieces that ARE the design
// (SocialLinkIntercept's "rail", CardActionLinks) are the live components,
// not copies, so a change there lands here for free.

const FIRST = SAMPLE_DATA.name.split(" ")[0];

// The same connect links the live card builds (website + socials). "rail"
// splits them itself: the website becomes a capsule, the socials become discs.
const CONNECT_LINKS = buildConnectLinks({
  website: SAMPLE_DATA.website,
  linkedin: SAMPLE_DATA.linkedin,
  instagram: SAMPLE_DATA.instagram,
  tiktok: SAMPLE_DATA.tiktok,
  twitter: SAMPLE_DATA.twitter,
});

// Bio and links match the live demo card (/demo-realty) so the marketing
// mockup and the card people actually open tell the same story. Both URLs are
// already reached by CONNECT_LINKS, so nothing new is fetched for the favicons.
const BIO = "Bay Area homes, from first tour to closing day. Let's find yours.";
// Labels are kept to ~16 characters on purpose. CardActionLinks truncates its
// row label, and the narrow phone frame leaves it about 128px — "Connect on
// LinkedIn" came back as "Connect on Link…", which reads as a bug in a mockup
// even though it is the real component behaving correctly.
const ACTION_LINKS = [
  { label: "Book a viewing", url: "https://coastlinehomes.com" },
  { label: "Current listings", url: "https://coastlinehomes.com" },
  { label: "Client reviews", url: "https://linkedin.com/in/alexmorgan" },
];

const RULE = <div className="h-px bg-[#EFE9E1]" />;

/**
 * `compact` is the 300px-wide phone frame (TemplateGallery, LeadCapturePhone),
 * where the mockups' own chrome — heading, chip — runs one step down from the
 * real card's. SignatureDemo renders at the card's true scale, so it passes
 * compact={false} and matches the live page.
 *
 * Only the chrome scales. The embedded live components keep their real sizes,
 * which is the convention these mockups already follow for the socials block.
 */
export default function DemoSwiftLinks({ compact = true }: { compact?: boolean }) {
  return (
    <>
      <div className="flex mb-3">
        {/* The card page's accent-outline button in the heading's old
            top-left spot (no "Swift Links" title since 2026-10-14). Every
            mockup wrapping this sets --sc-accent, exactly as the card page
            does, so it takes the same colour as the mockup's Save Contact.
            A span, not a link:
            everything in these mockups is display-only, and a button that
            looks clickable and does nothing is worse than one that never
            invited the tap. Hover styling is dropped for the same reason.
            With the heading gone the full label fits the compact frame too. */}
        <span
          className={`inline-flex items-center whitespace-nowrap rounded-full border bg-white font-semibold ${compact ? "text-[0.625rem] px-2.5 py-1" : "text-xs px-3.5 py-[7px]"}`}
          style={{ borderColor: "var(--sc-accent, #1D4ED8)", color: "var(--sc-accent, #1D4ED8)" }}
        >
          View my Swift Link page →
        </span>
      </div>

      <p className={`text-slate-600 leading-[1.6] ${compact ? "text-[0.75rem]" : "text-[0.8125rem]"}`}>{BIO}</p>

      <div className={compact ? "my-3" : "my-4"}>{RULE}</div>

      <div style={{ pointerEvents: "none" }}>
        <SocialLinkIntercept
          links={CONNECT_LINKS}
          cardOwner="alexmorgan"
          ownerFirstName={FIRST}
          variant="rail"
          // A marketing mock is not a visitor on a card. pointerEvents:none
          // above already makes these untappable, but that is a style someone
          // could remove while redesigning; this says it in the contract.
          suppressTracking
        />
      </div>

      <div className={compact ? "my-3" : "my-4"}>{RULE}</div>

      <div style={{ pointerEvents: "none" }}>
        <CardActionLinks links={ACTION_LINKS} />
      </div>
    </>
  );
}
