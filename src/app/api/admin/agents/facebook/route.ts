import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { getAdminSupabase } from "@/lib/supabase-admin";
import { loadConnections } from "@/lib/agent-connections";
import { FB_DEFAULTS, loadFb, mergeFbSettings, runFacebookTick } from "@/lib/facebook-bot";
import { campaignLink } from "@/lib/campaign-links";

// ── Agent Flow → Settings → Facebook bot ─────────────────────────────────────
// The owner's switch, the message wording, and the funnel the bot is judged on:
// keyword comments → links sent → link taps → signups, per Page post.

export const runtime = "nodejs";
export const maxDuration = 60;

// Read comments on the Page's posts, reply under them, and message the people
// who wrote to the Page.
const NEEDED = ["pages_read_engagement", "pages_manage_engagement", "pages_messaging"];
const DAY = 86400e3;

export async function GET() {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { settings, state, ready } = await loadFb();
  if (!ready) return NextResponse.json({ ready: false, message: "Run supabase/agent-facebook.sql in the Supabase SQL editor to switch the Facebook bot on." });

  const db = getAdminSupabase();
  const conn = (await loadConnections()).meta;
  const granted = Array.isArray(conn?.meta.granted) ? (conn!.meta.granted as string[]) : [];
  const since = new Date(Date.now() - 30 * DAY).toISOString();

  const [events, posts, clicks, signups] = await Promise.all([
    db.from("agent_fb_events").select("post_id, action, status, kind, username, text, reply, reason, created_at").gte("created_at", since).order("created_at", { ascending: false }).limit(2000),
    db.from("agent_fb_posts").select("post_id, code, permalink, message, posted_at, comments_count").order("posted_at", { ascending: false }).limit(30),
    db.from("product_events").select("props").eq("name", "campaign_link_clicked").eq("is_internal", false).gte("created_at", since).limit(5000),
    db.from("profiles").select("signup_source, pro_trial_started_at").like("signup_source", "fb\\_%").gte("created_at", since).limit(5000),
  ]);

  const ev = events.data ?? [];
  const clickBy: Record<string, number> = {};
  for (const r of clicks.data ?? []) {
    const code = String((r.props as { code?: unknown } | null)?.code ?? "");
    if (code.startsWith("fb_")) clickBy[code] = (clickBy[code] ?? 0) + 1;
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
    defaults: FB_DEFAULTS,
    connected: !!conn?.meta.page_id,
    account: (conn?.meta.page_name as string | undefined) ?? null,
    // The consent screen lets the owner untick a permission; without these the
    // bot can post to the Page but cannot read comments or send anything.
    missing: conn ? NEEDED.filter((p) => !granted.includes(p)) : NEEDED,
    last_tick_at: state.last_tick_at ?? null,
    last_error: state.last_error ?? null,
    page_link: campaignLink("fb_page", settings.profession),
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
      keyword_comments: ev.filter((e) => e.post_id === p.post_id && e.action === "link").length,
      links_sent: ev.filter((e) => e.post_id === p.post_id && e.action === "link" && e.status === "sent").length,
      clicks: clickBy[p.code] ?? 0,
      signups: signupBy[p.code] ?? 0,
    })).sort((a, b) => b.signups - a.signups || b.clicks - a.clicks || b.keyword_comments - a.keyword_comments),
    recent: ev.slice(0, 15),
  });
}

export async function POST(req: NextRequest) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = (await req.json().catch(() => null)) as { settings?: Record<string, unknown>; action?: string } | null;
  if (!body) return NextResponse.json({ error: "bad request" }, { status: 400 });

  if (body.action === "run_now") {
    try { return NextResponse.json(await runFacebookTick()); }
    catch (e) { return NextResponse.json({ ok: false, reason: String((e as Error)?.message ?? e).slice(0, 200) }, { status: 500 }); }
  }

  if (body.settings) {
    const { settings: current, ready } = await loadFb();
    if (!ready) return NextResponse.json({ error: "Run supabase/agent-facebook.sql first." }, { status: 400 });
    // The message must keep its {link}: without it the bot would send a
    // greeting with nothing to tap.
    if (typeof body.settings.message === "string" && !body.settings.message.includes("{link}")) {
      return NextResponse.json({ error: "The message needs {link} in it — that is where the card link goes." }, { status: 400 });
    }
    const next = mergeFbSettings({ ...current, ...body.settings });
    const { error } = await getAdminSupabase().from("agent_system").update({ facebook: next, updated_at: new Date().toISOString() }).eq("id", true);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true, settings: next });
  }
  return NextResponse.json({ error: "bad request" }, { status: 400 });
}
