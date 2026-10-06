import { profilePageJsonLd, jsonLdScript } from "@/lib/brand";
import { notFound, permanentRedirect } from "next/navigation";
import { cookies } from "next/headers";
import { cache } from "react";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase-server";
import { buildConnectLinks } from "@/lib/social-url";
import { isPaidPlan, PLAN_LIMITS } from "@/lib/plan";
import { freeSafeLook } from "@/lib/swiftlink-looks";
import { cardIsOffline } from "@/lib/card-active";
import { getCardPageData } from "@/lib/card-page-data";
import { cardHeadshot } from "@/lib/card-media";
import CardEventTracker from "@/components/CardEventTracker";
import OfflineCardSaver from "@/components/OfflineCardSaver";
import SignupNudgeHost from "@/components/SignupNudgeHost";
import SwiftLinkProfile from "@/components/SwiftLinkProfile";
import ReportCardLink from "@/components/ReportCardLink";
import { safeCssValue, safeFontValue } from "@/lib/custom-layout";
import { resolveCardMeta } from "@/lib/resolve-card";
import { isUnlistedCardSlug } from "@/lib/seeded-views";
import { shareImageUrl } from "@/lib/share-preview";
import { PUBLIC_PAGE_META } from "@/lib/universal-links";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://swiftcard.me";

// cache() dedupes this across generateMetadata and the page body within the
// same request — both call resolve() with the same username, and without
// this each Swift Links view paid for the cards/profiles/plan-limit lookups
// twice (performance audit).
const resolve = cache(async (username: string) => {
  // ── Reads the SAME cached rows the card page reads (perf audit 2026-09-14) ──
  //
  // This used to issue its own three serial Supabase round trips — cards, then
  // profiles, then the plan-limit read — on every single Swift Links view,
  // while /[username] had already been moved behind lib/card-page-data.ts's
  // 60-second, tag-invalidated cache. The two pages render the same card from
  // the same rows, so one of them paying full price per view was an oversight,
  // not a design. Measured locally on identical builds: /demo-sales 25ms TTFB,
  // /links/demo-sales 265ms. In production the gap was 115ms vs 320-540ms.
  //
  // Freshness is IDENTICAL to the card page's, because it is literally the same
  // cache entry and the same tag: every path that edits a card, its owner's
  // profile or their plan already calls revalidateCardPage(), and the 60s TTL
  // is the same backstop for visibility changes (downgrade, office kill-switch,
  // deletion). Nothing viewer-dependent is cached here — the owner check below
  // stays per-request.
  const { cardRow, cardOwner, profileRow, withinLimit, awaitingPlan } = await getCardPageData(username);
  const legacyOk = !!profileRow && !((profileRow.customization as { _migrated?: boolean } | null)?._migrated) && !!profileRow.name;
  const ownerDeleted = cardRow
    ? !!((cardOwner?.customization as { _deleted?: boolean } | null)?._deleted)
    : !!((profileRow?.customization as { _deleted?: boolean } | null)?._deleted);
  // The CARD row whenever one exists — every rendered field (bio, socials,
  // links, styling) is per-card, so a user with several cards gets several
  // independent Swift Links pages. It falls back to the profile row ONLY for
  // legacy accounts that predate the cards table and never migrated. Named for
  // what it holds rather than "profile": reading account-level customization
  // here is what caused the headshot to bleed between cards once already.
  let cardOrLegacy = ownerDeleted ? null : (cardRow ?? (legacyOk ? profileRow : null));
  const ownerPlan = (cardRow ? cardOwner?.plan : profileRow?.plan) as string | null | undefined;
  // Office kill-switch: a card taken offline serves no Swift Links page either.
  if (cardIsOffline(cardRow)) cardOrLegacy = null;
  // Plan kill-switch: a Free account's extra (Pro-era) cards serve no Swift
  // Links page either — same rule as the card page, no bypass. `withinLimit` is
  // the card page's own answer to exactly this question, computed inside the
  // shared cache, so the two surfaces can no longer disagree about whether a
  // downgraded account's extra card still serves.
  if (cardOrLegacy && cardRow && !withinLimit) {
    cardOrLegacy = null;
  }
  // Per-card headshot: use the card's OWN headshot (customization.photoUrl) and
  // only fall back to the account photo for legacy cards that never set one —
  // so a new card with no headshot never shows another card's picture.
  const photoUrl = cardRow
    ? cardHeadshot(cardRow.customization, cardOwner?.photo_url)
    : (legacyOk ? (profileRow?.photo_url ?? null) : null);
  return { cardOrLegacy, photoUrl, ownerPlan, awaitingPlan: !!cardRow && awaitingPlan };
});

export async function generateMetadata({ params }: { params: Promise<{ username: string }> }): Promise<Metadata> {
  const { username: rawUsername } = await params;
  const username = rawUsername.toLowerCase();
  const { cardOrLegacy, awaitingPlan } = await resolve(username);
  if (!cardOrLegacy || awaitingPlan) return { title: "Swift Links", itunes: null, other: { [PUBLIC_PAGE_META]: "links" } };
  const name = cardOrLegacy.name || username;
  const description = `Connect with ${name} — all their links in one place.`;
  // The SAME content-versioned image URL the card page uses. The bare
  // /opengraph-image URL is edge-cached for a day, so a Links unfurl kept the
  // old card after an edit — or the previous owner's card after the address
  // changed hands (isolation audit 2026-09-24).
  const meta = await resolveCardMeta(username);
  const ogImage = meta ? shareImageUrl(APP_URL, username, meta) : `${APP_URL}/${username}/opengraph-image`;
  return {
    title: `${name} — Swift Links`,
    description,
    // Recipient surface — no Smart App Banner, same reasoning as the card page.
    itunes: null,
    // The lowercase /links URL is canonical — mixed case 308s there, and query
    // variants (?source=, ?embed=) must consolidate onto one indexed URL.
    alternates: { canonical: `${APP_URL}/links/${username}` },
    // Same unlisted set as the card page and sitemap.ts (lib/seeded-views).
    ...(isUnlistedCardSlug(username) ? { robots: { index: false, follow: false } } : {}),
    // Marks a public links page for the iOS shell: NativeAppBridge sends it to
    // Safari if the app's webview ever lands here (links never open in the app).
    other: { [PUBLIC_PAGE_META]: "links" },
    // Texted /links/ URLs unfurl with the same picture-of-the-card preview the
    // card link gets (iMessage/WhatsApp/SMS), reusing the card's OG image.
    openGraph: {
      title: `${name} — Swift Links`,
      description,
      url: `${APP_URL}/links/${username}`,
      siteName: "SwiftCard",
      images: [{ url: ogImage, width: 1200, height: 686 }],
    },
    twitter: { card: "summary_large_image", title: `${name} — Swift Links`, description },
  };
}

export default async function SwiftLinksPage({ params, searchParams }: { params: Promise<{ username: string }>; searchParams: Promise<{ embed?: string; source?: string | string[] }> }) {
  const { username: rawUsername } = await params;
  const username = rawUsername.toLowerCase();
  const { embed, source: rawSource } = await searchParams;

  // Mixed case 308s to the lowercase canonical, params preserved — ?source=
  // drives attribution and ?embed=1 is the /preview frame.
  if (rawUsername !== username) {
    const firstSource = Array.isArray(rawSource) ? rawSource[0] : rawSource;
    const qs = new URLSearchParams();
    if (typeof embed === "string" && embed) qs.set("embed", embed);
    if (typeof firstSource === "string" && firstSource) qs.set("source", firstSource);
    const q = qs.toString();
    permanentRedirect(q ? `/links/${username}?${q}` : `/links/${username}`);
  }
  const isEmbed = embed === "1"; // rendered inside the /preview demo — don't log a view or nudge
  // Real traffic-source attribution, like the card page: a QR/NFC tag pointing
  // at /links/<slug>?source=qr_code used to be flattened to "swift_links", so
  // a Swift Links scan could never appear in the scans metric. The surface is
  // carried separately (viewSurface="links"), so the source no longer has to
  // double as one.
  const sourceParam = Array.isArray(rawSource) ? rawSource[0] : rawSource;
  const source = (sourceParam ?? "swift_links").slice(0, 48);
  const { cardOrLegacy, photoUrl, ownerPlan, awaitingPlan } = await resolve(username);
  if (!cardOrLegacy) {
    const { findSlugAlias } = await import("@/lib/slug-alias");
    const alias = await findSlugAlias(username);
    if (alias) permanentRedirect(`/links/${alias}`);
    notFound();
  }

  // Don't count the owner viewing their own Swift Links page as a view.
  // getUser() refreshes the Supabase session cookie, which can throw for a
  // public viewer carrying a stale/invalid cookie — a public page must never
  // 500 on that (the card page guards this identically). Default to not-owner.
  const ownerId = (cardOrLegacy as { user_id?: string; id?: string }).user_id ?? (cardOrLegacy as { id?: string }).id;
  let viewer: { id: string } | null = null;
  try {
    // Fast path for the overwhelming majority of Swift Links opens: a visitor
    // with no Supabase auth cookie cannot be the owner, so there is nothing to
    // ask the auth server. getUser() is a NETWORK ROUND TRIP to Supabase, and
    // this page paid it on every single anonymous view — measured on
    // production it was the whole difference between this page and the card
    // page, which has had this guard for months: /demo-sales answered in
    // ~115ms while /links/demo-sales took 320-540ms, for the same data.
    const jar = await cookies();
    const signedIn = jar.getAll().some((c) => c.name.startsWith("sb-") && c.name.includes("auth-token"));
    if (signedIn) {
      ({ data: { user: viewer } } = await (await createClient()).auth.getUser());
    }
  } catch { /* public viewer with a bad cookie — treat as anonymous */ }
  const isOwnerView = !!viewer && viewer.id === ownerId;

  // Not live until its new owner has chosen a plan (lib/card-active rule 5);
  // the owner can still see it.
  if (awaitingPlan && !isOwnerView) notFound();

  const ownerPaid = isPaidPlan(ownerPlan);
  const customization = (cardOrLegacy.customization ?? {}) as {
    bio?: string;
    facebook?: string;
    snapchat?: string;
    youtube?: string;
    links?: { emoji: string; label: string; url: string; size?: "featured" | "grid" | "compact"; kind?: "link" | "header"; rowStyle?: "tile" | "solid" | "outline"; media?: { url: string; type: "image" | "video" }; glass?: boolean }[];
    // "Social design" — the page's named Look (every plan) + Pro fine-tuning.
    linkLook?: string;
    linkBgColor?: string;
    linkTextColor?: string;
    linkFontFamily?: string;
    linkIconShape?: string;
    linkIconFill?: string;
    /** Social-design toggle: true hides the "View SwiftCard →" link. */
    hideCardLink?: boolean;
    /** Page header layout (cover/banner/avatar/none) and what it shows
     *  (auto/photo/logo/initials). Structural, every plan — passed outside
     *  the paid spread below. */
    linkHeroStyle?: string;
    linkHeroContent?: string;
    /** Uploaded header photo for linkHeroContent "custom". Every plan. */
    linkHeroImage?: string;
    /** "video" when the uploaded header is a short video. Every plan. */
    linkHeroMediaType?: string;
    /** Link rows: "solid"/"outline" replace the rich tiles (Pro). */
    linkButtonStyle?: string;
    linkButtonColor?: string;
    linkBgMedia?: string;
    linkBgMediaType?: string;
    linkBgDim?: number;
    linkGlass?: boolean;
    linkAccentColor?: string;
  };
  // The named Look renders for EVERY plan — Free is snapped to the free pair
  // at render time (a Pro Look kept in storage after a downgrade is hidden,
  // never deleted, same philosophy as the links cap below). The custom
  // fine-tune keys stay paid-only, matching sanitizeCustomizationForPlan.
  const pageStyle = {
    look: ownerPaid ? customization.linkLook : freeSafeLook(customization.linkLook),
    // Every-plan structural keys, like the two hero keys below.
    heroImage: customization.linkHeroImage,
    heroMediaType: customization.linkHeroMediaType,
    heroStyle: customization.linkHeroStyle,
    heroContent: customization.linkHeroContent,
    ...(ownerPaid
      ? {
          // Owner-typed values that land in style objects: CSS-guarded
          // (lib/custom-layout safeCssValue) so they can only be a colour/font.
          bg: safeCssValue(customization.linkBgColor),
          text: safeCssValue(customization.linkTextColor),
          font: safeFontValue(customization.linkFontFamily),
          iconShape: customization.linkIconShape,
          iconFill: customization.linkIconFill,
          buttonStyle: customization.linkButtonStyle,
          buttonColor: safeCssValue(customization.linkButtonColor),
          // Page background media — Pro, behind every header style.
          bgMedia: customization.linkBgMedia,
          bgMediaType: customization.linkBgMediaType,
          bgDim: customization.linkBgDim,
          glass: customization.linkGlass,
          accent: safeCssValue(customization.linkAccentColor),
        }
      : {}),
  };
  const bio = customization.bio || "";
  // Free is capped at FREE_MAX_LINKS Swift Links buttons; paid plans get
  // unlimited. Trimmed here so the cap applies to existing accounts on view,
  // not only after their next save.
  // Array.isArray, not `?? []`: a corrupted/legacy customization where `links`
  // is an object or string would throw on .filter and 500 this PUBLIC page.
  // Same guard the card page already applies (cards audit M4).
  // Headers (kind:"header") are label-only rows — kept for paid owners, and
  // never counted against the Free links cap (they're organization, not
  // links; layoutTiles drops them from the Free rendering anyway).
  const allActionLinks = (Array.isArray(customization.links) ? customization.links : [])
    .filter((l) => (l.kind === "header" ? !!l.label : l.label && l.url));
  const actionLinks = ownerPaid
    ? allActionLinks
    : allActionLinks.filter((l) => l.kind !== "header").slice(0, PLAN_LIMITS.FREE_MAX_LINKS);

  const socials = buildConnectLinks({
    website: cardOrLegacy.website,
    linkedin: cardOrLegacy.linkedin,
    instagram: cardOrLegacy.instagram,
    tiktok: cardOrLegacy.tiktok,
    facebook: customization.facebook,
    twitter: cardOrLegacy.twitter,
    snapchat: customization.snapchat,
    youtube: customization.youtube,
  });

  const subtitle = [cardOrLegacy.title, cardOrLegacy.company].filter(Boolean).join("  ·  ");

  return (
    <>
      {/* Same profile treatment as the card page — this is the same person's
          public page in link-in-bio form. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: jsonLdScript(
            profilePageJsonLd({
              name: cardOrLegacy.name || username,
              title: cardOrLegacy.title || undefined,
              company: cardOrLegacy.company || undefined,
              url: `${APP_URL}/links/${username}`,
              sameAs: [
                cardOrLegacy.website, cardOrLegacy.linkedin, cardOrLegacy.instagram,
                cardOrLegacy.twitter, cardOrLegacy.tiktok, customization.facebook,
                customization.snapchat, customization.youtube,
              ],
            })
          ),
        }}
      />
      {/* The RESOLVED slug, not the raw route param — a case/alias divergence
          would otherwise record rows under a key the dashboard never reads. */}
      {!isEmbed && !isOwnerView && <CardEventTracker username={(cardOrLegacy.username as string) || username} source={source} viewSurface="links" />}
      {!isEmbed && !isOwnerView && <SignupNudgeHost cardUsername={(cardOrLegacy.username as string) || username} variant="links" />}
      {/* Keeps this page on the phone so it opens again with no signal (public/sw.js). */}
      {!isEmbed && <OfflineCardSaver name={`${cardOrLegacy.name || username} · Swift Links`} />}
      <SwiftLinkProfile
        name={cardOrLegacy.name || username}
        username={username}
        photoUrl={photoUrl}
        // Per-card logo, read off the SAME row the headshot comes from, so a
        // card with no headshot leads with its own logo and never another
        // card's (the bleed that cardHeadshot exists to prevent).
        logoUrl={(cardOrLegacy.logo_url as string | null) ?? null}
        subtitle={subtitle}
        bio={bio}
        verified={ownerPaid}
        paidTiles={ownerPaid}
        socials={socials.map((s) => ({ label: s.label, href: s.href, color: s.color, textColor: s.textColor }))}
        links={actionLinks}
        appUrl={APP_URL}
        pageStyle={pageStyle}
        // Outbound-link tracking: the RESOLVED slug (same value CardEventTracker
        // gets), this page's own ?source=, and nothing at all when the owner is
        // looking at their own page or this is the /preview frame.
        trackFor={(cardOrLegacy.username as string) || username}
        trackSource={source}
        suppressTracking={isEmbed || isOwnerView}
        // Owner's Social-design toggle; absent/false = shown (the default).
        showCardLink={customization.hideCardLink !== true}
        // "Made with swiftcard.me" footer is Free-only (owner order
        // 2026-09-02) — paid plans rely on the top-left bolt badge instead.
        brandingFooter={!ownerPaid}
      />
      {/* In-app only (App Review 1.2): report affordance for public Swift
          Links pages. Renders null on web/SSR — the public page is unchanged. */}
      <ReportCardLink username={username} />
    </>
  );
}
