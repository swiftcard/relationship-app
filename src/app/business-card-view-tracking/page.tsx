import type { Metadata } from "next";
import Eyebrow from "@/components/site/Eyebrow";
import Link from "next/link";
import SiteNav from "@/components/site/SiteNav";
import SiteFooterMini from "@/components/site/SiteFooterMini";
import FaqAccordion from "@/components/site/FaqAccordion";
import ScrollProgress from "@/components/ScrollProgress";
import ScrollReveal from "@/components/ScrollReveal";
import NativeHidden from "@/components/NativeHidden";
import HomeHeadingReveal from "@/components/site/HomeHeadingReveal";
import "@/app/home.css";

// ── Tier-1 landing page: "business card that tracks who viewed it" ──────────
// Part of the SEO plan (owner directive 2026-09-01). Every claim below is a
// real, shipped feature — view notifications, traffic sources, card-vs-links
// split, repeat views, viewer locations (Pro). No invented numbers, no
// competitor claims. Pricing language rides inside NativeHidden (3.1.1).

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://swiftcard.me";
const SRC = "view_tracking_page"; // registered SIGNUP_SOURCE — keeps this page's conversions separable

export const metadata: Metadata = {
  title: "A Business Card That Tracks Who Viewed It | SwiftCard",
  description:
    "SwiftCard tells you when your business card is viewed, with instant notifications, traffic sources, repeat visits, and viewer locations. Free to start.",
  alternates: { canonical: `${APP_URL}/business-card-view-tracking` },
  openGraph: {
    title: "A business card that tracks who viewed it",
    description: "Instant view notifications, traffic sources, repeat visits, and viewer locations, built into your digital business card.",
    url: `${APP_URL}/business-card-view-tracking`,
    siteName: "SwiftCard",
  },
};

const FEATURES = [
  { t: "Know the moment it's viewed", d: "When a real person opens your card, your phone tells you, so you can follow up while the conversation is still warm instead of next Tuesday." },
  { t: "See where views come from", d: "QR scan, NFC tap, shared link, or your Swift Links page: every view carries its source, so you learn which channel actually works for you." },
  { t: "Card views vs. link views, separately", d: "Your dashboard's traffic graph splits SwiftCard views from Swift Links views, so you always know which page is doing the work." },
  { t: "Repeat visits count", d: "Someone coming back to your card is the strongest buying signal there is. SwiftCard shows unique visitors and repeat views side by side." },
  { t: "Viewer locations", d: "See the cities and countries your views come from. It's useful the day after a conference, or when your card gets shared beyond your own network. Included with Pro." },
  { t: "From viewed to captured", d: "Tracking tells you someone looked, and the share-back form turns them into a contact by sending their name, phone, and email straight into your built-in CRM." },
];

const FAQ = [
  { q: "Does SwiftCard notify me when someone views my card?", a: "Yes. You get a notification when your card or your Swift Links page is viewed, and repeat visits within a session aren't double-counted, so the numbers stay honest." },
  { q: "Can I see exactly who viewed my business card?", a: "You see when a view happened, where it came from (QR, NFC, link, or your links page), the viewer's general location, and whether they'd visited before. Names appear when the visitor chooses to share their info back through your card's form. That's what turns a view into a contact." },
  { q: "Does view tracking work with paper business cards?", a: "It works with anything that carries your link: a QR code on a printed card, an NFC tag, an email signature, or a plain URL. Each carries its own source, so you can tell them apart." },
  { q: "Is the tracking accurate, or does it count bots?", a: "SwiftCard filters out non-human traffic. Crawler and datacenter visits don't count as views, and quick repeat opens are folded into one visit." },
  { q: "Is it free?", a: "Creating your card, sharing it, and view notifications are free. Pro adds detailed analytics like viewer locations and full history." },
];

export default function ViewTrackingPage() {
  const faqJsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: FAQ.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
  };
  return (
    // bg-cream stays only for the native shell's status-bar canvas rule in
    // globals.css (html.native-app:has(main.bg-cream)); .hp paints the page
    // itself white (owner, 2026-09-17: light pages, no cream).
    <main className="hp sc-canvas-white min-h-screen bg-cream flex flex-col">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }} />
      <ScrollProgress />
      <ScrollReveal />
      <HomeHeadingReveal />
      <SiteNav />

      <section className="hp-page-hero text-center px-5 sm:px-6 pt-28 sm:pt-36 pb-14">
        <div className="relative" data-hp-head>
        <div className="mb-4"><Eyebrow dark={false}>View tracking</Eyebrow></div>
        <h1 className="rd-display text-[clamp(2.1rem,4.4vw,3rem)] text-slate-900 mb-4 max-w-2xl mx-auto [text-wrap:balance]">A business card that tells you who&apos;s looking</h1>
        <p className="hp-lede max-w-xl mx-auto">
          Paper cards disappear into pockets. A SwiftCard reports back on every view, where it came from, and whether the person came back for a second look.
        </p>
        <div className="mt-7">
          <Link href={`/cards/new?src=${SRC}`} className="rd-btn rd-btn-primary rd-btn-lg">
            Create your free card →
          </Link>
        </div>
        </div>
      </section>

      <div className="hp-soft">
      <section className="max-w-4xl mx-auto w-full px-5 sm:px-6 pt-14 pb-16">
        <div className="grid sm:grid-cols-2 gap-4">
          {FEATURES.map((f) => (
            <div key={f.t} className="hp-card">
              <p className="text-slate-900 font-semibold text-[0.9375rem]">{f.t}</p>
              <p className="text-slate-500 text-[0.84375rem] mt-1.5 leading-relaxed">{f.d}</p>
            </div>
          ))}
        </div>
        <NativeHidden>
          <p className="text-slate-500 text-[0.9375rem] text-center mt-8">
            Free to start. <Link href="/pricing" className="text-brand underline underline-offset-2">Pro</Link> adds viewer locations, full view history, and automated follow-up.
          </p>
        </NativeHidden>
      </section>
      </div>

      <div className="pt-16">
      <FaqAccordion items={FAQ}>
        <Link href={`/cards/new?src=${SRC}`} className="rd-btn rd-btn-primary rd-btn-lg">
          Start tracking your card →
        </Link>
      </FaqAccordion>
      </div>

      <div className="hp-soft flex-1">
      <section className="max-w-2xl mx-auto w-full px-5 sm:px-6 pt-14 pb-16 text-center">
        <div className="mb-3"><Eyebrow dark={false}>Keep exploring</Eyebrow></div>
        <div className="flex flex-wrap justify-center gap-2">
          <Link href="/products/analytics" className="text-[0.8125rem] text-slate-600 hover:text-slate-900 hover:border-slate-300 rounded-full px-3.5 py-1.5 bg-white border border-slate-200 transition-colors">Dashboard &amp; analytics</Link>
          <Link href="/products/lead-capture" className="text-[0.8125rem] text-slate-600 hover:text-slate-900 hover:border-slate-300 rounded-full px-3.5 py-1.5 bg-white border border-slate-200 transition-colors">Lead capture</Link>
          <Link href="/link-in-bio-with-analytics" className="text-[0.8125rem] text-slate-600 hover:text-slate-900 hover:border-slate-300 rounded-full px-3.5 py-1.5 bg-white border border-slate-200 transition-colors">Link in bio with analytics</Link>
          <Link href="/compare" className="text-[0.8125rem] text-slate-600 hover:text-slate-900 hover:border-slate-300 rounded-full px-3.5 py-1.5 bg-white border border-slate-200 transition-colors">Compare alternatives</Link>
          <Link href="/templates" className="text-[0.8125rem] text-slate-600 hover:text-slate-900 hover:border-slate-300 rounded-full px-3.5 py-1.5 bg-white border border-slate-200 transition-colors">Card designs</Link>
        </div>
      </section>
      </div>

      <SiteFooterMini />
    </main>
  );
}
