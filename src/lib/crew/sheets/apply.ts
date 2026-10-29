import { authorKey } from "../approvals";
import { decide } from "../decide";
import { normalizeHandle, personFor } from "../ledger";
import type { CrewStore } from "../store";
import type { Platform, SheetEntityKind, SheetRow } from "../types";
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

/**
 * The status a word typed over a row's message stands for, or null for
 * anything else (a reworded message). The whole cell must be the word, so no
 * real message is ever read as one. A lead that was sent becomes Contacted; a
 * draft becomes Sent / Posted.
 */
export function statusCommand(value: string, kind: SheetEntityKind): string | null {
  const w = value.trim().toLowerCase().replace(/[\s.!✓✅]+$/u, "");
  if (/^(sent|done|contacted|called|emailed|posted)$/.test(w)) return kind === "lead" ? "Contacted" : "Sent / Posted";
  if (/^(skip|skipped)$/.test(w)) return "Skipped";
  if (w === "not interested") return "Not Interested";
  if (/^unsubscribed?$/.test(w)) return "Unsubscribed";
  return null;
}

export async function applyChange(store: CrewStore, ch: Change, now = new Date()): Promise<Applied> {
  const row = await store.getSheetRow(ch.rowKey);
  if (!row) return { ok: false, message: `no row ${ch.rowKey}` };
  const tab = tabById(row.tab);
  if (!tab) return { ok: false, message: `no tab ${row.tab}` };
  const col = tab.columns.find((c) => c.key === ch.column);
  if (!col) return { ok: false, message: `no column ${ch.column}` };
  const value = String(ch.value ?? "").trim();

  if (col.kind === "status") return applyStatus(store, row, value, ch.by, now);

  // "sent", "skip", "not interested" typed over the message: the one way a
  // row in the three-column Sheet changes what happened with that person.
  const command = col.editable ? statusCommand(value, row.entity_kind) : null;
  if (command) return applyStatus(store, row, command, ch.by, now);

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

/**
 * The owner said they sent it: "sent" typed over the message (statusCommand).
 * The same decision as "I sent it" in the admin page: a draft becomes done by
 * hand and the person is marked as contacted; a lead becomes Contacted, with
 * an "emailed" touch. Deleting a row never comes here (owner, 2026-10-29: a
 * deleted row must not count as outreach); the sync puts the row back.
 */
export async function markSent(store: CrewStore, rowKey: string, by: string, now = new Date()): Promise<Applied> {
  const row = await store.getSheetRow(rowKey);
  if (!row) return { ok: false, message: `no row ${rowKey}` };
  return applyStatus(store, row, row.entity_kind === "lead" ? "Contacted" : "Sent / Posted", by, now);
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
      // The owner did it. Recorded as done; nothing is published, posted or opened as a PR.
      r = await decide(store, a.id, { action: "done_by_hand", by }, now);
    } else if (word === "Skipped") {
      if (a.status === "pending" || a.status === "approved") r = await decide(store, a.id, { action: "reject", reason: "skipped in the Sheet", by }, now);
    } else if (word === "Not Interested" || word === "Unsubscribed") {
      if (a.status === "pending" || a.status === "approved") r = await decide(store, a.id, { action: "reject", reason: word.toLowerCase(), by }, now);
      if (a.person_id) await optOut(store, a.person_id, word, by, a.platform);
      else if (a.platform && typeof a.meta?.author === "string" && a.meta.author.trim()) {
        // A public post with only a display name (Quora, Indie Hackers, LinkedIn comments, Facebook):
        // suppress that name on that platform, so no agent drafts to it there again.
        const value = authorKey(a.platform, a.meta.author);
        await store.addSuppression(value, `${word.toLowerCase()} (Sheet, ${by})`, { source: "sheet", channel: a.platform });
        await log("suppressed", { platform: a.platform, target: value });
      }
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
    const lead = await store.getLead(row.entity_id);
    if (lead?.email && (word === "Not Interested" || word === "Unsubscribed")) {
      await store.addSuppression(normalizeHandle("email", lead.email), `${word.toLowerCase()} (Sheet, ${by})`, { source: "sheet", channel: "email" });
      await log("suppressed", { platform: "email", target: lead.email });
    }
    if (lead?.email && word === "Contacted") {
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

/**
 * What the owner typed into the Suppression List, in the exact form the
 * agents check: "Jane@X.com" → "jane@x.com"; "reddit:spez" or
 * "reddit:/u/Spez" → "reddit:u/spez"; "instagram:Jane" → "instagram:@jane";
 * a profile link works too ("linkedin:https://linkedin.com/in/jane" →
 * "linkedin:in/jane"). Null when it isn't an email, @domain or a known
 * platform:handle (a typo like "instgram:jane" would block no one).
 */
const SUPPRESSIBLE: Platform[] = ["reddit", "instagram", "threads", "bluesky", "facebook", "quora", "indiehackers", "linkedin", "alignable", "tiktok", "pinterest", "youtube", "x", "hackernews"];

export function normalizeSuppression(raw: string): { value: string; channel: string } | null {
  const v = raw.trim();
  if (/^[^@\s:]+@[^@\s]+\.[a-z]{2,}$/i.test(v)) return { value: normalizeHandle("email", v), channel: "email" };
  if (/^@[a-z0-9.-]+\.[a-z]{2,}$/i.test(v)) return { value: v.toLowerCase(), channel: "domain" };
  const m = /^([a-z]+):\s*(.+)$/i.exec(v);
  if (!m) return null;
  const platform = SUPPRESSIBLE.find((p) => p === m[1].toLowerCase());
  if (!platform) return null;
  const handle = normalizeHandle(platform, m[2]);
  return handle && !["u/", "@", "in/"].includes(handle) ? { value: `${platform}:${handle}`, channel: platform } : null;
}

/** A row the owner typed into the Suppression List. */
export async function applySuppressionRow(store: CrewStore, value: string, reason: string, by: string): Promise<boolean> {
  const n = normalizeSuppression(value);
  if (!n) return false;
  await store.addSuppression(n.value, reason.trim() || `added in the Sheet by ${by}`, { source: "sheet", channel: n.channel });
  await logActivity(store, { action: "suppressed", target: n.value, message: reason, approved_by: by });
  return true;
}

/** A row the owner typed into Paste a Post. */
export async function applyPasteRow(store: CrewStore, r: { platform: string; url: string; kind: string; text: string }): Promise<boolean> {
  const platforms: Platform[] = ["facebook", "alignable", "instagram", "linkedin", "threads", "bluesky", "quora", "indiehackers", "reddit", "x", "tiktok", "web"];
  const platform = platforms.find((p) => p === r.platform.trim().toLowerCase());
  const kind = (["post", "profile", "page"] as const).find((k) => k === r.kind.trim().toLowerCase()) ?? "post";
  const text = r.text.trim();
  if (!platform || text.length < 20) return false;
  await store.addInput({ platform, kind, url: /^https?:\/\//i.test(r.url.trim()) ? r.url.trim() : null, text: text.slice(0, 8000) });
  return true;
}
