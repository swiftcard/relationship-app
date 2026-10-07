import Link from "next/link";
import DashboardLink from "@/components/DashboardLink";
import GrowLinkButton from "@/components/GrowLinkButton";
import SettingsLinkButton from "@/components/SettingsLinkButton";
import { SwiftCardIcon } from "@/components/SwiftCardLogo";

// THE top bar of every signed-in app page — Dashboard, Contacts, Links, Grow
// and Settings — so a tab, a breakpoint or a link can no longer exist on one
// page and not the next (owner, 2026-10-07: the app, the phone website and the
// computer website have to line up).
//
// It used to be five hand-copied bars that had drifted apart:
//   • Contacts switched at `sm`, every other page at `md`, so between 640 and
//     767px Contacts showed this bar's tabs AND the bottom tab bar.
//   • Grow had no "Admin"; only the dashboard had "Site" — while the phone's
//     tab bar (MobileNav) showed both on every page.
//   • Contacts, Links, Grow and Settings each added "← Dashboard" beside the
//     logo (which goes to the dashboard) and the Dashboard tab (ditto), with
//     the Home tab doing it a fourth time on a phone.
//
// The rules, the same on every page:
//   • tabs (md and up): Dashboard / Contacts / Links / Admin (office owners and
//     managers) / Site (the site owner) — the same set and order as MobileNav,
//     which carries them below md;
//   • right: the Settings gear (md and up — the tab bar has Settings on a
//     phone), the Grow heart (not for Office members, whose plan has no
//     referral programme), then whatever the page adds (`extras`: the
//     dashboard's theme toggle and bell).
export type AppTab = "dashboard" | "contacts" | "links";

export default function AppTopNav({
  active,
  card,
  showAdmin,
  showSite,
  showGrow,
  badge,
  extras,
  wide = false,
}: {
  /** The tab this page IS, drawn selected. Omitted on Grow and Settings. */
  active?: AppTab;
  /** The selected card, carried into every tab so switching tabs keeps it. */
  card?: string | null;
  showAdmin: boolean;
  showSite: boolean;
  showGrow: boolean;
  /** Beside the logo (the dashboard's Free / Pro / Office badge). */
  badge?: React.ReactNode;
  /** The right-hand cluster's page-specific end (the dashboard's theme + bell). */
  extras?: React.ReactNode;
  /** Contacts' list + detail run max-w-6xl; the bar matches its content. */
  wide?: boolean;
}) {
  const q = card ? `?card=${encodeURIComponent(card)}` : "";
  const tab = (on: boolean) =>
    `text-sm px-3 py-1.5 rounded-lg transition-colors ${on ? "text-white font-medium bg-gray-800" : "text-gray-400 hover:text-white hover:bg-gray-800/60"}`;

  return (
    <nav className="sc-app fixed top-0.5 left-0 right-0 z-30 bg-gray-950/95 backdrop-blur border-b border-gray-800/60">
      <div className={`${wide ? "max-w-6xl px-6" : "max-w-5xl px-5"} mx-auto h-14 flex items-center justify-between gap-4`}>
        <div className="flex items-center gap-3 shrink-0">
          <DashboardLink card={card} className="flex items-center gap-2">
            <SwiftCardIcon size={28} />
            <span className="font-bold text-white text-sm tracking-tight hidden sm:block">SwiftCard</span>
          </DashboardLink>
          {badge}
        </div>

        <div className="hidden md:flex items-center gap-0.5">
          <DashboardLink card={card} data-tour="nav-dashboard" aria-current={active === "dashboard" ? "page" : undefined} className={tab(active === "dashboard")}>
            Dashboard
          </DashboardLink>
          <Link href={`/contacts${q}`} data-tour="nav-contacts" aria-current={active === "contacts" ? "page" : undefined} className={tab(active === "contacts")}>
            Contacts
          </Link>
          <Link href={`/share${q}`} data-tour="nav-links" aria-current={active === "links" ? "page" : undefined} className={tab(active === "links")}>
            Links
          </Link>
          {showAdmin && (
            <Link href="/office/admin" data-tour="nav-admin" className="text-sm text-purple-400 hover:text-purple-300 hover:bg-gray-800/60 px-3 py-1.5 rounded-lg transition-colors font-medium">
              Admin
            </Link>
          )}
          {/* Site-owner console — a different thing entirely from the Office
              "Admin" above, so it's labelled separately to keep them apart. */}
          {showSite && (
            <Link href="/admin" className="text-sm text-blue-400 hover:text-blue-300 hover:bg-gray-800/60 px-3 py-1.5 rounded-lg transition-colors font-medium">
              Site
            </Link>
          )}
        </div>

        {/* -mr-1.5 pulls the icons back out to the container's right edge:
            each sits centred in a 36px hit target with ~6px of visual padding,
            which without the nudge reads as a gap the logo on the left does
            not have. */}
        <div className="flex items-center gap-2 shrink-0 -mr-1.5">
          <span data-tour="nav-settings" className="hidden md:flex items-center"><SettingsLinkButton /></span>
          {showGrow && <span data-tour="nav-grow" className="flex items-center"><GrowLinkButton /></span>}
          {extras}
        </div>
      </div>
    </nav>
  );
}
