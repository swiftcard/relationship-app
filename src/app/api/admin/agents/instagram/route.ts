import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { getAdminSupabase } from "@/lib/supabase-admin";
import { loadConnections } from "@/lib/agent-connections";
import { IG_DEFAULTS, loadIg, mergeIgSettings, runInstagramTick } from "@/lib/instagram-bot";
import { campaignLink } from "@/lib/campaign-links";

// ── Agent Flow → Settings → Instagram bot ────────────────────────────────────
// The owner's switch, the message wording, and the funnel the bot is judged on:
// keyword comments → links sent → link taps → signups, per post.

export const runtime = "nodejs";
export const maxDuration = 60;

const NEEDED = ["instagram_manage_comments", "instagram_manage_messages"];
const DAY = 86400e3;

export async function GET() {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { settings, state, ready } = await loadIg();
  if (!ready) return NextResponse.json({ ready: false, message: "Run supabase/agent-instagram.sql in the Supabase SQL editor to switch the Instagram bot on." });

  const db = getAdminSupabase();
  const conn = (await loadConnections()).meta;
  const granted = Array.isArray(conn?.meta.granted) ? (conn!.meta.granted as string[]) : [];
  const since = new Date(Date.now() - 30 * DAY).toISOString();

  const [events, posts, clicks, signups] = await Promise.all([
    db.from("agent_ig_events").select("media_id, action, status, kind, username, text, reply, reason, created_at").gte("created_at", since).order("created_at", { ascending: false }).limit(2000),
    db.from("agent_ig_posts").select("media_id, code, permalink, caption, media_type, posted_at, like_count, comments_count").order("posted_at", { ascending: false }).limit(30),
    db.from("product_events").select("props").eq("name", "campaign_link_clicked").eq("is_internal", false).gte("created_at", since).limit(5000),
    db.from("profiles").select("signup_source, pro_trial_started_at").like("signup_source", "ig\\_%").gte("created_at", since).limit(5000),
  ]);

  const ev = events.data ?? [];
  const clickBy: Record<string, number> = {};
  for (const r of clicks.data ?? []) {
    const code = String((r.props as { code?: unknown } | null)?.code ?? "");
    if (code.startsWith("ig_")) clickBy[code] = (clickBy[code] ?? 0) + 1;
  }
  const signupBy: Record<string, number> = {};
  let trials = 0;
  for (const r of signups.data ?? []) {
    const code = String(r.signup_source ?? "");
    signupBy[code] = (signupBy[code] ?? 0) + 1;
    if (r.pro_trial_started_at) trials++;
  }
  const sum = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0);

  return NextResponse.json({
    ready: true,
    settings,
    defaults: IG_DEFAULTS,
    connected: !!conn?.meta.ig_user_id,
    account: (conn?.meta.ig_username as string | undefined) ?? null,
    // The consent screen lets the owner untick a permission; without these two
    // the bot can post but cannot read comments or send anything.
    missing: conn ? NEEDED.filter((p) => !granted.includes(p)) : NEEDED,
    last_tick_at: state.last_tick_at ?? null,
    last_error: state.last_error ?? null,
    bio_link: campaignLink("ig_bio", settings.profession),
    funnel: {
      keyword_comments: ev.filter((e) => e.action === "link" && e.kind === "comment").length,
      links_sent: ev.filter((e) => e.action === "link" && e.status === "sent").length,
      waiting: ev.filter((e) => e.status === "queued").length,
      failed: ev.filter((e) => e.status === "failed").length,
      clicks: sum(clickBy),
      signups: sum(signupBy),
      trials,
    },
    posts: (posts.data ?? []).map((p) => ({
      ...p,
      keyword_comments: ev.filter((e) => e.media_id === p.media_id && e.action === "link").length,
      links_sent: ev.filter((e) => e.media_id === p.media_id && e.action === "link" && e.status === "sent").length,
      clicks: clickBy[p.code] ?? 0,
      signups: signupBy[p.code] ?? 0,
    })).sort((a, b) => b.signups - a.signups || b.clicks - a.clicks || b.keyword_comments - a.keyword_comments),
    other_sources: Object.entries(signupBy).filter(([c]) => !c.startsWith("ig_p_")).map(([code, n]) => ({ code, signups: n, clicks: clickBy[code] ?? 0 })),
    recent: ev.slice(0, 15),
  });
}

export async function POST(req: NextRequest) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = (await req.json().catch(() => null)) as { settings?: Record<string, unknown>; action?: string } | null;
  if (!body) return NextResponse.json({ error: "bad request" }, { status: 400 });

  if (body.action === "run_now") {
    try { return NextResponse.json(await runInstagramTick()); }
    catch (e) { return NextResponse.json({ ok: false, reason: String((e as Error)?.message ?? e).slice(0, 200) }, { status: 500 }); }
  }

  if (body.settings) {
    const { settings: current, ready } = await loadIg();
    if (!ready) return NextResponse.json({ error: "Run supabase/agent-instagram.sql first." }, { status: 400 });
    // The message must keep its {link}: without it the bot would send a
    // greeting with nothing to tap. mergeIgSettings falls back to the default
    // wording in that case, so say so instead of silently swapping it.
    if (typeof body.settings.message === "string" && !body.settings.message.includes("{link}")) {
      return NextResponse.json({ error: "The message needs {link} in it — that is where the card link goes." }, { status: 400 });
    }
    const next = mergeIgSettings({ ...current, ...body.settings });
    const { error } = await getAdminSupabase().from("agent_system").update({ instagram: next, updated_at: new Date().toISOString() }).eq("id", true);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true, settings: next });
  }
  return NextResponse.json({ error: "bad request" }, { status: 400 });
}
