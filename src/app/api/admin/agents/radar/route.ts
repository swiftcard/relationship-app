import { NextResponse, type NextRequest } from "next/server";
import { createHash } from "node:crypto";
import { requireAdmin } from "@/lib/admin";
import { getAdminSupabase } from "@/lib/supabase-admin";
import agentConfig from "../../../../../../marketing-agents/config.json";

// ── Agent Flow → Radar ───────────────────────────────────────────────────────
// The listening layer's owner surface (owner order 2026-09-30). The scanning
// itself is marketing-agents/lib/radar.mjs, run inside the always-on loop;
// this route only reads what it found, records the owner's calls on it, and
// edits the listening list. Nothing here posts anywhere.

const REPO = process.env.AGENTS_GITHUB_REPO || "swiftcard/relationship-app";
const RADAR_WORKFLOW = "agent-radar.yml";
const DEFAULTS = (agentConfig as { radar?: Record<string, unknown> }).radar ?? {};
const TARGETS = (agentConfig as { targets?: Record<string, unknown> }).targets ?? {};
const LIST_KEYS = ["keywords", "brand", "competitors", "ask_words", "complaint_words", "subreddits", "telegram_channels", "hn_queries", "youtube_queries", "hire_queries"] as const;
const SOURCE_KINDS = new Set(["reddit_sub", "telegram_channel", "rss", "appstore_reviews"]);
const sha = (s: string) => createHash("sha1").update(s).digest("hex");

async function dispatch(workflow: string, inputs: Record<string, string>): Promise<{ ok: boolean; status: number }> {
  const token = process.env.GITHUB_AGENTS_TOKEN;
  if (!token) return { ok: false, status: 503 };
  const res = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/${workflow}/dispatches`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
    body: JSON.stringify({ ref: "main", inputs }),
  }).catch(() => null);
  return { ok: res?.status === 204, status: res?.status ?? 0 };
}

/** The effective listening list: config defaults under the owner's overrides. */
function mergedList(over: Record<string, unknown> | null) {
  const o = over ?? {};
  const arr = (k: string, fb: unknown) => (Array.isArray(o[k]) && (o[k] as unknown[]).length ? o[k] : fb) ?? [];
  return {
    keywords: arr("keywords", DEFAULTS.keywords), brand: arr("brand", TARGETS.brand_variations), competitors: arr("competitors", TARGETS.competitors),
    ask_words: arr("ask_words", DEFAULTS.ask_words), complaint_words: arr("complaint_words", DEFAULTS.complaint_words),
    subreddits: arr("subreddits", DEFAULTS.subreddits), telegram_channels: arr("telegram_channels", DEFAULTS.telegram_channels),
    feeds: arr("feeds", DEFAULTS.feeds), hn_queries: arr("hn_queries", DEFAULTS.hn_queries), youtube_queries: arr("youtube_queries", DEFAULTS.youtube_queries), hire_queries: arr("hire_queries", DEFAULTS.hire_queries),
    interval_min: Number(o.interval_min ?? DEFAULTS.interval_min ?? 15), wake_score: Number(o.wake_score ?? DEFAULTS.wake_score ?? 50),
    overridden: [...LIST_KEYS.filter((k) => Array.isArray(o[k]) && (o[k] as unknown[]).length), ...(Array.isArray(o.feeds) && (o.feeds as unknown[]).length ? ["feeds"] : [])] as string[],
  };
}

export async function GET(req: NextRequest) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const admin = getAdminSupabase();
  const q = req.nextUrl.searchParams;
  const status = q.get("status") || "new";
  const agent = q.get("agent") || "";
  const limit = Math.min(200, Math.max(1, Number(q.get("limit") || 80)));
  let query = admin.from("agent_radar_signals").select("*").order("score", { ascending: false }).order("found_at", { ascending: false }).limit(limit);
  if (status !== "all") query = query.eq("status", status);
  if (agent) query = query.eq("assigned_agent", agent);
  const [signals, sources, system, counts] = await Promise.all([
    query,
    admin.from("agent_radar_sources").select("*").order("kind").order("id"),
    admin.from("agent_system").select("radar").limit(1).single(),
    admin.from("agent_radar_signals").select("status").gte("found_at", new Date(Date.now() - 7 * 86400e3).toISOString()),
  ]);
  // Before supabase/agent-radar.sql has run there is no table — say so, never a broken tab.
  if (signals.error || sources.error) return NextResponse.json({ ready: false, message: "Run supabase/agent-radar.sql in the Supabase SQL editor to switch the Radar on." });
  const by: Record<string, number> = {};
  for (const r of counts.data ?? []) by[r.status] = (by[r.status] ?? 0) + 1;
  const over = (system.data?.radar ?? null) as Record<string, unknown> | null;
  return NextResponse.json({ ready: true, signals: signals.data ?? [], sources: sources.data ?? [], counts: by, config: mergedList(over), dispatchConfigured: !!process.env.GITHUB_AGENTS_TOKEN });
}

const clean = (v: unknown, max = 120) => String(v ?? "").trim().slice(0, max);
const list = (v: unknown, max = 60) => (Array.isArray(v) ? v : String(v ?? "").split(/\r?\n|,/)).map((x) => clean(x)).filter(Boolean).slice(0, max);

export async function POST(req: NextRequest) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = await req.json().catch(() => null) as
    | { action?: string; ids?: string[]; agent_id?: string; source?: { id?: string; kind?: string; target?: string; label?: string; active?: boolean }; remove_source?: string; config?: Record<string, unknown> }
    | null;
  if (!body) return NextResponse.json({ error: "bad request" }, { status: 400 });
  const admin = getAdminSupabase();
  const agents = agentConfig.agents as Record<string, { workflow: string }>;

  // ── The owner's calls on signals ───────────────────────────────────────────
  if (body.action === "dismiss" || body.action === "restore" || body.action === "handled") {
    const ids = Array.isArray(body.ids) ? body.ids.slice(0, 100) : [];
    if (!ids.length) return NextResponse.json({ error: "ids required" }, { status: 400 });
    const status = body.action === "dismiss" ? "dismissed" : body.action === "handled" ? "handled" : "new";
    const { error } = await admin.from("agent_radar_signals").update({ status }).in("id", ids);
    return error ? NextResponse.json({ error: error.message }, { status: 400 }) : NextResponse.json({ ok: true, status });
  }
  // ── Wake one agent on its signals now (same road the loop takes) ──────────
  if (body.action === "wake" && body.agent_id && agents[body.agent_id]) {
    const r = await dispatch(agents[body.agent_id].workflow, { trigger: "radar" });
    if (r.ok) await admin.from("agent_messages").insert({ from_id: "owner", to_id: "atlas", kind: "owner_in", body: `Wake ${body.agent_id} on the Radar's signals now.` }).then(() => {}, () => {});
    return NextResponse.json(r.ok ? { ok: true } : { error: r.status === 503 ? "GITHUB_AGENTS_TOKEN is not set in Vercel." : `GitHub dispatch → ${r.status}` }, { status: r.ok ? 200 : 502 });
  }
  if (body.action === "scan_now") {
    const r = await dispatch(RADAR_WORKFLOW, { trigger: "scan_now" });
    return NextResponse.json(r.ok ? { ok: true } : { error: r.status === 503 ? "GITHUB_AGENTS_TOKEN is not set in Vercel." : `GitHub dispatch → ${r.status}` }, { status: r.ok ? 200 : 502 });
  }
  // ── Sources ────────────────────────────────────────────────────────────────
  if (body.remove_source) {
    const { error } = await admin.from("agent_radar_sources").delete().eq("id", clean(body.remove_source, 200));
    return error ? NextResponse.json({ error: error.message }, { status: 400 }) : NextResponse.json({ ok: true });
  }
  if (body.source) {
    const s = body.source;
    if (s.id && typeof s.active === "boolean" && !s.kind) {
      const { error } = await admin.from("agent_radar_sources").update({ active: s.active, last_error: null }).eq("id", clean(s.id, 200));
      return error ? NextResponse.json({ error: error.message }, { status: 400 }) : NextResponse.json({ ok: true });
    }
    const kind = clean(s.kind, 40);
    if (!SOURCE_KINDS.has(kind)) return NextResponse.json({ error: "unknown source kind" }, { status: 400 });
    let target = clean(s.target, 500);
    if (!target) return NextResponse.json({ error: "target required" }, { status: 400 });
    let id: string, label = clean(s.label, 120);
    if (kind === "reddit_sub") { target = target.replace(/^(https?:\/\/)?(www\.)?reddit\.com\//i, "").replace(/^r\//i, "").replace(/\/.*$/, ""); id = `reddit:r/${target}`; label ||= `Reddit · r/${target} (new posts)`; }
    else if (kind === "telegram_channel") { target = target.replace(/^(https?:\/\/)?t\.me\/(s\/)?/i, "").replace(/^@/, "").replace(/\/.*$/, ""); id = `telegram:@${target}`; label ||= `Telegram · @${target}`; }
    else if (kind === "rss") { if (!/^https?:\/\//i.test(target)) return NextResponse.json({ error: "a feed needs a full http(s) URL" }, { status: 400 }); id = `rss:${sha(target).slice(0, 10)}`; label ||= target; }
    else { const appId = target.match(/id(\d+)/)?.[1] ?? target.replace(/\D/g, ""); if (!appId) return NextResponse.json({ error: "an App Store URL or id is needed" }, { status: 400 }); target = appId; id = `appstore:${label ? label.toLowerCase().replace(/[^a-z0-9]+/g, "-") : appId}`; label = `${label || appId} · newest App Store reviews`; }
    const { error } = await admin.from("agent_radar_sources").upsert({ id, kind, target, label, active: true }, { onConflict: "id" });
    return error ? NextResponse.json({ error: error.message }, { status: 400 }) : NextResponse.json({ ok: true, id });
  }
  // ── The listening list ─────────────────────────────────────────────────────
  if (body.config) {
    const c = body.config;
    const { data: sys } = await admin.from("agent_system").select("radar").limit(1).single();
    const next: Record<string, unknown> = { ...((sys?.radar as Record<string, unknown> | null) ?? {}) };
    for (const k of LIST_KEYS) if (k in c) next[k] = list(c[k], k === "keywords" ? 80 : 60);
    if ("feeds" in c) {
      const raw = Array.isArray(c.feeds) ? c.feeds : String(c.feeds ?? "").split(/\r?\n/);
      next.feeds = raw.map((f: unknown) => {
        if (f && typeof f === "object") { const o = f as { label?: unknown; url?: unknown }; return { label: clean(o.label, 120) || clean(o.url, 500), url: clean(o.url, 500) }; }
        const [a, b] = String(f ?? "").split("|").map((x) => x.trim());
        return b ? { label: a, url: b } : { label: a, url: a };
      }).filter((f: { url: string }) => /^https?:\/\//i.test(f.url)).slice(0, 40);
    }
    if ("interval_min" in c) next.interval_min = Math.max(5, Math.min(240, Math.round(Number(c.interval_min) || 15)));
    if ("wake_score" in c) next.wake_score = Math.max(0, Math.min(100, Math.round(Number(c.wake_score) || 50)));
    const { error } = await admin.from("agent_system").update({ radar: next, updated_at: new Date().toISOString() }).eq("id", true);
    if (error) return NextResponse.json({ error: /radar/.test(error.message) ? "Run supabase/agent-radar.sql first (adds agent_system.radar)." : error.message }, { status: 400 });
    return NextResponse.json({ ok: true, config: mergedList(next) });
  }
  return NextResponse.json({ error: "bad request" }, { status: 400 });
}
