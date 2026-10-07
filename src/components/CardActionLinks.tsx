"use client";

import { triggerSignupNudge } from "@/lib/nudge";
import { trackLinkClick } from "@/lib/track-link-click";
import LinkMark from "@/components/LinkMark";
import { fullHref } from "@/lib/link-brand";

type CardLink = { emoji?: string; label: string; url: string };

// The card's custom "link-in-bio" buttons: ONE container, uniform rows.
//
// Before, each link was its own floating cream slab. N of them in a row read as
// a pile — no edge, no rhythm, and the whole section looked unfinished. Grouping
// them into a single bordered container with internal hairlines is the change
// that fixes that: a pile becomes a designed index. It also survives every
// count, which matters because PLAN_LIMITS.FREE_MAX_LINKS is 2, so a
// two-row table is the most common shape on the platform.
//
// Every row is deliberately IDENTICAL — no accent-filled first link, no
// promoted "primary". An earlier version highlighted the first link with the
// owner's accent; it was dropped on purpose (owner call) because a saturated
// button reads as advertising on a professional's card. Ranking is the owner's
// own ordering, nothing more.
//
// No scrape: the marks are site icons derived from the hostname (lazy, over an
// always-painted monogram) via the edge-cached /api/link-icon, never an
// og:image lookup.
export default function CardActionLinks({
  links,
  trackFor = null,
  trackSource = "direct_link",
  suppressTracking = false,
}: {
  links: CardLink[];
  /** The CARD SLUG these links belong to, for outbound-link tracking. Null (the
   *  default) records nothing, so a preview render stays silent. */
  trackFor?: string | null;
  /** The page's ?source= attribution, inherited by the tap. */
  trackSource?: string;
  /** Owner looking at their own card. */
  suppressTracking?: boolean;
}) {
  if (!links.length) return null;

  return (
    <div
      className="rounded-[14px] overflow-hidden bg-white"
      style={{ boxShadow: "inset 0 0 0 1px #E7E0D7, 0 1px 2px rgba(15,23,42,0.04)" }}
    >
      {links.map((l, i) => (
        <a
          key={i}
          href={fullHref(l.url)}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => {
            trackLinkClick({ username: trackFor, surface: "card", url: fullHref(l.url), source: trackSource, label: l.label, suppress: suppressTracking });
            triggerSignupNudge("link_button");
          }}
          // group: lets the chevron lean in on hover without its own listener.
          // Colour change only — NOT a transform. A row inside a shared
          // container must never move independently of its neighbours, or the
          // hairlines visibly break.
          //
          // Blue hover (owner request). #F2F6FF is the page's blue-600 barely
          // present — enough to read as "this is live" against the warm white
          // without turning the row into a coloured button, which is the thing
          // the uniform-rows change was for. Focus-visible uses the same blue so
          // keyboard and pointer agree.
          className="group flex items-center gap-3 min-h-[52px] px-3.5 py-2.5 border-b border-[#F1EBE3] last:border-b-0 transition-colors duration-150 hover:bg-[#F2F6FF] active:bg-[#E4ECFE] focus-visible:bg-[#F2F6FF] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#1D4ED8]/35"
        >
          <span
            className="shrink-0 w-7 h-7 rounded-[8px] bg-[#FAF7F2] grid place-items-center overflow-hidden transition-shadow duration-150 group-hover:shadow-[inset_0_0_0_1px_#BFD2FA]"
            style={{ boxShadow: "inset 0 0 0 1px #EDE6DC" }}
          >
            {l.emoji ? <span className="text-[0.8125rem] leading-none">{l.emoji}</span> : <LinkMark url={l.url} size={14} />}
          </span>
          <span className="min-w-0 flex-1 truncate text-[0.875rem] font-medium tracking-[-0.006em] text-[#1E293B]">
            {l.label}
          </span>
          <svg
            viewBox="0 0 20 20"
            fill="currentColor"
            aria-hidden="true"
            className="w-3 h-3 shrink-0 text-[#C9BFB2] transition-[transform,color] duration-150 group-hover:text-[#1D4ED8] group-hover:translate-x-0.5"
          >
            <path d="M7.7 4.3a1 1 0 000 1.4L12 10l-4.3 4.3a1 1 0 101.4 1.4l5-5a1 1 0 000-1.4l-5-5a1 1 0 00-1.4 0z" />
          </svg>
        </a>
      ))}
    </div>
  );
}
