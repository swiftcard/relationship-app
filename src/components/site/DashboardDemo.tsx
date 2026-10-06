"use client";

import { useState } from "react";
import CardScaler from "@/components/CardScaler";
import ClassicPro from "@/components/card-templates/ClassicPro";
import { withoutSocials } from "@/components/card-templates/types";
import type { CardData } from "@/components/card-templates/types";
import DemoContactActions from "@/components/site/DemoContactActions";
import TrafficChart, { type TrafficBucket } from "@/components/TrafficChart";

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
// Mirrors the real page as it is since the 2026-09-29/30 redesign:
//   • My Cards across the top (View Live Link · Add card · rows with Edit)
//   • Traffic on the left — no heading, range bar at its left edge, the REAL
//     TrafficChart (SwiftCard / Swift Links split), unique/repeat line, and
//     Link taps underneath
//   • on the right, just the card (+ Download), then Share: Show QR · Share
//     link · Other ways to share · At an event?
// (Quick Contacts left the real dashboard on 2026-09-29 — its Call / Text /
// Email buttons are on every Contacts row now, and so they are here.)
// Purely presentational — all data is fictional; nothing is fetched. The
// buttons are drawn copies of the real ones (QRCodeModal, ShareButton,
// MoreShareOptions, EventTagChip, DownloadCardButton), not the components:
// on a marketing page they must not open sheets or download anything.

// ── Traffic data per range ───────────────────────────────────────────────────
// Fixed timestamps (not Date.now()) and a fixed zone, so the server render
// and the browser draw the same axis labels — the chart formats them itself.
const TZ = "America/Los_Angeles";
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const TODAY_START = Date.UTC(2026, 9, 14, 7); // Oct 14, 00:00 in Los Angeles
const split = (counts: number[], linkShare: number[], start: number, step: number): TrafficBucket[] =>
  counts.map((count, i) => {
    const links = Math.round(count * linkShare[i % linkShare.length]);
    return { count, ts: start + i * step, card: count - links, links };
  });
const SHARE = [0.32, 0.4, 0.36, 0.45, 0.3, 0.38];
const TRAFFIC = {
  today: {
    card: "86", link: "41", unique: 92, repeat: 35, taps: 18,
    buckets: split([0, 0, 0, 0, 0, 0, 1, 2, 5, 7, 9, 11, 8, 10, 12, 9, 14, 11, 8, 7, 5, 3, 2, 3], SHARE, TODAY_START, HOUR),
  },
  week: {
    card: "1,284", link: "742", unique: 1206, repeat: 820, taps: 214,
    buckets: split([190, 260, 220, 340, 290, 402, 324], SHARE, TODAY_START - 6 * DAY, DAY),
  },
  month: {
    card: "5,190", link: "3,020", unique: 5412, repeat: 2798, taps: 961,
    buckets: split([150, 120, 190, 160, 230, 200, 170, 260, 220, 290, 250, 320, 280, 240, 310, 310, 320, 330, 290, 300, 310, 340, 300, 270, 330, 330, 320, 344, 402, 324], SHARE, TODAY_START - 29 * DAY, DAY),
  },
} as const;
type Range = keyof typeof TRAFFIC;

const LOCATIONS = [
  { location: "San Francisco, US", card: 142, link: 88 },
  { location: "New York, US", card: 96, link: 54 },
  { location: "Austin, US", card: 61, link: 40 },
  { location: "London, UK", card: 38, link: 29 },
];

// ── My Cards — the box across the top of the real dashboard ──────────────────
const DEMO_CARDS = [
  { id: "a", title: "Alex Morgan", sub: "/alexmorgan · Alex Morgan", active: true },
  { id: "b", title: "Coastline Open Houses", sub: "/coastline-openhouse · Alex Morgan", active: false },
];

function MyCardsBox() {
  return (
    <div className="bg-gray-900 border border-gray-800/80 rounded-2xl p-5 mb-5">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="min-w-0">
          <p className="text-white font-semibold text-sm">My Cards</p>
          <p className="text-gray-600 text-xs mt-0.5">Check a card to view everything about it. Only one card can be selected at a time.</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="shrink-0 inline-flex items-center gap-1 px-3 py-2 rounded-lg border border-gray-700 text-gray-300 text-xs font-semibold">
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5" aria-hidden="true">
              <path d="M10 12a2 2 0 100-4 2 2 0 000 4z" />
              <path fillRule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clipRule="evenodd" />
            </svg>
            View Live Link
          </span>
          <span className="shrink-0 inline-flex items-center gap-1 px-3 py-2 rounded-lg border border-gray-700 text-blue-400 text-xs font-semibold">
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5" aria-hidden="true"><path d="M10.75 4.75a.75.75 0 00-1.5 0v4.5h-4.5a.75.75 0 000 1.5h4.5v4.5a.75.75 0 001.5 0v-4.5h4.5a.75.75 0 000-1.5h-4.5v-4.5z" /></svg>
            Add card
          </span>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {DEMO_CARDS.map((c) => (
          <div key={c.id} className={`flex items-center gap-3 rounded-xl px-4 py-3 border flex-1 min-w-[240px] ${c.active ? "bg-blue-600/10 border-blue-600/40" : "bg-gray-800/60 border-gray-700/60"}`}>
            <span className={`w-[18px] h-[18px] rounded-[5px] border flex items-center justify-center shrink-0 ${c.active ? "bg-blue-600 border-blue-600" : "border-gray-600"}`}>
              {c.active && (
                <svg viewBox="0 0 20 20" fill="white" className="w-3 h-3"><path fillRule="evenodd" d="M16.704 5.29a1 1 0 010 1.42l-7.5 7.5a1 1 0 01-1.42 0l-3.5-3.5a1 1 0 111.42-1.42l2.79 2.79 6.79-6.79a1 1 0 011.42 0z" clipRule="evenodd" /></svg>
              )}
            </span>
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold shrink-0 ${c.active ? "bg-blue-600/30 border border-blue-500/40 text-blue-300" : "bg-gray-700 text-gray-300"}`}>
              {c.title[0]}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-white text-sm font-medium truncate">{c.title}</p>
              <p className="text-gray-500 text-xs truncate">{c.sub}</p>
            </div>
            <span className={`shrink-0 inline-flex items-center justify-center gap-1 h-7 min-w-7 px-2 rounded-lg border text-[0.6875rem] font-semibold ${c.active ? "border-blue-500/40 text-blue-300" : "border-gray-600/70 text-gray-300"}`}>
              <svg viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3 shrink-0" aria-hidden="true">
                <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
              </svg>
              Edit
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Traffic box — matches the real dashboard's Traffic section ───────────────
function TrafficBox() {
  const [range, setRange] = useState<Range | "locations">("week");
  const d = range === "locations" ? null : TRAFFIC[range];
  const max = d ? Math.max(...d.buckets.map((b) => b.count)) : 1;

  return (
    <div className="bg-gray-900 border border-gray-800/80 rounded-2xl p-5 min-w-0">
      {/* No "Traffic" heading (removed 2026-09-29); the range bar starts at
          the box's left edge. */}
      <div className="flex items-center mb-4">
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
              className={`text-xs font-semibold px-2.5 py-1 rounded-md transition-colors ${range === r.id ? "bg-gray-700 text-white" : "text-gray-500 hover:text-gray-300"}`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {d ? (
        <div>
          {/* Stat tiles — label + count only (the per-tile trend line was
              removed in d65b0d5). */}
          <div className="grid grid-cols-2 gap-3">
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

          {/* Unique vs repeat for the same window. */}
          <div className="flex items-center gap-4 mt-2 text-[0.6875rem]">
            <span className="text-gray-500">Unique viewers <span className="text-gray-200 font-semibold tabular-nums">{d.unique.toLocaleString("en-US")}</span></span>
            <span className="text-gray-500">Repeat views <span className="text-gray-200 font-semibold tabular-nums">{d.repeat.toLocaleString("en-US")}</span></span>
          </div>

          {/* The REAL chart: one bar per hour (Today) or day, split into
              SwiftCard and Swift Links, with its legend, axis and tooltips. */}
          <TrafficChart key={range} buckets={[...d.buckets]} range={range as Range} max={max} tz={TZ} />
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-gray-500 text-[0.6875rem] mb-1">Top locations · all time</p>
          {LOCATIONS.map((loc) => (
            <div key={loc.location} className="bg-gray-800/40 border border-gray-800 rounded-xl px-4 py-3">
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <p className="text-gray-100 text-sm font-semibold truncate">{loc.location}</p>
                <p className="text-white text-sm font-bold tabular-nums shrink-0">{loc.card + loc.link} <span className="text-gray-500 font-medium text-[0.6875rem]">views</span></p>
              </div>
              <div className="flex items-center gap-4 text-[0.6875rem]">
                <span className="text-gray-500">SwiftCard <span className="text-gray-200 font-semibold tabular-nums">{loc.card}</span></span>
                <span className="text-gray-500">Swift Links <span className="text-gray-200 font-semibold tabular-nums">{loc.link}</span></span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Footer: link taps */}
      <div className="flex items-center gap-2 mt-3 pt-3 border-t border-gray-800/70 text-[0.6875rem]">
        <span className="text-gray-500">Link taps <span className="text-gray-200 font-semibold tabular-nums">{(d ?? TRAFFIC.week).taps.toLocaleString("en-US")}</span></span>      </div>
    </div>
  );
}

// ── Right column — the card + the Share box ──────────────────────────────────
function CardSharePanel() {
  return (
    <div className="flex flex-col gap-4">
      {/* Just the card (owner, 2026-09-30: no heading, hint or caption), and
          the small Download under it. */}
      <div className="bg-gray-900 border border-gray-800/80 rounded-2xl p-5">
        {/* The REAL card template, same identity as every marketing demo.
            pointerEvents: none — the template renders tel:/mailto:/https:
            links, and this person doesn't exist. */}
        <div className="rounded-xl overflow-hidden" style={{ pointerEvents: "none" }}>
          <CardScaler><ClassicPro data={DEMO_CARD} /></CardScaler>
        </div>
        <span className="mt-3 w-full flex items-center justify-center gap-1.5 text-xs font-semibold border rounded-full py-2 text-gray-300 bg-gray-800 border-gray-700">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="w-3.5 h-3.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
          </svg>
          Download
        </span>
      </div>

      {/* Share — Show QR leads, Share link second, then the rest. */}
      <div className="bg-gray-900 border border-gray-800/80 rounded-2xl p-5 space-y-2">
        <span className="w-full flex items-center justify-center gap-2 py-3.5 px-5 rounded-full font-bold text-sm text-white bg-blue-600">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4" aria-hidden="true">
            <rect x="3" y="3" width="7" height="7" rx="1" />
            <rect x="14" y="3" width="7" height="7" rx="1" />
            <rect x="3" y="14" width="7" height="7" rx="1" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M14 14h2v2h-2zM18 14h3v2M21 18v3M17 18h2v3M14 18v3" />
          </svg>
          Show QR
        </span>
        <span className="w-full flex items-center justify-center gap-2 font-semibold py-3 px-6 rounded-full text-sm bg-transparent border border-gray-700 text-gray-300">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M7.217 10.907a2.25 2.25 0 100 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186l9.566-5.314m-9.566 7.5l9.566 5.314m0 0a2.25 2.25 0 103.935 2.186 2.25 2.25 0 00-3.935-2.186zm0-12.814a2.25 2.25 0 103.933-2.185 2.25 2.25 0 00-3.933 2.185z" />
          </svg>
          Share link
        </span>
        <span className="w-full flex items-center justify-center gap-2 text-xs font-semibold text-gray-300 bg-gray-800 border border-gray-700 rounded-full py-2.5">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-3.5 h-3.5">
            <circle cx="12" cy="5" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="12" cy="19" r="1.5" />
          </svg>
          Other ways to share
        </span>
        <div className="pt-2">
          <span className="w-full flex items-center justify-center gap-1.5 text-[0.6875rem] font-semibold text-gray-500">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-3 h-3 shrink-0 text-gray-500" aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
            </svg>
            At an event? Tag today&apos;s contacts
          </span>
        </div>
      </div>
    </div>
  );
}

// ── Contacts page replica — mirrors ContactsClient's list + detail shape ─────
// No statuses: the contact status dropdown (New Contact / Touch / Dissolved)
// left the product on 2026-08-11. Each contact shows where it came from
// instead (lib/source-labels), as the real detail view does.
const DEMO_CONTACTS = [
  { id: "c1", name: "Sarah Chen", company: "Acme Realty", phone: true, email: true, source: "QR code scan", unread: true, last: "Loved the listing on Cole St — can we set up a viewing this weekend?" },
  { id: "c2", name: "Marcus Webb", company: "Northgate Co.", phone: true, email: true, source: "Swift Signature", unread: false, last: "Interested in the downtown condos — what's coming up?" },
  { id: "c3", name: "Elena Diaz", company: "Brightpath Studio", phone: false, email: true, source: "Instagram bio", unread: false, last: "Thanks for following up! Let's talk next week." },
  { id: "c4", name: "Tom Farrell", company: "Farrell Development", phone: true, email: false, source: "NFC tap", unread: false, last: "Following up on the office space downtown — is it still available?" },
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

      {/* Detail — the real contact view's head: name, where they came from,
          Mark as read, then Call · Share · Save to phone, and the
          Conversation / Contact info tabs. */}
      <div className="border border-gray-800 rounded-2xl p-5 flex flex-col min-w-0">
        <div className="flex items-start gap-3 mb-4">
          <div className="w-12 h-12 rounded-full bg-blue-600 flex items-center justify-center text-base font-bold text-white shrink-0">
            {selected.name[0]}
          </div>
          <div className="min-w-0">
            <h3 className="text-gray-100 font-bold text-sm truncate">{selected.name}</h3>
            <span className="inline-block text-[0.625rem] font-semibold px-2 py-0.5 rounded-full mt-1 bg-blue-950 text-blue-300">{selected.source}</span>
          </div>
          <span className={`ml-auto shrink-0 flex items-center gap-1.5 text-[0.6875rem] font-semibold px-2.5 py-1 rounded-full border ${selected.unread ? "border-blue-700 bg-blue-600/15 text-blue-300" : "border-gray-700 text-gray-400"}`}>
            {selected.unread ? "Mark as read" : "Mark as unread"}
          </span>
        </div>
        <div className="flex items-center gap-2 mb-4">
          {selected.phone ? (
            <span className="flex items-center justify-center gap-1.5 flex-1 text-xs font-semibold py-2 rounded-xl bg-emerald-600 text-white">
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5"><path d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z" /></svg>
              Call
            </span>
          ) : (
            <span className="flex-1 text-center text-[0.6875rem] text-gray-600 py-2 rounded-xl border border-dashed border-gray-800">No phone to call</span>
          )}
          <span className="flex items-center justify-center gap-1.5 text-xs font-semibold py-2 px-3 rounded-xl bg-blue-600 text-white">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5"><path strokeLinecap="round" strokeLinejoin="round" d="M12 3v13M8 7l4-4 4 4M5 13v6a2 2 0 002 2h10a2 2 0 002-2v-6" /></svg>
            Share
          </span>
          <span className="flex items-center justify-center gap-1.5 flex-1 min-w-0 whitespace-nowrap text-xs font-semibold py-2 px-2 rounded-xl bg-gray-800 border border-gray-700 text-gray-200">
            Save to phone
          </span>
        </div>
        <div className="flex bg-gray-900 rounded-xl p-1 gap-1 mb-4">
          <span className="flex-1 py-1.5 rounded-lg text-[0.6875rem] font-semibold text-center" style={{ background: "#1D4ED8", color: "#fff" }}>Conversation</span>
          <span className="flex-1 py-1.5 rounded-lg text-[0.6875rem] font-semibold text-center" style={{ color: "#6b7280" }}>Contact info / Presets</span>
        </div>
        <div className="bg-gray-800/40 border border-gray-800 rounded-xl px-3.5 py-3 text-gray-300 text-xs leading-relaxed">
          {selected.last}
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
            <MyCardsBox />
            {/* Traffic | card panel (real page: lg:grid-cols-[1fr_300px]) */}
            <div className="grid grid-cols-[1fr_300px] gap-5 items-start">
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
