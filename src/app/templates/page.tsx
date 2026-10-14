"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import SiteNav from "@/components/site/SiteNav";
import SiteFooter from "@/components/site/SiteFooter";
import CardScaler from "@/components/CardScaler";
import ClassicPro from "@/components/card-templates/ClassicPro";
import ModernBold from "@/components/card-templates/ModernBold";
import PhotoFirst from "@/components/card-templates/PhotoFirst";
import LocalBusiness from "@/components/card-templates/LocalBusiness";
import LuxuryMinimal from "@/components/card-templates/LuxuryMinimal";
import LogoFirst from "@/components/card-templates/LogoFirst";
import { SAMPLE_DATA_WITH_PHOTO, withoutSocials } from "@/components/card-templates/types";
import HomeHeadingReveal from "@/components/site/HomeHeadingReveal";
import ScrollReveal from "@/components/ScrollReveal";
import Eyebrow from "@/components/site/Eyebrow";
import AiDesignerShowcase from "@/components/site/AiDesignerShowcase";
import { QrAsImages } from "@/components/card-templates/qr-render-mode";
import "@/app/home.css";

const TEMPLATES = [
  {
    id: "classic-pro",
    name: "Classic Professional",
    tagline: "Clean, trustworthy, and timeless.",
    bestFor: ["Consulting", "Law", "Finance", "Real Estate"],
    Component: ClassicPro,
  },
  {
    id: "modern-bold",
    name: "Modern Bold",
    tagline: "High contrast, strong presence.",
    bestFor: ["Tech", "Architecture", "Design", "Finance"],
    Component: ModernBold,
  },
  {
    id: "photo-first",
    name: "Photo First",
    tagline: "Personal and approachable. Face-forward.",
    bestFor: ["Coaching", "Real Estate", "Sales", "Personal Brand"],
    Component: PhotoFirst,
  },
  {
    id: "local-business",
    name: "Local Business",
    tagline: "Easy to scan. Built for trades and services.",
    bestFor: ["Contractors", "Barbers", "Nail Techs", "Restaurants"],
    Component: LocalBusiness,
  },
  {
    id: "luxury-minimal",
    name: "Luxury Minimal",
    tagline: "Refined and elegant. Every detail considered.",
    bestFor: ["Luxury Real Estate", "Interior Design", "Jewelry", "Spa"],
    Component: LuxuryMinimal,
  },
  {
    id: "logo-first",
    name: "Logo First",
    tagline: "Leads with your mark, not your face.",
    bestFor: ["Agencies", "Firms", "Contractors", "Funds"],
    Component: LogoFirst,
    // Its own data, rather than adding a logo to the shared sample: Classic Pro
    // and Local Business both render a logo too, so putting one on the shared
    // object would silently redesign the five cards already on this page.
    data: { ...withoutSocials(SAMPLE_DATA_WITH_PHOTO), logoUrl: "/marketing/demo-logo.svg" },
  },
] as const;

export default function TemplatesPage() {
  const router = useRouter();
  const [selected, setSelected] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem("kontact_template");
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time hydration read from localStorage
    if (stored) setSelected(stored);
  }, []);

  function handleSelect(id: string) {
    setSelected(id);
    setSaved(false);
  }

  // "Apply this design" starts the real card builder on this template —
  // the same destination as every "Create your free card" button. It used to
  // PATCH /api/profile, which silently did nothing for the signed-out visitors
  // who now reach this page, and gave signed-in ones no next step either.
  function handleApply() {
    if (!selected) return;
    localStorage.setItem("kontact_template", selected);
    setSaved(true);
    router.push(`/cards/new?template=${encodeURIComponent(selected)}`);
  }

  const selectedTemplate = TEMPLATES.find((t) => t.id === selected);

  return (
    // Light page (owner, 2026-09-17: "take away the dark backgrounds"). The
    // card previews keep their own look; only the page around them is light.
    // hp-soft on main so the pb-28 that clears the sticky bar matches the footer.
    // QrAsImages: six template cards plus the AI designer's, each with a QR —
    // as inline SVG that was most of this page's 1.17 MB (SEO audit 2026-10-14).
    <QrAsImages>
    <main className="hp hp-soft min-h-screen pb-28">
      {/* The standard site header, so this page can be navigated away from
          anywhere — it replaced a lone history-back button, which was a dead
          end for anyone arriving from a link or the footer. */}
      <SiteNav />
      <HomeHeadingReveal />
      {/* data-reveal needs the site-wide observer; only the headings had one here. */}
      <ScrollReveal />

      {/* The AI Card Designer opens the page: two capabilities and the
          four-step flow. Every card in it is a real design from the product's
          own engine. It carries the page's h1 — the "Your card, your way"
          hero that sat above it was removed (owner, 2026-09-25). */}
      <AiDesignerShowcase />

      {/* Templates — side by side so all six read at a glance (owner,
          2026-09-25: they used to be stacked one on top of the other). */}
      <section className="hp-soft pt-20 sm:pt-24 pb-16" aria-labelledby="templates-heading">
        <div className="max-w-6xl mx-auto px-5 sm:px-6">
          <div className="max-w-2xl mx-auto text-center" data-hp-head>
            <Eyebrow dark={false}>Templates</Eyebrow>
            <h2 id="templates-heading" className="rd-h2 text-[clamp(1.9rem,4vw,2.8rem)] text-slate-900 mt-4">Or start from <span className="hp-fill">a template.</span></h2>
            <p className="hp-lede mt-3">Six designer templates. Pick one and make it yours.</p>
          </div>

          <div className="mt-10 sm:mt-14 grid grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-6">
            {TEMPLATES.map((tmpl, i) => {
              const { Component } = tmpl;
              const isSelected = selected === tmpl.id;

              return (
                // One tile, one button: the whole tile selects. Same reason as
                // site/TemplateGallery: the preview is a real card with real
                // contact links, so it must not be a nest of controls inside
                // this one. One button, one name.
                // The reveal sits on a wrapper: its transform/transition rules
                // would otherwise override the tile's own hover lift and delay it.
                <div key={tmpl.id} data-reveal style={{ transitionDelay: `${(i % 3) * 70}ms` }}>
                  <button
                    type="button"
                    onClick={() => handleSelect(tmpl.id)}
                    aria-pressed={isSelected}
                    aria-label={`Choose the ${tmpl.name} template`}
                    className={`group w-full h-full text-left rounded-2xl sm:rounded-3xl bg-white p-2.5 sm:p-4 outline-none transition-[box-shadow,translate] duration-300 hover:-translate-y-1 focus-visible:ring-4 focus-visible:ring-blue-500/30 ${
                      isSelected
                        ? "ring-2 ring-blue-600 shadow-[0_24px_50px_-28px_rgba(29,63,184,0.55)]"
                        : "ring-1 ring-slate-900/[0.07] shadow-[0_18px_40px_-30px_rgba(11,16,34,0.35)] hover:shadow-[0_28px_56px_-30px_rgba(29,63,184,0.4)]"
                    }`}
                  >
                    <div
                      // inert, not aria-hidden: the preview holds real tel:/mailto:
                      // links, and aria-hidden over focusable content is its own
                      // violation. inert takes them out of BOTH the a11y tree and
                      // the tab order, which is what "this is a picture of a card"
                      // actually means.
                      inert
                      className="rounded-xl sm:rounded-2xl overflow-hidden"
                      style={{
                        // The card's phone/email/website are real tel:/mailto:/https:
                        // links. Inside the selector button they would swallow the
                        // click (tapping a contact row opened a mail client instead
                        // of choosing the template). Letting pointer events pass
                        // through makes the whole card select. Same as
                        // TemplateGallery's grid tiles.
                        pointerEvents: "none",
                      }}
                    >
                      <CardScaler>
                        <Component data={"data" in tmpl ? tmpl.data : withoutSocials(SAMPLE_DATA_WITH_PHOTO)} />
                      </CardScaler>
                    </div>

                    <div className="flex items-start gap-2 sm:gap-3 mt-2.5 sm:mt-4 px-0.5 sm:px-1">
                      <div className="min-w-0 flex-1">
                        <p className={`font-semibold text-[0.8125rem] sm:text-[1rem] leading-snug transition-colors ${isSelected ? "text-blue-700" : "text-slate-900"}`}>{tmpl.name}</p>
                        <p className="text-slate-500 text-[0.75rem] sm:text-[0.875rem] mt-0.5 leading-snug">{tmpl.tagline}</p>
                      </div>
                      {/* A radio mark, so "which one is chosen" reads at a glance. */}
                      <span
                        aria-hidden="true"
                        className={`shrink-0 mt-0.5 w-5 h-5 sm:w-6 sm:h-6 rounded-full grid place-items-center transition-colors ${
                          isSelected ? "bg-blue-600 text-white" : "ring-1 ring-inset ring-slate-300 text-transparent group-hover:ring-blue-400"
                        }`}
                      >
                        <svg viewBox="0 0 24 24" className="w-3 h-3 sm:w-3.5 sm:h-3.5" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round"><path d="M5 13l4 4L19 7" /></svg>
                      </span>
                    </div>

                    {/* Best-for tags: from a tablet up, where there is room for them. */}
                    <div className="hidden sm:flex flex-wrap gap-1.5 mt-3 px-1">
                      {tmpl.bestFor.map((tag) => (
                        <span
                          key={tag}
                          className="text-[0.6875rem] font-medium px-2.5 py-0.5 rounded-full bg-slate-50 text-slate-600 ring-1 ring-inset ring-slate-200"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Sticky bottom bar — appears when a template is selected */}
      {/* paddingBottom clears the iPhone home indicator — a flat py-4 left the
          Apply button sitting partly under it on notched devices. Same
          safe-area handling MobileNav and the preview CTA already use. */}
      {selected && (
        <div
          className="fixed bottom-0 left-0 right-0 px-5 pt-4"
          style={{
            background: "rgba(255,255,255,0.94)",
            backdropFilter: "blur(12px)",
            borderTop: "1px solid rgba(11,16,34,0.08)",
            boxShadow: "0 -12px 30px -18px rgba(11,16,34,0.25)",
            paddingBottom: "max(16px, env(safe-area-inset-bottom))",
          }}
        >
          {/* pr-14 on phones: the sales chat launcher is fixed in the bottom-right
              corner and sat on top of "Apply this design" there. From sm up
              the centred bar ends well left of it; data-chat-avoid makes the
              launcher yield if a short window ever puts them together. */}
          <div className="max-w-3xl mx-auto flex items-center justify-between gap-4 pr-14 sm:pr-0">
            <div className="min-w-0">
              <p className="text-slate-900 font-semibold text-sm truncate">{selectedTemplate?.name}</p>
              <p className="hidden sm:block text-slate-500 text-xs">{selectedTemplate?.tagline}</p>
            </div>
            <button
              onClick={handleApply}
              data-chat-avoid=""
              className="shrink-0 bg-blue-600 hover:bg-blue-500 text-white font-semibold px-6 py-2.5 rounded-full text-sm transition-colors"
            >
              {saved ? "Opening builder…" : "Apply this design →"}
            </button>
          </div>
        </div>
      )}

      {/* Footer too, so the page has the same way out as every other page. */}
      <SiteFooter />
    </main>
    </QrAsImages>
  );
}
