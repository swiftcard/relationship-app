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
import { PLAN_LIMITS, PLAN_PRICES } from "@/lib/plan";
import { formatUsd } from "@/lib/currency";

// SwiftCard's own figures come from lib/plan, so a price change can't leave
// these pages advertising the old one (audit F-MKT-01). Competitors' stay literal.
const PRO = formatUsd(PLAN_PRICES.PRO_MONTHLY_CENTS);
const SEAT = formatUsd(PLAN_PRICES.OFFICE_MONTHLY_PER_SEAT_CENTS);
const MIN_SEATS = PLAN_LIMITS.OFFICE_MIN_SEATS;

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
    metaTitle: "Linktree Alternative: Link-in-Bio Page + Digital Business Card",
    metaDesc: "SwiftCard is the Linktree alternative that adds a digital business card, contact capture, and automated follow-up to your link-in-bio page. Free to start.",
    heroSub: "Linktree shows your links. SwiftCard shows your links and also captures who's looking. Every visitor can save your contact and send you theirs, and the follow-up runs itself.",
    honest: "Linktree is a fine link-in-bio tool, and that's the whole product. If all you need is a list of links, it does the job. People switch to SwiftCard when they need the page to do more: a business card visitors can save to their phone, a form that sends their details back to you, and automatic follow-up. Linktree isn't built for any of those.",
    rows: [
      { label: "Link-in-bio page", swiftcard: "✓ (Swift Links)", them: "✓" },
      { label: "Digital business card (save to contacts)", swiftcard: "✓", them: "✗" },
      { label: "Visitor shares their contact info back", swiftcard: "✓", them: "✗" },
      { label: "Built-in lead CRM (notes, history)", swiftcard: "✓", them: "✗" },
      { label: "Automated follow-up (email + text)", swiftcard: "✓", them: "✗" },
      { label: "NFC tap-to-share", swiftcard: "✓", them: "✗" },
      { label: "Starting price", swiftcard: "Free", them: "Free (12% fee on storefront sales)" },
      { label: "Cheapest paid plan", swiftcard: `${PRO}/mo`, them: "$8/mo (Starter)", pricing: true },
    ],
    switchReasons: [
      { t: "Your bio link becomes a lead machine", d: "It does the same job Linktree does (links, socials, video tiles) and adds a \"Connect\" button that puts the visitor's name, phone, and email in your contacts." },
      { t: "You exist in their phone", d: "A Linktree visit ends when they close the tab. A SwiftCard visit can end with your card saved in their contacts." },
      { t: "Follow-up happens without you", d: "When a new contact comes in, your email and text sequence starts. Linktree has no concept of a contact, let alone following up with one." },
    ],
    migration: {
      intro: "You rebuild a link-in-bio page rather than import it, so there's no file to export. Most people are done in about ten minutes.",
      steps: [
        { t: "Build your free card", d: "Create your SwiftCard at swiftcard.me/cards/new with your name, photo, and socials. Your Swift Links page is generated with it automatically." },
        { t: "Add your links as tiles", d: "Copy the links from your current bio page into the \"Socials\" step. Featured tiles pull preview images automatically, and headers keep long lists organized." },
        { t: "Swap the link in your bios", d: "Replace the old URL in Instagram, TikTok, and X with your swiftcard.me/links address. From that moment every visitor can also save your card and share their info back." },
      ],
    },
    faq: [
      { q: "Does SwiftCard have a link-in-bio page like Linktree?", a: "Yes. Every card includes a Swift Links page with your photo, bio, social icons, video previews, and custom link tiles, plus themes (\"Looks\") you pick in one tap. It's what you put in your Instagram or TikTok bio." },
      { q: "What does SwiftCard have that Linktree doesn't?", a: "A digital business card visitors save to their phone in one tap, a share-back form that puts their name, phone, and email into your contacts, a built-in lead CRM, automated email and text follow-up, and sharing by NFC, QR, and Apple Wallet." },
      { q: "Can I move my Linktree links over?", a: "Yes. Add the same links as tiles on your Swift Links page in the card editor, and featured tiles pull preview images automatically. Most people finish in under ten minutes." },
      { q: "Is SwiftCard free like Linktree?", a: "Yes. The card, the links page, QR and link sharing, and contact capture are free. Pro adds unlimited link tiles, video previews, themes, automation, and analytics." },
      { q: "Do my visitors need an app?", a: "No. Everything opens in the browser on any phone. Saving your contact and sharing theirs back each take one tap, with nothing to install." },
    ],
  },
  "popl-alternative": {
    name: "Popl",
    metaTitle: "Popl Alternative: Digital Business Card With Built-In Follow-Up",
    metaDesc: "SwiftCard is the Popl alternative with automated email and text follow-up built in, so you don't need extra tools. Digital card, NFC, QR, and lead capture. Free to start.",
    heroSub: "Popl shares your card. SwiftCard shares your card and then follows up: automated email and text sequences go to every captured lead, built into the product instead of added through integrations.",
    honest: "Popl is a solid digital business card with a strong hardware line. If you mainly want branded NFC accessories, they do that well. People switch to SwiftCard for what happens after the tap: a built-in CRM and automated email and text follow-up sequences, which Popl expects you to assemble from third-party integrations.",
    rows: [
      { label: "Digital business card", swiftcard: "✓", them: "✓" },
      { label: "NFC tap-to-share", swiftcard: "✓ (works with any blank NFC tag)", them: "✓ (their branded hardware)" },
      { label: "Lead capture (share-back form)", swiftcard: "✓", them: "✓" },
      { label: "Built-in lead CRM (notes, history, follow-ups)", swiftcard: "✓", them: "Via 3rd-party integrations" },
      { label: "Automated follow-up sequences (email + text)", swiftcard: "✓", them: "✗" },
      { label: "Link-in-bio page included", swiftcard: "✓ (Swift Links)", them: "Limited" },
      { label: "Starting price", swiftcard: "Free", them: "Free" },
      { label: "Cheapest paid plan", swiftcard: `${PRO}/mo`, them: "$7.99/mo (Pro)", pricing: true },
    ],
    switchReasons: [
      { t: "Follow-up comes with the product", d: "Captured a lead at 2pm? Your check-in text goes out on schedule without Zapier, webhooks, or a second subscription." },
      { t: "No hardware required", d: "SwiftCard writes to any blank NFC tag (a few dollars online), or you can skip hardware entirely and share by QR, link, or Apple Wallet." },
      { t: "One plan, everything in it", d: "Your card, links page, CRM, automation, and analytics come in one subscription, instead of a card app plus the tools it takes to make it useful." },
    ],
    migration: {
      intro: "Your card's content is just your own details, so nothing is locked in. Rebuilding takes minutes, and your NFC hardware can come with you.",
      steps: [
        { t: "Create your card free", d: "Enter the same details (name, title, company, socials) at swiftcard.me/cards/new and pick a design. You don't need any hardware to start." },
        { t: "Re-point your NFC tag", d: "SwiftCard writes your new card link to any NFC tag, including hardware you already own. The tag stores a link, so it keeps working every time you edit the card." },
        { t: "Turn on follow-up", d: "Switch on email and text follow-up for each new lead. It sends on schedule and is STOP-compliant." },
      ],
    },
    faq: [
      { q: "Can I keep using my NFC card or tag?", a: "Yes. SwiftCard writes your card link to any NFC tag, including ones you already own. Tags store the link, so your card keeps working even after you edit it." },
      { q: "What does SwiftCard automate that Popl doesn't?", a: "Follow-up. When a lead shares their info, switch on your email and text sequence for them, and SwiftCard sends it on schedule (STOP-compliant). With Popl, you'd wire that up through third-party tools." },
      { q: "How does pricing compare?", a: `Both start free. SwiftCard Pro is ${PRO}/month; Popl Pro lists at $7.99/month. For teams, SwiftCard is ${SEAT}/seat (minimum ${MIN_SEATS} seats) and Popl is $5/user (minimum 5). Plans change, so check current pricing with them.` },
      { q: "Do I need to buy anything to switch?", a: "No. Create your card free and share it right away by QR, link, or Apple Wallet. NFC is optional." },
      { q: "Can my team switch together?", a: "Yes. SwiftCard Office gives every teammate an on-brand card, with their own leads, under one admin dashboard. There's no limit on seats." },
    ],
  },
  "blinq-alternative": {
    name: "Blinq",
    metaTitle: "Blinq Alternative: Digital Business Card That Follows Up",
    metaDesc: "SwiftCard is the Blinq alternative with a built-in lead CRM and automated email and text follow-up. Card, QR, NFC, and link-in-bio in one plan. Free to start.",
    heroSub: "Blinq makes a clean digital card. SwiftCard makes the card, captures the lead, and runs the follow-up, so the whole path from meeting to client lives in one product.",
    honest: "Blinq is a well-made digital business card with a generous free tier, and as a card it's good. People switch to SwiftCard when they want the card to feed a pipeline: a built-in CRM with notes and full history, email and text follow-ups you can switch on for any contact, and a full link-in-bio page, all without connecting a separate tool for each.",
    rows: [
      { label: "Digital business card", swiftcard: "✓", them: "✓" },
      { label: "Custom card designer", swiftcard: "✓ (Pro, incl. AI copy-my-card)", them: "✓" },
      { label: "NFC tap-to-share", swiftcard: "✓", them: "✓" },
      { label: "Built-in lead CRM (notes, history, follow-ups)", swiftcard: "✓", them: "Via 3rd-party integrations" },
      { label: "Automated follow-up sequences (email + text)", swiftcard: "✓", them: "✗" },
      { label: "Link-in-bio page included", swiftcard: "✓ (Swift Links)", them: "Limited" },
      { label: "Starting price", swiftcard: "Free", them: "Free" },
      { label: "Cheapest paid plan", swiftcard: `${PRO}/mo`, them: "~$3–10/mo (Premium, by billing term)", pricing: true },
    ],
    switchReasons: [
      { t: "The card feeds a real pipeline", d: "Every captured contact lands in a built-in CRM with notes, tags, and follow-up status. You don't end up with a CSV you keep promising yourself you'll import somewhere." },
      { t: "Follow-up runs itself", d: "Switch on an email or text follow-up for any new lead and it sends on schedule, STOP-compliant, in your name." },
      { t: "A real link-in-bio page, included", d: "Swift Links replaces your Linktree too, with themes, video tiles, section headers, and per-page design. That's one less subscription to pay for." },
    ],
    migration: {
      intro: "A digital card rebuilds from details you already know by heart, and SwiftCard's AI can even copy a card's design from a photo.",
      steps: [
        { t: "Rebuild the card", d: "Enter your details at swiftcard.me/cards/new and pick a template. On Pro, you can instead upload a picture of any card design, and the AI designer rebuilds it with your info." },
        { t: "Re-share your new link", d: "Update the link anywhere you shared the old one: your email signature, QR stickers, NFC tags (SwiftCard writes to any blank tag), and your bios." },
        { t: "Let the pipeline start", d: "New contacts land in the built-in CRM with notes and history, and the follow-up you switch on takes it from there." },
      ],
    },
    faq: [
      { q: "Can I recreate my Blinq card design on SwiftCard?", a: "Yes. Pick from designer templates and customize colors, fonts, photo, and logo. Pro users can even upload a picture of any card design (including a physical card), and SwiftCard's AI rebuilds it with your details." },
      { q: "What does SwiftCard do after someone saves my card?", a: "They can share their info back. It lands in your built-in CRM tagged with the time and source, and the email or text follow-up you switch on for them takes it from there. That after-the-tap layer is the difference." },
      { q: "How does pricing compare?", a: `Both start free. SwiftCard Pro is ${PRO}/month flat; Blinq Premium runs roughly $3–10/month depending on billing term. Plans change, so check current pricing with them.` },
      { q: "Does SwiftCard work without an app for the other person?", a: "Yes. Your card opens in any browser, and saving your contact or sharing theirs back takes one tap, with nothing to install." },
      { q: "Is there a team version?", a: `Yes. SwiftCard Office gives every teammate an on-brand card and their own lead book, all under one admin dashboard. It's ${SEAT}/seat/month, with a minimum of ${MIN_SEATS} seats and no maximum.` },
    ],
  },
  "hihello-alternative": {
    name: "HiHello",
    metaTitle: "HiHello Alternative: Digital Business Card With Automation",
    metaDesc: "SwiftCard is the HiHello alternative that adds automated email and text follow-up and a built-in lead CRM to your digital business card. Free to start.",
    heroSub: "HiHello makes tidy digital cards and email signatures. SwiftCard does both, then captures leads into a built-in CRM and follows up automatically.",
    honest: "HiHello does the fundamentals of digital cards well, including email signatures and multiple cards per person. People switch to SwiftCard for the layer HiHello doesn't focus on: built-in lead capture with a CRM, automated email and text follow-up sequences, and a full link-in-bio page. Those are the parts that turn a card into new business.",
    rows: [
      { label: "Digital business card", swiftcard: "✓", them: "✓" },
      { label: "Multiple cards per account", swiftcard: "✓ (Pro)", them: "✓" },
      { label: "Email signature generator", swiftcard: "✓ (Swift Signature)", them: "✓" },
      { label: "Built-in lead CRM (notes, history, follow-ups)", swiftcard: "✓", them: "Via 3rd-party integrations" },
      { label: "Automated follow-up sequences (email + text)", swiftcard: "✓", them: "✗" },
      { label: "Link-in-bio page included", swiftcard: "✓ (Swift Links)", them: "Limited" },
      { label: "Starting price", swiftcard: "Free", them: "Free" },
      { label: "Cheapest paid plan", swiftcard: `${PRO}/mo`, them: "$6+/mo (Professional)", pricing: true },
    ],
    switchReasons: [
      { t: "From contact exchange to pipeline", d: "SwiftCard doesn't stop at swapping details. Every captured contact gets notes, full history, and a follow-up sequence you can switch on in one tap." },
      { t: "Texting, done compliantly", d: "Follow-up texts are built in. They go only to contacts you've confirmed have agreed to hear from you, and STOP replies are handled automatically, so there's no separate SMS tool to buy and wire up." },
      { t: "The bio link is included", d: "Swift Links gives you an Instagram or TikTok bio page too, with themes, video tiles, and analytics under the same roof." },
    ],
    migration: {
      intro: "Your card, signature, and bio link all rebuild from your own details, so you have one product to keep up to date instead of several.",
      steps: [
        { t: "Create your card", d: "Build it free at swiftcard.me/cards/new. On Pro, you can add a separate card for each role, each with its own URL, design, and contact book." },
        { t: "Regenerate your signature", d: "Swift Signature turns the new card into an email signature for Gmail, Outlook, and Apple Mail: a live image that links to your card page." },
        { t: "Point your bio at Swift Links", d: "Your card comes with a link-in-bio page. Put its URL in your social bios and retire the extra tool." },
      ],
    },
    faq: [
      { q: "Does SwiftCard do email signatures like HiHello?", a: "Yes. Swift Signature turns your card into an email signature for Gmail, Outlook, and Apple Mail: a live image of your card that links to your card page. It's on every plan." },
      { q: "What's the biggest difference from HiHello?", a: "What happens after the exchange. SwiftCard captures leads into a built-in CRM and runs automated email and text follow-up sequences. HiHello focuses on the card and signature, and the pipeline layer is where SwiftCard goes further." },
      { q: "Can I have different cards for different roles?", a: "Yes. SwiftCard Pro includes unlimited cards, each with its own URL, design, links page, contacts, and analytics." },
      { q: "How does pricing compare?", a: `Both start free. SwiftCard Pro is ${PRO}/month; HiHello's paid plans start around $6/month. Plans change, so check current pricing with them.` },
      { q: "Do recipients need the app?", a: "No. Your card opens in the browser on any phone, and saving your contact takes one tap." },
    ],
  },
  "mobilo-alternative": {
    name: "Mobilo",
    metaTitle: "Mobilo Alternative: Digital Business Card Without the Annual Contract",
    metaDesc: "SwiftCard is the Mobilo alternative with transparent monthly pricing, a free plan that needs no hardware, and built-in email and text follow-up. Free to start.",
    heroSub: "Mobilo sells NFC cards with an app attached. SwiftCard puts the app first: it's free without hardware, priced monthly, and comes with lead capture and automated follow-up built in.",
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
      { label: "Cheapest paid plan", swiftcard: `${PRO}/mo`, them: "$3/user/mo (Pro, billed annually)", pricing: true },
    ],
    switchReasons: [
      { t: "Pay month to month, leave in two taps", d: "SwiftCard Pro is a flat monthly plan (or annual, your choice). On iPhone, Apple bills the subscription and you cancel it in Settings, with no support ticket and no surprise renewal." },
      { t: "No card required, ever", d: "The free plan shares by QR, link, Apple Wallet, and Apple Watch. Want NFC? SwiftCard writes to any blank tag, including cards you already own." },
      { t: "Follow-up runs itself", d: "Switch on your email and text sequence for any captured lead and it runs on schedule, STOP-compliant. It doesn't sit in your CRM as a task for later." },
    ],
    migration: {
      intro: "Your card is your own details, and your Mobilo hardware stores a link, so both come with you. Most people rebuild in about ten minutes.",
      steps: [
        { t: "Create your card free", d: "Enter your details at swiftcard.me/cards/new and pick a design. On Pro, you can instead upload a photo of your current card, and the AI designer rebuilds it with your info." },
        { t: "Re-point your NFC card", d: "SwiftCard writes your new link to any NFC tag, including the card you already carry. It keeps working every time you edit your card." },
        { t: "Turn on follow-up", d: "Switch on your email and text sequence for a new contact and it sends on schedule from there." },
      ],
    },
    faq: [
      { q: "Do I need to buy a card to use SwiftCard?", a: "No. The free plan shares by QR code, link, Apple Wallet, and Apple Watch. NFC is optional and works with any blank NFC tag, including hardware you already own." },
      { q: "Can I keep my Mobilo NFC card?", a: "Yes. An NFC card stores a link, and SwiftCard writes your new card link to any tag. Tap it and your SwiftCard opens." },
      { q: "How does pricing compare?", a: `Both start free. SwiftCard Pro is ${PRO}/month, or less on the annual plan, with a free trial. Mobilo's Pro plan lists at $3 per user per month billed annually, and their cards are sold separately. Plans change, so check current pricing with them.` },
      { q: "How do I cancel SwiftCard?", a: "On iPhone, Apple manages the subscription: cancel in the iPhone Settings app under your name → Subscriptions. On the web, cancel from Settings → Plan and billing. Either way, it takes effect at the end of the period you paid for." },
      { q: "Does SwiftCard work for a team?", a: `Yes. SwiftCard Office gives every teammate an on-brand card, with their own leads, under one admin dashboard. It's ${SEAT} per seat per month, with a minimum of ${MIN_SEATS} seats.` },
    ],
  },
  "linq-alternative": {
    name: "Linq",
    metaTitle: "Linq Alternative: Digital Business Card That Follows Up",
    metaDesc: "SwiftCard is the Linq alternative that starts free without hardware and adds a built-in lead CRM and automated email and text follow-up. One simple plan.",
    heroSub: "Linq pairs its cards and tags with a team-oriented platform. SwiftCard keeps it simple: a free card that needs no hardware, a link that looks like your name, and follow-up that runs itself.",
    honest: "Linq is an established digital-card company with a wide hardware line and a platform aimed increasingly at sales teams and enterprises, with per-seat plans to match. If you're buying for a large team with a sales-ops budget, they're worth a look. People switch to SwiftCard when they work on their own or in a small team and want to start free, pay one simple price, and get lead capture and automated follow-up without an enterprise rollout.",
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
      { label: "Cheapest paid plan", swiftcard: `${PRO}/mo`, them: "Paid plans priced per seat; see their site", pricing: true },
    ],
    switchReasons: [
      { t: "One price, everything in it", d: "Your card, Swift Links page, lead CRM, automation, analytics, and Apple Wallet all come in one flat plan, with no per-seat tiers to decode." },
      { t: "Your link is your name", d: "Cards live at swiftcard.me/FirstLast-Company. The person you meet sees who you are before they tap." },
      { t: "Follow-up without a sales-ops team", d: "Switch on your email and text sequence for any captured lead and it sends on schedule, STOP-compliant." },
    ],
    migration: {
      intro: "A digital card rebuilds from details you already know, and your NFC hardware stores a link that SwiftCard can overwrite. Ten minutes, start to finish.",
      steps: [
        { t: "Rebuild the card", d: "Enter your details at swiftcard.me/cards/new and pick a template. On Pro, you can instead upload a picture of your current card, and the AI designer rebuilds it." },
        { t: "Re-point your tags", d: "SwiftCard writes your new link to any NFC tag or card you already own, so the hardware keeps working." },
        { t: "Update the link everywhere", d: "Swap in your swiftcard.me link on your email signature, QR stickers, and social bios. Then switch on follow-up so new contacts hear from you on schedule." },
      ],
    },
    faq: [
      { q: "Can I keep my Linq card or tag?", a: "Yes. NFC hardware stores a link, and SwiftCard writes your new card link to any tag. Tap it and your SwiftCard opens." },
      { q: "Is SwiftCard free?", a: "Yes. The card, QR and link sharing, Apple Wallet, contact capture, and the Swift Links page are free. Pro adds automation, analytics, the AI designer, and more." },
      { q: "How does pricing compare?", a: `SwiftCard Pro is ${PRO}/month flat, or less annually, with a free trial. Linq's paid plans are priced per seat and have changed recently, so check their site for current figures before deciding.` },
      { q: "Do recipients need an app?", a: "No. Your card opens in any browser, and saving your contact or sharing theirs back takes one tap, with nothing to install." },
      { q: "Is there a team version?", a: `Yes. SwiftCard Office gives every teammate an on-brand card and their own lead book, all under one admin dashboard. It's ${SEAT} per seat per month, with a minimum of ${MIN_SEATS} seats and no maximum.` },
    ],
  },
  "dot-alternative": {
    name: "Dot",
    metaTitle: "Dot Card Alternative: Digital Business Card Without Buying Hardware",
    metaDesc: "SwiftCard is the Dot alternative that starts free with no device to buy, and adds lead capture, a built-in CRM, and automated email and text follow-up.",
    heroSub: "Dot sells a tap-to-share device with a free profile behind it. SwiftCard starts with the free card itself (QR, link, Apple Wallet, or any NFC tag) and then does the follow-up for you.",
    honest: "Dot (dot.cards) is a hardware-first digital business card: you buy a dot.card, dot.thin, dot.metal, or dot.band, and the profile it opens is free for life. If you want a nicely made physical tap device and nothing more, that works. People switch to SwiftCard when they don't want to buy a device to get started, want their card in Apple Wallet and on Apple Watch, and want what happens after the tap handled for them: a share-back form, a built-in CRM, and automated email and text follow-up. Dot reserves those for its team plans and a paid individual tier.",
    rows: [
      { label: "Digital business card", swiftcard: "✓", them: "✓" },
      { label: "Free to start without buying hardware", swiftcard: "✓", them: "✗ (profile is free after a device purchase)" },
      { label: "NFC tap-to-share", swiftcard: "✓ (works with any blank NFC tag)", them: "✓ (their devices, from $30)" },
      { label: "Apple Wallet and Apple Watch", swiftcard: "✓", them: "Limited" },
      { label: "Lead capture (share-back form)", swiftcard: "✓", them: "Paid tiers" },
      { label: "Built-in lead CRM (notes, history, follow-ups)", swiftcard: "✓", them: "Team plans" },
      { label: "Automated follow-up sequences (email + text)", swiftcard: "✓", them: "✗" },
      { label: "Link-in-bio page included", swiftcard: "✓ (Swift Links)", them: "✗" },
      { label: "AI card designer (copy any card from a photo)", swiftcard: "✓ (Pro)", them: "✗" },
      { label: "Starting price", swiftcard: "Free", them: "$30 device (one-time)" },
      { label: "Cheapest paid plan", swiftcard: `${PRO}/mo`, them: "Teams from $8/member/mo (billed annually)", pricing: true },
    ],
    switchReasons: [
      { t: "Nothing to buy first", d: "Create the card and share it by QR, link, or Apple Wallet in the next five minutes. Add NFC later with any blank tag, or keep using the device you already own." },
      { t: "Follow-up is built in", d: "When someone shares their info back, SwiftCard sends your email and text follow-up on schedule. Dot's profile shares your details and stops there." },
      { t: "The card lives in Apple Wallet", d: "Lock-screen access on iPhone and a scannable QR on Apple Watch, no device in your pocket required." },
    ],
    migration: {
      intro: "A Dot device stores a link, and a link can be rewritten. Rebuild the card in minutes and keep the hardware if you like it.",
      steps: [
        { t: "Create your card free", d: "Enter your details at swiftcard.me/cards/new and pick a template. On Pro, you can instead photograph your current card, and the AI designer rebuilds it." },
        { t: "Re-point your dot.device", d: "SwiftCard writes your new card link to any NFC tag or card, including Dot hardware, so a tap opens your SwiftCard from now on." },
        { t: "Switch on follow-up", d: "Turn on email and text follow-up for new contacts and they hear from you on schedule, STOP-compliant." },
      ],
    },
    faq: [
      { q: "Do I need to buy anything to use SwiftCard?", a: "No. The card, QR and link sharing, Apple Wallet and the Swift Links page are free with no device. NFC is optional and works with any blank tag." },
      { q: "Can I keep using my Dot card or band?", a: "Yes. Dot devices store a link, and SwiftCard writes your new card link to any NFC tag. Tap it and your SwiftCard opens." },
      { q: "How does pricing compare?", a: `Dot's profile is free after a one-time device purchase (from $30). Its team plans run $8 to $15 per member per month billed annually, and extra individual features sit in a paid tier. SwiftCard is free to start, and Pro is ${PRO}/month flat with a free trial. Plans change, so check current pricing with them.` },
      { q: "What does SwiftCard do that Dot doesn't?", a: "Automated follow-up by email and text, a built-in CRM for every lead, a Swift Links page, Apple Wallet and Apple Watch sharing, and an AI designer that rebuilds any card from a photo. It's all on one plan, with no hardware required." },
      { q: "Does the person I meet need an app?", a: "No. With either product, your card opens in the browser. With SwiftCard, they can also save your contact in one tap and share theirs back." },
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
            {c.name}&apos;s pricing and features come from their public pages and may change, so confirm current details with them directly.
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
