#!/usr/bin/env node
// ── Weekly growth scorecard ──────────────────────────────────────────────────
//
// One short email to the owner every Sunday evening: this week's funnel next
// to last week's, in a single table, no commentary. Ana (agent-analyst) does
// the interpretation on Monday; this is the raw sheet so the numbers reach
// the inbox without opening the admin console.
//
// Runs from .github/workflows/weekly-scorecard.yml with the same Supabase
// service key and email relay the agents use. Every count is "no data" rather
// than a guess when a table cannot be read — a scorecard must never invent a
// number (see the honesty rules in marketing-agents/lib/insights.mjs).
//
// Counting rules, so the sheet matches Admin → Analytics:
//   • Signups        profiles.created_at
//   • Cards created  cards.created_at
//   • Card shares    product_events name=card_shared, is_internal=false
//   • Cards viewed   new cards (this week) with at least one card_views row
//   • Referral       profiles.signup_source = 'referral'
//   • Pro trials     profiles.pro_trial_started_at
//   • Leads          leads.created_at
//   • App Store      iTunes lookup: average rating + rating count (public)
import { sbCount, sbRows, isoAgo, DAY } from "./lib/probe.mjs";
import { email } from "./lib/agentkit.mjs";

const APP_ID = "6798875872";
const wk = (col, from, to) => `${col}=gte.${isoAgo(from * DAY)}&${col}=lt.${isoAgo(to * DAY)}`;

async function pair(table, col, extra = "") {
  const q = extra ? `&${extra}` : "";
  const [now, prev] = await Promise.all([
    sbCount(table, `${wk(col, 7, 0)}${q}`),
    sbCount(table, `${wk(col, 14, 7)}${q}`),
  ]);
  return { now, prev };
}

async function newCardsViewed(from, to) {
  const cards = (await sbRows("cards", `select=username&${wk("created_at", from, to)}&limit=2000`)) ?? null;
  if (!cards) return null;
  if (cards.length === 0) return 0;
  const views = (await sbRows("card_views", `select=username&viewed_at=gte.${isoAgo(from * DAY)}&limit=10000`)) ?? null;
  if (!views) return null;
  const seen = new Set(views.map((v) => v.username));
  return cards.filter((c) => seen.has(c.username)).length;
}

async function appStore() {
  try {
    const r = await fetch(`https://itunes.apple.com/lookup?id=${APP_ID}&country=us`);
    const a = (await r.json())?.results?.[0];
    return a ? { rating: a.averageUserRating, ratings: a.userRatingCount, version: a.version } : null;
  } catch { return null; }
}

const n = (v) => (v === null || v === undefined ? "no data" : String(v));
const delta = (a, b) => {
  if (a === null || b === null || a === undefined || b === undefined) return "";
  const d = a - b;
  return d === 0 ? "—" : d > 0 ? `+${d}` : `${d}`;
};
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

async function main() {
  const [signups, cards, shares, referrals, trials, leads, views, viewedNow, viewedPrev, store] = await Promise.all([
    pair("profiles", "created_at"),
    pair("cards", "created_at"),
    pair("product_events", "created_at", "name=eq.card_shared&is_internal=eq.false"),
    pair("profiles", "created_at", "signup_source=eq.referral"),
    pair("profiles", "pro_trial_started_at"),
    pair("leads", "created_at"),
    pair("card_views", "viewed_at"),
    newCardsViewed(7, 0),
    newCardsViewed(14, 7),
    appStore(),
  ]);

  const rows = [
    ["Signups", signups],
    ["Cards created", cards],
    ["Card shares", shares],
    ["New cards that got a view", { now: viewedNow, prev: viewedPrev }],
    ["Card views", views],
    ["Leads captured", leads],
    ["Referral signups", referrals],
    ["Pro trials started", trials],
  ];

  const weekEnd = new Date();
  const weekStart = new Date(Date.now() - 7 * DAY);
  const fmt = (d) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" });
  const subject = `SwiftCard week: ${n(signups.now)} signups, ${n(cards.now)} cards, ${n(shares.now)} shares`;

  const tr = ([label, v]) =>
    `<tr><td style="padding:6px 10px;border-bottom:1px solid #e5e7eb">${esc(label)}</td>` +
    `<td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;text-align:right;font-weight:600">${esc(n(v.now))}</td>` +
    `<td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;text-align:right;color:#64748b">${esc(n(v.prev))}</td>` +
    `<td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;text-align:right;color:#64748b">${esc(delta(v.now, v.prev))}</td></tr>`;

  const html =
    `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#0f172a;max-width:560px">` +
    `<p style="margin:0 0 12px">Week of ${esc(fmt(weekStart))} – ${esc(fmt(weekEnd))}, next to the week before.</p>` +
    `<table style="border-collapse:collapse;width:100%;font-size:14px">` +
    `<thead><tr><th style="text-align:left;padding:6px 10px;border-bottom:2px solid #0f172a"></th>` +
    `<th style="text-align:right;padding:6px 10px;border-bottom:2px solid #0f172a">This week</th>` +
    `<th style="text-align:right;padding:6px 10px;border-bottom:2px solid #0f172a;color:#64748b">Last week</th>` +
    `<th style="text-align:right;padding:6px 10px;border-bottom:2px solid #0f172a;color:#64748b">Δ</th></tr></thead>` +
    `<tbody>${rows.map(tr).join("")}</tbody></table>` +
    `<p style="margin:14px 0 0;font-size:14px">App Store: ${store ? `${esc(store.rating ?? "—")}★ from ${esc(store.ratings ?? 0)} ratings (v${esc(store.version)})` : "no data"}</p>` +
    `<p style="margin:14px 0 0;font-size:12px;color:#64748b">Raw counts, no interpretation — Ana's Monday memo does that. Full detail: swiftcard.me/admin/analytics</p>` +
    `</div>`;

  // Console copy for the Actions log, so a failed relay still leaves the numbers somewhere.
  console.log(subject);
  for (const [label, v] of rows) console.log(`  ${label.padEnd(28)} ${n(v.now).padStart(7)}  (last ${n(v.prev)})`);
  if (store) console.log(`  App Store: ${store.rating}★ / ${store.ratings} ratings`);

  const sent = await email(subject, html);
  if (!sent) { console.error("scorecard: email not sent"); process.exit(1); }
  console.log("scorecard: sent");
}

main().catch((e) => { console.error(e); process.exit(1); });
