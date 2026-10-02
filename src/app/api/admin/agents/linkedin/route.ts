import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { getAdminSupabase } from "@/lib/supabase-admin";
import { campaignLink } from "@/lib/campaign-links";
import {
  LI_DEFAULTS, LI_STATUSES, LI_TRIGGERS, STATUS_STAMP, draftProspect, loadLi, mergeLiSettings, nextStep, prospectCode, startOfDayNY,
  type LiStatus, type LiTrigger,
} from "@/lib/linkedin-desk";

// ── Agent Flow → LinkedIn desk ───────────────────────────────────────────────
// The owner pastes a post or a profile; this writes the comment, connection
// note, message and follow-up, and keeps the ledger: who was contacted, who
// replied, who tapped their link and who signed up. It never calls LinkedIn —
// every send is the owner's own click on linkedin.com.

export const runtime = "nodejs";
export const maxDuration = 60;

const COLS = "id, code, name, headline, company, profile_url, post_url, hook, trigger, profession, sender, drafts, status, notes, requested_at, connected_at, messaged_at, followup_sent_at, replied_at, signed_up_at, closed_at, created_at";
const SCHEMA = "Run supabase/agent-linkedin.sql in the Supabase SQL editor to switch the LinkedIn desk on.";

type Row = {
  id: string; code: string; name: string | null; trigger: string; sender: string | null; status: LiStatus;
  requested_at: string | null; messaged_at: string | null; followup_sent_at: string | null; signed_up_at: string | null; created_at: string;
} & Record<string, unknown>;

const cleanUrl = (v: unknown): string | null => {
  const s = typeof v === "string" ? v.trim() : "";
  if (!/^https:\/\/([a-z]{2,3}\.)?linkedin\.com\//i.test(s)) return null;
  // The same profile reached from two searches carries different tracking
  // parameters; the address without them is what "already on the list" means.
  return s.split(/[?#]/)[0].replace(/\/$/, "").slice(0, 400);
};

export async function GET() {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { settings, ready } = await loadLi();
  if (!ready) return NextResponse.json({ ready: false, message: SCHEMA });

  const db = getAdminSupabase();
  const [rows, clicks, signups] = await Promise.all([
    db.from("agent_li_prospects").select(COLS).order("created_at", { ascending: false }).limit(500),
    db.from("product_events").select("props").eq("name", "campaign_link_clicked").eq("is_internal", false).like("props->>code", "li\\_%").limit(5000),
    db.from("profiles").select("signup_source, created_at").like("signup_source", "li\\_%").limit(5000),
  ]);
  if (rows.error) return NextResponse.json({ ready: false, message: SCHEMA });

  const clickBy: Record<string, number> = {};
  for (const r of clicks.data ?? []) {
    const code = String((r.props as { code?: unknown } | null)?.code ?? "");
    clickBy[code] = (clickBy[code] ?? 0) + 1;
  }
  const signedUp = new Map<string, string>();
  for (const r of signups.data ?? []) signedUp.set(String(r.signup_source), String(r.created_at));

  // A signup is the one status nobody has to tick: the person's own link says so.
  const list = (rows.data ?? []) as unknown as Row[];
  const fresh = list.filter((p) => signedUp.has(p.code) && p.status !== "signed_up");
  await Promise.all(fresh.map((p) => {
    p.status = "signed_up";
    p.signed_up_at = signedUp.get(p.code)!;
    return db.from("agent_li_prospects").update({ status: "signed_up", signed_up_at: p.signed_up_at, updated_at: new Date().toISOString() }).eq("id", p.id);
  }));

  const now = Date.now();
  const today = new Date(startOfDayNY()).getTime();
  const reached = (p: Row) => p.requested_at ?? (p.trigger === "warm" ? p.messaged_at : null);
  const reachedToday = (p: Row) => { const at = reached(p); return !!at && new Date(at).getTime() >= today; };
  const live = list.filter((p) => p.status !== "closed");
  const had = (p: Row, ...s: LiStatus[]) => s.includes(p.status);

  return NextResponse.json({
    ready: true,
    settings,
    defaults: LI_DEFAULTS,
    triggers: LI_TRIGGERS,
    page_link: campaignLink("li_page"),
    today: settings.senders.map((s) => ({ sender: s, sent: list.filter((p) => p.sender === s && reachedToday(p)).length })),
    funnel: {
      added: list.length,
      contacted: list.filter((p) => reached(p)).length,
      connected: list.filter((p) => p.trigger !== "warm" && had(p, "connected", "messaged", "replied", "signed_up")).length,
      messaged: list.filter((p) => p.messaged_at).length,
      replied: list.filter((p) => p.replied_at).length,
      clicks: Object.values(clickBy).reduce((a, b) => a + b, 0),
      // Every LinkedIn signup, including the Page link — not only the people on this list.
      signups: (signups.data ?? []).length,
    },
    prospects: live.map((p) => ({ ...p, clicks: clickBy[p.code] ?? 0, next: nextStep(p, now, settings.followup_days) })),
    closed: list.length - live.length,
  });
}

export async function POST(req: NextRequest) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "bad request" }, { status: 400 });
  const { settings, ready } = await loadLi();
  if (!ready) return NextResponse.json({ error: SCHEMA }, { status: 400 });
  const db = getAdminSupabase();
  const stamp = new Date().toISOString();

  if (body.action === "add" || body.action === "redraft") {
    const redo = body.action === "redraft"
      ? (await db.from("agent_li_prospects").select("id, code, name, pasted, trigger, sender").eq("id", String(body.id ?? "")).maybeSingle()).data
      : null;
    if (body.action === "redraft" && !redo) return NextResponse.json({ error: "Not found." }, { status: 404 });

    const pasted = String(redo?.pasted ?? body.pasted ?? "").trim();
    if (pasted.length < 20) return NextResponse.json({ error: "Paste the post or the profile first — a line or two is not enough to write something personal." }, { status: 400 });
    const trigger = (typeof body.trigger === "string" && body.trigger in LI_TRIGGERS ? body.trigger : redo?.trigger && redo.trigger !== "other" ? redo.trigger : null) as LiTrigger | null;
    const sender = String(body.sender ?? redo?.sender ?? settings.senders[0]).slice(0, 40);
    const name = String(body.name ?? redo?.name ?? "").trim().slice(0, 120) || null;
    const profile_url = cleanUrl(body.profile_url);
    const post_url = cleanUrl(body.post_url);

    if (!redo && profile_url) {
      const dupe = await db.from("agent_li_prospects").select("id, name, status").ilike("profile_url", profile_url).maybeSingle();
      if (dupe.data) return NextResponse.json({ error: `${dupe.data.name ?? "This person"} is already on the list (${String(dupe.data.status).replace("_", " ")}). Never the same person twice.` }, { status: 409 });
    }

    const code = redo?.code ?? prospectCode();
    const { facts, drafts, ai } = await draftProspect({ pasted, code, name, trigger, sender });
    const fields = { name: facts.name, headline: facts.headline, company: facts.company, hook: facts.hook, trigger: facts.trigger, profession: facts.profession, drafts, updated_at: stamp };

    const saved = redo
      ? await db.from("agent_li_prospects").update(fields).eq("id", redo.id).select(COLS).single()
      : await db.from("agent_li_prospects").insert({ ...fields, code, pasted: pasted.slice(0, 6000), profile_url, post_url, sender }).select(COLS).single();
    if (saved.error) return NextResponse.json({ error: saved.error.message }, { status: 400 });
    return NextResponse.json({ ok: true, ai, prospect: saved.data });
  }

  if (body.action === "status") {
    const status = String(body.status ?? "") as LiStatus;
    if (!LI_STATUSES.includes(status)) return NextResponse.json({ error: "bad status" }, { status: 400 });
    const col = STATUS_STAMP[status];
    const { error } = await db.from("agent_li_prospects").update({ status, updated_at: stamp, ...(col ? { [col]: stamp } : {}) }).eq("id", String(body.id ?? ""));
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true });
  }

  // The follow-up is a second message, not a new status: the person is still "messaged".
  if (body.action === "followup_sent") {
    const { error } = await db.from("agent_li_prospects").update({ followup_sent_at: stamp, updated_at: stamp }).eq("id", String(body.id ?? ""));
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true });
  }

  if (body.action === "notes") {
    const { error } = await db.from("agent_li_prospects").update({ notes: String(body.notes ?? "").slice(0, 2000) || null, updated_at: stamp }).eq("id", String(body.id ?? ""));
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true });
  }

  if (body.settings && typeof body.settings === "object") {
    const next = mergeLiSettings({ ...settings, ...(body.settings as Record<string, unknown>) });
    const { error } = await db.from("agent_system").update({ linkedin: next, updated_at: stamp }).eq("id", true);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true, settings: next });
  }

  return NextResponse.json({ error: "bad request" }, { status: 400 });
}
