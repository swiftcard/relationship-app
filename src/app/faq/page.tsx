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
import { jsonLdScript } from "@/lib/brand";
import "@/app/home.css";

// ── /faq: the questions people ask before they sign up, as real headings ────
//
// SEO audit 2026-10-14: the site answered these only inside accordions on the
// compare and feature pages, where the question is a <summary>, not a heading.
// Search engines and AI assistants lift answers from pages whose questions ARE
// the headings ("Does SwiftCard work on Android?" as an <h2> followed by the
// answer), so this page renders every question as an h2 with the answer in
// plain paragraphs — no disclosure widgets, nothing hidden until a click.
//
// Honesty rules: every answer states a shipped feature. Prices, limits and the
// trial length come from lib/plan (the same numbers /pricing renders), the
// Android answer flips with the Google Play switch in lib/app-store, and the
// CRM list comes from the integration registry — so nothing here can drift
// from the product. Pricing answers ride inside NativeHidden (App Review
// 3.1.1: the iOS shell must not show our pricing). The same array feeds the
// FAQPage JSON-LD, one source.

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://swiftcard.me";
const SRC = "faq_page"; // registered SIGNUP_SOURCE — keeps this page's conversions separable

const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const PRO_MONTHLY = usd(PLAN_PRICES.PRO_MONTHLY_CENTS);
const PRO_ANNUAL = usd(PLAN_PRICES.PRO_ANNUAL_CENTS);
const OFFICE_SEAT = usd(PLAN_PRICES.OFFICE_MONTHLY_PER_SEAT_CENTS);

export const metadata: Metadata = {
  title: "SwiftCard FAQ: Android, Pricing, NFC, Follow-Up and More",
  description:
    "Straight answers about SwiftCard: does it work on Android, is it free, do recipients need an app, how lead capture and automatic follow-up work, and what Pro adds.",
  alternates: { canonical: `${APP_URL}/faq` },
  openGraph: {
    title: "SwiftCard: frequently asked questions",
    description: "Does it work on Android? Is it free? Do they need an app? How does follow-up work? Every answer, in one place.",
    url: `${APP_URL}/faq`,
    siteName: "SwiftCard",
  },
};

type Faq = { q: string; a: string; pricing?: true };
type Group = { label: string; items: Faq[] };

const ANDROID_A = PLAY_STORE_URL
  ? "Yes. SwiftCard has an Android app on Google Play (search \"SwiftCard: Business Card\") and an iPhone app on the App Store, and the web app works in any browser. The person you share with never needs an app on any phone: your card opens in their browser and they save your contact in one tap."
  : "Yes. SwiftCard works in any browser on Android, so you can build, edit and share your card from an Android phone without an app. The iPhone app is on the App Store. The person you share with never needs an app on any phone: your card opens in their browser and they save your contact in one tap.";

const GROUPS: Group[] = [
  {
    label: "Getting started",
    items: [
      {
        q: "What is SwiftCard?",
        a: "SwiftCard is a digital business card that does the follow-up. You build one card, share it by QR code, link, NFC tap, Apple Wallet or Apple Watch, and the person you meet saves your contact in one tap and can share theirs back. Every new contact lands in your built-in CRM, and SwiftCard can send the follow-up email and text for you.",
      },
      {
        q: "Does SwiftCard work on Android?",
        a: ANDROID_A,
      },
      {
        q: "Does SwiftCard work on iPhone, Apple Watch and Apple Wallet?",
        a: "Yes. The iPhone app is on the App Store, your card can live in Apple Wallet so it is one swipe from the lock screen, and the Apple Watch app shows a scannable QR code on your wrist. The Wallet pass works without signal.",
      },
      {
        q: "Does the person I meet need the SwiftCard app?",
        a: "No. Your card opens in their phone's browser, on iPhone or Android. They tap \"Save Contact\" and you are in their phone. If they fill in the share-back form, their name, phone and email land in your contacts.",
      },
      {
        q: "Is SwiftCard free?",
        a: `Yes, there is a free plan with no time limit. It includes ${PLAN_LIMITS.FREE_CARD_LIMIT} digital business card, all the card designs, QR, link and NFC sharing, Apple Wallet, your Swift Links page with ${PLAN_LIMITS.FREE_MAX_LINKS} extra links, the Swift Signature email signature, a contacts list with notes, automatic follow-up emails you can switch on for any contact, and basic stats. On Free, you can save up to ${PLAN_LIMITS.FREE_LEADS_PER_MONTH} new contacts a month.`,
        pricing: true,
      },
      {
        q: "How much does SwiftCard Pro cost?",
        a: `Pro is ${PRO_MONTHLY} a month or ${PRO_ANNUAL} a year, with a ${TRIAL_DAYS}-day free trial and no contract. Pro removes the limits: unlimited cards and contacts, follow-up by text message as well as email, AI-written follow-ups, the AI card designer, the paper business card scanner, custom designs and colors, viewer locations and full view history. Subscriptions bought on iPhone are billed and canceled through Apple.`,
        pricing: true,
      },
      {
        q: "Can I cancel at any time?",
        a: "Yes. There are no contracts. On the web, go to Settings → Plan and billing, tap \"Manage subscription & payment\", and choose \"Switch to Free\". If you subscribed on iPhone, cancel through your Apple subscriptions. Either way you keep Pro until the end of the period you have paid for, and nothing is deleted.",
        pricing: true,
      },
    ],
  },
  {
    label: "Sharing your card",
    items: [
      {
        q: "How do I share my SwiftCard?",
        a: "Show the QR code on your phone or Apple Watch, tap an NFC tag to their phone, send the link by text, email or social media, add the card to Apple Wallet, or put it in your email signature with Swift Signature. Every share carries its source, so you can see later which one brought the contact.",
      },
      {
        q: "Do I need to buy an NFC card?",
        a: "No. QR, link and Apple Wallet need nothing extra. If you want tap-to-share, SwiftCard writes your card link to any blank NFC tag or card, which costs a few dollars online. There is no SwiftCard-branded hardware to buy.",
      },
      {
        q: "Can I use SwiftCard with an NFC card I already own from Popl, Blinq, Dot or another brand?",
        a: "Yes. NFC cards store a link, and SwiftCard can write your new card link to the tag you already have. After that, a tap opens your SwiftCard.",
      },
      {
        q: "What happens when someone taps or scans my card?",
        a: "Your card opens in their browser with your photo, title, contact details and links. They tap once to save you to their phone. Under that is a share-back form: if they enter their name, phone and email, they become a contact in your dashboard and your follow-up can start.",
      },
      {
        q: "Can I change my card after I have shared it?",
        a: "Yes. Your card is a live link, so every edit shows the next time anyone opens it. QR codes, NFC tags, your Apple Wallet pass and your email signature all keep working because they point at the link, not at a copy.",
      },
    ],
  },
  {
    label: "Leads and follow-up",
    items: [
      {
        q: "How does lead capture work?",
        a: "Every card has a share-back form. When someone fills it in, they land in your contacts with the time, the source of the share and any notes you add. You get a notification the moment it happens.",
      },
      {
        q: "Does SwiftCard follow up automatically?",
        a: "Yes. Switch follow-up on for a contact and SwiftCard sends the email for you on schedule. On Pro, follow-ups also go by text message, AI writes the message for each contact, and replies come back into the same thread. Texts are sent from a registered sender and honor STOP.",
      },
      {
        q: "Will I know when someone views my card?",
        a: "Yes. You get a notification when your card or your Swift Links page is viewed, with the source of the view. Repeat opens within a session are counted once, and crawler traffic is filtered out. Pro adds viewer cities and the full view history.",
      },
      {
        q: "Which CRMs does SwiftCard integrate with?",
        a: `New contacts can flow automatically into ${integrationNames()}. Connect them once in Settings → Notifications and preferences, in the "Send contacts to your CRM" section. Integrations are a Pro feature.`,
        pricing: true,
      },
    ],
  },
  {
    label: "Design and teams",
    items: [
      {
        q: "Can I design my own card?",
        a: "Every plan includes the designer templates with your photo, logo and colors. Pro adds the AI card designer: give it your headshot, logo and colors, or a photo of the paper card you already have, and it rebuilds the design with your details. Pro also unlocks premium finishes and photo or video backgrounds.",
      },
      {
        q: "Does SwiftCard have a link-in-bio page?",
        a: "Yes. Swift Links is a link-in-bio page backed by your card. It counts every visit, names its source, and has a Connect button so visitors can save your contact and share theirs back. It is included on the free plan.",
      },
      {
        q: "Is there a plan for teams and offices?",
        a: `Yes. SwiftCard Office gives every teammate an on-brand card with their own leads under one admin dashboard, for ${OFFICE_SEAT} per seat per month with a ${PLAN_LIMITS.OFFICE_MIN_SEATS}-seat minimum and no maximum.`,
        pricing: true,
      },
    ],
  },
];

const ALL: Faq[] = GROUPS.flatMap((g) => g.items);

export default function FaqPage() {
  const faqJsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: ALL.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
  };
  return (
    <main className="hp sc-canvas-white min-h-screen bg-cream flex flex-col">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(faqJsonLd) }} />
      <ScrollProgress />
      <ScrollReveal />
      <HomeHeadingReveal />
      <SiteNav />

      <section className="hp-page-hero text-center px-5 sm:px-6 pt-28 sm:pt-36 pb-12">
        <div className="relative" data-hp-head>
          <div className="mb-4"><Eyebrow dark={false}>FAQ</Eyebrow></div>
          <h1 className="rd-display text-[clamp(2.1rem,4.4vw,3rem)] text-slate-900 mb-4 max-w-2xl mx-auto [text-wrap:balance]">Frequently asked questions</h1>
          <p className="hp-lede max-w-xl mx-auto">
            Straight answers about how SwiftCard works, what is free, and what happens after someone taps your card.
          </p>
        </div>
      </section>

      <div className="hp-soft flex-1">
        <div className="max-w-2xl mx-auto w-full px-5 sm:px-6 pt-10 pb-16">
          {GROUPS.map((g) => {
            const section = (
              <section key={g.label} className="mb-12" aria-label={g.label}>
                <div className="mb-5"><Eyebrow dark={false}>{g.label}</Eyebrow></div>
                <div className="flex flex-col gap-4">
                  {g.items.map((f) => {
                    const block = (
                      <article key={f.q} className="rd-card-l px-6 py-5">
                        <h2 className="text-slate-900 font-semibold text-[1.0625rem] leading-snug [text-wrap:balance]">{f.q}</h2>
                        <p className="text-ink-muted text-[0.9375rem] mt-2.5 leading-relaxed">{f.a}</p>
                      </article>
                    );
                    // Pricing answers are hidden inside the iOS shell (3.1.1);
                    // the web and the structured data keep them.
                    return f.pricing ? <NativeHidden key={f.q}>{block}</NativeHidden> : block;
                  })}
                </div>
              </section>
            );
            return section;
          })}

          <div className="text-center mt-4">
            <Link href={`/cards/new?src=${SRC}`} className="rd-btn rd-btn-primary rd-btn-lg">
              Create your free card →
            </Link>
            <p className="text-slate-500 text-[0.875rem] mt-5">
              Something not answered here? <Link href="/contact" className="text-brand underline underline-offset-2">Ask a real person</Link>. We reply within 24 hours.
            </p>
          </div>
        </div>
      </div>

      <div className="hp-soft">
        <section className="max-w-2xl mx-auto w-full px-5 sm:px-6 pb-16 text-center">
          <div className="mb-3"><Eyebrow dark={false}>Keep exploring</Eyebrow></div>
          <div className="flex flex-wrap justify-center gap-2">
            <Link href="/pricing" className="text-[0.8125rem] text-slate-600 hover:text-slate-900 hover:border-slate-300 rounded-full px-3.5 py-1.5 bg-white border border-slate-200 transition-colors">Pricing</Link>
            <Link href="/compare" className="text-[0.8125rem] text-slate-600 hover:text-slate-900 hover:border-slate-300 rounded-full px-3.5 py-1.5 bg-white border border-slate-200 transition-colors">Compare alternatives</Link>
            <Link href="/products/lead-capture" className="text-[0.8125rem] text-slate-600 hover:text-slate-900 hover:border-slate-300 rounded-full px-3.5 py-1.5 bg-white border border-slate-200 transition-colors">Lead capture</Link>
            <Link href="/products/wallet" className="text-[0.8125rem] text-slate-600 hover:text-slate-900 hover:border-slate-300 rounded-full px-3.5 py-1.5 bg-white border border-slate-200 transition-colors">Apple Wallet</Link>
            <Link href="/download" className="text-[0.8125rem] text-slate-600 hover:text-slate-900 hover:border-slate-300 rounded-full px-3.5 py-1.5 bg-white border border-slate-200 transition-colors">Get the app</Link>
          </div>
        </section>
      </div>

      <SiteFooterMini />
    </main>
  );
}
