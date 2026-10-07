"use client";

import { useEffect, useRef, useState } from "react";
import SiteNav from "@/components/site/SiteNav";
import PortalNavPreview, { type PortalTabId } from "@/components/site/PortalNavPreview";
import { createPortal } from "react-dom";
import Link from "next/link";
import DemoContactActions from "@/components/site/DemoContactActions";
import ShareButton from "@/components/ShareButton";
import MoreShareOptions from "@/components/MoreShareOptions";
import QRCodeModal from "@/components/QRCodeModal";
import { qrScanUrl, withSource } from "@/lib/share-source";
import { buildContactQr } from "@/lib/contact-qr";
import type { CardData } from "@/components/card-templates/types";
import TrafficChart, { type TrafficBucket } from "@/components/TrafficChart";
import LinksPageTabs from "@/components/LinksPageTabs";
import CreateDemo from "@/components/CreateDemo";
import CardScaler from "@/components/CardScaler";

type Range = "today" | "week" | "month" | "locations";
type DemoLocation = { location: string; card: number; link: number };
// A contact as the real /contacts list shows it: name, where it came from
// (lib/source-labels; none for a plain card link), company, email, date. No
// status — that dropdown left the product on 2026-08-11.
type Lead = { id: string; name: string; source: string | null; company: string; email: string; time: string; read: boolean };
type DemoCard = {
  key: "sales" | "realestate";
  label: string;
  handle: string;
  template: string;
  accent: string;
  data: CardData;
  traffic: Record<"today" | "week" | "month", { card: string; links: string }>;
  locations: DemoLocation[];
  leads: Lead[];
};

const CARDS: DemoCard[] = [
  {
    key: "sales", label: "Sales Card", handle: "demo-sales", template: "modern-bold", accent: "#2563eb",
    traffic: { today: { card: "142", links: "63" }, week: { card: "1,248", links: "593" }, month: { card: "4,517", links: "2,104" } },
    locations: [
      { location: "New York, US", card: 1834, link: 902 },
      { location: "Chicago, US", card: 1121, link: 486 },
      { location: "Austin, US", card: 764, link: 341 },
      { location: "Miami, US", card: 512, link: 227 },
    ],
    leads: [
      { id: "s1", name: "Sarah Chen", source: "LinkedIn", company: "Acme Corp", email: "sarah@acmecorp.com", time: "2m ago", read: false },
      { id: "s2", name: "Priya Patel", source: "Instagram bio", company: "Brightline Studio", email: "priya@brightline.studio", time: "1h ago", read: false },
      { id: "s3", name: "James Carter", source: null, company: "Carter Logistics", email: "james@carterlogistics.com", time: "Yesterday", read: true },
      { id: "s4", name: "Tom Nguyen", source: "QR code scan", company: "Nguyen & Co.", email: "tom@nguyenco.com", time: "3d ago", read: true },
    ],
    data: {
      name: "Alex Morgan", title: "Account Executive", company: "Northwind SaaS",
      phone: "(415) 555-0142", email: "alex@northwind.io", website: "northwind.io",
      address: "", initials: "AM", photoUrl: null, logoUrl: null, customization: { accentColor: "#2563eb" },
    },
  },
  {
    key: "realestate", label: "Real Estate Card", handle: "demo-realty", template: "local-business", accent: "#d97706",
    traffic: { today: { card: "231", links: "98" }, week: { card: "2,034", links: "874" }, month: { card: "7,860", links: "3,221" } },
    locations: [
      { location: "San Francisco, US", card: 3105, link: 1240 },
      { location: "Oakland, US", card: 1877, link: 705 },
      { location: "San Jose, US", card: 1442, link: 618 },
      { location: "Sacramento, US", card: 903, link: 366 },
    ],
    leads: [
      { id: "r1", name: "Nathan Cole", source: "QR code scan", company: "Cole Family Trust", email: "nathan.cole@gmail.com", time: "12m ago", read: false },
      { id: "r2", name: "Elena Ruiz", source: "Swift Signature", company: "Ruiz Design", email: "elena@ruizdesign.co", time: "2h ago", read: false },
      { id: "r3", name: "David Kim", source: "NFC tap", company: "Kim Dental", email: "david@kimdental.com", time: "Yesterday", read: false },
      { id: "r4", name: "Olivia Brooks", source: "Instagram bio", company: "Brooks Bakery", email: "olivia@brooksbakery.com", time: "4d ago", read: true },
    ],
    data: {
      name: "Alex Morgan", title: "Realtor®", company: "Coastline Realty",
      phone: "(415) 555-0188", email: "alex@coastlinerealty.com", website: "coastlinehomes.com",
      address: "1200 Ocean Ave\nSan Francisco\nCA 94122", initials: "AM", photoUrl: null, logoUrl: null, customization: { accentColor: "#d97706" },
    },
  },
];

function Box({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`bg-gray-900 border border-gray-800/80 rounded-2xl p-5 ${className}`}>{children}</div>;
}

// Renders the real card page (card-only mode) and auto-sizes the iframe to the card's
// exact height — no blank space below, nothing clipped. Same-origin, so we can read it.
function CardOnlyPreview({ src }: { src: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [h, setH] = useState(170);
  useEffect(() => {
    const iframe = ref.current;
    if (!iframe) return;
    let ro: ResizeObserver | null = null;
    const measure = () => {
      try {
        const el = iframe.contentDocument?.getElementById("sc-card-only");
        const height = el ? Math.ceil(el.getBoundingClientRect().height) : 0;
        if (height) setH(height);
      } catch { /* ignore */ }
    };
    const onLoad = () => {
      measure();
      try {
        const el = iframe.contentDocument?.getElementById("sc-card-only");
        if (el && "ResizeObserver" in window) { ro = new ResizeObserver(measure); ro.observe(el); }
      } catch { /* ignore */ }
      setTimeout(measure, 250);
      setTimeout(measure, 750);
    };
    iframe.addEventListener("load", onLoad);
    window.addEventListener("resize", measure);
    return () => { iframe.removeEventListener("load", onLoad); window.removeEventListener("resize", measure); ro?.disconnect(); };
  }, [src]);
  return <iframe ref={ref} src={src} scrolling="no" title="Your SwiftCard preview" className="w-full block pointer-events-none" style={{ border: 0, height: h }} />;
}

function FullScreen({ title, href, onClose, children }: { title: string; href?: string; onClose: () => void; children: React.ReactNode }) {
  // Render into document.body via a portal. Inside the page tree, ancestors with
  // CSS transforms (the scroll-reveal wrappers on the landing embed) hijack
  // position:fixed — the modal then anchors to the SECTION, forcing mobile users
  // to scroll up to find it. Portaling guarantees it opens over the viewport,
  // right where they are; locking body scroll keeps the page put underneath.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- portal only mounts client-side
    setMounted(true);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // Escape closes too — belt and braces for anyone who misses the X.
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = prevOverflow; window.removeEventListener("keydown", onKey); };
  }, [onClose]);
  if (!mounted) return null;

  return createPortal(
    // z-[100]: must sit ABOVE every piece of site chrome. The marketing SiteNav
    // is fixed at z-[70] (its mobile menu z-[90]) and is exactly as tall as this
    // modal's header — at the old z-50 the nav covered the whole header strip,
    // so the X was invisible on phones and clicks on it landed on the nav.
    <div className="fixed inset-0 z-[100] bg-gray-950 flex flex-col">
      <div className="shrink-0 h-16 px-6 sm:px-10 flex items-center justify-between">
        <p className="text-white font-semibold text-sm truncate">{title}</p>
        <div className="flex items-center gap-6 shrink-0">
          {href && <a href={href} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-400 hover:text-blue-300 font-medium hidden sm:inline">Open in new tab ↗</a>}
          <button onClick={onClose} aria-label="Close" className="text-gray-400 hover:text-white transition-colors">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-6 h-6">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>
      {/* Click anywhere OUTSIDE the phone to close, so there are three ways
          out — the X, the backdrop and Escape — on phone and computer alike.
          The e.target === e.currentTarget check is what makes "outside" mean
          outside: without it a tap on the phone itself, or on any control
          inside it, would bubble up here and close the thing the visitor is
          trying to use. Clicks inside the iframe never reach this at all. */}
      <div
        className="flex-1 overflow-y-auto flex items-start sm:items-center justify-center p-4 sm:p-8"
        onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      >
        {children}
      </div>
      {/* Peak-interest CTA — they're literally holding the product right now */}
      <div className="shrink-0 border-t border-gray-800 bg-gray-950/95 backdrop-blur px-4 py-3 pb-[max(12px,env(safe-area-inset-bottom))]">
        <div className="max-w-xl mx-auto flex items-center gap-3">
          <p className="text-gray-400 text-sm flex-1 hidden sm:block">Like what you see? Yours is 60 seconds away.</p>
          <Link
            href="/join?src=preview"
            className="flex-1 sm:flex-none text-center text-sm font-bold text-white bg-gradient-to-r from-blue-600 to-violet-600 hover:from-blue-500 hover:to-violet-500 px-6 py-3 rounded-full transition-colors shadow-lg shadow-blue-900/40"
          >
            Create Your Card for Free →
          </Link>
        </div>
      </div>
    </div>,
    document.body
  );
}

function IframePhone({ src }: { src: string }) {
  return (
    <div className="rounded-[2.4rem] p-2.5 shrink-0" style={{ width: 384, maxWidth: "100%", background: "#0f172a", border: "2px solid #1e293b", boxShadow: "0 40px 90px -30px rgba(0,0,0,0.7)" }}>
      <div className="relative overflow-hidden bg-white" style={{ borderRadius: "1.9rem", height: "min(720px, 74vh)" }}>
        <iframe src={src} title="SwiftCard live preview" className="w-full h-full" style={{ border: 0 }} />
      </div>
    </div>
  );
}

const RANGES: { id: Range; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "week", label: "Week" },
  { id: "month", label: "Month" },
  { id: "locations", label: "Locations" },
];

export default function PreviewClient({ embedded = false }: { embedded?: boolean }) {
  const [activeKey, setActiveKey] = useState<DemoCard["key"]>("realestate");
  // Which portal page the demo is showing, driven by PortalNavPreview's tabs.
  const [portalTab, setPortalTab] = useState<PortalTabId>("dashboard");
  const [range, setRange] = useState<Range>("week");
  const [modal, setModal] = useState<null | "card" | "links" | "signature">(null);
  const [copied, setCopied] = useState(false);
  // Sticky signup bar (standalone page only): appears once the visitor actually
  // engages with the demo — never before, so "try it live first" stays true.
  const [engaged, setEngaged] = useState(false);
  const [ctaHidden, setCtaHidden] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time hydration read from sessionStorage
    try { if (sessionStorage.getItem("sc_preview_cta")) setCtaHidden(true); } catch { /* ignore */ }
  }, []);
  function openDemo(m: "card" | "links" | "signature") {
    setModal(m);
    setEngaged(true);
  }
  function hideStickyCta() {
    setCtaHidden(true);
    try { sessionStorage.setItem("sc_preview_cta", "1"); } catch { /* ignore */ }
  }
  const [read, setRead] = useState<Record<string, boolean>>(() => {
    const m: Record<string, boolean> = {};
    CARDS.forEach((c) => c.leads.forEach((l) => { m[l.id] = l.read; }));
    return m;
  });

  const card = CARDS.find((c) => c.key === activeKey)!;
  const traffic = card.traffic[range === "locations" ? "week" : range];
  // The window's total, and the unique/repeat split and link taps the real
  // Traffic box shows with it (sample proportions).
  const totalViews = Number(traffic.card.replace(/,/g, "")) + Number(traffic.links.replace(/,/g, ""));
  const unique = Math.round(totalViews * 0.62);
  const linkTaps = Math.round(totalViews * 0.16);

  // Demo buckets for the traffic chart, mirroring the real dashboard's series.
  // Generated on the CLIENT after mount: bucket timestamps come from the clock,
  // and a server-rendered timestamp would never hydrate cleanly. Deterministic
  // per card+range (seeded hash) so switching back and forth doesn't reshuffle
  // the bars — the demo should feel like data, not a slot machine.
  const [buckets, setBuckets] = useState<{ list: TrafficBucket[]; max: number } | null>(null);
  useEffect(() => {
    const effRange = range === "locations" ? "week" : range;
    const t = card.traffic[effRange];
    const total = Number(t.card.replace(/,/g, "")) + Number(t.links.replace(/,/g, ""));
    const n = effRange === "today" ? 24 : effRange === "week" ? 7 : 30;
    const stepMs = effRange === "today" ? 3_600_000 : 86_400_000;

    // Tiny seeded PRNG (FNV-1a mix) — stable weights per card+range.
    let h = 2166136261;
    for (const ch of `${card.key}:${effRange}`) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
    const rnd = () => {
      h = Math.imul(h ^ (h >>> 15), 2246822507);
      h = Math.imul(h ^ (h >>> 13), 3266489909);
      return ((h ^= h >>> 16) >>> 0) / 4294967296;
    };

    const weights = Array.from({ length: n }, () => 0.35 + rnd());
    const sum = weights.reduce((a, b) => a + b, 0);
    // Runs in an effect, not render: bucket timestamps come from the real
    // clock so the chart's axis reads like live data.
    const nowBucket = Math.floor(Date.now() / stepMs) * stepMs;
    // Split each bar into SwiftCard and Swift Links, in the window's own
    // proportion, so the chart shows its legend and two colours as the real
    // dashboard's does.
    const linkShare = Number(t.links.replace(/,/g, "")) / total;
    const list: TrafficBucket[] = weights.map((w, i) => {
      const count = Math.max(0, Math.round((total * w) / sum));
      const links = Math.round(count * linkShare * (0.85 + rnd() * 0.3));
      return { ts: nowBucket - (n - 1 - i) * stepMs, count, card: Math.max(0, count - links), links: Math.min(count, links) };
    });
    // eslint-disable-next-line react-hooks/set-state-in-effect -- client-only clock-derived data
    setBuckets({ list, max: Math.max(...list.map((b) => b.count), 1) });
  }, [card, range]);
  const cardUrl = `https://swiftcard.me/${card.handle}`;
  // The demo's Show QR has the same Contact switch as the real dashboard.
  const contactPayload = buildContactQr({
    name: card.data.name,
    title: card.data.title,
    company: card.data.company,
    email: card.data.email,
    phone: card.data.phone,
    website: card.data.website,
    cardUrl: withSource(cardUrl, "contact_qr"),
  });
  const toggleRead = (id: string) => setRead((p) => ({ ...p, [id]: !p[id] }));

  function copySig() {
    try { navigator.clipboard?.writeText(`${card.data.name}\nhttps://swiftcard.me/${card.handle}`); } catch { /* ignore */ }
    setCopied(true);
    setTimeout(() => setCopied(false), 2200);
  }

  const [linksCopied, setLinksCopied] = useState(false);
  function copyLinksUrl() {
    try { navigator.clipboard?.writeText(`https://swiftcard.me/links/${card.handle}`); } catch { /* ignore */ }
    setLinksCopied(true);
    setTimeout(() => setLinksCopied(false), 2200);
  }

  // The signature in a sample email + Copy + the setup steps — the same
  // content the real Links page now shows in place (EmailSignatureBox). One
  // element for both places it appears here: the Links tab's Swift Signature
  // side and the "Preview Swift Signature" pop-up from the getting-started steps.
  const signatureDemo = (
    <>
      <p className="text-gray-300 text-xs mb-3">Here&apos;s how it looks at the bottom of an email you send:</p>
      <div className="rounded-xl border border-gray-700/60 bg-white overflow-hidden">
        <div className="px-4 py-2.5 border-b border-gray-200 text-[0.75rem] text-gray-400 space-y-0.5">
          <p><span className="text-gray-400">To:</span> sarah@acme.com</p>
          <p><span className="text-gray-400">Subject:</span> Great connecting today</p>
        </div>
        <div className="px-4 py-3 text-[0.8125rem] text-gray-800 leading-relaxed">
          <p>Hi Sarah,</p>
          <p className="mt-2">Really enjoyed chatting earlier. My contact info is below in my signature. Let&apos;s keep in touch!</p>
          <p className="mt-2">Best,</p>
          <div className="mt-3">
            <p className="text-[0.875rem] text-gray-900 mb-1.5"><strong>{card.data.name}</strong> | {card.data.company}</p>
            <div className="rounded-[10px] overflow-hidden border border-gray-200 w-[240px] max-w-full bg-[#FAF7F2]"><CardOnlyPreview key={`sig-${card.handle}`} src={`/${card.handle}?embed=card`} /></div>
            <span className="inline-block mt-2 text-[0.875rem] font-bold text-blue-600">Contact me</span>
          </div>
        </div>
      </div>
      {/* The real box's button, two numbered steps, email-settings buttons
          and the Gmail / work-Outlook notes (EmailSignatureBox, 5efa1883). */}
      <button onClick={copySig} className="w-full mt-4 bg-blue-600 hover:bg-blue-500 text-white font-semibold text-sm py-2.5 rounded-full transition-colors">
        {copied ? "Copied ✓ Now paste it in your email" : "Copy signature"}
      </button>
      <ol className="mt-4 space-y-2.5">
        <li className="flex gap-2.5">
          <span className="w-5 h-5 rounded-full bg-gray-800 text-gray-300 text-[0.6875rem] font-bold flex items-center justify-center shrink-0">1</span>
          <p className="text-gray-300 text-[0.75rem] leading-relaxed">Tap <strong className="text-white">Copy signature</strong> above.</p>
        </li>
        <li className="flex gap-2.5">
          <span className="w-5 h-5 rounded-full bg-gray-800 text-gray-300 text-[0.6875rem] font-bold flex items-center justify-center shrink-0">2</span>
          <p className="text-gray-300 text-[0.75rem] leading-relaxed">Open your email below, <strong className="text-white">paste</strong> it into the Signature box, and <strong className="text-white">save</strong>.</p>
        </li>
      </ol>
      <div className="grid grid-cols-3 gap-2 mt-3">
        {[
          { label: "Gmail", url: "https://mail.google.com/mail/u/0/#settings/general" },
          { label: "Outlook", url: "https://outlook.live.com/mail/0/options/mail/messageContent" },
          { label: "Yahoo", url: "https://mail.yahoo.com/d/settings/1" },
        ].map((p) => (
          <a key={p.label} href={p.url} target="_blank" rel="noopener noreferrer"
            className="flex items-center justify-center gap-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-200 text-[0.6875rem] font-semibold py-2 rounded-xl transition-colors">
            {p.label}
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3 opacity-60"><path d="M11 3a1 1 0 100 2h2.586l-6.293 6.293a1 1 0 101.414 1.414L15 6.414V9a1 1 0 102 0V4a1 1 0 00-1-1h-5z" /><path d="M5 5a2 2 0 00-2 2v8a2 2 0 002 2h8a2 2 0 002-2v-3a1 1 0 10-2 0v3H5V7h3a1 1 0 000-2H5z" /></svg>
          </a>
        ))}
      </div>
      <div className="mt-3 space-y-1.5 text-[0.6875rem] text-gray-500 leading-relaxed">
        <p><strong className="text-gray-300">Gmail:</strong> scroll down to Signature, paste, then click <strong className="text-gray-300">Save Changes</strong> at the very bottom.</p>
        <p>
          <strong className="text-gray-300">Outlook for work or school?</strong>{" "}
          <a href="https://outlook.office.com/mail/options/mail/messageContent" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300 underline underline-offset-2">Open it here</a> instead.
        </p>
        <p>Another email app? Paste it into that app&apos;s signature settings.</p>
      </div>
    </>
  );

  // Your Card + Share + other ways to share — shown under My Cards on mobile and in the
  // sticky right column on desktop, matching the real dashboard's phone layout.
  const cardSharePanel = (
    <>
      {/* Just the card, as on the real dashboard (no heading, hint or caption
          since 2026-09-30; no Download under it since 2026-10-07 — the
          picture is saved from Other ways to share) — tap it to open the live
          card. */}
      <Box>
        <button type="button" onClick={() => openDemo("card")} aria-label="Open the live card" className="block w-full rounded-xl overflow-hidden ring-1 ring-blue-500/30 hover:ring-blue-500/60 transition-all bg-[#FAF7F2]">
          <CardOnlyPreview key={card.handle} src={`/${card.handle}?embed=card`} />
        </button>
      </Box>
      {/* The same share box the real dashboard shows: Show QR first, then
          Share link, Other ways to share, and "At an event?" (drawn — tagging
          contacts needs an account). */}
      <Box className="space-y-2">
        <QRCodeModal url={qrScanUrl(cardUrl)} firstName={String(card.data.name ?? "").split(/\s+/)[0] || "me"} label="Show QR" variant="primary" contactPayload={contactPayload} />
        <ShareButton url={cardUrl} title="My SwiftCard" text="Save my contact and connect with me instantly." label="Share link" variant="ghost" />
        <MoreShareOptions url={cardUrl} />
        <div className="pt-2">
          <span className="w-full flex items-center justify-center gap-1.5 text-[0.6875rem] font-semibold text-gray-500">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-3 h-3 shrink-0 text-gray-500" aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
            </svg>
            At an event? Tag today&apos;s contacts
          </span>
        </div>
      </Box>
    </>
  );

  const Wrapper = embedded ? "div" : "main";
  return (
    // data-sc-theme="light" + .sc-app: the app opens LIGHT (9d7e592), so the
    // demo of it must too. Same hooks globals.css keys the real dashboard's
    // light remap on, so the same classes get the same treatment. The site
    // nav above stays outside .sc-app (the site header is dark, owner
    // 2026-09-17); the full-screen phone viewers are portalled to <body>.
    <Wrapper data-sc-theme="light" className={embedded ? "text-white" : "min-h-screen bg-gray-950 text-white"}>
      {!embedded && <SiteNav />}
      <div className="sc-app bg-gray-950 text-white min-h-screen">
      {/* The signed-in portal's own navbar, replicated so the demo looks like
          the real thing rather than a marketing page wearing its data. Its
          tabs switch which section below is shown, same as the real app's
          Dashboard / Contacts / Links pages. */}
      {!embedded && <PortalNavPreview tab={portalTab} onTabChange={setPortalTab} />}

      <div className={embedded ? "max-w-5xl mx-auto px-5 py-7" : "max-w-5xl mx-auto px-5 pt-7 pb-7"}>
        {!embedded && (
          <div className="mb-6">
            {/* text-white as its own class: the light remap recolours .text-white
                INSIDE .sc-app, and an inherited colour would stay white. */}
            <h1 className="text-2xl font-bold text-white">This is your dashboard — try it out</h1>
            <p className="text-gray-300 text-sm mt-1.5">The real app, loaded with sample data. Nothing to install.</p>
          </div>
        )}

        {portalTab === "dashboard" && (<>
        {/* Plain-language guide so a first-time visitor knows what this is and what to tap */}
        <div className="rounded-2xl border border-blue-800/40 bg-blue-950/30 p-4 sm:p-5 mb-5">
          <p className="text-blue-100 text-sm font-bold mb-3">New here? Start with these three:</p>
          <div className="grid sm:grid-cols-3 gap-2.5">
            {([
              { n: "1", t: "See your SwiftCard", d: "The real card people get when you share.", act: () => openDemo("card") },
              { n: "2", t: "Open Swift Links", d: "Your link-in-bio page — it lives under the Links tab.", act: () => openDemo("links") },
              { n: "3", t: "Preview Swift Signature", d: "Your card in every email — also under Links.", act: () => openDemo("signature") },
            ] as const).map((s) => (
              <button key={s.n} type="button" onClick={s.act}
                className="text-left rounded-xl bg-gray-900/50 border border-gray-800 hover:border-blue-700/60 px-3 py-2.5 transition-colors">
                <div className="flex items-center gap-2 mb-1">
                  <span className="w-5 h-5 rounded-full bg-blue-600 text-white text-[0.6875rem] font-bold flex items-center justify-center shrink-0">{s.n}</span>
                  <span className="text-white text-[0.75rem] font-semibold">{s.t}</span>
                </div>
                <p className="text-gray-400 text-[0.6875rem] leading-snug">{s.d}</p>
              </button>
            ))}
          </div>
          <p className="text-blue-300/70 text-[0.6875rem] mt-3">Tip: switch cards up top — every number updates.</p>
        </div>

        {/* My Cards */}
        {/* My Cards — the real box: its caption, "View Live Link" + "Add card"
            top-right, and an Edit button on every row (2026-09-29). View Live
            Link opens the live card here; Add card and Edit are drawn (there
            is no account to add to or edit). */}
        <Box className="mb-5">
          <div className="flex items-center justify-between gap-3 mb-3">
            <div className="min-w-0">
              <p className="text-white font-semibold text-sm">My Cards</p>
              <p className="hidden sm:block text-gray-600 text-xs mt-0.5">Check a card to view everything about it. Only one card can be selected at a time.</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button type="button" onClick={() => openDemo("card")}
                className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1.5 sm:px-3 sm:py-2 rounded-lg border border-gray-700 text-gray-300 text-[0.6875rem] sm:text-xs font-semibold hover:border-gray-500 hover:text-white hover:bg-gray-800 transition-colors">
                <svg viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3 sm:w-3.5 sm:h-3.5" aria-hidden="true">
                  <path d="M10 12a2 2 0 100-4 2 2 0 000 4z" />
                  <path fillRule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clipRule="evenodd" />
                </svg>
                View Live Link
              </button>
              <span className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1.5 sm:px-3 sm:py-2 rounded-lg border border-gray-700 text-blue-400 text-[0.6875rem] sm:text-xs font-semibold">
                <svg viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3 sm:w-3.5 sm:h-3.5" aria-hidden="true"><path d="M10.75 4.75a.75.75 0 00-1.5 0v4.5h-4.5a.75.75 0 000 1.5h4.5v4.5a.75.75 0 001.5 0v-4.5h4.5a.75.75 0 000-1.5h-4.5v-4.5z" /></svg>
                Add card
              </span>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {CARDS.map((c) => {
              const active = c.key === activeKey;
              return (
                <div key={c.key} className={`flex items-center gap-3 rounded-xl px-4 py-3 border flex-1 min-w-full sm:min-w-[240px] transition-colors ${active ? "bg-blue-600/10 border-blue-600/40" : "bg-gray-800/60 border-gray-700/60 hover:border-gray-600"}`}>
                  <button type="button" role="radio" aria-checked={active} onClick={() => { setActiveKey(c.key); setEngaged(true); }} className="flex items-center gap-3 flex-1 min-w-0 text-left">
                    <span className={`w-[18px] h-[18px] rounded-[5px] border flex items-center justify-center shrink-0 ${active ? "bg-blue-600 border-blue-600" : "border-gray-600"}`}>
                      {active && <svg viewBox="0 0 20 20" fill="white" className="w-3 h-3"><path fillRule="evenodd" d="M16.704 5.29a1 1 0 010 1.42l-7.5 7.5a1 1 0 01-1.42 0l-3.5-3.5a1 1 0 111.42-1.42l2.79 2.79 6.79-6.79a1 1 0 011.42 0z" clipRule="evenodd" /></svg>}
                    </span>
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold shrink-0 ${active ? "bg-blue-600/30 border border-blue-500/40 text-blue-300" : "bg-gray-700 text-gray-300"}`}>{c.label[0]}</div>
                    <div className="min-w-0 flex-1">
                      <p className="text-white text-sm font-medium truncate">{c.label}</p>
                      <p className="text-gray-500 text-xs truncate">/{c.handle} · {c.data.name}</p>
                    </div>
                  </button>
                  <span className={`shrink-0 inline-flex items-center justify-center gap-1 h-7 min-w-7 px-2 rounded-lg border text-[0.6875rem] font-semibold ${active ? "border-blue-500/40 text-blue-300" : "border-gray-600/70 text-gray-300"}`}>
                    <svg viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3 shrink-0" aria-hidden="true">
                      <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
                    </svg>
                    <span className="max-sm:hidden">Edit</span>
                  </span>
                </div>
              );
            })}
          </div>
        </Box>

        {/* Mobile only: Your Card + Share right under My Cards (matches the real dashboard) */}
        <div className="flex flex-col gap-4 mb-5 lg:hidden">
          {cardSharePanel}
        </div>

        {/* Traffic | Your Card + Share, like the real dashboard since Quick
            Contacts left it (2026-09-29): Traffic on the left, the card panel
            beside it on a computer (on a phone the panel is above, under My
            Cards). Swift Links + Swift Signature live on the Links tab,
            mirroring /share in the real portal. */}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-5 lg:items-start">
          <div className="min-w-0">
          <Box>
            {/* No "Traffic" heading (real dashboard since 2026-09-29): the range
                bar starts at the box's left edge — four equal tabs across a
                phone, its compact size on a computer. */}
            <div className="flex items-center mb-4">
              <div className="grid grid-cols-4 w-full lg:flex lg:w-auto items-center bg-gray-800 rounded-lg p-0.5">
                {RANGES.map((r) => (
                  <button key={r.id} type="button" onClick={() => setRange(r.id)}
                    className={`text-[0.6875rem] min-[375px]:text-xs font-semibold px-0.5 py-1.5 lg:px-2.5 lg:py-1 rounded-md whitespace-nowrap transition-colors ${range === r.id ? "bg-gray-700 text-white" : "text-gray-500 hover:text-gray-300"}`}>{r.label}</button>
                ))}
              </div>
            </div>
            {range === "locations" ? (
              /* Locations — top places views come from, split by surface (mirrors the real dashboard) */
              <div className="space-y-2">
                <p className="text-gray-500 text-[0.6875rem] mb-1">Top locations · all time</p>
                {card.locations.map((loc) => (
                  <div key={loc.location} className="bg-gray-800/40 border border-gray-800 rounded-xl px-4 py-3">
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <p className="text-gray-100 text-sm font-semibold truncate">{loc.location}</p>
                      <p className="text-white text-sm font-bold tabular-nums shrink-0">{(loc.card + loc.link).toLocaleString("en-US")} <span className="text-gray-500 font-medium text-[0.6875rem]">views</span></p>
                    </div>
                    <div className="flex items-center gap-4 text-[0.6875rem]">
                      <span className="text-gray-500">SwiftCard <span className="text-gray-200 font-semibold tabular-nums">{loc.card.toLocaleString("en-US")}</span></span>
                      <span className="text-gray-500">Swift Links <span className="text-gray-200 font-semibold tabular-nums">{loc.link.toLocaleString("en-US")}</span></span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
            <div>
              {/* Stat tiles — label + count only, as the real box (its
                  "▲ x% vs last week" line was removed on 2026-08-13). */}
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: "SwiftCard views", value: traffic.card },
                  { label: "Swift Link views", value: traffic.links },
                ].map((m) => (
                  <div key={m.label} className="bg-gray-800/40 border border-gray-800 rounded-xl px-4 py-3.5 min-w-0">
                    <p className="text-gray-400 text-xs font-medium truncate">{m.label}</p>
                    <p className="text-2xl font-bold text-white tabular-nums mt-0.5">{m.value}</p>
                  </div>
                ))}
              </div>
              {/* Unique vs repeat for the same window, as the real box. */}
              <div className="flex items-center gap-4 mt-2 text-[0.6875rem]">
                <span className="text-gray-500">Unique viewers <span className="text-gray-200 font-semibold tabular-nums">{unique.toLocaleString("en-US")}</span></span>
                <span className="text-gray-500">Repeat views <span className="text-gray-200 font-semibold tabular-nums">{(totalViews - unique).toLocaleString("en-US")}</span></span>
              </div>
              {/* Same time-series bar graph the real dashboard renders, split
                  into SwiftCard and Swift Links. Buckets are generated on mount
                  (they carry real timestamps, which would differ between
                  server render and hydration). */}
              {buckets && (
                <TrafficChart
                  buckets={buckets.list}
                  range={range}
                  max={buckets.max}
                  tz={undefined}
                />
              )}
            </div>
            )}
            {/* Footer — link taps, like the real box */}
            <div className="flex items-center gap-2 mt-3 pt-3 border-t border-gray-800/70 text-[0.6875rem]">
              <span className="text-gray-500">Link taps <span className="text-gray-200 font-semibold tabular-nums">{linkTaps.toLocaleString("en-US")}</span></span>
            </div>
          </Box>
          </div>
          <div className="hidden lg:flex lg:flex-col gap-4">
            {cardSharePanel}
          </div>
        </div>

        </>)}

        {/* Links tab — replica of the real /share page: a narrow centred
            column with a Links header, then the SAME Swift Links | Swift
            Signature switch (LinksPageTabs — the real component, so the two
            can't drift). Each side: a one-line intro, the real thing, then its
            actions. syncHash off: this demo lives inside other pages and must
            not write their URL. */}
        {portalTab === "links" && (
          <div className="max-w-md mx-auto">
            <div className="mb-6">
              <p className="text-[0.6875rem] font-bold tracking-[0.25em] text-blue-500 uppercase mb-1">SwiftCard</p>
              <h2 className="text-2xl font-bold text-white">Links</h2>
              <p className="text-gray-300 text-sm mt-1">
                For <span className="text-gray-300 font-medium">{card.label}</span>
                <span className="text-gray-400"> · /{card.handle}</span>
              </p>
            </div>

            <LinksPageTabs
              syncHash={false}
              links={
                <>
                  <div className="mb-4">
                    <h3 className="text-base font-semibold text-white">Your link-in-bio page</h3>
                    <p className="text-gray-300 text-sm mt-1 leading-relaxed">
                      A separate link from your card — your bio, socials, and links in one place. Drop it in your Instagram, TikTok, or any social bio.
                    </p>
                  </div>
                  <Box>
                    {/* The demo account's real Swift Links page in a mini phone
                        (the portal renders SwiftLinkLivePreview from the
                        account; the demo has no account, so it frames the live
                        page — embed=1 records no view). Tapping opens it. */}
                    <div className="relative w-full max-w-[220px] sm:max-w-[240px] mx-auto mb-4 max-h-[340px] sm:max-h-[380px] overflow-hidden rounded-[30px] [mask-image:linear-gradient(to_bottom,black_78%,transparent)]">
                      <CardScaler natural={390}>
                        <iframe key={card.handle} src={`/links/${card.handle}?embed=1`} title={`${card.label} Swift Links preview`} loading="lazy" tabIndex={-1}
                          style={{ display: "block", width: 390, height: 720, border: 0 }} />
                      </CardScaler>
                      <button type="button" onClick={() => openDemo("links")} aria-label="Open Swift Links" className="absolute inset-0" />
                    </div>
                    <div className="flex items-center gap-2 bg-gray-800/60 border border-gray-700/60 rounded-xl px-3 py-2.5">
                      <svg viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth={1.8} className="w-3.5 h-3.5 shrink-0">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244" />
                      </svg>
                      <span className="text-blue-400 text-xs truncate flex-1">swiftcard.me/links/{card.handle}</span>
                      <button type="button" onClick={copyLinksUrl}
                        className="text-[0.6875rem] font-semibold text-gray-300 hover:text-white bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg px-2.5 py-1 transition-colors shrink-0">
                        {linksCopied ? "Copied ✓" : "Copy"}
                      </button>
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <button type="button" onClick={() => openDemo("links")}
                        className="block w-full text-center text-xs font-semibold text-gray-400 hover:text-white bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-full py-2 transition-colors">
                        Open Swift Links →
                      </button>
                      {/* Drawn, like the demo's other Edit buttons. */}
                      <span className="block text-center text-xs font-semibold text-gray-400 bg-gray-800 border border-gray-700 rounded-full py-2">
                        Edit my links
                      </span>
                    </div>
                  </Box>
                </>
              }
              signature={
                <>
                  <div className="mb-4">
                    <h3 className="text-base font-semibold text-white">Your card in every email</h3>
                    <p className="text-gray-300 text-sm mt-1 leading-relaxed">
                      Copy your Swift Signature and paste it into your email — a clickable link to your card at the bottom of every message you send.
                    </p>
                  </div>
                  {/* The same signature, in place — as EmailSignatureBox now
                      shows it on the real page (no "Preview & copy" pop-up). */}
                  <Box>{signatureDemo}</Box>
                </>
              }
              create={<CreateDemo person={{ name: card.data.name, title: card.data.title, company: card.data.company, phone: card.data.phone, email: card.data.email }} />}
            />
          </div>
        )}

        {/* Contacts tab — the real /contacts list: "All contacts" with Scan a
            card + Add contact, search, sort and the count, then one row per
            contact — avatar (with the unread dot), name + where they came
            from, company, email, when — with Call / Text / Email and the read
            dot. No Notifications / List / Pipeline switch and no statuses:
            neither exists in the product (statuses left on 2026-08-11). The
            read dot works; everything that needs an account is drawn. */}
        {portalTab === "contacts" && (
        <div className="max-w-xl mx-auto">
          <Box className="!p-0 overflow-hidden">
            <div className="p-4 border-b border-gray-800 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-gray-500 text-xs">All contacts</p>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-xl whitespace-nowrap border border-gray-700 text-gray-300">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-3.5 h-3.5" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0z" />
                    </svg>
                    Scan a card
                  </span>
                  <span className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-xl whitespace-nowrap" style={{ background: "#1D4ED8", color: "#fff" }}>
                    <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5"><path d="M8 2a1 1 0 011 1v4h4a1 1 0 110 2H9v4a1 1 0 11-2 0V9H3a1 1 0 110-2h4V3a1 1 0 011-1z"/></svg>
                    Add contact
                  </span>
                </div>
              </div>
              <div className="relative">
                <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <div className="w-full bg-gray-900 border border-gray-700 text-gray-500 rounded-xl pl-9 pr-4 py-2.5 text-sm">Search contacts…</div>
              </div>
              <div className="bg-gray-900 border border-gray-700 text-gray-300 rounded-xl px-3 py-2 text-xs w-full">Recently Added</div>
              <p className="text-gray-600 text-xs pl-1">{card.leads.length} contacts</p>
            </div>
            <div>
              {card.leads.map((l) => {
                const unread = !read[l.id];
                return (
                  <div key={l.id} className="w-full text-left px-4 py-3.5 border-b border-gray-800/50 last:border-b-0">
                    <div className="flex items-start gap-3">
                      <div className="flex items-start gap-3 flex-1 min-w-0">
                        <div className="relative shrink-0 mt-0.5">
                          <div className="w-9 h-9 rounded-full bg-blue-600 flex items-center justify-center text-xs font-bold text-white">{l.name[0]}</div>
                          {unread && <span className="absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full bg-blue-500 border-2 border-gray-950" title="Unread" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className={`text-sm truncate ${unread ? "text-white font-bold" : "text-gray-100 font-semibold"}`}>{l.name}</p>
                            {l.source && <span className="text-[0.625rem] font-semibold px-2 py-0.5 rounded-full bg-blue-950 text-blue-300 shrink-0">{l.source}</span>}
                          </div>
                          <p className="text-gray-400 text-xs truncate">{l.company}</p>
                          <p className="text-gray-500 text-xs truncate">{l.email}</p>
                          <p className="text-gray-700 text-[0.625rem] mt-0.5">{l.time}</p>
                        </div>
                      </div>
                      <div className="self-center"><DemoContactActions name={l.name} phone email /></div>
                      <button
                        type="button"
                        onClick={() => toggleRead(l.id)}
                        title={unread ? "Mark as read" : "Mark as unread"}
                        aria-label={unread ? "Mark as read" : "Mark as unread"}
                        className={`shrink-0 self-center p-1.5 rounded-lg transition-colors ${unread ? "text-blue-400 hover:bg-blue-500/10" : "text-gray-500 hover:text-gray-300 hover:bg-gray-800"}`}
                      >
                        <span aria-hidden="true" className="flex w-4 h-4 items-center justify-center">
                          <span className={`block w-2.5 h-2.5 rounded-full ${unread ? "bg-current" : "border-[1.5px] border-current"}`} />
                        </span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </Box>
        </div>
        )}

        <div className="mt-10 text-center">
          <p className="text-gray-400 text-sm mb-4">This is exactly what you get — set up your own in under 30 seconds.</p>
          <Link href="/join?src=preview" className="inline-block bg-blue-600 hover:bg-blue-500 text-white font-bold px-9 py-4 rounded-full transition-colors text-base">Create Your Card for Free →</Link>
        </div>
      </div>
      </div>

      {/* Sticky signup bar — standalone page only, appears after first interaction,
          hides while a full-screen preview (which has its own CTA) is open */}
      {!embedded && engaged && !ctaHidden && !modal && (
        <div className="fixed inset-x-0 bottom-0 z-40 px-4 pb-[max(14px,env(safe-area-inset-bottom))] pointer-events-none">
          <div className="pointer-events-auto max-w-sm mx-auto rounded-full p-[1.5px] bg-gradient-to-r from-blue-600 via-blue-500 to-sky-400 shadow-[0_10px_35px_rgba(37,99,235,0.45)] sc-cta-rise">
            <div className="flex items-center gap-1 rounded-full bg-gray-950/95 backdrop-blur p-1.5">
              <Link
                href="/join?src=preview"
                className="flex-1 text-center text-[0.8125rem] font-bold text-white bg-gradient-to-r from-blue-600 to-violet-600 hover:from-blue-500 hover:to-violet-500 px-5 py-2.5 rounded-full transition-colors"
              >
                Create Your Card for Free →
              </Link>
              <button onClick={hideStickyCta} aria-label="Dismiss" className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-gray-300 transition-colors shrink-0">
                <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4"><path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" /></svg>
              </button>
            </div>
          </div>
          <style>{`
            @keyframes sc-cta-rise { from { transform: translateY(16px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
            .sc-cta-rise { animation: sc-cta-rise 0.3s ease-out; }
            @media (prefers-reduced-motion: reduce) { .sc-cta-rise { animation: none; } }
          `}</style>
        </div>
      )}

      {/* Full-page live previews */}
      {modal === "card" && (
        <FullScreen title={`${card.label} — your live SwiftCard`} href={`/${card.handle}`} onClose={() => setModal(null)}>
          <IframePhone src={`/${card.handle}?embed=1`} />
        </FullScreen>
      )}
      {modal === "links" && (
        <FullScreen title="Swift Links — your live link-in-bio page" href={`/links/${card.handle}`} onClose={() => setModal(null)}>
          <IframePhone src={`/links/${card.handle}?embed=1`} />
        </FullScreen>
      )}
      {modal === "signature" && (
        <FullScreen title="Swift Signature — your card in every email" onClose={() => setModal(null)}>
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5 w-full max-w-md">
            {signatureDemo}
          </div>
        </FullScreen>
      )}
    </Wrapper>
  );
}
