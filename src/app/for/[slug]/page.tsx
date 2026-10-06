import type { Metadata } from "next";
import Eyebrow from "@/components/site/Eyebrow";
import { notFound } from "next/navigation";
import Link from "next/link";
import SiteNav from "@/components/site/SiteNav";
import SiteFooter from "@/components/site/SiteFooter";
import ScrollReveal from "@/components/ScrollReveal";
import ScrollProgress from "@/components/ScrollProgress";
import { PersonaShowcase } from "@/components/site/HeroShowcase";
import NativeHidden from "@/components/NativeHidden";
import HomeHeadingReveal from "@/components/site/HomeHeadingReveal";
import MarketingCta from "@/components/site/MarketingCta";
import { PROFESSION_TEMPLATE } from "@/lib/campaign-links";
import "@/app/home.css";

// ── Vertical landing pages: /for/<industry> ──────────────────────────────────
//
// Growth surface (owner request 2026-08-19). The /products pages describe
// FEATURES; nothing on the site targeted what buyers actually type into
// Google — "digital business card for real estate agents", "... for
// contractors". Each entry here is one high-intent query, answered with copy
// written for that profession: their scenes, their pains, their words.
//
// SEO plumbing that must not rot:
//  - every slug is listed in src/app/sitemap.ts (FOR_SLUGS, kept in sync by
//    hand like PRODUCT_SLUGS is),
//  - SiteFooter links every page (orphan pages don't rank),
//  - each page emits FAQPage JSON-LD from its own faq[] — the FAQ copy IS the
//    structured data, one source, no drift.

type Vertical = {
  /** The audience, as it appears mid-sentence ("built for real estate agents"). */
  audience: string;
  /** Short label for pills/footer ("Real estate"). */
  label: string;
  metaTitle: string;
  metaDesc: string;
  h1: React.ReactNode;
  sub: string;
  pains: { t: string; d: string }[];
  scenes: { t: string; d: string }[];
  faq: { q: string; a: string }[];
  /** Which showcase persona plays this profession (ALL_PERSONAS key in HeroShowcase). */
  persona: string;
};

function A({ children }: { children: React.ReactNode }) {
  return <span className="hp-fill">{children}</span>;
}

const FOR_VERTICALS: Record<string, Vertical> = {
  "real-estate-agents": {
    audience: "real estate agents",
    persona: "realtor",
    label: "Real estate",
    metaTitle: "Digital Business Card for Real Estate Agents & Realtors",
    metaDesc: "The digital business card built for realtors: share it at open houses with a QR or tap, capture every buyer's info, and follow up automatically. Free to start.",
    h1: <>The digital business card that <A>works the open house</A> with you.</>,
    sub: "Every buyer who walks in can scan your QR, save your contact, and share theirs back — name, phone, email — straight into your pipeline with the property and time attached. No sign-in sheet, no lost paper cards.",
    pains: [
      { t: "The sign-in sheet lies", d: "Half the names are scribbles, half the numbers have a digit missing, and nobody transcribes it before Monday." },
      { t: "Paper cards get tossed", d: "You hand out 40 cards at a caravan; 38 hit a cupholder. The two that matter can't remember which agent you were." },
      { t: "Follow-up slips", d: "The buyer you clicked with on Sunday gets your first text on Thursday — after they've signed with someone faster." },
    ],
    scenes: [
      { t: "Open houses", d: "Print your QR by the door or hold up the Apple Wallet pass. Every visitor lands in your contacts tagged with where and when they scanned." },
      { t: "Showings & caravans", d: "Tap your NFC card on their phone — your card opens instantly, no app. Works when they're holding keys, a leash, and a coffee." },
      { t: "Listing presentations", d: "Your Swift Links page carries your active listings, reviews, and booking link — one URL that's always current, unlike a printed flyer." },
      { t: "Every email you send", d: "Swift Signature puts your live card at the bottom of every message — sellers and referrals save you in one tap." },
      { t: "Automatic follow-up", d: "Switch on a follow-up for a new lead and the emails and texts go out on your schedule while you're still hosting. Reply STOP compliance is built in." },
      { t: "Your brokerage brand", d: "On a team? SwiftCard Office keeps every agent's card on-brand while each keeps their own leads." },
    ],
    faq: [
      { q: "How do buyers share their info at an open house?", a: "They scan your QR code (printed, on your phone, or on your Apple Wallet pass), see your card, and tap \"Share your info\" — their name, phone, and email land in your SwiftCard contacts instantly, tagged with the time and source." },
      { q: "Do buyers need to download an app?", a: "No. Your card opens in their phone's browser. Saving your contact and sharing theirs back both work with zero installs." },
      { q: "Can it replace my open-house sign-in sheet?", a: "Yes — a printed QR by the door does the same job with typed, accurate contact details, and every entry is timestamped in your dashboard instead of on paper." },
      { q: "Does it work with my CRM?", a: "SwiftCard syncs leads to Salesforce, GoHighLevel, Pipedrive, HubSpot, and Google Contacts, connects to 6,000+ apps via Zapier, and exports CSV." },
      { q: "Is there a version for teams and brokerages?", a: "SwiftCard Office gives every agent an on-brand card with their own leads and analytics, managed from one admin dashboard with unlimited seats." },
    ],
  },
  contractors: {
    audience: "contractors",
    persona: "electrician",
    label: "Contractors",
    metaTitle: "Digital Business Card for Contractors & Trades",
    metaDesc: "A digital business card for contractors: share your card from the job site, collect homeowner info, show your work, and follow up automatically. No app needed.",
    h1: <>Win the job before you <A>leave the driveway</A>.</>,
    sub: "Tap your card on a homeowner's phone and they've got your number, your photos of past work, and a way to send you their details — before the next contractor even calls back.",
    pains: [
      { t: "Estimates go cold", d: "You quote ten jobs a week and the homeowners lose your card by the weekend. The callback never comes." },
      { t: "Your work is invisible", d: "Twenty years of great jobs, and all a new customer sees is a name on a magnet." },
      { t: "No time for follow-up", d: "You're on a roof at 7am, not writing check-in emails. Jobs go to whoever stays top-of-mind." },
    ],
    scenes: [
      { t: "At the estimate", d: "Tap your NFC card or show your QR — the homeowner saves your contact on the spot, and can send you theirs with a note about the job." },
      { t: "Your portfolio, one link", d: "Your Swift Links page shows job photos, reviews, licenses, and a \"request a quote\" button — a website's job without a website's cost." },
      { t: "On the truck & yard signs", d: "Put your QR on the truck door, yard signs, and invoices. Every scan is a tracked lead, not a hope." },
      { t: "Automatic follow-up", d: "Quoted a job? SwiftCard texts your follow-up on schedule so the customer hears from you before the competition." },
      { t: "Referrals that stick", d: "Happy customers share your card with one tap — the neighbor gets the real thing, not a garbled name." },
      { t: "Crews & subcontractors", d: "Give every crew lead a card under one brand with SwiftCard Office; every lead still lands in your account." },
    ],
    faq: [
      { q: "How does a homeowner get my card?", a: "They tap your NFC card or scan your QR — your card opens in their browser with a Save Contact button and your work photos. No app on either side." },
      { q: "Can I show pictures of my work?", a: "Yes. Your Swift Links page holds photo tiles, videos, reviews, and links — it's the portfolio page you never had to build a website for." },
      { q: "What happens when someone scans the QR on my truck?", a: "The scan is tracked (time and source), they see your card, and they can send you their name, phone, email, and a note about the job — it all lands in your SwiftCard contacts." },
      { q: "Does it cost anything to start?", a: "The card, QR sharing, contact capture, your links page, and follow-up emails are free. Pro adds unlimited links, follow-up texts, AI-written messages, and full analytics." },
      { q: "Can my whole crew be on one account?", a: "SwiftCard Office puts every crew member's card under your brand with one bill and one dashboard, unlimited seats." },
    ],
  },
  "insurance-agents": {
    audience: "insurance agents",
    persona: "insurance",
    label: "Insurance",
    metaTitle: "Digital Business Card for Insurance Agents",
    metaDesc: "The digital business card for insurance agents: capture every prospect's details, stay compliant on follow-up texts, and keep your book growing. Free to start.",
    h1: <>Every conversation becomes a <A>contact in your book</A>.</>,
    sub: "Community events, referrals, walk-ins — one tap and their name, phone, and email are in your pipeline with automatic, opt-in follow-up that keeps you top-of-mind at renewal time.",
    pains: [
      { t: "Leads cost a fortune", d: "You pay per-lead prices for shared internet leads while the people you actually meet slip away unrecorded." },
      { t: "Renewal-time amnesia", d: "Prospects you met in March can't find your number in November when their premium jumps." },
      { t: "Compliance anxiety", d: "Texting prospects is powerful and risky — consent needs to be captured properly, every time." },
    ],
    scenes: [
      { t: "Community events & booths", d: "A QR on your table turns foot traffic into typed, accurate contact details — no fishbowl of business cards." },
      { t: "Referral partners", d: "Realtors and lenders share your card with one tap; you see exactly which partner sends you business." },
      { t: "Opt-in texting, built right", d: "A follow-up text goes only to a contact you've switched texts on for, confirming they agreed to hear from you — so your texts are permission-based." },
      { t: "Automatic touchpoints", d: "Sequences send your check-ins and renewal reminders on schedule, from you, without you." },
      { t: "Every policy line, one page", d: "Auto, home, life, commercial — your Swift Links page lays out what you write with a quote button for each." },
      { t: "Agency-wide cards", d: "SwiftCard Office keeps every producer on-brand with their own book of captured contacts." },
    ],
    faq: [
      { q: "How do I capture a prospect's information?", a: "They scan your QR or tap your card, then use \"Share your info\" — name, phone, email land in your SwiftCard contacts with the time and source attached." },
      { q: "Is the follow-up texting compliant?", a: "Sharing their details never signs anyone up for texts. A follow-up text goes only to a contact you've switched texts on for, confirming they agreed to hear from you, and every text honors STOP automatically." },
      { q: "Can I track which referral partners send me people?", a: "Yes — every share and scan is tagged with its source, so your dashboard shows exactly where each contact came from." },
      { q: "Does it integrate with my agency's CRM?", a: "Leads sync to Salesforce, GoHighLevel, Pipedrive, HubSpot, and Google Contacts, plus 6,000+ apps through Zapier and CSV export." },
      { q: "Can my whole agency use it?", a: "SwiftCard Office gives every producer an on-brand card, each with their own leads, under one admin dashboard and one bill." },
    ],
  },
  "loan-officers": {
    audience: "loan officers",
    persona: "loan-officer",
    label: "Loan officers",
    metaTitle: "Digital Business Card for Loan Officers & Mortgage Pros",
    metaDesc: "A digital business card for loan officers: capture borrower and realtor contacts at every meeting, share your pre-approval link, and follow up automatically.",
    h1: <>Be the lender they <A>actually remember</A> at pre-approval time.</>,
    sub: "Realtor mixers, first-time-buyer seminars, closings — one tap puts your contact in their phone and their details in your pipeline, with your application link one tap away.",
    pains: [
      { t: "Realtors juggle ten lenders", d: "The one who stays visible gets the referral. A paper card in a drawer doesn't stay visible." },
      { t: "Borrowers shop and vanish", d: "They rate-shop five lenders on Sunday and remember none by Wednesday." },
      { t: "Your app link is buried", d: "The pre-approval link lives in an email signature nobody scrolls to find." },
    ],
    scenes: [
      { t: "Realtor relationships", d: "Tap your card at every closing and caravan. Your Swift Links page carries your rates philosophy, reviews, and a partner-referral form." },
      { t: "Buyer seminars", d: "One QR on the last slide — every attendee lands in your pipeline instead of walking out with a flyer." },
      { t: "The application, one tap away", d: "Your pre-approval or application link sits on your card and links page — no digging through emails." },
      { t: "Automatic nurture", d: "Rate-watch check-ins and pre-approval reminders go out on schedule, so you're there when they're ready." },
      { t: "Compliant contact capture", d: "Sharing details never signs anyone up for texts — you switch texts on only for contacts who agreed, with STOP honored automatically." },
      { t: "Branch and team cards", d: "SwiftCard Office keeps every LO's card on brand and every lead attributed to the right person." },
    ],
    faq: [
      { q: "Can I put my application link on my card?", a: "Yes — your card and Swift Links page can link straight to your pre-approval or application page, so borrowers reach it in one tap." },
      { q: "How do I capture contacts at a seminar or mixer?", a: "Show your QR (on screen, printed, or from Apple Wallet). Everyone who scans can save your contact and share theirs back — typed, accurate, timestamped." },
      { q: "Will realtor partners actually use it?", a: "They just tap Save Contact like anyone else — and when they share your card to a buyer, the referral is tagged so you know who sent it." },
      { q: "Does it work with my CRM?", a: "Leads sync to Salesforce, GoHighLevel, Pipedrive, HubSpot, and Google Contacts, plus Zapier for the rest of your stack." },
      { q: "Is it free to try?", a: "Yes — the card, sharing, contact capture, and follow-up emails are free. Pro adds follow-up texts, AI-written messages, unlimited links, and full analytics." },
    ],
  },
  lawyers: {
    audience: "lawyers",
    persona: "lawyer",
    label: "Legal",
    metaTitle: "Digital Business Card for Lawyers & Law Firms",
    metaDesc: "A professional digital business card for attorneys: share your contact instantly, capture potential clients' details discreetly, and keep every referral warm.",
    h1: <>A card as <A>buttoned-up</A> as your practice.</>,
    sub: "Networking events, court hallways, referral lunches — share a polished card in one tap, and give potential clients a discreet way to send you their details and matter in their own words.",
    pains: [
      { t: "Referrals evaporate", d: "A colleague says \"I know someone\" — and the introduction dies in an unforwarded email." },
      { t: "Paper cards feel dated", d: "Your practice is modern; the card in your breast pocket is 1985." },
      { t: "Intake friction", d: "Potential clients hesitate at formal intake forms. A short, private message is an easier first step." },
    ],
    scenes: [
      { t: "Bar events & conferences", d: "One tap or scan and your details are saved — with your practice areas and bio one link deeper." },
      { t: "Referral network", d: "Colleagues share your card in one tap; you see which referrer sent each contact." },
      { t: "Discreet intake", d: "\"Share your info\" lets a potential client send name, contact, and a short note about their matter — privately, from their own phone." },
      { t: "Your firm page, current", d: "Swift Links holds your practice areas, publications, bar admissions, and consultation booking link — updated in seconds, not through a webmaster." },
      { t: "Email signature that works", d: "Swift Signature puts your live card under every email — clients save you without asking." },
      { t: "Firm-wide consistency", d: "SwiftCard Office keeps every attorney's card on the firm's brand with individual contact books." },
    ],
    faq: [
      { q: "Is this appropriate for a professional practice?", a: "Yes — the card is a clean, typographic design in your firm's colors with your headshot or firm logo, and the templates were built for professional services." },
      { q: "How do potential clients reach out?", a: "Your card has a \"Share your info\" form where they can send their name, contact details, and a short message — it lands privately in your SwiftCard contacts." },
      { q: "Can I list my practice areas and bar admissions?", a: "Your Swift Links page holds practice areas, bio, publications, admissions, and a consultation booking link — all on one URL you control." },
      { q: "Can the whole firm use one account?", a: "SwiftCard Office gives every attorney an on-brand card under one admin dashboard, each with their own captured contacts." },
      { q: "Do recipients need an app?", a: "No — your card opens in any phone's browser, and saving your contact is one tap." },
    ],
  },
  photographers: {
    audience: "photographers",
    persona: "photographer",
    label: "Photographers",
    metaTitle: "Digital Business Card for Photographers",
    metaDesc: "A digital business card for photographers: your portfolio, booking link, and contact in one tap. Capture inquiries at every shoot and event. Free to start.",
    h1: <>Your portfolio in their pocket, <A>one tap</A> after you meet.</>,
    sub: "Weddings, events, mini-session marathons — tap your card and they're looking at your work, your packages, and your booking link before you've packed the lens.",
    pains: [
      { t: "Inquiries go to Instagram DMs", d: "Where they drown. A guest loved your work at Saturday's wedding and by Monday can't find you." },
      { t: "Your best marketing is invisible", d: "Every event is a room full of potential clients watching you work — with no way to book you." },
      { t: "Link-in-bio sprawl", d: "Portfolio here, pricing there, booking somewhere else. Nobody clicks through three links." },
    ],
    scenes: [
      { t: "At every shoot", d: "Guests ask \"do you have a card?\" — tap, and your portfolio page is on their phone with a booking button." },
      { t: "One page, everything", d: "Swift Links holds your galleries, packages, testimonials, and calendar link — with video tiles that play your reel right on the page." },
      { t: "Second-shooter ready", d: "Your QR on a table card or welcome sign captures inquiries even while you're shooting." },
      { t: "Inquiries with context", d: "\"Share your info\" sends name, contact, and their event date straight into your inbox — tagged with where you met." },
      { t: "Follow-up on autopilot", d: "Post-event sequences deliver your \"lovely to meet you + booking link\" while the glow is fresh." },
      { t: "Your brand, your card", d: "Photo-first templates put your work on the card itself — it looks like you shot it." },
    ],
    faq: [
      { q: "Can my card show my photography?", a: "Yes — the Photo First template leads with your image, and your Swift Links page holds full galleries, video reels, and package tiles." },
      { q: "How do people book me from the card?", a: "Your booking or calendar link sits on your card and links page — one tap from meeting you to your calendar." },
      { q: "What happens at events where I'm busy shooting?", a: "A printed QR on a welcome sign or table card captures inquiries all night — every scan can save your contact and send theirs back." },
      { q: "Do clients need an app to see it?", a: "No — everything opens in their phone's browser instantly." },
      { q: "What does it cost?", a: "The card, portfolio page, contact capture, and follow-up emails are free. Pro adds unlimited link tiles, video previews, follow-up texts, and full analytics." },
    ],
  },
  "barbers-and-stylists": {
    audience: "barbers and stylists",
    persona: "barber",
    label: "Barbers & stylists",
    metaTitle: "Digital Business Card for Barbers, Stylists & Salons",
    metaDesc: "A digital business card for barbers and hair stylists: your booking link, your work, and your chair's schedule in one tap. Grow your book for free.",
    h1: <>Fill your chair with <A>one tap</A>.</>,
    sub: "Every fresh cut is a walking ad. Now the compliment — \"who does your hair?\" — ends with your card on their phone: your work, your prices, your booking link.",
    pains: [
      { t: "Word of mouth leaks", d: "\"I'll send you their info\" rarely arrives. Your best marketing dies in a group chat." },
      { t: "DM booking chaos", d: "Appointments buried in Instagram requests, no-shows with no numbers to confirm." },
      { t: "The booth is your business", d: "You need clients that follow YOU — not the shop's walk-ins." },
    ],
    scenes: [
      { t: "In the chair", d: "Client loves the cut? They tap your card, save you, and their friend books from the same link tonight." },
      { t: "Your book, one link", d: "Swift Links shows your cuts, colors, prices, and booking calendar — the page you'd put in your bio anyway, but yours." },
      { t: "Mirror QR", d: "A QR sticker on your mirror or station turns every client's wait into a follow, a save, or a booking." },
      { t: "New-client capture", d: "\"Share your info\" collects name and number so you can confirm appointments and fill cancellations by text." },
      { t: "Rebooking on autopilot", d: "\"Time for a touch-up?\" texts go out on your schedule — permission-based, STOP honored." },
      { t: "Move shops, keep clients", d: "Your card and link are yours. Change chairs and your whole book comes with you." },
    ],
    faq: [
      { q: "How do clients book from my card?", a: "Your booking link (Booksy, Square, StyleSeat, or any URL) sits front and center on your card and links page — one tap to your calendar." },
      { q: "Can I show my work?", a: "Yes — your Swift Links page holds photo and video tiles of your cuts and colors, laid out like a portfolio." },
      { q: "What's the mirror QR idea?", a: "Download your card's QR, stick it on your mirror or station, and every client can save you, follow you, or book their next appointment while they're in the chair." },
      { q: "If I move to a different shop, do I lose anything?", a: "No — the card, the link, and every captured contact belong to you, not the shop." },
      { q: "Is it really free?", a: "The card, booking link, portfolio page, and contact capture are free. Pro adds unlimited tiles, videos, rebooking texts, and analytics." },
    ],
  },
  "car-salespeople": {
    audience: "car salespeople",
    persona: "cars",
    label: "Auto sales",
    metaTitle: "Digital Business Card for Car Salespeople",
    metaDesc: "A digital business card for auto sales: every test drive and lot visit becomes a saved contact with automatic follow-up. Beat the follow-up game. Free to start.",
    h1: <>They walked the lot with you. <A>Stay in the deal.</A></>,
    sub: "Most buyers visit twice before they sign — and buy from whoever follows up first. One tap puts you in their phone and them in your pipeline, with follow-up that runs itself.",
    pains: [
      { t: "Be-backs don't come back", d: "\"We're still looking\" means they'll buy where someone remembered them. Usually not you." },
      { t: "Ups get lost", d: "Saturday's ten test drives are Monday's three names you can read." },
      { t: "The dealership owns the lead", d: "CRM entries belong to the store. Your relationships should follow your career." },
    ],
    scenes: [
      { t: "On the test drive", d: "Before they leave the lot: tap, saved, and their number is in your pipeline with the model they drove in the notes." },
      { t: "Your inventory link", d: "Swift Links can point to your current inventory, your reviews, and your direct booking link for appointments." },
      { t: "Follow-up that runs itself", d: "Day-2 check-in, day-7 \"still available\" note — sent from you, on schedule, while you work the floor." },
      { t: "Referral engine", d: "Happy buyers share your card in one tap. The cousin looking for a truck lands in your contacts, tagged as a referral." },
      { t: "Service-lane mining", d: "A QR at your desk turns service customers into trade-in conversations." },
      { t: "Your book, portable", d: "Change dealerships and your card, link, and contacts come with you." },
    ],
    faq: [
      { q: "How do I capture a buyer's info on the lot?", a: "They scan your QR or tap your card, then \"Share your info\" sends their name and number to your SwiftCard contacts — with time and source attached." },
      { q: "Can follow-up really be automatic?", a: "Yes — switch on a follow-up for a contact and it sends on schedule, from your name: emails on every plan, texts on Pro, with STOP compliance built in." },
      { q: "Do my contacts belong to me or the dealership?", a: "Your SwiftCard account is yours — the card, the link, and every contact in it stay with you wherever you sell." },
      { q: "Do buyers need to install anything?", a: "No — your card opens in their browser, and saving your contact is one tap." },
      { q: "What's free and what's paid?", a: "The card, sharing, contact capture, and follow-up emails are free. Pro adds follow-up texts, AI-written messages, unlimited links, and full analytics." },
    ],
  },
};

export function generateStaticParams() {
  return Object.keys(FOR_VERTICALS).map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const v = FOR_VERTICALS[slug];
  if (!v) return { title: "SwiftCard" };
  const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://swiftcard.me";
  return {
    title: `${v.metaTitle} | SwiftCard`,
    description: v.metaDesc,
    alternates: { canonical: `${APP_URL}/for/${slug}` },
    openGraph: { title: v.metaTitle, description: v.metaDesc, url: `${APP_URL}/for/${slug}`, siteName: "SwiftCard" },
  };
}

export default async function VerticalPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const v = FOR_VERTICALS[slug];
  if (!v) notFound();

  const src = `for_${slug.replace(/-/g, "_")}`;
  // The builder opens on the design this page just showed them.
  const builderHref = `/cards/new?src=${src}${PROFESSION_TEMPLATE[slug] ? `&template=${PROFESSION_TEMPLATE[slug]}` : ""}`;
  // The FAQ copy IS the structured data — one source, no drift.
  const faqJsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: v.faq.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };

  return (
    <div className="bg-white">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }} />
      <ScrollProgress />
      <ScrollReveal />
      <HomeHeadingReveal />
      <SiteNav />
      {/* One gradient every scene icon strokes with (homepage IconGradient pattern). */}
      <svg width="0" height="0" className="absolute" aria-hidden="true">
        <defs>
          <linearGradient id="for-ico" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#1D3FB8" />
            <stop offset="50%" stopColor="#2563EB" />
            <stop offset="100%" stopColor="#4DA8F5" />
          </linearGradient>
        </defs>
      </svg>

      <main className="hp overflow-clip">
        {/* Hero */}
        <section className="hp-page-hero pt-32 pb-20 sm:pt-40 sm:pb-24">
          <div className="relative max-w-6xl mx-auto px-5 sm:px-6 grid lg:grid-cols-2 gap-14 items-center">
            <div className="min-w-0">
              <div data-hp-head>
                <span className="hp-kicker">SwiftCard for {v.label.toLowerCase()}</span>
                <h1 className="rd-display text-slate-900 text-[clamp(2.3rem,5vw,3.8rem)] mt-5">{v.h1}</h1>
                <p className="hp-lede !text-[1.12rem] mt-5 max-w-[560px]">{v.sub}</p>
              </div>
              <div className="mt-8 flex flex-wrap gap-3" data-reveal>
                <Link href={builderHref} className="rd-btn rd-btn-primary rd-btn-lg">Create your free card</Link>
                <NativeHidden><Link href="/pricing" className="rd-btn rd-btn-ghost-l rd-btn-lg">See pricing</Link></NativeHidden>
              </div>
              <p className="text-slate-500 text-[0.8125rem] mt-5" data-reveal>Free to start · No app for them to download · Live in 60 seconds</p>
            </div>
            <div data-reveal="scale">
              {/* This profession's OWN SwiftCard, exactly as the product renders
                  it (owner order 2026-08-26): the card page in a phone, the
                  Swift Links page, and the Swift Signature — all themed to the
                  persona this page speaks to. */}
              <div className="hidden md:flex justify-center"><PersonaShowcase personaKey={v.persona} scale={0.82} /></div>
              <div className="md:hidden flex justify-center max-w-full overflow-hidden"><PersonaShowcase personaKey={v.persona} scale={0.46} /></div>
            </div>
          </div>
        </section>

        {/* Pains */}
        <section className="hp-soft relative py-20 sm:py-24">
          <div className="max-w-6xl mx-auto px-5 sm:px-6">
            <div className="max-w-2xl" data-hp-head>
              <h2 className="rd-h2 text-slate-900 text-[clamp(1.9rem,3.6vw,2.6rem)]">Sound familiar?</h2>
            </div>
            <div className="mt-10 grid sm:grid-cols-3 gap-4">
              {v.pains.map((p, i) => (
                <div key={p.t} className="hp-card" data-reveal style={{ transitionDelay: `${i * 70}ms` }}>
                  <p className="text-slate-900 font-semibold text-[1.0625rem]">{p.t}</p>
                  <p className="text-slate-500 text-[0.875rem] mt-1.5 leading-relaxed">{p.d}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Scenes — how this vertical actually uses it */}
        <section className="relative bg-white py-20 sm:py-24">
          <div className="relative max-w-5xl mx-auto px-5 sm:px-6">
            <div className="max-w-2xl" data-hp-head>
              <div><Eyebrow dark={false}>Built for the way you work</Eyebrow></div>
              <h2 className="rd-h2 text-slate-900 text-[clamp(1.9rem,3.6vw,2.6rem)] mt-4">One card, everywhere {v.audience} win business.</h2>
            </div>
            <div className="mt-12 grid md:grid-cols-3 gap-4">
              {v.scenes.map((s, i) => (
                <div key={s.t} className="hp-card" data-reveal style={{ transitionDelay: `${i * 70}ms` }}>
                  <span className="hp-feat-ico mb-4">
                    <svg viewBox="0 0 24 24" className="w-[18px] h-[18px]" fill="none" stroke="url(#for-ico)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 7L9.5 17.5 4 12" /></svg>
                  </span>
                  <p className="text-slate-900 font-semibold text-[1.0625rem]">{s.t}</p>
                  <p className="text-slate-500 text-[0.875rem] mt-1.5 leading-relaxed">{s.d}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* FAQ — the JSON-LD above is generated from exactly this list */}
        <section className="hp-soft relative py-20 sm:py-24">
          <div className="max-w-3xl mx-auto px-5 sm:px-6">
            <div data-hp-head>
              <h2 className="rd-h2 text-slate-900 text-[clamp(1.9rem,3.6vw,2.6rem)]">Questions {v.audience} ask</h2>
            </div>
            <div className="mt-10 flex flex-col gap-3">
              {v.faq.map((f, i) => (
                <details key={f.q} className="group rounded-2xl border border-[rgba(11,16,34,0.08)] bg-white px-6 py-5 transition-shadow hover:shadow-[0_20px_40px_-28px_rgba(29,63,184,0.3)]" data-reveal style={{ transitionDelay: `${i * 50}ms` }}>
                  {/* Same hit-area fix as site/FaqAccordion: the negative
                      margins cancel the padding, so the row looks identical and
                      all of it is clickable. */}
                  <summary className="cursor-pointer list-none flex items-center justify-between gap-4 -mx-6 -my-5 px-6 py-5">
                    <span className="text-slate-900 font-semibold text-[0.96875rem]">{f.q}</span>
                    <span aria-hidden="true" className="text-slate-500 text-xl leading-none transition-transform group-open:rotate-45 shrink-0">+</span>
                  </summary>
                  <p className="text-slate-500 text-[0.90625rem] mt-3 leading-relaxed">{f.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* CTA */}
        <div className="pt-16 sm:pt-20">
          <MarketingCta>
            <h2 className="rd-display text-white text-[clamp(2.2rem,5vw,4rem)]">Your next client is one tap away.</h2>
            <p className="text-white/85 text-[1.15rem] mt-5 max-w-[480px]">The digital business card built for {v.audience} — free in 60 seconds.</p>
            <div className="mt-9 flex flex-wrap items-center gap-3">
              <Link href={builderHref} className="hp-btn-white">Create your free card</Link>
              <NativeHidden><Link href="/pricing" className="rd-btn border border-white/40 bg-white/10 text-white">See pricing</Link></NativeHidden>
            </div>
          </MarketingCta>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
