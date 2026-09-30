import { SOFTWARE_APPLICATION_JSONLD, jsonLdScript } from "@/lib/brand";
import type { Metadata } from "next";
import Link from "next/link";
import { TRIAL_DAYS } from "@/lib/plan";
import SiteNav from "@/components/site/SiteNav";
import HeroClaim from "@/components/site/HeroClaim";
import HeroShareWord from "@/components/site/HeroShareWord";
import { ShareScene, SaveScene, LeadScene } from "@/components/site/HowItWorksScenes";
import HomeCardPhone from "@/components/site/HomeCardPhone";
import AppStoreBadge, { GooglePlayBadge } from "@/components/AppStoreBadge";
import HeroShowcase from "@/components/site/HeroShowcase";
import SiteFooter from "@/components/site/SiteFooter";
import ScrollReveal from "@/components/ScrollReveal";
import ScrollProgress from "@/components/ScrollProgress";
import HomeHeadingReveal from "@/components/site/HomeHeadingReveal";
import SwiftLinksPhone from "@/components/site/SwiftLinksPhone";
import SwiftLinkMiniBuilder from "@/components/site/SwiftLinkMiniBuilder";
import SignatureDemo from "@/components/site/SignatureDemo";
import SignatureMiniBuilder from "@/components/site/SignatureMiniBuilder";
import DashboardDemo from "@/components/site/DashboardDemo";
import IntegrationLogos from "@/components/site/IntegrationLogos";
import ShareWaysPhones from "@/components/site/ShareWaysPhones";
import WatchShareImage from "@/components/site/WatchShareImage";
import TemplateGallery from "@/components/site/TemplateGallery";
import { AiDesignerTeaser } from "@/components/site/AiDesignerShowcase";
import TeamsDashboard from "@/components/site/TeamsDashboard";
import WideDemo from "@/components/site/WideDemo";
import NativeHidden from "@/components/NativeHidden";
import NativeHomeGate from "@/components/NativeHomeGate";
import GuestFlowReset from "@/components/GuestFlowReset";
import BadgeCloseButton from "@/components/BadgeCloseButton";
import "./home.css";

export const metadata: Metadata = {
  title: "SwiftCard: The digital business card that shares everything",
  description:
    "One tap and you're in their phone — card, links, and everything you do. Digital cards, SwiftLinks, live email signatures, Apple Wallet, analytics, and lead capture.",
};

// One gradient definition every icon on the page strokes with, so the icons
// carry the same deep-blue → sky fade as the headline.
function IconGradient() {
  return (
    <svg width="0" height="0" className="absolute" aria-hidden="true">
      <defs>
        <linearGradient id="hp-ico" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#1D3FB8" />
          <stop offset="50%" stopColor="#2563EB" />
          <stop offset="100%" stopColor="#4DA8F5" />
        </linearGradient>
      </defs>
    </svg>
  );
}

function Ico({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" className="w-[18px] h-[18px]" fill="none" stroke="url(#hp-ico)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

const Check = ({ className = "w-3 h-3" }: { className?: string }) => (
  <svg viewBox="0 0 20 20" className={className} fill="currentColor" aria-hidden="true"><path fillRule="evenodd" d="M16.7 5.3a1 1 0 010 1.4l-7.5 7.5a1 1 0 01-1.4 0L3.3 9.7a1 1 0 011.4-1.4L8.5 12l6.8-6.7a1 1 0 011.4 0z" clipRule="evenodd" /></svg>
);

const RIBBON = ["Share by link", "QR code", "NFC card", "Apple Wallet", "AI card designer", "Link in Bio", "Email signature", "Lead capture", "Email & text follow-up", "CRM sync", "Live analytics"];

export default function Home() {
  // LinkedIn photo-import is offered in the homepage builders' "Suggest my
  // photo" only when the OAuth app is configured server-side — otherwise the
  // Connect button would route into a dead end. Read here (server component)
  // and threaded into every mini-builder.
  const linkedinEnabled = !!(process.env.LINKEDIN_CLIENT_ID && process.env.LINKEDIN_CLIENT_SECRET);
  return (
    <>
      {/* The product node for search — Organization/WebSite are site-wide in
          the root layout; SoftwareApplication belongs only on the homepage. */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(SOFTWARE_APPLICATION_JSONLD) }} />
      {/* The native shell never shows the marketing homepage — it redirects to
          the product. Normally handled before paint by sc-boot in the root
          layout; this is the fallback. Renders nothing. */}
      <NativeHomeGate />
      {/* Arriving Home as a guest abandons any half-built card/preview — see
          GuestFlowReset. Renders nothing. */}
      <GuestFlowReset />
      <BadgeCloseButton />
      <ScrollProgress />
      <ScrollReveal />
      <HomeHeadingReveal />
      <SiteNav />
      <IconGradient />

      {/* `.hp` scopes every homepage-only style in home.css. */}
      <main className="hp overflow-clip">
        {/* ═══════════════ HERO ═══════════════ */}
        <section className="relative flex flex-col justify-center min-h-[calc(100svh-56px)] pt-24 pb-14 overflow-hidden">
          {/* Ambient video background (owner request 2026-08-19): a bright
              networking scene looping muted behind the hero. The white wash is
              strongest over the text and nearly clear on the right so the
              footage reads as footage. motion-reduce hides the video; the
              poster paints the first frame before the file arrives. */}
          <video
            className="absolute inset-0 w-full h-full object-cover motion-reduce:hidden"
            autoPlay
            muted
            loop
            playsInline
            preload="metadata"
            poster="/hero-bg-poster.jpg?v=2"
            aria-hidden="true"
            tabIndex={-1}
          >
            <source src="/hero-bg.mp4?v=2" type="video/mp4" />
          </video>
          <div
            className="absolute inset-0 pointer-events-none"
            aria-hidden="true"
            style={{ background: "linear-gradient(90deg, rgba(255,255,255,0.88) 0%, rgba(255,255,255,0.7) 48%, rgba(255,255,255,0.2) 78%, rgba(255,255,255,0.08) 100%)" }}
          />
          {/* Phones: the text spans the full width, so one even wash more. */}
          <div className="absolute inset-0 pointer-events-none sm:hidden" aria-hidden="true" style={{ background: "rgba(255,255,255,0.46)" }} />

          <div className="relative w-full min-w-0 max-w-7xl mx-auto px-5 sm:px-6 lg:flex lg:items-center lg:gap-8">
            <div className="max-w-[640px] lg:flex-1">
              <h1 className="rd-display text-slate-900 text-[clamp(2.6rem,5.6vw,4.5rem)]" data-reveal>
                The business card that <HeroShareWord />
              </h1>
              <p className="mt-6 text-slate-700 text-[clamp(1.05rem,1.6vw,1.25rem)] leading-snug max-w-[540px]" data-reveal>
                Saves you in one tap, and does the follow-ups for you.
              </p>

              <ul className="mt-7 grid sm:grid-cols-2 gap-x-6 gap-y-3.5 max-w-[580px]" data-reveal>
                {[
                  { t: "Share by link, QR code or NFC", d: "M9 15l6-6M11 6l1.2-1.2a4 4 0 015.6 5.6L16.6 11.6M13 18l-1.2 1.2a4 4 0 01-5.6-5.6L7.4 12.4" },
                  { t: "Saved in one tap, no app", d: "M20 7L9.5 17.5 4 12" },
                  // Names the channels now that texts actually deliver (A2P
                  // campaign approved 2026-08-13). Automation is Pro, as
                  // "automatic follow-up" always was.
                  { t: "Auto email & text follow-ups", d: "M4 6h16v12H4zM4 7l8 6 8-6" },
                  { t: "Link in Bio + Email Signature", d: "M12 3l2.4 5.6L20 9.3l-4.3 3.9 1.2 5.8L12 16l-4.9 3 1.2-5.8L4 9.3l5.6-.7z" },
                ].map((f) => (
                  <li key={f.t} className="hp-feat">
                    <span className="hp-feat-ico"><Ico d={f.d} /></span>
                    {f.t}
                  </li>
                ))}
              </ul>

              {/* Row order is pinned by tests/app-store-badge.test.ts: "See how
                  it works", then the phone-only App Store badge (lg:hidden —
                  the complement of the nav's desktop badge, so exactly one is
                  above the fold at every width), then the claim box. The claim
                  box sits inside a slowly turning gradient ring: it is the one
                  thing on the page we most want a first-time visitor to do. */}
              <div className="mt-9 flex flex-wrap items-center gap-3" data-reveal>
                {/* Glitter across the whole button (owner, 2026-09-17): a scatter of
                    tiny stars over the face of it, each twinkling on its own slow
                    offset so it shimmers rather than blinks. VERY light on purpose.
                    Inert to the pointer, aria-hidden, stilled by reduced-motion. */}
                <Link id="hero-cta" href="#cards" className="rd-btn rd-btn-ghost-l rd-btn-lg !bg-white/90 hp-sparkle">
                  See how it works
                  <span className="hp-sparks" aria-hidden="true">
                    {[
                      { x: 5, y: 30, s: 5, d: 0 }, { x: 11, y: 64, s: 3.5, d: 2.8 }, { x: 16, y: 20, s: 4, d: 1.4 },
                      { x: 22, y: 74, s: 5, d: 4.1 }, { x: 27, y: 38, s: 3, d: 0.6 }, { x: 33, y: 18, s: 4.5, d: 3.3 },
                      { x: 38, y: 68, s: 3.5, d: 1.9 }, { x: 44, y: 28, s: 5, d: 4.7 }, { x: 49, y: 78, s: 3, d: 1.1 },
                      { x: 54, y: 44, s: 4, d: 3.8 }, { x: 59, y: 16, s: 3.5, d: 2.2 }, { x: 64, y: 70, s: 5, d: 0.4 },
                      { x: 70, y: 32, s: 3, d: 4.4 }, { x: 75, y: 62, s: 4.5, d: 1.6 }, { x: 80, y: 22, s: 3.5, d: 3.1 },
                      { x: 85, y: 76, s: 4, d: 0.9 }, { x: 89, y: 42, s: 3, d: 2.5 }, { x: 93, y: 66, s: 4.5, d: 4.9 },
                      { x: 96, y: 26, s: 3.5, d: 1.3 }, { x: 8, y: 48, s: 3, d: 3.6 },
                    ].map((g, i) => (
                      <svg
                        key={i}
                        viewBox="0 0 24 24"
                        className="hp-spark"
                        fill="currentColor"
                        style={{ left: `${g.x}%`, top: `${g.y}%`, width: g.s, height: g.s, animationDelay: `${g.d}s` }}
                      >
                        <path d="M12 0c.5 6.2 5.3 11 11.5 11.5C17.3 12 12.5 16.8 12 23c-.5-6.2-5.3-11-11.5-11.5C6.7 11 11.5 6.2 12 0z" />
                      </svg>
                    ))}
                  </span>
                </Link>
                <AppStoreBadge size="lg" className="lg:hidden" />
                <GooglePlayBadge size="lg" className="lg:hidden" />
                <div className="hp-ring">
                  <HeroClaim />
                </div>
              </div>
            </div>
            {/* Rotating persona showcase (owner order 2026-08-26): six
                professions, each shown as card, Swift Links and Signature.
                Desktop only. The outer box is the SCALED size — transform
                doesn't shrink layout. */}
            <div className="hidden xl:flex justify-end shrink-0 xl:-mr-8 2xl:-mr-12" data-reveal>
              <div style={{ width: Math.round(692 * 0.92), height: Math.round(680 * 0.92) }}>
                {/* Short laptop screens shrink the stage a step further so its
                    bottom panel never falls under the fold. */}
                <style>{`@media (max-height: 780px) { .sc-heroshow { transform: scale(0.84) !important; } }`}</style>
                <div className="sc-heroshow origin-top-left" style={{ transform: "scale(0.92)" }}>
                  <HeroShowcase />
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ═══════════════ GRADIENT RIBBON ═══════════════ */}
        <div className="hp-ribbon relative overflow-hidden py-4 text-white" aria-label="Everything SwiftCard shares">
          <div className="hp-ribbon-track">
            {[0, 1].map((copy) => (
              <ul key={copy} className="flex shrink-0 items-center" aria-hidden={copy === 1 ? true : undefined}>
                {RIBBON.map((t) => (
                  <li key={t} className="flex items-center gap-6 pr-6 text-[0.95rem] sm:text-[1.05rem] font-semibold whitespace-nowrap">
                    {t}
                    <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 text-white/70" fill="currentColor" aria-hidden="true"><path d="M12 2l2.2 7.8L22 12l-7.8 2.2L12 22l-2.2-7.8L2 12l7.8-2.2z" /></svg>
                  </li>
                ))}
              </ul>
            ))}
          </div>
        </div>

        {/* ═══════════════ HOW IT WORKS ═══════════════ */}
        <section id="how-it-works" className="relative py-24 sm:py-28 scroll-mt-16">
          <div className="max-w-7xl mx-auto px-5 sm:px-6">
            <div className="max-w-2xl mx-auto text-center" data-hp-head>
              <span className="hp-kicker">How it works</span>
              <h2 className="rd-h2 text-[clamp(2.1rem,4.4vw,3.4rem)] text-slate-900 mt-4">
                From hello to <span className="hp-fill">follow-up.</span>
              </h2>
              <p className="hp-lede mt-4">They open your card, save you, and SwiftCard takes it from there.</p>
            </div>

            {/* The track: a gradient line with light running along it, a node
                for each step. Desktop only — on a phone the steps stack and
                carry their own numbers. */}
            <div className="hp-track hidden md:grid grid-cols-3 mt-16" aria-hidden="true">
              <div className="hp-track-line" />
              {[1, 2, 3].map((n) => (
                <div key={n} className="flex justify-center"><span className="hp-node">{n}</span></div>
              ))}
            </div>

            <div className="mt-10 md:mt-8 grid md:grid-cols-3 gap-5">
              {[
                { n: 1, t: "Share your card", d: "They scan your QR code or open your link. No app to download.", scene: <ShareScene /> },
                { n: 2, t: "They save you", d: "One tap on Save Contact puts your photo, number and email in their phone.", scene: <SaveScene /> },
                { n: 3, t: "You get the lead", d: "When they share their info back, you're notified and the follow-up emails go out for you.", scene: <LeadScene /> },
              ].map((s, i) => (
                <div key={s.n} className="hp-step" data-reveal style={{ transitionDelay: `${i * 90}ms` }}>
                  <div className="hp-step-stage" aria-hidden="true">{s.scene}</div>
                  <div className="px-2 mt-5">
                    <div className="flex items-center gap-2.5">
                      <span className="hp-step-num md:hidden">{s.n}</span>
                      <p className="text-slate-900 font-semibold text-[1.125rem]">{s.t}</p>
                    </div>
                    <p className="text-slate-500 text-[0.9375rem] mt-1.5 leading-relaxed">{s.d}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ═══════════════ DIGITAL CARDS ═══════════════ */}
        <section id="cards" className="hp-soft relative py-24 sm:py-28 scroll-mt-16">
          <div className="max-w-7xl mx-auto px-5 sm:px-6">
            <div className="max-w-2xl" data-hp-head>
              <span className="hp-kicker">Swift Cards</span>
              <h2 className="rd-h2 text-[clamp(2.1rem,4.4vw,3.4rem)] text-slate-900 mt-4">
                A card they <span className="hp-fill">actually keep.</span>
              </h2>
              <p className="hp-lede mt-4">
                Designer templates, your photo, your logo, a QR code and a Save Contact button built in. Ready in 60 seconds.
              </p>
            </div>
            <div className="mt-14" data-reveal>
              <TemplateGallery linkedinEnabled={linkedinEnabled} />
            </div>
            {/* The AI Card Designer: both ways in, under a divider so it reads
                as its own idea and not part of the gallery. Full showcase on /templates. */}
            <div className="mt-20 sm:mt-24">
              <AiDesignerTeaser />
            </div>
          </div>
        </section>

        {/* ═══════════════ SWIFTLINKS ═══════════════ */}
        <section id="swiftlinks" className="hp-soft relative py-24 sm:py-28 overflow-hidden">
          <div className="relative max-w-7xl mx-auto px-5 sm:px-6 grid lg:grid-cols-[1.1fr_0.9fr] gap-14 items-center">
            <div>
              <div data-hp-head>
                <span className="hp-kicker">SwiftLinks</span>
                <h2 className="rd-h2 text-[clamp(2.1rem,4.4vw,3.4rem)] text-slate-900 mt-4">
                  Everything you do. <span className="hp-fill">One link.</span>
                </h2>
                <p className="hp-lede mt-4 max-w-[540px]">
                  Bio, socials, booking link and your latest work on one page for Instagram, TikTok or email, powered by the same profile as your card.
                </p>
              </div>
              <ul className="mt-7 space-y-3" data-reveal>
                {[
                  "One-tap looks: clean lights, rich gradients or your own photo",
                  "Video tiles, section headers and styled social icons",
                  "Capture leads right from your page",
                ].map((t) => (
                  <li key={t} className="flex items-center gap-3 text-slate-600 text-[0.9375rem]">
                    <span className="w-5 h-5 rounded-full grid place-items-center text-white shrink-0" style={{ background: "var(--rd-aurora)" }}><Check /></span>
                    {t}
                  </li>
                ))}
              </ul>
              <SwiftLinkMiniBuilder linkedinEnabled={linkedinEnabled} />
            </div>
            <div className="flex justify-center" data-reveal="scale">
              <SwiftLinksPhone />
            </div>
          </div>
        </section>

        {/* ═══════════════ EMAIL SIGNATURE ═══════════════ */}
        <section id="signature" className="relative py-24 sm:py-28">
          <div className="max-w-7xl mx-auto px-5 sm:px-6">
            <div className="max-w-2xl mx-auto text-center mb-12" data-hp-head>
              <span className="hp-kicker">Swift Signature</span>
              <h2 className="rd-h2 text-[clamp(2.1rem,4.4vw,3.4rem)] text-slate-900 mt-4">
                Every email you send, <span className="hp-fill">working for you.</span>
              </h2>
              <p className="hp-lede mt-4">
                Your live card sits in your signature. Recipients open it, save you and reply in one tap.
              </p>
            </div>
            <div data-reveal="fade"><SignatureDemo /></div>
            <SignatureMiniBuilder linkedinEnabled={linkedinEnabled} />
          </div>
        </section>

        {/* ═══════════════ ANALYTICS / DASHBOARD + INTEGRATIONS ═══════════════ */}
        <section id="analytics" className="relative pt-24 sm:pt-28 overflow-hidden">
          <div className="relative max-w-7xl mx-auto px-5 sm:px-6">
            <div className="max-w-2xl mb-12" data-hp-head>
              <span className="hp-kicker">Dashboard &amp; analytics</span>
              <h2 className="rd-h2 text-[clamp(2.1rem,4.4vw,3.4rem)] text-slate-900 mt-4">
                See who&apos;s looking. <span className="hp-fill">Keep every lead.</span>
              </h2>
              <p className="hp-lede mt-4">
                Live views, saves and locations. Every contact lands in one place with their history, their replies and automatic email and text follow-ups. Try the dashboard right here.
              </p>
            </div>
            <div data-reveal="fade">
              <WideDemo minWidth={760}>
                <DashboardDemo />
              </WideDemo>
            </div>
            <div className="mt-8 flex flex-wrap items-center gap-3" data-reveal>
              <Link href="/cards/new" className="rd-btn rd-btn-primary">Create your free card</Link>
              <Link href="/preview" className="rd-btn rd-btn-ghost-l">Try the live demo</Link>
            </div>
          </div>

          <div id="integrations" className="hp-soft relative mt-20 sm:mt-24 border-t border-slate-200 py-16 sm:py-20">
            <div className="max-w-5xl mx-auto px-5 sm:px-6 text-center">
              <div data-hp-head>
                <span className="hp-kicker">Integrations</span>
                <h3 className="rd-h2 text-[clamp(1.8rem,3.4vw,2.5rem)] text-slate-900 mt-4">
                  Leads land in the <span className="hp-fill">tools you already use.</span>
                </h3>
                <p className="hp-lede mt-3 max-w-[520px] mx-auto">Every captured contact syncs straight to your CRM. No copy-paste, no exports.</p>
              </div>
              <div className="mt-9" data-reveal="fade"><IntegrationLogos /></div>
              <div className="mt-8" data-reveal>
                <Link href="/products/integrations" className="rd-btn rd-btn-ghost-l">Explore integrations →</Link>
              </div>
            </div>
          </div>
        </section>

        {/* ═══════════════ WAYS TO SHARE / APPLE WALLET ═══════════════ */}
        <section id="wallet" className="hp-soft relative py-24 sm:py-28 overflow-hidden">
          <div className="max-w-7xl mx-auto px-5 sm:px-6">
            <div className="max-w-2xl mx-auto text-center" data-hp-head>
              <span className="hp-kicker">Ways to share</span>
              <h2 className="rd-h2 text-[clamp(2.1rem,4.4vw,3.4rem)] text-slate-900 mt-4">
                Always <span className="hp-fill">in your pocket.</span>
              </h2>
              <p className="hp-lede mt-4">
                Link, QR code, NFC card or Apple Wallet. Whoever you meet, your card is a second away. No app, no signal, no fumbling.
              </p>
            </div>

            <div className="mt-14 flex justify-center" data-reveal="scale"><ShareWaysPhones light /></div>

            <ul className="mt-12 grid sm:grid-cols-2 lg:grid-cols-4 gap-3 max-w-5xl mx-auto" data-reveal>
              {[
                { t: "Apple Wallet", d: "Next to your passes" },
                { t: "QR code", d: "They scan, it opens" },
                { t: "Share sheet", d: "Text, email, AirDrop" },
                { t: "NFC card & link", d: "Or your email signature" },
              ].map((w) => (
                <li key={w.t} className="hp-card !p-4 flex items-center gap-3">
                  <span className="w-5 h-5 rounded-full grid place-items-center text-white shrink-0" style={{ background: "var(--rd-aurora)" }}><Check /></span>
                  <span className="text-[0.9375rem]"><span className="font-semibold text-slate-900">{w.t}</span> <span className="text-slate-500">· {w.d}</span></span>
                </li>
              ))}
            </ul>

            <div className="mt-9 flex justify-center" data-reveal>
              <Link href="/cards/new" className="rd-btn rd-btn-primary">Add SwiftCard to Wallet</Link>
            </div>
          </div>
        </section>

        {/* ═══════════════ APPLE WATCH ═══════════════ */}
        <section id="watch" className="relative py-24 sm:py-28 overflow-hidden">
          <div className="relative max-w-7xl mx-auto px-5 sm:px-6 grid lg:grid-cols-2 gap-10 lg:gap-14 items-center">
            <div className="flex justify-center order-2 lg:order-1" data-reveal="scale"><WatchShareImage /></div>
            <div className="order-1 lg:order-2" data-hp-head>
              <span className="hp-kicker">Apple Watch</span>
              <h2 className="rd-h2 text-[clamp(2rem,4vw,3.1rem)] text-slate-900 mt-4">
                Your card, <span className="hp-fill">on your wrist.</span>
              </h2>
              <p className="hp-lede mt-4">
                Raise your wrist, show your code, share hands-free. No phone required.
              </p>
              <div className="mt-6 flex items-start gap-3 rounded-2xl border border-slate-200 bg-[#F5F7FB] p-4 max-w-[440px]">
                <svg viewBox="0 0 24 24" className="w-5 h-5 shrink-0 mt-0.5" fill="none" stroke="#2563EB" strokeWidth={1.8}><circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 16h.01" strokeLinecap="round" /></svg>
                <p className="text-slate-500 text-[0.84375rem] leading-relaxed">
                  <span className="font-semibold text-slate-800">On the roadmap.</span>{" "}Today you can add your card to Apple Wallet and reach it from your Watch. A dedicated native watchOS app is in development — we&apos;ll only ship it once it&apos;s fully approved by Apple.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* ═══════════════ TEAMS ═══════════════ */}
        <section id="teams" className="relative py-24 sm:py-28 overflow-hidden">
          <div className="relative max-w-7xl mx-auto px-5 sm:px-6">
            <div className="max-w-2xl" data-hp-head>
              <span className="hp-kicker">Teams &amp; Offices</span>
              <h2 className="rd-h2 text-[clamp(2.1rem,4.4vw,3.4rem)] text-slate-900 mt-4">
                One brand. <span className="hp-fill">Everyone on it.</span>
              </h2>
              <p className="hp-lede mt-4">
                Locked branding, shared templates and one place to manage seats. Every rep looks sharp and every lead is accounted for.
              </p>
            </div>
            <div className="mt-12 grid sm:grid-cols-3 gap-4" id="leads">
              {[
                // Owner, 2026-09-17: branding now reaches Swift Links pages too
                // (Branding → Links: company bio, Instagram, pinned links, look).
                { t: "Uniform branding", d: "Lock logo, colors, fonts and template so every card is on-brand, and set the bio, Instagram and pinned links on every Swift Links page.", icon: "M4 7.5A2.5 2.5 0 016.5 5h11A2.5 2.5 0 0120 7.5v9a2.5 2.5 0 01-2.5 2.5h-11A2.5 2.5 0 014 16.5v-9zM8 10h8M8 14h5" },
                { t: "Lead capture, built in", d: "Every card and page captures contacts straight to your CRM.", icon: "M12 12a4 4 0 100-8 4 4 0 000 8zM4 20a8 8 0 0116 0M18 8h4M20 6v4" },
                { t: "Seats & roles", d: "Add or remove people in seconds. One bill, full control.", icon: "M9 11a3 3 0 100-6 3 3 0 000 6zM3 19a6 6 0 0112 0M17 10a2.5 2.5 0 100-5 2.5 2.5 0 000 5zM15.5 13.5A5 5 0 0121 18" },
              ].map((f, i) => (
                <div key={f.t} className="hp-card" data-reveal style={{ transitionDelay: `${i * 90}ms` }}>
                  <span className="hp-feat-ico"><Ico d={f.icon} /></span>
                  <p className="text-slate-900 font-semibold text-[1.0625rem] mt-4">{f.t}</p>
                  <p className="text-slate-500 text-[0.875rem] mt-1.5 leading-relaxed">{f.d}</p>
                </div>
              ))}
            </div>
            <div className="mt-8" data-reveal="fade">
              <WideDemo minWidth={820}>
                <TeamsDashboard />
              </WideDemo>
            </div>
            {/* A small team that's ready gets the self-serve path; a bigger or
                unsure buyer gets a way to ask first. */}
            <div className="mt-8 flex flex-wrap items-center gap-3" data-reveal>
              <Link href="/products/teams" className="rd-btn rd-btn-primary">Explore Office</Link>
              <Link href="/contact?topic=office" className="rd-btn rd-btn-ghost-l">Talk to us about your team</Link>
            </div>
          </div>
        </section>

        {/* ═══════════════ FINAL CTA ═══════════════ */}
        <section className="relative px-4 sm:px-6 pb-20 sm:pb-28">
          <div className="hp-final max-w-7xl mx-auto px-6 sm:px-14 py-16 sm:py-24" data-reveal="scale">
            <div className="hp-final-rings hidden md:block" aria-hidden="true"><span /><span /><span /><span /></div>
            {/* A real SwiftCard, rising out of the panel. */}
            <div className="hp-final-phone hidden lg:block"><HomeCardPhone /></div>
            <div className="relative max-w-2xl">
              <h2 className="rd-display text-white text-[clamp(2.4rem,5.5vw,4.4rem)]">
                Be the one they remember.
              </h2>
              <p className="text-white/85 text-[1.15rem] mt-5 max-w-[480px]">
                Your free SwiftCard takes 60 seconds. Share it today.
              </p>
              <div className="mt-9 flex flex-wrap items-center gap-4">
                <Link href="/cards/new" className="hp-btn-white">Create your free card <span aria-hidden="true">→</span></Link>
                {/* TRIAL_DAYS so this line can never drift from what checkout
                    actually grants. Web only (NativeHidden): the iOS shell must
                    not advertise purchases (App Review 3.1.1). */}
                <NativeHidden>
                  <p className="text-white/85 text-[0.9375rem]">
                    <span className="font-bold text-white">Pro starts with {TRIAL_DAYS} days free</span> · cancel anytime
                  </p>
                </NativeHidden>
              </div>
            </div>
            {/* Phones and tablets: the same real card, rising out of the bottom of the panel.
                pt-6: the tilt lifts the phone's top-right corner above its own
                box, and overflow-hidden (which crops the bottom into the panel
                edge) sliced that corner off (owner, 2026-09-30). The height grows
                by the same 24px and mt-10 became mt-4, so the gap above and
                the bottom crop are both unchanged. */}
            <div className="lg:hidden relative mt-4 -mb-16 sm:-mb-24 h-[344px] pt-6 overflow-hidden flex justify-center">
              <div className="rotate-[-3deg] origin-top"><HomeCardPhone width={250} /></div>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
    </>
  );
}
