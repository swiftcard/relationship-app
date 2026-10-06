"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { SwiftCardIcon } from "@/components/SwiftCardLogo";
import AppStoreBadge, { GooglePlayBadge } from "@/components/AppStoreBadge";
import { trackCta } from "@/lib/events";
import { useIsNativeApp } from "@/lib/platform";
import { resetMarketingSketch } from "@/lib/guest-reset";

// ── SwiftCard 2.0 marketing navigation ──────────────────────────────────────
// Floating graphite-glass bar: transparent over the dark hero, condenses into a
// blurred bar on scroll. Product / Solutions / Resources mega-dropdowns on
// desktop; full-screen sheet on mobile. Every link points at a real route.

type Item = { label: string; href: string; desc: string };

// "Home" is a plain button back to the front page — no dropdown/subheaders
// (owner decision, Jul 2026). Product pages live under Products/Solutions.
const PRODUCTS: Item[] = [
  { label: "Digital Cards", href: "/products/digital-cards", desc: "Your tap-to-share business card" },
  { label: "SwiftLinks", href: "/products/swiftlinks", desc: "One link for everything you are" },
  { label: "Swift Signature", href: "/products/email-signatures", desc: "A live card in every email" },
  { label: "Lead Capture", href: "/products/lead-capture", desc: "Turn every scan into a contact" },
];
const SOLUTIONS: Item[] = [
  { label: "Dashboard & Analytics", href: "/products/analytics", desc: "See who's viewing and reaching out" },
  { label: "Teams & Offices", href: "/products/teams", desc: "One brand across everyone" },
  { label: "Ways to share", href: "/products/wallet", desc: "Wallet, QR, and the share sheet" },
  { label: "Apple Watch", href: "/products/watch", desc: "Share from your wrist" },
  { label: "Integrations", href: "/products/integrations", desc: "Salesforce, GoHighLevel, Pipedrive & more" },
];
const RESOURCES: Item[] = [
  { label: "Preview", href: "/preview", desc: "Interact with a real SwiftCard" },
  { label: "Templates", href: "/templates", desc: "Beautiful, ready-to-use designs" },
  { label: "Why SwiftCard", href: "/testimonials", desc: "What SwiftCard does for people like you" },
  { label: "Contact Us", href: "/contact", desc: "Talk to the team" },
  { label: "Privacy", href: "/privacy", desc: "How we protect your data" },
];
// Mobile-only: Contact Us and Privacy get pulled out to stand on their own
// (alongside Home/Pricing) in the mobile sheet, so Resources there holds only
// the items that are genuinely "more to explore." Desktop's Resources
// dropdown is untouched and still lists all five.
const MOBILE_RESOURCES: Item[] = RESOURCES.filter((it) => it.label !== "Contact Us" && it.label !== "Privacy");

function Caret() {
  return (
    <svg viewBox="0 0 12 12" className="w-3 h-3 opacity-60 transition-transform duration-200 group-hover:rotate-180" fill="none" stroke="currentColor" strokeWidth={1.7}>
      <path d="M2.5 4.5L6 8l3.5-3.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Dropdown({ label, items }: { label: string; items: Item[] }) {
  // Opens on hover (desktop pointer) AND on click/keyboard — the CSS-only
  // hover version was unreachable by keyboard and by tap on touch laptops.
  const [pinned, setPinned] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!pinned) return;
    const onDocClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setPinned(false);
    };
    const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape") setPinned(false); };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onEsc);
    };
  }, [pinned]);

  return (
    <div ref={ref} className="group relative">
      <button
        onClick={() => setPinned((v) => !v)}
        aria-expanded={pinned}
        aria-haspopup="true"
        className="inline-flex items-center gap-1.5 px-3 py-2 text-[0.875rem] font-medium text-white/70 hover:text-white transition-colors"
      >
        {label}
        <Caret />
      </button>
      {/* hover bridge + panel — visible on group-hover OR when click-pinned */}
      <div className={`${pinned ? "visible opacity-100 translate-y-0" : "invisible opacity-0 translate-y-1"} group-hover:visible group-hover:opacity-100 group-hover:translate-y-0 transition-all duration-200 absolute left-1/2 -translate-x-1/2 top-full pt-3 w-[340px]`}>
        <div className="rounded-2xl border border-white/10 bg-[#0E1017]/95 backdrop-blur-xl p-2 shadow-[0_40px_80px_-32px_rgba(0,0,0,0.8)]">
          {items.map((it) => (
            <Link
              key={it.label}
              href={it.href}
              onClick={(e) => {
                setPinned(false);
                // "Overview" (href "/") should always land at the top of the
                // homepage. If we're already there, a same-route Link does
                // nothing — so scroll to top ourselves.
                if (it.href === "/" && window.location.pathname === "/") {
                  e.preventDefault();
                  window.scrollTo(0, 0);
                }
              }}
              className="flex items-start gap-3 rounded-xl px-3 py-2.5 hover:bg-white/[0.06] transition-colors"
            >
              <span className="mt-1.5 w-1.5 h-1.5 rounded-full shrink-0" style={{ background: "var(--rd-aurora)" }} />
              <span className="min-w-0">
                <span className="block text-[0.875rem] font-semibold text-white">{it.label}</span>
                <span className="block text-[0.78125rem] text-white/50 leading-snug">{it.desc}</span>
              </span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function SiteNav() {
  const [open, setOpen] = useState(false);
  // Mobile sheet only: Products/Solutions/Resources collapse into one
  // "Explore" accordion instead of three always-expanded lists, so Home,
  // Pricing, Privacy and Contact (the direct destinations) aren't buried
  // under a long scroll of dropdown categories.
  const [exploreOpen, setExploreOpen] = useState(false);
  const native = useIsNativeApp();

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    // This effect's job IS an external system (locking body scroll behind the
    // mobile sheet), the sanctioned use. Resetting the submenu rides along on
    // the same close so the sheet reopens collapsed rather than remembering a
    // section the user expanded minutes ago.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- rides along with the body-scroll lock
    if (!open) setExploreOpen(false);
    // Escape closes the sheet. The desktop dropdowns already did this; the
    // full-screen sheet — the one that locks body scroll and covers the page —
    // did not, so a keyboard user who opened it had no way out but Tab-to-X.
    if (!open) return () => { document.body.style.overflow = ""; };
    const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", onEsc);
    return () => {
      document.body.style.overflow = "";
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  return (
    <>
      {/* Always the dark glass state so the header is visible on every page,
          including light/cream sections at the very top. */}
      <header
        // sc-site-nav: marketing chrome. globals.css hides it outright inside
        // the native shell — an app does not carry a website's marketing header
        // with Products/Solutions/Resources dropdowns and a signup CTA. A CSS
        // rule rather than a `native` early-return so it is gone on the first
        // painted frame, with no flash and no hydration mismatch.
        className="sc-site-nav fixed top-0 inset-x-0 z-[70]"
        style={{
          background: "rgba(10,11,16,0.82)",
          backdropFilter: "saturate(1.4) blur(14px)",
          WebkitBackdropFilter: "saturate(1.4) blur(14px)",
          borderBottom: "1px solid var(--rd-line-dark)",
        }}
      >
        {/* px-4 on the smallest phones (320px): the logo + Get started + menu
            trigger together need every pixel, and px-5 pushed the trigger off
            the right edge. */}
        <nav className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
          <Link href="/" className="flex items-center gap-2.5 shrink-0">
            <SwiftCardIcon size={30} />
            <span className="text-white font-bold text-[0.9375rem] sm:text-[1.0625rem] tracking-tight">SwiftCard</span>
          </Link>

          <div className="hidden lg:flex items-center gap-1">
            <Link
              href="/"
              onClick={(e) => {
                // Heading Home drops the homepage-builder sketch. An unfinished
                // card is kept: the builder asks "Continue your card / Start a
                // new card" next time (see resetMarketingSketch).
                resetMarketingSketch();
                // Already on the homepage → a same-route Link no-ops, so scroll to top.
                if (window.location.pathname === "/") { e.preventDefault(); window.scrollTo({ top: 0, behavior: "smooth" }); }
              }}
              className="px-3 py-2 text-[0.875rem] font-medium text-white/70 hover:text-white transition-colors"
            >
              Home
            </Link>
            <Dropdown label="Products" items={PRODUCTS} />
            <Dropdown label="Solutions" items={SOLUTIONS} />
            <Dropdown label="Resources" items={RESOURCES} />
            {!native && <Link href="/pricing" className="px-3 py-2 text-[0.875rem] font-medium text-white/70 hover:text-white transition-colors">Pricing</Link>}
          </div>

          <div className="hidden lg:flex items-center gap-2.5 shrink-0">
            {/* Desktop only, and deliberately so: this cluster is `hidden
                lg:flex`, so the badge never reaches the mobile bar, where the
                logo + Get started + menu trigger already fill a 375px row and
                anything else either clips the trigger or forces the badge down
                to a bare icon. Phones get the hero badge beside "See how it
                works" instead. THE reference badge: every other one copies this
                look (owner, 2026-09-18); `sm` (120×40) to sit
                inside 64px. Ahead of Log in, behind Get started free — signing
                up keeps the last and strongest slot. */}
            <AppStoreBadge size="sm" />
            <GooglePlayBadge size="sm" />
            <Link href="/login" className="px-3.5 py-2 text-[0.875rem] font-medium text-white/75 hover:text-white transition-colors">Log in</Link>
            <Link href="/cards/new" className="rd-btn rd-btn-primary text-[0.875rem] px-4 py-2">Get started free</Link>
          </div>

          {/* Mobile: the primary CTA sits beside the menu trigger. This replaces
              the old sticky bottom bar — the action stays reachable on every
              scroll position without covering the page content. */}
          <div className="flex items-center gap-1.5 sm:gap-2 lg:hidden">
            <Link
              href="/cards/new"
              onClick={() => trackCta("create_your_card", "mobile_nav")}
              className="rd-btn rd-btn-primary text-[0.8125rem] px-3 sm:px-3.5 py-2 whitespace-nowrap"
            >
              Get started
            </Link>
            <button onClick={() => setOpen(true)} aria-label="Open menu" className="w-10 h-10 flex items-center justify-center rounded-xl text-white hover:bg-white/10 transition-colors">
              <svg viewBox="0 0 24 24" className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth={1.8}><path d="M4 7h16M4 12h16M4 17h16" strokeLinecap="round" /></svg>
            </button>
          </div>
        </nav>
      </header>

      {/* Mobile sheet */}
      {open && (
        <div className="fixed inset-0 z-[90] lg:hidden" role="dialog" aria-modal="true" aria-label="Site menu">
          <div className="absolute inset-0 bg-[#06070A]/80 backdrop-blur-xl" onClick={() => setOpen(false)} aria-hidden="true" />
          {/* Capped to the DYNAMIC viewport and laid out as a flex column: the
              links scroll, the header and the Log in / Get started row never do.
              Plain `vh` on iOS Safari measures the viewport with the toolbars
              retracted, so a taller-than-screen sheet pushed the buttons behind
              the Safari toolbar; dvh + a scrolling middle keeps them on screen.
              Bottom padding clears the home indicator. */}
          <div
            className="absolute inset-x-0 top-0 flex max-h-[100dvh] flex-col rounded-b-3xl border-b border-white/10 bg-[#0A0B10] p-5 pt-5 shadow-2xl animate-[sc-notif-in_.2s_ease]"
            style={{ paddingBottom: "calc(1.25rem + env(safe-area-inset-bottom))" }}
          >
            <div className="flex shrink-0 items-center justify-between mb-5">
              <Link href="/" onClick={() => setOpen(false)} className="flex items-center gap-2.5">
                <SwiftCardIcon size={28} /><span className="text-white font-bold text-[1rem]">SwiftCard</span>
              </Link>
              <button onClick={() => setOpen(false)} aria-label="Close" className="w-10 h-10 flex items-center justify-center rounded-xl text-white hover:bg-white/10">
                <svg viewBox="0 0 24 24" className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth={1.8}><path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" /></svg>
              </button>
            </div>
            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto rd-scrollbar-none">
              <Link
                href="/"
                onClick={() => {
                  // Same abandon-on-Home rule as the desktop link above.
                  resetMarketingSketch();
                  setOpen(false);
                  if (window.location.pathname === "/") window.scrollTo(0, 0);
                }}
                className="block rounded-xl px-3 py-2.5 text-[0.9375rem] font-medium text-white/85 hover:bg-white/[0.06]"
              >
                Home
              </Link>
              {/* Products / Solutions / Resources collapse into one "Explore"
                  accordion — collapsed by default — instead of three
                  always-expanded lists standing between Home and the direct
                  links below. */}
              <div>
                <button
                  type="button"
                  onClick={() => setExploreOpen((v) => !v)}
                  aria-expanded={exploreOpen}
                  className="w-full flex items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-[0.9375rem] font-medium text-white/85 hover:bg-white/[0.06] transition-colors"
                >
                  Explore
                  <svg viewBox="0 0 12 12" className={`w-3 h-3 opacity-60 transition-transform duration-200 ${exploreOpen ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth={1.7}>
                    <path d="M2.5 4.5L6 8l3.5-3.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
                {exploreOpen && (
                  <div className="mt-2 space-y-4">
                    {[["Products", PRODUCTS], ["Solutions", SOLUTIONS], ["Resources", MOBILE_RESOURCES]].map(([title, items]) => (
                      <div key={title as string}>
                        <p className="rd-eyebrow text-white/40 mb-2">{title as string}</p>
                        <div className="grid grid-cols-1 gap-0.5">
                          {(items as Item[]).map((it) => (
                            <Link
                              key={it.label}
                              href={it.href}
                              onClick={() => {
                                setOpen(false);
                                // Same as the desktop dropdown: "Overview" on the
                                // homepage scrolls to the top (a same-route Link no-ops).
                                if (it.href === "/" && window.location.pathname === "/") window.scrollTo(0, 0);
                              }}
                              className="flex items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-white/85 hover:bg-white/[0.06]"
                            >
                              {/* Both menus read the SAME items array, but this one
                                  rendered only `label` and dropped `desc` — so every
                                  subheader the desktop dropdown shows ("Apple Watch →
                                  Share from your wrist") was invisible on a phone.
                                  Same source, same words, on both. */}
                              <span className="min-w-0">
                                <span className="block text-[0.9375rem] font-medium">{it.label}</span>
                                <span className="block text-[0.78125rem] text-white/45 leading-snug mt-0.5">{it.desc}</span>
                              </span>
                              <svg viewBox="0 0 20 20" className="w-4 h-4 text-white/30 shrink-0" fill="currentColor"><path fillRule="evenodd" d="M7.3 4.3a1 1 0 011.4 0l5 5a1 1 0 010 1.4l-5 5a1 1 0 01-1.4-1.4L11.6 10 7.3 5.7a1 1 0 010-1.4z" clipRule="evenodd" /></svg>
                            </Link>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Direct destinations — always their own tappable row, never
                  nested inside the Explore accordion. */}
              {!native && <Link href="/pricing" onClick={() => setOpen(false)} className="block rounded-xl px-3 py-2.5 text-[0.9375rem] font-medium text-white/85 hover:bg-white/[0.06]">Pricing</Link>}
              <Link href="/privacy" onClick={() => setOpen(false)} className="block rounded-xl px-3 py-2.5 text-[0.9375rem] font-medium text-white/85 hover:bg-white/[0.06]">Privacy</Link>
              <Link href="/contact" onClick={() => setOpen(false)} className="block rounded-xl px-3 py-2.5 text-[0.9375rem] font-medium text-white/85 hover:bg-white/[0.06]">Contact</Link>
            </div>
            <div className="mt-5 grid shrink-0 grid-cols-2 gap-2.5">
              <Link href="/login" onClick={() => setOpen(false)} className="rd-btn rd-btn-ghost-d w-full">Log in</Link>
              <Link href="/cards/new" onClick={() => setOpen(false)} className="rd-btn rd-btn-primary w-full">Get started</Link>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
