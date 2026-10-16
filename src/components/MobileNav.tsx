"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";

const ACTIVE_CARD_KEY = "swiftcard_active_card";

// Which extra tabs (office Admin, site console) this account's bar last showed.
// The route loading skeleton (PortalSkeleton) renders the bar BEFORE the page
// has resolved them, and used to draw it without them — so an office admin
// tapping any tab watched "Admin" vanish for a second and come back. The
// skeleton now draws what the bar last showed; the real page then confirms or
// corrects it. It only decides whether a LINK is shown: /office/admin and
// /admin guard themselves on the server. Cleared on sign-out / account switch
// (lib/account-state PERSON_SCOPED_STORAGE_KEYS).
export const NAV_EXTRA_TABS_KEY = "sc_nav_extra_tabs";
const noSubscribe = () => () => {};
function readRememberedTabs(): string {
  try { return localStorage.getItem(NAV_EXTRA_TABS_KEY) ?? ""; } catch { return ""; }
}

const TABS = [
  {
    href: "/dashboard",
    tour: "nav-dashboard",
    label: "Home",
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
        <path d="M11.47 3.84a.75.75 0 011.06 0l8.69 8.69a.75.75 0 101.06-1.06l-8.689-8.69a2.25 2.25 0 00-3.182 0l-8.69 8.69a.75.75 0 001.061 1.06l8.69-8.69z" />
        <path d="M12 5.432l8.159 8.159c.03.03.06.058.091.086v6.198c0 1.035-.84 1.875-1.875 1.875H15a.75.75 0 01-.75-.75v-4.5a.75.75 0 00-.75-.75h-3a.75.75 0 00-.75.75V21a.75.75 0 01-.75.75H5.625a1.875 1.875 0 01-1.875-1.875v-6.198c.03-.028.061-.056.091-.086L12 5.432z" />
      </svg>
    ),
  },
  {
    href: "/contacts",
    tour: "nav-contacts",
    label: "Contacts",
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
        <path fillRule="evenodd" d="M8.25 6.75a3.75 3.75 0 117.5 0 3.75 3.75 0 01-7.5 0zM15.75 9.75a3 3 0 116 0 3 3 0 01-6 0zM2.25 9.75a3 3 0 116 0 3 3 0 01-6 0zM6.31 15.117A6.745 6.745 0 0112 12a6.745 6.745 0 016.709 7.498.75.75 0 01-.372.568A12.696 12.696 0 0112 21.75c-2.305 0-4.47-.612-6.337-1.684a.75.75 0 01-.372-.568 6.787 6.787 0 011.019-4.38z" clipRule="evenodd" />
        <path d="M5.082 14.254a8.287 8.287 0 00-1.308 5.135 9.687 9.687 0 01-1.764-.44l-.115-.04a.563.563 0 01-.373-.487l-.01-.121a3.75 3.75 0 013.57-4.047zM20.226 19.389a8.287 8.287 0 00-1.308-5.135 3.75 3.75 0 013.57 4.047l-.01.121a.563.563 0 01-.373.486l-.115.04c-.567.2-1.156.349-1.764.441z" />
      </svg>
    ),
  },
  {
    href: "/share",
    tour: "nav-links",
    label: "Links",
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
        <path d="M15.75 4.5a3 3 0 11.825 2.066l-8.421 4.679a3.002 3.002 0 010 1.51l8.421 4.679a3 3 0 11-.729 1.31l-8.421-4.678a3 3 0 110-4.132l8.421-4.679a3 3 0 01-.096-.744z" />
      </svg>
    ),
  },
  {
    href: "/settings/flows",
    tour: "nav-settings",
    label: "Settings",
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
        <path fillRule="evenodd" d="M11.078 2.25c-.917 0-1.699.663-1.855 1.567L9.05 4.889c-.02.12-.115.26-.297.348a7.493 7.493 0 00-.986.57c-.166.115-.334.126-.45.083L6.3 5.508a1.875 1.875 0 00-2.282.819l-.922 1.597a1.875 1.875 0 00.432 2.385l.84.692c.095.078.17.229.154.43a7.598 7.598 0 000 1.139c.015.2-.059.352-.153.43l-.841.692a1.875 1.875 0 00-.432 2.385l.922 1.597a1.875 1.875 0 002.282.818l1.019-.382c.115-.043.283-.031.45.082.312.214.641.405.985.57.182.088.277.228.297.35l.178 1.071c.151.904.933 1.567 1.85 1.567h1.844c.916 0 1.699-.663 1.85-1.567l.178-1.072c.02-.12.114-.26.297-.349.344-.165.673-.356.985-.57.167-.114.335-.125.45-.082l1.02.382a1.875 1.875 0 002.28-.819l.923-1.597a1.875 1.875 0 00-.432-2.385l-.84-.692c-.095-.078-.17-.229-.154-.43a7.614 7.614 0 000-1.139c-.016-.2.059-.352.153-.43l.84-.692c.708-.582.891-1.59.433-2.385l-.922-1.597a1.875 1.875 0 00-2.282-.818l-1.02.382c-.114.043-.282.031-.449-.083a7.49 7.49 0 00-.985-.57c-.183-.087-.277-.227-.297-.348l-.179-1.072a1.875 1.875 0 00-1.85-1.567h-1.843zM12 15.75a3.75 3.75 0 100-7.5 3.75 3.75 0 000 7.5z" clipRule="evenodd" />
      </svg>
    ),
  },
];

// The office-admin tab, appended for owners/managers only (see MobileNavGate).
// Purple to match the console's accent, so it reads as "a different area".
const ADMIN_TAB = {
  href: "/office/admin",
  tour: "nav-admin",
  label: "Admin",
  icon: (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
      <path fillRule="evenodd" d="M3 2.25a.75.75 0 000 1.5v16.5h-.75a.75.75 0 000 1.5H15v-18a.75.75 0 000-1.5H3zM6.75 19.5v-2.25a.75.75 0 01.75-.75h3a.75.75 0 01.75.75v2.25a.75.75 0 01-.75.75h-3a.75.75 0 01-.75-.75zM6 6.75A.75.75 0 016.75 6h.75a.75.75 0 010 1.5h-.75A.75.75 0 016 6.75zM6.75 9a.75.75 0 000 1.5h.75a.75.75 0 000-1.5h-.75zM6 12.75a.75.75 0 01.75-.75h.75a.75.75 0 010 1.5h-.75a.75.75 0 01-.75-.75zM10.5 6a.75.75 0 000 1.5h.75a.75.75 0 000-1.5h-.75zM9.75 9.75A.75.75 0 0110.5 9h.75a.75.75 0 010 1.5h-.75a.75.75 0 01-.75-.75zM10.5 12a.75.75 0 000 1.5h.75a.75.75 0 000-1.5h-.75zM16.5 6.75v15h5.25a.75.75 0 000-1.5H21v-12a.75.75 0 000-1.5h-4.5zm1.5 4.5a.75.75 0 01.75-.75h.008a.75.75 0 01.75.75v.008a.75.75 0 01-.75.75h-.008a.75.75 0 01-.75-.75v-.008zm.75 2.25a.75.75 0 00-.75.75v.008c0 .414.336.75.75.75h.008a.75.75 0 00.75-.75v-.008a.75.75 0 00-.75-.75h-.008zM18 17.25a.75.75 0 01.75-.75h.008a.75.75 0 01.75.75v.008a.75.75 0 01-.75.75h-.008a.75.75 0 01-.75-.75v-.008z" clipRule="evenodd" />
    </svg>
  ),
};

// The SITE-OWNER console tab (ADMIN_EMAILS only) — a different thing from the
// office "Admin" above, exactly as the dashboard's desktop header labels them.
// It existed ONLY in that header, which is `hidden md:flex`: on a phone the
// site owner had no way into /admin at all (owner report, 2026-09-17).
const SITE_TAB = {
  href: "/admin",
  // No data-tour: the guided tour is for customers, and the site console is
  // ADMIN_EMAILS-only — an anchor here would be a tour stop nobody can reach
  // (tests/tour-anchors-exist).
  tour: undefined,
  label: "Site",
  icon: (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
      <path fillRule="evenodd" d="M12 2.25c-5.385 0-9.75 4.365-9.75 9.75s4.365 9.75 9.75 9.75 9.75-4.365 9.75-9.75S17.385 2.25 12 2.25zm4.125 3.352a8.257 8.257 0 013.362 4.148h-2.78a14.6 14.6 0 00-1.37-4.148zM12 3.75c.69 0 1.717 1.507 2.25 4.5h-4.5c.533-2.993 1.56-4.5 2.25-4.5zM7.875 5.602A14.6 14.6 0 006.505 9.75h-2.78a8.257 8.257 0 014.15-4.148zM3.75 12c0-.264.013-.525.038-.782h3.02a19.4 19.4 0 000 3.064h-3.02A8.36 8.36 0 013.75 12zm.99 4.282h2.78a14.6 14.6 0 001.37 4.148 8.257 8.257 0 01-4.15-4.148zM12 20.25c-.69 0-1.717-1.507-2.25-4.5h4.5c-.533 2.993-1.56 4.5-2.25 4.5zm2.52-6h-5.04a17.6 17.6 0 010-4.5h5.04a17.6 17.6 0 010 4.5zm1.605 6.18a14.6 14.6 0 001.37-4.148h2.78a8.257 8.257 0 01-4.15 4.148zm1.067-5.648a19.4 19.4 0 000-3.064h3.02a8.36 8.36 0 010 3.064h-3.02z" clipRule="evenodd" />
    </svg>
  ),
};

export default function MobileNav({ showAdmin: showAdminProp, showSite: showSiteProp }: { showAdmin?: boolean; showSite?: boolean }) {
  const pathname = usePathname();
  // Props present = the page resolved them (MobileNavGate). Absent = the
  // loading skeleton, which uses what this bar last showed. The server
  // snapshot is "" so SSR and hydration stay identical.
  const remembered = useSyncExternalStore(noSubscribe, readRememberedTabs, () => "");
  const resolved = showAdminProp !== undefined || showSiteProp !== undefined;
  const showAdmin = resolved ? !!showAdminProp : remembered.includes("admin");
  const showSite = resolved ? !!showSiteProp : remembered.includes("site");
  useEffect(() => {
    if (!resolved) return;
    const v = [showAdmin && "admin", showSite && "site"].filter(Boolean).join(",");
    try { localStorage.setItem(NAV_EXTRA_TABS_KEY, v); } catch { /* storage blocked */ }
  }, [resolved, showAdmin, showSite]);
  const searchParams = useSearchParams();
  const [card, setCard] = useState<string | null>(null);

  // Carry the selected card across tabs so the view doesn't reset to the picker.
  useEffect(() => {
    const fromUrl = searchParams.get("card");
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time read of URL/localStorage on mount
    if (fromUrl) { setCard(fromUrl); return; }
    try { setCard(localStorage.getItem(ACTIVE_CARD_KEY)); } catch { /* ignore */ }
  }, [searchParams]);

  const withCard = (href: string) =>
    (href === "/dashboard" || href === "/contacts" || href === "/share") && card ? `${href}?card=${card}` : href;

  // Office admin first, then the site console — the same order as the
  // dashboard's desktop header. Six tabs only ever happen for a site owner who
  // also runs an office; the tighter padding below keeps them on one row at 320px.
  const tabs = [...TABS, ...(showAdmin ? [ADMIN_TAB] : []), ...(showSite ? [SITE_TAB] : [])];
  const tight = tabs.length > 5;

  return (
    <nav className="sc-tabbar fixed bottom-0 left-0 right-0 z-40 md:hidden bg-gray-950/95 backdrop-blur border-t border-gray-800/80" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
      <div className={`flex items-center justify-around py-2 ${tight ? "px-0.5" : "px-2"}`}>
        {tabs.map(({ href, tour, label, icon }) => {
          const active = pathname === href || (href !== "/dashboard" && pathname.startsWith(href));
          // Admin gets the console's purple so it reads as a separate area.
          // Darker than the old #3b82f6 / #a855f7: on the LIGHT tab bar
          // (rgba(250,247,242)) those measured 3.44:1 and 3.6:1 — under the
          // 4.5:1 AA floor for this 10px label. These clear it on the light bar
          // and stay legible on the dark one.
          // Tokens (globals.css sets them on .sc-tabbar): the tint, the Office
          // tint, and Apple's idle tab grey — each theme supplies its own.
          const activeColor = href === "/office/admin" ? "var(--sc-tint-office)" : "var(--sc-tint)";
          return (
            <Link
              key={href}
              href={withCard(href)}
              data-tour={tour}
              aria-current={active ? "page" : undefined}
              className={`flex flex-col items-center gap-0.5 py-1.5 rounded-xl transition-colors min-w-0 ${tight ? "px-1.5" : "px-3"} ${active ? "font-bold" : ""}`}
              style={{ color: active ? activeColor : "var(--sc-gray)" }}
            >
              {icon}
              <span className="text-[0.625rem] font-semibold">{label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
