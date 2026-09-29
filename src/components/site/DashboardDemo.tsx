"use client";

import { useState } from "react";
import CardScaler from "@/components/CardScaler";
import ClassicPro from "@/components/card-templates/ClassicPro";
import { withoutSocials } from "@/components/card-templates/types";
import type { CardData } from "@/components/card-templates/types";
import DemoContactActions from "@/components/site/DemoContactActions";

// Same demo identity as SAMPLE_DATA (card-templates/types.tsx) and every other
// marketing demo (SwiftLinksPhone, SignatureDemo, TeamsDashboard) — one person,
// one company, everywhere on the site.
const DEMO_CARD: CardData = withoutSocials({
  name: "Alex Morgan",
  title: "Realtor®",
  company: "Coastline Realty",
  phone: "(415) 555-0188",
  email: "alex@coastlinerealty.com",
  website: "coastlinehomes.com",
  initials: "AM",
  photoUrl: "/marketing/demo-girl.jpg",
  logoUrl: null,
  cardUrl: "swiftcard.me/alexmorgan",
});

// Marketing-site replica of the real Pro /dashboard, inside a browser chrome.
// Mirrors the real page's structure and styling exactly:
//   • Traffic box on the left (Today / Week / Month / Locations)
//   • "Your Card" preview + Share panel on the right
// (Quick Contacts left the real dashboard on 2026-09-29 — its Call / Text /
// Email buttons are on every Contacts row now, and so they are here.)
// Purely presentational — all data is fictional; nothing is fetched.

// ── Traffic data per range ───────────────────────────────────────────────────
const TRAFFIC = {
  today: { label: "Today", card: "86", link: "41", bars: [24, 18, 32, 28, 44, 38, 56, 48, 70, 62, 84, 100] },
  week: { label: "Week", card: "1,284", link: "742", bars: [38, 52, 44, 68, 58, 82, 100] },
  month: { label: "Month", card: "5,190", link: "3,020", bars: [30, 24, 38, 32, 46, 40, 34, 52, 44, 58, 50, 64, 56, 48, 70, 62, 76, 66, 58, 82, 72, 88, 78, 68, 92, 82, 96, 86, 90, 100] },
} as const;
type Range = keyof typeof TRAFFIC;

const LOCATIONS = [
  { location: "San Francisco, US", card: 142, link: 88 },
  { location: "New York, US", card: 96, link: 54 },
  { location: "Austin, US", card: 61, link: 40 },
  { location: "London, UK", card: 38, link: 29 },
];

// ── Contacts total (the Traffic box's "Contacts" stat) ────────────────────────
const TOTAL_LEADS = 12;

// ── Traffic box — matches the real dashboard's Traffic section ───────────────
function TrafficBox() {
  const [range, setRange] = useState<Range | "locations">("week");
  const d = range === "locations" ? null : TRAFFIC[range];

  return (
    <div className="bg-gray-900 border border-gray-800/80 rounded-2xl p-5 min-w-0">
      <div className="flex items-center justify-between mb-4">
        <p className="text-white font-semibold text-sm">Traffic</p>
        <div className="flex items-center bg-gray-800 rounded-lg p-0.5">
          {([
            { id: "today", label: "Today" },
            { id: "week", label: "Week" },
            { id: "month", label: "Month" },
            { id: "locations", label: "Locations" },
          ] as const).map((r) => (
            <button
              key={r.id}
              onClick={() => setRange(r.id)}
              className={`text-xs font-semibold px-2.5 py-1 rounded-md transition-colors ${range === r.id ? "bg-gray-700 text-white" : "text-gray-400 hover:text-gray-200"}`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {d ? (
        <div>
          {/* Stat tiles — side by side */}
          <div className="grid grid-cols-2 gap-3">
            {/* Label + count only. The real dashboard's per-tile trend line
                ("▲ 23% this week") was removed in d65b0d5, so showing one here
                advertised a stat the product no longer has. The counts, the
                range tabs and the bar graph are untouched — those all still
                exist. `pct`/`period`/`accent` went with it; nothing else read
                them. */}
            {[
              { label: "SwiftCard views", value: d.card },
              { label: "Swift Link views", value: d.link },
            ].map((m) => (
              <div key={m.label} className="bg-gray-800/40 border border-gray-800 rounded-xl px-4 py-3.5 min-w-0">
                <p className="text-gray-400 text-xs font-medium truncate">{m.label}</p>
                <p className="text-2xl font-bold text-white tabular-nums mt-0.5">{m.value}</p>
              </div>
            ))}
          </div>

          {/* Bar graph — newest bucket highlighted */}
          <div className="flex items-end gap-1 h-20 mt-4" aria-hidden="true">
            {d.bars.map((v, i) => {
              const last = i === d.bars.length - 1;
              return (
                <div
                  key={i}
                  className="flex-1 rounded-t-md min-w-0"
                  style={{
                    height: `${Math.max(6, v)}%`,
                    background: last ? "linear-gradient(180deg, #60a5fa 0%, #2563eb 100%)" : "#343e6b",
                  }}
                />
              );
            })}
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {LOCATIONS.map((loc) => (
            <div key={loc.location} className="bg-gray-800/40 border border-gray-800 rounded-xl px-4 py-3">
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <p className="text-gray-100 text-sm font-semibold truncate">{loc.location}</p>
                <p className="text-white text-sm font-bold tabular-nums shrink-0">{loc.card + loc.link} <span className="text-gray-400 font-medium text-[0.6875rem]">views</span></p>
              </div>
              <div className="flex items-center gap-4 text-[0.6875rem]">
                <span className="text-gray-400">SwiftCard <span className="text-gray-200 font-semibold tabular-nums">{loc.card}</span></span>
                <span className="text-gray-400">Swift Links <span className="text-gray-200 font-semibold tabular-nums">{loc.link}</span></span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Basic stats footer */}
      <div className="flex items-center justify-between gap-2 mt-3 pt-3 border-t border-gray-800/70 text-[0.6875rem]">
        <span className="text-gray-400">Contacts <span className="text-gray-200 font-semibold tabular-nums">{TOTAL_LEADS}</span></span>
        <span className="text-gray-400">Best day <span className="text-gray-200 font-semibold">Jul 8</span> · 302</span>
      </div>
    </div>
  );
}

// ── Right column — Your Card preview + Share panel ───────────────────────────
function CardSharePanel() {
  return (
    <div className="flex flex-col gap-4">
      {/* Your card */}
      <div className="bg-gray-900 border border-gray-800/80 rounded-2xl p-5">
        <div className="flex items-center justify-between mb-1">
          <p className="text-gray-400 text-xs font-semibold uppercase tracking-wide">Your Card</p>
          <span className="text-xs text-blue-400 font-medium">Edit</span>
        </div>
        <p className="text-gray-400 text-[0.6875rem] mb-3 leading-relaxed">Exactly what people get when you share.</p>

        {/* The REAL card template component, same identity used across every
            marketing demo — not a hand-drawn mock, so this box looks exactly
            like the real dashboard's "Your Card" panel. */}
        {/* pointerEvents: none — the template renders phone/email/website as real
            tel:/mailto:/https: links, and this is a marketing mock of a person who
            doesn't exist. Live, they sent visitors to a made-up mailbox and off
            our site to coastlinehomes.com, a domain we don't own. Same treatment
            TemplateGallery, LeadCapturePhone and SignatureDemo already apply. */}
        <div className="rounded-xl overflow-hidden border border-gray-800" style={{ pointerEvents: "none" }}>
          <CardScaler><ClassicPro data={DEMO_CARD} /></CardScaler>
        </div>
        <span className="mt-2 flex items-center justify-center gap-1.5 text-[0.6875rem] font-semibold text-gray-400 border border-gray-800 rounded-full py-2">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="w-3.5 h-3.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
          </svg>
          Download card as image
        </span>
      </div>

      {/* Share */}
      <div className="bg-gray-900 border border-gray-800/80 rounded-2xl p-5 space-y-2">
        <span
          className="w-full flex items-center justify-center gap-2 font-semibold py-3 px-6 rounded-full text-sm text-white"
          style={{ background: "linear-gradient(to right, #2563eb, #7c3aed)" }}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M7.217 10.907a2.25 2.25 0 100 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186l9.566-5.314m-9.566 7.5l9.566 5.314m0 0a2.25 2.25 0 103.935 2.186 2.25 2.25 0 00-3.935-2.186zm0-12.814a2.25 2.25 0 103.933-2.185 2.25 2.25 0 00-3.933 2.185z" />
          </svg>
          Share
        </span>
        <span className="w-full flex items-center justify-center gap-2 text-xs font-semibold text-gray-300 bg-gray-800 border border-gray-700 rounded-full py-2.5">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-3.5 h-3.5">
            <circle cx="12" cy="5" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="12" cy="19" r="1.5" />
          </svg>
          Other ways to share
        </span>
      </div>
    </div>
  );
}

// ── Contacts page replica — mirrors ContactsClient's list + detail shape ─────
const DEMO_CONTACTS = [
  { id: "c1", name: "Sarah Chen", company: "Acme Realty", phone: true, email: true, status: "New Contact", statusCls: "bg-blue-950 text-blue-300", unread: true, last: "Loved the listing on Cole St — can we set up a viewing this weekend?" },
  { id: "c2", name: "Marcus Webb", company: "Northgate Co.", phone: true, email: true, status: "Touch", statusCls: "bg-amber-950 text-amber-300", unread: false, last: "Interested in the downtown condos — what's coming up?" },
  { id: "c3", name: "Elena Diaz", company: "Brightpath Studio", phone: false, email: true, status: "Touch", statusCls: "bg-amber-950 text-amber-300", unread: false, last: "Thanks for following up! Let's talk next week." },
  { id: "c4", name: "Tom Farrell", company: "Farrell Development", phone: true, email: false, status: "Dissolved", statusCls: "bg-gray-800 text-gray-400", unread: false, last: "Following up on the office space downtown — is it still available?" },
];

function ContactsPageView() {
  const [selectedId, setSelectedId] = useState(DEMO_CONTACTS[0].id);
  const selected = DEMO_CONTACTS.find((c) => c.id === selectedId) ?? DEMO_CONTACTS[0];
  return (
    <div className="grid grid-cols-[300px_1fr] gap-4 h-[420px]">
      {/* List */}
      <div className="border border-gray-800 rounded-2xl overflow-y-auto divide-y divide-gray-800">
        {DEMO_CONTACTS.map((c) => (
          <button
            key={c.id}
            onClick={() => setSelectedId(c.id)}
            className={`w-full text-left px-3 py-3 flex items-center gap-2.5 transition-colors ${c.id === selectedId ? "bg-gray-800/80" : "hover:bg-gray-800/40"}`}
          >
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0 ${c.unread ? "bg-blue-600" : "bg-gray-700"}`}>
              {c.name[0]}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-white text-xs font-semibold truncate">{c.name}</p>
              <p className="text-gray-400 text-[0.625rem] truncate">{c.company}</p>
            </div>
            <DemoContactActions name={c.name} phone={c.phone} email={c.email} />
            <span className={`w-2 h-2 rounded-full shrink-0 ${c.unread ? "bg-blue-500" : "border border-gray-500"}`} />
          </button>
        ))}
      </div>

      {/* Detail */}
      <div className="border border-gray-800 rounded-2xl p-5 flex flex-col">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-12 h-12 rounded-full bg-blue-600 flex items-center justify-center text-base font-bold text-white shrink-0">
            {selected.name[0]}
          </div>
          <div>
            <h3 className="text-white font-bold text-sm">{selected.name}</h3>
            <span className={`inline-block text-[0.625rem] font-semibold px-2 py-0.5 rounded-full mt-1 ${selected.statusCls}`}>{selected.status}</span>
          </div>
        </div>
        <div className="bg-gray-800/40 border border-gray-800 rounded-xl px-3.5 py-3 text-gray-300 text-xs leading-relaxed">
          {selected.last}
        </div>
        <div className="mt-auto pt-4 flex gap-2">
          <span className="flex-1 text-center text-xs font-semibold text-white bg-blue-600 rounded-full py-2">Reply</span>
          <span className="flex-1 text-center text-xs font-semibold text-gray-300 border border-gray-700 rounded-full py-2">Add note</span>
        </div>
      </div>
    </div>
  );
}

// ── Links page replica — mirrors the real /share page ────────────────────────
function LinksPageView() {
  return (
    <div className="max-w-md mx-auto">
      <div className="mb-5">
        <p className="text-[0.6875rem] font-bold tracking-[0.25em] text-blue-500 uppercase mb-1">SwiftCard</p>
        <h2 className="text-xl font-bold text-white">Links</h2>
        <p className="text-gray-400 text-xs mt-1">
          For <span className="text-gray-300 font-medium">Alex Morgan</span>
          <span className="text-gray-400"> · /alexmorgan</span>
        </p>
      </div>

      <div className="space-y-5">
        <div>
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2.5">Swift Links</p>
          <div className="bg-gray-900 border border-gray-800/80 rounded-2xl p-4">
            <p className="text-gray-400 text-xs mb-3 leading-relaxed">
              A separate link from your card — your bio, socials, and links in one place.
            </p>
            <div className="flex items-center gap-2 bg-gray-800/60 border border-gray-700/60 rounded-xl px-3 py-2.5">
              <svg viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth={1.8} className="w-3.5 h-3.5 shrink-0">
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244" />
              </svg>
              <span className="text-blue-400 text-xs truncate flex-1">swiftcard.me/links/alexmorgan</span>
              <span className="text-xs px-3 py-1.5 rounded-lg bg-gray-800 text-gray-300">Copy</span>
            </div>
            <span className="mt-2 block text-center text-xs font-semibold text-gray-400 bg-gray-800 border border-gray-700 rounded-full py-2">
              Open Swift Links →
            </span>
          </div>
        </div>

        <div>
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2.5">Swift Signature</p>
          <div className="bg-gray-900 border border-gray-800/80 rounded-2xl p-4">
            <p className="text-white font-semibold text-sm">Swift Signature</p>
            <p className="text-gray-400 text-[0.6875rem] mt-1 leading-relaxed">
              Copy your Swift Signature and paste it into your email — a clickable link to your card at the bottom of every message you send.
            </p>
            <span className="mt-3 block text-center bg-blue-600 text-white font-semibold text-xs py-2 rounded-full">
              Preview &amp; copy
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

const TABS = [
  { id: "dashboard", label: "Dashboard", path: "swiftcard.me/dashboard" },
  { id: "contacts", label: "Contacts", path: "swiftcard.me/contacts" },
  { id: "links", label: "Links", path: "swiftcard.me/share" },
] as const;
type TabId = (typeof TABS)[number]["id"];

export default function DashboardDemo() {
  const [tab, setTab] = useState<TabId>("dashboard");
  const activePath = TABS.find((t) => t.id === tab)?.path ?? TABS[0].path;

  // LIGHT, because the app opens light. 9d7e592 made light mode the default
  // (dark became opt-in), so a dark demo showed every visitor a product they
  // would not get on signing in.
  //
  // It is themed the way the APP is themed, not by hand: `data-sc-theme="light"`
  // + `.sc-app` are the exact hooks globals.css keys its light remap on, so the
  // same gray/blue classes this demo already uses get the same treatment the
  // real dashboard gets — and if that remap is ever retuned, the demo follows
  // instead of drifting. Nothing here was recoloured by eye.
  //
  // The browser chrome is LIGHT too (owner, 2026-09-17: only the site header
  // and footer stay dark), so the demo sits on the page instead of floating in
  // a dark box.
  return (
    <div data-sc-theme="light" className="rounded-[var(--rd-r-xl)] border border-slate-200 bg-white shadow-[0_30px_70px_-40px_rgba(11,16,34,0.45)] overflow-hidden">
      {/* browser chrome */}
      <div className="flex items-center gap-2 px-4 h-11 border-b border-slate-200 bg-[#F5F7FB]">
        <span className="w-3 h-3 rounded-full bg-[#ff5f57]" /><span className="w-3 h-3 rounded-full bg-[#febc2e]" /><span className="w-3 h-3 rounded-full bg-[#28c840]" />
        <div className="ml-3 flex-1 max-w-[280px] h-6 rounded-md bg-white border border-slate-200 flex items-center px-3 gap-1.5">
          <svg viewBox="0 0 24 24" className="w-3 h-3 text-slate-400" fill="none" stroke="currentColor" strokeWidth={2}><rect x="4" y="10" width="16" height="10" rx="2" /><path d="M8 10V7a4 4 0 018 0v3" /></svg>
          <span className="text-slate-500 text-[0.6875rem]">{activePath}</span>
        </div>
      </div>

      {/* Everything below the browser chrome is app surface, so it carries
          `.sc-app` once, plus `bg-gray-950` — the real dashboard's page
          background class, which the light remap turns into the app's cream.
          Without it the cards went light while the page behind them stayed the
          dark browser-frame colour, leaving dark gutters and unreadable
          headings. */}
      <div className="sc-app bg-gray-950">
      {/* Page tabs — the actual app nav (Dashboard / Contacts / Links) so
          visitors can click through the real pages, not just Dashboard. */}
      <div className="flex items-center gap-1 px-4 sm:px-5 pt-4">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors ${tab === t.id ? "bg-gray-800 text-white" : "text-gray-400 hover:text-gray-200"}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="p-4 sm:p-5">
        {tab === "dashboard" && (
          <>
            {/* Traffic | card panel (real page: lg:grid-cols-[1fr_300px]) */}
            <div className="grid grid-cols-[1fr_260px] gap-5 items-start">
              <TrafficBox />
              <CardSharePanel />
            </div>
          </>
        )}
        {tab === "contacts" && <ContactsPageView />}
        {tab === "links" && <LinksPageView />}
      </div>
      </div>
    </div>
  );
}
