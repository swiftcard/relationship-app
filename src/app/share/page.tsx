import { redirect } from "next/navigation";
import { awaitingPlanChoice } from "@/lib/card-active";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase-server";
import { getAdminSupabase } from "@/lib/supabase-admin";
import AppTopNav from "@/components/AppTopNav";
import { isAdminEmail } from "@/lib/admin";
import MobileNavGate from "@/components/MobileNavGate";
import HelpWidget from "@/components/HelpWidget";
import CopyButton from "@/components/CopyButton";
import EmailSignatureBox from "@/components/EmailSignatureBox";
import ShareCardResolver from "@/components/ShareCardResolver";
import { ACTIVE_CARD_COOKIE } from "@/lib/active-card";
import { buildCardData } from "@/lib/card-data";
import { isPaidPlan } from "@/lib/plan";
import { pickFreeLiveCardIds } from "@/lib/card-active";
import { canViewOfficeAdmin, getOfficeSubUserContext } from "@/lib/office-roles";
import { ownLiveHref } from "@/lib/self-pass";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://swiftcard.me";

// "Share" — the Swift Links link and the Email Signature generator for the
// CURRENTLY SELECTED card only. The card comes from ?card= (carried by the
// dashboard nav); ShareCardResolver backfills it from the card the user last
// selected on the dashboard when the URL doesn't name one, so this page always
// mirrors the card they're working on rather than showing a picker.
export default async function SharePage({
  searchParams,
}: {
  searchParams: Promise<{ card?: string }>;
}) {
  const params = await searchParams;
  // ?card= wins; otherwise fall back to the cookie written by
  // CardSelectionPersist when the user picked a card on the dashboard.
  //
  // Reading it HERE, during the server render, is the fix for "the signature
  // shows the wrong card and the headshot is glitchy". The tab bar builds its
  // Links href from a state value that starts null and is only filled in a mount
  // effect, so a tap before that lands on a bare /share. This page then fell
  // back to shareableCards[0] — the OLDEST card — and ShareCardResolver
  // redirected to the right one a moment later. The user saw the wrong card's
  // signature, then a reload. Headshots are per-card (see lib/card-media), and
  // the oldest card is exactly the one holding the legacy account photo, so the
  // headshot appeared and then disappeared as the correct, photo-less card
  // loaded. With the cookie the right card is rendered first and no redirect
  // happens at all.
  const cookieCard = (await cookies()).get(ACTIVE_CARD_COOKIE)?.value ?? null;
  const selectedCard = params.card ?? cookieCard;

  const supabase = await createClient();
  // Same shape as the dashboard: getClaims verifies the access token LOCALLY
  // (no network), so the reads start at once, and getUser() — the server-side
  // check that catches a deleted account with a still-live token — runs
  // alongside them instead of in front of them. This page used to pay four
  // serial round trips (user → profile → cards → office) before rendering.
  const { data: claimsData } = await supabase.auth.getClaims();
  if (!claimsData?.claims?.sub) redirect("/login");
  const uid = claimsData.claims.sub;
  const [{ data: { user } }, { data: profile }, { data: cards }, officeSubUser] = await Promise.all([
    supabase.auth.getUser(),
    supabase.from("profiles").select("*").eq("id", uid).single(),
    getAdminSupabase()
      .from("cards")
      .select("*")
      .eq("user_id", uid)
      .order("created_at", { ascending: true }),
    getOfficeSubUserContext(uid),
  ]);
  if (!user || user.id !== uid) redirect("/login");
  if (!profile) redirect("/onboarding");
  if ((profile.customization as { _deleted?: boolean } | null)?._deleted) redirect("/account-deleted");

  const allCards = cards ?? [];
  // Need a card to have a Swift Links URL / signature — send card-less users to
  // the dashboard to create one first.
  if (allCards.length === 0) redirect("/dashboard");
  // A new account that hasn't chosen a plan has no live card yet; sharing a
  // link that 404s is the wrong first experience (2026-09-16 website audit).
  if (awaitingPlanChoice(profile)) redirect("/welcome");

  const isPro = isPaidPlan(profile.plan);

  // Only cards that actually SERVE publicly can be shared. On Free, the
  // grandfathering rule is that the oldest FREE_CARD_LIMIT cards stay live and
  // the rest are refused by /card and /links — the dashboard already greys
  // those out and the card page 404s them. This selector had no such check, so
  // a downgraded account could pick its old Pro-era card here and hand out a
  // link, a QR or a wallet pass that dead-ends for whoever receives it. Worse
  // than a broken page in the product: this is the surface whose entire job is
  // producing URLs for other people.
  //
  // `cards` is ordered created_at ascending — the order pickFreeLiveCardIds
  // expects — so this is the same live set the public pages serve, including
  // the card chosen to stay live when Pro ended.
  const liveIds = pickFreeLiveCardIds(
    allCards.map((c) => c.id as string),
    (profile as { free_live_card_id?: string | null }).free_live_card_id,
  );
  const shareableCards = isPro ? allCards : allCards.filter((c) => liveIds.includes(c.id as string));
  const activeCard =
    shareableCards.find((c) => c.username === selectedCard) ?? shareableCards[0] ?? allCards[0];
  const activeSource = activeCard;
  const activeUsername = activeCard.username as string;
  // Keep the "Admin" nav item present across the app shell (same gate as the page).
  // resolveOfficeContext is per-request cached and already warm from the batch
  // above, so this is effectively free.
  const showOfficeAdmin = await canViewOfficeAdmin(user.id, profile.plan);
  // The site-owner console tab ("Site"), on this page's bar as on every other.
  const showSite = isAdminEmail(user.email);

  const cardUrl = `${APP_URL}/${activeUsername}?source=email_signature`;
  const swiftUrl = `${APP_URL}/links/${activeUsername}`;

  // The SAME builder the public card page uses. This page's whole promise is
  // that the signature looks identical to the card, and it cannot keep that
  // promise while being a second implementation of the card — this file used to
  // read `snapchat` and `address` out of the RAW customization where the card
  // page read them out of the plan-sanitized one, so the two genuinely differed.
  const { data: cardData, template: activeTemplate } = buildCardData(activeSource, {
    appUrl: APP_URL,
    isPro,
    accountPhotoUrl: profile.photo_url,
  });

  return (
    <main className="sc-app min-h-screen bg-gray-950 px-5 py-10 pb-24 md:pb-10">
      <MobileNavGate showAdmin={showOfficeAdmin} showSite={showSite} />
      <HelpWidget floating member={!!officeSubUser} />

      {/* Top accent stripe */}
      <div className="sc-top-stripe fixed top-0 left-0 right-0 z-40 h-0.5 bg-gradient-to-r from-blue-600 via-violet-500 to-blue-400" />

      {/* Sticky nav — the one every app page shares (AppTopNav). No
          "← Dashboard" beside the logo and the Dashboard tab any more: they
          already go there, and so does the Home tab on a phone. */}
      <AppTopNav
        active="links"
        card={activeUsername}
        showAdmin={showOfficeAdmin}
        showSite={showSite}
        showGrow={!officeSubUser}
      />

      {/* Ensure the page reflects the currently selected card when the URL
          didn't carry one. */}
      <ShareCardResolver current={activeUsername} />

      <div className="max-w-md mx-auto pt-20">
        {/* Header — names the card these belong to, so it's unambiguous which
            card's Swift Links / signature are shown. */}
        <div className="mb-6">
          <p className="text-[0.6875rem] font-bold tracking-[0.25em] text-blue-500 uppercase mb-1">SwiftCard</p>
          <h1 className="text-2xl font-bold text-white">Links</h1>
          <p className="text-gray-500 text-sm mt-1">
            For <span className="text-gray-300 font-medium">{(activeCard.label || activeCard.name || activeUsername) as string}</span>
            <span className="text-gray-600"> · /{activeUsername}</span>
          </p>
        </div>

        <div className="space-y-6">
          {/* Swift Links */}
          <div data-tour="swift-links">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Swift Links</p>
            <div className="bg-gray-900 border border-gray-800/80 rounded-2xl p-5">
              <p className="text-gray-500 text-xs mb-3 leading-relaxed">
                A separate link from your card — your bio, socials, and links in one place. Drop it in your Instagram, TikTok, or any social bio.
              </p>
              <div className="flex items-center gap-2 bg-gray-800/60 border border-gray-700/60 rounded-xl px-3 py-2.5">
                <svg viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth={1.8} className="w-3.5 h-3.5 shrink-0">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244" />
                </svg>
                <span className="text-blue-400 text-xs truncate flex-1">{swiftUrl.replace("https://", "")}</span>
                <CopyButton text={swiftUrl} />
              </div>
              <a href={ownLiveHref(user.id, swiftUrl, APP_URL)} target="_blank" rel="noopener noreferrer" className="mt-2 block text-center text-xs font-semibold text-gray-400 hover:text-white bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-full py-2 transition-colors">
                Open Swift Links →
              </a>
            </div>
          </div>

          {/* Swift Signature (email signature) */}
          <div id="signature" data-tour="email-signature" className="scroll-mt-24">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Swift Signature</p>
            <EmailSignatureBox
              key={activeUsername}
              cardData={cardData}
              template={activeTemplate}
              name={activeSource.name ?? ""}
              company={activeSource.company ?? ""}
              cardUrl={cardUrl}
              previewHref={ownLiveHref(user.id, cardUrl, APP_URL)}
              username={activeUsername}
              storageUrl={`${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/card-signatures/${activeUsername}.png`}
              ogUrl={`${APP_URL}/${activeUsername}/opengraph-image`}
            />
          </div>
        </div>
      </div>
    </main>
  );
}
