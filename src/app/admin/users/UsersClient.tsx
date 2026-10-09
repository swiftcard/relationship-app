"use client";

// Users directory: search + plan filter, per-user plan editor, cards/leads/views
// counts, signup source — click any row to drill into that user.

import { useState, useEffect, useCallback } from "react";
import { getSignupSourceLabel } from "@/lib/source-labels";
import { useRouter } from "next/navigation";
import { META } from "@/lib/template-style-presets";

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
      <p className="text-xs text-gray-400 mb-1">{label}</p>
      <div className="flex flex-wrap items-center gap-1.5">
        {presets.map((c) => (
          <button key={c} type="button" aria-label={`${label} ${c}`} aria-pressed={value === c}
            onClick={() => onPick(c)}
            className="w-7 h-7 rounded-lg border border-gray-700"
            style={{ background: c, boxShadow: value === c ? "0 0 0 2px #111827, 0 0 0 4px #3b82f6" : undefined }} />
        ))}
        <input type="color" aria-label={`${label}: any color`} value={/^#[0-9a-f]{6}$/i.test(value) ? value : fallback}
          onChange={(e) => onPick(e.target.value)}
          className="w-9 h-7 rounded-lg border border-gray-700 bg-gray-800 cursor-pointer p-0.5" />
        <button type="button" onClick={() => onPick("")} aria-pressed={value === ""}
          className={`text-xs font-semibold px-2.5 py-1 rounded-lg border ${value === "" ? "bg-blue-600 border-blue-600 text-white" : "border-gray-700 text-gray-400"}`}>
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

const PLAN_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  free:       { bg: "#1f2937", text: "#9ca3af", label: "Free" },
  pro:        { bg: "#1e3a5f", text: "#60a5fa", label: "Pro" },
  enterprise: { bg: "#3b0764", text: "#c084fc", label: "Office" },
};

function PlanBadge({ plan, expires, userId, onUpdated }: { plan: string; expires: string | null; userId: string; onUpdated: () => void }) {
  const [saving, setSaving] = useState(false);
  const cfg = PLAN_STYLES[plan] ?? PLAN_STYLES.free;

  async function setPlan(next: string) {
    setSaving(true);
    await fetch("/api/admin/set-plan", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, plan: next }),
    });
    setSaving(false);
    onUpdated();
  }

  return (
    <div onClick={(e) => e.stopPropagation()} className="flex items-center gap-1.5">
      <span className="text-[0.625rem] font-bold px-2 py-0.5 rounded-full" style={{ background: cfg.bg, color: cfg.text }}>
        {cfg.label}
      </span>
      {expires && <span className="text-[0.5625rem] text-amber-400" title={`Free month until ${new Date(expires).toLocaleDateString()}`}>⏳</span>}
      <select
        value={plan}
        onChange={(e) => setPlan(e.target.value)}
        disabled={saving}
        className="text-[0.625rem] bg-gray-800 border border-gray-700 text-gray-400 rounded-lg px-1.5 py-0.5 focus:outline-none disabled:opacity-40"
      >
        <option value="free">Free</option>
        <option value="pro">Pro</option>
        <option value="enterprise">Office</option>
      </select>
    </div>
  );
}

export default function UsersClient() {
  const router = useRouter();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [planFilter, setPlanFilter] = useState<"all" | "free" | "pro" | "enterprise">("all");
  const [sort, setSort] = useState<"joined" | "leads" | "views" | "cards">("joined");
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createResult, setCreateResult] = useState<{ cardUrl?: string; error?: string } | null>(null);
  const [form, setForm] = useState({ name: "", email: "", company: "", title: "", phone: "", username: "", plan: "pro", template: "classic-pro", accentColor: "#2563eb", photoShape: "original", surfaceColor: "", titleColor: "", companyColor: "" });

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/admin/users");
    if (res.ok) {
      const data = await res.json();
      setUsers(data.users ?? []);
    }
    setLoading(false);
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time data fetch on mount
  useEffect(() => { load(); }, [load]);

  const filtered = users
    .filter((u) => planFilter === "all" || (planFilter === "free" ? (u.plan === "free" || !u.plan) : u.plan === planFilter))
    .filter((u) =>
      !search ||
      u.name?.toLowerCase().includes(search.toLowerCase()) ||
      u.email?.toLowerCase().includes(search.toLowerCase()) ||
      u.username?.toLowerCase().includes(search.toLowerCase()) ||
      u.company?.toLowerCase().includes(search.toLowerCase())
    )
    .sort((a, b) => {
      if (sort === "leads") return b.lead_count - a.lead_count;
      if (sort === "views") return b.view_count - a.view_count;
      if (sort === "cards") return b.card_count - a.card_count;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });

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
        setCreateResult({ cardUrl: data.cardUrl });
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

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Users</h1>
          <p className="text-gray-500 text-sm mt-1">Every account — click a user to see everything about them.</p>
        </div>
        <div className="flex items-center gap-2">
          {/* Full directory as CSV (plan, source, cards, leads, views) — a file
              download, not a page nav, so a plain <a> is correct here. */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a
            href="/api/admin/users/export"
            className="border border-gray-700 hover:border-gray-500 text-gray-300 hover:text-white text-sm font-semibold px-4 py-2 rounded-xl transition-colors"
          >
            Export CSV
          </a>
          <button
            onClick={() => { setShowCreate(true); setCreateResult(null); }}
            className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-4 py-2 rounded-xl transition-colors"
          >
            + Create card for business
          </button>
        </div>
      </div>

      {/* Plan filter chips */}
      <div className="flex items-center gap-2 flex-wrap">
        {([["all", `All · ${counts.all}`], ["free", `Free · ${counts.free}`], ["pro", `Pro · ${counts.pro}`], ["enterprise", `Office · ${counts.enterprise}`]] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setPlanFilter(key)}
            className={`text-xs font-semibold px-3 py-1.5 rounded-full border transition-colors ${
              planFilter === key ? "bg-blue-600 border-blue-600 text-white" : "bg-gray-900 border-gray-700 text-gray-400 hover:border-gray-500"
            }`}
          >
            {label}
          </button>
        ))}
        <div className="flex-1" />
        <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}
          className="text-xs bg-gray-900 border border-gray-700 text-gray-400 rounded-xl px-2.5 py-1.5 focus:outline-none">
          <option value="joined">Newest first</option>
          <option value="leads">Most contacts</option>
          <option value="views">Most views</option>
          <option value="cards">Most cards</option>
        </select>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name, email, company…"
          className="bg-gray-900 border border-gray-700 text-white placeholder-gray-600 rounded-xl px-3 py-1.5 text-sm focus:outline-none focus:border-blue-500 w-full sm:w-64"
        />
      </div>

      {/* Table */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
        {loading ? (
          <div className="px-5 py-10 text-center text-gray-500 text-sm">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="px-5 py-10 text-center text-gray-500 text-sm">No users found</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800 text-gray-500 text-xs">
                  <th className="text-left px-5 py-3 font-medium">User</th>
                  <th className="text-left px-4 py-3 font-medium">Plan</th>
                  <th className="text-left px-4 py-3 font-medium">Cards</th>
                  <th className="text-left px-4 py-3 font-medium">Contacts</th>
                  <th className="text-left px-4 py-3 font-medium">Views</th>
                  <th className="text-left px-4 py-3 font-medium">Source</th>
                  <th className="text-left px-4 py-3 font-medium">Joined</th>
                  <th className="text-left px-4 py-3 font-medium">Open</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800/60">
                {filtered.map((u) => (
                  <tr
                    key={u.id}
                    onClick={() => router.push(`/admin/users/${u.id}`)}
                    className="hover:bg-gray-800/40 transition-colors cursor-pointer"
                  >
                    <td className="px-5 py-3">
                      <p className="text-white font-medium text-xs truncate max-w-[180px]">{u.name || "—"}</p>
                      <p className="text-gray-500 text-[0.6875rem] truncate max-w-[180px]">{u.email}</p>
                      <p className="text-gray-600 text-[0.625rem]">/{u.username}{u.company ? ` · ${u.company}` : ""}</p>
                    </td>
                    <td className="px-4 py-3">
                      <PlanBadge plan={u.plan} expires={u.plan_expires_at} userId={u.id} onUpdated={load} />
                    </td>
                    <td className="px-4 py-3 text-white font-semibold tabular-nums">{u.card_count}</td>
                    <td className="px-4 py-3 text-white font-semibold tabular-nums">{u.lead_count}</td>
                    <td className="px-4 py-3 text-gray-400 tabular-nums">{u.view_count}</td>
                    <td className="px-4 py-3">
                      <span className="text-[0.625rem] text-gray-400 bg-gray-800 px-2 py-0.5 rounded-full" title={getSignupSourceLabel(u.signup_source)}>
                        {getSignupSourceLabel(u.signup_source)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-[0.6875rem]">
                      {new Date(u.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" })}
                    </td>
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      {u.primary_username ? (
                        <div className="flex items-center gap-2 text-[0.6875rem] whitespace-nowrap">
                          <a href={`/${u.primary_username}`} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300">Card ↗</a>
                          <a href={`/links/${u.primary_username}`} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300">Links ↗</a>
                        </div>
                      ) : (
                        <span className="text-gray-600 text-[0.625rem]">no card yet</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Create card modal */}
      {showCreate && (
        <div className="fixed inset-0 z-40 bg-black/70 flex items-center justify-center px-4" onClick={(e) => e.target === e.currentTarget && setShowCreate(false)}>
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 w-full max-w-md shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-white font-bold text-lg">Create card for business</h2>
              <button onClick={() => setShowCreate(false)} className="text-gray-500 hover:text-white transition-colors">✕</button>
            </div>

            {createResult?.cardUrl ? (
              <div className="text-center py-4">
                <div className="w-10 h-10 bg-green-900/40 rounded-full flex items-center justify-center mx-auto mb-3">
                  <svg className="w-5 h-5 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <p className="text-white font-semibold mb-1">Card created!</p>
                <a href={createResult.cardUrl} target="_blank" rel="noopener noreferrer" className="text-blue-400 text-sm underline break-all">
                  {createResult.cardUrl}
                </a>
                <p className="text-gray-500 text-xs mt-3">A password reset email was sent so the business owner can log in.</p>
                <button
                  onClick={() => { setShowCreate(false); setCreateResult(null); }}
                  className="mt-4 w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 rounded-xl text-sm transition-colors"
                >
                  Done
                </button>
              </div>
            ) : (
              <form onSubmit={createCard} className="space-y-3">
                {createResult?.error && (
                  <p className="text-red-400 text-sm bg-red-950/40 border border-red-800/40 rounded-xl px-3 py-2">{createResult.error}</p>
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
                    <label className="text-xs text-gray-400 block mb-1">{label}</label>
                    <input
                      type={type}
                      value={form[key as keyof typeof form]}
                      onChange={(e) => setForm((p) => ({ ...p, [key]: e.target.value }))}
                      placeholder={placeholder}
                      required={["name", "email", "username"].includes(key)}
                      className="w-full bg-gray-800 border border-gray-700 text-white placeholder-gray-600 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-blue-500 transition-colors"
                    />
                  </div>
                ))}
                <div>
                  <label className="text-xs text-gray-400 block mb-1">Plan</label>
                  <select value={form.plan} onChange={(e) => setForm((p) => ({ ...p, plan: e.target.value }))}
                    className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-blue-500">
                    <option value="free">Free</option>
                    <option value="pro">Pro</option>
                    <option value="enterprise">Office</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-400 block mb-1">Card template</label>
                  <select value={form.template} onChange={(e) => setForm((p) => ({ ...p, template: e.target.value }))}
                    className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-blue-500">
                    <option value="classic-pro">Classic Pro</option>
                    <option value="modern-bold">Modern Bold</option>
                    <option value="photo-first">Photo First</option>
                    <option value="local-business">Local Business</option>
                    <option value="luxury-minimal">Luxury Minimal</option>
                    <option value="logo-first">Logo First</option>
                  </select>
                </div>
                {/* Photo First's Photo shape — the same choice as the card
                    editor's Photo shape step: Original fills the left panel,
                    Circle sits the photo on a panel colour picked here. */}
                {form.template === "photo-first" && (
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">Photo</label>
                    <select value={form.photoShape} onChange={(e) => setForm((p) => ({ ...p, photoShape: e.target.value }))}
                      className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-blue-500">
                      <option value="original">Original — fills the photo panel</option>
                      <option value="circle">Circle — on a panel color</option>
                    </select>
                    {form.photoShape === "circle" && (
                      <div className="mt-2">
                        <p className="text-xs text-gray-400 mb-1">Color behind the photo</p>
                        <div className="flex flex-wrap items-center gap-1.5">
                          {PHOTO_PANEL.presets.map((c) => (
                            <button key={c} type="button" aria-label="Color preset" aria-pressed={form.surfaceColor === c}
                              onClick={() => setForm((p) => ({ ...p, surfaceColor: c }))}
                              className="w-7 h-7 rounded-lg border border-gray-700"
                              style={{ background: c, boxShadow: form.surfaceColor === c ? "0 0 0 2px #111827, 0 0 0 4px #3b82f6" : undefined }} />
                          ))}
                          <input type="color" aria-label="Any color" value={/^#[0-9a-f]{6}$/i.test(form.surfaceColor) ? form.surfaceColor : "#4f46e5"}
                            onChange={(e) => setForm((p) => ({ ...p, surfaceColor: e.target.value }))}
                            className="w-9 h-7 rounded-lg border border-gray-700 bg-gray-800 cursor-pointer p-0.5" />
                          <button type="button" onClick={() => setForm((p) => ({ ...p, surfaceColor: "" }))}
                            className={`text-xs font-semibold px-2.5 py-1 rounded-lg border ${form.surfaceColor === "" ? "bg-blue-600 border-blue-600 text-white" : "border-gray-700 text-gray-400"}`}>
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
                  <label className="text-xs text-gray-400 block mb-1">Accent color</label>
                  <div className="flex items-center gap-3">
                    <input type="color" value={form.accentColor} onChange={(e) => setForm((p) => ({ ...p, accentColor: e.target.value }))}
                      className="w-10 h-9 rounded-lg border border-gray-700 bg-gray-800 cursor-pointer p-0.5" />
                    <span className="text-gray-400 text-xs font-mono">{form.accentColor}</span>
                  </div>
                </div>
                <button type="submit" disabled={creating}
                  className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold py-2.5 rounded-xl text-sm transition-colors mt-2">
                  {creating ? "Creating…" : "Create card"}
                </button>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
