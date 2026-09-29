import { profilePageJsonLd, jsonLdScript } from "@/lib/brand";
import { notFound, permanentRedirect } from "next/navigation";
import { cookies } from "next/headers";
import type { Metadata } from "next";
import { getCardPageData } from "@/lib/card-page-data";
import { shareImageUrl } from "@/lib/share-preview";
import { createClient } from "@/lib/supabase-server";
import SaveContactButton from "@/components/SaveContactButton";
import LeadCaptureForm from "@/components/LeadCaptureForm";
import CardEventTracker from "@/components/CardEventTracker";
import ScanSaveContact from "@/components/ScanSaveContact";
import ShareButton from "@/components/ShareButton";
import SocialLinkIntercept from "@/components/SocialLinkIntercept";
import CardActionLinks from "@/components/CardActionLinks";
import ClassicPro from "@/components/card-templates/ClassicPro";
import ModernBold from "@/components/card-templates/ModernBold";
import PhotoFirst from "@/components/card-templates/PhotoFirst";
import LocalBusiness from "@/components/card-templates/LocalBusiness";
import LuxuryMinimal from "@/components/card-templates/LuxuryMinimal";
import LogoFirst from "@/components/card-templates/LogoFirst";
import CustomCard from "@/components/card-templates/CustomCard";
import { withoutSocials } from "@/components/card-templates/types";
import type { CardData } from "@/components/card-templates/types";
import { resolveCardMeta } from "@/lib/resolve-card";
import CardScaler from "@/components/CardScaler";
import CardTilt from "@/components/CardTilt";
import { cardPageTheme } from "@/lib/card-page-theme";
import { isPaidPlan, sanitizeCustomizationForPlan } from "@/lib/plan";
import { buildCardData } from "@/lib/card-data";
import { buildConnectLinks } from "@/lib/social-url";
import SignupNudgeHost from "@/components/SignupNudgeHost";
import ReportCardLink from "@/components/ReportCardLink";
import { SwiftCardIcon } from "@/components/SwiftCardLogo";
import { PUBLIC_PAGE_META } from "@/lib/universal-links";

const TEMPLATES: Record<string, React.ComponentType<{ data: CardData }>> = {
  "classic-pro": ClassicPro,
  "modern-bold": ModernBold,
  "photo-first": PhotoFirst,
  "local-business": LocalBusiness,
  "luxury-minimal": LuxuryMinimal,
  "logo-first": LogoFirst,
  "custom": CustomCard,
};

// initials / the address join / the whole cardData literal used to live here.
// They are in @/lib/card-data now, shared with the signature and the dashboard,
// because three copies of the same derivation is how they came to disagree.


// The numbered 1-2-3-4 badges are gone (owner redesign 2026-08-19): they read
// as a form wizard, and the page now guides with hierarchy instead — the card
// as the hero object, then plain bold headings on ambient-tinted surfaces.
function SectionHeading({ children }: { children: React.ReactNode }) {
  return <p className="text-slate-900 font-bold text-[0.9375rem] tracking-tight">{children}</p>;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ username: string }>;
}): Promise<Metadata> {
  const { username: rawUsername } = await params;
  const username = rawUsername.toLowerCase();
  const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://swiftcard.me";

  const p = await resolveCardMeta(username);
  if (!p) return { title: "SwiftCard", itunes: null, other: { [PUBLIC_PAGE_META]: "card" } };

  const name = p.name ?? username;
  const parts = [p.title, p.company].filter(Boolean).join(" at ");
  const description = parts
    ? `Connect with ${name} — ${parts}. Save their contact instantly.`
    : `Connect with ${name} on SwiftCard. Save their contact instantly.`;

  // Explicit, content-versioned image URL (overrides the auto-injected static
  // one) so the unfurl updates whenever the card changes. Dimensions MUST match
  // the opengraph-image route's `size` (1200×686) so messengers reserve the
  // right box and never letterbox/crop the card.
  const ogImageUrl = shareImageUrl(APP_URL, username, p);

  return {
    title: `${name}${parts ? ` — ${parts}` : ""}`,
    description,
    // No iOS Smart App Banner on a received card: the promise to recipients is
    // "nothing to download", and the root layout's site-wide banner (live once
    // the App Store listing is) would sit right on top of someone's card.
    itunes: null,
    // The root URL is canonical; legacy /card/<username> 308s here.
    alternates: { canonical: `${APP_URL}/${username}` },
    // Marks a public card page for the iOS shell: NativeAppBridge sends it to
    // Safari if the app's webview ever lands here (links never open in the app).
    other: { [PUBLIC_PAGE_META]: "card" },
    openGraph: {
      title: name,
      description,
      url: `${APP_URL}/${username}`,
      siteName: "SwiftCard",
      type: "profile",
      images: [{ url: ogImageUrl, width: 1200, height: 686, alt: `${name}'s SwiftCard` }],
    },
    twitter: {
      card: "summary_large_image",
      title: name,
      description,
      images: [ogImageUrl],
    },
  };
}

export default async function CardPage({
  params,
  searchParams,
}: {
  params: Promise<{ username: string }>;
  searchParams: Promise<{ source?: string | string[]; embed?: string; shared?: string; save?: string }>;
}) {
  const { username: rawUsername } = await params;
  const username = rawUsername.toLowerCase();
  const { source: rawSource, embed, shared, save } = await searchParams;
  // A repeated query param (?source=a&source=b) arrives as an array — passing
  // that through used to reach the card_views insert as a non-text value and
  // fail the whole row. First value wins; bounded like the API's own cap.
  const sourceParam = Array.isArray(rawSource) ? rawSource[0] : rawSource;

  // Mixed-case URLs rendered as 200 duplicates of the lowercase page (the
  // canonical tag pointed the right way, but a 308 is definitive and
  // consolidates every signal onto one URL). Query params ride along —
  // ?source= drives real attribution and must survive the hop.
  if (rawUsername !== username) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries({ source: sourceParam, embed, shared, save })) {
      if (typeof v === "string" && v) qs.set(k, v);
    }
    const q = qs.toString();
    permanentRedirect(q ? `/${username}?${q}` : `/${username}`);
  }
  const source = (sourceParam ?? "direct_link").slice(0, 48);
  // ?save=1 — arrived by scanning the desktop QR. The card renders normally and
  // ScanSaveContact hands the phone the contact on top of it, so dismissing the
  // "Add to Contacts" sheet leaves them on the card instead of a blank page.
  const autoSave = save === "1";
  const isEmbed = embed === "1"; // rendered inside the /preview demo — skip tracking + nudge
  // ?shared=1 — this link was sent by the owner from one of their saved
  // contacts ("Share my contact information"), so the recipient's info is
  // already in the owner's hands: confirm that instead of asking them to fill
  // the share-back form again.
  const alreadyShared = shared === "1";

  // Cards table is the source of truth. Fall back to a legacy profile-card for any
  // account not yet migrated. Admin client so row-level security doesn't hide cards.
  // These four reads are the same ones this page always made — they are now
  // served from a per-slug cache (lib/card-page-data.ts) so a QR scan does not
  // cost a database round trip. Viewer-dependent work stays below, per request.
  const { cardRow, cardOwner, profileRow, withinLimit, awaitingPlan } = await getCardPageData(username);

  // Only treat a profile as a card if it's a legacy, not-yet-migrated card (so a
  // deleted/migrated card doesn't keep resolving from the account profile).
  const legacyCardOk =
    !!profileRow &&
    !((profileRow.customization as { _migrated?: boolean } | null)?._migrated) &&
    !!profileRow.name;

  // Hide cards whose owner account has been deleted.
  const ownerDeleted = cardRow
    ? !!((cardOwner?.customization as { _deleted?: boolean } | null)?._deleted)
    : !!((profileRow?.customization as { _deleted?: boolean } | null)?._deleted);

  const profile = cardRow
    ? { ...cardRow, plan: cardOwner?.plan ?? "free" }
    : (legacyCardOk ? profileRow : null);

  if (!profile || ownerDeleted) {
    // Old-format slug from before the 2026-08-26 rename? Send the visitor to
    // the card's current URL — printed QRs and old shares must keep working.
    const { findSlugAlias } = await import("@/lib/slug-alias");
    const alias = await findSlugAlias(username);
    if (alias) permanentRedirect(`/${alias}`);
    notFound();
  }

  // Office admin kill-switch: a card taken offline from /office/admin goes dark
  // (page, QR, links) while keeping its data, history and captured contacts —
  // so it can be brought back. Absent column (pre-migration) = still live.
  if (cardRow && cardRow.is_offline === true) notFound();

  // Plan-limit check and the owner-view auth lookup are independent (neither
  // depends on the other's result) — run them together instead of serially
  // (performance audit). A card that turns out to be over-limit still
  // 404s below; the getUser() call in that rare branch just goes unused.
  // Who is looking? Never cached — this is what suppresses a view when the
  // OWNER opens their own card, and a cached answer would attribute one
  // person's session to every visitor.
  const viewer = await (async () => {
    try {
      // Fast path for the overwhelming majority of card views: a visitor with
      // no Supabase auth cookie cannot be the owner, so there is nothing to
      // ask the auth server. This skips a network round trip on every scan of
      // every QR code; only a signed-in viewer pays for the check.
      const jar = await cookies();
      const signedIn = jar.getAll().some((c) => c.name.startsWith("sb-") && c.name.includes("auth-token"));
      if (!signedIn) return null;
      const { data: { user } } = await (await createClient()).auth.getUser();
      return user;
    } catch {
      // Cookie refresh may fail for public viewers — safe to ignore.
      return null;
    }
  })();

  // Plan kill-switch: a Free account only serves its first card(s) — extra
  // cards created on Pro go dark (page, QR, links) after a downgrade.
  if (cardRow && !withinLimit) notFound();

  // Don't count the owner viewing their own card as a view.
  const ownerId = cardRow ? (cardRow.user_id as string) : (profileRow?.id as string | undefined);
  const isOwnerView = !!viewer && viewer.id === ownerId;

  // Not live until its new owner has chosen a plan (lib/card-active rule 5).
  // The owner can still open it — it is their card, and /welcome links to it.
  if (cardRow && awaitingPlan && !isOwnerView) notFound();

  // Per-card headshot (account photo is only a fallback for legacy cards).
  const accountPhotoUrl = cardRow ? (cardOwner?.photo_url ?? null) : (legacyCardOk ? (profileRow?.photo_url ?? null) : null);

  const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://swiftcard.me";

  // Render-time plan enforcement: a downgraded Pro's card may still have Pro
  // design keys (accentColor/font) and >2 link buttons SAVED — the save-time
  // sanitizer only covers new writes. Sanitize here too so the PUBLIC card
  // always reflects the owner's CURRENT plan (Swift Links page already does).
  const customization = sanitizeCustomizationForPlan(
    (profile.customization ?? {}) as Record<string, unknown>,
    isPaidPlan(profile.plan),
    (profile.template as string) || "classic-pro"
  ) as {
    bio?: string;
    facebook?: string;
    snapchat?: string;
    youtube?: string;
    address?: { street?: string; unit?: string; city?: string; state?: string; zip?: string };
    accentColor?: string;
    font?: string;
    links?: { emoji: string; label: string; url: string }[];
    testimonials?: { name: string; text: string }[];
    phones?: { number: string; label: "mobile" | "office"; showOnCard: boolean }[];
    fax?: string;
  };
  const bio = customization.bio || "";
  const facebook = customization.facebook || "";
  const snapchat = customization.snapchat || "";
  const youtube = customization.youtube || "";
  // Array.isArray guards: a corrupted/crafted customization where links,
  // testimonials, or phones is a non-array would throw on .filter and 500 the
  // public card. Coerce to [] instead. (cards audit M4)
  const actionLinks = (Array.isArray(customization.links) ? customization.links : []).filter((l) => l && l.label && l.url);
  const testimonials = (Array.isArray(customization.testimonials) ? customization.testimonials : []).filter((t) => t && t.name && t.text);

  // Still needed for the saved-contact (vCard) block below, which wants the
  // address in PARTS rather than the joined lines the card renders. The joined
  // form now comes from buildCardData, so the two can't disagree about content.
  const addr = customization.address;

  // Built by the SHARED builder, so the Swift Signature, the dashboard preview
  // and the share images are the same object rather than four re-implementations
  // of it. This page is the reference every other surface has to match.
  const { data: cardData } = buildCardData(profile as Parameters<typeof buildCardData>[0], {
    appUrl: APP_URL,
    isPro: isPaidPlan(profile.plan),
    accountPhotoUrl,
  });

  const person = {
    name: profile.name,
    title: profile.title || "",
    company: profile.company || "",
    email: profile.email || "",
    phone: profile.phone || "",
    phones: (Array.isArray(customization.phones) ? customization.phones : []).filter((p) => p?.number?.trim()),
    fax: customization.fax || "",
    website: profile.website || "",
    address: {
      street: addr?.street || "",
      unit: addr?.unit || "",
      city: addr?.city || "",
      state: addr?.state || "",
      zip: addr?.zip || "",
    },
    linkedin: profile.linkedin || "",
    instagram: profile.instagram || "",
    twitter: profile.twitter || "",
    tiktok: profile.tiktok || "",
    // Embed the CORRECT owner's headshot in the saved contact (same per-card
    // resolution the card render uses — never another card's/user's photo).
    photoUrl: cardData.photoUrl,
    // …and the card's logo as the fallback picture when there is no headshot.
    logoUrl: cardData.logoUrl,
    // …and their Swift Links bio, saved into the contact's Notes.
    bio,
  };

  // The custom designer is Pro-only — a downgraded card falls back to the
  // standard template at render time (same rule the save path enforces).
  const rawTemplateId = (profile.template as string) || "classic-pro";
  const templateId = rawTemplateId === "custom" && !isPaidPlan(profile.plan) ? "classic-pro" : rawTemplateId;
  const TemplateComponent = TEMPLATES[templateId] ?? ClassicPro;
  const publicCardUrl = `${APP_URL}/${profile.username}`;
  const firstName = profile.name?.split(" ")[0] ?? "them";

  // Swift Links — socials in canonical order (Website first)
  const connectLinks = buildConnectLinks({
    website: profile.website,
    linkedin: profile.linkedin,
    instagram: profile.instagram,
    tiktok: profile.tiktok,
    facebook,
    twitter: profile.twitter,
    snapchat,
    youtube,
  });

  // Swift Links shows a bio, social links, and additional links
  const hasConnectSection = !!bio || connectLinks.length > 0 || actionLinks.length > 0;

  // Card-only mode (?embed=card): render just the card, used as the /preview inline preview.
  if (embed === "card") {
    return (
      <div id="sc-card-only" className="w-full overflow-hidden" style={{ background: "#FAF7F2" }}>
        <CardScaler>
          <TemplateComponent data={templateId === "custom" ? cardData : withoutSocials(cardData)} />
        </CardScaler>
      </div>
    );
  }

  // The page borrows the CARD's palette — its accent (or the template's
  // default) washes the top of the page and colors every action button via
  // the --sc-accent custom property those buttons read.
  const theme = cardPageTheme(customization.accentColor, templateId);

  return (
    <main
      className="min-h-screen flex flex-col items-center px-4 pt-10 pb-16 gap-5"
      style={{
        background: theme.pageBackground,
        ["--sc-accent" as string]: theme.accent,
        ["--sc-accent-text" as string]: theme.accentText,
      }}
    >
      {/* The page's one authored motion moment: the card SETTLES in — a small
          rise + scale resolving flat — and the rest of the page fades up once
          behind it. CSS-only (this is a server component), disabled wholesale
          for reduced-motion visitors. */}
      <style>{`
        @keyframes sc-card-settle { from { opacity: 0; transform: translateY(16px) scale(0.965); } to { opacity: 1; transform: none; } }
        @keyframes sc-page-rise { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
        .sc-card-settle { animation: sc-card-settle 620ms cubic-bezier(0.22, 1, 0.36, 1) both; }
        .sc-page-rise { animation: sc-page-rise 480ms cubic-bezier(0.22, 1, 0.36, 1) 180ms both; }
        @media (prefers-reduced-motion: reduce) { .sc-card-settle, .sc-page-rise { animation: none; } }
      `}</style>
      {/* Search + accessibility: this page is a person's profile, but the
          visible name is rendered inside the card ARTWORK (template-pinned
          pixels) — so the page's one H1 lives here, sr-only, without touching
          the design. The ProfilePage/Person node is what makes the page
          eligible for profile treatment in results. */}
      <h1 className="sr-only">
        {[profile.name, [profile.title, profile.company].filter(Boolean).join(" at ")].filter(Boolean).join(" — ")}
      </h1>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: jsonLdScript(
            profilePageJsonLd({
              name: profile.name || profile.username,
              title: profile.title || undefined,
              company: profile.company || undefined,
              image: cardData.photoUrl || undefined,
              url: publicCardUrl,
              sameAs: [profile.website, profile.linkedin, profile.instagram, profile.twitter, profile.tiktok],
            })
          ),
        }}
      />
      {!isEmbed && !isOwnerView && <CardEventTracker username={profile.username} source={source} />}
      {/* Scanned the desktop QR: deliver the contact over this page. */}
      {autoSave && !isEmbed && (
        <ScanSaveContact username={profile.username} source={source} suppressTracking={isOwnerView} />
      )}
      {!isEmbed && !isOwnerView && <SignupNudgeHost cardUsername={profile.username} />}

      {/* Business card — socials live in Swift Links, not on the card.
          The one-line "swipe down" hint that sat under it, and the tightened
          gap it needed, were removed (owner, 2026-09-24):
          the card and "Save …'s contact" are spaced by the page's gap-5 like
          every other section. */}
      <div className="w-full max-w-sm sc-card-settle">
        <CardTilt>
          <CardScaler>
            <TemplateComponent data={templateId === "custom" ? cardData : withoutSocials(cardData)} />
          </CardScaler>
        </CardTilt>
      </div>

      <div className="w-full max-w-sm flex flex-col gap-5 items-center sc-page-rise">

      {/* Address now lives inside the card design above (no separate section). */}

      {/* Testimonials */}
      {testimonials.length > 0 && (
        <div className="w-full max-w-sm rounded-2xl p-5 shadow-sm" style={{ background: "#fff", border: "1px solid #E4DDD4" }}>
          <p className="text-slate-500 text-xs font-semibold uppercase tracking-wider mb-4">What people say</p>
          <div className="flex flex-col gap-3">
            {testimonials.map((t, i) => (
              <div key={i} className="rounded-xl px-4 py-3" style={{ background: "#FAF7F2" }}>
                <p className="text-yellow-500 text-xs mb-1.5">★★★★★</p>
                <p className="text-slate-700 text-sm leading-relaxed">&ldquo;{t.text}&rdquo;</p>
                <p className="text-slate-400 text-xs mt-2 font-medium">— {t.name}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Save Contact — the page's primary action ── */}
      <div className="w-full max-w-sm rounded-2xl p-5 shadow-sm" style={{ background: "#fff", border: "1px solid #E4DDD4" }}>
        <SectionHeading>Save {firstName}&apos;s contact</SectionHeading>
        <p className="text-slate-500 text-xs mt-1 mb-4">One tap adds them to your phone contacts — no app needed.</p>
        <SaveContactButton
          person={person}
          username={profile.username}
          source={source}
          cardOwner={profile.username}
          ownerFirstName={firstName}
          suppressTracking={isOwnerView}
        />
        {/* No Add to Apple Wallet here — not even for the owner viewing their
            own live card (owner decision 2026-08-10: the card page is the
            visitor's save-contact surface). Wallet lives only in the owner's
            own sharing surfaces: the dashboard button and MoreShareOptions. */}
      </div>

      {/* ── Swift Links — the owner's bio, socials and action links ──
          Sits between Save contact and Share your info (owner order
          2026-09-22). It used to close the page; a visitor who has just
          saved the contact sees what else this person links to BEFORE
          being asked for their own details. */}
      {hasConnectSection && (
        <div className="w-full max-w-sm rounded-2xl p-5 shadow-sm" style={{ background: "#fff", border: "1px solid #E4DDD4" }}>
          <div className="flex items-center justify-between gap-3 mb-3">
            <SectionHeading>Swift Links</SectionHeading>
            {/* A warm ghost chip, not a footnote. "Go to Swift Links →" at
                text-slate-400 sat next to a heading that already says Swift
                Links — word noise at legal-disclaimer weight. Deliberately NOT
                blue-50: a cool tint fights the cream page. */}
            <a
              href={`/links/${profile.username}`}
              className="shrink-0 text-[0.6875rem] font-medium text-slate-500 rounded-full px-2.5 py-1 bg-[#FAF7F2] hover:bg-[#EDE7DE] hover:text-slate-700 transition-colors"
              style={{ boxShadow: "inset 0 0 0 1px #EFE9E1" }}
            >
              View Swift Link page →
            </a>
          </div>
          {bio && (
            <p className="text-slate-600 text-[0.8125rem] leading-[1.6] whitespace-pre-wrap [text-wrap:pretty]">{bio}</p>
          )}
          {bio && (connectLinks.length > 0 || actionLinks.length > 0) && (
            <div className="h-px bg-[#EFE9E1] my-4" />
          )}
          {/* Social links with intercept modal — unchanged mechanic, new layout. */}
          {connectLinks.length > 0 && (
            <SocialLinkIntercept
              links={connectLinks}
              cardOwner={profile.username}
              ownerFirstName={firstName}
              variant="rail"
              // Outbound-link tracking inherits the visit's own ?source=; the
              // owner looking at their own card (or the /preview frame) records
              // nothing, exactly like the view tracker above.
              trackSource={source}
              suppressTracking={isEmbed || isOwnerView}
            />
          )}
          {connectLinks.length > 0 && actionLinks.length > 0 && (
            <div className="h-px bg-[#EFE9E1] my-4" />
          )}
          {/* Custom action links: one hairline-ruled table, every row equal.
              Nothing here reads the card's accent — the section is deliberately
              free of saturated blocks. */}
          <CardActionLinks
            links={actionLinks}
            trackFor={profile.username}
            trackSource={source}
            suppressTracking={isEmbed || isOwnerView}
          />
        </div>
      )}

      {/* ── Share Your Info Back ── */}
      {alreadyShared ? (
        <div className="w-full max-w-sm rounded-2xl p-5 shadow-sm" style={{ background: "#fff", border: "1px solid #E4DDD4" }}>
          <div className="flex items-center gap-3">
            <span className="w-6 h-6 rounded-full flex items-center justify-center shrink-0" style={{ background: "#16a34a" }}>
              <svg viewBox="0 0 20 20" fill="#fff" className="w-3.5 h-3.5"><path fillRule="evenodd" d="M16.7 5.3a1 1 0 010 1.4l-7.5 7.5a1 1 0 01-1.4 0L3.3 9.7a1 1 0 011.4-1.4L8.5 12l6.8-6.7a1 1 0 011.4 0z" clipRule="evenodd" /></svg>
            </span>
            <SectionHeading>Your contact info has already been shared</SectionHeading>
          </div>
          <p className="text-slate-500 text-xs mt-1.5 ml-9">
            {firstName} already has your details — just save {firstName}&apos;s contact above and you&apos;re all set.
          </p>
        </div>
      ) : (
        <div className="w-full max-w-sm rounded-2xl p-5 shadow-sm" style={{ background: "#fff", border: "1px solid #E4DDD4" }}>
          <SectionHeading>Share your info with {firstName}</SectionHeading>
          <div className="mt-4">
            <LeadCaptureForm cardOwner={profile.username} source={source} />
          </div>
        </div>
      )}

      {/* ── Share This Card ── */}
      <div className="w-full max-w-sm rounded-2xl p-5 shadow-sm" style={{ background: "#fff", border: "1px solid #E4DDD4" }}>
        <ShareButton
          url={publicCardUrl}
          title={`${profile.name}'s digital card`}
          text={`Connect with ${firstName} — save their contact instantly.`}
          label="Share this card"
        />
        {/* "Show QR Code" removed (owner request). It asked the person already
            holding the card on their phone to display a QR for someone else to
            scan — a sharer's tool sitting in a viewer's flow. Sharing the link
            above covers the same job. The QRCodeModal component stays: the
            three marketing mockups still use it, and it is still the right
            control on the OWNER's dashboard. */}
        {/* Always-visible viewer CTA (owner request 2026-08-25): a full-size
            button matching "Share this card" directly beneath it, on EVERY
            card. Personalized with the owner's first name and dressed like
            the signup nudge's hero CTA — gradient, shine sweep, sparkle —
            because this is the page's one conversion ask and it should look
            like the product it sells. Straight into the builder. */}
        <a
          href={`${APP_URL}/cards/new?src=card_cta`}
          className="sc-getcard relative overflow-hidden mt-2 w-full flex items-center justify-center gap-2 font-bold py-3 px-6 rounded-full text-sm text-white transition-all hover:brightness-110 active:scale-[0.98]"
          style={{
            background: "linear-gradient(90deg, #1D4ED8 0%, #2563EB 55%, #0EA5E9 100%)",
            boxShadow: "0 8px 20px -6px rgba(29,78,216,0.45), inset 0 1px 0 rgba(255,255,255,0.25)",
          }}
        >
          <span className="sc-getcard-shine pointer-events-none absolute inset-0" aria-hidden="true" />
          {/* The real brand mark, ringed in white so it reads as the app icon
              on the gradient instead of dissolving into it. */}
          <span
            className="shrink-0 rounded-[5px] overflow-hidden"
            style={{ boxShadow: "0 0 0 1.5px rgba(255,255,255,0.9), 0 1px 3px rgba(15,23,42,0.35)" }}
            aria-hidden="true"
          >
            <SwiftCardIcon size={18} />
          </span>
          <span className="truncate">Create your free SwiftCard</span>
        </a>
        <style>{`
          @keyframes sc-getcard-shine {
            0%, 60% { transform: translateX(-130%) skewX(-18deg); }
            90%, 100% { transform: translateX(260%) skewX(-18deg); }
          }
          .sc-getcard-shine {
            background: linear-gradient(105deg, transparent 40%, rgba(255,255,255,0.35) 50%, transparent 60%);
            width: 55%;
            animation: sc-getcard-shine 3.6s ease-in-out infinite;
          }
          @media (prefers-reduced-motion: reduce) {
            .sc-getcard-shine { animation: none; }
          }
        `}</style>
      </div>
      </div>

      {/* The "Made with SwiftCard — Get yours free" blurb used to sit here, at
          the very bottom of the page. Owner request 2026-08-13: MOVED into the
          Save Contact section, where it appears under "Saved to Contacts!" the
          moment a visitor saves (see SaveContactButton → MadeWithSwiftCard).
          That is the conversion moment — they have just felt the product work —
          whereas here it was below the fold on most phones. The SwiftLinks
          footer attribution (SwiftLinkProfile) is a separate surface and is
          unchanged. */}

      {/* In-app only (App Review 1.2): report affordance for public cards.
          Renders null on web/SSR — the public page is unchanged. */}
      <ReportCardLink username={username} />
    </main>
  );
}
