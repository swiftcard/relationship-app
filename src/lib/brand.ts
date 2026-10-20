// Brand identity for search engines — one source of truth for the schema.org
// nodes we emit. Both the root layout (site-wide) and /company rendered their
// own near-identical Organization literal; they drifted (different description,
// neither carried alternateName or sameAs), and two conflicting Organization
// nodes for one domain is exactly what confuses Google's brand box.
//
// Only VERIFIABLE facts belong here. Inventing a profile URL or a rating is a
// structured-data violation and can cost the brand box entirely.

import { APP_STORE_LISTING_URL, PLAY_STORE_URL } from "@/lib/app-store";
import { PLAN_PRICES, TRIAL_DAYS } from "@/lib/plan";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://swiftcard.me";

// Official profiles that belong to Swift Card Inc, for schema.org `sameAs`.
// This is the field Google uses to tie scattered profiles to ONE entity, which
// is what makes a knowledge panel appear and what lets us claim it later — so
// every new official profile (LinkedIn, X, YouTube, G2, Capterra, Crunchbase)
// should be appended here the day it goes live.
//
// Only a profile that is live, carries the SwiftCard name and logo, and links
// back to swiftcard.me belongs here — one that does not is worse than none.
// The three below all do (checked 2026-10-14): the App Store and Google Play
// listings link to the developer website, and the Product Hunt page links to
// swiftcard.me throughout. The store URLs come from lib/app-store so they
// appear only in an environment where the listing is switched on, and vanish
// from the node (never an empty string) where it is not.
//
// `sameAs` is omitted entirely while the list is empty — `sameAs: []` is a
// claim that the brand has no profiles anywhere.
const PRODUCT_HUNT_URL = "https://www.producthunt.com/products/swiftcard";
export const BRAND_PROFILES: string[] = [APP_STORE_LISTING_URL, PLAY_STORE_URL, PRODUCT_HUNT_URL].filter(
  (u): u is string => typeof u === "string" && u.length > 0,
);

// "SwiftCard" is one word, but people type it as two, and the domain is a third
// spelling. Listing them lets Google resolve all three to the same entity
// instead of treating "Swift Card" as a different (or generic) query.
const ALTERNATE_NAMES = ["Swift Card", "swiftcard.me", "swift card app", "SwiftCard app"];

const DESCRIPTION =
  "SwiftCard is a digital business card that shares itself. Build your card once and share it by tap, QR code, Apple Wallet, or link, with built-in lead capture and automatic follow-up.";

export const ORGANIZATION_JSONLD = {
  "@context": "https://schema.org",
  "@type": "Organization",
  // A stable @id so every page's node is understood as the SAME organization
  // rather than one more company that happens to share a name.
  "@id": `${APP_URL}/#organization`,
  name: "SwiftCard",
  alternateName: ALTERNATE_NAMES,
  legalName: "Swift Card Inc.",
  url: APP_URL,
  logo: `${APP_URL}/brand-icon.png`,
  description: DESCRIPTION,
  email: "hello@swiftcard.me",
  foundingLocation: { "@type": "Place", address: { "@type": "PostalAddress", addressLocality: "New York", addressRegion: "NY", addressCountry: "US" } },
  contactPoint: { "@type": "ContactPoint", contactType: "customer support", email: "hello@swiftcard.me", url: `${APP_URL}/contact` },
  ...(BRAND_PROFILES.length ? { sameAs: BRAND_PROFILES } : {}),
};

// The WebSite node is what Google reads for the SITE NAME shown above the URL
// in results. Without it the name is guessed from the <title>, which is how a
// result ends up labelled with the whole tagline instead of "SwiftCard".
export const WEBSITE_JSONLD = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  "@id": `${APP_URL}/#website`,
  name: "SwiftCard",
  alternateName: ALTERNATE_NAMES,
  url: APP_URL,
  description: DESCRIPTION,
  publisher: { "@id": `${APP_URL}/#organization` },
};

// Serialize for a <script type="application/ld+json"> block. The `<` escape is
// what keeps this safe the day someone interpolates a card or company name into
// a node: inside <script>, the literal sequence "</script>" in ANY string value
// closes the tag early and everything after it parses as markup.
// The homepage's SoftwareApplication node — the product itself, distinct from
// the Organization that makes it. Only verifiable facts, each with its source
// of truth: prices and the trial length come from lib/plan (the same numbers
// /pricing renders and Stripe is checked against), the platforms from the
// store switches in lib/app-store (Android is claimed only where the Play
// listing is live), the feature list from what /pricing and the product pages
// actually say. NO aggregateRating — Google's review-snippet policy requires
// ratings collected on this site, so the App Store's stars cannot be reused
// here, and inventing or borrowing one is a structured-data violation that can
// cost every rich result on the domain. tests/landing-content.test.ts pins it.
const usd = (cents: number) => (cents / 100).toFixed(2);
const STORE_URLS = [APP_STORE_LISTING_URL, PLAY_STORE_URL].filter((u): u is string => !!u);
const OPERATING_SYSTEMS = ["iOS", PLAY_STORE_URL ? "Android" : null, "Web"].filter(Boolean).join(", ");

export const SOFTWARE_APPLICATION_JSONLD = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  "@id": `${APP_URL}/#software`,
  name: "SwiftCard",
  alternateName: ALTERNATE_NAMES,
  url: APP_URL,
  description: DESCRIPTION,
  applicationCategory: "BusinessApplication",
  applicationSubCategory: "Digital business card",
  operatingSystem: OPERATING_SYSTEMS,
  ...(STORE_URLS.length ? { installUrl: STORE_URLS } : {}),
  featureList: [
    "Share by QR code, NFC tap, link, Apple Wallet or Apple Watch",
    "Lead capture: the person you meet shares their contact back",
    "Automatic follow-up by email and text",
    "Swift Links link-in-bio page with view analytics",
    "Swift Signature live email signature",
    "AI card designer and paper business card scanner",
    "CRM sync: Salesforce, HubSpot, Pipedrive, GoHighLevel, Google Contacts, Zapier",
  ],
  offers: [
    {
      "@type": "Offer",
      name: "Free",
      price: "0",
      priceCurrency: "USD",
      url: `${APP_URL}/pricing`,
      description: "Free forever: one digital business card, Swift Links, Swift Signature and basic stats.",
    },
    {
      "@type": "Offer",
      name: "Pro",
      price: usd(PLAN_PRICES.PRO_MONTHLY_CENTS),
      priceCurrency: "USD",
      url: `${APP_URL}/pricing`,
      description: `Unlimited cards and contacts, text follow-ups, AI design and full analytics. ${TRIAL_DAYS}-day free trial.`,
      priceSpecification: {
        "@type": "UnitPriceSpecification",
        price: usd(PLAN_PRICES.PRO_MONTHLY_CENTS),
        priceCurrency: "USD",
        billingDuration: "P1M",
      },
    },
    {
      "@type": "Offer",
      name: "Office",
      price: usd(PLAN_PRICES.OFFICE_MONTHLY_PER_SEAT_CENTS),
      priceCurrency: "USD",
      url: `${APP_URL}/pricing`,
      description: "Per seat per month for teams and offices: one brand across everyone, shared templates and team analytics.",
      priceSpecification: {
        "@type": "UnitPriceSpecification",
        price: usd(PLAN_PRICES.OFFICE_MONTHLY_PER_SEAT_CENTS),
        priceCurrency: "USD",
        billingDuration: "P1M",
        unitText: "seat",
      },
    },
  ],
  publisher: { "@id": `${APP_URL}/#organization` },
};

// Person + ProfilePage nodes for a PUBLIC card or Swift Links page — the
// mainEntity Person is what makes these pages eligible for profile-style
// treatment in search. `sameAs` keeps only full http(s) URLs the owner put on
// their own card; handles and empty strings are dropped, nothing is invented.
export function profilePageJsonLd(p: {
  name: string;
  title?: string;
  company?: string;
  image?: string;
  url: string;
  sameAs?: (string | undefined | null)[];
}) {
  const sameAs = (p.sameAs ?? []).filter((u): u is string => !!u && /^https?:\/\//i.test(u));
  return {
    "@context": "https://schema.org",
    "@type": "ProfilePage",
    "@id": `${p.url}#profile`,
    url: p.url,
    mainEntity: {
      "@type": "Person",
      name: p.name,
      ...(p.title ? { jobTitle: p.title } : {}),
      ...(p.company ? { worksFor: { "@type": "Organization", name: p.company } } : {}),
      ...(p.image ? { image: p.image } : {}),
      url: p.url,
      ...(sameAs.length ? { sameAs } : {}),
    },
  };
}

export function jsonLdScript(node: unknown): string {
  return JSON.stringify(node).replace(/</g, "\\u003c");
}
