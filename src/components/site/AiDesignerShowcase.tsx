"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import CardScaler from "@/components/CardScaler";
import Eyebrow from "@/components/site/Eyebrow";
import { FreeCard } from "@/components/card-templates/CustomCard";
import {
  DEMO_HEADSHOT, SAMPLE_DATA_WITH_PHOTO, withoutSocials,
  type AiDesignBrief, type CardData, type CustomLayout,
} from "@/components/card-templates/types";
import { AI_THEMES, buildDesign, fallbackSpec, type AiTheme, type DesignContext } from "@/lib/ai-card-design";
import "@/app/home.css";

// ── The AI Card Designer, shown on /templates ────────────────────────────────
//
// Every card here is a REAL design: the same pure engine the product runs
// (lib/ai-card-design: fallbackSpec → buildDesign) drawn by the same renderer
// (FreeCard). Nothing is fetched and no model is called — the marketing page
// shows exactly what the designer produces for a theme and two colours, with
// the site's demo persona on it.
//
// Two capabilities, two panels:
//   • Create with AI — a brief (headshot, logo, colours, theme) and the card
//     it becomes; three briefs cycle so the range is visible without a click.
//   • Recreate a design — a card someone ELSE owns, "uploaded", and the same
//     design carrying the demo persona's details. Same layout object, two
//     data sets: that is literally what the feature does.
//
// The feature itself is Pro and lives in Edit card → Card design → Custom
// design. The CTA is one "Get Started" into the free builder, where the card
// is made first (owner, 2026-09-25: no pricing line under it). It also keeps
// the page sell-free for the iOS shell with nothing to hide.

const DEMO_LOGO = "/marketing/demo-logo.svg";
const DEMO: CardData = { ...withoutSocials(SAMPLE_DATA_WITH_PHOTO), logoUrl: DEMO_LOGO };

function contextFor(d: CardData): DesignContext {
  return {
    name: d.name, title: d.title, company: d.company, phone: d.phone, email: d.email,
    website: d.website ?? "", address: d.address ?? "",
    hasPhoto: !!d.photoUrl, hasLogo: !!d.logoUrl,
  };
}

function design(theme: AiTheme, colors: string[], ctx: DesignContext, opts: { headshot: boolean; logo: boolean; variant?: number }): CustomLayout {
  const brief: AiDesignBrief = { theme, colors, headshot: opts.headshot, logo: opts.logo, variant: opts.variant ?? 0 };
  return buildDesign(fallbackSpec(brief), ctx, brief);
}

// ── Create with AI: three briefs, three finished cards ──────────────────────

// Variants chosen from a contact sheet of every theme × variant (2026-09-24):
// the three cleanest compositions the engine makes with a photo AND a logo on.
const BRIEFS: { theme: AiTheme; colors: [string, string]; variant?: number }[] = [
  { theme: "modern", colors: ["#1e3a8a", "#4da8f5"], variant: 3 },  // photo-right
  { theme: "luxury", colors: ["#0c0a09", "#c9a96e"], variant: 1 },  // centered
  { theme: "creative", colors: ["#7c3aed", "#ec4899"], variant: 0 }, // orb-corner
];
const DESIGNS = BRIEFS.map((b) => ({
  ...b,
  label: AI_THEMES.find((t) => t.key === b.theme)?.label ?? b.theme,
  layout: design(b.theme, b.colors, contextFor(DEMO), { headshot: true, logo: true, variant: b.variant }),
}));
const CYCLE_MS = 4500;

// ── Recreate a design: cards other people own, then the same design as yours ─
//
// Deliberately NOT the demo persona: each of these is a card the visitor
// "found" — a screenshot from the web, a photo of a printed card — so it has
// to belong to someone else for the point to land. The result is the SAME
// brief built for the demo persona: same composition, same palette, same
// type — their look, your details. The found card's logo is a monogram drawn
// here (a data URI), so no real company's mark is ever on the page.

function monogram(text: string, bg: string, fg: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="22" fill="${bg}"/><text x="50" y="50" dy=".36em" text-anchor="middle" font-family="Georgia, serif" font-size="46" font-weight="700" fill="${fg}">${text}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

type Found = { data: CardData; theme: AiTheme; colors: string[]; variant: number };
const FOUND: Found[] = [
  {
    data: { ...DEMO, name: "Jordan Ellis", title: "Principal Architect", company: "Ellis & Rowe", phone: "(212) 555-0142", email: "jordan@ellisrowe.com", website: "ellisrowe.com", address: "", initials: "JE", photoUrl: null, logoUrl: monogram("ER", "#1f2a44", "#faf7f2"), cardUrl: "swiftcard.me/jordanellis" },
    theme: "classic", colors: [], variant: 2, // split-panel, cream and navy
  },
  {
    data: { ...DEMO, name: "Priya Nair", title: "Founder & CEO", company: "Nair Labs", phone: "(650) 555-0117", email: "priya@nairlabs.io", website: "nairlabs.io", address: "", initials: "PN", photoUrl: null, logoUrl: monogram("N", "#22d3ee", "#0b1120"), cardUrl: "swiftcard.me/priyanair" },
    theme: "tech", colors: ["#0b1120", "#22d3ee"], variant: 0, // diagonal, cyan on ink
  },
  {
    data: { ...DEMO, name: "Marcus Lee", title: "Landscape Designer", company: "Fern & Field", phone: "(503) 555-0163", email: "marcus@fernandfield.com", website: "fernandfield.com", address: "", initials: "ML", photoUrl: null, logoUrl: monogram("F", "#c8b27a", "#1f3a2d"), cardUrl: "swiftcard.me/marcuslee" },
    theme: "nature", colors: [], variant: 0, // orb-corner, forest green
  },
];
// The result keeps the found card's shape: no headshot where it had none, and
// the demo logo where its monogram was.
const RECREATIONS = FOUND.map((f) => ({
  source: f.data,
  found: design(f.theme, f.colors, contextFor(f.data), { headshot: false, logo: true, variant: f.variant }),
  yours: design(f.theme, f.colors, contextFor({ ...DEMO, photoUrl: null }), { headshot: false, logo: true, variant: f.variant }),
}));

// ── Small pieces ────────────────────────────────────────────────────────────

function Ico({ d, className = "w-5 h-5" }: { d: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

function Sparkle({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
      <path d="M12 2l2.2 7.8L22 12l-7.8 2.2L12 22l-2.2-7.8L2 12l7.8-2.2z" />
    </svg>
  );
}

/** A card as a picture: inert, no pointer events (the demo persona's links must never be live). */
function Still({ data, layout, className = "" }: { data: CardData; layout: CustomLayout; className?: string }) {
  return (
    <div inert className={className} style={{ pointerEvents: "none" }}>
      <CardScaler>
        <FreeCard data={data} layout={layout} />
      </CardScaler>
    </div>
  );
}

function PanelHead({ icon, title, blurb }: { icon: string; title: string; blurb: string }) {
  return (
    <div className="flex items-start gap-3.5">
      <span className="hp-ai-ico" aria-hidden="true"><Ico d={icon} /></span>
      <div className="min-w-0">
        <h3 className="text-slate-900 font-semibold text-[1.125rem] leading-tight">{title}</h3>
        <p className="text-slate-500 text-[0.9375rem] mt-1 leading-relaxed">{blurb}</p>
      </div>
    </div>
  );
}

// ── The cycling card: three real designs, one on top at a time ─────────────
// Shared by the Templates page's Create panel and the homepage strip.

/** Cycle while on screen, the tab is visible, motion is welcome, and the visitor hasn't picked one. */
function useDesignCycle(count: number) {
  const [idx, setIdx] = useState(0);
  const [paused, setPaused] = useState(false);
  const [live, setLive] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || !("IntersectionObserver" in window)) { setLive(true); return; }
    const io = new IntersectionObserver((entries) => setLive(entries.some((e) => e.isIntersecting)), { threshold: 0.35 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!live || paused) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (still) return;
    const id = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      setIdx((i) => (i + 1) % count);
    }, CYCLE_MS);
    return () => window.clearInterval(id);
  }, [live, paused, count]);

  const pick = (i: number) => { setIdx(i); setPaused(true); };
  return { ref, idx, pick };
}

function DesignCycler({ className = "" }: { className?: string }) {
  const { ref, idx, pick } = useDesignCycle(DESIGNS.length);
  const active = DESIGNS[idx];
  return (
    <div ref={ref} className={`flex flex-col ${className}`.trim()}>
      {/* The brief: what the owner gives it, as one quiet row. */}
      <div className="hp-ai-brief" aria-label="What you give it">
        <span className="hp-ai-brief-item">
          <span className="flex -space-x-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={DEMO_HEADSHOT} alt="" loading="lazy" decoding="async" className="w-7 h-7 rounded-full object-cover ring-2 ring-white" />
            {/* The demo mark is white (it ships on Logo First's navy), so it sits on a navy plate here too. */}
            <span className="w-7 h-7 rounded-full grid place-items-center overflow-hidden ring-2 ring-white" style={{ background: "#1e3a8a" }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={DEMO_LOGO} alt="" loading="lazy" decoding="async" className="w-4 h-4 object-contain" />
            </span>
          </span>
          Headshot &amp; logo
        </span>
        <span className="hp-ai-brief-item">
          <span className="flex -space-x-1">
            {active.colors.map((c, i) => (
              <span key={i} className="hp-ai-swatch" style={{ background: c }} />
            ))}
          </span>
          Colors
        </span>
        <span className="hp-ai-brief-item">
          <span className="hp-ai-chip">{active.label}</span>
          Style
        </span>
        <span className="hp-ai-generate" aria-hidden="true">
          <Sparkle className="w-3 h-3" /> Generate
        </span>
      </div>

      {/* The result. */}
      <div className="hp-ai-stage flex-1 flex flex-col justify-center mt-4">
        {/* Capped at the card's natural width: CardScaler never scales up, so a wider box is just empty stage. */}
        <div className="relative w-full max-w-[460px] mx-auto" style={{ aspectRatio: "460 / 263" }}>
          {DESIGNS.map((d, i) => (
            <div key={d.theme} className={`hp-ai-slide absolute inset-0 ${i === idx ? "is-on" : ""}`} aria-hidden={i !== idx}>
              <Still data={DEMO} layout={d.layout} />
            </div>
          ))}
        </div>
      </div>
      <Dots items={DESIGNS.map((d) => ({ key: d.theme, label: `${d.label} design` }))} idx={idx} pick={pick} label="Example designs" />
    </div>
  );
}

// ── Panel A ─────────────────────────────────────────────────────────────────

function CreatePanel() {
  return (
    <div className="hp-ai-panel" data-reveal>
      <div className="hp-ai-panel-in">
        <PanelHead
          icon="M12 3l1.8 4.6L18.5 9l-4.7 1.6L12 15l-1.8-4.4L5.5 9l4.7-1.4zM5 17l.9 2.1L8 20l-2.1.9L5 23l-.9-2.1L2 20l2.1-.9zM19 15l.7 1.6 1.6.7-1.6.7L19 19.6l-.7-1.6-1.6-.7 1.6-.7z"
          title="Create with AI"
          blurb="Your headshot, logo, colors and a style. AI does the rest."
        />
        <DesignCycler className="flex-1 mt-6" />
      </div>
    </div>
  );
}

// ── Panel B ─────────────────────────────────────────────────────────────────

function Dots({ items, idx, pick, label }: { items: { key: string; label: string }[]; idx: number; pick: (i: number) => void; label: string }) {
  return (
    <div className="mt-4 flex items-center justify-center gap-2" role="group" aria-label={label}>
      {items.map((d, i) => (
        <button
          key={d.key}
          type="button"
          onClick={() => pick(i)}
          aria-label={d.label}
          aria-pressed={i === idx}
          className="hp-ai-dot"
          data-on={i === idx ? "" : undefined}
        />
      ))}
    </div>
  );
}

function RecreatePanel() {
  const { ref, idx, pick } = useDesignCycle(RECREATIONS.length);
  return (
    <div className="hp-ai-panel" data-reveal style={{ transitionDelay: "90ms" }}>
      <div className="hp-ai-panel-in">
        <PanelHead
          icon="M4 7V5a1 1 0 011-1h2M17 4h2a1 1 0 011 1v2M20 17v2a1 1 0 01-1 1h-2M7 20H5a1 1 0 01-1-1v-2M7 9h10M7 12h6M7 15h8"
          title="Copy any card, exactly"
          blurb="The card you already have, or one you found and want. Snap or screenshot it and AI rebuilds that exact design with your details."
        />

        <div ref={ref} className="flex-1 flex flex-col mt-6">
          <div className="hp-ai-stage flex-1 flex flex-col items-center justify-center gap-3">
            {/* What they found: someone else's card, as a photo, with the scan light. */}
            <div className="w-full max-w-[340px] px-2">
              <div className="hp-ai-photo">
                <div className="relative" style={{ aspectRatio: "460 / 263" }}>
                  {RECREATIONS.map((r, i) => (
                    <div key={r.source.name} className={`hp-ai-slide absolute inset-0 ${i === idx ? "is-on" : ""}`} aria-hidden={i !== idx}>
                      <Still data={r.source} layout={r.found} />
                    </div>
                  ))}
                </div>
                <span className="hp-ai-scan" aria-hidden="true" />
              </div>
            </div>

            <div className="flex items-center justify-center text-blue-600" aria-hidden="true">
              <span className="hp-ai-arrow">
                <Sparkle className="w-3 h-3 hp-ai-arrow-spark" />
                <Ico d="M12 5v14M6 13l6 6 6-6" className="w-5 h-5" />
              </span>
            </div>

            {/* The same design, now theirs. */}
            <div className="relative w-full max-w-[340px] px-2">
              <div className="relative" style={{ aspectRatio: "460 / 263" }}>
                {RECREATIONS.map((r, i) => (
                  <div key={r.source.name} className={`hp-ai-slide absolute inset-0 ${i === idx ? "is-on" : ""}`} aria-hidden={i !== idx}>
                    <Still data={{ ...DEMO, photoUrl: null }} layout={r.yours} />
                  </div>
                ))}
              </div>
              <span className="hp-ai-file hp-ai-file-you" aria-hidden="true">
                <Sparkle className="w-3 h-3" /> Yours
              </span>
            </div>
          </div>
          <Dots items={RECREATIONS.map((r) => ({ key: r.source.name, label: `${r.source.company} card, rebuilt for you` }))} idx={idx} pick={pick} label="Example recreations" />
        </div>
      </div>
    </div>
  );
}

// ── The homepage block ──────────────────────────────────────────────────────
// Under the template gallery in the Swift Cards section: the same two panels
// as the Templates page, a heading, and the way in. No pricing link here —
// tests/native-suppression pins the homepage to none.

export function AiDesignerTeaser() {
  return (
    <div className="border-t border-slate-200 pt-20 sm:pt-24">
      <div className="max-w-2xl mx-auto text-center" data-hp-head>
        <Eyebrow dark={false}>AI Card Designer</Eyebrow>
        <h3 className="rd-h2 text-[clamp(2rem,4vw,3.1rem)] text-slate-900 mt-4">
          Or let AI <span className="hp-fill">design it.</span>
        </h3>
        <p className="hp-lede mt-4">
          Give it your headshot, logo and colors and get a polished card in seconds.
          Or have it copy the exact business card you want, or the one you already have.
        </p>
      </div>
      <div className="mt-12 grid lg:grid-cols-2 gap-5">
        <CreatePanel />
        <RecreatePanel />
      </div>
      <div className="mt-10 flex justify-center" data-reveal>
        <Link href="/cards/new" className="rd-btn rd-btn-primary">Create your free card</Link>
      </div>
    </div>
  );
}

// ── The flow ────────────────────────────────────────────────────────────────

const STEPS = [
  { t: "Details or inspiration", d: "Headshot, logo, colors, style — or a card to copy exactly.", icon: "M4 5h16v14H4zM4 15l4-4 3 3 4-5 5 6M16 8h.01" },
  { t: "AI designs it", d: "A polished card in seconds.", icon: "M12 3l1.8 4.6L18.5 9l-4.7 1.6L12 15l-1.8-4.4L5.5 9l4.7-1.4zM5 17l.9 2.1L8 20l-2.1.9L5 23l-.9-2.1L2 20l2.1-.9z" },
  { t: "Customize", d: "Move, resize, restyle anything.", icon: "M4 20h4l10.5-10.5a2.1 2.1 0 00-3-3L5 17v3zM13 7l3 3" },
  { t: "Publish", d: "Live at your link, ready to share.", icon: "M12 16V4m0 0l-4 4m4-4l4 4M4 14v4a2 2 0 002 2h12a2 2 0 002-2v-4" },
];

export default function AiDesignerShowcase() {
  return (
    // The top of /templates (its old "Your card, your way" hero was removed,
    // owner 2026-09-25), so this carries the page's h1 and clears the fixed nav.
    <section id="ai-designer" className="hp-ai hp-page-hero relative overflow-hidden bg-white pt-28 sm:pt-36 pb-16 sm:pb-24 scroll-mt-16" aria-labelledby="ai-designer-heading">
      <div className="relative max-w-6xl mx-auto px-5 sm:px-6">
        <div className="max-w-2xl mx-auto text-center" data-hp-head>
          <Eyebrow dark={false}>AI Card Designer</Eyebrow>
          <h1 id="ai-designer-heading" className="rd-h2 text-[clamp(2.2rem,5vw,3.6rem)] text-slate-900 mt-4">
            Your card, <span className="hp-fill">designed by AI.</span>
          </h1>
          <p className="hp-lede mt-4">
            Give it your details and get a polished card in seconds. Or have it copy the exact business card you want, or the one you already have.
          </p>
        </div>

        <div className="mt-12 sm:mt-16 grid lg:grid-cols-2 gap-5">
          <CreatePanel />
          <RecreatePanel />
        </div>

        {/* Four steps on one track — the homepage's "How it works" line and nodes. */}
        <div className="hp-track hp-track-4 hidden md:grid grid-cols-4 mt-16" aria-hidden="true">
          <div className="hp-track-line" />
          {[1, 2, 3, 4].map((n) => (
            <div key={n} className="flex justify-center"><span className="hp-node">{n}</span></div>
          ))}
        </div>
        <ol className="mt-8 md:mt-6 grid sm:grid-cols-2 md:grid-cols-4 gap-4">
          {STEPS.map((s, i) => (
            <li key={s.t} className="hp-ai-step" data-reveal style={{ transitionDelay: `${i * 90}ms` }}>
              <div className="flex items-center gap-2.5">
                <span className="hp-step-num md:hidden">{i + 1}</span>
                <span className="hp-feat-ico text-blue-600" aria-hidden="true"><Ico d={s.icon} /></span>
              </div>
              <p className="text-slate-900 font-semibold text-[1rem] mt-3.5">{s.t}</p>
              <p className="text-slate-500 text-[0.9rem] mt-1 leading-relaxed">{s.d}</p>
            </li>
          ))}
        </ol>

        <div className="mt-12 flex justify-center" data-reveal="fade">
          <Link href="/cards/new" className="rd-btn rd-btn-primary rd-btn-lg">Get Started</Link>
        </div>
      </div>
    </section>
  );
}
