import type { Metadata } from "next";
import Link from "next/link";
import Eyebrow from "@/components/site/Eyebrow";
import SiteNav from "@/components/site/SiteNav";
import SiteFooterMini from "@/components/site/SiteFooterMini";
import ScrollProgress from "@/components/ScrollProgress";
import ScrollReveal from "@/components/ScrollReveal";
import NativeHidden from "@/components/NativeHidden";
import HomeHeadingReveal from "@/components/site/HomeHeadingReveal";
import { integrationNames } from "@/components/site/integration-brands";
import { PLAY_STORE_URL } from "@/lib/app-store";
import { PLAN_LIMITS, PLAN_PRICES, TRIAL_DAYS } from "@/lib/plan";
import { breadcrumbJsonLd, faqPageJsonLd, jsonLdScript, SOFTWARE_ID } from "@/lib/brand";
import { ONE_LINER, VS_COMPETITORS } from "@/lib/compare/competitors";
import "@/app/home.css";

// ── /faq: every question people ask before they sign up, as real headings ───
//
// SEO audit 2026-10-14: search engines and AI assistants lift answers from
// pages whose questions ARE the headings. So: one H2 per group, one H3 per
// question with its own anchor (/faq#android), the answer in plain paragraphs
// in the server HTML — no accordions, nothing loaded on click.
//
// Honesty rules: every answer states a shipped feature. Prices, limits and the
// trial length come from lib/plan (the same numbers /pricing renders), the
// Android answer flips with the Google Play switch in lib/app-store, and the
// CRM list comes from the integration registry — so nothing here can drift
// from the product. Pricing answers ride inside NativeHidden (App Review
// 3.1.1: the iOS shell must not show our pricing). The same array feeds the
// FAQPage JSON-LD, one source: the answer text and the link label are the
// words on the page, the JSON-LD only adds the <a> markup Google accepts.

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://swiftcard.me";
const SRC = "faq_page"; // registered SIGNUP_SOURCE — keeps this page's conversions separable
const LAST_UPDATED = "2026-10-14";

const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const PRO_MONTHLY = usd(PLAN_PRICES.PRO_MONTHLY_CENTS);
const PRO_ANNUAL = usd(PLAN_PRICES.PRO_ANNUAL_CENTS);
const OFFICE_SEAT = usd(PLAN_PRICES.OFFICE_MONTHLY_PER_SEAT_CENTS);
const OFFICE_ANNUAL_SEAT = usd(PLAN_PRICES.OFFICE_ANNUAL_PER_SEAT_CENTS);
const ANNUAL_OFF = Math.round((1 - PLAN_PRICES.PRO_ANNUAL_CENTS / (PLAN_PRICES.PRO_MONTHLY_CENTS * 12)) * 100);

const TITLE = "SwiftCard FAQ: Digital Business Card Questions Answered";
const DESC = "Straight answers about SwiftCard: Android and iPhone, Apple Wallet, NFC, lead capture, automatic follow-up, pricing, teams, privacy and how it compares.";

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESC,
  alternates: { canonical: `${APP_URL}/faq` },
  openGraph: { title: TITLE, description: DESC, url: `${APP_URL}/faq`, siteName: "SwiftCard", type: "website" },
  twitter: { card: "summary_large_image", title: TITLE, description: DESC },
};

type FaqLink = { href: string; label: string };
type Faq = { id: string; q: string; a: string; links: FaqLink[]; pricing?: true };
type Group = { id: string; label: string; items: Faq[] };

const ANDROID_A = PLAY_STORE_URL
  ? "Yes. SwiftCard has an Android app on Google Play, an iPhone app on the App Store, and a web app that works in any browser. The person you share with never needs an app on any phone: your card opens in their browser and they save your contact in one tap."
  : "Yes. SwiftCard works in any browser on Android, so you can build, edit and share your card from an Android phone. The iPhone app is on the App Store. The person you share with never needs an app on any phone: your card opens in their browser and they save your contact in one tap.";

const GROUPS: Group[] = [
  {
    id: "getting-started",
    label: "Getting started",
    items: [
      {
        id: "what-is-swiftcard",
        q: "What is SwiftCard?",
        a: `${ONE_LINER} You build one card, share it by QR code, link, NFC tap, Apple Wallet or Apple Watch, and the person you meet saves your contact in one tap and can share theirs back. Every new contact lands in your built-in contacts list, and SwiftCard can send the follow-up email and text for you.`,
        links: [{ href: "/products/digital-cards", label: "See how the card works" }],
      },
      {
        id: "is-swiftcard-free",
        q: "Is SwiftCard free?",
        a: `Yes. The free plan has no time limit and includes ${PLAN_LIMITS.FREE_CARD_LIMIT} digital business card, all the card designs, QR, link and NFC sharing, Apple Wallet, a Swift Links page with ${PLAN_LIMITS.FREE_MAX_LINKS} extra links, the Swift Signature email signature, a contacts list with notes, automatic follow-up emails and basic stats. Free saves up to ${PLAN_LIMITS.FREE_LEADS_PER_MONTH} new contacts a month; Pro removes the limits.`,
        links: [{ href: "/pricing", label: "Compare Free, Pro and Office" }],
        pricing: true,
      },
      {
        id: "need-app",
        q: "Do the people I share my card with need the app?",
        a: "No. Your card opens in their phone's browser, on iPhone or Android, with no install. They tap Save Contact and you are in their phone. If they fill in the share-back form, their name, phone and email land in your contacts.",
        links: [{ href: "/products/lead-capture", label: "How the share-back form works" }],
      },
      {
        id: "how-to-share",
        q: "How do I share my SwiftCard?",
        a: "Seven ways: show the QR code on your phone or Apple Watch, tap an NFC tag to their phone, send the link by text, email or social media, add the card to Apple Wallet so it is one swipe from the lock screen, or put it in your email signature with Swift Signature. Every share carries its source, so you can see later which one brought the contact.",
        links: [{ href: "/products/wallet", label: "Apple Wallet and every way to share" }],
      },
      {
        id: "more-than-one-card",
        q: "Can I have more than one card?",
        a: `Yes, on Pro and Office. The free plan includes ${PLAN_LIMITS.FREE_CARD_LIMIT} card; Pro has unlimited cards, each with its own link, design, Swift Links page, contacts and stats, so you can keep one per job or business.`,
        links: [{ href: "/pricing", label: "See what Pro includes" }],
        pricing: true,
      },
    ],
  },
  {
    id: "devices",
    label: "Devices and compatibility",
    items: [
      { id: "android", q: "Does SwiftCard work on Android?", a: ANDROID_A, links: [{ href: "/download", label: "Get the app" }] },
      {
        id: "iphone",
        q: "Does SwiftCard work on iPhone?",
        a: "Yes. The SwiftCard iPhone app is on the App Store, with Apple Wallet, Apple Watch and push notifications when someone views your card or shares their details. Everything also works in Safari without the app.",
        links: [{ href: "/download", label: "Get the iPhone app" }],
      },
      {
        id: "apple-watch",
        q: "Is there an Apple Watch app?",
        a: "Yes. The SwiftCard Apple Watch app shows a scannable QR code for your card on your wrist, so you can share without taking your phone out. Your Apple Wallet pass also appears on a paired Watch.",
        links: [{ href: "/products/watch", label: "SwiftCard on Apple Watch" }],
      },
      {
        id: "apple-wallet",
        q: "Can I add my card to Apple Wallet or Google Wallet?",
        a: "Apple Wallet, yes: every card has an Add to Apple Wallet pass with your QR code, and it works with no signal. Google Wallet is not supported yet; on Android, share from the app or the web with your QR code, link or an NFC tag.",
        links: [{ href: "/products/wallet", label: "How the Wallet pass works" }],
      },
      {
        id: "nfc-card",
        q: "Do I need to buy an NFC card?",
        a: "No. QR, link and Apple Wallet need nothing extra. If you want tap-to-share, SwiftCard writes your card link to any writable NFC tag or card, which costs a few dollars online: from Android Chrome directly, or on iPhone with a free NFC app. SwiftCard does not sell hardware, and a tag from another brand works too if it is not locked.",
        links: [{ href: "/products/digital-cards", label: "NFC, QR and link sharing" }],
      },
      {
        id: "offline",
        q: "Does SwiftCard work without internet?",
        a: "Partly. Your Apple Wallet pass and its QR code work with no signal, so you can always be scanned. Opening the card page on the other person's phone needs a connection, as does saving the contact and the share-back form.",
        links: [{ href: "/products/wallet", label: "Apple Wallet pass" }],
      },
    ],
  },
  {
    id: "leads",
    label: "Leads and follow-up",
    items: [
      {
        id: "lead-capture",
        q: "How does SwiftCard capture leads?",
        a: `Every card has a share-back form under your details. When someone fills it in, they land in your contacts with the time and the source of the share, and you get a notification the moment it happens. The free plan saves ${PLAN_LIMITS.FREE_LEADS_PER_MONTH} new contacts a month; extra contacts are kept and unlocked when you upgrade. Pro is unlimited.`,
        links: [{ href: "/products/lead-capture", label: "Lead capture in detail" }],
      },
      {
        id: "who-viewed",
        q: "Can I see who viewed my card?",
        a: "You see every view, and you see who it was when they have shared their details or saved your contact before. Each view records the time and how the card was opened: QR, NFC, link, Apple Wallet, Swift Links or your signature. Pro adds the city each view came from and the full history. Views by crawlers and bots are filtered out.",
        links: [{ href: "/products/analytics", label: "What the analytics show" }],
      },
      {
        id: "repeat-views",
        q: "Will I get notified when someone views my card again?",
        a: "Yes. When a contact you already know opens your card again, SwiftCard sends a separate alert, because a second look is the moment to follow up. Repeat opens within the same half hour count once, so one person does not trigger a stream of notifications.",
        links: [{ href: "/products/analytics", label: "Repeat-view alerts" }],
      },
      {
        id: "follow-ups",
        q: "How do automatic follow-ups work? Can they go by text?",
        a: "Switch follow-up on for a contact and SwiftCard sends the email for you on schedule, on every plan. On Pro, follow-ups also go by text message to US and Canadian numbers, AI writes the message for each contact, and replies come back to you. Texts go only to people who agreed to hear from you, from a registered sender, and STOP always works.",
        links: [{ href: "/products/lead-capture", label: "Follow-up by email and text" }],
      },
      {
        id: "scan-paper-cards",
        q: "Can SwiftCard scan paper business cards?",
        a: "Yes, on Pro. Photograph a paper business card and the scanner reads it into a contact with the name, title, company, phone and email filled in, tagged as scanned so you know where it came from.",
        links: [{ href: "/pricing", label: "Scanner is included in Pro" }],
        pricing: true,
      },
      {
        id: "crm",
        q: "Which CRMs does SwiftCard integrate with?",
        a: `New contacts can flow automatically into ${integrationNames()}. Connect them once in Settings, under Notifications and preferences, in the section called Send contacts to your CRM. Integrations are a Pro and Office feature.`,
        links: [{ href: "/products/integrations", label: "CRM integrations" }],
        pricing: true,
      },
      {
        id: "export-contacts",
        q: "Can I export my contacts?",
        a: "Yes. Pro and Office accounts can download every contact as a CSV spreadsheet from the contacts page, and Office admins can export the whole team's contacts in one file. Your contacts are yours.",
        links: [{ href: "/products/integrations", label: "CSV export and CRM sync" }],
        pricing: true,
      },
    ],
  },
  {
    id: "design",
    label: "Design",
    items: [
      {
        id: "ai-design",
        q: "Can I design my card with AI?",
        a: "Yes, on Pro. Give the AI card designer your headshot, logo and colours and a style, or a photo or screenshot of a card you already have or like, and it rebuilds that design with your details as an editable card.",
        links: [{ href: "/templates", label: "Try the AI Card Designer" }],
      },
      {
        id: "own-colors",
        q: "Can I use my own colors, logo and a photo or video background?",
        a: "Your photo and logo go on every plan, and every plan can pick from each template's curated colour sets. Pro unlocks any colour, extra fonts, premium finishes and a photo or video background behind the card, plus every Swift Links look.",
        links: [{ href: "/templates", label: "See the card designs" }],
      },
      {
        id: "swift-links",
        q: "What is Swift Links?",
        a: "Swift Links is the link-in-bio page that comes with every card: your photo, bio, social icons and link tiles at swiftcard.me/links/your-name. It counts every visit with its source and has a Connect button so visitors can save your contact and share theirs back. It is included on the free plan.",
        links: [{ href: "/products/swiftlinks", label: "Swift Links" }],
      },
      {
        id: "swift-signature",
        q: "What is Swift Signature?",
        a: "Swift Signature turns your card into an email signature for Gmail, Outlook and Apple Mail: a live image of your card that links to your card page, so every email you send can capture a contact. It is on every plan.",
        links: [{ href: "/products/email-signatures", label: "Swift Signature" }],
      },
    ],
  },
  {
    id: "pricing",
    label: "Pricing and billing",
    items: [
      {
        id: "cost",
        q: "How much does SwiftCard cost?",
        a: `Free is $0 for ${PLAN_LIMITS.FREE_CARD_LIMIT} card and ${PLAN_LIMITS.FREE_LEADS_PER_MONTH} new contacts a month. Pro is ${PRO_MONTHLY} a month or ${PRO_ANNUAL} a year. Office is ${OFFICE_SEAT} per user a month with a ${PLAN_LIMITS.OFFICE_MIN_SEATS}-user minimum, or ${OFFICE_ANNUAL_SEAT} per user a year. Subscriptions bought on iPhone are billed through Apple at the same prices.`,
        links: [{ href: "/pricing", label: "Full pricing" }],
        pricing: true,
      },
      {
        id: "free-trial",
        q: "Is there a free trial of Pro?",
        a: `Yes. When you choose Pro you get ${TRIAL_DAYS} days free before the first charge. A card is required at checkout, you are emailed before the trial ends, and cancelling before then means you are never charged. The trial is for first-time subscribers; free accounts stay free with no trial clock.`,
        links: [{ href: "/pricing", label: "Start the Pro trial" }],
        pricing: true,
      },
      {
        id: "cancel",
        q: "Can I cancel anytime?",
        a: "Yes. There are no contracts. On the web, go to Settings, then Plan and billing, then Manage subscription and payment, and choose Switch to Free. If you subscribed on iPhone, cancel in your Apple subscriptions. You keep Pro until the end of the period you paid for, and nothing is deleted.",
        links: [{ href: "/pricing", label: "Plans and billing" }],
        pricing: true,
      },
      {
        id: "annual-discount",
        q: "Is there a discount for annual billing?",
        a: `Yes, ${ANNUAL_OFF}% off. Pro is ${PRO_ANNUAL} a year instead of ${PRO_MONTHLY} a month, and Office is ${OFFICE_ANNUAL_SEAT} per user a year instead of ${OFFICE_SEAT} a month.`,
        links: [{ href: "/pricing", label: "Monthly and annual prices" }],
        pricing: true,
      },
      {
        id: "downgrade",
        q: "What happens to my card if I downgrade or cancel?",
        a: `Your card stays live at the same link. Pro-only design choices move to the closest free equivalent, and anything over the free limits, such as extra cards or links past ${PLAN_LIMITS.FREE_MAX_LINKS}, is hidden rather than deleted, so it comes back the moment you subscribe again. Contacts are never removed.`,
        links: [{ href: "/pricing", label: "What Free includes" }],
        pricing: true,
      },
    ],
  },
  {
    id: "teams",
    label: "Teams",
    items: [
      {
        id: "teams-offices",
        q: "Does SwiftCard work for teams and offices?",
        a: `Yes. SwiftCard Office gives every teammate a card on your brand with their own contacts, under one admin dashboard that shows views, contacts and last activity per person. It costs ${OFFICE_SEAT} per user a month with a ${PLAN_LIMITS.OFFICE_MIN_SEATS}-user minimum and no maximum, and you can add or remove seats at any time.`,
        links: [{ href: "/products/teams", label: "SwiftCard Office" }],
        pricing: true,
      },
      {
        id: "lock-design",
        q: "Can I lock the card design for my whole team?",
        a: "Yes. Set your logo, company details and card design once and every teammate's card uses them. Turn on the design lock and members can edit their own details but not the template, colours or company block, so every card stays on brand.",
        links: [{ href: "/products/teams", label: "Brand controls for teams" }],
      },
      {
        id: "teammate-leaves",
        q: "What happens to contacts when a teammate leaves?",
        a: "They stay with the office. When an admin removes a member, every contact that member collected remains in the team's shared list and export, and the seat is freed for the next person.",
        links: [{ href: "/products/teams", label: "Team contacts" }],
      },
    ],
  },
  {
    id: "privacy",
    label: "Privacy and account",
    items: [
      {
        id: "viewer-data",
        q: "What data does SwiftCard collect about people who view my card?",
        a: "A view is anonymous unless the viewer chooses to share their details. SwiftCard records the time, how the card was opened (QR, NFC, link, Wallet, signature or Swift Links) and an approximate city worked out from the network address, which only Pro accounts see. No name, phone or email is captured until the viewer types it into the share-back form or saves your contact.",
        links: [{ href: "/privacy", label: "Privacy policy" }],
      },
      {
        id: "data-sold",
        q: "Is my data sold?",
        a: "No. SwiftCard's privacy policy states that it never sells your personal information, or your contacts' information, to anyone, and does not share it for cross-context behavioural advertising. Your contact list is yours.",
        links: [{ href: "/privacy", label: "Read the privacy policy" }],
      },
      {
        id: "delete-account",
        q: "How do I delete my account?",
        a: "From Settings, choose Delete account. Your account closes immediately and you have 30 days to sign back in and reopen it with everything intact; after that it is permanently deleted along with your cards and contacts. Office members are removed by their admin instead, which frees the seat.",
        links: [{ href: "/privacy", label: "Data retention" }],
      },
      {
        id: "outside-us",
        q: "Is SwiftCard available outside the US?",
        a: "Yes. The web app, the iPhone app and the Android app work anywhere, cards open in any country, and prices are in US dollars. The one US-specific feature is text follow-up, which sends only to US and Canadian numbers; email follow-up works everywhere.",
        links: [{ href: "/download", label: "Get the app" }],
      },
    ],
  },
  {
    id: "comparisons",
    label: "Comparisons",
    items: [
      {
        id: "vs-competitors",
        q: "How is SwiftCard different from Popl, Blinq, Linq, HiHello and Dot?",
        a: `SwiftCard is built around what happens after the tap: a share-back form on every plan, an alert when a contact comes back, and automated email and text follow-up, at ${PRO_MONTHLY} a month for Pro with no hardware to buy. Popl and Blinq lean toward event lead capture and enterprise rollouts, Linq toward a mobile CRM, HiHello toward a generous free plan and card scanning, and Dot toward a physical tap device. Each head-to-head page shows where the other product is stronger too.`,
        links: VS_COMPETITORS.map((c) => ({ href: `/compare/swiftcard-vs-${c.slug}`, label: `SwiftCard vs ${c.name}` })),
        pricing: true,
      },
    ],
  },
];

const ALL: Faq[] = GROUPS.flatMap((g) => g.items);

// The JSON-LD answer is the visible answer plus the visible link(s), with the
// <a> markup schema.org allows inside an Answer — same words, same order.
const answerHtml = (f: Faq) =>
  `<p>${f.a}</p><p>${f.links.map((l) => `<a href="${APP_URL}${l.href}">${l.label}</a>`).join(" · ")}</p>`;

const chip = "text-[0.8125rem] text-slate-600 hover:text-slate-900 hover:border-slate-300 rounded-full px-3.5 py-1.5 bg-white border border-slate-200 transition-colors";

export default function FaqPage() {
  const faqJsonLd = { ...faqPageJsonLd(ALL.map((f) => ({ q: f.q, a: answerHtml(f) }))), about: { "@id": SOFTWARE_ID } };
  const crumbs = breadcrumbJsonLd([{ name: "Home", path: "" }, { name: "FAQ", path: "/faq" }]);
  const updated = new Date(`${LAST_UPDATED}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
  return (
    <main className="hp sc-canvas-white min-h-screen bg-cream flex flex-col">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(faqJsonLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(crumbs) }} />
      <ScrollProgress />
      <ScrollReveal />
      <HomeHeadingReveal />
      <SiteNav />

      <section className="hp-page-hero text-center px-5 sm:px-6 pt-28 sm:pt-36 pb-10">
        <div className="relative" data-hp-head>
          <div className="mb-4"><Eyebrow dark={false}>FAQ</Eyebrow></div>
          <h1 className="rd-display text-[clamp(2.1rem,4.4vw,3rem)] text-slate-900 mb-4 max-w-2xl mx-auto [text-wrap:balance]">SwiftCard FAQ: digital business card questions answered</h1>
          <p className="hp-lede max-w-xl mx-auto">{ONE_LINER} Here is how it works, what is free, and what happens after someone taps your card.</p>
        </div>
      </section>

      <div className="hp-soft flex-1">
        <div className="max-w-2xl mx-auto w-full px-5 sm:px-6 pt-8 pb-16">
          {/* Contents */}
          <nav aria-label="Contents" className="rd-card-l px-6 py-5 mb-10">
            <p className="hp-kicker !text-[0.6875rem] mb-3">On this page</p>
            <ol className="grid sm:grid-cols-2 gap-x-6 gap-y-1.5 text-[0.9375rem] list-decimal pl-5 text-slate-700">
              {GROUPS.map((g) => (
                <li key={g.id}><a href={`#${g.id}`} className="hover:text-slate-900 underline underline-offset-2 decoration-slate-300">{g.label}</a></li>
              ))}
            </ol>
          </nav>

          {GROUPS.map((g) => (
            <section key={g.id} id={g.id} className="mb-12 scroll-mt-28" aria-labelledby={`${g.id}-h`}>
              <h2 id={`${g.id}-h`} className="rd-h2 text-[clamp(1.4rem,2.8vw,1.85rem)] text-slate-900 mb-5 [text-wrap:balance]">{g.label}</h2>
              <div className="flex flex-col gap-4">
                {g.items.map((f) => {
                  const block = (
                    <article key={f.id} id={f.id} className="rd-card-l px-6 py-5 scroll-mt-28">
                      <h3 className="text-slate-900 font-semibold text-[1.0625rem] leading-snug [text-wrap:balance]">
                        <a href={`#${f.id}`} className="hover:underline underline-offset-2 decoration-slate-300">{f.q}</a>
                      </h3>
                      <p className="text-ink-muted text-[0.9375rem] mt-2.5 leading-relaxed">{f.a}</p>
                      <p className="text-[0.875rem] mt-2.5 flex flex-wrap gap-x-3 gap-y-1">
                        {f.links.map((l) => (
                          <Link key={l.href} href={l.href} className="text-brand underline underline-offset-2">{l.label}</Link>
                        ))}
                      </p>
                    </article>
                  );
                  // Pricing answers are hidden inside the iOS shell (3.1.1);
                  // the web and the structured data keep them.
                  return f.pricing ? <NativeHidden key={f.id}>{block}</NativeHidden> : block;
                })}
              </div>
            </section>
          ))}

          <div className="text-center mt-4">
            <Link href={`/cards/new?src=${SRC}`} className="rd-btn rd-btn-primary rd-btn-lg">
              Create your free card →
            </Link>
            <p className="text-slate-500 text-[0.875rem] mt-5">
              Something not answered here? <Link href="/contact" className="text-brand underline underline-offset-2">Ask a real person</Link> — replies within 24 hours.
            </p>
          </div>
        </div>
      </div>

      <div className="hp-soft">
        <section className="max-w-2xl mx-auto w-full px-5 sm:px-6 pb-16 text-center">
          <div className="mb-3"><Eyebrow dark={false}>Keep exploring</Eyebrow></div>
          <div className="flex flex-wrap justify-center gap-2">
            <NativeHidden><Link href="/pricing" className={chip}>Pricing</Link></NativeHidden>
            <Link href="/compare" className={chip}>Compare alternatives</Link>
            <Link href="/products/lead-capture" className={chip}>Lead capture</Link>
            <Link href="/products/wallet" className={chip}>Apple Wallet</Link>
            <Link href="/download" className={chip}>Get the app</Link>
          </div>
          <p className="text-slate-500 text-xs mt-8">Last updated {updated}.</p>
        </section>
      </div>

      <SiteFooterMini />
    </main>
  );
}
