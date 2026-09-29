"use client";

import { useEffect, useRef, useState } from "react";
import SiteNav from "@/components/site/SiteNav";
import PortalNavPreview, { type PortalTabId } from "@/components/site/PortalNavPreview";
import { createPortal } from "react-dom";
import Link from "next/link";
import DemoContactActions from "@/components/site/DemoContactActions";
import ShareButton from "@/components/ShareButton";
import MoreShareOptions from "@/components/MoreShareOptions";
import type { CardData } from "@/components/card-templates/types";
import TrafficChart, { type TrafficBucket } from "@/components/TrafficChart";

type Range = "today" | "week" | "month" | "locations";
type DemoLocation = { location: string; card: number; link: number };
type Status = "New Contact" | "Touch" | "Dissolved";
type Lead = { id: string; name: string; initial: string; source: string; color: string; status: Status; msg: string; time: string; read: boolean };
type DemoCard = {
  key: "sales" | "realestate";
  label: string;
  handle: string;
  template: string;
  accent: string;
  data: CardData;
  total: string;
  traffic: Record<"today" | "week" | "month", { card: string; links: string }>;
  /** % change vs the previous same-size window — the real Traffic box shows this. */
  deltas: Record<"today" | "week" | "month", { card: number; links: number }>;
  bestDay: { label: string; views: number };
  locations: DemoLocation[];
  leads: Lead[];
};

/** Same phrasing the real dashboard uses under each stat tile. */
const DELTA_PERIOD: Record<"today" | "week" | "month", string> = {
  today: "vs yesterday",
  week: "vs last week",
  month: "vs last month",
};

const CARDS: DemoCard[] = [
  {
    key: "sales", label: "Sales Card", handle: "demo-sales", template: "modern-bold", accent: "#2563eb", total: "87",
    traffic: { today: { card: "142", links: "63" }, week: { card: "1,248", links: "593" }, month: { card: "4,517", links: "2,104" } },
    deltas: { today: { card: 18, links: 9 }, week: { card: 12, links: 7 }, month: { card: 23, links: 15 } },
    bestDay: { label: "Jul 24", views: 316 },
    locations: [
      { location: "New York, US", card: 1834, link: 902 },
      { location: "Chicago, US", card: 1121, link: 486 },
      { location: "Austin, US", card: 764, link: 341 },
      { location: "Miami, US", card: 512, link: 227 },
    ],
    leads: [
      { id: "s1", name: "Sarah Chen", initial: "S", source: "LinkedIn", color: "#0A66C2", status: "New Contact", msg: "Loved your pitch — let's set up a call this week!", time: "2m ago", read: false },
      { id: "s2", name: "Priya Patel", initial: "P", source: "Instagram", color: "#F9A8D4", status: "New Contact", msg: "Saw your card — I'd love a demo for my team.", time: "1h ago", read: false },
      { id: "s3", name: "James Carter", initial: "J", source: "Share Link", color: "#10B981", status: "Touch", msg: "Great meeting you at the conference!", time: "Yesterday", read: true },
      { id: "s4", name: "Tom Nguyen", initial: "T", source: "QR Code", color: "#93C5FD", status: "Dissolved", msg: "Thanks — not a fit right now.", time: "3d ago", read: true },
    ],
    data: {
      name: "Alex Morgan", title: "Account Executive", company: "Northwind SaaS",
      phone: "(415) 555-0142", email: "alex@northwind.io", website: "northwind.io",
      address: "", initials: "AM", photoUrl: null, logoUrl: null, customization: { accentColor: "#2563eb" },
    },
  },
  {
    key: "realestate", label: "Real Estate Card", handle: "demo-realty", template: "local-business", accent: "#d97706", total: "143",
    traffic: { today: { card: "231", links: "98" }, week: { card: "2,034", links: "874" }, month: { card: "7,860", links: "3,221" } },
    deltas: { today: { card: 11, links: 21 }, week: { card: 16, links: 10 }, month: { card: 19, links: 26 } },
    bestDay: { label: "Jul 26", views: 489 },
    locations: [
      { location: "San Francisco, US", card: 3105, link: 1240 },
      { location: "Oakland, US", card: 1877, link: 705 },
      { location: "San Jose, US", card: 1442, link: 618 },
      { location: "Sacramento, US", card: 903, link: 366 },
    ],
    leads: [
      { id: "r1", name: "Nathan Cole", initial: "N", source: "QR Code", color: "#93C5FD", status: "Touch", msg: "Is the Maple St listing still available?", time: "12m ago", read: false },
      { id: "r2", name: "Elena Ruiz", initial: "E", source: "Website", color: "#0EA5E9", status: "New Contact", msg: "Can you send pricing for next month?", time: "2h ago", read: false },
      { id: "r3", name: "David Kim", initial: "D", source: "NFC Tap", color: "#C4B5FD", status: "New Contact", msg: "Looking to tour homes this weekend.", time: "Yesterday", read: false },
      { id: "r4", name: "Olivia Brooks", initial: "O", source: "Instagram", color: "#F9A8D4", status: "Dissolved", msg: "Found a place — thanks for your help!", time: "4d ago", read: true },
    ],
    data: {
      name: "Alex Morgan", title: "Realtor®", company: "Coastline Realty",
      phone: "(415) 555-0188", email: "alex@coastlinerealty.com", website: "coastlinehomes.com",
      address: "1200 Ocean Ave\nSan Francisco\nCA 94122", initials: "AM", photoUrl: null, logoUrl: null, customization: { accentColor: "#d97706" },
    },
  },
];

const STATUS_STYLE: Record<Status, { bg: string; text: string }> = {
  "New Contact": { bg: "rgba(59,130,246,0.15)", text: "#93c5fd" },
  "Touch": { bg: "rgba(245,158,11,0.15)", text: "#fcd34d" },
  "Dissolved": { bg: "rgba(107,114,128,0.18)", text: "#9ca3af" },
};

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

function ReadToggle({ read, onClick }: { read: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={(e) => { e.stopPropagation(); onClick(); }}
      className={`text-[0.625rem] font-semibold px-2 py-0.5 rounded-full border transition-colors whitespace-nowrap ${read ? "text-gray-400 border-gray-700 hover:text-gray-300" : "text-blue-300 border-blue-600/50 bg-blue-600/10 hover:bg-blue-600/20"}`}>
      {read ? "Mark unread" : "Mark read"}
    </button>
  );
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
const VIEWS = ["Notifications", "List", "Pipeline"] as const;

export default function PreviewClient({ embedded = false }: { embedded?: boolean }) {
  const [activeKey, setActiveKey] = useState<DemoCard["key"]>("realestate");
  // Which portal page the demo is showing, driven by PortalNavPreview's tabs.
  const [portalTab, setPortalTab] = useState<PortalTabId>("dashboard");
  const [range, setRange] = useState<Range>("week");
  const [view, setView] = useState<(typeof VIEWS)[number]>("Notifications");
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
  const firstName = card.data.name.split(" ")[0];
  const traffic = card.traffic[range === "locations" ? "week" : range];

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
    // eslint-disable-next-line react-hooks/purity -- runs in an effect, not render: bucket timestamps must come from the real clock so the chart's axis reads like live data
    const nowBucket = Math.floor(Date.now() / stepMs) * stepMs;
    const list: TrafficBucket[] = weights.map((w, i) => ({
      ts: nowBucket - (n - 1 - i) * stepMs,
      count: Math.max(0, Math.round((total * w) / sum)),
    }));
    // eslint-disable-next-line react-hooks/set-state-in-effect -- client-only clock-derived data
    setBuckets({ list, max: Math.max(...list.map((b) => b.count), 1) });
  }, [card, range]);
  const cardUrl = `https://swiftcard.me/${card.handle}`;
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

  // Your Card + Share + other ways to share — shown under My Cards on mobile and in the
  // sticky right column on desktop, matching the real dashboard's phone layout.
  const cardSharePanel = (
    <>
      <Box>
        <div className="flex items-center gap-2 mb-1">
          <span className="w-5 h-5 rounded-full bg-blue-600 text-white text-[0.6875rem] font-bold flex items-center justify-center shrink-0">1</span>
          <p className="text-white text-sm font-semibold">Your SwiftCard</p>
        </div>
        <p className="text-gray-300 text-[0.6875rem] mb-3 leading-relaxed">Exactly what people get when you share — tap to open.</p>
        <button type="button" onClick={() => openDemo("card")} className="block w-full rounded-xl overflow-hidden ring-1 ring-blue-500/30 hover:ring-blue-500/60 transition-all bg-[#FAF7F2]">
          <CardOnlyPreview key={card.handle} src={`/${card.handle}?embed=card`} />
        </button>
        <button type="button" onClick={() => openDemo("card")} className="mt-3 w-full text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 rounded-full py-2.5 transition-colors">Preview SwiftCard →</button>
      </Box>
      <Box className="space-y-2">
        <ShareButton url={cardUrl} title="My SwiftCard" text="Save my contact and connect with me instantly." label="Share" />
        <MoreShareOptions url={cardUrl} />
      </Box>
    </>
  );

  const Wrapper = embedded ? "div" : "main";
  return (
    <Wrapper className={embedded ? "text-white" : "min-h-screen bg-gray-950 text-white"}>
      {!embedded && <SiteNav />}
      {/* The signed-in portal's own navbar, replicated so the demo looks like
          the real thing rather than a marketing page wearing its data. Its
          tabs switch which section below is shown, same as the real app's
          Dashboard / Contacts / Links pages. */}
      {!embedded && <PortalNavPreview tab={portalTab} onTabChange={setPortalTab} />}

      <div className={embedded ? "max-w-5xl mx-auto px-5 py-7" : "max-w-5xl mx-auto px-5 pt-7 pb-7"}>
        {!embedded && (
          <div className="mb-6">
            <h1 className="text-2xl font-bold">This is your dashboard — try it out</h1>
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
        <Box className="mb-5">
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-white font-semibold text-sm">My Cards</p>
              <p className="text-gray-300 text-xs mt-0.5">Tap a card to switch — everything below updates to that card.</p>
            </div>
            <span className="text-xs text-blue-400 font-medium">+ Add card</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {CARDS.map((c) => {
              const active = c.key === activeKey;
              return (
                <button key={c.key} onClick={() => { setActiveKey(c.key); setEngaged(true); }} type="button"
                  className={`text-left flex items-center gap-3 rounded-xl px-4 py-3 border flex-1 min-w-full sm:min-w-[230px] transition-colors ${active ? "bg-blue-600/10 border-blue-600/40" : "bg-gray-800/60 border-gray-700/60 hover:border-gray-600"}`}>
                  <span className={`w-[18px] h-[18px] rounded-[5px] border flex items-center justify-center shrink-0 ${active ? "bg-blue-600 border-blue-600" : "border-gray-600"}`}>
                    {active && <svg viewBox="0 0 20 20" fill="white" className="w-3 h-3"><path fillRule="evenodd" d="M16.704 5.29a1 1 0 010 1.42l-7.5 7.5a1 1 0 01-1.42 0l-3.5-3.5a1 1 0 111.42-1.42l2.79 2.79 6.79-6.79a1 1 0 011.42 0z" clipRule="evenodd" /></svg>}
                  </span>
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold shrink-0 text-white" style={{ background: c.accent }}>{c.label[0]}</div>
                  <div className="min-w-0 flex-1">
                    <p className="text-white text-sm font-medium truncate">{c.label}</p>
                    <p className="text-gray-300 text-xs truncate">/{c.handle} · {c.data.title}</p>
                  </div>
                </button>
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
            {/* flex-wrap + gap: "Traffic" plus the four range pills need 287px
                of a 280px box at 320px, which was the last 5px of sideways
                scroll on this page. The pills drop under the label there; at
                360px+ they still sit on the same line as before. */}
            <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
              <p className="text-white font-semibold text-sm">Traffic</p>
              <div className="flex items-center bg-gray-800 rounded-lg p-0.5">
                {RANGES.map((r) => (
                  <button key={r.id} type="button" onClick={() => setRange(r.id)}
                    className={`text-xs font-semibold px-2.5 py-1 rounded-md transition-colors ${range === r.id ? "bg-gray-700 text-white" : "text-gray-400 hover:text-gray-300"}`}>{r.label}</button>
                ))}
              </div>
            </div>
            {range === "locations" ? (
              /* Locations — top places views come from, split by surface (mirrors the real dashboard) */
              <div className="space-y-2">
                {card.locations.map((loc) => (
                  <div key={loc.location} className="bg-gray-800/40 border border-gray-800 rounded-xl px-4 py-3">
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <p className="text-gray-100 text-sm font-semibold truncate">{loc.location}</p>
                      <p className="text-white text-sm font-bold tabular-nums shrink-0">{(loc.card + loc.link).toLocaleString()} <span className="text-gray-400 font-medium text-[0.6875rem]">views</span></p>
                    </div>
                    <div className="flex items-center gap-4 text-[0.6875rem]">
                      <span className="text-gray-400">SwiftCard <span className="text-gray-200 font-semibold tabular-nums">{loc.card.toLocaleString()}</span></span>
                      <span className="text-gray-400">Swift Links <span className="text-gray-200 font-semibold tabular-nums">{loc.link.toLocaleString()}</span></span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
            <div>
              {/* Stat tiles side by side with change vs the previous window —
                  the exact layout the real dashboard's Traffic box uses. */}
              <div className="grid grid-cols-2 gap-3">
                {/* range is already narrowed here — the locations branch was
                    handled above, so no defensive fallback is needed. */}
                {[
                  { label: "SwiftCard views", value: traffic.card, delta: card.deltas[range].card, accent: "#818cf8" },
                  { label: "Swift Link views", value: traffic.links, delta: card.deltas[range].links, accent: "#22d3ee" },
                ].map((m) => (
                  <div key={m.label} className="bg-gray-800/40 border border-gray-800 rounded-xl px-4 py-3.5 min-w-0">
                    <p className="text-gray-400 text-xs font-medium truncate">{m.label}</p>
                    <p className="text-2xl font-bold text-white tabular-nums mt-0.5">{m.value}</p>
                    <p className="text-[0.6875rem] font-semibold mt-0.5" style={{ color: m.delta < 0 ? "#f87171" : m.accent }}>
                      {m.delta < 0 ? "▼" : "▲"} {Math.abs(m.delta)}% {DELTA_PERIOD[range]}
                    </p>
                  </div>
                ))}
              </div>
              {/* Same time-series bar graph the real dashboard renders. Buckets
                  are generated on mount (they carry real timestamps, which
                  would differ between server render and hydration). */}
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
            {/* Basic stats footer — contacts captured + best day, like the real box */}
            <div className="flex items-center justify-between gap-2 mt-3 pt-3 border-t border-gray-800/70 text-[0.6875rem]">
              <span className="text-gray-400">Contacts <span className="text-gray-200 font-semibold tabular-nums">{card.total}</span></span>
              <span className="text-gray-400">Best day <span className="text-gray-200 font-semibold">{card.bestDay.label}</span> · {card.bestDay.views}</span>
            </div>
          </Box>
          </div>
          <div className="hidden lg:flex lg:flex-col gap-4">
            {cardSharePanel}
          </div>
        </div>

        </>)}

        {/* Links tab — replica of the real /share page: a narrow centred
            column with a Links header, the Swift Links section, then the
            Swift Signature section. This is where both live in the real
            portal now, so this is where the demo shows them. */}
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

            <div className="space-y-6">
              {/* Swift Links — same section the real /share page renders */}
              <div>
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Swift Links</p>
                <Box>
                  <p className="text-gray-300 text-xs mb-3 leading-relaxed">
                    A separate link from your card — your bio, socials, and links in one place. Drop it in your Instagram, TikTok, or any social bio.
                  </p>
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
                  <button type="button" onClick={() => openDemo("links")}
                    className="mt-2 block w-full text-center text-xs font-semibold text-gray-400 hover:text-white bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-full py-2 transition-colors">
                    Open Swift Links →
                  </button>
                </Box>
              </div>

              {/* Swift Signature — a replica of EmailSignatureBox's COLLAPSED
                  state, which is all the real Links page shows here: a title, a
                  line of copy, and one blue button that opens the signature in a
                  mock email. This used to show an inline card preview and a
                  two-button row that exist nowhere in the real portal, so the
                  page a visitor was told to trust as "your dashboard" didn't
                  match the one they'd get. Padding is p-4, not the p-5 Box —
                  EmailSignatureBox is the one card on this page that uses p-4. */}
              <div>
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Swift Signature</p>
                <div className="bg-gray-900 border border-gray-800/80 rounded-2xl p-4">
                  <p className="text-white font-semibold text-sm">Swift Signature</p>
                  <p className="text-gray-300 text-[0.6875rem] mt-1 leading-relaxed">
                    Copy your Swift Signature and paste it into your email — a clickable link to your card at the bottom of every message you send.
                  </p>
                  <button type="button" onClick={() => openDemo("signature")}
                    className="mt-3 w-full bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs py-2 rounded-full transition-colors">
                    Preview &amp; copy
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Contacts tab — the list takes the full width, matching the real
            /contacts page. (It no longer shows on the Dashboard tab: the real
            dashboard has no contact list since 2026-09-29.) */}
        {portalTab === "contacts" && (
        <div className="grid grid-cols-1 gap-5">
          {/* Contacts */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-baseline gap-2.5">
                <h2 className="text-white font-semibold text-sm">Contacts</h2>
                <span className="text-white font-bold text-lg tabular-nums">{card.total}</span>
                <span className="text-gray-300 text-[0.6875rem] font-medium">Total leads</span>
              </div>
              <span className="text-xs text-gray-300 bg-gray-800 border border-gray-700 px-3 py-1.5 rounded-lg">+ Add contact</span>
            </div>

            {/* View toggle — interactive */}
            <div className="flex flex-wrap items-center gap-2 mb-4">
              <div className="flex items-center bg-gray-800/80 rounded-lg p-0.5">
                {VIEWS.map((v) => (
                  <button key={v} type="button" onClick={() => setView(v)}
                    className={`text-xs font-medium px-3 py-1 rounded-md transition-colors ${view === v ? "bg-gray-700 text-white" : "text-gray-400 hover:text-gray-300"}`}>{v}</button>
                ))}
              </div>
            </div>

            {/* Notifications / List */}
            {(view === "Notifications" || view === "List") && (
              <div className="space-y-2">
                {card.leads.map((l) => {
                  const isRead = read[l.id];
                  return (
                    <div key={l.id} className={`border rounded-2xl px-4 py-3.5 flex items-center gap-3 transition-colors ${isRead ? "bg-gray-900 border-gray-800/80" : "bg-blue-600/[0.07] border-blue-600/30"}`}>
                      <span className={`w-2 h-2 rounded-full shrink-0 ${isRead ? "bg-transparent" : "bg-blue-500"}`} />
                      <div className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold shrink-0 text-white" style={{ background: l.color }}>{l.initial}</div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className={`text-sm truncate ${isRead ? "text-gray-200 font-medium" : "text-white font-semibold"}`}>{l.name}</p>
                          <span className="text-[0.625rem] font-semibold px-1.5 py-0.5 rounded shrink-0" style={{ background: l.color + "22", color: l.color }}>{l.source}</span>
                        </div>
                        <p className="text-gray-300 text-xs truncate mt-0.5">{view === "Notifications" ? `Shared their contact with ${firstName}` : l.msg}</p>
                      </div>
                      <DemoContactActions name={l.name} phone email />
                      <div className="flex flex-col items-end gap-1.5 shrink-0">
                        <span className="text-[0.625rem] font-semibold px-2 py-0.5 rounded-full" style={{ background: STATUS_STYLE[l.status].bg, color: STATUS_STYLE[l.status].text }}>{l.status}</span>
                        <div className="flex items-center gap-2">
                          <span className="text-gray-400 text-[0.625rem]">{l.time}</span>
                          <ReadToggle read={isRead} onClick={() => toggleRead(l.id)} />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Pipeline */}
            {view === "Pipeline" && (
              <div className="flex gap-3 overflow-x-auto pb-2">
                {(["New Contact", "Touch", "Dissolved"] as Status[]).map((status) => {
                  const items = card.leads.filter((l) => l.status === status);
                  return (
                    <div key={status} className="min-w-[160px] flex-1 bg-gray-900/40 border border-gray-800/80 rounded-2xl p-2.5">
                      <div className="flex items-center justify-between px-1 mb-2">
                        <span className="text-[0.6875rem] font-semibold" style={{ color: STATUS_STYLE[status].text }}>{status}</span>
                        <span className="text-gray-400 text-[0.625rem]">{items.length}</span>
                      </div>
                      <div className="space-y-2">
                        {items.map((l) => {
                          const isRead = read[l.id];
                          return (
                            <div key={l.id} className={`rounded-xl p-2.5 border transition-colors ${isRead ? "bg-gray-800/50 border-gray-700/50" : "bg-blue-600/[0.1] border-blue-600/30"}`}>
                              <div className="flex items-center gap-2">
                                <div className="w-6 h-6 rounded-full flex items-center justify-center text-[0.625rem] font-bold shrink-0 text-white" style={{ background: l.color }}>{l.initial}</div>
                                <p className="text-white text-xs font-semibold truncate flex-1">{l.name}</p>
                                {!isRead && <span className="w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0" />}
                              </div>
                              <p className="text-gray-400 text-[0.625rem] mt-1.5 leading-snug line-clamp-2">{l.msg}</p>
                              <div className="mt-2 flex justify-end"><ReadToggle read={isRead} onClick={() => toggleRead(l.id)} /></div>
                            </div>
                          );
                        })}
                        {items.length === 0 && <p className="text-gray-700 text-[0.625rem] text-center py-3">None</p>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

        </div>
        )}

        <div className="mt-10 text-center">
          <p className="text-gray-400 text-sm mb-4">This is exactly what you get — set up your own in under 30 seconds.</p>
          <Link href="/join?src=preview" className="inline-block bg-blue-600 hover:bg-blue-500 text-white font-bold px-9 py-4 rounded-full transition-colors text-base">Create Your Card for Free →</Link>
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
            <button onClick={copySig} className="w-full mt-4 bg-blue-600 hover:bg-blue-500 text-white font-semibold text-sm py-2.5 rounded-full transition-colors">
              {copied ? "Copied ✓ — paste it into your email signature" : "Copy Swift Signature"}
            </button>
            <p className="text-gray-400 text-[0.6875rem] mt-2 text-center">Paste into <strong className="text-gray-400">Gmail → Settings → Signature</strong>.</p>
          </div>
        </FullScreen>
      )}
    </Wrapper>
  );
}
