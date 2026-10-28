"use client";

// Users directory: tabs (All · Free · Pro · Office · Closed accounts), search,
// sort, per-user plan editor, cards/contacts/views, signup source — click any
// row to see everything about that user. Closed accounts list why each person
// left, in their own words (owner, 2026-10-27).
//
// ONE list in the markup, laid out as a table on a wide screen and as stacked
// rows on a phone — never two copies, so there is exactly one plan dropdown
// per person (tests/render/admin-safety drives it at phone width).

import { useState, useEffect, useCallback } from "react";
import { getSignupSourceLabel } from "@/lib/source-labels";
import { useRouter } from "next/navigation";
import { META } from "@/lib/template-style-presets";
import { isPaidPlan } from "@/lib/plan";
import { adminErrorText, planChangeWarning } from "@/lib/admin-confirm";
import { PageHeader, Stack, KpiCard, KpiGrid } from "../_ui/layout";
import { TabButtons } from "../_ui/TabButtons";
import { Avatar, ClosedBadge, FreeMonthBadge, PlanBadge } from "../_ui/badges";
import { EmptyState } from "../_ui/states";
import { Icon } from "../_ui/icons";
import { fmtDate, fmtNum } from "../_ui/format";

// Photo First's photo-panel swatches — the same ones the card editor offers.
const PHOTO_PANEL = META["photo-first"].surface!;

/**
 * Title color / Company color for a card made here — the same per-template
 * swatches as the card editor's steps (owner, 2026-10-09: the job title and
 * the company each get their own colour, everywhere a card is designed).
 * "" is Default: the template's own colour for that line.
 */
function LineColorRow({ label, presets, value, fallback, onPick }: {
  label: string; presets: string[]; value: string; fallback: string; onPick: (v: string) => void;
}) {
  return (
    <div>
      <p className="sc-field-label">{label}</p>
      <div className="flex flex-wrap items-center gap-1.5">
        {presets.map((c) => (
          <button key={c} type="button" aria-label={`${label} ${c}`} aria-pressed={value === c}
            onClick={() => onPick(c)}
            className="w-8 h-8 rounded-lg"
            style={{ background: c, boxShadow: value === c ? "0 0 0 2px var(--sc-bg-elevated), 0 0 0 4px var(--sc-tint)" : "inset 0 0 0 1px var(--sc-separator)" }} />
        ))}
        <input type="color" aria-label={`${label}: any color`} value={/^#[0-9a-f]{6}$/i.test(value) ? value : fallback}
          onChange={(e) => onPick(e.target.value)}
          className="w-10 h-8 rounded-lg cursor-pointer p-0.5" style={{ background: "var(--sc-fill)" }} />
        <button type="button" onClick={() => onPick("")} aria-pressed={value === ""}
          className={`sc-btn sc-btn-xs ${value === "" ? "sc-btn-filled" : "sc-btn-gray"}`}>
          Default
        </button>
      </div>
    </div>
  );
}

type User = {
  id: string;
  username: string;
  primary_username: string | null;
  name: string;
  email: string;
  plan: string;
  plan_expires_at: string | null;
  signup_source: string | null;
  company: string | null;
  title: string | null;
  created_at: string;
  card_count: number;
  lead_count: number;
  view_count: number;
};

/** A closed account, from /api/admin/users `closed`. */
type ClosedAccount = {
  id: string;
  name: string | null;
  email: string | null;
  plan: string | null;
  closed_at: string | null;
  reason: string | null;
  reason_text: string;
  comment: string | null;
  purge_at: string | null;
};

type TabKey = "all" | "free" | "pro" | "office" | "closed";
const TAB_KEYS: TabKey[] = ["all", "free", "pro", "office", "closed"];

function PlanBadgeEditor({ plan, expires, userId, who, onUpdated }: { plan: string; expires: string | null; userId: string; who: string; onUpdated: () => void }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Asks first, and says what failed (audit F-ADMIN-01): this dropdown used to
  // change a plan on the first click and ignore every refusal.
  async function setPlan(next: string) {
    if (next === plan || !window.confirm(planChangeWarning(who, plan, next))) return;
    setSaving(true);
    setError(null);
    let changed = false;
    try {
      const res = await fetch("/api/admin/set-plan", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, plan: next }),
      });
      if (res.ok) changed = true;
      else setError(await adminErrorText(res));
    } catch {
      setError("Couldn't reach the server. Nothing was changed.");
    } finally {
      setSaving(false);
    }
    // Reload only when something changed: the reload redraws the list, which
    // would wipe the refusal off the screen before it could be read.
    if (changed) onUpdated();
  }

  return (
    <div onClick={(e) => e.stopPropagation()} className="min-w-0">
      <div className="flex items-center gap-2">
        <PlanBadge plan={plan} />
        {/* The plan shows once, as the badge; "Change" is the real <select>
            laid invisibly over its label, so it opens the platform's own
            picker (and works with a keyboard and a screen reader). */}
        <label className="relative inline-flex items-center gap-0.5 min-h-[32px] px-1.5 -mx-1.5 rounded-md sc-t-caption adm-link cursor-pointer">
          {saving ? "Saving…" : "Change"}
          <svg viewBox="0 0 12 8" className="w-2.5 h-2" aria-hidden><path d="M1 1.5l5 5 5-5" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" /></svg>
          <select
            value={plan}
            onChange={(e) => setPlan(e.target.value)}
            disabled={saving}
            aria-label={`Change ${who}'s plan`}
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-default"
          >
            <option value="free">Free</option>
            <option value="pro">Pro</option>
            <option value="enterprise">Office</option>
          </select>
        </label>
      </div>
      {expires && <div className="mt-1"><FreeMonthBadge until={expires} /></div>}
      {error && <p role="alert" className="sc-t-caption adm-bad mt-1 max-w-[16rem]">{error}</p>}
    </div>
  );
}

const inputCls = "sc-field w-full px-3.5 py-2.5";

export default function UsersClient({ initialTab, openCreate = false }: { initialTab?: string; openCreate?: boolean } = {}) {
  const router = useRouter();
  const [users, setUsers] = useState<User[]>([]);
  const [closed, setClosed] = useState<ClosedAccount[]>([]);
  // When the list was loaded — the "now" that "closed 3 days ago" and
  // "deleted in 27 days" are measured from (read once, not on every render).
  const [loadedAt, setLoadedAt] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<TabKey>(TAB_KEYS.includes(initialTab as TabKey) ? (initialTab as TabKey) : "all");
  const [sort, setSort] = useState<"joined" | "leads" | "views" | "cards">("joined");
  const [showCreate, setShowCreate] = useState(openCreate);
  const [creating, setCreating] = useState(false);
  const [createResult, setCreateResult] = useState<{ cardUrl?: string; error?: string; loginEmailed?: boolean; setupLink?: string | null } | null>(null);
  const [form, setForm] = useState({ name: "", email: "", company: "", title: "", phone: "", username: "", plan: "pro", template: "classic-pro", accentColor: "#2563eb", photoShape: "original", surfaceColor: "", titleColor: "", companyColor: "" });

  // A refusal or a dropped connection says so (audit F-ADMIN-05): it used to
  // read "No users found", or sit on "Loading…" forever when fetch threw.
  const [loadError, setLoadError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/users");
      if (res.ok) {
        const data = await res.json();
        setUsers(data.users ?? []);
        setClosed(data.closed ?? []);
        setLoadedAt(Date.now());
        setLoadError(null);
      } else {
        setLoadError(await adminErrorText(res));
      }
    } catch {
      setLoadError("Couldn't reach the server.");
    } finally {
      setLoading(false);
    }
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time data fetch on mount
  useEffect(() => { load(); }, [load]);

  // Escape closes the Create card sheet.
  useEffect(() => {
    if (!showCreate) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setShowCreate(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showCreate]);

  // The tab lives in the address too, so a reload or a shared link opens the
  // same list. replaceState: switching tabs never refetches.
  function selectTab(key: string) {
    const next = key as TabKey;
    setTab(next);
    try { window.history.replaceState(null, "", next === "all" ? "/admin/users" : `/admin/users?tab=${next}`); } catch { /* not in a browser that allows it */ }
  }

  const q = search.trim().toLowerCase();
  const matches = (...fields: (string | null | undefined)[]) => !q || fields.some((f) => f?.toLowerCase().includes(q));

  const filtered = users
    .filter((u) => tab === "all" || tab === "closed" || (tab === "free" ? (u.plan === "free" || !u.plan) : tab === "pro" ? u.plan === "pro" : u.plan === "enterprise"))
    .filter((u) => matches(u.name, u.email, u.username, u.company, u.primary_username))
    .sort((a, b) => {
      if (sort === "leads") return b.lead_count - a.lead_count;
      if (sort === "views") return b.view_count - a.view_count;
      if (sort === "cards") return b.card_count - a.card_count;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });

  const closedShown = closed
    .filter((c) => matches(c.name, c.email, c.reason_text, c.comment))
    .sort((a, b) => String(b.closed_at ?? "").localeCompare(String(a.closed_at ?? "")));

  const counts = {
    all: users.length,
    free: users.filter((u) => u.plan === "free" || !u.plan).length,
    pro: users.filter((u) => u.plan === "pro").length,
    enterprise: users.filter((u) => u.plan === "enterprise").length,
  };

  async function createCard(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setCreateResult(null);
    try {
      const res = await fetch("/api/admin/create-card", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (res.ok) {
        setCreateResult({ cardUrl: data.cardUrl, loginEmailed: data.loginEmailed !== false, setupLink: data.setupLink ?? null });
        setForm({ name: "", email: "", company: "", title: "", phone: "", username: "", plan: "pro", template: "classic-pro", accentColor: "#2563eb", photoShape: "original", surfaceColor: "", titleColor: "", companyColor: "" });
        load();
      } else {
        setCreateResult({ error: data.error });
      }
    } catch {
      setCreateResult({ error: "Network error — please try again." });
    } finally {
      setCreating(false);
    }
  }

  const shown = tab === "closed" ? closedShown.length : filtered.length;
  const of = tab === "closed" ? closed.length : tab === "all" ? counts.all : tab === "free" ? counts.free : tab === "pro" ? counts.pro : counts.enterprise;

  return (
    <Stack>
      <PageHeader
        title="Users"
        description="Every account. Click anyone to see everything about them."
        actions={
          <>
            {/* Full directory as CSV (plan, source, cards, leads, views) — a file
                download, not a page nav, so a plain <a> is correct here. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a href="/api/admin/users/export" className="sc-btn sc-btn-gray sc-btn-sm">
              <Icon name="download" className="w-4 h-4" />
              Export CSV
            </a>
            <button
              onClick={() => { setShowCreate(true); setCreateResult(null); }}
              className="sc-btn sc-btn-filled sc-btn-sm"
            >
              + Create card for business
            </button>
          </>
        }
      />

      <div className="space-y-4">
        <TabButtons
          label="Which accounts"
          active={tab}
          onSelect={selectTab}
          items={[
            { key: "all", label: "All", count: loading ? null : counts.all },
            { key: "free", label: "Free", count: loading ? null : counts.free },
            { key: "pro", label: "Pro", count: loading ? null : counts.pro },
            { key: "office", label: "Office", count: loading ? null : counts.enterprise },
            { key: "closed", label: "Closed accounts", count: loading ? null : closed.length },
          ]}
        />

        {/* Toolbar: search, sort, how many are showing. */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-2.5">
          <div className="relative flex-1 min-w-0 sm:max-w-sm">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={tab === "closed" ? "Search name, email, reason…" : "Search name, email, company, card link…"}
              aria-label="Search users"
              className="sc-field w-full px-3.5"
            />
          </div>
          {tab !== "closed" && (
            <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} aria-label="Sort users"
              className="sc-field w-full sm:w-auto pl-3.5">
              <option value="joined">Newest first</option>
              <option value="leads">Most contacts</option>
              <option value="views">Most views</option>
              <option value="cards">Most cards</option>
            </select>
          )}
          {!loading && !loadError && (
            <p className="sc-t-footnote adm-muted sm:ml-auto adm-num">Showing {fmtNum(shown)} of {fmtNum(of)}</p>
          )}
        </div>
      </div>

      {tab === "closed" && !loading && closed.length > 0 && <ClosedSummary closed={closed} now={loadedAt} />}

      <div className="adm-card overflow-hidden">
        {loading ? (
          <div className="px-5 py-10 text-center adm-muted sc-t-subhead">Loading…</div>
        ) : loadError && users.length === 0 ? (
          <div role="alert" className="px-5 py-10 text-center sc-t-subhead">
            <p className="adm-bad">Couldn&apos;t load users — {loadError}</p>
            <button onClick={load} className="sc-btn sc-btn-tinted sc-btn-sm mt-3">Try again</button>
          </div>
        ) : tab === "closed" ? (
          closedShown.length === 0 ? (
            <EmptyState className="py-10">{closed.length === 0 ? "No one has closed their account." : "No closed accounts match that search."}</EmptyState>
          ) : (
            <ul className="adm-divide">
              {closedShown.map((c) => (
                <li key={c.id}>
                  <button type="button" onClick={() => router.push(`/admin/users/${c.id}`)} className="adm-list-row w-full text-left px-4 sm:px-5 py-4 flex gap-3">
                    <Avatar name={c.name || c.email} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="sc-t-subhead font-semibold truncate max-w-full">{c.name || c.email || "Unnamed account"}</span>
                        <ClosedBadge />
                        <span className="sc-t-caption adm-muted">had</span>
                        <PlanBadge plan={c.plan} />
                      </div>
                      {c.name && c.email && <p className="sc-t-caption adm-muted truncate">{c.email}</p>}
                      <p className="sc-t-subhead mt-2"><span className="adm-muted">Why: </span>{c.reason_text}</p>
                      {c.comment && <p className="sc-t-subhead mt-1 adm-clamp-2 break-words">“{c.comment}”</p>}
                      <p className="sc-t-caption adm-muted mt-2 adm-num">
                        Closed {fmtDate(c.closed_at)}
                        {c.purge_at && <> · {purgeText(c.purge_at, loadedAt)}</>}
                      </p>
                    </div>
                    <Icon name="chevron" className="w-4 h-4 adm-muted shrink-0 self-center" />
                  </button>
                </li>
              ))}
            </ul>
          )
        ) : filtered.length === 0 ? (
          <EmptyState className="py-10">{users.length === 0 ? "No users yet." : "No users found"}</EmptyState>
        ) : (
          <>
            {/* Column headings — only where the rows are laid out as a table. */}
            <div aria-hidden className="hidden xl:grid adm-user-grid px-5 py-2.5 sc-t-footnote font-semibold adm-muted" style={{ boxShadow: "inset 0 -1px 0 var(--adm-grid)" }}>
              <span>User</span><span>Plan</span><span className="text-right">Cards</span><span className="text-right">Contacts</span><span className="text-right">Views</span><span>Found us via</span><span>Joined</span><span>Open</span>
            </div>
            <ul className="adm-divide">
              {filtered.map((u) => (
                <li
                  key={u.id}
                  onClick={() => router.push(`/admin/users/${u.id}`)}
                  className="adm-list-row cursor-pointer px-4 xl:px-5 py-3.5 xl:grid adm-user-grid xl:items-center gap-y-2"
                >
                  {/* User */}
                  <div className="flex items-center gap-3 min-w-0">
                    <Avatar name={u.name || u.email} />
                    <div className="min-w-0">
                      <p className="sc-t-subhead font-semibold truncate">{u.name || "—"}</p>
                      <p className="sc-t-caption adm-muted truncate">{u.email}</p>
                      <p className="sc-t-caption adm-faint truncate">/{u.username}{u.company ? ` · ${u.company}` : ""}</p>
                    </div>
                  </div>
                  {/* Plan */}
                  <div className="mt-2.5 xl:mt-0">
                    <PlanBadgeEditor plan={u.plan} expires={u.plan_expires_at} userId={u.id} who={u.email || u.name || "this user"} onUpdated={load} />
                  </div>
                  {/* Numbers: one line on a phone, three columns on a computer. */}
                  <p className="xl:hidden sc-t-footnote adm-muted mt-2 adm-num">
                    {fmtNum(u.card_count)} {u.card_count === 1 ? "card" : "cards"} · {fmtNum(u.lead_count)} contacts · {fmtNum(u.view_count)} views · via {getSignupSourceLabel(u.signup_source)} · joined {fmtDate(u.created_at)}
                  </p>
                  <span className="hidden xl:block text-right sc-t-subhead font-semibold adm-num">{fmtNum(u.card_count)}</span>
                  <span className="hidden xl:block text-right sc-t-subhead font-semibold adm-num">{fmtNum(u.lead_count)}</span>
                  <span className="hidden xl:block text-right sc-t-subhead adm-num">{fmtNum(u.view_count)}</span>
                  <span className="hidden xl:block min-w-0"><span className="sc-badge max-w-full truncate" title={getSignupSourceLabel(u.signup_source)}>{getSignupSourceLabel(u.signup_source)}</span></span>
                  <span className="hidden xl:block sc-t-footnote adm-muted adm-num">{fmtDate(u.created_at)}</span>
                  {/* Open */}
                  <div className="mt-2 xl:mt-0" onClick={(e) => e.stopPropagation()}>
                    {u.primary_username ? (
                      <div className="flex items-center gap-3 sc-t-footnote whitespace-nowrap">
                        <a href={`/${u.primary_username}`} target="_blank" rel="noopener noreferrer" className="adm-link">Card ↗</a>
                        <a href={`/links/${u.primary_username}`} target="_blank" rel="noopener noreferrer" className="adm-link">Links ↗</a>
                      </div>
                    ) : (
                      <span className="sc-t-caption adm-faint">No card yet</span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      {tab === "closed" && (
        <p className="sc-t-footnote adm-muted">
          A closed account is kept for 30 days so the person can reopen it, then it&apos;s permanently deleted — and this record goes with it. Keeping the reason after that is part of the data pass.
        </p>
      )}

      {/* Create card sheet */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:px-4" style={{ background: "var(--sc-scrim)" }} onClick={(e) => e.target === e.currentTarget && setShowCreate(false)}>
          <div role="dialog" aria-modal="true" aria-label="Create card for business"
            className="w-full sm:max-w-lg max-h-[92vh] overflow-y-auto p-5 sm:p-6"
            style={{ background: "var(--sc-bg-elevated)", borderRadius: "var(--sc-r-sheet) var(--sc-r-sheet) 0 0", boxShadow: "var(--sc-shadow-sheet)" }}>
            <div className="flex items-center justify-between mb-5">
              <h2 className="sc-t-title3">Create card for business</h2>
              <button onClick={() => setShowCreate(false)} aria-label="Close" className="sc-btn sc-btn-icon sc-btn-sm">
                <Icon name="close" className="w-4 h-4" />
              </button>
            </div>

            {createResult?.cardUrl ? (
              <div className="text-center py-2">
                <span className="adm-good inline-flex"><Icon name="check" className="w-10 h-10" /></span>
                <p className="sc-t-headline mt-2">Card created!</p>
                <a href={createResult.cardUrl} target="_blank" rel="noopener noreferrer" className="adm-link sc-t-subhead break-all">
                  {createResult.cardUrl}
                </a>
                {/* What actually happened (audit F-ADMIN-04): it always said the
                    email went, even when it didn't — and the business owner had
                    no way in, and no one knew. */}
                {createResult.loginEmailed ? (
                  <p className="adm-muted sc-t-footnote mt-3">A password reset email was sent so the business owner can log in.</p>
                ) : (
                  <div className="mt-4 text-left adm-callout-warn p-3.5">
                    <p className="sc-t-footnote mb-2">The login email couldn&apos;t be sent. Send the business owner this link to set their password:</p>
                    {createResult.setupLink ? (
                      <div className="flex items-center gap-2">
                        <input readOnly value={createResult.setupLink} className="sc-field sc-field-fit flex-1 min-w-0 h-9 px-3 text-xs" />
                        <button type="button" onClick={() => navigator.clipboard?.writeText(createResult.setupLink ?? "").catch(() => {})} className="sc-btn sc-btn-gray sc-btn-xs">Copy</button>
                      </div>
                    ) : (
                      <p className="adm-muted sc-t-footnote">No link could be made either — they can use “Forgot password” on the sign-in page.</p>
                    )}
                  </div>
                )}
                <button
                  onClick={() => { setShowCreate(false); setCreateResult(null); }}
                  className="sc-btn sc-btn-filled sc-btn-block mt-5"
                >
                  Done
                </button>
              </div>
            ) : (
              <form method="post" onSubmit={createCard} className="space-y-3.5">
                {createResult?.error && (
                  <p role="alert" className="adm-callout-danger px-3.5 py-2.5 sc-t-subhead">{createResult.error}</p>
                )}
                {[
                  { key: "name", label: "Full name *", placeholder: "Jane Smith", type: "text" },
                  { key: "email", label: "Email *", placeholder: "jane@company.com", type: "email" },
                  { key: "username", label: "Username (card URL slug) *", placeholder: "jane-smith", type: "text" },
                  { key: "company", label: "Company", placeholder: "Acme Corp", type: "text" },
                  { key: "title", label: "Title", placeholder: "CEO", type: "text" },
                  { key: "phone", label: "Phone", placeholder: "+1 (555) 000-0000", type: "tel" },
                ].map(({ key, label, placeholder, type }) => (
                  <div key={key}>
                    <label className="sc-field-label" htmlFor={`cc-${key}`}>{label}</label>
                    <input
                      id={`cc-${key}`}
                      type={type}
                      value={form[key as keyof typeof form]}
                      onChange={(e) => setForm((p) => ({ ...p, [key]: e.target.value }))}
                      placeholder={placeholder}
                      required={["name", "email", "username"].includes(key)}
                      className={inputCls}
                    />
                  </div>
                ))}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  <div>
                    <label className="sc-field-label" htmlFor="cc-plan">Plan</label>
                    <select id="cc-plan" value={form.plan} onChange={(e) => setForm((p) => ({ ...p, plan: e.target.value }))} className={inputCls}>
                      <option value="free">Free</option>
                      <option value="pro">Pro</option>
                      <option value="enterprise">Office</option>
                    </select>
                  </div>
                  <div>
                    <label className="sc-field-label" htmlFor="cc-template">Card template</label>
                    <select id="cc-template" value={form.template} onChange={(e) => setForm((p) => ({ ...p, template: e.target.value }))} className={inputCls}>
                      <option value="classic-pro">Classic Pro</option>
                      <option value="modern-bold">Modern Bold</option>
                      <option value="photo-first">Photo First</option>
                      <option value="local-business">Local Business</option>
                      <option value="luxury-minimal">Luxury Minimal</option>
                      <option value="logo-first">Logo First</option>
                    </select>
                  </div>
                </div>
                {/* Photo First's Photo shape — the same choice as the card
                    editor's Photo shape step: Original fills the left panel,
                    Circle sits the photo on a panel colour picked here. */}
                {form.template === "photo-first" && (
                  <div>
                    <label className="sc-field-label" htmlFor="cc-shape">Photo</label>
                    <select id="cc-shape" value={form.photoShape} onChange={(e) => setForm((p) => ({ ...p, photoShape: e.target.value }))} className={inputCls}>
                      <option value="original">Original — fills the photo panel</option>
                      <option value="circle">Circle — on a panel color</option>
                    </select>
                    {form.photoShape === "circle" && (
                      <div className="mt-2.5">
                        <p className="sc-field-label">Color behind the photo</p>
                        <div className="flex flex-wrap items-center gap-1.5">
                          {PHOTO_PANEL.presets.map((c) => (
                            <button key={c} type="button" aria-label="Color preset" aria-pressed={form.surfaceColor === c}
                              onClick={() => setForm((p) => ({ ...p, surfaceColor: c }))}
                              className="w-8 h-8 rounded-lg"
                              style={{ background: c, boxShadow: form.surfaceColor === c ? "0 0 0 2px var(--sc-bg-elevated), 0 0 0 4px var(--sc-tint)" : "inset 0 0 0 1px var(--sc-separator)" }} />
                          ))}
                          <input type="color" aria-label="Any color" value={/^#[0-9a-f]{6}$/i.test(form.surfaceColor) ? form.surfaceColor : "#4f46e5"}
                            onChange={(e) => setForm((p) => ({ ...p, surfaceColor: e.target.value }))}
                            className="w-10 h-8 rounded-lg cursor-pointer p-0.5" style={{ background: "var(--sc-fill)" }} />
                          <button type="button" onClick={() => setForm((p) => ({ ...p, surfaceColor: "" }))}
                            className={`sc-btn sc-btn-xs ${form.surfaceColor === "" ? "sc-btn-filled" : "sc-btn-gray"}`}>
                            Default
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
                {/* Title color and Company color, each its own — the swatches
                    follow the template picked above. */}
                <LineColorRow label="Title color" presets={(META[form.template] ?? META["classic-pro"]).title.presets}
                  fallback={(META[form.template] ?? META["classic-pro"]).title.fallback}
                  value={form.titleColor} onPick={(v) => setForm((p) => ({ ...p, titleColor: v }))} />
                <LineColorRow label="Company color" presets={(META[form.template] ?? META["classic-pro"]).company.presets}
                  fallback={(META[form.template] ?? META["classic-pro"]).company.fallback}
                  value={form.companyColor} onPick={(v) => setForm((p) => ({ ...p, companyColor: v }))} />
                <div>
                  <p className="sc-field-label">Accent color</p>
                  <div className="flex items-center gap-3">
                    <input type="color" aria-label="Accent color" value={form.accentColor} onChange={(e) => setForm((p) => ({ ...p, accentColor: e.target.value }))}
                      className="w-11 h-9 rounded-lg cursor-pointer p-0.5" style={{ background: "var(--sc-fill)" }} />
                    <span className="adm-muted sc-t-footnote font-mono">{form.accentColor}</span>
                  </div>
                </div>
                <button type="submit" disabled={creating} className="sc-btn sc-btn-filled sc-btn-block mt-2">
                  {creating ? "Creating…" : "Create card"}
                </button>
              </form>
            )}
          </div>
        </div>
      )}
    </Stack>
  );
}

function purgeText(purgeAt: string, now: number): string {
  const days = Math.max(0, Math.ceil((new Date(purgeAt).getTime() - now) / 86_400_000));
  return days === 0 ? "permanently deleted today" : `permanently deleted in ${days} ${days === 1 ? "day" : "days"}`;
}

/** Closed in the last 30 days · the most common reason · how many were paying. */
function ClosedSummary({ closed, now }: { closed: ClosedAccount[]; now: number }) {
  const since = now - 30 * 86_400_000;
  const recent = closed.filter((c) => c.closed_at && new Date(c.closed_at).getTime() >= since).length;
  const tally = new Map<string, number>();
  for (const c of closed) tally.set(c.reason_text, (tally.get(c.reason_text) ?? 0) + 1);
  const top = [...tally.entries()].sort((a, b) => b[1] - a[1])[0];
  const paid = closed.filter((c) => isPaidPlan(c.plan)).length;
  return (
    <KpiGrid cols={3}>
      <KpiCard label="Closed · last 30 days" value={fmtNum(recent)} sub={`${fmtNum(closed.length)} still in the 30-day window`} />
      <KpiCard label="Most common reason" value={top ? top[0] : "—"} compact sub={top ? `${top[1]} of ${closed.length}` : undefined} />
      <KpiCard label="Were on a paid plan" value={fmtNum(paid)} sub="Pro or Office when they closed" />
    </KpiGrid>
  );
}
