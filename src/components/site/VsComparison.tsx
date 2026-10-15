import Link from "next/link";
import Eyebrow from "@/components/site/Eyebrow";
import SiteNav from "@/components/site/SiteNav";
import SiteFooterMini from "@/components/site/SiteFooterMini";
import ScrollProgress from "@/components/ScrollProgress";
import ScrollReveal from "@/components/ScrollReveal";
import NativeHidden from "@/components/NativeHidden";
import HomeHeadingReveal from "@/components/site/HomeHeadingReveal";
import CompareTable from "@/components/site/CompareTable";
import { breadcrumbJsonLd, faqPageJsonLd, jsonLdScript, SOFTWARE_ID } from "@/lib/brand";
import { monthYear, ONE_LINER, rowsFor, type VsCompetitor } from "@/lib/compare/competitors";
import "@/app/home.css";

// ── /compare/swiftcard-vs-<x>: the head-to-head page ────────────────────────
//
// Same shell as the *-alternative pages (hero, table, cards, FAQ, chips), with
// a fixed section order chosen so an AI assistant can lift the answer on its
// own: H1 → TL;DR → table → where SwiftCard is stronger → where THEY are
// stronger → pricing → who each is for → switching → FAQ → CTA → sources
// line. The "where they are stronger" section is not optional: a page with no
// concession reads as an ad and gets neither trusted nor cited.
//
// Everything is rendered on the server; the FAQ uses <details> so the answer
// text is in the HTML. Pricing copy rides inside NativeHidden (App Review
// 3.1.1); the JSON-LD still carries it, Google reads the web page.

const chip = "text-[0.8125rem] text-slate-600 hover:text-slate-900 hover:border-slate-300 rounded-full px-3.5 py-1.5 bg-white border border-slate-200 transition-colors";

export default function VsComparison({ c }: { c: VsCompetitor }) {
  const slug = `swiftcard-vs-${c.slug}`;
  const src = `alt_vs_${c.slug}`;
  const when = monthYear(c.lastVerified);
  const rows = rowsFor(c);
  const faqNode = faqPageJsonLd(c.faq);
  const crumbs = breadcrumbJsonLd([
    { name: "Home", path: "" },
    { name: "Compare", path: "/compare" },
    { name: `SwiftCard vs ${c.name}`, path: `/compare/${slug}` },
  ]);
  // The page is ABOUT the product the homepage declares; reference its @id
  // rather than redeclaring a second SoftwareApplication node.
  const about = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    url: `${process.env.NEXT_PUBLIC_APP_URL || "https://swiftcard.me"}/compare/${slug}`,
    name: `SwiftCard vs ${c.name}`,
    about: { "@id": SOFTWARE_ID },
    dateModified: c.lastVerified,
  };

  return (
    <main className="hp sc-canvas-white min-h-screen bg-cream flex flex-col">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(faqNode) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(crumbs) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(about) }} />
      <ScrollProgress />
      <ScrollReveal />
      <HomeHeadingReveal />
      <SiteNav />

      {/* 1. H1 + 2. TL;DR */}
      <section className="hp-page-hero text-center px-5 sm:px-6 pt-28 sm:pt-36 pb-12">
        <div className="relative" data-hp-head>
          <nav aria-label="Breadcrumb" className="mb-4 text-[0.8125rem] text-slate-500">
            <Link href="/" className="hover:text-slate-900">Home</Link>
            <span aria-hidden="true" className="mx-1.5">›</span>
            <Link href="/compare" className="hover:text-slate-900">Compare</Link>
            <span aria-hidden="true" className="mx-1.5">›</span>
            <span className="text-slate-700">SwiftCard vs {c.name}</span>
          </nav>
          <div className="mb-4"><Eyebrow dark={false}>Head to head</Eyebrow></div>
          <h1 className="rd-display text-[clamp(2rem,4.2vw,2.9rem)] text-slate-900 mb-6 max-w-3xl mx-auto [text-wrap:balance]">
            SwiftCard vs {c.name}: {c.hook}
          </h1>
          <NativeHidden>
            <div className="max-w-2xl mx-auto rounded-2xl border border-slate-200 bg-white px-6 py-5 text-left shadow-[0_18px_40px_-28px_rgba(15,23,42,0.3)]">
              <p className="hp-kicker !text-[0.6875rem] mb-2">TL;DR</p>
              <p className="text-slate-700 text-[0.9375rem] leading-relaxed">{c.tldr}</p>
            </div>
          </NativeHidden>
          <p className="text-slate-500 text-xs max-w-xl mx-auto mt-5">
            {ONE_LINER} {c.name} facts come from {c.site} and its app store listings as of {when}.
          </p>
        </div>
      </section>

      {/* 3. Table */}
      <div className="hp-soft">
        <section className="max-w-3xl mx-auto w-full px-5 sm:px-6 pt-14 pb-16" aria-labelledby="table-h">
          <h2 id="table-h" className="rd-h2 text-[clamp(1.5rem,3vw,2rem)] text-slate-900 text-center mb-8 [text-wrap:balance]">SwiftCard vs {c.name} at a glance</h2>
          <CompareTable competitor={c.name} rows={rows} />
          <p className="text-slate-500 text-[0.8125rem] leading-relaxed max-w-2xl mx-auto text-center mt-6">
            &ldquo;Not listed&rdquo; means {c.name}&apos;s official pages do not say either way. It is not a no.
          </p>
        </section>
      </div>

      {/* 4. Where SwiftCard is stronger */}
      <section className="max-w-4xl mx-auto w-full px-5 sm:px-6 pt-16 pb-16">
        <div data-hp-head>
          <h2 className="rd-h2 text-[clamp(1.6rem,3.2vw,2.3rem)] text-slate-900 text-center mb-8 [text-wrap:balance]">Where SwiftCard is stronger</h2>
        </div>
        <div className="grid sm:grid-cols-2 gap-4">
          {c.swiftcardStronger.map((r) => (
            <div key={r.t} className="hp-card">
              <h3 className="text-slate-900 font-semibold text-[0.9375rem]">{r.t}</h3>
              <p className="text-slate-500 text-[0.84375rem] mt-1.5 leading-relaxed">{r.d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* 5. Where they are stronger */}
      <div className="hp-soft">
        <section className="max-w-4xl mx-auto w-full px-5 sm:px-6 pt-16 pb-16">
          <div data-hp-head>
            <h2 className="rd-h2 text-[clamp(1.6rem,3.2vw,2.3rem)] text-slate-900 text-center mb-8 [text-wrap:balance]">Where {c.name} is stronger</h2>
          </div>
          <div className="grid sm:grid-cols-3 gap-4">
            {c.theyStronger.map((r) => (
              <div key={r.t} className="hp-card">
                <h3 className="text-slate-900 font-semibold text-[0.9375rem]">{r.t}</h3>
                <p className="text-slate-500 text-[0.84375rem] mt-1.5 leading-relaxed">{r.d}</p>
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* 6. Pricing compared */}
      <NativeHidden>
        <section className="max-w-2xl mx-auto w-full px-5 sm:px-6 pt-16 pb-12">
          <h2 className="rd-h2 text-[clamp(1.5rem,3vw,2rem)] text-slate-900 text-center mb-5 [text-wrap:balance]">Pricing compared</h2>
          <p className="text-slate-600 text-[0.9375rem] leading-relaxed text-center">{c.pricing}</p>
          <p className="text-center mt-4 text-[0.875rem]">
            <Link href="/pricing" className="text-brand underline underline-offset-2">See SwiftCard pricing</Link>
          </p>
        </section>
      </NativeHidden>

      {/* 7. Who each is best for */}
      <section className="max-w-4xl mx-auto w-full px-5 sm:px-6 pt-8 pb-16">
        <h2 className="rd-h2 text-[clamp(1.5rem,3vw,2rem)] text-slate-900 text-center mb-8 [text-wrap:balance]">Who each is best for</h2>
        <div className="grid sm:grid-cols-2 gap-4">
          <div className="hp-card">
            <h3 className="font-semibold text-[0.9375rem]" style={{ color: "#1D4ED8" }}>SwiftCard is best for</h3>
            <ul className="mt-3 flex flex-col gap-2 text-slate-600 text-[0.875rem] leading-relaxed list-disc pl-5">
              {c.bestFor.swiftcard.map((s) => <li key={s}>{s}</li>)}
            </ul>
          </div>
          <div className="hp-card">
            <h3 className="font-semibold text-[0.9375rem] text-slate-700">{c.name} is best for</h3>
            <ul className="mt-3 flex flex-col gap-2 text-slate-600 text-[0.875rem] leading-relaxed list-disc pl-5">
              {c.bestFor.them.map((s) => <li key={s}>{s}</li>)}
            </ul>
          </div>
        </div>
      </section>

      {/* 8. Switching */}
      <div className="hp-soft">
        <section className="max-w-4xl mx-auto w-full px-5 sm:px-6 pt-16 pb-16">
          <div data-hp-head>
            <h2 className="rd-h2 text-[clamp(1.6rem,3.2vw,2.3rem)] text-slate-900 text-center mb-3 [text-wrap:balance]">Switching from {c.name}</h2>
            <p className="text-slate-500 text-[0.9375rem] text-center max-w-xl mx-auto mb-8">
              Your contacts are yours and your card is your own details. Most people are done in about fifteen minutes.
            </p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {c.switching.map((st, i) => (
              <div key={st.t} className="hp-card">
                <p className="hp-kicker !text-[0.6875rem] mb-2">STEP {i + 1}</p>
                <h3 className="text-slate-900 font-semibold text-[0.9375rem]">{st.t}</h3>
                <p className="text-slate-500 text-[0.84375rem] mt-1.5 leading-relaxed">{st.d}</p>
              </div>
            ))}
          </div>
          <p className="text-center mt-6 text-[0.875rem] text-slate-500">
            Prefer the other angle? Read <Link href={`/compare/${c.slug}-alternative`} className="text-brand underline underline-offset-2">why people choose SwiftCard as a {c.name} alternative</Link>.
          </p>
        </section>
      </div>

      {/* 9. FAQ — the JSON-LD above is generated from exactly this list. Real
          H3 headings, answers in the HTML via <details>. */}
      <section className="max-w-2xl mx-auto w-full px-6 pt-16 pb-14" aria-labelledby="faq-h">
        <h2 id="faq-h" className="rd-h2 text-[clamp(1.5rem,3vw,2rem)] text-slate-900 text-center mb-8 [text-wrap:balance]">SwiftCard vs {c.name}: common questions</h2>
        <div className="flex flex-col gap-3">
          {c.faq.map((f) => {
            const item = (
              <details key={f.q} className="rd-card-l group px-6 py-5" open>
                <summary className="cursor-pointer list-none flex items-center justify-between gap-4 -mx-6 -my-5 px-6 py-5">
                  <h3 className="text-slate-900 font-semibold text-[0.9375rem]">{f.q}</h3>
                  <span aria-hidden="true" className="text-ink-muted text-xl leading-none transition-transform group-open:rotate-45 shrink-0">+</span>
                </summary>
                <p className="text-ink-muted text-[0.875rem] mt-3 leading-relaxed">{f.a}</p>
              </details>
            );
            return f.pricing ? <NativeHidden key={f.q}>{item}</NativeHidden> : item;
          })}
        </div>
        {/* 10. CTA */}
        <div className="mt-10 text-center flex flex-wrap justify-center gap-3">
          <Link href={`/cards/new?src=${src}`} className="rd-btn rd-btn-primary rd-btn-lg">Start free →</Link>
          <NativeHidden>
            <Link href="/pricing" className="rd-btn rd-btn-lg border border-slate-200 bg-white text-slate-800 hover:border-slate-300">See pricing</Link>
          </NativeHidden>
        </div>
      </section>

      {/* Related pages — the internal links that keep this page crawlable */}
      <div className="hp-soft flex-1">
        <section className="max-w-3xl mx-auto w-full px-5 sm:px-6 pt-14 pb-10 text-center">
          <div className="mb-3"><Eyebrow dark={false}>Keep reading</Eyebrow></div>
          <div className="flex flex-wrap justify-center gap-2">
            <Link href={`/compare/${c.slug}-alternative`} className={chip}>{c.name} alternative</Link>
            <Link href="/compare" className={chip}>All comparisons</Link>
            <Link href="/faq" className={chip}>FAQ</Link>
            <NativeHidden><Link href="/pricing" className={chip}>Pricing</Link></NativeHidden>
            {c.productPages.map((p) => <Link key={p.slug} href={`/products/${p.slug}`} className={chip}>{p.label}</Link>)}
            {c.forPages.map((p) => <Link key={p.slug} href={`/for/${p.slug}`} className={chip}>For {p.label.toLowerCase()}</Link>)}
          </div>
          {/* 11. Sources line */}
          <p className="text-slate-500 text-xs leading-relaxed max-w-2xl mx-auto mt-10">
            Comparison based on publicly available information on {c.name}&apos;s website and app store listings as of {when}. Features and prices change; check {c.name}&apos;s site for current details. {c.name} is a trademark of its owner. SwiftCard is not affiliated with {c.name}.
          </p>
        </section>
      </div>

      <SiteFooterMini />
    </main>
  );
}
