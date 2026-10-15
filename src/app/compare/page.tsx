import Link from "next/link";
import Eyebrow from "@/components/site/Eyebrow";
import SiteNav from "@/components/site/SiteNav";
import type { Metadata } from "next";
import SiteFooterMini from "@/components/site/SiteFooterMini";
import ScrollProgress from "@/components/ScrollProgress";
import ScrollReveal from "@/components/ScrollReveal";
import NativeHidden from "@/components/NativeHidden";
import HomeHeadingReveal from "@/components/site/HomeHeadingReveal";
import { itemListJsonLd, jsonLdScript } from "@/lib/brand";
import { VS_COMPETITORS } from "@/lib/compare/competitors";
import "@/app/home.css";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://swiftcard.me";

export const metadata: Metadata = {
  // ≤ 60 chars, set as-is so the layout template cannot lengthen it.
  title: { absolute: "SwiftCard vs Popl, Blinq, Linq, HiHello & Dot: Compared" },
  alternates: { canonical: "/compare" },
  description:
    "How SwiftCard compares to Popl, Blinq, Linq, HiHello, Dot and Linktree on price, lead capture and follow-up automation. Head-to-head pages and alternative guides.",
  openGraph: { title: "SwiftCard compared with Popl, Blinq, Linq, HiHello, Dot and Linktree", description: "Head-to-head pages and alternative guides, with sources and the places each rival is stronger.", url: `${APP_URL}/compare`, siteName: "SwiftCard" },
};

// pricing: this row states SwiftCard's OWN price. /compare was the one
// in-app surface still doing that — pricing, /upgrade and /checkout all
// suppress on native, and this page wrapped only its footer link while
// shipping the numbers in the table body. App Review 3.1.1 targets exactly
// that. Reachability is low (sitemap only, not in nav), which is why it was
// missed. Competitor prices are fine; it is OUR price Apple objects to.
type Row = { label: string; swiftcard: string; linktree: string; popl: string; blinq: string; pricing?: true };

// Every figure below is sourced from each competitor's own public pricing page
// as of publish — verify current pricing directly with them before switching,
// since plans and prices change. SwiftCard's numbers are the same ones live on /pricing.
const ROWS: Row[] = [
  { label: "Starting price", swiftcard: "Free", linktree: "Free (12% fee on sales)", popl: "Free", blinq: "Free" },
  { label: "Cheapest paid plan", pricing: true, swiftcard: "$4.99/mo", linktree: "$8/mo (Starter)", popl: "$7.99/mo (Pro)", blinq: "$9.99/mo, or $7.33/mo billed annually (Premium)" },
  { label: "Built-in lead CRM (notes, history, follow-ups)", swiftcard: "✓", linktree: "✗", popl: "Via 3rd-party integrations", blinq: "Via 3rd-party integrations" },
  { label: "Automated follow-up sequences (email + text)", swiftcard: "✓", linktree: "✗", popl: "Not listed", blinq: "Not listed" },
  { label: "NFC tap-to-share", swiftcard: "✓", linktree: "✗", popl: "✓", blinq: "✓" },
  { label: "Custom card designer", swiftcard: "✓ (Pro)", linktree: "N/A — link-in-bio, not a card", popl: "Limited", blinq: "✓" },
  { label: "Team/office pricing", pricing: true, swiftcard: "$3.99/seat/mo · min 2 seats", linktree: "N/A", popl: "Not published", blinq: "$6.99/user/mo, or $4.99 billed annually · min 5" },
];

// The two page families this hub links, each with a one-line summary. The
// head-to-head list is driven by lib/compare/competitors (one place to edit);
// the alternative pages keep their own copy in compare/[slug]/page.tsx.
const ALTERNATIVES: { slug: string; name: string; summary: string }[] = [
  { slug: "linktree", name: "Linktree", summary: "A link-in-bio page that also saves your card and captures the visitor's contact." },
  { slug: "popl", name: "Popl", summary: "Built-in email and text follow-up instead of wiring it through integrations." },
  { slug: "blinq", name: "Blinq", summary: "The card feeds a contacts list with notes, history and follow-up switched on per contact." },
  { slug: "hihello", name: "HiHello", summary: "Cards and signatures plus the follow-up layer HiHello does not focus on." },
  { slug: "mobilo", name: "Mobilo", summary: "Monthly pricing and a free plan that needs no hardware." },
  { slug: "linq", name: "Linq", summary: "One flat price and a link that looks like your name, without an enterprise rollout." },
  { slug: "dot", name: "Dot", summary: "Start free with no device to buy, and let the follow-up run itself." },
];

function Cell({ value, brand }: { value: string; brand?: boolean }) {
  // startsWith, not ===, so "✓ (Pro)" reads as a tick with a qualifier like it
  // already does on /compare/<slug>. On this page it fell through to the plain
  // text branch, so one row in the SwiftCard column showed a blue "✓ (Pro)"
  // while every other tick above and below it was green.
  const isCheck = value.startsWith("✓");
  const isCross = value === "✗";
  return (
    <td
      className={`px-4 py-4 text-sm text-center align-middle ${brand ? "font-semibold" : "text-slate-600"}`}
      style={brand ? { color: "#1D4ED8" } : undefined}
    >
      {/* The glyph carries meaning, so it needs a text equivalent and enough
          contrast to be seen: ✗ was slate-300 — about 1.6:1 on the white/cream
          rows, i.e. the "no" column was effectively blank. */}
      {isCheck ? (
        <span>
          <span aria-hidden="true" className="text-green-600 text-base">✓</span>
          <span className="sr-only">Yes</span>
          {value.length > 1 ? <span className="text-slate-500 text-xs"> {value.slice(1).trim()}</span> : null}
        </span>
      ) : isCross ? <><span aria-hidden="true" className="text-slate-500">✗</span><span className="sr-only">No</span></>
        : value}
    </td>
  );
}

const card = "rd-card-l px-5 py-4 block hover:border-slate-300 transition-colors";

export default function ComparePage() {
  const itemList = itemListJsonLd("SwiftCard comparison pages", [
    ...VS_COMPETITORS.map((c) => ({ name: `SwiftCard vs ${c.name}`, path: `/compare/swiftcard-vs-${c.slug}`, description: c.tldr })),
    ...ALTERNATIVES.map((a) => ({ name: `${a.name} alternative`, path: `/compare/${a.slug}-alternative`, description: a.summary })),
  ]);
  return (
    // bg-cream stays only for the native shell's status-bar canvas rule in
    // globals.css (html.native-app:has(main.bg-cream)); .hp paints the page
    // itself white (owner, 2026-09-17: light pages, no cream).
    <main className="hp sc-canvas-white min-h-screen bg-cream flex flex-col">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(itemList) }} />
      <ScrollProgress />
      <ScrollReveal />
      <HomeHeadingReveal />
      <SiteNav />

      <section className="hp-page-hero text-center px-5 sm:px-6 pt-28 sm:pt-36 pb-12">
        <div className="relative" data-hp-head>
          <div className="mb-4"><Eyebrow dark={false}>Comparison</Eyebrow></div>
          <h1 className="rd-display text-[clamp(2.1rem,4.4vw,3rem)] text-slate-900 mb-4 [text-wrap:balance]">SwiftCard vs Linktree, Popl &amp; Blinq</h1>
          <p className="hp-lede max-w-xl mx-auto mb-2">
            Looking for a Linktree alternative, or weighing Popl against Blinq? Here&apos;s how SwiftCard actually compares — real numbers, no spin.
          </p>
          <p className="text-slate-500 text-xs max-w-xl mx-auto">
            Competitor pricing/features sourced from their public pricing pages and subject to change — confirm current details directly with them.
          </p>
        </div>
      </section>

      <div className="hp-soft flex-1">
      <section className="max-w-4xl mx-auto w-full px-5 sm:px-6 pt-12 pb-16">
        {/* Phones: the table is wider than the screen, so say it swipes and
            fade the cut edge — without this the competitor columns are simply
            invisible on a phone (owner mobile pass, 2026-09-17). */}
        <p className="sm:hidden mb-2 flex items-center gap-1.5 text-[0.8125rem] font-medium text-slate-500">
          Swipe the table to compare
          <span aria-hidden="true">→</span>
        </p>
        <div className="relative">
        <div className="relative overflow-x-auto rounded-3xl border border-slate-200 bg-white shadow-[0_18px_40px_-28px_rgba(15,23,42,0.3)]">
          <table className="w-full border-collapse min-w-[640px]">
            <thead>
              <tr className="border-b border-slate-200">
                <th className="px-4 py-4 text-left text-sm font-semibold text-slate-900 w-1/3">&nbsp;</th>
                <th className="px-4 py-4 text-sm font-bold text-center" style={{ color: "#1D4ED8" }}>SwiftCard</th>
                <th className="px-4 py-4 text-sm font-semibold text-slate-500 text-center">Linktree</th>
                <th className="px-4 py-4 text-sm font-semibold text-slate-500 text-center">Popl</th>
                <th className="px-4 py-4 text-sm font-semibold text-slate-500 text-center">Blinq</th>
              </tr>
            </thead>
            <tbody>
              {ROWS.map((row, i) => {
                const tr = (
                  <tr key={row.label} className={i % 2 === 1 ? "bg-[#F5F7FB]" : ""}>
                    <td className="px-4 py-4 text-sm font-medium text-slate-700">{row.label}</td>
                    <Cell value={row.swiftcard} brand />
                    <Cell value={row.linktree} />
                    <Cell value={row.popl} />
                    <Cell value={row.blinq} />
                  </tr>
                );
                // Rows quoting OUR price are dropped inside the native shell.
                return row.pricing ? <NativeHidden key={row.label}>{tr}</NativeHidden> : tr;
              })}
            </tbody>
          </table>
        </div>
        {/* the cut edge, faded so it reads as "there is more" */}
        <span className="sm:hidden pointer-events-none absolute inset-y-0 right-0 w-10 rounded-r-3xl" style={{ background: "linear-gradient(90deg, rgba(255,255,255,0) 0%, #ffffff 92%)" }} aria-hidden="true" />
        </div>

        <div className="mt-8 max-w-2xl mx-auto text-center">
          <p className="text-slate-600 text-sm leading-relaxed mb-2">
            <strong className="text-slate-900">Linktree</strong>{" "}is built for link-in-bio, not lead capture — it doesn&apos;t have a contacts CRM
            or follow-up automation because that&apos;s not what it&apos;s for.
          </p>
          <p className="text-slate-600 text-sm leading-relaxed mb-2">
            <strong className="text-slate-900">Popl</strong> and <strong className="text-slate-900">Blinq</strong> both do NFC sharing and CRM
            <em> integrations</em>{" "}well; neither lists built-in automated email + text follow-up on its official pages, so you&apos;d wire that up through a separate tool.
          </p>
          <p className="text-slate-600 text-sm leading-relaxed">
            SwiftCard bundles the card, the CRM, and the follow-up automation into one plan — no separate tools to connect.
          </p>
        </div>
      </section>
      </div>

      {/* Head to head — one page per rival for "SwiftCard vs X" searches. */}
      <section className="max-w-4xl mx-auto w-full px-5 sm:px-6 pt-16 pb-12">
        <div data-hp-head>
          <h2 className="rd-h2 text-[clamp(1.6rem,3.2vw,2.3rem)] text-slate-900 text-center mb-3 [text-wrap:balance]">Head to head</h2>
          <p className="text-slate-500 text-[0.9375rem] text-center max-w-xl mx-auto mb-8">Price, features and follow-up side by side, with where each rival is stronger and the sources we checked.</p>
        </div>
        <ul className="grid sm:grid-cols-2 gap-3 list-none p-0">
          {VS_COMPETITORS.map((c) => (
            <li key={c.slug}>
              <Link href={`/compare/swiftcard-vs-${c.slug}`} className={card}>
                <span className="text-slate-900 font-semibold text-[0.9375rem]">SwiftCard vs {c.name} →</span>
                <span className="block text-slate-500 text-[0.84375rem] mt-1 leading-relaxed">{c.hook.charAt(0).toUpperCase() + c.hook.slice(1)}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {/* Alternative guides — each owns one "<x> alternative" query. */}
      <div className="hp-soft">
      <section className="max-w-4xl mx-auto w-full px-5 sm:px-6 pt-14 pb-16">
        <div data-hp-head>
          <h2 className="rd-h2 text-[clamp(1.6rem,3.2vw,2.3rem)] text-slate-900 text-center mb-3 [text-wrap:balance]">Looking for an alternative?</h2>
          <p className="text-slate-500 text-[0.9375rem] text-center max-w-xl mx-auto mb-8">Why people switch, and how to move your card and contacts over.</p>
        </div>
        <ul className="grid sm:grid-cols-2 gap-3 list-none p-0">
          {ALTERNATIVES.map((a) => (
            <li key={a.slug}>
              <Link href={`/compare/${a.slug}-alternative`} className={card}>
                <span className="text-slate-900 font-semibold text-[0.9375rem]">{a.name} alternative →</span>
                <span className="block text-slate-500 text-[0.84375rem] mt-1 leading-relaxed">{a.summary}</span>
              </Link>
            </li>
          ))}
        </ul>

        <div className="mt-10 text-center flex flex-wrap justify-center gap-3">
          <Link href="/cards/new" className="rd-btn rd-btn-primary rd-btn-lg">
            Try SwiftCard free →
          </Link>
          <Link href="/faq" className="rd-btn rd-btn-lg border border-slate-200 bg-white text-slate-800 hover:border-slate-300">Read the FAQ</Link>
        </div>
      </section>
      </div>

      <SiteFooterMini />
    </main>
  );
}
