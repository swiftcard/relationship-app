import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase-server";
import { getReferralProgress } from "@/lib/referral-server";
import { canViewOfficeAdmin, getOfficeSubUserContext } from "@/lib/office-roles";
import { isAdminEmail } from "@/lib/admin";
import { publicCardSlug } from "@/lib/owner-usernames";
import AppTopNav from "@/components/AppTopNav";
import MobileNavGate from "@/components/MobileNavGate";
import HelpWidget from "@/components/HelpWidget";
import ReferAFriend from "@/components/ReferAFriend";
import NativeHidden from "@/components/NativeHidden";
import RateUsCard from "@/components/RateUsCard";
import { APP_STORE_ID } from "@/lib/app-store";
import GrowShare from "@/components/GrowShare";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://swiftcard.me";

// "Help us grow" — a single hub for the word-of-mouth loops that grow SwiftCard:
// rate us, invite friends (referral rewards), spread the link, and a few smaller
// asks. Authenticated; mirrors the Settings page chrome.
export default async function GrowPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("customization, plan")
    .eq("id", user.id)
    .single();
  if (!profile) redirect("/onboarding");
  if ((profile.customization as { _deleted?: boolean } | null)?._deleted) redirect("/account-deleted");

  // The public /<slug> card link for this account. NOT profile.username — modern
  // accounts carry a blank profile handle and a separate card slug, so the
  // account handle 404s.
  const cardSlug = await publicCardSlug(user.id);

  // The referral/growth programme isn't aimed at office sub-users (their
  // account is company-managed) — same rule as the hidden Settings section,
  // enforced here so the page can't be opened by URL.
  if (await getOfficeSubUserContext(user.id)) redirect("/dashboard");

  const [referral, showOfficeAdmin] = await Promise.all([
    getReferralProgress(user.id),
    canViewOfficeAdmin(user.id, profile.plan),
  ]);
  // The site-owner console tab ("Site"), on this page's bar as on every other.
  const showSite = isAdminEmail(user.email);
  const inviteLink = referral?.code ? `${APP_URL}/r/${referral.code}` : APP_URL;

  const secondary: { label: string; sub: string; href: string; external?: boolean; icon: React.ReactNode }[] = [
    {
      label: "Add your Swift Signature to your email",
      sub: "Every email you send becomes a soft invite",
      href: "/share#signature",
      icon: <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />,
    },
    {
      label: "Share your live card",
      sub: "Show people SwiftCard in action",
      href: cardSlug ? `${APP_URL}/${cardSlug}` : "/dashboard",
      external: !!cardSlug,
      icon: <path strokeLinecap="round" strokeLinejoin="round" d="M9 8.25H7.5a2.25 2.25 0 00-2.25 2.25v9a2.25 2.25 0 002.25 2.25h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25H15M9 12l3 3m0 0l3-3m-3 3V2.25" />,
    },
    {
      label: "Follow along & tag us",
      sub: "Post your card and mention @SwiftCard",
      href: "https://www.linkedin.com/sharing/share-offsite/?url=" + encodeURIComponent(inviteLink),
      external: true,
      icon: <path strokeLinecap="round" strokeLinejoin="round" d="M6.633 10.5c.806 0 1.533-.446 2.031-1.08a9.041 9.041 0 012.861-2.4c.723-.384 1.35-.956 1.653-1.715a4.498 4.498 0 00.322-1.672V3a.75.75 0 01.75-.75A2.25 2.25 0 0116.5 4.5c0 1.152-.26 2.243-.723 3.218-.266.558.107 1.282.725 1.282h3.126c1.026 0 1.945.694 2.054 1.715.045.422.068.85.068 1.285a11.95 11.95 0 01-2.649 7.521c-.388.482-.987.729-1.605.729H13.48c-.483 0-.964-.078-1.423-.23l-3.114-1.04a4.501 4.501 0 00-1.423-.23H5.904M14.25 9h2.25M5.904 18.75c.083.205.173.405.27.602.197.4-.078.898-.523.898h-.908c-.889 0-1.713-.518-1.972-1.368a12 12 0 01-.521-3.507c0-1.553.295-3.036.831-4.398C3.387 10.203 4.167 9.75 5 9.75h1.053c.472 0 .745.556.5.96a8.958 8.958 0 00-1.302 4.665c0 1.194.232 2.333.654 3.375z" />,
    },
  ];

  return (
    <main className="sc-app min-h-screen bg-gray-950 px-5 py-10 pb-24 md:pb-10">
      <MobileNavGate showAdmin={showOfficeAdmin} showSite={showSite} />
      <HelpWidget floating />

      {/* Top accent stripe */}
      <div className="sc-top-stripe fixed top-0 left-0 right-0 z-40 h-0.5 bg-gradient-to-r from-blue-600 via-violet-500 to-blue-400" />

      {/* Sticky nav — the one every app page shares (AppTopNav). This
          page's copy had no "Admin" and a "← Dashboard" beside the logo and
          the Dashboard tab, which already go there. */}
      <AppTopNav showAdmin={showOfficeAdmin} showSite={showSite} showGrow />

      <div className="max-w-sm mx-auto pt-20">
        {/* Header */}
        <div className="mb-8">
          <p className="text-[0.6875rem] font-bold tracking-[0.25em] text-blue-500 uppercase mb-1">SwiftCard</p>
          <h1 className="text-2xl font-bold text-white">Help us grow</h1>
          <p className="text-gray-500 text-sm mt-1 leading-relaxed">
            {/* Not to an Office account: its referral panel is hidden below and
                /api/referrals/claim refuses it, so "earns you free Pro" was a
                promise this page could never keep for them. */}
            SwiftCard grows by word of mouth. A few seconds here goes a long way{profile.plan !== "enterprise" && <NativeHidden> — and most of it earns <span className="text-gray-300">you</span> free Pro</NativeHidden>}.
          </p>
        </div>

        <div className="space-y-8">
          {/* Rate us — a link to the App Store; hidden until the listing id is set. */}
          {APP_STORE_ID && (
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Rate us</p>
              <RateUsCard />
            </div>
          )}

          {/* Invite & earn — not on Office (see Settings). */}
          {profile.plan !== "enterprise" && <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Invite friends &amp; earn</p>
            {/* Its own share/copy pair stays off here: Spread the word, right
                below, shares this same invite link. */}
            <ReferAFriend progress={referral} showShare={false} />
          </div>}

          {/* Spread the word */}
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Spread the word</p>
            <GrowShare link={inviteLink} />
          </div>

          {/* More ways to help */}
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">More ways to help</p>
            <div className="bg-gray-900 border border-gray-800/80 rounded-2xl divide-y divide-gray-800/70 overflow-hidden">
              {secondary.map((s) => (
                <Link
                  key={s.label}
                  href={s.href}
                  {...(s.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                  className="flex items-center gap-3 px-4 py-4 hover:bg-gray-800/40 transition-colors group"
                >
                  <div className="w-9 h-9 rounded-xl bg-blue-500/10 flex items-center justify-center shrink-0">
                    <svg viewBox="0 0 24 24" fill="none" stroke="#60a5fa" strokeWidth={1.5} className="w-5 h-5">{s.icon}</svg>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-gray-200 text-sm font-medium leading-tight">{s.label}</p>
                    <p className="text-gray-500 text-xs mt-0.5 truncate">{s.sub}</p>
                  </div>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4 text-gray-600 group-hover:text-gray-400 shrink-0"><path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" /></svg>
                </Link>
              ))}
            </div>
          </div>

          <p className="text-center text-gray-600 text-xs pt-2 pb-4">
            Thank you for helping SwiftCard grow.
          </p>
        </div>
      </div>
    </main>
  );
}
