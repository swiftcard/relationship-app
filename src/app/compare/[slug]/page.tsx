import type { Metadata } from "next";
import Eyebrow from "@/components/site/Eyebrow";
import { notFound } from "next/navigation";
import Link from "next/link";
import SiteNav from "@/components/site/SiteNav";
import SiteFooterMini from "@/components/site/SiteFooterMini";
import FaqAccordion from "@/components/site/FaqAccordion";
import ScrollProgress from "@/components/ScrollProgress";
import ScrollReveal from "@/components/ScrollReveal";
import NativeHidden from "@/components/NativeHidden";
import HomeHeadingReveal from "@/components/site/HomeHeadingReveal";
import "@/app/home.css";

// ── Competitor-alternative pages: /compare/<x>-alternative ──────────────────
//
// Growth surface (owner directive 2026-08-19, phase 2). The /compare hub
// answers "how do these stack up"; these pages each own ONE high-intent
// query — "linktree alternative", "popl alternative" — typed by people who
// already want the product and are choosing a brand.
//
// Honesty rules, same as the hub:
//  - Competitor facts come from their public pricing/feature pages as of
//    publish, say so on the page, and stay conservative — a wrong claim about
//    a competitor is both a credibility and a legal problem.
//  - Rows quoting OUR price are wrapped in NativeHidden (App Review 3.1.1:
//    the iOS shell must not show our pricing).
//  - The FAQ copy doubles as FAQPage JSON-LD, one source.
//
// SEO plumbing: slugs live in src/app/sitemap.ts (COMPARE_SLUGS), the hub
// links every page, and each page cross-links its siblings.

type Row = { label: string; swiftcard: string; them: string; pricing?: true };

type Competitor = {
  name: string;
  metaTitle: string;
  metaDesc: string;
  heroSub: string;
  /** The one-paragraph honest positioning: what they're good at, where SwiftCard differs. */
  honest: string;
  rows: Row[];
  switchReasons: { t: string; d: string }[];
  /** "Switching from X" — 3 concrete steps. Claims stay on OUR side of the
   *  fence (what you do in SwiftCard), never specific about the competitor's
   *  UI, which we don't control and can't keep verified. */
  migration: { intro: string; steps: { t: string; d: string }[] };
  faq: { q: string; a: string }[];
};

const SHARED_ROWS: Row[] = [
  { label: "Starting price", swiftcard: "Free", them: "" }, // `them` filled per competitor
];

void SHARED_ROWS; // rows are authored per competitor below; kept for reference

const COMPETITORS: Record<string, Competitor> = {
  "linktree-alternative": {
    name: "Linktree",
    metaTitle: "Linktree Alternative — Link in Bio + Digital Business Card",
    metaDesc: "SwiftCard is the Linktree alternative that adds a digital business card, contact capture, and automated follow-up to your link-in-bio page. Free to start.",
    heroSub: "Linktree shows your links. SwiftCard shows your links AND captures who's looking — every visitor can save your contact and send you theirs, with follow-up that runs itself.",
    honest: "Linktree is a fine link-in-bio tool — that's the whole product. If all you need is a list of links, it does the job. People switch to SwiftCard when the page needs to WORK: a business card visitors can save to their phone, a form that sends their details back to you, and automatic follow-up — none of which is what Linktree is built for.",
    rows: [
      { label: "Link-in-bio page", swiftcard: "✓ (Swift Links)", them: "✓" },
      { label: "Digital business card (save to contacts)", swiftcard: "✓", them: "✗" },
      { label: "Visitor shares their contact info back", swiftcard: "✓", them: "✗" },
      { label: "Built-in lead CRM (notes, history)", swiftcard: "✓", them: "✗" },
      { label: "Automated follow-up (email + text)", swiftcard: "✓", them: "✗" },
      { label: "NFC tap-to-share", swiftcard: "✓", them: "✗" },
      { label: "Starting price", swiftcard: "Free", them: "Free (12% fee on storefront sales)" },
      { label: "Cheapest paid plan", swiftcard: "$4.99/mo", them: "$8/mo (Starter)", pricing: true },
    ],
    switchReasons: [
      { t: "Your bio link becomes a lead machine", d: "Same job Linktree does — links, socials, video tiles — plus a Connect button that puts the visitor's name, phone, and email in your contacts." },
      { t: "You exist in their phone", d: "A Linktree visit ends when they close the tab. A SwiftCard visit can end with your card saved in their contacts." },
      { t: "Follow-up happens without you", d: "New contact → your email and text sequence starts. Linktree has no concept of a contact, let alone following up with one." },
    ],
    migration: {
      intro: "No import file needed — a link-in-bio page is rebuilt, not migrated. Most people are done in about ten minutes.",
      steps: [
        { t: "Build your free card", d: "Create your SwiftCard at swiftcard.me/cards/new — name, photo, socials. Your Swift Links page is generated with it automatically." },
        { t: "Add your links as tiles", d: "Copy the links from your current bio page into the Socials step. Featured tiles pull preview images automatically, and headers keep long lists organized." },
        { t: "Swap the link in your bios", d: "Replace the old URL in Instagram, TikTok, and X with your swiftcard.me/links address. From that moment every visitor can also save your card and share their info back." },
      ],
    },
    faq: [
      { q: "Does SwiftCard have a link-in-bio page like Linktree?", a: "Yes — every card includes a Swift Links page: your photo, bio, social icons, video previews, and custom link tiles, with themes ('Looks') you pick in one tap. It's what you put in your Instagram or TikTok bio." },
      { q: "What does SwiftCard have that Linktree doesn't?", a: "A digital business card visitors save to their phone in one tap, a share-back form that captures their name/phone/email into your contacts, a built-in lead CRM, automated email and text follow-up, and NFC/QR/Apple Wallet sharing." },
      { q: "Can I move my Linktree links over?", a: "Yes — add the same links as tiles on your Swift Links page in the card editor; featured tiles pull preview images automatically. Most people finish in under ten minutes." },
      { q: "Is SwiftCard free like Linktree?", a: "Yes — the card, the links page, QR/link sharing, and contact capture are free. Pro adds unlimited link tiles, video previews, themes, automation, and analytics." },
      { q: "Do my visitors need an app?", a: "No — everything opens in the browser on any phone. Saving your contact and sharing theirs back are both one tap, no installs." },
    ],
  },
  "popl-alternative": {
    name: "Popl",
    metaTitle: "Popl Alternative — Digital Business Card with Built-In Follow-Up",
    metaDesc: "SwiftCard is the Popl alternative with automated email + text follow-up built in — no extra tools. Digital card, NFC, QR, lead capture. Free to start.",
    heroSub: "Popl shares your card. SwiftCard shares your card and then follows up — automated email and text sequences to every captured lead, built in, not bolted on through integrations.",
    honest: "Popl is a solid digital business card with a strong hardware line — if you mainly want branded NFC accessories, they do that well. People switch to SwiftCard for what happens after the tap: a built-in CRM and automated email + text follow-up sequences that Popl expects you to assemble from third-party integrations.",
    rows: [
      { label: "Digital business card", swiftcard: "✓", them: "✓" },
      { label: "NFC tap-to-share", swiftcard: "✓ (works with any blank NFC tag)", them: "✓ (their branded hardware)" },
      { label: "Lead capture (share-back form)", swiftcard: "✓", them: "✓" },
      { label: "Built-in lead CRM (notes, history, follow-ups)", swiftcard: "✓", them: "Via 3rd-party integrations" },
      { label: "Automated follow-up sequences (email + text)", swiftcard: "✓", them: "✗" },
      { label: "Link-in-bio page included", swiftcard: "✓ (Swift Links)", them: "Limited" },
      { label: "Starting price", swiftcard: "Free", them: "Free" },
      { label: "Cheapest paid plan", swiftcard: "$4.99/mo", them: "$7.99/mo (Pro)", pricing: true },
    ],
    switchReasons: [
      { t: "Follow-up is the product, not a plug-in", d: "Captured a lead at 2pm? Your check-in text goes out on schedule without Zapier, webhooks, or a second subscription." },
      { t: "No hardware required", d: "SwiftCard writes to any blank NFC tag (a few dollars online) — or skips hardware entirely with QR, link, and Apple Wallet." },
      { t: "One plan, everything in it", d: "Card + links page + CRM + automation + analytics in one subscription, instead of a card app plus the tools to make it useful." },
    ],
    migration: {
      intro: "Your card's content is your own details — nothing is locked in. Rebuild takes minutes, and your NFC hardware can come with you.",
      steps: [
        { t: "Create your card free", d: "Enter the same details at swiftcard.me/cards/new — name, title, company, socials — and pick a design. No hardware required to start." },
        { t: "Re-point your NFC tag", d: "SwiftCard writes your new card link to any NFC tag, including hardware you already own. The tag stores a link, so it keeps working every time you edit the card." },
        { t: "Turn on follow-up", d: "Switch on your email and text follow-up for each new lead — it sends on schedule, STOP-compliant." },
      ],
    },
    faq: [
      { q: "Can I keep using my NFC card or tag?", a: "Yes — SwiftCard writes your card link to any NFC tag, including ones you already own. Tags store the link, so your card keeps working even after you edit it." },
      { q: "What does SwiftCard automate that Popl doesn't?", a: "Follow-up: when a lead shares their info, switch on your email and text sequence for them and SwiftCard sends it on schedule (STOP-compliant). With Popl you'd wire that through third-party tools." },
      { q: "How does pricing compare?", a: "Both start free. SwiftCard Pro is $4.99/month; Popl Pro lists at $7.99/month. Team plans: SwiftCard is $3.99/seat (min 2), Popl $5/user (min 5). Verify current pricing with them — plans change." },
      { q: "Do I need to buy anything to switch?", a: "No — create your card free, and share by QR, link, or Apple Wallet immediately. NFC is optional." },
      { q: "Can my team switch together?", a: "SwiftCard Office gives every teammate an on-brand card with their own leads under one admin dashboard, unlimited seats." },
    ],
  },
  "blinq-alternative": {
    name: "Blinq",
    metaTitle: "Blinq Alternative — Digital Business Card That Follows Up",
    metaDesc: "SwiftCard is the Blinq alternative with a built-in lead CRM and automated email + text follow-up. Card, QR, NFC, link-in-bio — one plan. Free to start.",
    heroSub: "Blinq makes a clean digital card. SwiftCard makes the card, captures the lead, and runs the follow-up — the whole meeting-to-client pipeline in one product.",
    honest: "Blinq is a well-made digital business card with a generous free tier — as a card, it's good. People switch to SwiftCard when they want the card to feed a pipeline: a built-in CRM with notes and full history, email + text follow-ups you switch on for any contact, and a full link-in-bio page — instead of connecting separate tools for each.",
    rows: [
      { label: "Digital business card", swiftcard: "✓", them: "✓" },
      { label: "Custom card designer", swiftcard: "✓ (Pro, incl. AI copy-my-card)", them: "✓" },
      { label: "NFC tap-to-share", swiftcard: "✓", them: "✓" },
      { label: "Built-in lead CRM (notes, history, follow-ups)", swiftcard: "✓", them: "Via 3rd-party integrations" },
      { label: "Automated follow-up sequences (email + text)", swiftcard: "✓", them: "✗" },
      { label: "Link-in-bio page included", swiftcard: "✓ (Swift Links)", them: "Limited" },
      { label: "Starting price", swiftcard: "Free", them: "Free" },
      { label: "Cheapest paid plan", swiftcard: "$4.99/mo", them: "~$3–10/mo (Premium, by billing term)", pricing: true },
    ],
    switchReasons: [
      { t: "The card feeds a real pipeline", d: "Every captured contact lands in a built-in CRM with notes, tags, and follow-up status — not a CSV you promise yourself you'll import somewhere." },
      { t: "Follow-up runs itself", d: "Switch on an email or text follow-up for any new lead and it sends on schedule, STOP-compliant, from your name." },
      { t: "A real link-in-bio, included", d: "Swift Links replaces your Linktree too: themes, video tiles, section headers, and per-page design — one subscription fewer." },
    ],
    migration: {
      intro: "A digital card rebuilds from the details you already know by heart — and SwiftCard's AI can even copy a card's design from a photo.",
      steps: [
        { t: "Rebuild the card", d: "Enter your details at swiftcard.me/cards/new and pick a template — or, on Pro, upload a picture of any card design and the AI designer rebuilds it with your info." },
        { t: "Re-share your new link", d: "Update the link anywhere you shared the old one — email signature, QR stickers, NFC tags (SwiftCard writes to any blank tag), and your bios." },
        { t: "Let the pipeline start", d: "New contacts land in the built-in CRM with notes and history, and the follow-up you switch on takes it from there." },
      ],
    },
    faq: [
      { q: "Can I recreate my Blinq card design on SwiftCard?", a: "Yes — pick from designer templates and customize colors, fonts, photo, and logo. Pro users can even upload a picture of any card design (including a physical card) and SwiftCard's AI rebuilds it with your details." },
      { q: "What does SwiftCard do after someone saves my card?", a: "They can share their info back; it lands in your built-in CRM tagged with time and source, and the email/text follow-up you switch on for them takes it from there — that whole after-the-tap layer is the difference." },
      { q: "How does pricing compare?", a: "Both start free. SwiftCard Pro is $4.99/month flat; Blinq Premium ranges roughly $3–10/month depending on billing term. Verify current pricing with them — plans change." },
      { q: "Does SwiftCard work without an app for the other person?", a: "Yes — your card opens in any browser; saving your contact and sharing theirs back are one tap, no installs." },
      { q: "Is there a team version?", a: "SwiftCard Office: on-brand cards for every teammate, individual lead books, one admin dashboard — $3.99/seat/month with a 2-seat minimum, unlimited seats." },
    ],
  },
  "hihello-alternative": {
    name: "HiHello",
    metaTitle: "HiHello Alternative — Digital Business Card with Automation",
    metaDesc: "SwiftCard is the HiHello alternative that adds automated email + text follow-up and a built-in lead CRM to your digital business card. Free to start.",
    heroSub: "HiHello makes tidy digital cards and email signatures. SwiftCard covers those — and then captures leads into a built-in CRM and follows up automatically.",
    honest: "HiHello does the fundamentals of digital cards well, including email signatures and multiple cards per person. People switch to SwiftCard for the layer HiHello doesn't focus on: built-in lead capture with a CRM, automated email + text follow-up sequences, and a full link-in-bio page — the parts that turn a card into new business.",
    rows: [
      { label: "Digital business card", swiftcard: "✓", them: "✓" },
      { label: "Multiple cards per account", swiftcard: "✓ (Pro)", them: "✓" },
      { label: "Email signature generator", swiftcard: "✓ (Swift Signature)", them: "✓" },
      { label: "Built-in lead CRM (notes, history, follow-ups)", swiftcard: "✓", them: "Via 3rd-party integrations" },
      { label: "Automated follow-up sequences (email + text)", swiftcard: "✓", them: "✗" },
      { label: "Link-in-bio page included", swiftcard: "✓ (Swift Links)", them: "Limited" },
      { label: "Starting price", swiftcard: "Free", them: "Free" },
      { label: "Cheapest paid plan", swiftcard: "$4.99/mo", them: "$6+/mo (Professional)", pricing: true },
    ],
    switchReasons: [
      { t: "From contact exchange to pipeline", d: "SwiftCard doesn't stop at swapping details — every captured contact gets notes, full history, and a follow-up sequence you can switch on in one tap." },
      { t: "Texting, done compliantly", d: "Follow-up texts are built in — sent only to contacts you've confirmed agreed to hear from you, with automatic STOP handling — not a separate SMS tool to buy and wire up." },
      { t: "The bio link is included", d: "Swift Links gives you the Instagram/TikTok bio page too — themes, video tiles, and analytics under the same roof." },
    ],
    migration: {
      intro: "Cards, signature, and bio link all rebuild from your own details — one product instead of several to keep in sync.",
      steps: [
        { t: "Create your card", d: "Build it free at swiftcard.me/cards/new. On Pro you can add a separate card per role — each with its own URL, design, and contact book." },
        { t: "Regenerate your signature", d: "Swift Signature turns the new card into an email signature for Gmail, Outlook, and Apple Mail — a live image that links to your card page." },
        { t: "Point your bio at Swift Links", d: "Your card comes with a link-in-bio page; put its URL in your social bios and retire the extra tool." },
      ],
    },
    faq: [
      { q: "Does SwiftCard do email signatures like HiHello?", a: "Yes — Swift Signature turns your card into an email signature for Gmail, Outlook, and Apple Mail: a live image of your card that links to your card page. It's on every plan." },
      { q: "What's the biggest difference from HiHello?", a: "What happens after the exchange: SwiftCard captures leads into a built-in CRM and runs automated email + text follow-up sequences. HiHello focuses on the card and signature; the pipeline layer is where SwiftCard goes further." },
      { q: "Can I have different cards for different roles?", a: "Yes — SwiftCard Pro includes unlimited cards, each with its own URL, design, links page, contacts, and analytics." },
      { q: "How does pricing compare?", a: "Both start free. SwiftCard Pro is $4.99/month; HiHello's paid plans start around $6/month. Verify current pricing with them — plans change." },
      { q: "Do recipients need the app?", a: "No — your card opens in the browser on any phone, and saving your contact is one tap." },
    ],
  },
  "mobilo-alternative": {
    name: "Mobilo",
    metaTitle: "Mobilo Alternative — Digital Business Card Without the Annual Contract",
    metaDesc: "SwiftCard is the Mobilo alternative with transparent monthly pricing, a free plan that needs no hardware, and built-in email + text follow-up. Free to start.",
    heroSub: "Mobilo sells NFC cards with an app attached. SwiftCard is the app first — free without hardware, priced monthly, with the lead capture and automated follow-up built in.",
    honest: "Mobilo makes good physical NFC cards and pitches mainly to companies rolling cards out to whole teams, with the software priced per user and billed annually. If you want a branded metal card for every employee, that's their strength. People switch to SwiftCard when they want to start free without buying a card, pay month to month, and have the follow-up run itself instead of living in a separate tool.",
    rows: [
      { label: "Digital business card", swiftcard: "✓", them: "✓" },
      { label: "Free plan without buying hardware", swiftcard: "✓", them: "✓ (digital wallet card)" },
      { label: "NFC tap-to-share", swiftcard: "✓ (works with any blank NFC tag)", them: "✓ (their branded cards)" },
      { label: "Lead capture (share-back form)", swiftcard: "✓", them: "✓" },
      { label: "Built-in lead CRM (notes, history)", swiftcard: "✓", them: "Basic; CRM sync on team plans" },
      { label: "Automated follow-up sequences (email + text)", swiftcard: "✓", them: "✗" },
      { label: "Link-in-bio page included", swiftcard: "✓ (Swift Links)", them: "✗" },
      { label: "Card link format", swiftcard: "swiftcard.me/FirstLast-Company", them: "Tracking-style redirect link" },
      { label: "Billing", swiftcard: "Monthly or annual, cancel anytime", them: "Paid plans billed annually" },
      { label: "Starting price", swiftcard: "Free", them: "Free" },
      { label: "Cheapest paid plan", swiftcard: "$4.99/mo", them: "$3/user/mo (Pro, billed annually)", pricing: true },
    ],
    switchReasons: [
      { t: "Pay month to month, leave in two taps", d: "SwiftCard Pro is a flat monthly (or annual, your choice) plan. On iPhone the subscription is billed by Apple and cancelled in Settings — no support ticket, no surprise renewal." },
      { t: "No card required, ever", d: "The free plan shares by QR, link, Apple Wallet and Apple Watch. Want NFC? SwiftCard writes to any blank tag, including cards you already own." },
      { t: "Follow-up runs itself", d: "Switch on your email and text sequence for any captured lead and it runs on schedule, STOP-compliant — not a task in your CRM for later." },
    ],
    migration: {
      intro: "Your card is your own details, and your Mobilo hardware stores a link — both come with you. Most people rebuild in about ten minutes.",
      steps: [
        { t: "Create your card free", d: "Enter your details at swiftcard.me/cards/new and pick a design — or, on Pro, upload a photo of your current card and the AI designer rebuilds it with your info." },
        { t: "Re-point your NFC card", d: "SwiftCard writes your new link to any NFC tag, including the card you already carry. It keeps working every time you edit your card." },
        { t: "Turn on follow-up", d: "Switch on your email and text sequence for a new contact and it sends on schedule from there." },
      ],
    },
    faq: [
      { q: "Do I need to buy a card to use SwiftCard?", a: "No. The free plan shares by QR code, link, Apple Wallet and Apple Watch. NFC is optional and works with any blank NFC tag, including hardware you already own." },
      { q: "Can I keep my Mobilo NFC card?", a: "Yes — an NFC card stores a link, and SwiftCard writes your new card link to any tag. Tap it and your SwiftCard opens." },
      { q: "How does pricing compare?", a: "Both start free. SwiftCard Pro is $4.99/month, or less on the annual plan, with a free trial. Mobilo's Pro plan lists at $3 per user per month billed annually, and their cards are sold separately. Verify current pricing with them — plans change." },
      { q: "How do I cancel SwiftCard?", a: "On iPhone, the subscription is managed by Apple — cancel in Settings → Subscriptions in two taps. On the web, cancel from Settings → Plan and billing. Either way it takes effect at the end of the period you paid for." },
      { q: "Does SwiftCard work for a team?", a: "Yes — SwiftCard Office gives every teammate an on-brand card with their own leads under one admin dashboard, $3.99 per seat per month with a 2-seat minimum." },
    ],
  },
  "linq-alternative": {
    name: "Linq",
    metaTitle: "Linq Alternative — Digital Business Card That Follows Up",
    metaDesc: "SwiftCard is the Linq alternative that starts free without hardware and adds a built-in lead CRM and automated email + text follow-up. One simple plan.",
    heroSub: "Linq pairs its cards and tags with a team-oriented platform. SwiftCard keeps it simple: a free card that needs no hardware, a link that looks like your name, and follow-up that runs itself.",
    honest: "Linq is an established digital-card company with a wide hardware line and a platform aimed increasingly at sales teams and enterprises, with per-seat plans to match. If you're buying for a large team with a sales-ops budget, they're worth a look. People switch to SwiftCard when they're one professional (or a small team) who wants to start free, pay one simple price, and get lead capture and automated follow-up without an enterprise rollout.",
    rows: [
      { label: "Digital business card", swiftcard: "✓", them: "✓" },
      { label: "Free plan without buying hardware", swiftcard: "✓", them: "✓ (basic)" },
      { label: "NFC tap-to-share", swiftcard: "✓ (works with any blank NFC tag)", them: "✓ (their products)" },
      { label: "Lead capture (share-back form)", swiftcard: "✓", them: "✓" },
      { label: "Built-in lead CRM (notes, history)", swiftcard: "✓", them: "✓ (paid plans)" },
      { label: "Automated follow-up sequences (email + text)", swiftcard: "✓", them: "Limited" },
      { label: "Link-in-bio page included", swiftcard: "✓ (Swift Links)", them: "Limited" },
      { label: "AI card designer (copy any card from a photo)", swiftcard: "✓ (Pro)", them: "✗" },
      { label: "Starting price", swiftcard: "Free", them: "Free" },
      { label: "Cheapest paid plan", swiftcard: "$4.99/mo", them: "Paid plans priced per seat; see their site", pricing: true },
    ],
    switchReasons: [
      { t: "One price, everything in it", d: "Card, Swift Links page, lead CRM, automation, analytics and Apple Wallet — one flat plan, no per-seat tiers to decode." },
      { t: "Your link is your name", d: "Cards live at swiftcard.me/FirstLast-Company. The person you meet sees who you are before they tap." },
      { t: "Follow-up without a sales-ops team", d: "Switch on your email and text sequence for any captured lead and it sends on schedule, STOP-compliant." },
    ],
    migration: {
      intro: "A digital card rebuilds from details you already know, and your NFC hardware stores a link that SwiftCard can overwrite. Ten minutes, start to finish.",
      steps: [
        { t: "Rebuild the card", d: "Enter your details at swiftcard.me/cards/new and pick a template — or, on Pro, upload a picture of your current card and the AI designer rebuilds it." },
        { t: "Re-point your tags", d: "SwiftCard writes your new link to any NFC tag or card you already own, so the hardware keeps working." },
        { t: "Update the link everywhere", d: "Email signature, QR stickers and social bios — swap in your swiftcard.me link, and switch on follow-up so new contacts hear from you on schedule." },
      ],
    },
    faq: [
      { q: "Can I keep my Linq card or tag?", a: "Yes — NFC hardware stores a link, and SwiftCard writes your new card link to any tag. Tap it and your SwiftCard opens." },
      { q: "Is SwiftCard free?", a: "Yes — the card, QR and link sharing, Apple Wallet, contact capture and the Swift Links page are free. Pro adds automation, analytics, the AI designer and more." },
      { q: "How does pricing compare?", a: "SwiftCard Pro is $4.99/month flat, or less annually, with a free trial. Linq's paid plans are priced per seat and have changed recently — check their site for current figures. Plans change, so verify before deciding." },
      { q: "Do recipients need an app?", a: "No — your card opens in any browser; saving your contact and sharing theirs back are one tap, no installs." },
      { q: "Is there a team version?", a: "SwiftCard Office: on-brand cards for every teammate, individual lead books, one admin dashboard — $3.99 per seat per month with a 2-seat minimum, unlimited seats." },
    ],
  },
};

const ALL_SLUGS = Object.keys(COMPETITORS);

export function generateStaticParams() {
  return ALL_SLUGS.map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const c = COMPETITORS[slug];
  if (!c) return { title: "SwiftCard" };
  const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://swiftcard.me";
  return {
    title: `${c.metaTitle} | SwiftCard`,
    description: c.metaDesc,
    alternates: { canonical: `${APP_URL}/compare/${slug}` },
    openGraph: { title: c.metaTitle, description: c.metaDesc, url: `${APP_URL}/compare/${slug}`, siteName: "SwiftCard" },
  };
}

function Cell({ value, brand }: { value: string; brand?: boolean }) {
  const isCheck = value.startsWith("✓");
  const isCross = value === "✗";
  return (
    <td className={`px-4 py-4 text-sm text-center align-middle ${brand ? "font-semibold" : "text-slate-600"}`} style={brand ? { color: "#1D4ED8" } : undefined}>
      {/* Same as /compare: the glyph is the answer, so it gets a text
          equivalent and a shade you can actually see (✗ was slate-300, ~1.6:1). */}
      {isCross ? <><span aria-hidden="true" className="text-slate-500">✗</span><span className="sr-only">No</span></> : isCheck ? (
        <span><span aria-hidden="true" className="text-green-600 text-base">✓</span><span className="sr-only">Yes</span>{value.length > 1 ? <span className="text-slate-500 text-xs"> {value.slice(1).trim()}</span> : null}</span>
      ) : value}
    </td>
  );
}

export default async function AlternativePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const c = COMPETITORS[slug];
  if (!c) notFound();

  const src = `alt_${slug.replace(/-/g, "_")}`;
  const faqJsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: c.faq.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
  };

  return (
    // bg-cream stays only for the native shell's status-bar canvas rule in
    // globals.css (html.native-app:has(main.bg-cream)); .hp paints the page
    // itself white (owner, 2026-09-17: light pages, no cream).
    <main className="hp sc-canvas-white min-h-screen bg-cream flex flex-col">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }} />
      <ScrollProgress />
      <ScrollReveal />
      <HomeHeadingReveal />
      <SiteNav />

      {/* Hero */}
      <section className="hp-page-hero text-center px-5 sm:px-6 pt-28 sm:pt-36 pb-14">
        <div className="relative" data-hp-head>
          <div className="mb-4"><Eyebrow dark={false}>Comparison</Eyebrow></div>
          <h1 className="rd-display text-[clamp(2.1rem,4.4vw,3rem)] text-slate-900 mb-4 [text-wrap:balance]">Looking for a {c.name} alternative?</h1>
          <p className="hp-lede max-w-xl mx-auto mb-2">{c.heroSub}</p>
          <p className="text-slate-500 text-xs max-w-xl mx-auto">
            {c.name} pricing/features sourced from their public pages and subject to change — confirm current details directly with them.
          </p>
          <div className="mt-7">
            <Link href={`/cards/new?src=${src}`} className="rd-btn rd-btn-primary rd-btn-lg">
              Try SwiftCard free →
            </Link>
          </div>
        </div>
      </section>

      {/* Table */}
      <div className="hp-soft">
      <section className="max-w-3xl mx-auto w-full px-5 sm:px-6 pt-14 pb-16">
        {/* Phones: the table is wider than the screen, so say it swipes and
            fade the cut edge — without this the competitor columns are simply
            invisible on a phone (owner mobile pass, 2026-09-17). */}
        <p className="sm:hidden mb-2 flex items-center gap-1.5 text-[0.8125rem] font-medium text-slate-500">
          Swipe the table to compare
          <span aria-hidden="true">→</span>
        </p>
        <div className="relative">
        <div className="relative overflow-x-auto rounded-3xl border border-slate-200 bg-white shadow-[0_18px_40px_-28px_rgba(15,23,42,0.3)]">
          <table className="w-full border-collapse min-w-[520px]">
            <thead>
              <tr className="border-b border-slate-200">
                <th className="px-4 py-4 text-left text-sm font-semibold text-slate-900 w-2/5">&nbsp;</th>
                <th className="px-4 py-4 text-sm font-bold text-center" style={{ color: "#1D4ED8" }}>SwiftCard</th>
                <th className="px-4 py-4 text-sm font-semibold text-slate-500 text-center">{c.name}</th>
              </tr>
            </thead>
            <tbody>
              {c.rows.map((row, i) => {
                const tr = (
                  <tr key={row.label} className={i % 2 === 1 ? "bg-[#F5F7FB]" : ""}>
                    <td className="px-4 py-4 text-sm font-medium text-slate-700">{row.label}</td>
                    <Cell value={row.swiftcard} brand />
                    <Cell value={row.them} />
                  </tr>
                );
                // Rows quoting OUR price are dropped inside the native shell (3.1.1).
                return row.pricing ? <NativeHidden key={row.label}>{tr}</NativeHidden> : tr;
              })}
            </tbody>
          </table>
        </div>
        {/* the cut edge, faded so it reads as "there is more" */}
        <span className="sm:hidden pointer-events-none absolute inset-y-0 right-0 w-10 rounded-r-3xl" style={{ background: "linear-gradient(90deg, rgba(255,255,255,0) 0%, #ffffff 92%)" }} aria-hidden="true" />
        </div>
        <p className="text-slate-600 text-[0.9375rem] leading-relaxed max-w-2xl mx-auto text-center mt-8">{c.honest}</p>
      </section>
      </div>

      {/* Why people switch */}
      <section className="max-w-4xl mx-auto w-full px-5 sm:px-6 pt-16 pb-16">
        <div data-hp-head>
          <h2 className="rd-h2 text-[clamp(1.6rem,3.2vw,2.3rem)] text-slate-900 text-center mb-8 [text-wrap:balance]">Why people switch</h2>
        </div>
        <div className="grid sm:grid-cols-3 gap-4">
          {c.switchReasons.map((r) => (
            <div key={r.t} className="hp-card">
              <p className="text-slate-900 font-semibold text-[0.9375rem]">{r.t}</p>
              <p className="text-slate-500 text-[0.84375rem] mt-1.5 leading-relaxed">{r.d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Switching — the migration path the page promises in search results */}
      <div className="hp-soft">
      <section className="max-w-4xl mx-auto w-full px-5 sm:px-6 pt-16 pb-16">
        <div data-hp-head>
          <h2 className="rd-h2 text-[clamp(1.6rem,3.2vw,2.3rem)] text-slate-900 text-center mb-3 [text-wrap:balance]">Switching from {c.name}</h2>
          <p className="text-slate-500 text-[0.9375rem] text-center max-w-xl mx-auto mb-8">{c.migration.intro}</p>
        </div>
        <div className="grid sm:grid-cols-3 gap-4">
          {c.migration.steps.map((st, i) => (
            <div key={st.t} className="hp-card">
              <p className="hp-kicker !text-[0.6875rem] mb-2">STEP {i + 1}</p>
              <p className="text-slate-900 font-semibold text-[0.9375rem]">{st.t}</p>
              <p className="text-slate-500 text-[0.84375rem] mt-1.5 leading-relaxed">{st.d}</p>
            </div>
          ))}
        </div>
      </section>
      </div>

      {/* FAQ — the JSON-LD above is generated from exactly this list */}
      <div className="pt-16">
      <FaqAccordion items={c.faq}>
        <Link href={`/cards/new?src=${src}`} className="rd-btn rd-btn-primary rd-btn-lg">
          Create your free card →
        </Link>
      </FaqAccordion>
      </div>

      {/* Sibling comparisons — internal links keep these pages crawlable and ranking */}
      <div className="hp-soft flex-1">
      <section className="max-w-2xl mx-auto w-full px-5 sm:px-6 pt-14 pb-16 text-center">
        <div className="mb-3"><Eyebrow dark={false}>More comparisons</Eyebrow></div>
        <div className="flex flex-wrap justify-center gap-2">
          <Link href="/compare" className="text-[0.8125rem] text-slate-600 hover:text-slate-900 hover:border-slate-300 rounded-full px-3.5 py-1.5 bg-white border border-slate-200 transition-colors">Full comparison table</Link>
          <Link href="/business-card-view-tracking" className="text-[0.8125rem] text-slate-600 hover:text-slate-900 hover:border-slate-300 rounded-full px-3.5 py-1.5 bg-white border border-slate-200 transition-colors">Card view tracking</Link>
          <Link href="/link-in-bio-with-analytics" className="text-[0.8125rem] text-slate-600 hover:text-slate-900 hover:border-slate-300 rounded-full px-3.5 py-1.5 bg-white border border-slate-200 transition-colors">Link in bio with analytics</Link>
          {ALL_SLUGS.filter((s) => s !== slug).map((s) => (
            <Link key={s} href={`/compare/${s}`} className="text-[0.8125rem] text-slate-600 hover:text-slate-900 hover:border-slate-300 rounded-full px-3.5 py-1.5 bg-white border border-slate-200 transition-colors">
              {COMPETITORS[s].name} alternative
            </Link>
          ))}
        </div>
      </section>
      </div>

      <SiteFooterMini />
    </main>
  );
}
