"use client";

import { triggerSignupNudge } from "@/lib/nudge";
import { trackLinkClick } from "@/lib/track-link-click";
import LinkMark from "@/components/LinkMark";
import { brandBackground, hostLabel } from "@/lib/link-brand";
// The SHARED icon — it accepts a className. The file-local PlatformIcon below
// hardcodes w-4 h-4 and silently ignores className, which would ship 40px discs
// with 16px glyphs. The local one stays, unchanged, for the "bars" variant.
import SharedPlatformIcon from "@/components/PlatformIcon";

export type SocialLinkData = {
  label: string;
  href: string;
  sub?: string;
  color: string;
  textColor?: string;
};

function PlatformIcon({ label }: { label: string }) {
  switch (label) {
    case "LinkedIn":
      return (
        <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4 shrink-0">
          <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
        </svg>
      );
    case "Instagram":
      return (
        <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4 shrink-0">
          <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z" />
        </svg>
      );
    case "X / Twitter":
      return (
        <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4 shrink-0">
          <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
        </svg>
      );
    case "Snapchat":
      return (
        <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4 shrink-0">
          <path d="M12.206.793c.99 0 4.347.276 5.93 3.821.529 1.193.403 3.219.299 4.847l-.003.06c-.012.18-.022.345-.03.51.075.045.203.09.401.09.3-.016.659-.12 1.033-.301.165-.088.344-.104.464-.104.182 0 .359.029.509.09.45.149.734.479.734.838.015.449-.39.839-1.213 1.168-.089.029-.209.075-.344.119-.45.135-1.139.36-1.333.81-.09.224-.061.524.12.868l.015.015c.06.136 1.526 3.475 4.791 4.014.255.044.435.27.42.509 0 .075-.015.149-.045.225-.24.569-1.273.988-3.146 1.271-.059.091-.12.375-.164.57-.029.179-.074.36-.134.553-.076.271-.27.405-.555.405h-.03c-.135 0-.313-.031-.538-.074-.36-.075-.765-.135-1.273-.135-.3 0-.599.015-.913.074-.6.104-1.123.464-1.723.884-.853.599-1.826 1.288-3.294 1.288-.06 0-.119-.015-.18-.015h-.149c-1.468 0-2.427-.675-3.279-1.288-.599-.42-1.107-.779-1.707-.884-.314-.045-.629-.074-.928-.074-.54 0-.958.089-1.272.149-.211.043-.391.074-.54.074-.374 0-.523-.224-.583-.42-.061-.192-.09-.389-.135-.567-.046-.181-.105-.494-.166-.57-1.918-.222-2.95-.642-3.189-1.226-.031-.063-.052-.15-.055-.225-.015-.243.165-.465.42-.509 3.264-.54 4.73-3.879 4.791-4.02l.016-.029c.18-.345.224-.645.119-.869-.195-.434-.884-.658-1.332-.809-.121-.029-.24-.074-.346-.119-1.107-.435-1.257-.93-1.197-1.273.09-.479.674-.793 1.168-.793.146 0 .27.029.383.074.42.194.789.3 1.104.3.234 0 .384-.06.465-.105l-.046-.569c-.098-1.626-.225-3.651.307-4.837C7.392 1.077 10.739.807 11.727.807l.419-.015h.06z" />
        </svg>
      );
    case "TikTok":
      return (
        <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4 shrink-0">
          <path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1V9.01a6.27 6.27 0 00-.79-.05 6.34 6.34 0 00-6.34 6.34 6.34 6.34 0 006.34 6.34 6.34 6.34 0 006.33-6.34V8.95a8.27 8.27 0 004.84 1.56V7.07a4.85 4.85 0 01-1.07-.38z" />
        </svg>
      );
    case "Facebook":
      return (
        <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4 shrink-0">
          <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
        </svg>
      );
    case "YouTube":
      return (
        <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4 shrink-0">
          <path d="M23.498 6.186a3.016 3.016 0 00-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 00.502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 002.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 002.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
        </svg>
      );
    default:
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4 shrink-0">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253M3 12a8.959 8.959 0 00.284 2.253" />
        </svg>
      );
  }
}

export default function SocialLinkIntercept({
  links,
  cardOwner,
  ownerFirstName,
  variant = "bars",
  trackSource = "direct_link",
  suppressTracking = false,
}: {
  links: SocialLinkData[];
  cardOwner: string;
  ownerFirstName: string;
  /** The page's ?source= attribution, inherited by the tap. */
  trackSource?: string;
  /** Owner looking at their own card, or a marketing mockup. */
  suppressTracking?: boolean;
  /**
   * "rail" is the card page's current design — website capsule + brand discs.
   * The three marketing mockups that show the card page (via site/DemoSwiftLinks)
   * pass it too, so what the site advertises matches what a visitor opens.
   *
   * "bars" (the original stacked full-width list) stays the default for any
   * remaining caller that has not been designed against the rail.
   */
  variant?: "bars" | "rail";
}) {
  // ── No interception (owner decision 2026-08-25) ───────────────────────────
  // Links are plain anchors: clicking LinkedIn/Instagram/the website goes
  // STRAIGHT there, on every device. The "drop your info so X can connect
  // with you" form that used to intercept the first click is gone — it asked
  // for personal details at the moment the visitor wanted to leave, and the
  // owner judged it cost more goodwill than it captured. The click still
  // fires the incidental signup nudge (once per session, shown when they
  // come back to this tab), so the moment isn't wasted.
  // The event carries the href, so every call site stays a bare
  // `onClick={handleClick}` — the three marketing mockups that render this
  // component included. They pass suppressTracking, so a mockup tap records
  // nothing.
  function handleClick(e?: React.MouseEvent<HTMLAnchorElement>) {
    const href = e?.currentTarget?.getAttribute("href");
    if (href) {
      // The link's own name ("Instagram", "Website"), found from the href so
      // every anchor stays a bare onClick: without it the bell and the
      // contact's history said "instagram.com" while Recent visits said
      // "Instagram" for the same tap.
      const label = links.find((s) => s.href === href)?.label ?? null;
      trackLinkClick({ username: cardOwner, surface: "card", url: href, source: trackSource, label, suppress: suppressTracking });
    }
    triggerSignupNudge("link_button");
  }

  const arrowIcon = (
    <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5 ml-auto opacity-50 shrink-0">
      <path fillRule="evenodd" d="M5.22 14.78a.75.75 0 001.06 0l7.22-7.22v5.69a.75.75 0 001.5 0v-7.5a.75.75 0 00-.75-.75h-7.5a.75.75 0 000 1.5h5.69l-7.22 7.22a.75.75 0 000 1.06z" clipRule="evenodd" />
    </svg>
  );

  // ── The original stacked bars. Untouched — still the default, still what the
  //    three marketing mockups render. ──────────────────────────────────────
  const barsList = (
    <div className="flex flex-col gap-2">
      {links.map((s) => (
        <a
          key={s.label}
          href={s.href}
          target="_blank"
          rel="noopener noreferrer"
          onClick={handleClick}
          className="flex items-center gap-3 px-4 py-3 rounded-xl transition-all font-medium text-sm hover:opacity-90 active:scale-[0.98]"
          style={{
            background: s.color + "12",
            color: s.textColor ?? s.color,
            border: `1px solid ${s.color}22`,
          }}
        >
          <PlatformIcon label={s.label} />
          <span className="flex flex-col leading-tight min-w-0 flex-1">
            <span>{s.label}</span>
            {s.sub && <span className="text-[0.6875rem] font-normal opacity-70 truncate">{s.sub}</span>}
          </span>
          {arrowIcon}
        </a>
      ))}
    </div>
  );

  // ── The card page's rail. Website on its own line, socials as brand discs. ──
  //
  // Every branch below is still an <a> carrying the SAME href / target /
  // onClick={handleClick} as the bars above. The intercept, the sheet, and the
  // alreadyShared switch are shared by all of them — never a <button>, because
  // alreadyShared relies on native navigation.
  const website = links.find((s) => s.label === "Website");
  const socials = links.filter((s) => s.label !== "Website");
  const chevron = (
    <svg viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3 shrink-0" aria-hidden="true">
      <path d="M7.7 4.3a1 1 0 000 1.4L12 10l-4.3 4.3a1 1 0 101.4 1.4l5-5a1 1 0 000-1.4l-5-5a1 1 0 00-1.4 0z" />
    </svg>
  );
  // A lone social with no website must not be a single disc floating mid-card.
  const soloSocialRow = !website && socials.length === 1;

  const railList = (
    <div className="flex flex-col gap-2.5">
      {website && (
        <a
          href={website.href}
          target="_blank"
          rel="noopener noreferrer"
          onClick={handleClick}
          className={
            // No accent-filled variant here either: with the action links now
            // uniform (owner call), a saturated website plate would be the only
            // shouting object in the section. It is the same quiet white row or
            // capsule in every case.
            socials.length === 0
              ? "group flex items-center gap-2.5 w-full min-h-[52px] rounded-[14px] px-3.5 bg-white transition-colors duration-150 hover:bg-[#F2F6FF] active:bg-[#E4ECFE]"
              // self-start, not just inline-flex: this sits in a flex COLUMN,
              // whose default align-items:stretch would blow the capsule out to
              // full width and leave it looking like an empty bar. It is meant
              // to hug its domain.
              : "group inline-flex self-start items-center gap-2 max-w-full h-10 rounded-full pl-1.5 pr-3 bg-white transition-colors duration-150 hover:bg-[#F2F6FF] active:bg-[#E4ECFE]"
          }
          style={{ boxShadow: "inset 0 0 0 1px #E7E0D7, 0 1px 2px rgba(15,23,42,0.04)" }}
        >
          <span
            className="shrink-0 w-7 h-7 rounded-full bg-white grid place-items-center overflow-hidden"
            style={{ boxShadow: "inset 0 0 0 1px #EDE6DC" }}
          >
            <LinkMark url={website.href} size={14} />
          </span>
          <span className="truncate lowercase font-medium text-[0.78125rem] tracking-[-0.004em] text-[#334155]">
            {hostLabel(website.href)}
          </span>
          {socials.length === 0 && (
            <span className="ms-auto text-[#C9BFB2] transition-[transform,color] duration-150 group-hover:text-[#1D4ED8] group-hover:translate-x-0.5">
              {chevron}
            </span>
          )}
        </a>
      )}

      {soloSocialRow ? (
        <a
          href={socials[0].href}
          target="_blank"
          rel="noopener noreferrer"
          onClick={handleClick}
          // Same blue hover as the website row and the link table — this is the
          // same kind of object, and it was the only one of the three with no
          // hover at all.
          className="group flex items-center gap-3 w-full min-h-[52px] rounded-[14px] px-3.5 bg-white transition-colors duration-150 hover:bg-[#F2F6FF] active:bg-[#E4ECFE]"
          style={{ boxShadow: "inset 0 0 0 1px #E7E0D7, 0 1px 2px rgba(15,23,42,0.04)" }}
        >
          <span
            className="shrink-0 w-8 h-8 rounded-[10px] grid place-items-center"
            style={{
              background: brandBackground(socials[0].label, socials[0].color),
              color: socials[0].textColor ?? "#fff",
              boxShadow: "inset 0 1px 0 rgba(255,255,255,0.28), inset 0 0 0 1px rgba(15,23,42,0.06)",
            }}
          >
            <SharedPlatformIcon label={socials[0].label} className="w-4 h-4 shrink-0" />
          </span>
          <span className="min-w-0 flex-1 flex flex-col">
            <span className="text-[0.875rem] font-semibold text-slate-900 leading-tight">{socials[0].label}</span>
            {socials[0].sub && <span className="text-[0.6875rem] text-slate-500 truncate">{socials[0].sub}</span>}
          </span>
          <span className="text-[#C9BFB2] transition-[transform,color] duration-150 group-hover:text-[#1D4ED8] group-hover:translate-x-0.5">
            {chevron}
          </span>
        </a>
      ) : (
        socials.length > 0 && (
          // 40px at gap-1.5 → 7 discs fit one 318px row (7x40 + 6x6 = 316).
          // Left-aligned, not centred: a centred floating row is the linktree tell.
          <div className="flex flex-wrap items-center gap-1.5">
            {socials.map((s) => (
              <a
                key={s.label}
                href={s.href}
                target="_blank"
                rel="noopener noreferrer"
                onClick={handleClick}
                aria-label={s.sub ? `${s.label} — ${s.sub}` : s.label}
                title={s.sub}
                // after:-inset-1 grows the hit area to 48px without moving the disc.
                className="relative w-10 h-10 rounded-full grid place-items-center transition-transform duration-150 active:scale-95 after:content-[''] after:absolute after:-inset-1 after:rounded-full"
                style={{
                  background: brandBackground(s.label, s.color),
                  // The DISC is the brand colour now, so the glyph goes white —
                  // the old default was `?? s.color`, which was right for a tinted
                  // bar and invisible on a saturated one. Snapchat keeps its own
                  // dark textColor, which is what makes it readable on #FFCA28.
                  color: s.textColor ?? "#fff",
                  boxShadow:
                    "inset 0 1px 0 rgba(255,255,255,0.28), inset 0 0 0 1px rgba(15,23,42,0.06), 0 1px 2px rgba(15,23,42,0.14)",
                }}
              >
                <SharedPlatformIcon label={s.label} className="w-[18px] h-[18px] shrink-0" />
              </a>
            ))}
          </div>
        )
      )}
    </div>
  );

  return (
    <>
      {variant === "rail" ? railList : barsList}

    </>
  );
}
