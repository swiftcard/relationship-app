import type { Metadata } from "next";
import Link from "next/link";
import SiteNav from "@/components/site/SiteNav";
import SiteFooterMini from "@/components/site/SiteFooterMini";
import HomeHeadingReveal from "@/components/site/HomeHeadingReveal";
import "@/app/home.css";

// ── About: /about ───────────────────────────────────────────────────────────
//
// Short on purpose (under 200 words): what SwiftCard is, who it is for, and the
// company facts. No people named and nothing about how the product is made —
// /press and /company carry the longer story.
//
// "about" was only a reserved slug (lib/slug.ts) with no route, so the request
// fell through to the [username] card route and rendered an empty page.
//
// Static page: no cookies()/headers() reads, so it prerenders with the rest of
// the marketing site (see marketing-site-static).

export const metadata: Metadata = {
  title: "About SwiftCard",
  description:
    "SwiftCard is the digital business card that shares everything. Share by tap, QR or link, capture the people you meet, and follow up. Operated by Swift Card Inc., New York.",
  alternates: { canonical: "/about" },
};

function H2({ children }: { children: React.ReactNode }) {
  return <h2 className="text-[1.25rem] font-bold tracking-[-0.01em] text-slate-900 mt-12 mb-3">{children}</h2>;
}

const LINK = "text-brand underline";

export default function AboutPage() {
  return (
    // bg-cream stays only for the native shell's status-bar canvas rule in
    // globals.css (html.native-app:has(main.bg-cream)); .hp paints the page
    // itself white (owner, 2026-09-17: light pages, no cream).
    <main className="hp sc-canvas-white min-h-screen bg-cream flex flex-col">
      <SiteNav />
      <HomeHeadingReveal />

      <section className="hp-page-hero border-b border-slate-200/70">
        <div className="relative max-w-3xl mx-auto px-5 sm:px-6 pt-28 sm:pt-36 pb-10 sm:pb-12 w-full" data-hp-head>
          <h1 className="rd-display text-[clamp(2.1rem,4.4vw,3rem)] text-slate-900 [text-wrap:balance]">About SwiftCard</h1>
          <p className="text-slate-500 text-[0.9375rem] mt-3">The digital business card that shares everything.</p>
        </div>
      </section>

      <div className="max-w-3xl mx-auto px-5 sm:px-6 pt-10 pb-20 w-full">
        <p className="text-slate-600 text-[0.96875rem] leading-[1.75] mb-4">
          SwiftCard replaces the paper business card with one that never runs out. You share it by NFC tap, QR code,
          Apple Wallet, text or link, and the person you meet saves your contact in one tap, with no app to install.
          Every card comes with a link-in-bio page, shows you who viewed it, and turns the people who share their
          details back into contacts you can follow up with. It&apos;s built for anyone whose work depends on the
          people they meet: salespeople, realtors, founders, freelancers and whole teams.
        </p>

        <H2>Company</H2>
        <dl className="text-[0.96875rem] leading-[1.75] text-slate-600 space-y-1">
          <div className="flex gap-3"><dt className="w-24 shrink-0 text-slate-900 font-medium">Name</dt><dd>Swift Card Inc.</dd></div>
          <div className="flex gap-3"><dt className="w-24 shrink-0 text-slate-900 font-medium">Location</dt><dd>New York, NY</dd></div>
          <div className="flex gap-3"><dt className="w-24 shrink-0 text-slate-900 font-medium">Email</dt><dd><a href="mailto:hello@swiftcard.me" className={LINK}>hello@swiftcard.me</a></dd></div>
        </dl>
        <p className="text-slate-600 text-[0.96875rem] leading-[1.75] mt-6">
          <Link href="/press" className={LINK}>Press</Link>
          {" · "}
          <Link href="/privacy" className={LINK}>Privacy Policy</Link>
          {" · "}
          <Link href="/terms" className={LINK}>Terms of Service</Link>
        </p>
      </div>

      <SiteFooterMini />
    </main>
  );
}
