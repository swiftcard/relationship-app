// ── Head-to-head comparison data: /compare/swiftcard-vs-<x> ─────────────────
//
// One typed file drives the five "SwiftCard vs X" pages, so a competitor's
// price is changed in ONE place. Every competitor fact here has a source row in
// docs/competitor-facts.md (official site, help centre, App Store or Google
// Play listing, checked on `lastVerified`). Rules the data follows:
//
//  - A competitor cell is "✓" or "✗" only when their official pages confirm it.
//    When they do not say, the cell is "Not listed" — never "✗".
//  - SwiftCard's own column is derived from lib/plan and lib/app-store, the same
//    sources /pricing and the FAQ render, so it cannot drift from the product.
//  - No ratings, user counts or awards are invented; the ones quoted in "where
//    they are stronger" come from the store listings in the facts file.
//
// The *-alternative pages (src/app/compare/[slug]/page.tsx) answer "X
// alternative" searches and keep their own copy; these pages answer "SwiftCard
// vs X" and link to them.

import { PLAY_STORE_URL } from "@/lib/app-store";
import { PLAN_LIMITS, PLAN_PRICES, TRIAL_DAYS } from "@/lib/plan";
import type { CompareRow } from "@/components/site/CompareTable";

const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`;
export const PRICE = {
  proMonthly: usd(PLAN_PRICES.PRO_MONTHLY_CENTS),
  proAnnual: usd(PLAN_PRICES.PRO_ANNUAL_CENTS),
  officeSeat: usd(PLAN_PRICES.OFFICE_MONTHLY_PER_SEAT_CENTS),
  officeMin: PLAN_LIMITS.OFFICE_MIN_SEATS,
  freeLeads: PLAN_LIMITS.FREE_LEADS_PER_MONTH,
  freeCards: PLAN_LIMITS.FREE_CARD_LIMIT,
  trialDays: TRIAL_DAYS,
} as const;

// Android is claimed only where the Play listing is switched on (lib/app-store),
// the same rule lib/brand.ts applies to the SoftwareApplication node.
export const SWIFTCARD_PLATFORMS = PLAY_STORE_URL ? "Web, iPhone, Android, Apple Watch" : "Web, iPhone, Apple Watch";

// The one-line definition used everywhere (owner, 2026-10-14).
export const ONE_LINER = "SwiftCard is a digital business card that captures leads, alerts you when contacts engage, and automates your follow-up.";

// ── The table rows ───────────────────────────────────────────────────────────
// `swiftcard` is fixed per feature; each competitor supplies its own `them`.
export type FeatureKey =
  | "freePlan" | "paidEntry" | "teamPrice" | "platforms" | "appleWatch" | "appleWallet" | "googleWallet"
  | "shareMethods" | "noAppRecipient" | "leadCapture" | "viewAnalytics" | "repeatViewAlerts"
  | "emailFollowUp" | "textFollowUp" | "aiDesigner" | "cardScanning" | "linkInBio" | "emailSignature"
  | "crm" | "teamAdmin";

const FEATURES: { key: FeatureKey; label: string; swiftcard: string; pricing?: true }[] = [
  { key: "freePlan", label: "Free plan", swiftcard: `✓ ${PRICE.freeCards} card, ${PRICE.freeLeads} new contacts/mo` },
  { key: "paidEntry", label: "Paid entry price", swiftcard: `${PRICE.proMonthly}/mo (Pro)`, pricing: true },
  { key: "teamPrice", label: "Team price", swiftcard: `${PRICE.officeSeat}/user/mo, min ${PRICE.officeMin}`, pricing: true },
  { key: "platforms", label: "Platforms", swiftcard: SWIFTCARD_PLATFORMS },
  { key: "appleWatch", label: "Apple Watch app", swiftcard: "✓" },
  { key: "appleWallet", label: "Apple Wallet", swiftcard: "✓" },
  { key: "googleWallet", label: "Google Wallet", swiftcard: "✗" },
  { key: "shareMethods", label: "NFC / QR / link", swiftcard: "✓ any writable NFC tag" },
  { key: "noAppRecipient", label: "Recipient needs no app", swiftcard: "✓" },
  { key: "leadCapture", label: "Lead capture (share-back form)", swiftcard: "✓ every plan" },
  { key: "viewAnalytics", label: "View analytics", swiftcard: "✓ cities on Pro" },
  { key: "repeatViewAlerts", label: "Repeat-view alerts", swiftcard: "✓" },
  { key: "emailFollowUp", label: "Automated email follow-up", swiftcard: "✓ every plan" },
  { key: "textFollowUp", label: "Automated text follow-up", swiftcard: "✓ Pro, US & Canada numbers" },
  { key: "aiDesigner", label: "AI card designer", swiftcard: "✓ Pro" },
  { key: "cardScanning", label: "Paper card scanning", swiftcard: "✓ Pro" },
  { key: "linkInBio", label: "Link-in-bio page", swiftcard: "✓ Swift Links" },
  { key: "emailSignature", label: "Email signature", swiftcard: "✓ Swift Signature" },
  { key: "crm", label: "CRM integrations", swiftcard: "✓ 6 + CSV, Pro" },
  { key: "teamAdmin", label: "Team admin", swiftcard: "✓ Office" },
];

export type VsCompetitor = {
  /** URL = /compare/swiftcard-vs-<slug>; sibling = /compare/<slug>-alternative */
  slug: "popl" | "blinq" | "linq" | "hihello" | "dot";
  name: string;
  /** Their site, named in the footer line. */
  site: string;
  /** ISO date the facts were last checked against their official pages. */
  lastVerified: string;
  /** H1 tail after "SwiftCard vs X: " */
  hook: string;
  metaTitle: string;
  metaDesc: string;
  /** 40–60 words, quotable on its own: who picks which, and the price gap. */
  tldr: string;
  them: Record<FeatureKey, string>;
  swiftcardStronger: { t: string; d: string }[];
  theyStronger: { t: string; d: string }[];
  pricing: string;
  bestFor: { swiftcard: string[]; them: string[] };
  switching: { t: string; d: string }[];
  faq: { q: string; a: string; pricing?: true }[];
  /** Two /for/<slug> pages and two /products/<slug> pages this page links. */
  forPages: { slug: string; label: string }[];
  productPages: { slug: string; label: string }[];
};

export function rowsFor(c: VsCompetitor): CompareRow[] {
  return FEATURES.map((f) => ({ label: f.label, swiftcard: f.swiftcard, them: c.them[f.key], ...(f.pricing ? { pricing: true as const } : {}) }));
}

export function monthYear(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

const NFC_FAQ = (name: string) => ({
  q: `Can I use my ${name} NFC card with SwiftCard?`,
  a: `Yes, if the tag is writable. An NFC card only stores a link, and SwiftCard writes your card link to any writable tag from Android Chrome or with a free NFC app on iPhone. Some branded cards ship locked to the maker's link; if yours is, a blank NFC tag costs a few dollars and does the same job.`,
});

const ANDROID_FAQ = {
  q: "Does SwiftCard work on Android?",
  a: PLAY_STORE_URL
    ? "Yes. SwiftCard has an Android app on Google Play, an iPhone app, an Apple Watch app and a web app, and the person you share with never needs an app: your card opens in their browser on any phone."
    : "Yes. SwiftCard works in any browser on Android, with an iPhone app, an Apple Watch app and a web app, and the person you share with never needs an app: your card opens in their browser on any phone.",
};

const SWITCH_STEPS = (name: string): { t: string; d: string }[] => [
  { t: `Export your ${name} contacts`, d: `Download your contacts from ${name} as a CSV before you cancel, so nothing you collected is left behind.` },
  { t: "Import them into SwiftCard", d: "Add the contacts to your SwiftCard list. Imported contacts are tagged with their source, so you always know where a lead came from." },
  { t: "Recreate your card", d: "Build the card at swiftcard.me/cards/new. On Pro, photograph your old card and the AI designer rebuilds the design with your details." },
  { t: "Re-point your tag and QR", d: "Write your new link to your NFC tag, replace the QR in your email signature and bios, and add the card to Apple Wallet." },
];

export const VS_COMPETITORS: VsCompetitor[] = [
  {
    slug: "popl",
    name: "Popl",
    site: "popl.co",
    lastVerified: "2026-10-14",
    hook: "which digital business card follows up for you?",
    metaTitle: "SwiftCard vs Popl (2026): Price, Features & Follow-Up",
    metaDesc: "SwiftCard vs Popl compared on price, platforms, lead capture, analytics and automated follow-up. Honest table, sources, and who each one is best for.",
    tldr: `Pick SwiftCard if you are one professional or a small team who wants the card to capture leads and send the follow-up for you, at ${PRICE.proMonthly} a month. Pick Popl if you run event lead capture for a sales team and want badge scanning, enrichment and a broad integration catalog. Popl Pro lists at $7.99 a month.`,
    them: {
      freePlan: "✓ limits not listed",
      paidEntry: "$7.99/mo (Pro)",
      teamPrice: "Not listed (quoted by sales)",
      platforms: "iPhone, Android, Mac, web",
      appleWatch: "✓",
      appleWallet: "✓",
      googleWallet: "Not listed",
      shareMethods: "✓ their NFC devices",
      noAppRecipient: "Not listed",
      leadCapture: "✓ event lead capture",
      viewAnalytics: "✓ reporting, detail not listed",
      repeatViewAlerts: "Not listed",
      emailFollowUp: "Not listed",
      textFollowUp: "Not listed",
      aiDesigner: "Not listed",
      cardScanning: "✓",
      linkInBio: "Not listed",
      emailSignature: "✓",
      crm: "✓ Salesforce, HubSpot, Marketo, 30+",
      teamAdmin: "✓",
    },
    swiftcardStronger: [
      { t: "The follow-up loop is built in", d: "A view triggers an alert, a share-back lands in your contacts, and the email or text follow-up you switched on goes out on schedule. Popl's public pages describe lead capture, enrichment and CRM sync; automated email or text follow-up is not listed." },
      { t: "Lower, published pricing", d: `SwiftCard Pro is ${PRICE.proMonthly} a month with every feature in it, and Office is ${PRICE.officeSeat} per user with a ${PRICE.officeMin}-seat minimum. Popl Pro lists at $7.99 a month and team pricing is quoted in a sales meeting rather than published.` },
      { t: "No hardware to buy", d: "SwiftCard writes your link to any writable NFC tag, and QR, link, Apple Wallet and Apple Watch need nothing at all. Popl sells its own NFC devices." },
      { t: "Repeat-view alerts and city-level views", d: "SwiftCard tells you when a contact you already know opens your card again, and Pro shows which cities your views come from. Popl's pages list reporting and attribution without that per-view detail." },
      { t: "A link-in-bio page and a live signature on every plan", d: "Swift Links and Swift Signature are included free. A link-in-bio page is not listed on Popl's pages." },
    ],
    theyStronger: [
      { t: "Event lead capture at scale", d: "Popl's product is built around conferences: an AI badge scanner, qualifying questions, event campaigns, enrichment and attribution reporting. SwiftCard does not do badge scanning." },
      { t: "A bigger review base and a longer track record", d: "Popl's iPhone app shows 4.8 stars from about 103,000 ratings and its Android app 500,000+ downloads. SwiftCard is a newer, smaller product." },
      { t: "Integration catalog", d: "Popl lists Salesforce, HubSpot, Marketo and 30+ integrations. SwiftCard connects six CRMs plus Zapier and CSV export." },
    ],
    pricing: `As of October 2026, SwiftCard is free for ${PRICE.freeCards} card and ${PRICE.freeLeads} new contacts a month; Pro is ${PRICE.proMonthly} a month or ${PRICE.proAnnual} a year, with a ${PRICE.trialDays}-day free trial; Office is ${PRICE.officeSeat} per user a month with a ${PRICE.officeMin}-user minimum. Popl has a free tier whose limits are not published, Popl Pro is $7.99 a month ($76.99 a year) and Pro Plus is $14.99 a month on the App Store; team pricing is not published. Both offer annual discounts.`,
    bestFor: {
      swiftcard: ["Solo professionals and small teams", "Anyone who wants follow-up sent automatically by email or text", "People who do not want to buy NFC hardware", "Budgets under $5 a month"],
      them: ["Sales and marketing teams working trade shows", "Companies that need badge scanning and enrichment", "Teams already on Marketo or a large integration stack"],
    },
    switching: SWITCH_STEPS("Popl"),
    faq: [
      { q: "Is SwiftCard cheaper than Popl?", a: `Yes. SwiftCard Pro is ${PRICE.proMonthly} a month and Popl Pro is $7.99 a month on the App Store, as of October 2026. Both have a free tier. Popl's team pricing is not published, while SwiftCard Office is ${PRICE.officeSeat} per user with a ${PRICE.officeMin}-seat minimum.`, pricing: true },
      NFC_FAQ("Popl"),
      { q: "Does Popl send automated follow-ups?", a: "Popl's official pages do not list automated email or text follow-up; they describe lead capture, enrichment and CRM sync. SwiftCard sends email follow-ups on every plan and text follow-ups on Pro, written by AI if you like." },
      ANDROID_FAQ,
      { q: "Does SwiftCard do event badge scanning like Popl?", a: "No. SwiftCard scans paper business cards into contacts on Pro, but it does not scan conference badges. If badge scanning is central to your events, Popl is built for that." },
      { q: "Do the people I meet need the Popl or SwiftCard app?", a: "With SwiftCard, no: your card opens in their browser, they save your contact in one tap and can share theirs back. Popl's pages do not state whether a recipient needs an app." },
    ],
    forPages: [{ slug: "real-estate-agents", label: "Real estate agents" }, { slug: "insurance-agents", label: "Insurance agents" }],
    productPages: [{ slug: "lead-capture", label: "Lead capture" }, { slug: "integrations", label: "CRM integrations" }],
  },
  {
    slug: "blinq",
    name: "Blinq",
    site: "blinq.me",
    lastVerified: "2026-10-14",
    hook: "cheaper Pro, or two free cards?",
    metaTitle: "SwiftCard vs Blinq (2026): Price, Features & Follow-Up",
    metaDesc: "SwiftCard vs Blinq compared on price, free plans, Apple Watch, wallets, lead capture and automated follow-up. Honest table with sources and who each suits.",
    tldr: `Pick SwiftCard if you want lead capture and automated email and text follow-up on one ${PRICE.proMonthly}-a-month plan. Pick Blinq if you want two free cards, Google Wallet, or a large-company rollout with SSO. Blinq Premium is $9.99 a month, or $7.33 a month billed annually.`,
    them: {
      freePlan: "✓ 2 cards",
      paidEntry: "$9.99/mo (Premium)",
      teamPrice: "$6.99/user/mo, min 5",
      platforms: "iPhone, Android, Mac, web",
      appleWatch: "✓",
      appleWallet: "✓",
      googleWallet: "✓",
      shareMethods: "✓ their NFC cards",
      noAppRecipient: "Not listed",
      leadCapture: "✓ Business plan",
      viewAnalytics: "Not listed",
      repeatViewAlerts: "Not listed",
      emailFollowUp: "Not listed",
      textFollowUp: "Not listed",
      aiDesigner: "Not listed",
      cardScanning: "✓ Premium",
      linkInBio: "Not listed",
      emailSignature: "✓",
      crm: "✓ HubSpot, Salesforce, Dynamics (Business)",
      teamAdmin: "✓",
    },
    swiftcardStronger: [
      { t: "Follow-up runs itself", d: "When someone views your card you get an alert; when they share their details, the email or text follow-up you switched on goes out on schedule. Blinq's pricing page and homepage do not list automated follow-up." },
      { t: "Half the price for the paid plan", d: `SwiftCard Pro is ${PRICE.proMonthly} a month. Blinq Premium is $9.99 a month, or $7.33 a month billed annually.` },
      { t: "Lead capture on every plan, with no per-lead fee", d: `SwiftCard's share-back form works on Free (${PRICE.freeLeads} new contacts a month) and is unlimited on Pro. Blinq lists lead capture and enrichment on its Business plan at $9.99 per lead captured and enriched.` },
      { t: "Repeat-view alerts and a link-in-bio page", d: "SwiftCard tells you when a known contact opens your card again, and every card comes with a Swift Links page. Neither is listed on Blinq's pages." },
    ],
    theyStronger: [
      { t: "Two free cards and Google Wallet", d: "Blinq's free plan includes two cards and both Apple and Google Wallet. SwiftCard's free plan has one card and no Google Wallet pass yet." },
      { t: "Enterprise rollout", d: "Blinq lists an admin platform, template locking, Microsoft Entra provisioning, enforced SSO and SCIM, and a SOC 2 Type II audit. SwiftCard Office has an admin dashboard and design lock but no SSO or SCIM." },
      { t: "Track record and AI extras", d: "Blinq's iPhone app shows 4.9 stars from about 132,000 ratings, and its paid plans add an AI notetaker and contact enrichment from 25+ sources." },
    ],
    pricing: `As of October 2026, SwiftCard is free for ${PRICE.freeCards} card and ${PRICE.freeLeads} new contacts a month; Pro is ${PRICE.proMonthly} a month or ${PRICE.proAnnual} a year, with a ${PRICE.trialDays}-day free trial; Office is ${PRICE.officeSeat} per user a month with a ${PRICE.officeMin}-user minimum. Blinq is free for two cards; Premium is $9.99 a month or $7.33 a month billed annually; Business is $6.99 per user a month, or $4.99 billed annually, with a five-user minimum, plus $9.99 per lead captured and enriched.`,
    bestFor: {
      swiftcard: ["Solo professionals who want follow-up handled", "Small teams of two or more", "People who want lead capture without a per-lead fee", "iPhone and Apple Watch users"],
      them: ["People who need more than one free card", "Android users who want a Google Wallet pass", "Companies rolling out hundreds of cards with SSO"],
    },
    switching: SWITCH_STEPS("Blinq"),
    faq: [
      { q: "Is SwiftCard cheaper than Blinq?", a: `Yes for the paid plan. SwiftCard Pro is ${PRICE.proMonthly} a month; Blinq Premium is $9.99 a month, or $7.33 a month billed annually, as of October 2026. Blinq's free plan is more generous with two cards against SwiftCard's one.`, pricing: true },
      NFC_FAQ("Blinq"),
      { q: "Does Blinq have automated follow-up?", a: "Blinq's official pages do not list automated email or text follow-up. SwiftCard sends email follow-ups on every plan and text follow-ups on Pro, with AI writing the message for each contact if you want." },
      ANDROID_FAQ,
      { q: "Does SwiftCard have Google Wallet?", a: "No, not yet. SwiftCard has an Apple Wallet pass and an Apple Watch app. On Android, share by QR, link or NFC tag, and the Android app shows your QR code. Blinq lists both Apple and Google Wallet on its free plan." },
      { q: "Which is better for a team?", a: `For a team of two to a few dozen, SwiftCard Office is ${PRICE.officeSeat} per user a month with a ${PRICE.officeMin}-seat minimum, brand lock and shared contacts. For a large company that needs SSO and SCIM, Blinq's Business and Enterprise plans list those controls.`, pricing: true },
    ],
    forPages: [{ slug: "real-estate-agents", label: "Real estate agents" }, { slug: "loan-officers", label: "Loan officers" }],
    productPages: [{ slug: "teams", label: "Teams and offices" }, { slug: "wallet", label: "Apple Wallet" }],
  },
  {
    slug: "linq",
    name: "Linq",
    site: "linqapp.com",
    lastVerified: "2026-10-14",
    hook: "simple card and follow-up, or a mobile CRM?",
    metaTitle: "SwiftCard vs Linq (2026): Price, Features & Follow-Up",
    metaDesc: "SwiftCard vs Linq compared on price, hardware, Apple Wallet, lead capture and automated follow-up. Honest table with sources and who each one suits.",
    tldr: `Pick SwiftCard if you want a free card that needs no hardware and sends follow-up for you, at ${PRICE.proMonthly} a month for Pro. Pick Linq if you want a mobile-first CRM with branded cards and bundles. Linq Pro is $6.99 a month on the App Store, and Linq One is $29 a month.`,
    them: {
      freePlan: "✓ limits not listed",
      paidEntry: "$6.99/mo (Pro, App Store)",
      teamPrice: "Not listed",
      platforms: "iPhone, iPad, Android, Mac",
      appleWatch: "Not listed",
      appleWallet: "✓",
      googleWallet: "Not listed",
      shareMethods: "✓ their NFC cards",
      noAppRecipient: "Not listed",
      leadCapture: "✓",
      viewAnalytics: "Not listed",
      repeatViewAlerts: "Not listed",
      emailFollowUp: "Not listed (lead reminders)",
      textFollowUp: "Not listed",
      aiDesigner: "Not listed",
      cardScanning: "Not listed",
      linkInBio: "Not listed",
      emailSignature: "Not listed",
      crm: "✓ Salesforce, HubSpot",
      teamAdmin: "✓ in Linq One",
    },
    swiftcardStronger: [
      { t: "Published, lower pricing", d: `SwiftCard's prices are on its pricing page: Pro ${PRICE.proMonthly} a month, Office ${PRICE.officeSeat} per user. Linq's website does not publish pricing; its App Store listing shows Pro at $6.99 a month and Linq One at $29 a month.` },
      { t: "Automated follow-up, not reminders", d: "Linq lists reminders for leads. SwiftCard sends the follow-up itself: email on every plan, text on Pro, with an alert when the contact opens your card again." },
      { t: "Apple Watch app and no hardware required", d: "SwiftCard has an Apple Watch app and writes to any writable NFC tag. Linq's App Store compatibility does not list Apple Watch, and its cards are sold separately from $34.99." },
      { t: "AI designer, card scanner and a link-in-bio page", d: "Pro rebuilds any card from a photo and scans paper cards into contacts, and every plan gets Swift Links and Swift Signature. None of these are listed on Linq's pages." },
    ],
    theyStronger: [
      { t: "A mobile-first CRM", d: "Linq positions itself as a CRM you run from your phone, with Linq One folding its Pro, Pro Plus and team tiers into one plan. If you want pipeline management inside the card app, that is Linq's focus." },
      { t: "Hardware line and bundles", d: "Linq sells custom cards, tags and networking bundles with next-day delivery for subscribers. SwiftCard sells no hardware." },
      { t: "Longer track record", d: "Linq's iPhone app shows 4.9 stars from about 12,000 ratings and its Android app 100,000+ downloads. SwiftCard is newer and smaller." },
    ],
    pricing: `As of October 2026, SwiftCard is free for ${PRICE.freeCards} card and ${PRICE.freeLeads} new contacts a month; Pro is ${PRICE.proMonthly} a month or ${PRICE.proAnnual} a year, with a ${PRICE.trialDays}-day free trial; Office is ${PRICE.officeSeat} per user a month with a ${PRICE.officeMin}-user minimum. Linq does not publish prices on its website; its App Store listing shows Linq Pro at $6.99 a month or $49.99 a year, Pro Plus at $19 a month and Linq One at $29 a month or $249 a year. A free Linq profile exists; its limits are not listed.`,
    bestFor: {
      swiftcard: ["Solo professionals who want one clear price", "People who do not want to buy a card", "Anyone who wants follow-up sent automatically", "Apple Watch users"],
      them: ["Salespeople who want a CRM in the card app", "Teams buying branded cards in bulk", "Buyers who prefer a sales conversation to a pricing page"],
    },
    switching: SWITCH_STEPS("Linq"),
    faq: [
      { q: "Is SwiftCard cheaper than Linq?", a: `Yes. SwiftCard Pro is ${PRICE.proMonthly} a month; Linq Pro is $6.99 a month and Linq One is $29 a month on the App Store, as of October 2026. Linq's website does not publish prices, so check their app listing for current figures.`, pricing: true },
      NFC_FAQ("Linq"),
      { q: "Does Linq send automated follow-ups?", a: "Linq's App Store listing describes reminders for important leads; automated email or text follow-up is not listed. SwiftCard sends email follow-ups on every plan and text follow-ups on Pro." },
      ANDROID_FAQ,
      { q: "Does Linq have an Apple Watch app?", a: "Linq's App Store compatibility list does not include Apple Watch. SwiftCard's Apple Watch app shows a scannable QR code on your wrist." },
      { q: "Does SwiftCard have a CRM like Linq?", a: "SwiftCard has a built-in contacts list with notes, tags, history and follow-up status, and it sends new contacts to Salesforce, HubSpot, GoHighLevel, Pipedrive, Google Contacts or Zapier on Pro. It is not a full pipeline CRM; Linq is built as one." },
    ],
    forPages: [{ slug: "car-salespeople", label: "Car salespeople" }, { slug: "contractors", label: "Contractors" }],
    productPages: [{ slug: "watch", label: "Apple Watch" }, { slug: "lead-capture", label: "Lead capture" }],
  },
  {
    slug: "hihello",
    name: "HiHello",
    site: "hihello.com",
    lastVerified: "2026-10-14",
    hook: "automated follow-up, or four free cards?",
    metaTitle: "SwiftCard vs HiHello (2026): Price, Features & Follow-Up",
    metaDesc: "SwiftCard vs HiHello compared on price, free plans, card scanning, analytics and automated follow-up. Honest table with sources and who each one suits.",
    tldr: `Pick SwiftCard if you want lead capture, repeat-view alerts and automated email and text follow-up for ${PRICE.proMonthly} a month. Pick HiHello if you want four free cards, free card scanning, or a large-company rollout with SSO. HiHello Professional is $6 a month on its website.`,
    them: {
      freePlan: "✓ 4 cards, 5 scans/mo",
      paidEntry: "$6/mo (Professional)",
      teamPrice: "$5/user/mo, 5–100 users",
      platforms: "iPhone, iPad, Android, web",
      appleWatch: "✓",
      appleWallet: "✓",
      googleWallet: "✓",
      shareMethods: "✓ NFC, QR, link",
      noAppRecipient: "Not listed",
      leadCapture: "✓ event lead capture (Business)",
      viewAnalytics: "✓ Professional",
      repeatViewAlerts: "Not listed",
      emailFollowUp: "Not listed",
      textFollowUp: "Not listed",
      aiDesigner: "Not listed",
      cardScanning: "✓ 5/mo free",
      linkInBio: "Not listed",
      emailSignature: "✓",
      crm: "✓ Salesforce, HubSpot, Dynamics (Business)",
      teamAdmin: "✓",
    },
    swiftcardStronger: [
      { t: "The follow-up loop", d: "SwiftCard alerts you when a contact opens your card, captures their details through a share-back form on every plan, and sends your email or text follow-up on schedule. HiHello's pages list contact management and event lead capture; automated follow-up is not listed." },
      { t: "Lower paid and team prices", d: `SwiftCard Pro is ${PRICE.proMonthly} a month and Office is ${PRICE.officeSeat} per user with a ${PRICE.officeMin}-seat minimum. HiHello Professional is $6 a month and Business is $5 per user with a five-user minimum.` },
      { t: "Repeat-view alerts and city-level views", d: "SwiftCard tells you when someone you already know comes back to your card, and Pro shows which cities views come from. HiHello lists views, saves and contacts; repeat-view alerts are not listed." },
      { t: "AI card designer and a link-in-bio page", d: "Pro rebuilds any card from a photo, and every plan includes a Swift Links page. Neither is listed on HiHello's pages." },
    ],
    theyStronger: [
      { t: "A more generous free plan", d: "HiHello's free plan has four cards and five card or badge scans a month, with Apple and Google Wallet. SwiftCard's free plan has one card, no Google Wallet, and card scanning is Pro-only." },
      { t: "Enterprise controls", d: "HiHello lists SSO and directory sync, HRIS integration, brand governance and, on Enterprise, SAML SSO and SCIM. SwiftCard Office has an admin dashboard and design lock but no SSO." },
      { t: "Track record", d: "HiHello's iPhone app shows 4.9 stars from about 45,000 ratings and its site says it serves 400,000+ companies. SwiftCard is newer and smaller." },
    ],
    pricing: `As of October 2026, SwiftCard is free for ${PRICE.freeCards} card and ${PRICE.freeLeads} new contacts a month; Pro is ${PRICE.proMonthly} a month or ${PRICE.proAnnual} a year, with a ${PRICE.trialDays}-day free trial; Office is ${PRICE.officeSeat} per user a month with a ${PRICE.officeMin}-user minimum. HiHello Personal is free with four cards; Professional is $6 a month on the website ($72 a year) and $9 a month on the App Store; Business is $5 per user a month ($60 a year) for 5 to 100 users; Enterprise is custom.`,
    bestFor: {
      swiftcard: ["Solo professionals who want follow-up sent for them", "Teams of two to a few dozen", "People who want to know when a lead comes back", "Anyone who wants an AI-designed card"],
      them: ["People who need several free cards", "Heavy paper-card scanners on a budget", "Large companies that need SSO and directory sync"],
    },
    switching: SWITCH_STEPS("HiHello"),
    faq: [
      { q: "Is SwiftCard cheaper than HiHello?", a: `Yes for paid plans. SwiftCard Pro is ${PRICE.proMonthly} a month; HiHello Professional is $6 a month on its website, as of October 2026. For teams, SwiftCard Office is ${PRICE.officeSeat} per user with a ${PRICE.officeMin}-seat minimum; HiHello Business is $5 per user with a five-user minimum. HiHello's free plan includes more cards.`, pricing: true },
      NFC_FAQ("HiHello"),
      { q: "Does HiHello send automated follow-ups?", a: "HiHello's official pages do not list automated email or text follow-up. SwiftCard sends email follow-ups on every plan and text follow-ups on Pro, written by AI for each contact if you like." },
      ANDROID_FAQ,
      { q: "Can SwiftCard scan paper business cards like HiHello?", a: "Yes, on Pro. SwiftCard's scanner turns a photo of a paper card into a contact. HiHello includes five scans a month on its free plan and 20 on Professional, so if you scan a lot and want it free, HiHello is the stronger choice." },
      { q: "Does SwiftCard have an email signature like HiHello?", a: "Yes. Swift Signature turns your card into an email signature for Gmail, Outlook and Apple Mail on every plan. HiHello includes a personal signature on its free plan too." },
    ],
    forPages: [{ slug: "lawyers", label: "Lawyers" }, { slug: "photographers", label: "Photographers" }],
    productPages: [{ slug: "email-signatures", label: "Swift Signature" }, { slug: "analytics", label: "Analytics" }],
  },
  {
    slug: "dot",
    name: "Dot",
    site: "dot.cards",
    lastVerified: "2026-10-14",
    hook: "free software, or a one-time device?",
    metaTitle: "SwiftCard vs Dot Card (2026): Price, Features & Follow-Up",
    metaDesc: "SwiftCard vs Dot (dot.cards) compared on price, hardware, Apple Wallet, lead capture, analytics and automated follow-up. Honest table with sources.",
    tldr: `Pick SwiftCard if you want to start free with no device, get lead capture and automated email and text follow-up, and pay ${PRICE.proMonthly} a month for Pro. Pick Dot if you want a well-made tap device with a profile that stays free. Dot's Profile+ subscription is $15 a month, or $12 a month billed annually.`,
    them: {
      freePlan: "✓ with a device",
      paidEntry: "$15/mo (Profile+)",
      teamPrice: "Not listed",
      platforms: "iPhone, iPad, Mac; Android not listed",
      appleWatch: "Not listed",
      appleWallet: "✓",
      googleWallet: "Not listed",
      shareMethods: "✓ their devices, QR",
      noAppRecipient: "Not listed",
      leadCapture: "✓",
      viewAnalytics: "✓ scan counts",
      repeatViewAlerts: "Not listed",
      emailFollowUp: "Not listed",
      textFollowUp: "Not listed",
      aiDesigner: "Not listed",
      cardScanning: "Not listed",
      linkInBio: "Not listed",
      emailSignature: "Not listed",
      crm: "Lead export listed",
      teamAdmin: "✓ dot.Teams, details not listed",
    },
    swiftcardStronger: [
      { t: "Nothing to buy first", d: "Create the card, share it by QR, link, Apple Wallet or Apple Watch, and add NFC later with any writable tag. Dot is a device-first product: you buy a dot.card, dot.thin or similar and the profile comes with it." },
      { t: "Follow-up is built in", d: "SwiftCard sends email follow-ups on every plan and text follow-ups on Pro, and alerts you when a contact comes back. Dot's pages list lead capture and lead export; automated follow-up is not listed." },
      { t: "A much cheaper subscription", d: `SwiftCard Pro is ${PRICE.proMonthly} a month. Dot's Profile+ is $15 a month, or $12 a month billed annually.` },
      { t: "Apple Watch, AI designer, scanner, links page and signature", d: "SwiftCard has an Apple Watch app, an AI card designer and paper card scanner on Pro, and Swift Links and Swift Signature on every plan. None of these are listed on Dot's pages." },
    ],
    theyStronger: [
      { t: "A free profile for the life of the device", d: "Dot's core features stay available without a subscription once you own a device. SwiftCard's free plan is capped at one card and a monthly contact limit." },
      { t: "Hardware design", d: "Dot's whole product is the device: cards, thin cards and other form factors you tap. If you want a physical object with a brand on it, Dot sells one and SwiftCard does not." },
      { t: "Simplicity", d: "A tap, a profile, done. If you do not want lead forms, alerts and follow-up sequences, Dot has less to set up." },
    ],
    pricing: `As of October 2026, SwiftCard is free for ${PRICE.freeCards} card and ${PRICE.freeLeads} new contacts a month; Pro is ${PRICE.proMonthly} a month or ${PRICE.proAnnual} a year, with a ${PRICE.trialDays}-day free trial; Office is ${PRICE.officeSeat} per user a month with a ${PRICE.officeMin}-user minimum. Dot's profile is free with a device; dot.Profile+ is $15 a month billed monthly or $12 a month billed annually ($144 a year), with a trial. Dot's device prices and dot.Teams pricing could not be read from its official pages, so check dot.cards for current figures.`,
    bestFor: {
      swiftcard: ["People who want to start today with no purchase", "Anyone who wants follow-up sent automatically", "Apple Watch and Apple Wallet users", "Small teams who want shared contacts and brand lock"],
      them: ["People who want a physical tap card as the product", "Anyone who never wants a subscription", "Users who want the simplest possible profile"],
    },
    switching: SWITCH_STEPS("Dot"),
    faq: [
      { q: "Is SwiftCard cheaper than Dot?", a: `For the subscription, yes: SwiftCard Pro is ${PRICE.proMonthly} a month and Dot's Profile+ is $15 a month, or $12 a month billed annually, as of October 2026. Dot's basic profile is free once you buy a device; SwiftCard's free plan needs no purchase at all.`, pricing: true },
      NFC_FAQ("Dot"),
      { q: "Does Dot send automated follow-ups?", a: "Dot's official pages do not list automated email or text follow-up; they describe lead capture, scan counts and lead export. SwiftCard sends email follow-ups on every plan and text follow-ups on Pro." },
      ANDROID_FAQ,
      { q: "Do I need to buy anything to use SwiftCard?", a: "No. The card, QR and link sharing, Apple Wallet, Swift Links and Swift Signature are free with no device. NFC is optional and works with any writable tag, which costs a few dollars." },
      { q: "Does Dot have an Apple Watch app?", a: "Dot's App Store compatibility list does not include Apple Watch. SwiftCard's Apple Watch app shows a scannable QR code on your wrist, and its Apple Wallet pass works without signal." },
    ],
    forPages: [{ slug: "barbers-and-stylists", label: "Barbers and stylists" }, { slug: "contractors", label: "Contractors" }],
    productPages: [{ slug: "wallet", label: "Apple Wallet" }, { slug: "digital-cards", label: "Digital cards" }],
  },
];

export const VS_SLUGS = VS_COMPETITORS.map((c) => `swiftcard-vs-${c.slug}`);

export function vsCompetitorForSlug(slug: string): VsCompetitor | null {
  const m = slug.match(/^swiftcard-vs-([a-z]+)$/);
  return (m && VS_COMPETITORS.find((c) => c.slug === m[1])) || null;
}
