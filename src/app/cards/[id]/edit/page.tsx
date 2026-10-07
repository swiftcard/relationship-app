import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase-server";
import { getAdminSupabase } from "@/lib/supabase-admin";
import CardEditForm from "./CardEditForm";
import { isProTrialEligible } from "@/lib/trial-eligibility";
import { trialHistoryFor } from "@/lib/trial-ledger";
import GuestDraftClaim from "@/components/GuestDraftClaim";
import DashboardLink from "@/components/DashboardLink";
import ShareCardCapture from "@/components/ShareCardCapture";
import { cardHeadshot } from "@/lib/card-media";
import { getOfficeSubUserContext } from "@/lib/office-roles";
import { getOfficeBrandForUser } from "@/lib/office-brand";

import { isPaidPlan } from "@/lib/plan";
import { buildCardData } from "@/lib/card-data";

export default async function CardEditPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ claim?: string; integration?: string; joined?: string; tab?: string }>;
}) {
  const { id } = await params;
  const { claim, integration, joined: joinedParam, tab } = await searchParams;
  const joined = joinedParam === "1";
  // Coming back from the LinkedIn consent hop: open the tab that owns the
  // headshot, so the photo importer is actually mounted to receive it.
  // ?tab=sharing is the Links page's "Edit my links": it opens on Socials (bio,
  // socials and links) instead of making them hunt for it from Card info.
  const initialTab = integration === "linkedin"
    ? ("design" as const)
    : tab === "sharing" ? ("sharing" as const) : undefined;
  const supabase = await createClient();
  // getClaims verifies the token locally, so every read below starts at once;
  // getUser() still runs, in the same batch, rather than as a round trip in
  // front of it. The office sub-user lookup joins the batch too — it needs only
  // the id (perf audit 2026-10-06: this page was five serial hops deep).
  const { data: claimsData } = await supabase.auth.getClaims();
  if (!claimsData?.claims?.sub) redirect("/login");
  const uid = claimsData.claims.sub;

  const admin = getAdminSupabase();
  const [{ data: { user } }, { data: card }, { data: profile }, subCtx] = await Promise.all([
    supabase.auth.getUser(),
    admin.from("cards").select("*").eq("id", id).eq("user_id", uid).single(),
    admin.from("profiles").select("photo_url, plan, stripe_customer_id").eq("id", uid).single(),
    // Office SUB-USER (active member, not the owner): their card carries the
    // organization's company information, so the editor shows those fields as
    // "Managed by your organization" instead of editable inputs, and the Design
    // tab locks while the office's design lock is on. Resolved server-side —
    // the client is never trusted for role or brand.
    getOfficeSubUserContext(uid),
  ]);
  if (!user || user.id !== uid) redirect("/login");

  if (!card) notFound();

  const isPro = isPaidPlan(profile?.plan);
  // Whether the Pro-required dialog may promise the free trial. Resolved HERE,
  // on the server, with the same helper the checkout API enforces with — so the
  // button's promise and the Stripe session cannot disagree. Costs nothing for
  // the common case: a Free user who has never subscribed has no Stripe
  // customer, and isProTrialEligible returns true without a network call.
  const trialEligible = isPro
    ? false
    : await isProTrialEligible(
        profile?.stripe_customer_id as string | null,
        undefined,
        await trialHistoryFor(user.id, user.email),
      );
  // Per-card headshot (legacy cards fall back to the account photo).
  const cardPhoto = cardHeadshot(card.customization, profile?.photo_url);

  // Office branding governs SUB-USER cards only. The office OWNER's personal
  // cards are individual to the admin (owner decision, Jul 2026) — an earlier
  // version also locked the owner's editor to the brand, which forced the
  // admin's own cards onto the office template. Owners now edit their cards
  // completely freely; the brand is managed on /office/admin/branding and
  // applies to the team.
  // `org` exists for EVERY sub-user, even before the admin has set any
  // branding: company-level fields are org territory regardless, so the
  // editor hides those inputs for a member of an unbranded office too
  // (matching the server, which discards them from a member's request).
  const brand = subCtx ? await getOfficeBrandForUser(user.id).catch(() => null) : null;
  const org = subCtx
    ? {
        company: brand?.company ?? null,
        website: brand?.website ?? null,
        logoUrl: brand?.logoUrl ?? null,
        phone: brand?.phone ?? null,
        fax: brand?.fax ?? null,
        address: brand?.address ?? null,
        // Locked only when the office has a look to lock TO. lockTemplate
        // defaults on for every brand (even one that only set links or a
        // company name), which hid the design controls behind "your
        // organization keeps every card matching" while nothing was applied.
        lockDesign: !!brand?.lockTemplate && !!(brand?.template || brand?.design),
        // ── The Swift Links half of the brand ──────────────────────────
        // Content the office set (applied and read-only for the member),
        // plus whether the office holds the page's LOOK.
        officeLinks: brand?.links ?? null,
        linkBio: brand?.linkBio ?? null,
        linkInstagram: brand?.linkInstagram ?? null,
        lockLinkDesign: brand?.lockLinkDesign ?? false,
      }
    : null;

  const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://swiftcard.me";

  // Share-preview capture data, so saving an edit re-photographs the card right
  // here (router.refresh() reloads this server component with fresh data →
  // content hash changes → re-capture). Without it, an edited card's
  // texted-link preview stayed stale until the owner next opened the dashboard
  // with this card selected.
  //
  // Built by the SHARED builder. "IDENTICAL construction to the dashboard's"
  // was the intent, and the comment here used to say so — but it was a sixth
  // hand-written copy, and this one never sanitized at all, so the image it
  // re-photographed could carry design keys the live card had already had
  // stripped. The template comes from the builder too, already plan-gated:
  // passing the raw one captured a downgraded card as "custom" while the live
  // card rendered classic-pro.
  const { data: captureData, template: captureTemplate } = buildCardData(card, {
    appUrl: APP_URL,
    isPro,
    accountPhotoUrl: profile?.photo_url,
  });

  return (
    <main className="sc-app min-h-screen bg-gray-950 px-5 py-10">
      {/* Backstop: resolves a still-pending guest draft ONLY on an explicit
          post-auth claim return (?claim=1) — never on a bare edit visit, or a
          leftover guest draft would silently bleed into whatever card/account
          you opened. The real claim already happens on /cards/new?claim=1. */}
      {claim === "1" && <GuestDraftClaim />}
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          {joined ? (
            // Just joined: every way out of here leads to the tour.
            <Link href={`/dashboard?card=${encodeURIComponent(card.username as string)}&tour=1`} className="text-gray-500 hover:text-white text-sm transition-colors flex items-center gap-1.5">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
              </svg>
              Dashboard
            </Link>
          ) : (
            <DashboardLink card={card.username} className="text-gray-500 hover:text-white text-sm transition-colors flex items-center gap-1.5">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
              </svg>
              Dashboard
            </DashboardLink>
          )}
        </div>

        <div className="mb-6">
          <p className="text-[0.6875rem] font-bold tracking-[0.25em] text-gray-500 uppercase mb-1">SwiftCard</p>
          <h1 className="text-2xl font-bold text-white">Edit card</h1>
          {/* Arrived from accepting a team invite with a card already built:
              say what just happened and where to go next, instead of a bare
              editor (2026-09-16 website audit). */}
          {joined && (
            <div className="mt-3 rounded-xl border border-purple-500/25 bg-purple-500/[0.06] px-4 py-3">
              <p className="text-sm font-semibold text-purple-200">You&apos;ve joined your team</p>
              <p className="text-xs text-gray-400 mt-1 leading-relaxed">
                {brand?.logoUrl || brand?.company || brand?.template
                  ? "This card now carries your company's branding. Check your details and save — then take a quick tour of your dashboard."
                  : "This is now your company card — your organization manages the company details. Check your details and save — then take a quick tour of your dashboard."}
              </p>
              <Link href={`/dashboard?card=${encodeURIComponent(card.username as string)}&tour=1`} className="inline-block mt-2 text-xs font-semibold text-purple-300 hover:text-purple-200">Go to my dashboard →</Link>
            </div>
          )}
          <p className="text-gray-500 text-sm mt-1">/{card.username}</p>
        </div>

        <CardEditForm
          initialTab={initialTab}
          card={card}
          photoUrl={cardPhoto}
          logoUrl={card.logo_url ?? null}
          isPro={isPro}
          trialEligible={trialEligible}
          org={org}
          linkedinEnabled={!!(process.env.LINKEDIN_CLIENT_ID && process.env.LINKEDIN_CLIENT_SECRET)}
          tourAfterSave={joined}
        />
      </div>

      {/* Invisible: keeps the texted-link share preview a pixel-perfect copy
          of this card, re-capturing whenever its content changes. */}
      <ShareCardCapture
        cardData={captureData}
        template={captureTemplate}
        username={card.username as string}
      />
    </main>
  );
}
