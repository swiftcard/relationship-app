import { getAdminSupabase } from "@/lib/supabase-admin";
import { readBatchItems, type Batch, type BatchItem, type MessageEvent } from "./learn";
import { readBackground, type Connection, type OwnerBackground } from "./warm";

// ── Card Builder: the queue, the batches, the connections and the events ────
// SERVER ONLY, service role, like store.ts: every table here is RLS-on with
// no policies (supabase/prospect-previews-round2.sql). Callers gate on
// requireAdmin(); the command-line tool is the one other caller.
//
// Nothing in this file contacts a prospect or LinkedIn. The connections are
// rows the owner uploaded from their own export; the file itself is never kept.

const db = () => getAdminSupabase();

// ── The queue: names, links or notes dropped in from a phone ────────────────

export type QueueItem = { id: string; created_at: string; input: string; is_notes: boolean; status: "queued" | "built" | "skipped" | "failed"; note: string | null; preview_id: string | null; batch_id: string | null };
export const QUEUE_MAX_AT_ONCE = 60;

/**
 * What the Add box holds, as queue items: each line of "names or links" is one
 * prospect; the notes box is ONE prospect however many lines it has.
 */
export function queueItemsFrom(lines: unknown, notes: unknown): { input: string; is_notes: boolean }[] {
  const out: { input: string; is_notes: boolean }[] = [];
  if (typeof lines === "string") {
    for (const l of lines.split(/\r?\n/)) {
      const input = l.replace(/\s+/g, " ").trim().slice(0, 600);
      if (input.length >= 2) out.push({ input, is_notes: false });
      if (out.length >= QUEUE_MAX_AT_ONCE) break;
    }
  }
  if (typeof notes === "string" && notes.trim().length >= 2) out.push({ input: notes.replace(/\r\n?/g, "\n").trim().slice(0, 4000), is_notes: true });
  return out;
}

export async function addToQueue(items: { input: string; is_notes: boolean }[]): Promise<number> {
  if (!items.length) return 0;
  const { data, error } = await db().from("prospect_queue").insert(items).select("id");
  return error ? 0 : data?.length ?? 0;
}

export async function listQueue(status: QueueItem["status"] | "all" = "queued"): Promise<QueueItem[]> {
  let q = db().from("prospect_queue").select("*").order("created_at", { ascending: true }).limit(500);
  if (status !== "all") q = q.eq("status", status);
  const { data } = await q;
  return (data ?? []) as QueueItem[];
}

/** Only something still waiting can be taken out; what a run already built stays as its record. */
export async function removeFromQueue(id: string): Promise<boolean> {
  const { data, error } = await db().from("prospect_queue").delete().eq("id", id).eq("status", "queued").select("id");
  return !error && !!data?.length;
}

export async function settleQueueItem(id: string, outcome: "built" | "skipped" | "failed", extra: { note?: string | null; preview_id?: string | null; batch_id?: string | null }): Promise<boolean> {
  const { data, error } = await db().from("prospect_queue")
    .update({ status: outcome, note: extra.note?.slice(0, 400) ?? null, preview_id: extra.preview_id ?? null, batch_id: extra.batch_id ?? null, updated_at: new Date().toISOString() })
    .eq("id", id).select("id");
  return !error && !!data?.length;
}

// ── Batches ─────────────────────────────────────────────────────────────────

const toBatch = (r: Record<string, unknown>): Batch => ({ ...(r as unknown as Batch), items: readBatchItems(r.items) });

/** A run that was started with the same words in the last day and never finished is the same run: rerunning resumes it. */
export const BATCH_RESUME_MS = 24 * 60 * 60 * 1000;

export async function startBatch(input: { label: string; kind: "now" | "tonight"; wanted: number | null }, now: Date = new Date()): Promise<{ batch: Batch; resumed: boolean } | null> {
  const label = input.label.replace(/\s+/g, " ").trim().slice(0, 200);
  if (!label) return null;
  const since = new Date(now.getTime() - BATCH_RESUME_MS).toISOString();
  const { data: open } = await db().from("prospect_batches").select("*").eq("label", label).eq("status", "running").gte("created_at", since).order("created_at", { ascending: false }).limit(1);
  if (open?.length) return { batch: toBatch(open[0]), resumed: true };
  const { data, error } = await db().from("prospect_batches").insert({ label, kind: input.kind, wanted: input.wanted }).select("*").single();
  return error || !data ? null : { batch: toBatch(data), resumed: false };
}

/** Record one office's outcome as soon as it is known. Logging the same office again replaces its line. */
export async function logBatchItem(id: string, item: BatchItem, now: Date = new Date()): Promise<Batch | null> {
  const { data } = await db().from("prospect_batches").select("*").eq("id", id).maybeSingle();
  if (!data) return null;
  const [clean] = readBatchItems([{ ...item, at: now.toISOString() }]);
  if (!clean) return null;
  const items = [...readBatchItems(data.items).filter((i) => i.office.toLowerCase() !== clean.office.toLowerCase()), clean];
  const { data: saved, error } = await db().from("prospect_batches").update({ items }).eq("id", id).select("*").single();
  return error || !saved ? null : toBatch(saved);
}

export async function finishBatch(id: string, now: Date = new Date()): Promise<Batch | null> {
  const { data, error } = await db().from("prospect_batches").update({ status: "finished", finished_at: now.toISOString() }).eq("id", id).select("*").maybeSingle();
  return error || !data ? null : toBatch(data);
}

export async function recentBatches(limit = 5): Promise<Batch[]> {
  const { data } = await db().from("prospect_batches").select("*").order("created_at", { ascending: false }).limit(limit);
  return (data ?? []).map(toBatch);
}

/** Finished batches whose push hasn't gone. Claiming one is a single update, so two clocks can't both announce it. */
export async function claimUnannouncedBatches(kinds: Batch["kind"][], now: Date = new Date()): Promise<Batch[]> {
  if (!kinds.length) return [];
  const { data, error } = await db().from("prospect_batches").update({ announced_at: now.toISOString() }).eq("status", "finished").is("announced_at", null).in("kind", kinds).select("*");
  return error ? [] : (data ?? []).map(toBatch);
}

// ── The owner's LinkedIn connections ────────────────────────────────────────

/** A new upload replaces the last one: the export is always the whole list. */
export async function replaceConnections(rows: Connection[]): Promise<number | null> {
  const d = db();
  const { error: gone } = await d.from("linkedin_connections").delete().gte("id", 0);
  if (gone) return null;
  let saved = 0;
  for (let i = 0; i < rows.length; i += 1000) {
    const { error } = await d.from("linkedin_connections").insert(rows.slice(i, i + 1000));
    if (error) return null;
    saved += Math.min(1000, rows.length - i);
  }
  await setSetting("linkedin_upload", { count: saved, at: new Date().toISOString() });
  return saved;
}

export async function clearConnections(): Promise<boolean> {
  const { error } = await db().from("linkedin_connections").delete().gte("id", 0);
  if (!error) await setSetting("linkedin_upload", { count: 0, at: null });
  return !error;
}

/** Every connection that names a company: the only ones a warm path can come from. */
export async function listConnections(): Promise<Connection[]> {
  const out: Connection[] = [];
  for (let from = 0; from < 30000; from += 1000) {
    const { data, error } = await db().from("linkedin_connections")
      .select("first_name, last_name, url, company, position, connected_on, company_key").not("company_key", "is", null).order("id").range(from, from + 999);
    if (error || !data?.length) break;
    out.push(...(data as Connection[]));
    if (data.length < 1000) break;
  }
  return out;
}

// ── Small owner-level values ────────────────────────────────────────────────

export async function getSetting<T>(key: string): Promise<T | null> {
  const { data } = await db().from("card_builder_settings").select("value").eq("key", key).maybeSingle();
  return (data?.value as T | undefined) ?? null;
}

export async function setSetting(key: string, value: unknown): Promise<boolean> {
  const { error } = await db().from("card_builder_settings").upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: "key" });
  return !error;
}

export const ownerBackground = async (): Promise<OwnerBackground> => readBackground(await getSetting("owner_background"));
export type UploadMeta = { count: number; at: string | null };
export const uploadMeta = async (): Promise<UploadMeta> => (await getSetting<UploadMeta>("linkedin_upload")) ?? { count: 0, at: null };

// ── Events: edits, picks, sends ─────────────────────────────────────────────

/** Never throws and never blocks the action it records: learning is a by-product. */
export async function recordEvents(events: Omit<MessageEvent, "at">[]): Promise<void> {
  if (!events.length) return;
  try {
    const rows = events.map((e) => ({ ...e, before: e.before?.slice(0, 4000) ?? null, after: e.after?.slice(0, 4000) ?? null }));
    const { error } = await db().from("prospect_message_events").insert(rows);
    if (error) console.error("[card-builder events]", error.message);
  } catch (e) {
    console.error("[card-builder events]", e instanceof Error ? e.message : e);
  }
}

export async function listEvents(limit = 2000): Promise<MessageEvent[]> {
  const { data } = await db().from("prospect_message_events").select("at, preview_id, kind, message, variant, before, after").order("at", { ascending: false }).limit(limit);
  return (data ?? []) as MessageEvent[];
}
