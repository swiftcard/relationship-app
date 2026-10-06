import Link from "next/link";
import OfficeAdminNav from "./OfficeAdminNav";
import OfficeNotificationBell from "@/components/office/OfficeNotificationBell";
import AdminGuidedTour from "@/components/office/AdminGuidedTour";
import AdminTourAutoStart from "@/components/office/AdminTourAutoStart";
import HelpWidget from "@/components/HelpWidget";
import MobileNavGate from "@/components/MobileNavGate";
import { requireOfficeAdmin } from "@/lib/office-admin-guard";
import { listOfficeNotifications } from "@/lib/office-notify";
import { DisplayClockProvider } from "@/components/DisplayClock";
import TimezoneCookie from "@/components/TimezoneCookie";
import { safeTimeZone } from "@/lib/tz-days";
import { cookies } from "next/headers";

// Every /office/admin page inherits this shell: the Office gate + one consistent
// nav, so each area is a proper page instead of one crammed scroll.
//
// Deliberately mirrors the site-owner console's shell, but is a DIFFERENT thing:
// this is the team's own admin, gated on Office membership. /admin is
// ADMIN_EMAILS-only and office users must never reach it — nothing here links there.
export default async function OfficeAdminLayout({ children }: { children: React.ReactNode }) {
  const { office, officeId, caps, role } = await requireOfficeAdmin();
  const officeName = (office?.name as string) ?? "Your team";

  // Team-inbox notifications for the header bell — office-scoped, separate table
  // from the personal dashboard bell. Empty when the office isn't set up yet.
  const teamNotifications = officeId ? await listOfficeNotifications(officeId) : [];

  // The request's time and the viewer's zone for components/DisplayClock.
  // eslint-disable-next-line react-hooks/purity -- a server component renders once per request; this IS the request's time, handed to the client so hydration can match it
  const renderedAt = Date.now();
  const viewerTimeZone = safeTimeZone((await cookies()).get("sc_tz")?.value);

  // `sc-app` puts the console inside the app's theme system, like the
  // dashboard. Without it the shell was dark no matter what: in the app's
  // default light theme the html canvas is cream, so cream showed in the
  // status-bar strip above this dark page and below it at the bottom bounce —
  // the "white space at the top and bottom" in the iOS shell. Themed, the page
  // and the canvas are always the same colour and there is nothing to see.
  //
  // `sc-office-header` is the native fix for the sticky header: sticky
  // `top-0` sticks to the physical top of the screen, under the clock, so the
  // bell, the dashboard link and the tabs slid beneath the status bar as soon
  // as you scrolled. globals.css keeps it below the safe area in the shell.
  return (
    <div className="sc-app min-h-screen bg-gray-950 text-white">
      {/* Top accent stripe */}
      <div className="sc-top-stripe fixed top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-purple-600 via-violet-500 to-blue-400 z-50" />

      <header className="sc-office-header sticky top-0 z-40 bg-gray-950/90 backdrop-blur border-b border-gray-800/80">
        <div className="max-w-6xl mx-auto px-5">
          <div className="flex items-center justify-between h-12">
            <div className="flex items-center gap-3 min-w-0">
              <Link href="/office/admin" className="flex items-center gap-2 shrink-0 min-w-0">
                <span className="text-[0.625rem] font-bold tracking-[0.25em] text-slate-500 uppercase shrink-0">SwiftCard</span>
                <span className="text-xs font-bold bg-purple-600/20 border border-purple-500/30 text-purple-300 px-2 py-0.5 rounded-full shrink-0">Admin</span>
                <span className="text-xs text-gray-500 truncate hidden sm:block">{officeName}</span>
              </Link>
            </div>
            <div className="flex items-center gap-2 sm:gap-3 shrink-0">
              <Link href="/dashboard" className="text-xs text-gray-500 hover:text-white transition-colors shrink-0">
                ← My dashboard
              </Link>
              {officeId && <OfficeNotificationBell initialNotifications={teamNotifications} />}
            </div>
          </div>
          <OfficeAdminNav canBrand={caps.canBrand} canBill={!!officeId && (role === "owner" || role === "billing_admin")} />
        </div>
      </header>

      {/* pb clears the mobile tab bar; md+ keeps the original spacing. */}
      {/* The request's time and the viewer's zone, so the console's client
          tables format "Invited Sep 22" / "5 minutes ago" identically on the
          server and while hydrating (components/DisplayClock). */}
      <main className="max-w-6xl mx-auto px-5 pt-6 pb-28 md:pb-16">
        <DisplayClockProvider now={renderedAt} timeZone={viewerTimeZone}>
          {children}
        </DisplayClockProvider>
      </main>
      {/* Reports the browser's zone (sc_tz) for the next server render, so an
          admin who opens the console before ever visiting the dashboard is
          still formatted in their own zone from the second load on. */}
      <TimezoneCookie />
      {/* The same bottom tab bar as the rest of the app (Admin tab lit here),
          so a phone user can move between the console and their own dashboard
          without hunting for the small header link. */}
      <MobileNavGate />
      <AdminGuidedTour canBrand={caps.canBrand} canInvite={caps.canInvite} />
      {/* First visit to a REAL office (not the "Name your team" form) kicks off
          the admin tour once. */}
      {officeId && <AdminTourAutoStart />}
      {/* Bottom-right assistant scoped to the admin console — knows every tab
          and action here and only gives directions (never performs them). */}
      <HelpWidget floating area="office-admin" />
    </div>
  );
}
