"use client";

// Everything about ONE user: identity, plan controls (set plan / grant free
// month), acquisition attribution, every card with per-card stats + live
// links, 30-day activity, recent captured contacts, referral tools.

import { useCallback, useEffect, useState } from "react";
import { getSignupSourceLabel, getSourceLabel } from "@/lib/source-labels";
import Link from "next/link";
import { adminErrorText, grantMonthWarning, planChangeWarning, takeOfflineWarning } from "@/lib/admin-confirm";

type Detail = {
  user: {
    id: string; username: string; name: string | null; email: string | null; plan: string;
    plan_expires_at: string | null; created_at: string; company: string | null; title: string | null;
    phone: string | null; website: string | null; photo_url: string | null;
    signup_source: string; referral_code: string | null;
    referred_by: { id: string; name: string | null; email: string | null } | null;
    referral_reward_earned: boolean; deleted: boolean;
  };
  cards: { id: string; username: string; label: string | null; name: string | null; title: string | null; company: string | null; template: string | null; created_at: string; leads: number; cardViews: number; linkViews: number; is_offline?: boolean }[];
  profileCard: { username: string; leads: number; cardViews: number; linkViews: number } | null;
  totals: { leads: number; views: number; leads30: number; views30: number; referred: number; referralMonthsClaimed?: number; referralMonthsClaimable?: number };
  series: { date: string; views: number; leads: number }[];
  recentLeads: { id: string; name: string | null; email: string | null; phone: string | null; source: string | null; card_owner: string; created_at: string }[];
};

const PLAN_LABEL: Record<string, string> = { free: "Free", pro: "Pro", enterprise: "Office" };

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl px-4 py-3.5">
      <p className="text-xl font-bold tabular-nums">{typeof value === "number" ? value.toLocaleString() : value}</p>
      <p className="text-gray-400 text-[0.6875rem] mt-0.5">{label}</p>
    </div>
  );
}

export default function UserDetailClient({ userId }: { userId: string }) {
  const [data, setData] = useState<Detail | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [codeInput, setCodeInput] = useState("");
  const [codeMsg, setCodeMsg] = useState("");
  const [actionError, setActionError] = useState("");

  const load = useCallback(async () => {
    const res = await fetch(`/api/admin/users/${userId}`);
    if (!res.ok) { setError(res.status === 404 ? "User not found" : "Failed to load user"); return; }
    const d = await res.json();
    setData(d);
    setCodeInput(d.user.referral_code ?? "");
  }, [userId]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time data fetch on mount
  useEffect(() => { load(); }, [load]);

  // Every refusal is shown now, not only the referral code's (audit
  // F-ADMIN-02): a 409 or 502 on a plan change used to vanish.
  async function patch(body: Record<string, unknown>, busyKey: string) {
    setBusy(busyKey);
    setCodeMsg("");
    setActionError("");
    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (body.referralCode !== undefined) {
        setCodeMsg(res.ok ? "Saved ✓" : await adminErrorText(res));
      } else if (!res.ok) {
        setActionError(await adminErrorText(res));
      }
    } catch {
      setActionError("Couldn't reach the server. Nothing was changed.");
    } finally {
      setBusy("");
    }
    load();
  }

  if (error) return (
    <div className="py-10">
      <p className="text-red-400 text-sm">{error}</p>
      <Link href="/admin/users" className="text-blue-400 text-sm hover:text-blue-300 mt-2 inline-block">← Back to users</Link>
    </div>
  );
  if (!data) return <p className="text-gray-500 text-sm py-10">Loading…</p>;

  const { user, cards, profileCard, totals, series, recentLeads } = data;
  const who = user.email || user.name || user.username || "this user";
  const maxDay = Math.max(...series.map((s) => s.views + s.leads), 1);
  // The slug whose public pages actually exist: a real card first, then the
  // legacy profile-slug card. Null → this account has no public page yet.
  const primarySlug = cards[0]?.username ?? profileCard?.username ?? null;
  const allCards = [
    ...cards.map((c) => ({ key: c.id, username: c.username, label: c.label || c.name || c.username, template: c.template ?? "classic-pro", leads: c.leads, cardViews: c.cardViews, linkViews: c.linkViews, offline: c.is_offline === true, moderatable: true })),
    ...(profileCard ? [{ key: "profile", username: profileCard.username, label: `${user.name || user.username} (primary)`, template: "primary", leads: profileCard.leads, cardViews: profileCard.cardViews, linkViews: profileCard.linkViews, offline: false, moderatable: false }] : []),
  ];

  return (
    <div className="space-y-6">
      <Link href="/admin/users" className="text-gray-500 hover:text-white text-xs transition-colors">← All users</Link>

      {/* Identity header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-4 min-w-0">
          {user.photo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={user.photo_url} alt="" className="w-14 h-14 rounded-full object-cover border border-gray-700" />
          ) : (
            <div className="w-14 h-14 rounded-full bg-gray-800 flex items-center justify-center text-lg font-bold text-gray-400">
              {(user.name || user.email || "?")[0]?.toUpperCase()}
            </div>
          )}
          <div className="min-w-0">
            <h1 className="text-xl font-bold truncate">{user.name || user.email || user.username} {user.deleted && <span className="text-red-400 text-xs font-normal">(deleted account)</span>}</h1>
            <p className="text-gray-500 text-sm truncate">{user.email}{user.company ? ` · ${user.company}` : ""}{user.title ? ` · ${user.title}` : ""}</p>
            <p className="text-gray-600 text-xs mt-0.5">
              Joined {new Date(user.created_at).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
              {" · "}found us via: <span className="text-gray-400">{getSignupSourceLabel(user.signup_source)}</span>
              {user.referred_by && (
                <>
                  {" · referred by "}
                  <Link href={`/admin/users/${user.referred_by.id}`} className="text-blue-400 hover:text-blue-300">
                    {user.referred_by.name || user.referred_by.email || "another user"}
                  </Link>
                </>
              )}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {primarySlug ? (
            <>
              <a href={`/${primarySlug}`} target="_blank" rel="noopener noreferrer"
                className="text-xs font-semibold text-gray-300 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-full px-3 py-1.5 transition-colors">
                View card ↗
              </a>
              <a href={`/links/${primarySlug}`} target="_blank" rel="noopener noreferrer"
                className="text-xs font-semibold text-gray-300 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-full px-3 py-1.5 transition-colors">
                Swift Links ↗
              </a>
            </>
          ) : (
            <span className="text-xs text-gray-600">No public card yet</span>
          )}
        </div>
      </div>

      {/* Plan controls */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <p className="text-white font-semibold text-sm">
              Plan: <span className="text-blue-300">{PLAN_LABEL[user.plan] ?? user.plan ?? "Free"}</span>
              {user.plan_expires_at && (
                <span className="text-amber-400 text-xs font-normal ml-2">
                  free month until {new Date(user.plan_expires_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                </span>
              )}
            </p>
            <p className="text-gray-600 text-[0.6875rem] mt-0.5">Setting a plan directly clears any free-month expiry.</p>
            {actionError && <p role="alert" className="text-red-400 text-xs mt-1.5">{actionError}</p>}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {(["free", "pro", "enterprise"] as const).map((p) => (
              <button
                key={p}
                onClick={() => {
                  if (!window.confirm(planChangeWarning(who, user.plan || "free", p))) return;
                  void patch({ plan: p }, `plan-${p}`);
                }}
                disabled={busy !== "" || user.plan === p}
                className={`text-xs font-semibold px-3 py-1.5 rounded-full border transition-colors disabled:opacity-50 ${
                  user.plan === p ? "bg-blue-600 border-blue-600 text-white" : "bg-gray-800 border-gray-700 text-gray-300 hover:border-gray-500"
                }`}
              >
                {busy === `plan-${p}` ? "…" : PLAN_LABEL[p]}
              </button>
            ))}
            <button
              onClick={() => {
                if (!window.confirm(grantMonthWarning(who))) return;
                void patch({ grantFreeMonth: true }, "grant");
              }}
              disabled={busy !== ""}
              className="text-xs font-semibold px-3 py-1.5 rounded-full bg-emerald-700/60 border border-emerald-600/60 text-emerald-200 hover:bg-emerald-700 transition-colors disabled:opacity-50"
            >
              {busy === "grant" ? "…" : "🎁 Grant 1 month of Pro"}
            </button>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <Stat label="Cards" value={allCards.length} />
        <Stat label="Contacts captured" value={totals.leads} />
        <Stat label="Total views" value={totals.views} />
        <Stat label="Views (30d)" value={totals.views30} />
        <Stat label="Users they referred" value={totals.referred} />
      </div>

      {/* 30-day activity */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
        <p className="text-white font-semibold text-sm mb-3">Last 30 days <span className="text-gray-600 font-normal text-xs">— views (blue) + contacts (green)</span></p>
        <div className="flex items-end gap-[3px] h-20">
          {series.map((s) => (
            <div key={s.date} className="flex-1 flex flex-col justify-end gap-[1px]" title={`${s.date}: ${s.views} views · ${s.leads} contacts`}>
              <div className="bg-emerald-500/80 rounded-sm" style={{ height: `${(s.leads / maxDay) * 100}%`, minHeight: s.leads ? 3 : 0 }} />
              <div className="bg-blue-500/70 rounded-sm" style={{ height: `${(s.views / maxDay) * 100}%`, minHeight: s.views ? 3 : 0 }} />
            </div>
          ))}
        </div>
      </div>

      {/* Cards */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-800">
          <p className="text-white font-semibold text-sm">Cards ({allCards.length})</p>
        </div>
        {allCards.length === 0 ? (
          <p className="px-5 py-8 text-center text-gray-500 text-sm">No cards yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800 text-gray-500 text-xs">
                  <th className="text-left px-5 py-2.5 font-medium">Card</th>
                  <th className="text-left px-4 py-2.5 font-medium">Template</th>
                  <th className="text-left px-4 py-2.5 font-medium">Card views</th>
                  <th className="text-left px-4 py-2.5 font-medium">Link views</th>
                  <th className="text-left px-4 py-2.5 font-medium">Contacts</th>
                  <th className="text-left px-4 py-2.5 font-medium">Open</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800/60">
                {allCards.map((c) => (
                  <tr key={c.key} className="hover:bg-gray-800/30 transition-colors">
                    <td className="px-5 py-2.5">
                      <p className="text-white text-xs font-medium">{c.label}</p>
                      <p className="text-gray-600 text-[0.625rem]">/{c.username}</p>
                    </td>
                    <td className="px-4 py-2.5 text-gray-400 text-xs">{c.template.replace(/-/g, " ")}</td>
                    <td className="px-4 py-2.5 text-gray-300 tabular-nums">{c.cardViews}</td>
                    <td className="px-4 py-2.5 text-gray-300 tabular-nums">{c.linkViews}</td>
                    <td className="px-4 py-2.5 text-white font-semibold tabular-nums">{c.leads}</td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2 text-[0.6875rem]">
                        <a href={`/${c.username}`} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300">Card ↗</a>
                        <a href={`/links/${c.username}`} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300">Links ↗</a>
                        {/* Moderation kill-switch (App Review 1.2): reversible
                            takedown of everything this card serves publicly. */}
                        {c.moderatable && (
                          <button
                            type="button"
                            disabled={busy === `offline-${c.key}`}
                            onClick={() => {
                              if (!c.offline && !window.confirm(takeOfflineWarning(c.username))) return;
                              void patch({ cardOffline: { cardId: c.key, offline: !c.offline } }, `offline-${c.key}`);
                            }}
                            className={`font-semibold px-2 py-1 rounded-full transition-colors disabled:opacity-50 ${c.offline ? "text-emerald-400 bg-emerald-500/10 hover:bg-emerald-500/20" : "text-red-400 bg-red-500/10 hover:bg-red-500/20"}`}
                          >
                            {busy === `offline-${c.key}` ? "…" : c.offline ? "Bring online" : "Take offline"}
                          </button>
                        )}
                        {c.offline && <span className="text-amber-400/90 font-medium">offline</span>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Referral tools */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
          <p className="text-white font-semibold text-sm mb-1">Referral</p>
          <p className="text-gray-600 text-[0.6875rem] mb-3">
            Their link: {user.referral_code ? <span className="font-mono text-gray-400">swiftcard.me/r/{user.referral_code}</span> : "no code yet"}
            {" · "}<span className="text-gray-400">{totals.referred}</span> successful signups
            {" · "}<span className="text-gray-400">{totals.referralMonthsClaimed ?? 0}/3</span> months claimed
            {(totals.referralMonthsClaimable ?? 0) > 0 && <span className="text-emerald-400"> · {totals.referralMonthsClaimable} ready to claim</span>}
          </p>
          <div className="flex items-center gap-2">
            <input
              value={codeInput}
              onChange={(e) => setCodeInput(e.target.value.toUpperCase())}
              placeholder="CUSTOM-CODE"
              className="flex-1 bg-gray-800 border border-gray-700 text-white placeholder-gray-600 rounded-xl px-3 py-2 text-sm font-mono focus:outline-none focus:border-blue-500"
            />
            <button
              onClick={() => patch({ referralCode: codeInput }, "code")}
              disabled={busy !== "" || !codeInput.trim()}
              className="text-xs font-semibold px-3 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white transition-colors disabled:opacity-50"
            >
              {busy === "code" ? "…" : "Set code"}
            </button>
          </div>
          {codeMsg && <p className={`text-xs mt-2 ${codeMsg.includes("✓") ? "text-emerald-400" : "text-red-400"}`}>{codeMsg}</p>}
          <p className="text-gray-600 text-[0.6875rem] mt-2">Set a memorable code (e.g. a partner or influencer promo) — anyone signing up through /r/CODE gets the free month and attributes to this user.</p>
        </div>

        {/* Recent contacts captured */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
          <p className="text-white font-semibold text-sm mb-1">Recent contacts captured</p>
          <p className="text-gray-600 text-[0.6875rem] mb-3">The latest people who shared their info through this user&apos;s cards, and how each one arrived.</p>
          {recentLeads.length === 0 ? (
            <p className="text-gray-500 text-xs">None yet.</p>
          ) : (
            <div className="divide-y divide-gray-800/60">
              {recentLeads.map((l) => (
                <div key={l.id} className="py-1.5 flex items-center justify-between gap-2 text-xs">
                  <div className="min-w-0">
                    <p className="text-white truncate">{l.name || l.email || l.phone || "—"}</p>
                    <p className="text-gray-600 text-[0.625rem] truncate">via {getSourceLabel(l.source)} · /{l.card_owner}</p>
                  </div>
                  <span className="text-gray-600 text-[0.625rem] shrink-0">
                    {new Date(l.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
