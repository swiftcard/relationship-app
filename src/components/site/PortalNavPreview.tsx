"use client";

import { SwiftCardIcon } from "@/components/SwiftCardLogo";

// A pixel-faithful replica of the signed-in portal's sticky navbar
// (src/app/dashboard/page.tsx), for the marketing demo at /preview.
//
// It is a REPLICA rather than the real navbar on purpose. The real one hangs
// off live state — SignOutButton would sign out a visitor who happens to be
// logged in, NotificationBell fetches, and Settings/Grow link into auth-gated
// routes — none of which belongs in a demo someone is just poking at. So the
// markup and classes are copied verbatim (so it LOOKS identical) while the
// behaviour is demo-safe: the tabs switch the demo's own view, and the
// right-hand icons are inert.
//
// Keep the classes in sync with the real navbar if that one changes.

export const PORTAL_TABS = [
  { id: "dashboard", label: "Dashboard" },
  { id: "contacts", label: "Contacts" },
  { id: "links", label: "Links" },
] as const;

export type PortalTabId = (typeof PORTAL_TABS)[number]["id"];

export default function PortalNavPreview({
  tab,
  onTabChange,
  plan = "Pro",
}: {
  tab: PortalTabId;
  onTabChange: (t: PortalTabId) => void;
  plan?: "Pro" | "Free" | "Office";
}) {
  const planClass =
    plan === "Office" ? "bg-purple-600 text-white"
    : plan === "Pro" ? "bg-blue-600 text-white"
    : "bg-gray-800 text-gray-500";

  return (
    // top-16 / mt-16: the marketing SiteNav above is `fixed` at z-[70] and 64px
    // tall, so a bar at top-0 renders UNDERNEATH it and its tabs can't be
    // clicked at all. Sit below it and stick there.
    <nav className="sc-app sticky top-16 z-20 mt-16 bg-gray-950/95 backdrop-blur border-b border-gray-800/60">
      {/* gap-2 below 360px: see the tab-strip note further down — the row's own
          gap is part of the 17px the tabs are short by at 320. Restored to
          gap-4 from 360px up, where everything already fitted. */}
      <div className="max-w-5xl mx-auto px-5 h-14 flex items-center justify-between gap-2 min-[360px]:gap-4">
        {/* Left: brand + plan badge */}
        <div className="flex items-center gap-3 shrink-0">
          <span className="flex items-center gap-2">
            <SwiftCardIcon size={28} />
            <span className="font-bold text-white text-sm tracking-tight hidden sm:block">SwiftCard</span>
          </span>
          <span className={`text-[0.625rem] font-bold px-2 py-0.5 rounded-full ${planClass}`}>{plan}</span>
        </div>

        {/* Centre: the page tabs — the one part that really is interactive.
            min-w-0 + overflow-x-auto: at 320px the brand block, these three tabs
            and the right-hand controls together need 341px, and because nothing
            here could shrink the whole /preview page scrolled sideways by 21px.
            The tab strip absorbs it by scrolling inside itself, so nothing is
            unreachable — but the third tab still sat half-cut at the edge, which
            reads as broken rather than scrollable.
            Measured deficit at 320px: 17px (strip box 191, content 208). px-1.5
            reclaims 12px across the three tabs and the row gap above gives 8px
            — 20px, so all three fit whole and the strip stops scrolling.
            Both revert at 360px, NOT at Tailwind's sm (640px): the deficit only
            exists below 360, and a bare `sm:` would have needlessly retuned
            every 390px phone too. */}
        <div className="flex items-center gap-0.5 min-w-0 overflow-x-auto">
          {PORTAL_TABS.map((t) => {
            const active = t.id === tab;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => onTabChange(t.id)}
                aria-current={active ? "page" : undefined}
                className={`text-sm px-1.5 min-[360px]:px-3 py-1.5 rounded-lg transition-colors ${
                  active ? "text-white font-medium bg-gray-800" : "text-gray-400 hover:text-white hover:bg-gray-800/60"
                }`}
              >
                {t.label}
              </button>
            );
          })}
        </div>

        {/* Right: the same icon set the real navbar carries (Settings, Grow,
            theme, bell). Inert here — see the note at the top of this file.
            Hidden below sm: on a phone the real app moves its tabs to a bottom
            bar, but this demo keeps them up here as its only navigation, so the
            icons give them the room. */}
        <div className="hidden sm:flex items-center gap-2 shrink-0" aria-hidden="true">
          <span className="flex items-center justify-center w-9 h-9 rounded-lg text-gray-400">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} className="w-5 h-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.343 3.94c.09-.542.56-.94 1.11-.94h1.093c.55 0 1.02.398 1.11.94l.149.894c.07.424.384.764.78.93.398.164.855.142 1.205-.108l.737-.527a1.125 1.125 0 011.45.12l.773.774c.39.389.44 1.002.12 1.45l-.527.737c-.25.35-.272.806-.107 1.204.165.397.505.71.93.78l.893.15c.543.09.94.56.94 1.109v1.094c0 .55-.397 1.02-.94 1.11l-.893.149c-.425.07-.765.383-.93.78-.165.398-.143.854.107 1.204l.527.738c.32.447.269 1.06-.12 1.45l-.774.773a1.125 1.125 0 01-1.449.12l-.738-.527c-.35-.25-.806-.272-1.203-.107-.397.165-.71.505-.781.929l-.149.894c-.09.542-.56.94-1.11.94h-1.094c-.55 0-1.019-.398-1.11-.94l-.148-.894c-.071-.424-.384-.764-.781-.93-.398-.164-.854-.142-1.204.108l-.738.527c-.447.32-1.06.269-1.45-.12l-.773-.774a1.125 1.125 0 01-.12-1.45l.527-.737c.25-.35.272-.806.108-1.204-.165-.397-.506-.71-.93-.78l-.894-.15c-.542-.09-.94-.56-.94-1.109v-1.094c0-.55.398-1.02.94-1.11l.894-.149c.424-.07.765-.383.93-.78.165-.398.143-.854-.108-1.204l-.526-.738a1.125 1.125 0 01.12-1.45l.773-.773a1.125 1.125 0 011.45-.12l.737.527c.35.25.807.272 1.204.107.397-.165.71-.505.78-.929l.15-.894z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </span>
          <span className="flex items-center justify-center w-9 h-9 rounded-lg text-rose-400">
            <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
              <path d="M11.645 20.91l-.007-.003-.022-.012a15.247 15.247 0 01-.383-.218 25.18 25.18 0 01-4.244-3.17C4.688 15.36 2.25 12.174 2.25 8.25 2.25 5.322 4.714 3 7.688 3A5.5 5.5 0 0112 5.052 5.5 5.5 0 0116.313 3c2.973 0 5.437 2.322 5.437 5.25 0 3.925-2.438 7.111-4.739 9.256a25.175 25.175 0 01-4.244 3.17 15.247 15.247 0 01-.383.219l-.022.012-.007.004-.003.001a.752.752 0 01-.704 0l-.003-.001z" />
            </svg>
          </span>
          <span className="w-8 h-8 rounded-full flex items-center justify-center text-gray-400">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-[18px] h-[18px]">
              <path strokeLinecap="round" strokeLinejoin="round" d="M21.752 15.002A9.718 9.718 0 0118 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 003 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 009.002-5.998z" />
            </svg>
          </span>
          <span className="w-8 h-8 rounded-full flex items-center justify-center text-gray-400">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-[18px] h-[18px]">
              <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
            </svg>
          </span>
          {/* No "Sign out" here: it moved to Settings → Profile (759a66d4). */}
        </div>
      </div>
    </nav>
  );
}
