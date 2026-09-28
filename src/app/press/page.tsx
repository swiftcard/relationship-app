import type { Metadata } from "next";
import Link from "next/link";
import SiteNav from "@/components/site/SiteNav";
import SiteFooterMini from "@/components/site/SiteFooterMini";
import HomeHeadingReveal from "@/components/site/HomeHeadingReveal";
import NativeHidden from "@/components/NativeHidden";
import { SwiftCardIcon } from "@/components/SwiftCardLogo";
import { INTEGRATIONS } from "@/components/site/integration-brands";
import { PLAN_PRICES, TRIAL_DAYS } from "@/lib/plan";
import { APP_STORE_URL } from "@/lib/app-store";
import "@/app/home.css";

// ── Press & media kit: /press ───────────────────────────────────────────────
//
// One page a journalist, a competition judge or a partner can read in two
// minutes and take assets from without emailing us. Everything on it is
// verifiable: launch date, prices (read from lib/plan.ts, never typed here),
// the integrations list (the same array the homepage renders), and the real
// App Store screenshots. Deliberately absent, by owner decision 2026-09-28:
// user counts, revenue, funding amounts and investor names — the funding is
// private, and a number we cannot stand behind is worse than no number.
//
// Static page: no cookies()/headers() reads, so it prerenders with the rest of
// the marketing site (see marketing-site-static).

export const metadata: Metadata = {
  title: "Press & Media Kit — SwiftCard",
  description:
    "Press information about SwiftCard, the digital business card that shares everything: company facts, product overview, logo and screenshots, and how to reach us.",
};

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://swiftcard.me";

const SCREENSHOTS: { file: string; caption: string }[] = [
  { file: "01-public-card.jpg", caption: "A SwiftCard as the person you meet sees it — save the contact in one tap." },
  { file: "10-ways-to-share.jpg", caption: "Share by NFC tap, QR code, Apple Wallet, text or link." },
  { file: "03-contacts.jpg", caption: "Every person who shares back lands in your contacts, with notes and follow-up." },
  { file: "06-dashboard.jpg", caption: "Views, saves and where your card is being opened." },
  { file: "08-swift-links.jpg", caption: "Swift Links — the link-in-bio page that comes with every card." },
];

const FACTS: { k: string; v: React.ReactNode }[] = [
  { k: "Product", v: "SwiftCard — a digital business card, link-in-bio page and lead follow-up in one app" },
  { k: "Company", v: "Swift Card Inc, New York, NY" },
  { k: "Founded", v: "2026, by a college student in New York" },
  { k: "Launched", v: "Web: summer 2026 · iOS App Store: September 2, 2026" },
  { k: "Platforms", v: "iPhone, Apple Watch, Apple Wallet, and any web browser (recipients need no app)" },
  { k: "Website", v: <Link href="/" className="text-brand underline">swiftcard.me</Link> },
  { k: "Press contact", v: <a href="mailto:hello@swiftcard.me" className="text-brand underline">hello@swiftcard.me</a> },
];

function H2({ children }: { children: React.ReactNode }) {
  return <h2 className="text-[1.25rem] font-bold tracking-[-0.01em] text-slate-900 mt-12 mb-3">{children}</h2>;
}
function P({ children }: { children: React.ReactNode }) {
  return <p className="text-slate-600 text-[0.96875rem] leading-[1.75] mb-4">{children}</p>;
}

export default function PressPage() {
  const monthly = `$${(PLAN_PRICES.PRO_MONTHLY_CENTS / 100).toFixed(2)}`;
  const annual = `$${(PLAN_PRICES.PRO_ANNUAL_CENTS / 100).toFixed(2)}`;
  const integrations = INTEGRATIONS.map((i) => i.name).join(", ");

  return (
    // bg-cream stays only for the native shell's status-bar canvas rule in
    // globals.css (html.native-app:has(main.bg-cream)); .hp paints the page
    // itself white (owner, 2026-09-17: light pages, no cream).
    <main className="hp sc-canvas-white min-h-screen bg-cream flex flex-col">
      <SiteNav />
      <HomeHeadingReveal />

      <section className="hp-page-hero border-b border-slate-200/70">
        <div className="relative max-w-3xl mx-auto px-5 sm:px-6 pt-28 sm:pt-36 pb-10 sm:pb-12 w-full" data-hp-head>
          <h1 className="rd-display text-[clamp(2.1rem,4.4vw,3rem)] text-slate-900 [text-wrap:balance]">Press &amp; media kit</h1>
          <p className="text-slate-500 text-[0.9375rem] mt-3">Facts, story, logo and screenshots — everything you need to write about SwiftCard.</p>
        </div>
      </section>

      <div className="max-w-3xl mx-auto px-5 sm:px-6 pt-10 pb-20 w-full">
        {/* The one-liner, quotable as-is */}
        <blockquote className="rounded-2xl border border-slate-200/80 bg-[#F5F7FB] px-5 py-4 mb-8">
          <p className="text-slate-900 text-[1.0625rem] leading-relaxed font-medium">
            SwiftCard is the digital business card that shares everything: one tap gives the person you meet your contact, links and socials, and tells you when they look.
          </p>
        </blockquote>

        <P>
          A SwiftCard lives at your own link. Share it in person with an NFC tap or a QR code, drop it
          in a text or an email signature, or keep it in Apple Wallet and on your Apple Watch. The
          person you meet saves your contact in one tap and can share theirs back — no app needed on
          their side. Every new contact lands in your dashboard, and SwiftCard can send the follow-up
          email and text for you, so the people you meet actually stay in touch.
        </P>

        {/* Facts */}
        <H2>Fast facts</H2>
        <dl className="rounded-2xl border border-slate-200/80 bg-[#F5F7FB] divide-y divide-slate-200/80">
          {FACTS.map((f) => (
            <div key={f.k} className="flex flex-col sm:flex-row sm:items-baseline gap-1 sm:gap-4 px-4 py-3">
              <dt className="text-slate-500 text-[0.8125rem] font-semibold sm:w-44 shrink-0">{f.k}</dt>
              <dd className="text-slate-800 text-[0.9375rem]">{f.v}</dd>
            </div>
          ))}
          {/* Our price never renders inside the iOS shell (App Review 3.1.1). */}
          <NativeHidden>
            <div className="flex flex-col sm:flex-row sm:items-baseline gap-1 sm:gap-4 px-4 py-3">
              <dt className="text-slate-500 text-[0.8125rem] font-semibold sm:w-44 shrink-0">Pricing</dt>
              <dd className="text-slate-800 text-[0.9375rem]">
                Free plan. Pro is {monthly}/month or {annual}/year with a {TRIAL_DAYS}-day free trial. Office plans for teams.
                Subscriptions bought on iPhone are billed and cancelled through Apple.
              </dd>
            </div>
          </NativeHidden>
          <div className="flex flex-col sm:flex-row sm:items-baseline gap-1 sm:gap-4 px-4 py-3">
            <dt className="text-slate-500 text-[0.8125rem] font-semibold sm:w-44 shrink-0">Integrations</dt>
            <dd className="text-slate-800 text-[0.9375rem]">{integrations}, Apple Wallet, Apple Watch</dd>
          </div>
        </dl>

        {/* Story */}
        <H2>The story</H2>
        <P>
          SwiftCard started in a classroom. Its founder, a college student in New York, kept meeting
          people — at events, interviews, club fairs — and losing them a week later: a paper card in a
          pocket, a LinkedIn request never sent, a number typed wrong. Existing digital-card apps
          either stopped at the share or asked for a hardware purchase and an annual contract before
          you could try them.
        </P>
        <P>
          So SwiftCard was built around what happens <em>after</em> the tap: the contact saved on both
          sides, the lead captured, the follow-up sent, and the owner told when their card is being
          looked at. It launched on the web in the summer of 2026 and on the iOS App Store on
          September 2, 2026, with a free plan that never requires hardware.
        </P>
        <P>
          Founder interviews, a founder photo and product demos are available on request at{" "}
          <a href="mailto:hello@swiftcard.me" className="text-brand underline">hello@swiftcard.me</a>.
        </P>

        {/* What makes it different — each claim maps to a shipped feature */}
        <H2>What makes it different</H2>
        <ul className="mb-3">
          {[
            ["Follow-up is built in", "Email and text sequences go to every new contact automatically — no third-party automation tool."],
            ["It tells you when someone looks", "Warm-lead alerts and a dashboard show views, saves and where the card is being opened."],
            ["Your link is your name", "Cards live at swiftcard.me/FirstLast-Company, not a tracking redirect, so the link looks like you."],
            ["AI Card Designer", "Snap any business card — yours or one you admire — and the AI rebuilds that design with your details."],
            ["No hardware required", "QR, link, Apple Wallet and Apple Watch sharing are free; NFC works with any blank tag."],
            ["Honest billing", "Transparent monthly and annual plans, a free trial, and Apple handles cancellation on iPhone."],
          ].map(([t, d]) => (
            <li key={t} className="text-slate-600 text-[0.96875rem] leading-[1.75] mb-2 ml-5 list-disc marker:text-slate-400">
              <strong className="text-slate-900">{t}.</strong> {d}
            </li>
          ))}
        </ul>

        {/* Assets */}
        <H2>Logo</H2>
        <div className="flex flex-col sm:flex-row sm:items-center gap-5 rounded-2xl border border-slate-200/80 bg-white p-5">
          <SwiftCardIcon size={96} />
          <div className="text-[0.9375rem] text-slate-600 leading-relaxed">
            <p className="text-slate-900 font-semibold mb-1">The SwiftCard mark</p>
            <p className="mb-2">
              The logo is the whole blue tile, always shown with its rounded corners. Please don&apos;t
              separate the bolt from the tile, recolor it, or place it on a busy background.
            </p>
            <a href="/press/swiftcard-logo-512.png" download className="text-brand underline">Download PNG (512 px)</a>
          </div>
        </div>

        <H2>Screenshots</H2>
        <P>The current App Store screenshots. Free to use in coverage of SwiftCard.</P>
        <ul className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-4">
          {SCREENSHOTS.map((s) => (
            <li key={s.file} className="flex flex-col gap-2">
              <a href={`/press/${s.file}`} target="_blank" rel="noopener" className="block rounded-2xl overflow-hidden border border-slate-200/80 bg-white">
                {/* Plain <img>: static marketing assets, one size, no srcset needed. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/press/${s.file}`} alt={s.caption} width={720} height={1564} loading="lazy" className="w-full h-auto block" />
              </a>
              <p className="text-slate-500 text-[0.8125rem] leading-snug">{s.caption}</p>
            </li>
          ))}
        </ul>
        <p className="text-slate-600 text-[0.96875rem] leading-[1.75]">
          <a href="/press/swiftcard-press-kit.zip" download className="text-brand underline">Download the press kit (.zip)</a>
          {" "}— logo and all screenshots in one file.
        </p>

        {/* Boilerplate */}
        <H2>Boilerplate</H2>
        <P>
          SwiftCard is a digital business card, link-in-bio page and lead follow-up tool operated by
          Swift Card Inc in New York. Share your card by tap, QR code, Apple Wallet or link; the people
          you meet save it in one tap and can share their details back, and SwiftCard handles the
          follow-up. Available free at swiftcard.me and on the iOS App Store.
        </P>

        <H2>Links</H2>
        <ul className="mb-3">
          {[
            ["Website", APP_URL, "/"],
            ["Live demo card", `${APP_URL}/preview`, "/preview"],
            ["Card designs", `${APP_URL}/templates`, "/templates"],
            ["Company & legal", `${APP_URL}/company`, "/company"],
          ].map(([label, shown, href]) => (
            <li key={href} className="text-slate-600 text-[0.96875rem] leading-[1.75] mb-2 ml-5 list-disc marker:text-slate-400">
              {label}: <Link href={href} className="text-brand underline">{shown}</Link>
            </li>
          ))}
          {APP_STORE_URL ? (
            <li className="text-slate-600 text-[0.96875rem] leading-[1.75] mb-2 ml-5 list-disc marker:text-slate-400">
              App Store: <a href={APP_STORE_URL} className="text-brand underline" rel="noopener">{APP_STORE_URL}</a>
            </li>
          ) : null}
        </ul>

        <H2>Get in touch</H2>
        <P>
          For interviews, review access, partnership or speaking requests, email{" "}
          <a href="mailto:hello@swiftcard.me" className="text-brand underline">hello@swiftcard.me</a>.
          We reply to press within one business day.
        </P>
      </div>

      <SiteFooterMini extra={[{ label: "Company", href: "/company" }]} />
    </main>
  );
}
