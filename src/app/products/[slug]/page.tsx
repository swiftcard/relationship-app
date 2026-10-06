import type { Metadata } from "next";
import "@/app/home.css";
import Eyebrow from "@/components/site/Eyebrow";
import { notFound } from "next/navigation";
import Link from "next/link";
import SiteNav from "@/components/site/SiteNav";
import SiteFooter from "@/components/site/SiteFooter";
import ScrollReveal from "@/components/ScrollReveal";
import ScrollProgress from "@/components/ScrollProgress";
import HomeHeadingReveal from "@/components/site/HomeHeadingReveal";
import MarketingCta from "@/components/site/MarketingCta";
import LeadCapturePhone from "@/components/site/LeadCapturePhone";
import SignatureDemo from "@/components/site/SignatureDemo";
import DashboardDemo from "@/components/site/DashboardDemo";
import TemplateGallery from "@/components/site/TemplateGallery";
import SwiftLinksPhone from "@/components/site/SwiftLinksPhone";
import ShareWaysPhones from "@/components/site/ShareWaysPhones";
import WatchShareImage from "@/components/site/WatchShareImage";
import { INTEGRATIONS, integrationNames } from "@/components/site/integration-brands";
import TeamsDashboard from "@/components/site/TeamsDashboard";
import WideDemo from "@/components/site/WideDemo";
import NativeHidden from "@/components/NativeHidden";
import NativeFeatureNote from "@/components/NativeFeatureNote";
import { PLAN_LIMITS } from "@/lib/plan";

// The Teams page's own way into Office: the card builder with Office already
// picked (plan/interval/seats ride through sign-up to "Complete your Office
// subscription", exactly like /pricing's "Get Office"). Before, its only
// buttons were "Create your free card" and "See pricing", so a team buyer
// went through a Free-framed builder and a plan chooser to get here.
// NativeHidden wherever it renders — the app never sells (App Store 3.1.1).
const GET_OFFICE_HREF = `/cards/new?plan=office&interval=monthly&seats=${PLAN_LIMITS.OFFICE_MIN_SEATS}`;

type Feature = { t: string; d: string };
type Product = {
  eyebrow: string;
  title: React.ReactNode;
  titlePlain: string;
  subtitle: string;
  demo: React.ReactNode;
  wide?: boolean; // demo spans full width below the hero copy
  ctaLabel?: string; // hero button label (defaults to "Create your free card")
  features: Feature[];
  metaDesc: string;
};

function A({ children }: { children: React.ReactNode }) {
  return <span className="hp-fill">{children}</span>;
}

// One gradient definition every icon on the page strokes with (same pattern as
// the homepage; page-unique id so it can't clash with another page's).
function IconGradient() {
  return (
    <svg width="0" height="0" className="absolute" aria-hidden="true">
      <defs>
        <linearGradient id="pp-ico" x1="0" y1="0" x2="1" y2="1">
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
    <svg viewBox="0 0 24 24" className="w-[18px] h-[18px]" fill="none" stroke="url(#pp-ico)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

const CHECK_D = "M5 12.5l4.5 4.5L19 7.5";

// Homepage checklist bullet: white check in a brand-gradient circle.
function CheckDot() {
  return (
    <span className="w-5 h-5 rounded-full grid place-items-center text-white shrink-0" style={{ background: "var(--rd-aurora)" }}>
      <svg viewBox="0 0 20 20" className="w-3 h-3" fill="currentColor" aria-hidden="true"><path fillRule="evenodd" d="M16.7 5.3a1 1 0 010 1.4l-7.5 7.5a1 1 0 01-1.4 0L3.3 9.7a1 1 0 011.4-1.4L8.5 12l6.8-6.7a1 1 0 011.4 0z" clipRule="evenodd" /></svg>
    </span>
  );
}

const PRODUCTS: Record<string, Product> = {
  "digital-cards": {
    eyebrow: "Digital Cards",
    title: <>A card so good, people <A>want</A> to keep it.</>,
    titlePlain: "Digital Cards",
    subtitle: "Designer templates, your colors, your photo, your logo — a scannable QR and a Save Contact button built in. Share it with a tap, a QR, or a link, and land straight in their phone.",
    demo: (
      <div className="w-full rounded-[28px] hp-soft border border-[rgba(11,16,34,0.08)] p-5 sm:p-7 shadow-[0_40px_80px_-50px_rgba(29,63,184,0.35)]">
        <TemplateGallery />
      </div>
    ),
    wide: true,
    features: [
      { t: "Six designer templates", d: "Photo-first, logo-first, classic, bold, minimal — all fully customizable to your brand in seconds." },
      { t: "Tap, QR, or link", d: "Works on every phone with no app. A tap on your NFC card, a scannable QR, or a simple shareable link." },
      { t: "Save Contact, built in", d: "Your name, number, email and photo drop straight into their contacts as a vCard." },
      { t: "Unlimited cards on Pro", d: "A card for each side of you — work, personal, speaking — each with its own analytics." },
    ],
    metaDesc: "Beautiful, customizable digital business cards that share themselves with one tap — QR, NFC, or link, no app required.",
  },
  swiftlinks: {
    eyebrow: "SwiftLinks",
    title: <>Everything to do. <A>One SwiftLink.</A></>,
    titlePlain: "SwiftLinks",
    subtitle: "Your bio, your socials, your booking link, your latest drop — one beautiful page that lives in your Instagram, TikTok, or email. Separate from your card, powered by the same profile.",
    // Light like the rest of the site (owner, 2026-09-17: only the header and
    // footer stay dark — SwiftLinksPhone's caption is slate now). No side
    // padding below sm: the phone caps itself at calc(100vw - 40px).
    demo: (
      <div className="rounded-[28px] bg-white border border-slate-200 px-0 py-6 sm:p-10">
        <SwiftLinksPhone />
      </div>
    ),
    features: [
      { t: "Looks — themes in one tap", d: "Clean lights, deep darks, rich gradients, or Aura — your own photo as the page's atmosphere." },
      { t: "Links, video tiles & headers", d: "Buttons, rich video tiles, and section headers that organize a long page into chapters. Reorder anytime." },
      { t: "Styled social icons", d: "Circle, squircle, or square chips — in each platform's brand color, your Look's accent, or quiet mono." },
      { t: "Capture leads on the page", d: "A built-in connect form turns visitors into saved contacts." },
      { t: "Made for your bio", d: "Drop it in your Instagram or TikTok bio and send traffic that converts." },
    ],
    metaDesc: "SwiftLinks — one beautiful link-in-bio page for your bio, socials, and links, with lead capture built in.",
    // Product-correct CTA — still lands on /cards/new (the SwiftLink lives on
    // the same card record; the builder covers it), only the label changes.
    ctaLabel: "Create your free SwiftLink",
  },
  "email-signatures": {
    eyebrow: "Swift Signature",
    title: <>Every email you send, <A>advertising you.</A></>,
    titlePlain: "Swift Signature",
    subtitle: "Drop your live SwiftCard into your email signature once with Swift Signature. Now every message ends with a clickable card — recipients open it, save your contact, and reach out in a single tap.",
    ctaLabel: "Create your free Swift Signature",
    demo: (
      <div className="w-full rounded-[28px] hp-soft border border-[rgba(11,16,34,0.08)] p-5 sm:p-8 shadow-[0_40px_80px_-50px_rgba(29,63,184,0.35)]">
        <SignatureDemo />
      </div>
    ),
    wide: true,
    features: [
      { t: "Copy once, paste anywhere", d: "Works in Gmail, Outlook, Apple Mail — any client that supports HTML signatures." },
      { t: "Easy to keep current", d: "Change your title or number and SwiftCard tells you — copy it again and every email from then on has the new card." },
      { t: "Clickable, not decorative", d: "One tap opens your card, saves your contact, or reaches you directly." },
      { t: "A tiny billboard", d: "Every reply becomes a professional advertisement for you and your brand." },
    ],
    metaDesc: "Swift Signature turns your email signature into a live, clickable SwiftCard — recipients open, save, and reach out in one tap.",
  },
  "lead-capture": {
    eyebrow: "Lead Capture",
    title: <>Turn every scan into a <A>relationship.</A></>,
    titlePlain: "Lead Capture",
    subtitle: "When someone opens your card, they can share their info right back — straight into your contacts, with where and when you met. Then you follow up by email or text, and they can text you back. No more lost napkins or half-typed numbers.",
    demo: (
      <div className="rounded-[28px] bg-white border border-slate-200 px-4 py-6 sm:p-10">
        <LeadCapturePhone />
      </div>
    ),
    // Every claim below is enforced in code — the texting ones especially, since
    // they are new. Registered sender: A2P 10DLC campaign COJQ2MB, approved
    // 2026-08-13. Consent gate: the sms-ok tag — since 2026-09-20 it is set ONLY
    // by the owner switching a text follow-up on for that contact (the share
    // form no longer asks, and the public capture route cannot set it);
    // reminders/route.ts refuses to text without it. Inbound:
    // api/twilio/inbound logs replies to lead_messages. Manual send: api/sms/send
    // checks auth and sms-paused, NOT the plan — so it really is every plan.
    // Sequences (8c2ca298): EMAIL steps send on every plan; reminders/route.ts
    // holds back only TEXT steps for Free — hence "texts on Pro".
    features: [
      { t: "Two-way exchange", d: "They save you, you capture them — the whole handshake in one tap." },
      { t: "Context that sticks", d: "Every lead is tagged with the card, time, and location they came from." },
      { t: "Texts that actually arrive", d: "SwiftCard is a carrier-registered sender, so your follow-up lands in their messages instead of being filtered out on the way." },
      { t: "Only the people who agreed", d: "A text goes out only to a contact you've switched texts on for — confirming they agreed to hear from you. STOP is honored instantly." },
      { t: "They text back, you see it", d: "Replies land in that contact's conversation, next to the views and the notes. One thread, not a second inbox." },
      { t: "One tap to reach them", d: "Call, text or email any contact straight from your Contacts list — their thread, notes, and history right beside you." },
      { t: "Sequences that run themselves", d: "Switch on an email follow-up for a contact and it sends on your schedule — never outside 8am–9pm their time. Texts and AI-written messages on Pro." },
      { t: "Straight to your CRM", d: "Contacts flow into your dashboard and sync to Salesforce, GoHighLevel, Pipedrive, HubSpot or Google Contacts." },
    ],
    metaDesc: "Capture leads the moment someone opens your card — two-way contact exchange, follow-up by email or text from a registered sender, and replies that land in one thread.",
  },
  analytics: {
    eyebrow: "Dashboard & Analytics",
    title: <>See who&apos;s looking. <A>Never lose a lead.</A></>,
    titlePlain: "Dashboard & Analytics",
    subtitle: "Real-time views, contacts, and locations. Every contact who taps your card lands in one searchable place — with full history, their replies, and automated follow-ups. Try the dashboard right here.",
    // DashboardDemo is a faithful replica of the desktop dashboard: a browser
    // frame around a two-column board that needs ~720px to hold together. Sent
    // in raw it was CLIPPED on a phone — the right-hand card panel sat 212px
    // past the frame's edge, which `overflow-hidden` cut off mid-word, so the
    // Traffic tabs ended at "Locatio". The homepage already solved this for the
    // same component by scaling it like a product shot (WideDemo); this is that
    // same treatment.
    //
    // minWidth 720, not the homepage's 760: 720 is the measured width at which
    // this mock stops clipping, so tablets (720px of room) stay pixel-identical
    // instead of being scaled by a hair. max-w-[900px] keeps the desktop
    // rendering exactly as it was — the mock's natural width is 898px inside a
    // 1104px centred column, and WideDemo's outer is w-full, which would
    // otherwise stretch it to fill.
    demo: (
      <div className="w-full max-w-[900px]">
        <WideDemo minWidth={720}>
          <DashboardDemo />
        </WideDemo>
      </div>
    ),
    wide: true,
    features: [
      { t: "Live traffic", d: "SwiftCard and Swift Link views by day, week, and month — see momentum build." },
      { t: "Top locations", d: "Know exactly where your card is getting opened, city by city." },
      // "A real CRM" listed the parts and skipped the thing that changed: the
      // timeline is now two-way. api/twilio/inbound writes replies into
      // lead_messages, so a text back appears in the same thread as the views.
      { t: "One thread per person", d: "Notes, read/unread, every view — and the emails and texts you've exchanged, in the order they happened." },
      { t: "Follow-up on autopilot", d: "Light, medium, or aggressive email follow-ups for any contact you choose — plus texts and AI-written messages on Pro." },
    ],
    metaDesc: "SwiftCard's dashboard: real-time views, contacts, top locations, and a built-in CRM where replies and automated follow-ups live in one thread.",
  },
  teams: {
    eyebrow: "Teams & Offices",
    title: <>One brand. <A>Everyone on it.</A></>,
    titlePlain: "Teams & Offices",
    subtitle: "Roll out cards across your whole team with consistent branding, shared templates, and one place to manage seats. Every rep looks sharp — and every lead is accounted for.",
    demo: <TeamsDashboard />,
    wide: true,
    features: [
      { t: "Uniform branding", d: "Lock the logo, colors, and template so every card is unmistakably on-brand." },
      { t: "A card per member", d: "Everyone gets their own card and analytics under one shared office." },
      { t: "Seats & roles", d: "Add or remove people in seconds. One bill, full admin control." },
      { t: "Invite by email", d: "Teammates join with Google or an emailed link — no password to set up, and their card is ready to share." },
    ],
    metaDesc: "Roll out on-brand digital cards across your whole team, with shared templates, seat management, and team analytics.",
  },
  wallet: {
    eyebrow: "Ways to share",
    title: <>Your card, always <A>in your pocket.</A></>,
    titlePlain: "Apple Wallet",
    // The demo shows two phones since the standalone QR phone came out — the
    // pass carries the QR itself, so a third phone said nothing the first
    // didn't. Copy now matches: Wallet (QR included) and the share sheet, in
    // that order. Downloading the QR is still real and still mentioned.
    subtitle: "However you meet someone, there's a way to hand them your card in a second — your Apple Wallet pass, with the QR right on it, or the share sheet. No app, no signal, no fumbling. You can also download your card's QR code to display at events, add it as a home-screen widget, or use it in any other sharing format that fits the moment.",
    demo: <ShareWaysPhones light />,
    wide: true,
    ctaLabel: "Get Started",
    features: [
      { t: "One tap to add", d: "Save your card to Wallet and reach it from your lock screen instantly." },
      { t: "Works offline", d: "No signal needed — your QR is right there whenever you need it." },
      // Not marketing licence: wallet.ts registers a webServiceURL +
      // authenticationToken, api/wallet/v1/* implements the full PassKit device
      // registration spec, and touchWalletPass pushes on change — hot-hooked to
      // the card editor with a daily sweep behind it. The pass genuinely
      // re-downloads itself; the old "updates too" undersold a real mechanism.
      { t: "Updates itself", d: "Change your title or your number and the pass in your Wallet redraws itself — Apple fetches the new one. Nothing to re-add, nothing left stale." },
      { t: "Right where they look", d: "Sitting next to the cards people already pull out every day." },
    ],
    metaDesc: "Add your SwiftCard to Apple Wallet — your digital business card, always a swipe away, even offline.",
  },
  watch: {
    eyebrow: "Apple Watch",
    // Exact message requested by the owner.
    title: <>Make your Apple Watch into a <A>scannable business card</A> you take with you everywhere.</>,
    titlePlain: "Apple Watch",
    subtitle: "Raise your wrist, show your code, and share your details hands-free — no phone required. Your card goes wherever you go.",
    demo: <WatchShareImage />,
    features: [
      { t: "Hands-free sharing", d: "Show your card from your wrist — perfect for events, gyms, and on the move." },
      { t: "Always with you", d: "No reaching for your phone. Your details are one glance away." },
      { t: "Scannable code", d: "A crisp QR your Watch displays so anyone can open your full card." },
      { t: "Powered by your card", d: "Everything stays in sync with the card and profile you already have." },
    ],
    metaDesc: "Make your Apple Watch a scannable business card you take everywhere — share your details hands-free.",
  },
  integrations: {
    eyebrow: "Integrations",
    title: <>Your leads flow into <A>the tools you already use.</A></>,
    titlePlain: "Integrations",
    subtitle: "The moment someone shares their info, SwiftCard pushes that contact straight into your CRM and the apps your team runs on — in real time. No CSV shuffling, no copy-paste, no lead sitting in a dashboard nobody opens.",
    demo: (
      <div className="w-[340px] max-w-full flex flex-col items-center">
        {/* the lead that just came in */}
        <div className="w-full rounded-2xl border border-[rgba(11,16,34,0.08)] bg-white px-4 py-3.5 flex items-center gap-3 shadow-[0_18px_44px_-24px_rgba(29,63,184,0.35)]">
          <span className="w-10 h-10 rounded-full flex items-center justify-center text-white text-[0.8125rem] font-bold shrink-0" style={{ background: "var(--rd-aurora)" }}>SC</span>
          <span className="min-w-0">
            <span className="block text-slate-900 text-[0.875rem] font-semibold leading-tight">Sarah Chen</span>
            <span className="block text-slate-500 text-[0.75rem] leading-tight">just shared her info · via QR</span>
          </span>
          <span className="ml-auto text-[0.625rem] font-bold px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200 shrink-0">New lead</span>
        </div>
        {/* flows automatically to… */}
        <div className="flex flex-col items-center py-2.5">
          <svg viewBox="0 0 24 24" className="w-5 h-5 text-slate-300" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M6 13l6 6 6-6" /></svg>
          <span className="text-slate-400 text-[0.6875rem] font-medium tracking-wide">synced automatically</span>
        </div>
        {/* …into your tools. Same canonical list as the homepage band. */}
        <div className="grid grid-cols-2 gap-3 w-full">
          {INTEGRATIONS.map((it) => (
            <div key={it.name} className="rounded-xl bg-white border border-[rgba(11,16,34,0.08)] px-3 py-2.5 flex items-center gap-2.5 shadow-[0_14px_34px_-20px_rgba(29,63,184,0.3)]">
              <span className="w-7 h-7 flex items-center justify-center shrink-0">{it.logo}</span>
              <span className="min-w-0">
                <span className="block text-slate-800 text-[0.78125rem] font-bold leading-tight truncate">{it.name}</span>
                <span className="block text-slate-400 text-[0.65625rem] leading-tight truncate">{it.short}</span>
              </span>
            </div>
          ))}
        </div>
      </div>
    ),
    // Derived from the canonical list so a new integration appears here the
    // moment it's added, instead of being forgotten for a release.
    features: INTEGRATIONS.map((i) => ({ t: i.name, d: i.blurb })),
    metaDesc: `Connect SwiftCard to ${integrationNames()}. Every lead you capture flows into the tools you already use, in real time.`,
  },
};

export function generateStaticParams() {
  return Object.keys(PRODUCTS).map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const p = PRODUCTS[slug];
  if (!p) return { title: "SwiftCard" };
  return { title: `${p.titlePlain} — SwiftCard`, description: p.metaDesc };
}

export default async function ProductPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const p = PRODUCTS[slug];
  if (!p) notFound();

  // The "Preview" (see-it-live) CTA is hidden on these product pages per owner
  // request — they showcase the real thing inline instead.
  const showPreview = !["digital-cards", "swiftlinks", "email-signatures", "lead-capture", "wallet", "watch", "integrations", "teams"].includes(slug);

  // In-app honesty clarifiers (App Review 2.3.1): inside the iOS shell these
  // marketing pages are in-app content, so aspirational phrasing gets an
  // exact "how it works today" note. NativeFeatureNote renders null on web.
  const nativeNote =
    slug === "watch" ? (
      <NativeFeatureNote>
        The Apple Watch app comes with SwiftCard for iPhone, version 1.0.5 and later: once it&apos;s installed, open the Watch app on your iPhone and turn SwiftCard on under Available Apps. On an earlier version, add your card to Apple Wallet and the pass (QR code included) shows up in Wallet on your Apple Watch.
      </NativeFeatureNote>
    ) : slug === "wallet" ? (
      <NativeFeatureNote>
        In this version of the app: Apple Wallet, QR download, and share-sheet sharing are available today. The home-screen QR widget appears once you add it from your iPhone home screen&apos;s widget gallery.
      </NativeFeatureNote>
    ) : null;

  return (
    <div className="bg-white">
      <ScrollProgress />
      <ScrollReveal />
      <HomeHeadingReveal />
      <SiteNav />
      <IconGradient />

      <main className="hp overflow-clip">
        {/* Hero */}
        <section className="hp-page-hero pt-32 pb-20 sm:pt-40 sm:pb-24">
          {p.wide ? (
            <div className="relative max-w-6xl mx-auto px-5 sm:px-6">
              <div className="max-w-3xl">
                <div data-hp-head>
                  <span className="hp-kicker">{p.eyebrow}</span>
                  <h1 className="rd-display text-slate-900 text-[clamp(2.3rem,5vw,3.8rem)] mt-5">{p.title}</h1>
                  <p className="text-slate-600 text-[1.12rem] mt-5 leading-relaxed max-w-[620px]">{p.subtitle}</p>
                </div>
                {nativeNote}
                <div className="mt-8 flex flex-wrap gap-3" data-reveal>
                  <Link href="/cards/new" className="rd-btn rd-btn-primary rd-btn-lg">{p.ctaLabel ?? "Create your free card"}</Link>
                  {showPreview && <Link href="/preview" className="rd-btn rd-btn-ghost-l rd-btn-lg">Preview</Link>}
                  {slug === "teams" && <NativeHidden><Link href={GET_OFFICE_HREF} className="rd-btn rd-btn-ghost-l rd-btn-lg">Get Office for your team →</Link></NativeHidden>}
                </div>
              </div>
              <div className="mt-14 flex justify-center" data-reveal="fade">{p.demo}</div>
            </div>
          ) : (
            <div className="relative max-w-6xl mx-auto px-5 sm:px-6 grid lg:grid-cols-2 gap-14 items-center">
              <div>
                <div data-hp-head>
                  <span className="hp-kicker">{p.eyebrow}</span>
                  <h1 className="rd-display text-slate-900 text-[clamp(2.3rem,5vw,3.8rem)] mt-5">{p.title}</h1>
                  <p className="text-slate-600 text-[1.12rem] mt-5 leading-relaxed max-w-[560px]">{p.subtitle}</p>
                </div>
                {nativeNote}
                <div className="mt-8 flex flex-wrap gap-3" data-reveal>
                  <Link href="/cards/new" className="rd-btn rd-btn-primary rd-btn-lg">{p.ctaLabel ?? "Create your free card"}</Link>
                  {showPreview && <Link href="/preview" className="rd-btn rd-btn-ghost-l rd-btn-lg">Preview</Link>}
                </div>
              </div>
              <div className="flex justify-center" data-reveal="scale">{p.demo}</div>
            </div>
          )}
        </section>

        {/* Features */}
        <section className="hp-soft relative py-20 sm:py-24">
          <div className="max-w-6xl mx-auto px-5 sm:px-6">
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {p.features.map((f, i) => (
                <div key={f.t} className="hp-card" data-reveal style={{ transitionDelay: `${i * 70}ms` }}>
                  <span className="hp-feat-ico"><Ico d={CHECK_D} /></span>
                  <p className="text-slate-900 font-semibold text-[1rem] mt-4">{f.t}</p>
                  <p className="text-slate-500 text-[0.875rem] mt-1.5 leading-relaxed">{f.d}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Deep dive — teams & offices only */}
        {slug === "teams" && (
          <section className="relative py-20 sm:py-24 bg-white">
            <div className="relative max-w-5xl mx-auto px-5 sm:px-6">
              <div className="max-w-2xl" data-hp-head>
                <div><Eyebrow dark={false}>What you get</Eyebrow></div>
                <h2 className="rd-h2 text-slate-900 text-[clamp(1.9rem,3.6vw,2.6rem)] mt-3">One office account. Total control, zero busywork.</h2>
                <p className="text-slate-600 text-[1.05rem] mt-4 leading-relaxed">You set the brand once — every card your team creates inherits it automatically. From there, it&rsquo;s a single dashboard to see how the whole team is doing, not a spreadsheet of who has what.</p>
              </div>

              <div className="mt-12 grid md:grid-cols-3 gap-4">
                {[
                  { t: "Brand it once", d: "Set your logo, colors, and a locked template. Every card anyone on your team creates — today or a year from now — is on-brand automatically. No one can go rogue with their own look." },
                  { t: "Everyone gets their own card", d: "Each teammate gets a personal card with their name, title, and photo — their own Swift Links, their own Swift Signature, their own contacts. Same brand, their identity." },
                  { t: "Admin sees everyone at a glance", d: "One dashboard shows every member's card, activity, and lead count. Spot who's actively sharing their card and who needs a nudge — without asking around." },
                  { t: "Add people in seconds", d: "Invite a teammate by email and their card is ready before the meeting ends. No IT ticket, no design request, no waiting on a template." },
                  { t: "Unlimited seats, always", d: "There's no cap on team size and no separate contract to add someone. Add or remove seats anytime from inside the account as your team grows or changes." },
                  { t: "Contacts stay with the team", d: "Every contact your team collects lands in one list you can export — and it stays with the office when someone leaves." },
                ].map((s, i) => (
                  <div key={s.t} className="hp-card" data-reveal style={{ transitionDelay: `${i * 70}ms` }}>
                    <span className="hp-feat-ico"><Ico d={CHECK_D} /></span>
                    <p className="text-slate-900 font-semibold text-[1rem] mt-4">{s.t}</p>
                    <p className="text-slate-500 text-[0.875rem] mt-1.5 leading-relaxed">{s.d}</p>
                  </div>
                ))}
              </div>

              <div className="mt-16 max-w-2xl" data-hp-head>
                <div><Eyebrow dark={false}>Built for</Eyebrow></div>
                <h2 className="rd-h2 text-slate-900 text-[clamp(1.6rem,3vw,2.1rem)] mt-3">Any team that shows up as one brand.</h2>
              </div>
              <div className="mt-8 grid sm:grid-cols-2 gap-4">
                {[
                  { t: "Real estate teams & brokerages", d: "Every agent's card matches the brokerage brand, but leads from open houses and showings land with the right agent — not a shared inbox." },
                  { t: "Sales & account teams", d: "Reps hand out on-brand cards at every meeting and conference. Leads flow straight to their own dashboard, and you can see who's actually working the room." },
                  { t: "Agencies & studios", d: "New hires and freelancers get a card the moment they join — same polish as everyone else — and it's revoked the moment they leave." },
                  { t: "Multi-location businesses", d: "One brand across every office. Each location's staff gets their own card and contacts, while you keep a single view across all of them." },
                ].map((s, i) => (
                  <div key={s.t} className="hp-card" data-reveal style={{ transitionDelay: `${i * 70}ms` }}>
                    <p className="text-slate-900 font-semibold text-[0.9375rem]">{s.t}</p>
                    <p className="text-slate-500 text-[0.84375rem] mt-1.5 leading-relaxed">{s.d}</p>
                  </div>
                ))}
              </div>

              <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3 text-slate-600 text-[0.875rem]" data-reveal>
                <span className="inline-flex items-center gap-2"><CheckDot />No cap on seats</span>
                <span className="inline-flex items-center gap-2"><CheckDot />One bill for the whole team</span>
                <span className="inline-flex items-center gap-2"><CheckDot />Add or remove people anytime</span>
              </div>
            </div>
          </section>
        )}

        {/* How it works — integrations only */}
        {slug === "integrations" && (
          <section className="relative py-20 sm:py-24 bg-white">
            <div className="relative max-w-5xl mx-auto px-5 sm:px-6">
              <div className="max-w-2xl" data-hp-head>
                <div><Eyebrow dark={false}>How it works</Eyebrow></div>
                <h2 className="rd-h2 text-slate-900 text-[clamp(1.9rem,3.6vw,2.6rem)] mt-3">From a handshake to your CRM — hands-off.</h2>
                <p className="text-slate-600 text-[1.05rem] mt-4 leading-relaxed">You never touch a spreadsheet. The second a lead comes in, SwiftCard captures the full context and routes it everywhere it needs to go — while you&rsquo;re still shaking hands.</p>
              </div>
              <div className="mt-12 grid md:grid-cols-3 gap-4">
                {[
                  { n: "1", t: "They share their info", d: "A tap on Save Contact or a quick form on your card — no app to download, no typing your details out for them." },
                  { n: "2", t: "SwiftCard captures the context", d: "Name, email, phone, plus which card they scanned, when, and where you met — all attached to the lead automatically." },
                  { n: "3", t: "It lands in your stack", d: "Synced to Salesforce, GoHighLevel, Pipedrive, HubSpot or Google Contacts, piped to 6,000+ apps through Zapier, or exported as CSV — in real time, no manual step." },
                ].map((s, i) => (
                  <div key={s.n} className="hp-card" data-reveal style={{ transitionDelay: `${i * 80}ms` }}>
                    <span className="hp-step-num">{s.n}</span>
                    <p className="text-slate-900 font-semibold text-[1rem] mt-4">{s.t}</p>
                    <p className="text-slate-500 text-[0.875rem] mt-1.5 leading-relaxed">{s.d}</p>
                  </div>
                ))}
              </div>
              <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3 text-slate-600 text-[0.875rem]" data-reveal>
                <span className="inline-flex items-center gap-2"><CheckDot />Real-time — no nightly sync</span>
                <span className="inline-flex items-center gap-2"><CheckDot />No code required</span>
                <span className="inline-flex items-center gap-2"><CheckDot />Your data stays yours</span>
              </div>
            </div>
          </section>
        )}

        {/* CTA */}
        <MarketingCta>
          <h2 className="rd-display text-white text-[clamp(2.2rem,5vw,4rem)]">Ready to be unforgettable?</h2>
          <p className="text-white/85 text-[1.08rem] mt-4">Your free SwiftCard is 60 seconds away.</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/cards/new" className="hp-btn-white">Create your free card</Link>
            {slug === "teams" && <NativeHidden><Link href={GET_OFFICE_HREF} className="rd-btn border border-white/40 bg-white/10 text-white">Get Office for your team →</Link></NativeHidden>}
            <NativeHidden><Link href="/pricing" className="rd-btn border border-white/40 bg-white/10 text-white">See pricing</Link></NativeHidden>
          </div>
        </MarketingCta>
      </main>

      <SiteFooter />
    </div>
  );
}
