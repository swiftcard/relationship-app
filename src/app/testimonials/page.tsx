import type { Metadata } from "next";
import Link from "next/link";
import SiteNav from "@/components/site/SiteNav";
import SiteFooter from "@/components/site/SiteFooter";
import ScrollReveal from "@/components/ScrollReveal";
import ScrollProgress from "@/components/ScrollProgress";
import NativeHidden from "@/components/NativeHidden";
import AppStoreReviews from "@/components/site/AppStoreReviews";
import HomeHeadingReveal from "@/components/site/HomeHeadingReveal";
import MarketingCta from "@/components/site/MarketingCta";
import "@/app/home.css";

// COMPLIANCE NOTE (do not regress): this page previously showed fictional
// testimonials with fake star ratings and a fabricated review count. Under the
// FTC's Rule on the Use of Consumer Reviews and Testimonials (16 CFR Part 465,
// effective Oct 2024), testimonials from people who don't exist or who have no
// real experience with the product — and misrepresented ratings/metrics — are
// prohibited, with civil penalties per violation. Until we have REAL customer
// reviews (App Store reviews, pulled by lib/app-store-reviews.ts), this page shows only truthful,
// verifiable claims about the product. Never add invented quotes, star ratings,
// review counts, or usage statistics here.

export const metadata: Metadata = {
  title: "Why SwiftCard — SwiftCard",
  description:
    "Why professionals are switching to digital business cards: share in one tap, capture every lead, and follow up automatically. Free to start.",
};

function A({ children }: { children: React.ReactNode }) {
  return <span className="hp-fill">{children}</span>;
}

// Truthful, product-grounded use cases — written in the second person as
// marketing copy about what the product DOES, never framed as a quote from a
// customer. Every claim maps to a real shipped feature.
const USE_CASES: { role: string; title: string; body: string }[] = [
  {
    role: "Real estate",
    title: "Every open-house visitor, captured",
    body: "Show your QR at the door. Each scan opens your card, and anyone who shares their info lands in your dashboard — with automatic follow-up so no lead goes cold.",
  },
  {
    role: "Sales teams",
    title: "One brand, every rep in sync",
    body: "Office accounts put your whole team on matching cards. Update the brand kit once and every card changes; leads route to the rep who made the connection.",
  },
  {
    role: "Recruiters",
    title: "Stay top of mind after one meeting",
    body: "Pick a follow-up cadence for each new contact. SwiftCard sends the emails and texts for you — each one signed with your live card.",
  },
  {
    role: "Creators & freelancers",
    title: "Portfolio, booking, socials — one link",
    body: "Your Swift Links page holds your bio, links, and socials in one place. Drop it in your Instagram or TikTok bio and let clients reach you from anywhere.",
  },
  {
    role: "Consultants",
    title: "Share from your phone, wallet, or watch",
    body: "Your card lives in Apple Wallet and on your wrist. Tap, scan, or text it — the other person needs no app to receive it.",
  },
  {
    role: "Anyone who networks",
    title: "See what's working",
    body: "Views, locations, and sources for your card and links — networking becomes something you can measure instead of guess at.",
  },
];

// Every fact here must stay literally true.
const FACTS = [
  { v: "Free", l: "to start — no credit card" },
  { v: "1 tap", l: "to share your card" },
  { v: "No app", l: "needed to receive it" },
  { v: "Cancel", l: "anytime, no lock-in" },
];

export default function WhySwiftCardPage() {
  return (
    <div className="bg-white">
      <ScrollProgress />
      <ScrollReveal />
      <HomeHeadingReveal />
      <SiteNav />

      <main className="hp overflow-clip">
        {/* Hero */}
        <section className="hp-page-hero pt-32 pb-16 sm:pt-40 sm:pb-20">
          <div className="relative max-w-4xl mx-auto px-5 sm:px-6 text-center" data-hp-head>
            <span className="hp-kicker">Why SwiftCard</span>
            <h1 className="rd-display text-slate-900 text-[clamp(2.3rem,5vw,3.8rem)] mt-5">
              Built for people who <A>never want to lose a lead.</A>
            </h1>
            <p className="hp-lede !text-[1.12rem] mt-5 max-w-[640px] mx-auto">
              Paper cards get tossed. SwiftCard puts your card in their phone, their contact in your dashboard,
              and your follow-up on autopilot. Here&apos;s what that looks like for people like you.
            </p>
          </div>
        </section>

        {/* Use cases — truthful second-person scenarios, not testimonials */}
        <section className="hp-soft relative py-20 sm:py-24">
          <div className="max-w-6xl mx-auto px-5 sm:px-6">
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {USE_CASES.map((u, i) => (
                <div key={u.role} className="hp-card flex flex-col" data-reveal style={{ transitionDelay: `${(i % 3) * 70}ms` }}>
                  <p className="rd-eyebrow text-blue-700">{u.role}</p>
                  <p className="text-slate-900 font-semibold text-[1.0625rem] mt-3">{u.title}</p>
                  <p className="text-slate-500 text-[0.90625rem] leading-relaxed mt-2 flex-1">{u.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* REAL App Store reviews (Apple RSS). Renders nothing until the app is
            live and has reviews — never an invented rating/count. */}
        <AppStoreReviews />

        {/* Facts strip — literally-true claims only */}
        <section className="hp-soft relative py-16 sm:py-20">
          <div className="max-w-5xl mx-auto px-5 sm:px-6">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {FACTS.map((s) => (
                <div key={s.l} className="hp-card text-center" data-reveal>
                  <p className="rd-display text-slate-900 text-[clamp(2rem,4vw,2.8rem)] leading-none">{s.v}</p>
                  <p className="text-slate-500 text-[0.84375rem] mt-2">{s.l}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* CTA */}
        <MarketingCta>
          <h2 className="rd-display text-white text-[clamp(2.2rem,5vw,4rem)]">Try it yourself — it&apos;s free to start.</h2>
          <p className="text-white/85 text-[1.15rem] mt-5 max-w-[480px]">Your free SwiftCard is 60 seconds away. Judge it on what it does.</p>
          <div className="mt-9 flex flex-wrap items-center gap-3">
            <Link href="/cards/new" className="hp-btn-white">Create your free card</Link>
            <NativeHidden><Link href="/pricing" className="rd-btn border border-white/40 bg-white/10 text-white">See pricing</Link></NativeHidden>
          </div>
        </MarketingCta>
      </main>

      <SiteFooter />
    </div>
  );
}
