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
import { PLAN_LIMITS } from "@/lib/plan";

// ── Tier-1 landing page: "link in bio with analytics" ───────────────────────
// Part of the SEO plan (owner directive 2026-09-01). Every claim is a shipped
// Swift Links feature — page-view analytics with sources, view notifications,
// themes/Looks, video tiles, contact capture. No invented numbers; pricing
// only inside NativeHidden (3.1.1).

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://swiftcard.me";
const SRC = "link_in_bio_page"; // registered SIGNUP_SOURCE — keeps this page's conversions separable

export const metadata: Metadata = {
  title: "Link in Bio With Analytics and Lead Capture | SwiftCard",
  description:
    "Swift Links is the link-in-bio page that reports back with view analytics, traffic sources, and visit notifications, plus a \"Connect\" button that captures your visitors' contact info. Free to start.",
  alternates: { canonical: `${APP_URL}/link-in-bio-with-analytics` },
  openGraph: {
    title: "Link in bio with analytics",
    description: "A link-in-bio page with real analytics (views, sources, and notifications) plus built-in contact capture.",
    url: `${APP_URL}/link-in-bio-with-analytics`,
    siteName: "SwiftCard",
  },
};

const FEATURES = [
  { t: "Views you can actually see", d: "Every visit to your Swift Links page is counted and graphed in your dashboard for today, this week, and this month, separately from your card's own traffic." },
  { t: "Know where visitors came from", d: "Instagram bio, TikTok, QR code, or a shared link: each visit carries its source, so you learn which bio placement earns its spot." },
  { t: "A notification when it matters", d: "Your phone tells you when your page is viewed, and repeat visits are folded into one honest count instead of inflating it." },
  { t: "Visitors can share their info back", d: "This is the one thing a plain bio link can't do: a \"Connect\" button puts the visitor's name, phone, and email into your contacts, with follow-up that runs itself." },
  { t: "Looks, video tiles, headers", d: "One-tap themes, featured tiles that pull link previews automatically, and section headers that keep long lists tidy." },
  { t: "Your card rides along", d: "Every Swift Links page is backed by your digital business card. With one tap, your visitor has you saved in their phone." },
];

const FAQ = [
  { q: "Does Swift Links show analytics for my bio link?", a: "Yes. Page views are tracked and graphed in your dashboard, separately from your card's views, with traffic sources so you can tell Instagram from TikTok from a QR scan. You also get a notification when your page is viewed." },
  { q: "How is this different from Linktree?", a: "The analytics come with capture. Visitors don't just tap through your links; they can save your contact and share theirs back, and their details land in your built-in CRM. See the full comparison at swiftcard.me/compare/linktree-alternative." },
  { q: "Can I style the page?", a: "Yes. Pick a Look (theme) in one tap, feature links as large tiles with automatic preview images, add section headers, and match colors and fonts to your brand." },
  { q: "How many links can I add?", a: `The free plan includes your socials plus ${PLAN_LIMITS.FREE_MAX_LINKS} extra links. Pro removes the cap and adds video previews, headers, and full analytics.` },
  { q: "Do my visitors need an app?", a: "No. The page opens in any browser. Saving your contact and sharing theirs back each take one tap, with nothing to install." },
];

export default function LinkInBioPage() {
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
        <div className="mb-4"><Eyebrow dark={false}>Swift Links</Eyebrow></div>
        <h1 className="rd-display text-[clamp(2.1rem,4.4vw,3rem)] text-slate-900 mb-4 max-w-2xl mx-auto [text-wrap:balance]">The link in bio that reports back</h1>
        <p className="hp-lede max-w-xl mx-auto">
          Most bio links are a dead end: visitors tap through and vanish. Swift Links counts every visit, names its source, and lets visitors leave their contact info on the way.
        </p>
        <div className="mt-7">
          <Link href={`/cards/new?src=${SRC}`} className="rd-btn rd-btn-primary rd-btn-lg">
            Create your page free →
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
            Free to start. <Link href="/pricing" className="text-brand underline underline-offset-2">Pro</Link> unlocks unlimited links, video tiles, and full analytics.
          </p>
        </NativeHidden>
      </section>
      </div>

      <div className="pt-16">
      <FaqAccordion items={FAQ}>
        <Link href={`/cards/new?src=${SRC}`} className="rd-btn rd-btn-primary rd-btn-lg">
          Get your Swift Links page →
        </Link>
      </FaqAccordion>
      </div>

      <div className="hp-soft flex-1">
      <section className="max-w-2xl mx-auto w-full px-5 sm:px-6 pt-14 pb-16 text-center">
        <div className="mb-3"><Eyebrow dark={false}>Keep exploring</Eyebrow></div>
        <div className="flex flex-wrap justify-center gap-2">
          <Link href="/products/swiftlinks" className="text-[0.8125rem] text-slate-600 hover:text-slate-900 hover:border-slate-300 rounded-full px-3.5 py-1.5 bg-white border border-slate-200 transition-colors">Swift Links product tour</Link>
          <Link href="/compare/linktree-alternative" className="text-[0.8125rem] text-slate-600 hover:text-slate-900 hover:border-slate-300 rounded-full px-3.5 py-1.5 bg-white border border-slate-200 transition-colors">Linktree alternative</Link>
          <Link href="/business-card-view-tracking" className="text-[0.8125rem] text-slate-600 hover:text-slate-900 hover:border-slate-300 rounded-full px-3.5 py-1.5 bg-white border border-slate-200 transition-colors">Card view tracking</Link>
          <Link href="/products/analytics" className="text-[0.8125rem] text-slate-600 hover:text-slate-900 hover:border-slate-300 rounded-full px-3.5 py-1.5 bg-white border border-slate-200 transition-colors">Dashboard &amp; analytics</Link>
          <Link href="/templates" className="text-[0.8125rem] text-slate-600 hover:text-slate-900 hover:border-slate-300 rounded-full px-3.5 py-1.5 bg-white border border-slate-200 transition-colors">Card designs</Link>
        </div>
      </section>
      </div>

      <SiteFooterMini />
    </main>
  );
}
