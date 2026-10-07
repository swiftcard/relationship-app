import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { getAdminSupabase } from "@/lib/supabase-admin";
import ContactsClient from "@/components/ContactsClient";
import MobileNavGate from "@/components/MobileNavGate";
import HelpWidget from "@/components/HelpWidget";
import { ensureUserCards } from "@/lib/ensure-cards";
import { SwiftCardIcon } from "@/components/SwiftCardLogo";
import GrowLinkButton from "@/components/GrowLinkButton";
import SettingsLinkButton from "@/components/SettingsLinkButton";
import { LOCKED_LEAD_TAG, PLAN_LIMITS } from "@/lib/plan";
import { isPaidProfile } from "@/lib/effective-plan";
import { redactPlaceLabel } from "@/lib/location-privacy";
import UpgradeButton from "@/components/UpgradeButton";
import { canViewOfficeAdmin, getOfficeSubUserContext } from "@/lib/office-roles";
import Link from "next/link";
import DownloadLink from "@/components/DownloadLink";
import { PlanGate, PlanNotice } from "@/components/PlanGate";
import { IapProPill } from "@/components/NativePaywall";
import { ACTIVE_CARD_COOKIE } from "@/lib/active-card";

export default async function ContactsPage({
  searchParams,
}: {
  searchParams: Promise<{ card?: string; lead?: string }>;
}) {
  const supabase = await createClient();
  // getClaims is a LOCAL ES256 verify (zero network) — it yields the user id
  // immediately so every query below starts NOW, instead of queueing behind a
  // serial auth round trip. getUser() (the full server-side check) still runs,
  // in parallel. Same pattern, same reasoning, as the dashboard.
  const { data: claimsData } = await supabase.auth.getClaims();
  const authedUserId = (claimsData?.claims?.sub as string | undefined) ?? null;
  if (!authedUserId) redirect("/login");

  // Resolve the active card SERVER-SIDE, the way /share already does.
  //
  // Without this the page rendered with no card selected, then ContactsClient's
  // mount effect read the same value out of localStorage and did a
  // router.replace to add ?card= — a second full navigation on every visit that
  // arrived without the param (which is every tap of the Contacts tab). The
  // user watched skeleton → contacts → skeleton → contacts, roughly doubling
  // the wait for the app's most-used screen.
  //
  // CardSelectionPersist already writes this cookie alongside localStorage, so
  // the value is identical — it just arrives early enough to matter. With
  // initialCardFilter set on the first render, that effect returns immediately
  // and the second navigation never happens.
  // ONE parallel batch for everything keyed to the user id — this page was a
  // five-deep serial chain (auth → params → cookie → profile → cards), i.e.
  // four extra round trips of pure latency on the app's most-used screen.
  const admin = getAdminSupabase();
  const cardsQuery = () =>
    admin.from("cards").select("id, username, name, label, title, company, email, phone, is_offline").eq("user_id", authedUserId).order("created_at", { ascending: true });
  const [{ data: { user } }, params, cookieStore, { data: profile }, cardsRes0] = await Promise.all([
    supabase.auth.getUser(),
    searchParams,
    cookies(),
    supabase.from("profiles").select("username, plan, customization, plan_expires_at, stripe_subscription_id").eq("id", authedUserId).single(),
    cardsQuery(),
  ]);
  if (!user) redirect("/login");
  const { card: cardParam, lead: selectedLeadParam } = params;
  // THE FIRST STEP OF THE FUNNEL (warm-lead plan §2.9: alert → opened →
  // follow-up → meeting). Opening a contact — from the push or the bell —
  // stamps the alerts about them as opened. Only the first open counts, it is
  // the owner's own rows, and it never holds up the page.
  if (selectedLeadParam && /^[0-9a-f-]{36}$/i.test(selectedLeadParam)) {
    const ownerId = user.id;
    after(async () => {
      try {
        await getAdminSupabase()
          .from("notifications")
          .update({ opened_at: new Date().toISOString() })
          .eq("user_id", ownerId)
          .eq("lead_id", selectedLeadParam)
          .is("opened_at", null);
      } catch { /* measurement only */ }
    });
  }
  const cookieCard = cookieStore.get(ACTIVE_CARD_COOKIE)?.value ?? null;
  if (!profile) redirect("/onboarding");
  if ((profile.customization as { _deleted?: boolean } | null)?._deleted) redirect("/account-deleted");

  // Skip the one-time migration entirely once done (the common case). The rare
  // unmigrated account mutates the cards table, so only then re-read it.
  let cardsRes = cardsRes0;
  if (!(profile.customization as { _migrated?: boolean } | null)?._migrated) {
    await ensureUserCards(user.id);
    cardsRes = await cardsQuery();
  }
  const { data: cards } = cardsRes;

  const cardList = cards ?? [];

  // Validated against the user's OWN cards before use. The cookie outlives the
  // card it names — delete a card and the stale value would otherwise filter
  // the list down to a card that no longer exists, showing an empty Contacts
  // page that reads as lost data. ContactsClient's effect had this same guard;
  // moving the resolution to the server has to bring the guard with it.
  // An explicit ?card= is validated the same way: one this account doesn't own
  // (the previous account's address, carried by the nav on the first page
  // after a sign-in) printed "Showing /<their address>" here (isolation audit
  // 2026-09-24). An unknown one simply shows every card.
  const ownsCard = (u: string | undefined | null) => !!u && cardList.some((c) => c.username === u);
  const selectedCardParam =
    ownsCard(cardParam) ? cardParam : (ownsCard(cookieCard) ? cookieCard! : undefined);
  const allUsernames = cardList.map((c) => c.username);

  // Leads depend on the card list above; the office-admin gate doesn't depend
  // on leads — so they share one round trip instead of stacking two.
  // geo_accuracy is requested so the detail panel can qualify the one inferred
  // line on it (see lib/location-display.ts). Selecting a column that isn't
  // migrated yet fails the WHOLE query and would empty the contacts list, so a
  // 42703/PGRST204 retries without it — contacts matter far more than a label.
  const LEAD_COLS = "id, name, email, phone, company, company_description, location, notes, status, tags, follow_up_date, source, visitor_id, card_owner, where_met, convo_details, message, follow_up_sequence, created_at";
  const loadLeads = async (cols: string) =>
    admin.from("leads").select(cols).in("card_owner", allUsernames).order("name", { ascending: true });
  const [leadsRes, showOfficeAdmin, officeSubUser] = await Promise.all([
    (async () => {
      const withGeo = await loadLeads(`${LEAD_COLS}, geo_accuracy`);
      if (withGeo.error && (withGeo.error.code === "42703" || withGeo.error.code === "PGRST204")) {
        return loadLeads(LEAD_COLS);
      }
      return withGeo;
    })(),
    canViewOfficeAdmin(authedUserId, profile.plan),
    getOfficeSubUserContext(authedUserId),
  ]);
  const rawLeads = leadsRes.data as unknown as (Record<string, unknown> & { tags?: unknown })[] | null;

  // Free plan: leads captured beyond the 5/month cap are locked — hide them here
  // too (same as the dashboard) so they're never revealed until the account is Pro.
  // effectivePlan: an expired timed grant is Free now, not at the next cron.
  const paid = isPaidProfile(profile);
  // Locations are a Pro feature, and this panel printed the lead's own
  // `location` column in plain text to everybody — the same leak the
  // notification bodies had, on every contact a Free account opened. The real
  // name is replaced HERE, so it never reaches the browser; the panel blurs
  // what is left (components/NotificationBody → BlurredPlace). Nothing in the
  // UI mentions Pro or upgrading — owner, 2026-09-11: "just blur the location
  // name". `geo_accuracy` goes with it: it only exists to qualify a real place
  // name, and against blocks it would print "(approximate)" under a smudge.
  const leads = paid
    ? rawLeads
    : (rawLeads ?? [])
        .filter((l) => !(Array.isArray(l.tags) && l.tags.includes(LOCKED_LEAD_TAG)))
        .map((l) => (l.location ? { ...l, location: redactPlaceLabel(l.location as string), geo_accuracy: null } : l));

  // How many real contacts we're withholding. The dashboard has always counted
  // these and said so; this page filtered them out in silence — so a Free user at
  // the cap saw a short list and no hint that anything was missing. That is both
  // the most confusing state in the product (it reads as lost data) and the
  // single highest-intent upsell moment there is: these are real people who
  // already asked to be contacted.
  const lockedCount = paid ? 0 : (rawLeads ?? []).length - (leads ?? []).length;

  // showOfficeAdmin resolved in the batch above — the same gate the
  // /office/admin page itself applies, kept for the app-shell "Admin" item.

  // Carry the selected card back to the dashboard so it doesn't flip to the first card.
  const dashCard = selectedCardParam ?? cardList[0]?.username;
  const dashHref = dashCard ? `/dashboard?card=${dashCard}` : "/dashboard";
  // Links names its card too: a bare /share could come back from the client
  // router cache still rendered for the card viewed before (isolation audit
  // 2026-09-24).
  const shareHref = dashCard ? `/share?card=${dashCard}` : "/share";

  // The header count and the Export button must describe the LIST BELOW. That
  // list shows EVERY card's contacts until one is picked — ContactsClient gets
  // initialCardFilter={null} without ?card=. Both were pinned to cardList[0]
  // instead, so an account with more than one card saw the full list sitting
  // under a total for card #1 only, and Export quietly downloaded just that
  // card's contacts while appearing to export what was on screen.
  //
  // dashCard is deliberately left as-is: the "Dashboard" link genuinely needs a
  // card to open, and defaulting it to the first one is correct.
  const contactCount = selectedCardParam
    ? (leads ?? []).filter((l) => l.card_owner === selectedCardParam).length
    : (leads ?? []).length;
  // With no card selected, omit the param entirely — the export route already
  // falls back to every username this user owns when none is given.
  const exportHref = selectedCardParam
    ? `/api/leads/export?username=${selectedCardParam}`
    : "/api/leads/export";

  return (
    <div className="sc-app min-h-screen bg-gray-950 flex flex-col pb-16 md:pb-0">
      <MobileNavGate showAdmin={showOfficeAdmin} />
      <HelpWidget floating member={!!officeSubUser} />
      {/* Top accent stripe */}
      <div className="sc-top-stripe fixed top-0 left-0 right-0 z-40 h-0.5 bg-gradient-to-r from-blue-600 via-violet-500 to-blue-400" />

      {/* Sticky nav */}
      <nav className="sc-app fixed top-0.5 left-0 right-0 z-30 bg-gray-950/95 backdrop-blur border-b border-gray-800">
        <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between gap-6">
          <div className="flex items-center gap-3 shrink-0">
            <Link href={dashHref} className="flex items-center gap-2">
              <SwiftCardIcon size={28} />
              <span className="font-bold text-white text-base tracking-tight">SwiftCard</span>
            </Link>
          </div>

          <div className="hidden sm:flex items-center gap-1">
            <Link href={dashHref} className="text-sm text-gray-400 hover:text-white hover:bg-gray-800 px-3 py-1.5 rounded-lg transition-colors">
              Dashboard
            </Link>
            <Link href="/contacts" className="text-sm text-white font-medium px-3 py-1.5 rounded-lg bg-gray-800">
              Contacts
            </Link>
            <Link href={shareHref} className="text-sm text-gray-400 hover:text-white hover:bg-gray-800 px-3 py-1.5 rounded-lg transition-colors">
              Links
            </Link>
            {showOfficeAdmin && (
              <Link href="/office/admin" className="text-sm text-purple-400 hover:text-purple-300 hover:bg-gray-800 px-3 py-1.5 rounded-lg transition-colors font-medium">
                Admin
              </Link>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {/* Mobile has Settings in the bottom tab bar — hide the top-bar gear below md, same as the dashboard. */}
            <span className="hidden md:flex items-center"><SettingsLinkButton /></span>
            {!officeSubUser && <GrowLinkButton />}
            <Link href={dashHref} className="text-sm text-gray-400 hover:text-white transition-colors">
              ← Dashboard
            </Link>
          </div>
        </div>
      </nav>

      {/* Header */}
      {/* px-6 belongs INSIDE max-w-6xl, matching the list container below
          (`max-w-6xl mx-auto w-full px-6`). With the padding on the OUTER
          element the centred box was measured against (viewport - 48px), so
          past ~1150px the header title sat exactly 24px left of the content it
          heads — measured 144 vs 168 at 1440, 64 vs 88 at 1280, aligned only on
          narrow screens where neither max-width binds. The border-b stays out
          here so the rule still spans the full viewport. */}
      {/* Nav clearance and visual padding are SEPARATE, on different elements.
          They used to be two utilities on the same one — `pt-[57px] … py-5` —
          which is a cascade race between padding-top and padding-block that
          pt-[57px] won. So the row got 57px of top padding and none of the 20px
          it looked like it had, and it began exactly where the nav ended.
          Worse, 57 was 2px short: the bar is the 2px accent stripe (top-0.5)
          + h-14 (56) + a 1px border = 59px, so the nav actually covered the
          title. Measured before: nav bottom 59, title top 58.
          Now the outer element owns clearance (59) and the inner row owns the
          20px of breathing room, so neither can override the other. */}
      <div className="pt-[59px] border-b border-gray-800 bg-gray-950">
        <div data-tour="contacts-page" className="max-w-6xl mx-auto w-full px-6 py-5 flex items-center justify-between gap-4">
          {/* One phrase, not three fragments. "Contacts 8 Total contacts" said
              the same word twice and read as a label with a stray number; the
              count belongs IN the title.
              text-lg/semibold/tracking-tight is the heading idiom used across
              the app rather than this page's old one-off text-xl bold.
              tabular-nums keeps the number from reflowing the word beside it as
              the count changes; min-w-0 + truncate makes the title yield rather
              than push Export (shrink-0) off the right edge. */}
          <h1 className="text-lg font-semibold text-white tracking-tight min-w-0 truncate">
            <span className="tabular-nums">{contactCount}</span>{" "}
            {contactCount === 1 ? "Contact" : "Contacts"}
          </h1>
          {(leads?.length ?? 0) > 0 && (
            paid ? (
              <DownloadLink
                href={exportHref}
                title="Export your contacts as CSV"
                className="flex items-center gap-1.5 text-xs font-semibold text-gray-400 hover:text-white border border-gray-700 hover:border-gray-500 px-3 py-1.5 rounded-lg transition-colors shrink-0"
              >
                <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
                  <path fillRule="evenodd" d="M8 1a.75.75 0 01.75.75v6.19l1.22-1.22a.75.75 0 111.06 1.06l-2.5 2.5a.75.75 0 01-1.06 0l-2.5-2.5a.75.75 0 111.06-1.06l1.22 1.22V1.75A.75.75 0 018 1zM1.5 10.5a.75.75 0 01.75.75v1.5c0 .138.112.25.25.25h11a.25.25 0 00.25-.25v-1.5a.75.75 0 011.5 0v1.5A1.75 1.75 0 0113.5 14.5h-11A1.75 1.75 0 01.75 12.75v-1.5a.75.75 0 01.75-.75z" clipRule="evenodd"/>
                </svg>
                Export CSV
              </DownloadLink>
            ) : (
              <PlanGate
                feature="csv-export"
                nativeCopy="Pro feature — Exporting contacts is only available on the Pro plan"
                nativeContent={
                  <span
                    title="Exporting contacts is only available on the Pro plan"
                    className="flex items-center gap-1.5 text-xs font-semibold text-gray-400 border border-gray-700 px-3 py-1.5 rounded-lg shrink-0"
                  >
                    <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
                      <path fillRule="evenodd" d="M8 1a.75.75 0 01.75.75v6.19l1.22-1.22a.75.75 0 111.06 1.06l-2.5 2.5a.75.75 0 01-1.06 0l-2.5-2.5a.75.75 0 111.06-1.06l1.22 1.22V1.75A.75.75 0 018 1zM1.5 10.5a.75.75 0 01.75.75v1.5c0 .138.112.25.25.25h11a.25.25 0 00.25-.25v-1.5a.75.75 0 011.5 0v1.5A1.75 1.75 0 0113.5 14.5h-11A1.75 1.75 0 01.75 12.75v-1.5a.75.75 0 01.75-.75z" clipRule="evenodd"/>
                    </svg>
                    Export CSV <IapProPill />
                  </span>
                }
              >
                <a
                  href={`/upgrade`}
                  title="CSV export is a Pro feature"
                  className="flex items-center gap-1.5 text-xs font-semibold text-gray-400 hover:text-white border border-gray-700 hover:border-gray-500 px-3 py-1.5 rounded-lg transition-colors shrink-0"
                >
                  <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
                    <path fillRule="evenodd" d="M8 1a.75.75 0 01.75.75v6.19l1.22-1.22a.75.75 0 111.06 1.06l-2.5 2.5a.75.75 0 01-1.06 0l-2.5-2.5a.75.75 0 111.06-1.06l1.22 1.22V1.75A.75.75 0 018 1zM1.5 10.5a.75.75 0 01.75.75v1.5c0 .138.112.25.25.25h11a.25.25 0 00.25-.25v-1.5a.75.75 0 011.5 0v1.5A1.75 1.75 0 0113.5 14.5h-11A1.75 1.75 0 01.75 12.75v-1.5a.75.75 0 01.75-.75z" clipRule="evenodd"/>
                  </svg>
                  Export CSV · Pro
                </a>
              </PlanGate>
            )
          )}
        </div>
      </div>

      {/* Locked contacts — real people this account captured but can't see yet.
          Says the number plainly, names the price, and offers a way out. */}
      {lockedCount > 0 && (
        <div className="max-w-6xl mx-auto w-full px-6 pt-4">
          <PlanGate
            feature="leads-locked"
            nativeCopy={`Pro feature — ${lockedCount} new leads are locked this month. Unlimited leads are only available on the Pro plan`}
            nativeContent={
              <PlanNotice
                tier="pro"
                copy={`Pro feature — ${lockedCount} new leads are locked this month. Unlimited leads are only available on the Pro plan`}
              />
            }
          >
            <div className="rounded-2xl border border-amber-500/25 bg-amber-500/5 px-4 py-3.5 flex items-start justify-between gap-4 flex-wrap">
              <div className="min-w-0">
                <p className="text-amber-300 text-sm font-semibold">
                  {lockedCount === 1
                    ? "1 more contact is waiting for you"
                    : `${lockedCount} more contacts are waiting for you`}
                </p>
                <p className="text-amber-200/70 text-xs mt-0.5 leading-relaxed">
                  Free keeps {PLAN_LIMITS.FREE_LEADS_PER_MONTH} new contacts a month. We saved the rest — they&apos;re
                  yours the moment you upgrade, nothing was lost.
                </p>
              </div>
              <div className="shrink-0">
                <UpgradeButton placement="contacts_locked_banner" />
              </div>
            </div>
          </PlanGate>
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 pt-0 max-w-6xl mx-auto w-full">
        <ContactsClient
          leads={(leads ?? []) as unknown as Parameters<typeof ContactsClient>[0]["leads"]}
          primaryUsername={cardList[0]?.username}
          // Follow-up automations are Pro. The cron has always refused to SEND
          // for a Free account (it pauses the sequence and says so); without
          // this the panel still let them build one that would never go out.
          isPro={paid}
          initialCardFilter={selectedCardParam ?? null}
          initialSelectedId={selectedLeadParam ?? null}
          userCards={cardList.map((c) => ({ username: c.username, name: c.label || c.name || c.username }))}
          // What a share from a contact is signed with: the CARD the contact
          // belongs to (name/title/company/phone/email per card), so the
          // pre-filled text and email read as that card's owner.
          cardSigners={Object.fromEntries(cardList.map((c) => [c.username, {
            name: (c.name as string | null) ?? null,
            title: (c.title as string | null) ?? null,
            company: (c.company as string | null) ?? null,
            phone: (c.phone as string | null) ?? null,
            email: (c.email as string | null) ?? null,
            // Whether this card is still LIVE. A contact captured on a card
            // that was later switched off would otherwise be shared with a
            // link that 404s and previews as the generic SwiftCard brand image
            // — reported 2026-09-08 as "the preview is missing my headshot".
            offline: c.is_offline === true,
          }]))}
        />
      </div>
    </div>
  );
}
