import { decide } from "../decide";
import type { CrewStore } from "../store";
import type { Platform, SheetRow } from "../types";
import { logActivity } from "./activity";
import { applyControl } from "./controls";
import { PIPELINE_STATUSES, TASK_STATUSES } from "./spec";
import { SENT_WORDS } from "./status";
import { tabById } from "./tabs";

// ── What a change in the Sheet does ─────────────────────────────────────────
// The Sheet's "buttons" are its cells. A Status set by the owner (through the
// Apps Script hook within seconds, or the 15-minute poll) becomes the same
// decision the admin page's buttons make, through decide(): nothing here
// posts or sends on its own, and Sent / Posted never sends anything; it
// records that the owner did. Not Interested and Unsubscribed stop every
// channel for that person: a suppression entry per identity and an opted_out
// touch, which the DM rule (crew_claim_dm) already refuses to cross.

export type Change = { rowKey: string; column: string; value: string; by: string };
export type Applied = { ok: boolean; message: string; status?: string };

const STATUS_WORDS = new Set<string>([...TASK_STATUSES, ...PIPELINE_STATUSES]);

export async function applyChange(store: CrewStore, ch: Change, now = new Date()): Promise<Applied> {
  const row = await store.getSheetRow(ch.rowKey);
  if (!row) return { ok: false, message: `no row ${ch.rowKey}` };
  const tab = tabById(row.tab);
  if (!tab) return { ok: false, message: `no tab ${row.tab}` };
  const col = tab.columns.find((c) => c.key === ch.column);
  if (!col) return { ok: false, message: `no column ${ch.column}` };
  const value = String(ch.value ?? "").trim();

  if (col.kind === "status") return applyStatus(store, row, value, ch.by, now);

  if (col.editable) {
    if (row.entity_kind !== "approval") return { ok: false, message: "not editable" };
    const a = await store.getApproval(row.entity_id);
    if (!a) return { ok: false, message: "draft gone" };
    if (value === a.body.trim() || !value) return { ok: true, message: "unchanged" };
    if (a.status !== "pending" && a.status !== "approved") return { ok: false, message: "already sent; the text can't change now" };
    await store.addEdit({ agent_id: a.agent_id, kind: a.kind, approval_id: a.id, before: a.body, after: value });
    await store.updateApproval(a.id, { body: value });
    await store.patchSheetRow(row.row_key, { owner_cols: { ...row.owner_cols, [ch.column]: value }, owner_edited_at: now.toISOString() });
    await logActivity(store, { agent_id: a.agent_id, platform: a.platform, action: "edit", target: a.target_url, message: value, row_key: row.row_key, approved_by: ch.by });
    return { ok: true, message: "edited; the agent learns from it" };
  }

  if (col.owner) {
    if (row.owner_cols[ch.column] === value) return { ok: true, message: "unchanged" };
    await store.patchSheetRow(row.row_key, { owner_cols: { ...row.owner_cols, [ch.column]: value }, owner_edited_at: now.toISOString() });
    return { ok: true, message: "noted" };
  }
  return { ok: false, message: `${col.header} is written by the agent; your change will be put back` };
}

async function applyStatus(store: CrewStore, row: SheetRow, word: string, by: string, now: Date): Promise<Applied> {
  if (!word || word === row.status) return { ok: true, message: "unchanged", status: row.status };
  if (!STATUS_WORDS.has(word)) return { ok: false, message: `"${word}" isn't a status`, status: row.status };
  const log = (action: string, extra: Partial<Parameters<typeof logActivity>[1]> = {}) => logActivity(store, { action, row_key: row.row_key, approved_by: by, message: `${row.status} → ${word}`, ...extra });

  if (row.entity_kind === "approval") {
    const a = await store.getApproval(row.entity_id);
    if (!a) return { ok: false, message: "draft gone", status: row.status };
    let r: { ok: boolean; message: string } = { ok: true, message: "" };
    if (word === "Approved") {
      // The social post's first step is a pick: the owner types 1, 2 or 3 in Notes.
      const choice = Array.isArray(a.meta?.options) ? /\b([1-3])\b/.exec(row.owner_cols.notes ?? "")?.[1] : undefined;
      if (a.status === "pending") r = await decide(store, a.id, { action: "approve", by, ...(choice ? { choice } : {}) }, now);
      else if (a.status !== "approved") r = { ok: false, message: "already decided" };
    } else if ((SENT_WORDS as string[]).includes(word)) {
      if (a.status === "pending") r = await decide(store, a.id, { action: "approve", by }, now);
      const fresh = await store.getApproval(a.id);
      if (r.ok && fresh?.status === "approved") r = await decide(store, a.id, { action: "posted", by }, now);
    } else if (word === "Skipped") {
      if (a.status === "pending" || a.status === "approved") r = await decide(store, a.id, { action: "reject", reason: "skipped in the Sheet", by }, now);
    } else if (word === "Not Interested" || word === "Unsubscribed") {
      if (a.status === "pending" || a.status === "approved") r = await decide(store, a.id, { action: "reject", reason: word.toLowerCase(), by }, now);
      if (a.person_id) await optOut(store, a.person_id, word, by, a.platform);
    }
    // New / Ready / Needs Review / Replied / Expired / Failed: a note on the row only.
    if (!r.ok) {
      await log("status", { agent_id: a.agent_id, platform: a.platform, result: "failed", error: r.message });
      return { ok: false, message: r.message, status: row.status };
    }
    await store.patchSheetRow(row.row_key, { status: word, owner_edited_at: now.toISOString() });
    await log("status", { agent_id: a.agent_id, platform: a.platform, target: a.target_url });
    return { ok: true, message: r.message || `now ${word}`, status: word };
  }

  if (row.entity_kind === "lead") {
    const lead = (await store.listLeads("cold", 5000)).find((l) => l.id === row.entity_id) ?? (await store.listLeads("office", 5000)).find((l) => l.id === row.entity_id);
    if (lead?.email && (word === "Not Interested" || word === "Unsubscribed")) {
      await store.addSuppression(lead.email, `${word.toLowerCase()} (Sheet, ${by})`, { source: "sheet", channel: "email" });
      await log("suppressed", { platform: "email", target: lead.email });
    }
    if (lead?.email && word === "Contacted") {
      const { personFor } = await import("../ledger");
      const pid = await personFor(store, "email", lead.email, lead.name);
      if (pid) await store.addTouch(pid, "email", "emailed", null);
    }
    await store.patchSheetRow(row.row_key, { status: word, owner_edited_at: now.toISOString() });
    await log("status", { platform: lead?.source_platform ?? null, target: lead?.email ?? lead?.company ?? null });
    return { ok: true, message: `now ${word}`, status: word };
  }

  // Pipeline (a person) and custom rows.
  if (row.tab === "pipeline" && (word === "Not Interested" || word === "Unsubscribed")) await optOut(store, row.entity_id, word, by, null);
  await store.patchSheetRow(row.row_key, { status: word, owner_edited_at: now.toISOString() });
  await log("status");
  return { ok: true, message: `now ${word}`, status: word };
}

/** Every channel stops for this person: suppression per identity, and a touch no agent crosses. */
export async function optOut(store: CrewStore, personId: string, word: string, by: string, platform: Platform | null): Promise<void> {
  const ids = await store.identitiesFor(personId);
  for (const i of ids) {
    const value = i.platform === "email" ? i.handle_norm : `${i.platform}:${i.handle_norm}`;
    await store.addSuppression(value, `${word.toLowerCase()} (Sheet, ${by})`, { source: "sheet", channel: i.platform === "email" ? "email" : i.platform });
  }
  await store.addTouch(personId, platform ?? ((ids[0]?.platform as Platform) ?? "web"), "opted_out", null);
  await logActivity(store, { action: "suppressed", platform, target: ids.map((i) => i.handle_norm).join(", "), message: word, approved_by: by });
}

/** A Controls cell. */
export async function applyControlCell(store: CrewStore, key: string, value: string, by: string) {
  return applyControl(store, key, value, by);
}

/** A row the owner typed into the Suppression List. */
export async function applySuppressionRow(store: CrewStore, value: string, reason: string, by: string): Promise<boolean> {
  const v = value.trim().toLowerCase();
  if (!v) return false;
  const email = /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(v);
  const domain = /^@[a-z0-9.-]+\.[a-z]{2,}$/i.test(v);
  const handle = /^[a-z]+:.+$/i.test(v);
  if (!email && !domain && !handle) return false;
  await store.addSuppression(v, reason.trim() || `added in the Sheet by ${by}`, { source: "sheet", channel: email ? "email" : domain ? "domain" : v.split(":")[0] });
  await logActivity(store, { action: "suppressed", target: v, message: reason, approved_by: by });
  return true;
}

/** A row the owner typed into Paste a Post. */
export async function applyPasteRow(store: CrewStore, r: { platform: string; url: string; kind: string; text: string }): Promise<boolean> {
  const platforms: Platform[] = ["facebook", "alignable", "instagram", "linkedin", "threads", "bluesky", "quora", "indiehackers", "reddit", "web"];
  const platform = platforms.find((p) => p === r.platform.trim().toLowerCase());
  const kind = (["post", "profile", "page"] as const).find((k) => k === r.kind.trim().toLowerCase()) ?? "post";
  const text = r.text.trim();
  if (!platform || text.length < 20) return false;
  await store.addInput({ platform, kind, url: /^https?:\/\//i.test(r.url.trim()) ? r.url.trim() : null, text: text.slice(0, 8000) });
  return true;
}
