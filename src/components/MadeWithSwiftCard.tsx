import { SwiftCardIcon } from "@/components/SwiftCardLogo";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://swiftcard.me";

// ── "Made with SwiftCard · Get yours free" ───────────────────────────────────
//
// The branded pill that turns a card's RECIPIENTS into signups — every card,
// every plan (owner decision 2026-08-11). One component rather than inline
// markup because it now renders on a different background than it was drawn
// for: it used to sit on the cream page (#FAF7F2) as a white pill, and it now
// lives INSIDE a white section card, where white-on-white would erase it.
//
// `tone` picks the ground it is standing on — nothing else differs, so the two
// placements stay visually identical in weight, radius, and type.
//   • "onCream" — the original: white pill, slate hairline.
//   • "onWhite" — cream pill, warm hairline (the page's own card language).
//
// `src` is the signup attribution, so each placement's conversions stay
// separable in the funnel. Every value passed here must be a registered
// SIGNUP_SOURCE (src/lib/referral.ts) or it is silently dropped at signup.
//
// `href` defaults to the marketing home page — right for a passive footer
// badge, where the visitor has not asked for anything. At a CONVERSION moment
// (just saved a contact) pass the builder directly: that slot previously held
// a "Create your free card" button going straight to /cards/new, and routing
// the replacement to a marketing page instead would quietly lengthen the very
// funnel it sits in.
export default function MadeWithSwiftCard({
  src,
  tone = "onCream",
  href,
  onClick,
  className = "",
}: {
  src: string;
  tone?: "onCream" | "onWhite";
  href?: string;
  onClick?: () => void;
  className?: string;
}) {
  const ground =
    tone === "onWhite"
      ? { background: "#FAF7F2", borderColor: "#E4DDD4" }
      : { background: "#fff", borderColor: "#e2e8f0" };

  return (
    <a
      href={href ?? `${APP_URL}/?src=${encodeURIComponent(src)}`}
      onClick={onClick}
      className={`group w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-full border shadow-sm hover:border-blue-300 hover:shadow-md transition-all ${className}`}
      style={ground}
    >
      {/* The real SwiftCard app icon — the same mark as the site header,
          footer and app nav. It was a hand-drawn bolt on a gradient square,
          which didn't read as the SwiftCard logo (owner, 2026-10-05). The
          words beside it already say "SwiftCard", so the image stays silent
          to screen readers. */}
      <span aria-hidden="true" className="shrink-0 flex">
        <SwiftCardIcon size={20} />
      </span>
      {/* whitespace-nowrap on both halves: at 320px inside a padded section card
          this line is close to the available width, and letting it wrap split
          "Made with" from "SwiftCard" mid-phrase. */}
      <span className="text-slate-500 text-[0.78125rem] whitespace-nowrap">
        Made with <span className="font-bold text-slate-900">SwiftCard</span>
      </span>
      <span className="text-blue-600 text-[0.78125rem] font-semibold ml-0.5 inline-flex items-center gap-0.5 group-hover:gap-1.5 transition-all whitespace-nowrap">
        Get yours free
        <svg viewBox="0 0 24 24" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2.5} aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14M13 6l6 6-6 6" />
        </svg>
      </span>
    </a>
  );
}
