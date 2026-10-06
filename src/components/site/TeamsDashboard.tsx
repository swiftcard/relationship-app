"use client";

import { useMemo, useRef, useState } from "react";
import CardScaler from "@/components/CardScaler";
import InertPreview from "@/components/InertPreview";
import ClassicPro from "@/components/card-templates/ClassicPro";
import ModernBold from "@/components/card-templates/ModernBold";
import PhotoFirst from "@/components/card-templates/PhotoFirst";
import LocalBusiness from "@/components/card-templates/LocalBusiness";
import LuxuryMinimal from "@/components/card-templates/LuxuryMinimal";
import LogoFirst from "@/components/card-templates/LogoFirst";
import { withoutSocials } from "@/components/card-templates/types";
import TemplatePicker from "@/components/card-templates/TemplatePicker";
import TemplateStyleControls from "@/components/card-templates/TemplateStyleControls";
import type { TemplateStyle } from "@/components/card-templates/shared";
import { Segmented } from "@/components/ui/DesignControls";
import { SwiftLinkStyleControls, type SwiftLinkStyle } from "@/components/SwiftLinkDesign";
import SwiftLinkLivePreview from "@/components/SwiftLinkLivePreview";
import ViewsChart from "@/components/ViewsChart";
import { normalizeSocial } from "@/lib/social-url";
import { socialInput } from "@/lib/social-input";
import SocialHandleField from "@/components/SocialHandleField";
import AddLinkForm from "@/components/AddLinkForm";
import { getSourceLabel } from "@/lib/source-labels";
import { defaultEmployeeSort } from "@/lib/office-analytics-metrics";
import { FOLLOW_UP_COPY, FOLLOW_UP_STATES, type FollowUpState } from "@/lib/lead-followup";
import { MEMBER_STATUS_LABEL, type MemberStatus } from "@/lib/member-status";

// A replica of the REAL Office admin at /office/admin — same shell, same four
// tabs (Team, Analytics, Leads, Branding), same labels. Copied from:
//   - app/office/admin/layout.tsx + OfficeAdminNav.tsx (header, stripe, tabs)
//   - app/office/admin/page.tsx + components/office/TeamList.tsx (Team)
//   - app/office/admin/analytics/page.tsx + EmployeeAnalyticsTable.tsx
//   - app/office/admin/leads/LeadsTable.tsx (Leads, follow-up badges)
//   - app/office/admin/branding/page.tsx + OfficeBranding.tsx (Card) +
//     OfficeLinksBranding.tsx (Links)
// The branding form renders the product's OWN pure controls — TemplatePicker,
// TemplateStyleControls, SwiftLinkStyleControls, SwiftLinkLivePreview — so the
// demo can never drift from what an owner actually logs into.
//
// Purely presentational. Nothing is fetched, uploaded or saved, and all data is
// fictional. Uploads are off (canUpload={false}), the logo control is a static
// stand-in for ImageUpload/LogoSuggest, and company LINK buttons are not added
// here on purpose: the real link preview fetches /api/link-preview for every
// link, and a marketing page must not generate that traffic.

// Same demo identity as SAMPLE_DATA (card-templates/types.tsx): Alex Morgan
// (Realtor®) owns the office; the team works under "Coastline Realty".
const COMPANY = "Coastline Realty";
const WEBSITE = "coastlinehomes.com";

// The Coastline mark (public/marketing/demo-logo.svg) on a navy plate, so it
// reads on light AND dark templates — the bare mark is white-only.
const LOGO_URL = `data:image/svg+xml,${encodeURIComponent(
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 120 120'><rect width='120' height='120' rx='26' fill='#12355B'/><g fill='none' stroke='#ffffff' stroke-width='6' stroke-linecap='round'><path d='M22 58 A38 38 0 0 1 98 58'/><path d='M26 78 q11 -9 22 0 t22 0 t22 0'/><path d='M26 96 q11 -9 22 0 t22 0 t22 0'/></g><circle cx='60' cy='40' r='9' fill='#ffffff'/></svg>",
)}`;

const TEMPLATE_COMPONENTS = {
  "classic-pro": ClassicPro,
  "modern-bold": ModernBold,
  "photo-first": PhotoFirst,
  "local-business": LocalBusiness,
  "luxury-minimal": LuxuryMinimal,
  "logo-first": LogoFirst,
} as const;
type TemplateId = keyof typeof TEMPLATE_COMPONENTS;
const isTemplateId = (v: string): v is TemplateId => v in TEMPLATE_COMPONENTS;

// ── Fictional team ──────────────────────────────────────────────────────────

type Person = {
  id: string; name: string; title: string; email: string; photo: string;
  views: number; leads: number; cards: number; lastActive: string; status: MemberStatus; owner?: boolean;
  // Analytics (last 30 days) — views/leads match the Team tab.
  unique: number; scans: number; contacts: number; swiftlink: number; card: string;
};

// Licensed stock headshots (free for commercial use, no attribution required).
const PEOPLE: Person[] = [
  { id: "alex", name: "Alex Morgan", title: "Realtor®", email: "alex@coastlinerealty.com", photo: "/marketing/team/person1.jpg", views: 1240, leads: 128, cards: 2, lastActive: "2 hours ago", status: "active", owner: true, unique: 846, scans: 418, contacts: 187, swiftlink: 312, card: "2 cards" },
  { id: "sofia", name: "Sofia Reyes", title: "Senior Agent", email: "sofia@coastlinerealty.com", photo: "/marketing/team/person2.jpg", views: 903, leads: 94, cards: 1, lastActive: "Yesterday", status: "active", unique: 610, scans: 297, contacts: 131, swiftlink: 204, card: "Sofia Reyes" },
  { id: "marcus", name: "Marcus Lee", title: "Agent", email: "marcus@coastlinerealty.com", photo: "/marketing/team/person3.jpg", views: 588, leads: 61, cards: 1, lastActive: "3 days ago", status: "active", unique: 402, scans: 176, contacts: 84, swiftlink: 131, card: "Marcus Lee" },
  { id: "elena", name: "Elena Diaz", title: "Agent", email: "elena@coastlinerealty.com", photo: "/marketing/team/person4.jpg", views: 511, leads: 52, cards: 1, lastActive: "5 days ago", status: "active", unique: 355, scans: 150, contacts: 69, swiftlink: 98, card: "Elena Diaz" },
  { id: "dana", name: "Dana Ruiz", title: "Marketing Lead", email: "dana@coastlinerealty.com", photo: "/marketing/team/person5.jpg", views: 96, leads: 4, cards: 1, lastActive: "3 weeks ago", status: "idle", unique: 71, scans: 9, contacts: 3, swiftlink: 12, card: "Dana Ruiz" },
];
const INVITE = { name: "Priya Shah", email: "priya@coastlinerealty.com", sent: "Sep 12" };

const sum = (f: (p: Person) => number) => PEOPLE.reduce((s, p) => s + f(p), 0);
const LEADS_MONTH = sum((p) => p.leads);
const VIEWS_MONTH = sum((p) => p.views);

// ── Fictional leads ─────────────────────────────────────────────────────────

type Lead = { id: string; name: string; email: string | null; phone: string | null; by: string; followUp: FollowUpState; when: string };
const LEADS: Lead[] = [
  { id: "l1", name: "Sarah Chen", email: "sarah@acme.com", phone: "(415) 555-0126", by: "Sofia Reyes", followUp: "running", when: "2 hours ago" },
  { id: "l2", name: "Marcus Webb", email: "m.webb@northgate.co", phone: null, by: "Alex Morgan", followUp: "none", when: "5 hours ago" },
  { id: "l3", name: "Jordan Kim", email: "jordan.kim@vela.io", phone: "(415) 555-0173", by: "Marcus Lee", followUp: "running", when: "Yesterday" },
  { id: "l4", name: "Rachel Owens", email: "rachel@brightpath.io", phone: "(512) 555-0180", by: "Elena Diaz", followUp: "done", when: "2 days ago" },
  { id: "l5", name: "Tom Farrell", email: "tom@farrell.dev", phone: "(628) 555-0114", by: "Sofia Reyes", followUp: "paused", when: "3 days ago" },
  { id: "l6", name: "Nina Patel", email: "nina.patel@gmail.com", phone: "(415) 555-0192", by: "Alex Morgan", followUp: "running", when: "4 days ago" },
  { id: "l7", name: "David Brooks", email: null, phone: "(650) 555-0147", by: "Marcus Lee", followUp: "none", when: "5 days ago" },
  { id: "l8", name: "Grace Liu", email: "grace@harborlane.com", phone: "(415) 555-0135", by: "Alex Morgan", followUp: "done", when: "1 week ago" },
];
const MORE_LEADS: Lead[] = [
  { id: "l9", name: "Omar Haddad", email: "omar@haddad.co", phone: "(510) 555-0166", by: "Elena Diaz", followUp: "running", when: "1 week ago" },
  { id: "l10", name: "Claire Novak", email: "claire.novak@outlook.com", phone: null, by: "Sofia Reyes", followUp: "done", when: "1 week ago" },
  { id: "l11", name: "Ben Carter", email: "ben@cartercap.com", phone: "(415) 555-0108", by: "Dana Ruiz", followUp: "none", when: "2 weeks ago" },
  { id: "l12", name: "Maya Singh", email: "maya.singh@gmail.com", phone: "(628) 555-0151", by: "Alex Morgan", followUp: "running", when: "2 weeks ago" },
];

const FOLLOW_UP_TONE: Record<FollowUpState, string> = {
  none: "bg-gray-500/10 text-gray-400 border-gray-500/20",
  running: "bg-green-500/10 text-green-400 border-green-500/20",
  paused: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  done: "bg-blue-500/10 text-blue-300 border-blue-500/20",
};
const FOLLOW_UP_DOT: Record<FollowUpState, string> = {
  none: "bg-gray-500", running: "bg-green-400", paused: "bg-amber-400", done: "bg-blue-400",
};

// ── Fictional analytics (30 days) ───────────────────────────────────────────

const DAILY_VIEWS = Array.from({ length: 30 }, (_, i) => ({
  date: new Date(Date.UTC(2026, 7, 18 + i)).toISOString().slice(0, 10),
  views: 96 + Math.round(38 * Math.sin(i / 2.3) + 22 * Math.cos(i / 1.1) + i * 1.6),
}));
const TRAFFIC = [
  { source: "qr_code", views: 1050 },
  { source: "direct_link", views: 986 },
  { source: "swift_links", views: 757 },
  { source: "nfc_card", views: 512 },
  { source: "email_signature", views: 431 },
  { source: "apple_wallet", views: 214 },
  { source: "instagram_bio", views: 145 },
];

type Tab = "Team" | "Analytics" | "Leads" | "Branding";
const TABS: Tab[] = ["Team", "Analytics", "Leads", "Branding"];

// ── Shared bits (OfficeUI) ──────────────────────────────────────────────────

function PageHead({ title, desc, action }: { title: string; desc?: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 mb-5">
      <div className="min-w-0">
        <p className="text-xl font-bold text-white tracking-tight">{title}</p>
        {desc && <p className="text-gray-500 text-sm mt-0.5">{desc}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

function StatTile({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl px-4 py-4">
      <p className="text-2xl font-bold text-white tabular-nums">{typeof value === "number" ? value.toLocaleString("en-US") : value}</p>
      <p className="text-xs text-gray-500 mt-0.5">{label}</p>
      {hint && <p className="text-[0.6875rem] text-gray-600 mt-1">{hint}</p>}
    </div>
  );
}

const STATUS_TONE: Record<MemberStatus, string> = {
  active: "bg-green-500/10 text-green-400 border-green-500/20",
  card_incomplete: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  card_deactivated: "bg-gray-800 text-gray-400 border-gray-700",
  idle: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  invite_sent: "bg-gray-800 text-gray-400 border-gray-700",
  invite_expired: "bg-red-500/10 text-red-400 border-red-500/20",
};

function StatusChip({ status }: { status: MemberStatus }) {
  return (
    <span className={`text-[0.625rem] font-bold px-2 py-0.5 rounded-full border whitespace-nowrap ${STATUS_TONE[status]}`}>
      {MEMBER_STATUS_LABEL[status]}
    </span>
  );
}

function Avatar({ name, photo, size = 36 }: { name: string; photo?: string; size?: number }) {
  if (photo) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={photo} alt="" loading="lazy" decoding="async" className="rounded-full object-cover shrink-0 bg-gray-800" style={{ width: size, height: size }} />;
  }
  const initials = name.split(/\s+/).map((w) => w[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
  return (
    <span className="rounded-full bg-purple-500/15 border border-purple-500/20 text-purple-300 font-bold flex items-center justify-center shrink-0" style={{ width: size, height: size, fontSize: 12 }} aria-hidden="true">
      {initials}
    </span>
  );
}

const pill = "text-[0.6875rem] font-semibold text-gray-400 hover:text-white bg-gray-800 hover:bg-gray-700 px-2.5 py-1 rounded-full transition-colors";
const inputCls = "w-full bg-gray-950 border border-gray-800 rounded-xl px-3 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-purple-500/40";
const searchCls = "flex-1 bg-gray-900 border border-gray-800 rounded-xl px-3.5 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-purple-500/40";

// ── Team ────────────────────────────────────────────────────────────────────

function TeamTab() {
  const [open, setOpen] = useState<Person | null>(null);
  const invited = PEOPLE.filter((p) => !p.owner).length + 1;
  const activated = PEOPLE.filter((p) => !p.owner && p.cards > 0).length;
  const seatsUsed = PEOPLE.length + 1;
  const seatsPurchased = 8;

  return (
    <div>
      <div className="mb-3">
        <button type="button" className="inline-flex items-center gap-1.5 text-xs font-semibold text-purple-300 bg-purple-500/10 hover:bg-purple-500/15 border border-purple-500/25 rounded-full px-3 py-1.5 transition-colors shrink-0">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-3.5 h-3.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m0 0a6 6 0 016 6c0 2-1 3-2 4s-1.5 2-1.5 3h-5c0-1-.5-2-1.5-3s-2-2-2-4a6 6 0 016-6z" />
          </svg>
          Tour
        </button>
      </div>
      <PageHead
        title="Your team"
        desc="Everyone with a company card — their cards, views and contacts in one place."
        action={
          <div className="flex items-center gap-3">
            <span className="text-xs text-gray-500 whitespace-nowrap hidden @xl:block">
              <span className="text-gray-300 font-semibold tabular-nums">{seatsUsed} of {seatsPurchased}</span> seats in use
            </span>
            <button type="button" className="bg-purple-600 hover:bg-purple-500 text-white text-sm font-semibold px-4 py-2 rounded-full transition-colors shrink-0">
              + Add team member
            </button>
          </div>
        }
      />

      <div className="grid grid-cols-1 @xl:grid-cols-2 @3xl:grid-cols-4 gap-3 mb-6">
        <BigStat label="Leads captured this month" value={LEADS_MONTH.toLocaleString("en-US")} explainer="People who shared their info with your team" />
        <BigStat label="Card views this month" value={VIEWS_MONTH.toLocaleString("en-US")} explainer="Times someone opened one of your team's cards" />
        <BigStat label="Team activation rate" value={`${Math.round((activated / invited) * 100)}%`} sub={`${activated} of ${invited}`} explainer="People you invited who have a live card up" />
        <BigStat label="Seats in use" value={`${seatsUsed}`} sub={`of ${seatsPurchased}`} explainer={`You're paying for ${seatsPurchased - seatsUsed} seats nobody is using`} />
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
        <div className="hidden @3xl:grid grid-cols-12 gap-3 px-5 py-2.5 border-b border-gray-800 bg-gray-900/60 text-[0.6875rem] font-semibold text-gray-500 uppercase tracking-wider">
          <p className="col-span-4">Person</p>
          <p className="col-span-1 text-right">Views</p>
          <p className="col-span-1 text-right">Leads</p>
          <p className="col-span-2">Last active</p>
          <p className="col-span-2">Status</p>
          <p className="col-span-2 text-right">Actions</p>
        </div>
        <div>
          {/* A to Z, like the real Team tab (lib/office-analytics). */}
          {defaultEmployeeSort(PEOPLE).map((p) => (
            <div key={p.id} className="grid grid-cols-12 gap-3 px-5 py-3.5 items-center border-t border-gray-800 first:border-t-0 hover:bg-gray-800/40 transition-colors">
              <button type="button" onClick={() => setOpen(p)} className="col-span-12 @3xl:col-span-4 min-w-0 flex items-center gap-3 text-left" aria-label={`Open ${p.name}'s details`}>
                <Avatar name={p.name} photo={p.photo} />
                <span className="min-w-0">
                  <span className="flex items-center gap-2">
                    <span className="text-sm text-white font-medium truncate">{p.name}</span>
                    {p.owner && <span className="text-[0.625rem] text-purple-400 shrink-0">You</span>}
                  </span>
                  <span className="block text-[0.6875rem] text-gray-500 truncate">{p.title}</span>
                  <span className="block text-[0.6875rem] text-gray-600 truncate">{p.email}</span>
                </span>
              </button>
              <p className="col-span-4 @3xl:col-span-1 text-sm text-gray-300 tabular-nums @3xl:text-right">
                <span className="@3xl:hidden text-gray-600 text-[0.6875rem]">Views </span>{p.views.toLocaleString("en-US")}
              </p>
              <p className="col-span-4 @3xl:col-span-1 text-sm text-gray-300 tabular-nums @3xl:text-right">
                <span className="@3xl:hidden text-gray-600 text-[0.6875rem]">Leads </span>{p.leads.toLocaleString("en-US")}
              </p>
              <p className="col-span-4 @3xl:col-span-2 text-xs text-gray-500">{p.lastActive}</p>
              <div className="col-span-6 @3xl:col-span-2"><StatusChip status={p.status} /></div>
              <div className="col-span-6 @3xl:col-span-2 flex @3xl:justify-end">
                <button type="button" onClick={() => setOpen(p)} className={pill}>Manage</button>
              </div>
            </div>
          ))}
          {/* A pending invitation lives in the same list as real people. */}
          <div className="grid grid-cols-12 gap-3 px-5 py-3.5 items-center border-t border-gray-800">
            <div className="col-span-12 @3xl:col-span-4 min-w-0 flex items-center gap-3">
              <Avatar name={INVITE.name} />
              <div className="min-w-0">
                <p className="text-sm text-white font-medium truncate">{INVITE.name}</p>
                <p className="text-[0.6875rem] text-gray-500 truncate">{INVITE.email}</p>
                <p className="text-[0.6875rem] text-gray-600">Invited {INVITE.sent}</p>
              </div>
            </div>
            <p className="col-span-4 @3xl:col-span-1 text-sm text-gray-600 @3xl:text-right">—</p>
            <p className="col-span-4 @3xl:col-span-1 text-sm text-gray-600 @3xl:text-right">—</p>
            <p className="col-span-4 @3xl:col-span-2 text-xs text-gray-600">—</p>
            <div className="col-span-6 @3xl:col-span-2"><StatusChip status="invite_sent" /></div>
            <div className="col-span-12 @3xl:col-span-2 flex @3xl:justify-end">
              <span className="inline-flex items-center gap-2 flex-wrap justify-end">
                <button type="button" className="text-[0.6875rem] font-semibold text-purple-300 hover:text-purple-200 bg-purple-500/10 hover:bg-purple-500/15 px-2.5 py-1 rounded-full transition-colors">Remind</button>
                <button type="button" className="text-[0.6875rem] font-semibold text-gray-300 hover:text-white bg-gray-800 hover:bg-gray-700 px-2.5 py-1 rounded-full transition-colors">Manage</button>
              </span>
            </div>
          </div>
        </div>
      </div>

      {open && <PersonDrawer person={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

// TeamList's BigStat (the trend line was removed from the real one 2026-08-26).
function BigStat({ label, value, explainer, sub }: { label: string; value: string; explainer: string; sub?: string }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl px-4 py-4">
      <p className="text-xs text-gray-500">{label}</p>
      <div className="flex items-baseline gap-2 mt-1 flex-wrap">
        <p className="text-[1.75rem] font-bold text-white tabular-nums leading-none">{value}</p>
        {sub && <span className="text-xs text-gray-600 font-medium">{sub}</span>}
      </div>
      <p className="text-[0.6875rem] text-gray-600 mt-1.5 leading-snug">{explainer}</p>
    </div>
  );
}

// TeamList's detail drawer, held inside the demo frame (absolute, not fixed).
function PersonDrawer({ person, onClose }: { person: Person; onClose: () => void }) {
  const action = "text-xs font-semibold text-gray-300 hover:text-white bg-gray-800 hover:bg-gray-700 px-3.5 py-2 rounded-full transition-colors";
  return (
    <div className="absolute inset-0 z-20 flex justify-end" role="dialog" aria-label={`${person.name} details`}>
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <aside className="relative w-full max-w-md bg-gray-900 border-l border-gray-800 h-full overflow-y-auto p-5">
        <div className="flex items-start justify-between gap-3 mb-5">
          <div className="flex items-center gap-3 min-w-0">
            <Avatar name={person.name} photo={person.photo} size={44} />
            <div className="min-w-0">
              <p className="text-white font-bold truncate">{person.name}</p>
              <p className="text-gray-500 text-xs truncate">{person.title}</p>
              <p className="text-gray-600 text-[0.6875rem] truncate">{person.email}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="text-gray-500 hover:text-white text-2xl leading-none px-1 shrink-0">×</button>
        </div>
        <div className="mb-4"><StatusChip status={person.status} /></div>
        <div className="grid grid-cols-3 gap-2 mb-5">
          {[
            ["Card views", person.views.toLocaleString("en-US")],
            ["Leads", person.leads.toLocaleString("en-US")],
            ["Cards", String(person.cards)],
          ].map(([k, v]) => (
            <div key={k} className="rounded-xl border border-gray-800 bg-gray-950/50 px-3 py-2.5">
              <p className="text-white font-bold tabular-nums">{v}</p>
              <p className="text-[0.625rem] text-gray-500 mt-0.5">{k}</p>
            </div>
          ))}
        </div>
        <p className="text-xs text-gray-500 mb-5">
          Last active: <span className="text-gray-300">{person.lastActive}</span>
        </p>
        <div className="flex flex-wrap gap-2 mb-5">
          <button type="button" className={action}>View live card ↗</button>
          <button type="button" className={action}>Copy card link</button>
          <button type="button" className={action}>Show QR code</button>
          <button type="button" className={action}>Manage their cards</button>
        </div>
        {person.owner ? (
          <p className="text-[0.6875rem] text-gray-600 pt-4 border-t border-gray-800">
            This is you. Your team&apos;s look is set on the Branding page, not here.
          </p>
        ) : (
          <div className="pt-4 border-t border-gray-800">
            <button type="button" className="text-xs font-semibold text-red-400 hover:text-red-300 bg-red-500/10 hover:bg-red-500/15 px-3.5 py-2 rounded-full transition-colors">
              Remove from team
            </button>
          </div>
        )}
      </aside>
    </div>
  );
}

// ── Analytics ───────────────────────────────────────────────────────────────

type SortKey = "name" | "card" | "views" | "unique" | "scans" | "leads" | "contacts" | "swiftlink";
const COLUMNS: { key: SortKey | "last"; label: string; hint: string }[] = [
  { key: "name", label: "Employee", hint: "Team member name" },
  { key: "card", label: "Card", hint: "Their card, or how many cards they own" },
  { key: "views", label: "Views", hint: "Times their card was opened — repeat visits count; reloads within a visit don't" },
  { key: "unique", label: "Unique visitors", hint: "Distinct visitors in the selected range" },
  { key: "scans", label: "Scans", hint: "Views attributed to a QR code scan or NFC tap" },
  { key: "leads", label: "Leads", hint: "People who shared their contact info" },
  { key: "contacts", label: "Contact downloads", hint: "Visitors who downloaded this card as a contact" },
  { key: "swiftlink", label: "SwiftLink views", hint: "Visits to their Swift Links page" },
  { key: "last", label: "Last activity", hint: "Most recent view, lead, or contact save" },
];

function AnalyticsTab() {
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const totalViews = sum((p) => p.views + p.swiftlink);
  const totalLeads = sum((p) => p.leads);

  const rows = useMemo(() => {
    const base = PEOPLE.map((p) => ({ ...p, contactsSaved: p.contacts }));
    const q = query.trim().toLowerCase();
    const filtered = q ? base.filter((r) => r.name.toLowerCase().includes(q) || r.card.toLowerCase().includes(q)) : base;
    if (!sortKey) return defaultEmployeeSort(filtered);
    const dir = sortDir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (av == null || bv == null) return av == null ? 1 : -1;
      if (typeof av === "string" && typeof bv === "string") return dir * av.localeCompare(bv);
      return dir * ((av as number) - (bv as number));
    });
  }, [query, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    else { setSortKey(key); setSortDir("desc"); }
  }

  return (
    <div>
      <PageHead
        title="Analytics"
        desc="Views, scans, contact downloads and leads for every card on your team."
        action={
          <div className="flex gap-1 bg-gray-900 border border-gray-800 rounded-full p-1" role="group" aria-label="Date range">
            {["7 days", "30 days", "90 days"].map((l) => (
              <span key={l} className={`px-3 py-1.5 text-xs font-semibold rounded-full ${l === "30 days" ? "bg-purple-600 text-white" : "text-gray-400"}`}>{l}</span>
            ))}
          </div>
        }
      />

      <div className="grid grid-cols-2 @3xl:grid-cols-4 gap-3 mb-6">
        <StatTile label="Total views" value={totalViews} hint="+21% vs prior period" />
        <StatTile label="Unique visitors" value={2231} hint="Distinct visitors across the whole team" />
        <StatTile label="Card/QR scans" value={sum((p) => p.scans)} hint="+14% vs prior period" />
        <StatTile label="Leads captured" value={totalLeads} hint="+18% vs prior period" />
        <StatTile label="Contact downloads" value={sum((p) => p.contacts)} hint="+9% vs prior period" />
        <StatTile label="SwiftLink views" value={sum((p) => p.swiftlink)} hint="Visits to a Swift Links page" />
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5 mb-6">
        <p className="text-[0.6875rem] font-semibold text-gray-500 uppercase tracking-wider mb-3">Views over time</p>
        <ViewsChart data={DAILY_VIEWS} />
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5 mb-6">
        <p className="text-[0.6875rem] font-semibold text-gray-500 uppercase tracking-wider mb-3">Traffic sources</p>
        <div className="space-y-1.5">
          {TRAFFIC.map((s) => (
            <div key={s.source} className="flex items-center justify-between text-sm">
              <span className="text-gray-300">{getSourceLabel(s.source)}</span>
              <span className="text-gray-500 tabular-nums">{s.views}</span>
            </div>
          ))}
        </div>
      </div>

      <p className="text-[0.6875rem] font-semibold text-gray-500 uppercase tracking-wider mb-2">Your team</p>
      <div className="flex flex-col @xl:flex-row gap-2.5 mb-4">
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by employee or card name…" aria-label="Search employees or cards" className={searchCls} />
        <button type="button" className="text-xs font-semibold text-gray-300 hover:text-white bg-gray-800 hover:bg-gray-700 px-3.5 py-2.5 rounded-xl transition-colors text-center whitespace-nowrap">
          Export CSV
        </button>
      </div>
      {rows.length === 0 ? (
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-10 text-center">
          <p className="text-gray-400 text-sm">Nothing matches that search.</p>
        </div>
      ) : (
        <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800 bg-gray-900/60">
                {COLUMNS.map((c) => (
                  <th key={c.key} scope="col" className="text-left px-4 py-2.5 whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => c.key !== "last" && toggleSort(c.key)}
                      title={c.hint}
                      className="flex items-center gap-1 text-[0.6875rem] font-semibold text-gray-500 uppercase tracking-wider hover:text-gray-300 transition-colors"
                    >
                      {c.label}
                      {sortKey === c.key && <span aria-hidden="true">{sortDir === "desc" ? "↓" : "↑"}</span>}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-gray-800 hover:bg-gray-800/40 transition-colors">
                  <td className="px-4 py-3 whitespace-nowrap text-white font-medium">{r.name}</td>
                  <td className="px-4 py-3 text-gray-400 whitespace-nowrap">{r.card}</td>
                  <td className="px-4 py-3 text-gray-300 tabular-nums">{r.views}</td>
                  <td className="px-4 py-3 text-gray-300 tabular-nums">{r.unique}</td>
                  <td className="px-4 py-3 text-gray-300 tabular-nums">{r.scans}</td>
                  <td className="px-4 py-3 text-gray-300 tabular-nums font-semibold">{r.leads}</td>
                  <td className="px-4 py-3 text-gray-300 tabular-nums">{r.contacts}</td>
                  <td className="px-4 py-3 text-gray-300 tabular-nums">{r.swiftlink}</td>
                  <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{r.lastActive}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Leads ───────────────────────────────────────────────────────────────────

function LeadsTab() {
  const [rows, setRows] = useState<Lead[]>(LEADS);
  const [person, setPerson] = useState("all");
  const [followUp, setFollowUp] = useState<"all" | FollowUpState>("all");
  const [query, setQuery] = useState("");
  const total = LEADS_MONTH;
  const hasMore = rows.length < LEADS.length + MORE_LEADS.length;

  const people = useMemo(() => Array.from(new Set(rows.map((l) => l.by))).sort(), [rows]);
  const visible = rows.filter((l) => {
    if (person !== "all" && l.by !== person) return false;
    if (followUp !== "all" && l.followUp !== followUp) return false;
    const q = query.trim().toLowerCase();
    return !q || l.name.toLowerCase().includes(q);
  });
  const selectCls = "bg-gray-900 border border-gray-800 rounded-xl px-3.5 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-purple-500/40";

  return (
    <div>
      <PageHead title="Leads" desc={`Everyone who shared their info with your team — ${total.toLocaleString()} so far.`} />
      <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
        <p className="text-[0.6875rem] text-gray-500">
          {`Showing ${rows.length} of ${total.toLocaleString()} leads`}
          {visible.length !== rows.length && ` · ${visible.length} match your filters`}
        </p>
        <button type="button" className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-300 hover:text-white border border-gray-700 hover:border-gray-500 px-3 py-1.5 rounded-lg transition-colors">
          <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5" aria-hidden="true">
            <path fillRule="evenodd" d="M8 1a.75.75 0 01.75.75v6.19l1.22-1.22a.75.75 0 111.06 1.06l-2.5 2.5a.75.75 0 01-1.06 0l-2.5-2.5a.75.75 0 111.06-1.06l1.22 1.22V1.75A.75.75 0 018 1zM1.5 10.5a.75.75 0 01.75.75v1.5c0 .138.112.25.25.25h11a.25.25 0 00.25-.25v-1.5a.75.75 0 011.5 0v1.5A1.75 1.75 0 0113.5 14.5h-11A1.75 1.75 0 01.75 12.75v-1.5a.75.75 0 01.75-.75z" clipRule="evenodd" />
          </svg>
          Export all as CSV
        </button>
      </div>

      <div className="flex flex-col @xl:flex-row gap-2.5 mb-4">
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by contact name…" aria-label="Search leads by contact name" className={searchCls} />
        <select value={person} onChange={(e) => setPerson(e.target.value)} aria-label="Filter by team member" className={`${selectCls} @xl:w-48`}>
          <option value="all">Everyone on the team</option>
          {people.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <select value={followUp} onChange={(e) => setFollowUp(e.target.value as "all" | FollowUpState)} aria-label="Filter by follow-up" className={`${selectCls} @xl:w-44`}>
          <option value="all">Any follow-up</option>
          {FOLLOW_UP_STATES.map((st) => <option key={st} value={st}>{FOLLOW_UP_COPY[st].label}</option>)}
        </select>
      </div>

      {visible.length === 0 ? (
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-10 text-center">
          <p className="text-gray-400 text-sm">
            {hasMore ? "Nothing on this page matches those filters. Load more below, or export everything." : "Nothing matches those filters."}
          </p>
        </div>
      ) : (
        <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
          <div className="hidden @3xl:grid grid-cols-12 gap-3 px-5 py-2.5 border-b border-gray-800 bg-gray-900/60 text-[0.6875rem] font-semibold text-gray-500 uppercase tracking-wider">
            <p className="col-span-3">Contact</p>
            <p className="col-span-3">Email &amp; phone</p>
            <p className="col-span-2">Captured by</p>
            <p className="col-span-2">Follow-up</p>
            <p className="col-span-2">When</p>
          </div>
          <div>
            {visible.map((l) => (
              <div key={l.id} className="grid grid-cols-12 gap-3 px-5 py-3 items-center border-t border-gray-800 first:border-t-0">
                <div className="col-span-12 @3xl:col-span-3 min-w-0">
                  <p className="text-sm text-white truncate">{l.name}</p>
                </div>
                <div className="col-span-12 @3xl:col-span-3 min-w-0">
                  <p className="text-xs text-gray-400 truncate">{l.email || "No email"}</p>
                  <p className="text-xs text-gray-600 truncate">{l.phone || "No phone"}</p>
                </div>
                <p className="col-span-6 @3xl:col-span-2 text-xs text-gray-400 truncate">{l.by}</p>
                <div className="col-span-6 @3xl:col-span-2 min-w-0">
                  <span title={FOLLOW_UP_COPY[l.followUp].hint} className={`inline-flex items-center gap-1.5 text-[0.6875rem] font-semibold px-2 py-0.5 rounded-full border ${FOLLOW_UP_TONE[l.followUp]}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${FOLLOW_UP_DOT[l.followUp]}`} aria-hidden="true" />
                    {FOLLOW_UP_COPY[l.followUp].label}
                  </span>
                </div>
                <p className="col-span-6 @3xl:col-span-2 text-xs text-gray-600 whitespace-nowrap">{l.when}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mt-3 flex flex-col items-center gap-2">
        <button
          type="button"
          onClick={() => hasMore && setRows((rs) => [...rs, ...MORE_LEADS])}
          className="w-full @xl:w-auto px-5 py-2.5 rounded-full text-xs font-semibold border border-gray-700 text-gray-300 hover:text-white hover:border-gray-500 transition-colors"
        >
          {`Load more — ${(total - rows.length).toLocaleString()} to go`}
        </button>
      </div>

      <p className="text-[0.6875rem] text-gray-600 mt-3">
        Follow-up is whatever the contact&apos;s own email and text automations are doing — your
        teammate sets those on the contact, and this follows along.
      </p>
    </div>
  );
}

// ── Branding ────────────────────────────────────────────────────────────────

function Section({ n, title, desc, children }: { n: number; title: string; desc: string; children: React.ReactNode }) {
  return (
    <section className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
      <div className="flex items-start gap-3 mb-4">
        <span className="w-5 h-5 rounded-full bg-purple-500/15 text-purple-300 text-[0.6875rem] font-bold flex items-center justify-center shrink-0 mt-0.5" aria-hidden="true">{n}</span>
        <div>
          <p className="text-sm font-bold text-white">{title}</p>
          <p className="text-gray-500 text-xs mt-0.5">{desc}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

// The Links half numbers its sections with a bordered disc (OfficeLinksBranding).
function LinksSection({ n, title, desc, children }: { n: number; title: string; desc: string; children: React.ReactNode }) {
  return (
    <section className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
      <div className="flex items-start gap-3 mb-4">
        <span className="shrink-0 w-6 h-6 rounded-full bg-purple-500/15 border border-purple-500/30 text-purple-300 text-[0.6875rem] font-bold grid place-items-center">{n}</span>
        <div className="min-w-0">
          <p className="text-sm font-bold text-white">{title}</p>
          <p className="text-[0.6875rem] text-gray-500 mt-0.5 leading-snug">{desc}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

function BrandingTab() {
  const [tab, setTab] = useState<"card" | "links">("card");
  return (
    <div>
      <PageHead title="Branding" desc="Set this once — every card on your team automatically uses it. Your own cards stay yours to design." />
      <div className="bg-purple-500/5 border border-purple-500/20 rounded-2xl px-4 py-3 mb-5">
        <p className="text-sm text-purple-200 font-medium">This page sets the look for every card and Swift Links page</p>
        <p className="text-xs text-purple-200/70 mt-1 leading-relaxed">
          Logo, company details, template, colors and fonts set here apply to your team&apos;s
          cards. Change them once, and every teammate&apos;s card updates with them. Use
          the <strong>Links</strong> tab to do the same for their Swift Links pages.
          Your own cards are yours — they stay exactly as you designed them.
        </p>
      </div>
      <div role="tablist" aria-label="What to brand" className="inline-flex items-center gap-1 p-1 mb-4 rounded-full bg-gray-900 border border-gray-800">
        {([["card", "Card"], ["links", "Links"]] as const).map(([id, label]) => (
          <button
            key={id}
            role="tab"
            type="button"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={`px-4 py-1.5 rounded-full text-xs font-semibold transition-colors ${tab === id ? "bg-purple-600 text-white" : "text-gray-400 hover:text-white"}`}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "card" ? <CardBranding /> : <LinksBranding />}
    </div>
  );
}

function CardBranding() {
  const [logoUrl, setLogoUrl] = useState<string | null>(LOGO_URL);
  const [logoShape, setLogoShape] = useState<"auto" | "circle">("auto");
  const [company, setCompany] = useState(COMPANY);
  const [website, setWebsite] = useState(WEBSITE);
  const [phone, setPhone] = useState("(415) 555-0100");
  const [fax, setFax] = useState("(415) 555-0101");
  const [address, setAddress] = useState({ street: "1200 Ocean Ave", unit: "", city: "San Francisco", state: "CA", zip: "94122" });
  const [template, setTemplate] = useState<string>("classic-pro");
  const [design, setDesign] = useState<TemplateStyle>({});
  const [lockTemplate, setLockTemplate] = useState(true);
  const [saved, setSaved] = useState(false);
  const setAddr = (k: keyof typeof address, v: string) => setAddress((a) => ({ ...a, [k]: v }));

  const Preview = TEMPLATE_COMPONENTS[isTemplateId(template) ? template : "classic-pro"];
  const addrLine = [address.street, address.unit, address.city, address.state, address.zip].filter((v) => v.trim()).join(", ");
  // A stand-in teammate, exactly like the real page.
  const previewData = withoutSocials({
    name: "Dana Lee",
    title: "Sales Manager",
    company: company || "Your company",
    phone: phone || "(415) 555-0188",
    email: "dana@" + (website ? website.replace(/^https?:\/\//, "").replace(/\/.*$/, "") : "company.com"),
    website: website || "",
    address: addrLine || undefined,
    initials: "DL",
    logoUrl,
    cardUrl: "swiftcard.me/dana",
    customization: { ...design, logoShape },
  });

  const save = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  return (
    <div className="flex flex-col gap-4 @3xl:grid @3xl:grid-cols-[1fr_260px] @5xl:grid-cols-[1fr_300px] @3xl:items-start">
      <div className="@3xl:col-start-1 min-w-0">
        <Section n={1} title="Company information" desc="What's true about your business. This is the same on everyone's card.">
          <div className="space-y-4">
            <div>
              {/* Static stand-in for ImageUpload + LogoSuggest — nothing uploads. */}
              <p className="text-xs text-gray-500 block mb-1">Company logo</p>
              <div className="flex items-center gap-4">
                <button
                  type="button"
                  onClick={() => setLogoUrl(LOGO_URL)}
                  aria-label={logoUrl ? "Change company logo" : "Upload company logo"}
                  className="w-36 h-24 overflow-hidden border-2 border-dashed border-gray-700 bg-gray-900 rounded-xl flex items-center justify-center shrink-0 transition-all hover:border-blue-500"
                >
                  {logoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={logoUrl} alt="Company logo" loading="lazy" decoding="async" className="w-full h-full" style={{ objectFit: "contain", padding: 6, borderRadius: 10 }} />
                  ) : (
                    <svg className="w-6 h-6 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0zM18.75 10.5h.008v.008h-.008V10.5z" />
                    </svg>
                  )}
                </button>
                <div>
                  <div className="flex items-center gap-3 mb-1">
                    <button type="button" onClick={() => setLogoUrl(LOGO_URL)} className="text-xs font-medium text-blue-700 hover:text-blue-800 transition-colors">
                      {logoUrl ? "Change" : "Upload"}
                    </button>
                    {logoUrl && (
                      <button type="button" onClick={() => setLogoUrl(null)} className="text-xs font-medium text-red-400 hover:text-red-300 transition-colors">Remove</button>
                    )}
                  </div>
                  <p className="text-[0.6875rem] text-gray-600">JPG, PNG · max 5 MB</p>
                  <p className="text-[0.6875rem] text-gray-500 mt-0.5">Tap to select · then drag corners to crop</p>
                </div>
              </div>
              <div className="mt-2">
                <button type="button" onClick={() => setLogoUrl(LOGO_URL)} className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-700 hover:text-blue-800 transition-colors">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-3.5 h-3.5">
                    <circle cx="11" cy="11" r="7" strokeLinecap="round" />
                    <path d="M21 21l-4.3-4.3" strokeLinecap="round" />
                  </svg>
                  Suggest my company logo
                </button>
              </div>
              {logoUrl && (
                <div className="mt-2">
                  <p className="text-[0.6875rem] text-gray-500 mb-1.5">Logo shape on the card</p>
                  <Segmented
                    label="Logo shape on the card"
                    value={logoShape}
                    onChange={setLogoShape}
                    options={[
                      { value: "auto", label: "Original" },
                      { value: "circle", label: "Circle" },
                    ]}
                  />
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 @xl:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1.5">Company name</label>
                <input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Coastline Realty" className={inputCls} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1.5">Website</label>
                <input value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="coastlinehomes.com" className={inputCls} />
              </div>
            </div>

            <div className="grid grid-cols-1 @xl:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1.5">
                  Main phone number <span className="text-gray-600 font-normal">(optional)</span>
                </label>
                <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(555) 123-4567" className={inputCls} />
                <p className="text-[0.6875rem] text-gray-600 mt-1">Shows as &quot;Office&quot; on every card, next to each person&apos;s own number.</p>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1.5">
                  Fax number <span className="text-gray-600 font-normal">(optional)</span>
                </label>
                <input type="tel" value={fax} onChange={(e) => setFax(e.target.value)} placeholder="(555) 123-4568" className={inputCls} />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1.5">
                Business address <span className="text-gray-600 font-normal">(optional)</span>
              </label>
              <div className="grid grid-cols-6 gap-2">
                <input value={address.street} onChange={(e) => setAddr("street", e.target.value)} placeholder="Street" aria-label="Street" className={`col-span-4 ${inputCls}`} />
                <input value={address.unit} onChange={(e) => setAddr("unit", e.target.value)} placeholder="Unit" aria-label="Unit" className={`col-span-2 ${inputCls}`} />
                <input value={address.city} onChange={(e) => setAddr("city", e.target.value)} placeholder="City" aria-label="City" className={`col-span-3 ${inputCls}`} />
                <input value={address.state} onChange={(e) => setAddr("state", e.target.value)} placeholder="State" aria-label="State" className={`col-span-1 ${inputCls}`} />
                <input value={address.zip} onChange={(e) => setAddr("zip", e.target.value)} placeholder="ZIP" aria-label="ZIP" className={`col-span-2 ${inputCls}`} />
              </div>
            </div>
          </div>
        </Section>
      </div>

      <aside className="@3xl:col-start-2 @3xl:row-start-1 @3xl:row-span-2 @3xl:sticky @3xl:top-4">
        <p className="text-[0.6875rem] font-semibold text-gray-500 uppercase tracking-wider mb-2">Preview</p>
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-3">
          <div className="rounded-xl overflow-hidden">
            <InertPreview><CardScaler><Preview data={previewData} /></CardScaler></InertPreview>
          </div>
          <p className="text-[0.6875rem] text-gray-600 mt-2.5 leading-snug">
            An example teammate. Their own details and socials stay theirs — the
            company look and details are what you set here.
          </p>
        </div>
      </aside>

      <div className="@3xl:col-start-1 min-w-0 flex flex-col gap-4">
        <Section n={2} title="Card appearance" desc="The design your whole team inherits — template, colors and fonts.">
          <TemplatePicker template={template} onSelect={setTemplate} data={previewData} customUnlocked={false} upsell={false} />
          <div className="mt-4">
            <TemplateStyleControls value={design} onChange={(p) => setDesign((prev) => ({ ...prev, ...p }))} template={template} canUpload={false} />
          </div>
          <p className="text-[0.6875rem] text-gray-600 mt-3">
            Use the lock below to decide whether every team card must match this design.
          </p>
        </Section>

        <Section n={3} title="What team members can edit" desc="Everything else is locked to what you set above.">
          <div className="rounded-xl border border-gray-800 bg-gray-950/50 p-3.5 mb-4">
            <p className="text-[0.6875rem] font-semibold text-gray-400 mb-2">Each person fills in only:</p>
            <ul className="flex flex-wrap gap-x-4 gap-y-1.5">
              {["Their name", "Their photo", "Their job title", "Their phone", "Their email", "Their social profiles"].map((t) => (
                <li key={t} className="flex items-center gap-1.5 text-[0.6875rem] text-gray-400">
                  <span className="text-green-400" aria-hidden="true">✓</span>{t}
                </li>
              ))}
            </ul>
            <p className="text-[0.6875rem] font-semibold text-gray-400 mt-3 mb-2">They can never change:</p>
            <ul className="flex flex-wrap gap-x-4 gap-y-1.5">
              {["Company logo", "Company name", "Website", "Office phone", "Fax number", "Address"].map((t) => (
                <li key={t} className="flex items-center gap-1.5 text-[0.6875rem] text-gray-500">
                  <span className="text-gray-600" aria-hidden="true">🔒</span>{t}
                </li>
              ))}
            </ul>
            <p className="text-[0.6875rem] text-gray-500 mt-3 leading-snug">
              Their Swift Links page — bio, Instagram and pinned link buttons — is set on
              the <strong className="text-gray-400">Links</strong> tab.
            </p>
          </div>
          <label className="flex items-start gap-2 text-xs text-gray-400 cursor-pointer">
            <input type="checkbox" checked={lockTemplate} onChange={(e) => setLockTemplate(e.target.checked)} className="accent-purple-500 mt-0.5" />
            <span>
              Keep every card matching
              <span className="block text-[0.6875rem] text-gray-600 mt-0.5">
                Recommended. Uncheck only if you want each person to pick their own style.
              </span>
            </span>
          </label>
        </Section>

        <div className="flex items-center gap-3 flex-wrap">
          <button type="button" onClick={save} className="bg-purple-600 hover:bg-purple-500 text-white text-sm font-semibold px-5 py-2.5 rounded-full transition-colors">
            Save &amp; apply to all cards
          </button>
          {saved && <span className="text-green-400 text-sm font-medium" role="status">Applied to every card ✓</span>}
        </div>
      </div>
    </div>
  );
}

type HeaderRow = { label: string; url: string; kind: "header" };

function LinksBranding() {
  const [style, setStyle] = useState<SwiftLinkStyle>({});
  const [bio, setBio] = useState("");
  const [instagram, setInstagram] = useState("coastlinerealty");
  // Section headers only: a company LINK row would make the real preview fetch
  // /api/link-preview, which a marketing demo must never do. The add-link
  // inputs therefore stay in their empty state.
  const [links, setLinks] = useState<HeaderRow[]>([]);
  const [lockLinkDesign, setLockLinkDesign] = useState(false);
  const [saved, setSaved] = useState(false);

  const save = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  const controlled = [
    ...(bio ? ["The bio"] : []),
    ...(instagram ? ["Company Instagram"] : []),
    ...(links.length ? ["Company Additional Links"] : []),
    ...(lockLinkDesign ? ["The page's whole look"] : []),
  ];

  return (
    <div className="flex flex-col gap-4 @3xl:grid @3xl:grid-cols-[1fr_260px] @5xl:grid-cols-[1fr_300px] @3xl:items-start">
      <div className="space-y-4 min-w-0">
        <LinksSection n={1} title="Links information" desc="What every teammate's Swift Links page says. Leave anything blank to let them write their own.">
          <div className="space-y-4">
            <div>
              <label htmlFor="demo-office-link-bio" className="block text-xs font-medium text-gray-400 mb-1">Bio</label>
              <textarea
                id="demo-office-link-bio"
                value={bio}
                onChange={(e) => setBio(e.target.value.slice(0, 500))}
                rows={3}
                placeholder="One or two lines about the company — appears under everyone's name."
                className={`${inputCls} px-3.5 resize-none`}
              />
              <p className="text-[0.625rem] text-gray-600 mt-1">
                {bio ? "Everyone's page shows this. Their own bio is kept and returns if you clear this." : "Empty — each teammate writes their own."}
              </p>
            </div>

            <div>
              {/* The same row as the real Office Links tab (SocialHandleField). */}
              <SocialHandleField
                spec={{ ...socialInput("instagram")!, label: "Company Instagram" }}
                id="demo-office-link-ig"
                value={instagram}
                onChange={setInstagram}
                onBlur={() => setInstagram((v) => normalizeSocial(v, "instagram"))}
              />
              <p className="text-[0.625rem] text-gray-600 mt-1">
                Shows on everyone&apos;s page. Their own Instagram comes back if you clear this — other socials stay theirs.
              </p>
            </div>

            <div>
              <p className="block text-xs font-medium text-gray-400 mb-1">Company Additional Links</p>
              <p className="text-[0.625rem] text-gray-600 mb-2.5">
                These appear at the top of every teammate&apos;s page and they can&apos;t change them — but they can
                still add their own underneath.
              </p>
              {links.length > 0 && (
                <div className="space-y-2 mb-2">
                  {links.map((l, i) => (
                    <div key={`h-${i}`} className="flex items-center gap-2.5 bg-gray-950 border border-gray-700 border-dashed rounded-xl px-3 py-2.5">
                      <span className="text-[0.5625rem] font-bold uppercase tracking-wide text-gray-500 shrink-0">Section</span>
                      <input
                        type="text"
                        value={l.label}
                        onChange={(e) => setLinks((prev) => prev.map((x, xi) => (xi === i ? { ...x, label: e.target.value.slice(0, 120) } : x)))}
                        placeholder="Section title (e.g. Listings)"
                        className="flex-1 min-w-0 bg-transparent text-gray-200 text-xs font-bold uppercase tracking-wide focus:outline-none placeholder-gray-600"
                      />
                      <button
                        type="button"
                        onClick={() => setLinks((prev) => prev.filter((_, xi) => xi !== i))}
                        aria-label={`Remove section ${l.label || "header"}`}
                        className="shrink-0 grid place-items-center w-9 h-9 -mr-1.5 rounded-lg text-gray-500 hover:text-red-400 hover:bg-red-500/10 transition-colors text-lg leading-none"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {/* The real add form, drawn but inert: a company LINK row would make
                  the preview fetch /api/link-preview (see `links` above). */}
              <AddLinkForm
                value={{ label: "", url: "" }}
                onChange={() => {}}
                onAdd={() => {}}
                addLabel="+ Add company link"
                ideas={["Book a meeting", "Leave a review", "See our listings", "Watch our video", "Shop now"]}
                idPrefix="demo-office-link-new"
                inert
              />
              {/* Below the form, like the real Office Links tab. */}
              <button
                type="button"
                onClick={() => setLinks((prev) => [...prev, { label: "", url: "", kind: "header" }])}
                className="block mt-2 -ml-1.5 px-1.5 py-2 rounded-lg text-[0.6875rem] font-semibold text-gray-400 hover:text-gray-200 hover:bg-gray-800/60 transition-colors"
              >
                + Add a section header
              </button>
            </div>
          </div>
        </LinksSection>

        <LinksSection n={2} title="Links appearance" desc="The design your whole team inherits — the same controls your teammates see under Social design.">
          <SwiftLinkStyleControls value={style} onChange={(p) => setStyle((prev) => ({ ...prev, ...p }))} links={links} onLinksChange={(next) => setLinks(next.filter((l): l is HeaderRow => l.kind === "header"))} canUpload={false} />
        </LinksSection>

        <LinksSection n={3} title="What team members can edit" desc="Everything else on their page is what you set above.">
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 mb-4">
            <div>
              <p className="text-[0.625rem] font-semibold uppercase tracking-wide text-gray-500 mb-1.5">They fill in</p>
              <ul className="space-y-1">
                {["Their name and photo", "Their own link buttons", ...(bio ? [] : ["Their bio"]), "LinkedIn, TikTok, X, Facebook, YouTube, Snapchat"].map((t) => (
                  <li key={t} className="flex items-start gap-1.5 text-[0.6875rem] text-gray-400">
                    <span className="text-gray-600 shrink-0" aria-hidden="true">✓</span>{t}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="text-[0.625rem] font-semibold uppercase tracking-wide text-gray-500 mb-1.5">You control</p>
              <ul className="space-y-1">
                {controlled.map((t) => (
                  <li key={t} className="flex items-start gap-1.5 text-[0.6875rem] text-gray-500">
                    <span className="text-gray-600 shrink-0" aria-hidden="true">🔒</span>{t}
                  </li>
                ))}
                {controlled.length === 0 && (
                  <li className="text-[0.6875rem] text-gray-600">Nothing yet — fill anything in above and it lands here.</li>
                )}
              </ul>
            </div>
          </div>
          <label className="flex items-start gap-2 text-xs text-gray-400 cursor-pointer">
            <input type="checkbox" checked={lockLinkDesign} onChange={(e) => setLockLinkDesign(e.target.checked)} className="accent-purple-500 mt-0.5" />
            <span>
              Keep every Swift Links page matching
              <span className="block text-[0.6875rem] text-gray-600 mt-0.5">
                Your teammates keep their own bio, socials and links — only the look becomes yours.
                Leave it off to let each person design their own page.
              </span>
            </span>
          </label>
        </LinksSection>

        <div className="flex items-center gap-3 flex-wrap">
          <button type="button" onClick={save} className="bg-purple-600 hover:bg-purple-500 text-white text-sm font-semibold px-5 py-2.5 rounded-full transition-colors">
            Save &amp; apply to all Swift Links
          </button>
          {saved && <span className="text-green-400 text-xs font-semibold">Applied to every page ✓</span>}
        </div>
      </div>

      <aside className="@3xl:sticky @3xl:top-4">
        <p className="text-[0.6875rem] font-semibold text-gray-400 uppercase tracking-wide mb-2">Live preview</p>
        <div data-preview-frame className="rounded-2xl overflow-hidden border border-gray-800">
          <SwiftLinkLivePreview
            name="Sam Rivera"
            handle="samrivera"
            company={COMPANY}
            title="Associate"
            bio={bio || "Their own bio goes here."}
            logoUrl={LOGO_URL}
            socials={{ instagram: instagram || "yourteam", website: WEBSITE }}
            links={links}
            style={style}
            paid
          />
        </div>
        <p className="text-[0.6875rem] text-gray-600 mt-2.5 leading-snug">
          A teammate&apos;s page under this branding. Their name, photo and their own links are theirs.
        </p>
      </aside>
    </div>
  );
}

// ── The frame ───────────────────────────────────────────────────────────────

export default function TeamsDashboard() {
  const [tab, setTab] = useState<Tab>("Team");
  const scrollRef = useRef<HTMLDivElement>(null);

  const pick = (t: Tab) => {
    setTab(t);
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  };

  // LIGHT, like DashboardDemo: light is the app's default theme. The attribute
  // sits on this root and `.sc-app` on the app area INSIDE it, so the app's own
  // light remap (`[data-sc-theme="light"] .sc-app …`) applies even for a visitor
  // whose saved theme is dark — the browser chrome stays outside `.sc-app` and
  // is light too (owner, 2026-09-17: only the site header and footer stay dark).
  return (
    <div data-sc-theme="light" className="w-full rounded-[var(--rd-r-xl)] border border-slate-200 bg-white shadow-[0_30px_70px_-40px_rgba(11,16,34,0.45)] overflow-hidden">
      {/* browser chrome */}
      <div className="flex items-center gap-2 px-4 h-11 border-b border-slate-200 bg-[#F5F7FB]">
        <span className="w-3 h-3 rounded-full bg-[#ff5f57]" /><span className="w-3 h-3 rounded-full bg-[#febc2e]" /><span className="w-3 h-3 rounded-full bg-[#28c840]" />
        <div className="ml-3 flex-1 max-w-[280px] h-6 rounded-md bg-white border border-slate-200 flex items-center px-3 gap-1.5">
          <svg viewBox="0 0 24 24" className="w-3 h-3 text-slate-400" fill="none" stroke="currentColor" strokeWidth={2}><rect x="4" y="10" width="16" height="10" rx="2" /><path d="M8 10V7a4 4 0 018 0v3" /></svg>
          <span className="text-slate-500 text-[0.6875rem]">swiftcard.me/office/admin{tab === "Team" ? "" : `/${tab.toLowerCase()}`}</span>
        </div>
      </div>

      <div className="sc-app @container relative bg-gray-950 text-white text-left">
        <div className="h-0.5 bg-gradient-to-r from-purple-600 via-violet-500 to-blue-400" />
        {/* The admin header — layout.tsx */}
        <div className="bg-gray-950/90 border-b border-gray-800/80 px-5">
          <div className="flex items-center justify-between h-12">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-[0.625rem] font-bold tracking-[0.25em] text-slate-500 uppercase shrink-0">SwiftCard</span>
              <span className="text-xs font-bold bg-purple-600/20 border border-purple-500/30 text-purple-300 px-2 py-0.5 rounded-full shrink-0">Admin</span>
              <span className="text-xs text-gray-500 truncate hidden @xl:block">{COMPANY}</span>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <span className="text-xs text-gray-500">← My dashboard</span>
              <span className="relative p-1.5 text-gray-400" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
                </svg>
                <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-purple-500 text-white text-[0.5625rem] font-bold rounded-full flex items-center justify-center">2</span>
              </span>
            </div>
          </div>
          <nav className="flex gap-1 -mb-px overflow-x-auto rd-scrollbar-none">
            {TABS.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => pick(t)}
                aria-current={tab === t ? "page" : undefined}
                className={`px-3 py-2 text-[0.8125rem] font-medium whitespace-nowrap border-b-2 transition-colors ${
                  tab === t ? "border-purple-500 text-white" : "border-transparent text-gray-500 hover:text-gray-300"
                }`}
              >
                {t}
              </button>
            ))}
          </nav>
        </div>

        {/* The page scrolls inside the window, like the real console under its
            sticky header — one steady height for every tab. */}
        <div ref={scrollRef} className="@container h-[780px] overflow-y-auto">
          <div className="px-5 pt-6 pb-10">
            {tab === "Team" && <TeamTab />}
            {tab === "Analytics" && <AnalyticsTab />}
            {tab === "Leads" && <LeadsTab />}
            {tab === "Branding" && <BrandingTab />}
          </div>
        </div>
      </div>
    </div>
  );
}
