import { getAdminSupabase } from "@/lib/supabase-admin";
import { VIEW_VISIT_WINDOW_MS } from "@/lib/view-window";
import { expiryFrom, readSocials, readSources, readSpecifics, readTeam, type NewPreviewInput, type PreviewFields } from "./input";
import { outcomeEffect, type CallOutcome } from "./call";
import { BUYER_ROLES, CURRENT_TOOLS, DEFAULT_EXPIRY_DAYS, HOOK_ANGLES, TYPE_FEELS, type BuyerRole, type CurrentTool, type HookAngle, type TypeFeel, type DeviceType, type FactSources, type LiveAlert, type PreviewListRow, type ProspectPreview } from "./types";

// ── Card Builder: the database ──────────────────────────────────────────────
// Both tables are RLS-on with no policies (supabase/prospect-previews.sql), so
// everything here uses the service role. SERVER ONLY: no client component may
// import this file (tests/server-only-boundary.test.ts walks the imports).
// Callers gate on requireAdmin(), except the public page's lookup by slug and
// the view beacon's insert, which are the two things a stranger may cause.

const PREVIEWS = "prospect_previews";
const VIEWS = "prospect_preview_views";

/** How long a view counts as "looking right now" for the admin banner. */
export const LIVE_ALERT_WINDOW_MS = 15 * 60 * 1000;

/** Postgres / PostgREST's ways of saying "that table isn't there yet". */
function tableMissing(error: { code?: string; message?: string } | null): boolean {
  return !!error && (error.code === "42P01" || error.code === "PGRST205" || /could not find the table|does not exist/i.test(error.message ?? ""));
}

function toPreview(row: Record<string, unknown>): ProspectPreview {
  return {
    ...(row as unknown as ProspectPreview),
    headshot_url: (row.headshot_url as string | null) ?? null,
    address: (row.address as string | null) ?? null,
    website: (row.website as string | null) ?? null,
    specialty: (row.specialty as string | null) ?? null,
    asked_at: (row.asked_at as string | null) ?? null,
    sent_at: (row.sent_at as string | null) ?? null,
    sent_channel: row.sent_channel === "text" || row.sent_channel === "email" ? row.sent_channel : null,
    stage: (row.stage as string | null) ?? null,
    buyer_role: (BUYER_ROLES as readonly unknown[]).includes(row.buyer_role) ? (row.buyer_role as BuyerRole) : null,
    buyer_reason: (row.buyer_reason as string | null) ?? null,
    team_size: typeof row.team_size === "number" ? row.team_size : null,
    detail: (row.detail as string | null) ?? null,
    license: (row.license as string | null) ?? null,
    type_feel: (TYPE_FEELS as readonly unknown[]).includes(row.type_feel) ? (row.type_feel as TypeFeel) : null,
    current_tool: (CURRENT_TOOLS as readonly unknown[]).includes(row.current_tool) ? (row.current_tool as CurrentTool) : null,
    specifics: readSpecifics(row.specifics),
    hook_specific: typeof row.hook_specific === "number" ? row.hook_specific : null,
    hook_angle: (HOOK_ANGLES as readonly unknown[]).includes(row.hook_angle) ? (row.hook_angle as HookAngle) : null,
    hook_why: (row.hook_why as string | null) ?? null,
    quality_override: row.quality_override === true,
    quality_override_at: (row.quality_override_at as string | null) ?? null,
    call_outcome: (row.call_outcome as string | null) ?? null,
    call_outcome_at: (row.call_outcome_at as string | null) ?? null,
    team_members: readTeam(row.team_members),
    social_links: readSocials(row.social_links),
    sources: readSources(row.sources),
  };
}

export type PreviewList = { ready: true; rows: PreviewListRow[] } | { ready: false; reason: "not_set_up" | "failed" };

/**
 * Every preview with its real views counted. Most recently viewed first; the
 * ones nobody has opened yet follow, newest first.
 */
export async function listPreviews(): Promise<PreviewList> {
  const db = getAdminSupabase();
  const { data, error } = await db.from(PREVIEWS).select("*").order("created_at", { ascending: false }).limit(500);
  if (error) return { ready: false, reason: tableMissing(error) ? "not_set_up" : "failed" };
  const previews = (data ?? []).map(toPreview);
  if (!previews.length) return { ready: true, rows: [] };

  const { data: views, error: viewsError } = await db
    .from(VIEWS)
    .select("preview_id, viewed_at, device_id, team_strip_scrolled")
    .in("preview_id", previews.map((p) => p.id))
    .order("viewed_at", { ascending: false })
    .limit(20000);
  if (viewsError) return { ready: false, reason: tableMissing(viewsError) ? "not_set_up" : "failed" };

  return { ready: true, rows: sortByLastViewed(previews.map((p) => withViews(p, (views ?? []).filter((v) => v.preview_id === p.id)))) };
}

type ViewBit = { viewed_at: string; device_id: string; team_strip_scrolled: boolean };

export function withViews(p: ProspectPreview, views: ViewBit[]): PreviewListRow {
  return {
    ...p,
    views: views.length,
    last_viewed_at: views.reduce<string | null>((latest, v) => (!latest || v.viewed_at > latest ? v.viewed_at : latest), null),
    team_strip_scrolled: views.some((v) => v.team_strip_scrolled),
    devices: new Set(views.map((v) => v.device_id)).size,
  };
}

/** Most recently viewed first; never-viewed after them, newest first. */
export function sortByLastViewed<T extends { last_viewed_at: string | null; created_at: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    if (a.last_viewed_at && b.last_viewed_at) return b.last_viewed_at.localeCompare(a.last_viewed_at);
    if (a.last_viewed_at) return -1;
    if (b.last_viewed_at) return 1;
    return b.created_at.localeCompare(a.created_at);
  });
}

export async function getPreviewBySlug(slug: string): Promise<ProspectPreview | null> {
  const { data } = await getAdminSupabase().from(PREVIEWS).select("*").eq("slug", slug).maybeSingle();
  return data ? toPreview(data) : null;
}

export async function getPreviewById(id: string): Promise<PreviewListRow | null> {
  const db = getAdminSupabase();
  const { data } = await db.from(PREVIEWS).select("*").eq("id", id).maybeSingle();
  if (!data) return null;
  const { data: views } = await db.from(VIEWS).select("viewed_at, device_id, team_strip_scrolled").eq("preview_id", id).limit(5000);
  return withViews(toPreview(data), (views ?? []) as ViewBit[]);
}

export type CreateResult = { ok: true; preview: ProspectPreview } | { ok: false; reason: "slug_taken" | "not_set_up" | "failed" };

export async function createPreview(input: NewPreviewInput): Promise<CreateResult> {
  const { data, error } = await getAdminSupabase().from(PREVIEWS).insert(input).select("*").single();
  if (!error && data) return { ok: true, preview: toPreview(data) };
  if (error?.code === "23505") return { ok: false, reason: "slug_taken" };
  return { ok: false, reason: tableMissing(error) ? "not_set_up" : "failed" };
}

/** Save the edit screen. The link's name, status and expiry are not touched here. */
export async function updatePreview(id: string, fields: PreviewFields, now: Date = new Date()): Promise<boolean> {
  const { data, error } = await getAdminSupabase().from(PREVIEWS).update({ ...fields, updated_at: now.toISOString() }).eq("id", id).select("id");
  return !error && !!data?.length;
}

/**
 * Publish a draft (or a paused preview): the link opens from now. The 14 days
 * start HERE, not when the draft was made, so a draft that waited a week for
 * its research doesn't go out with half its life gone.
 */
export async function publishPreview(id: string, now: Date = new Date()): Promise<boolean> {
  const { data, error } = await getAdminSupabase().from(PREVIEWS)
    .update({ status: "live", expires_at: expiryFrom(DEFAULT_EXPIRY_DAYS, now), updated_at: now.toISOString() })
    .eq("id", id).neq("status", "live").select("id");
  return !error && !!data?.length;
}

/**
 * The owner's override of the quality gate: "I know this one is thin, let it
 * go out anyway" (or taking that back). Only ever set from the edit screen.
 */
export async function setQualityOverride(id: string, on: boolean, now: Date = new Date()): Promise<boolean> {
  const { data, error } = await getAdminSupabase().from(PREVIEWS)
    .update({ quality_override: on, quality_override_at: on ? now.toISOString() : null, updated_at: now.toISOString() }).eq("id", id).select("id");
  return !error && !!data?.length;
}

/** Take a published preview back to a draft: its link answers 404 again. */
export async function unpublishPreview(id: string, now: Date = new Date()): Promise<boolean> {
  const { data, error } = await getAdminSupabase().from(PREVIEWS).update({ status: "draft", updated_at: now.toISOString() }).eq("id", id).select("id");
  return !error && !!data?.length;
}

export async function setBrandColors(id: string, colors: { primary: string; secondary: string }, sources: FactSources, now: Date = new Date()): Promise<boolean> {
  const { error } = await getAdminSupabase().from(PREVIEWS)
    .update({ brand_primary: colors.primary, brand_secondary: colors.secondary, sources, updated_at: now.toISOString() }).eq("id", id);
  return !error;
}

/** Deletes the preview and (on delete cascade) every view of it. */
export async function deletePreview(id: string): Promise<boolean> {
  const { error } = await getAdminSupabase().from(PREVIEWS).delete().eq("id", id);
  return !error;
}

export async function updateCall(id: string, patch: { called?: boolean; notes?: string | null }, now: Date = new Date()): Promise<boolean> {
  const row: Record<string, unknown> = { updated_at: now.toISOString() };
  if (patch.called !== undefined) {
    row.called = patch.called;
    row.called_at = patch.called ? now.toISOString() : null;
  }
  if (patch.notes !== undefined) row.notes = patch.notes;
  const { error } = await getAdminSupabase().from(PREVIEWS).update(row).eq("id", id);
  return !error;
}

/**
 * How a call went, from the Call screen's buttons. A ring-out or a voicemail
 * is logged but doesn't count as reaching them; an outcome that ends the
 * chase (meeting booked, won, lost) sets the stage. See outcomeEffect.
 */
export async function logOutcome(id: string, outcome: CallOutcome, now: Date = new Date()): Promise<boolean> {
  const at = now.toISOString();
  const effect = outcomeEffect(outcome);
  const row: Record<string, unknown> = { call_outcome: outcome, call_outcome_at: at, updated_at: at };
  if (effect.called) Object.assign(row, { called: true, called_at: at });
  if (effect.stage !== undefined) row.stage = effect.stage;
  const { data, error } = await getAdminSupabase().from(PREVIEWS).update(row).eq("id", id).select("id");
  return !error && !!data?.length;
}

/** Put a won / lost / booked preview back in play. */
export async function reopenPreview(id: string, now: Date = new Date()): Promise<boolean> {
  const { error } = await getAdminSupabase().from(PREVIEWS).update({ stage: null, updated_at: now.toISOString() }).eq("id", id);
  return !error;
}

// ── Sending ─────────────────────────────────────────────────────────────────

/**
 * The founder pressed a send button (the message itself goes from their own
 * phone or inbox). "ask" is the first text, which has no link; "text" and
 * "email" carry the link, and only a published, unexpired preview has one.
 */
export async function markSent(id: string, kind: "ask" | "text" | "email", now: Date = new Date()): Promise<"ok" | "not_live" | "failed"> {
  const db = getAdminSupabase();
  const at = now.toISOString();
  if (kind === "ask") {
    const { data, error } = await db.from(PREVIEWS).update({ asked_at: at, updated_at: at }).eq("id", id).select("id");
    return !error && data?.length ? "ok" : "failed";
  }
  const { data, error } = await db.from(PREVIEWS).update({ sent_at: at, sent_channel: kind, updated_at: at })
    .eq("id", id).eq("status", "live").gt("expires_at", at).select("id");
  if (error) return "failed";
  return data?.length ? "ok" : "not_live";
}

/** "I didn't send that after all": back to not asked, not sent. */
export async function clearSent(id: string, now: Date = new Date()): Promise<boolean> {
  const { error } = await getAdminSupabase().from(PREVIEWS).update({ asked_at: null, sent_at: null, sent_channel: null, updated_at: now.toISOString() }).eq("id", id);
  return !error;
}

/** The signed-in admin's own name, for "it's Dana, the founder of SwiftCard". */
export async function senderName(userId: string): Promise<string | null> {
  const { data } = await getAdminSupabase().from("profiles").select("name").eq("id", userId).maybeSingle();
  const name = typeof data?.name === "string" ? data.name.trim() : "";
  return name || null;
}

// ── Views ───────────────────────────────────────────────────────────────────

export type RecordedView = { viewId: string; firstFromDevice: boolean; repeat: boolean } | null;

/**
 * Store one real view. One row per device per visit: the same 30-minute
 * window a card view uses (lib/view-window), so a prospect who reloads or
 * comes back from the calendar page is one view, not five.
 *
 * `firstFromDevice` is decided by the database, not by a read-then-write: the
 * insert claims a partial unique index, and the loser of a race is stored as
 * an ordinary repeat. That flag is what rings the phone, so it must not be
 * possible for two requests to both win it.
 */
export async function recordView(v: { previewId: string; deviceId: string; deviceType: DeviceType; deviceLabel: string | null; now?: Date }): Promise<RecordedView> {
  const db = getAdminSupabase();
  const now = v.now ?? new Date();
  const since = new Date(now.getTime() - VIEW_VISIT_WINDOW_MS).toISOString();

  const { data: recent } = await db.from(VIEWS).select("id").eq("preview_id", v.previewId).eq("device_id", v.deviceId)
    .gte("viewed_at", since).order("viewed_at", { ascending: false }).limit(1);
  if (recent?.length) return { viewId: recent[0].id as string, firstFromDevice: false, repeat: true };

  const row = { preview_id: v.previewId, device_id: v.deviceId, device_type: v.deviceType, device_label: v.deviceLabel, viewed_at: now.toISOString() };
  const first = await db.from(VIEWS).insert({ ...row, first_from_device: true }).select("id").single();
  if (!first.error && first.data) return { viewId: first.data.id as string, firstFromDevice: true, repeat: false };
  if (first.error?.code !== "23505") return null;

  const again = await db.from(VIEWS).insert({ ...row, first_from_device: false }).select("id").single();
  return again.error || !again.data ? null : { viewId: again.data.id as string, firstFromDevice: false, repeat: false };
}

/** The visitor reached the "Your team" strip during this visit. */
export async function markTeamStripScrolled(previewId: string, deviceId: string, now: Date = new Date()): Promise<void> {
  const db = getAdminSupabase();
  const since = new Date(now.getTime() - VIEW_VISIT_WINDOW_MS).toISOString();
  const { data } = await db.from(VIEWS).select("id").eq("preview_id", previewId).eq("device_id", deviceId)
    .gte("viewed_at", since).order("viewed_at", { ascending: false }).limit(1);
  if (data?.length) await db.from(VIEWS).update({ team_strip_scrolled: true }).eq("id", data[0].id);
}

/** Alerts this preview has raised in the last 24 hours (the abuse ceiling). */
export async function alertsInLastDay(previewId: string, now: Date = new Date()): Promise<number> {
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const { count } = await getAdminSupabase().from(VIEWS).select("id", { count: "exact", head: true })
    .eq("preview_id", previewId).eq("alerted", true).gte("viewed_at", since);
  return count ?? 0;
}

export async function markAlerted(viewId: string): Promise<void> {
  await getAdminSupabase().from(VIEWS).update({ alerted: true }).eq("id", viewId);
}

/**
 * Prospects looking right now, for the banner across the admin: views that
 * rang in the last 15 minutes whose preview hasn't been marked "called".
 * Newest first, one per preview.
 */
export async function liveAlerts(now: Date = new Date()): Promise<LiveAlert[]> {
  const db = getAdminSupabase();
  const since = new Date(now.getTime() - LIVE_ALERT_WINDOW_MS).toISOString();
  const { data: views, error } = await db.from(VIEWS).select("id, preview_id, viewed_at, device_label")
    .eq("alerted", true).gte("viewed_at", since).order("viewed_at", { ascending: false }).limit(50);
  if (error || !views?.length) return [];
  const ids = [...new Set(views.map((v) => v.preview_id as string))];
  const { data: previews } = await db.from(PREVIEWS).select("id, owner_name, office_name, phone, called").in("id", ids);
  const byId = new Map((previews ?? []).map((p) => [p.id as string, p]));
  const out: LiveAlert[] = [];
  const seen = new Set<string>();
  for (const v of views) {
    const p = byId.get(v.preview_id as string);
    if (!p || p.called || seen.has(p.id as string)) continue;
    seen.add(p.id as string);
    out.push({
      view_id: v.id as string, preview_id: p.id as string, owner_name: p.owner_name as string,
      office_name: p.office_name as string, phone: p.phone as string, viewed_at: v.viewed_at as string,
      device_label: (v.device_label as string | null) ?? null,
    });
  }
  return out;
}
