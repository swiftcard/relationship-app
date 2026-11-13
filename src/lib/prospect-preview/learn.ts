import { stageOf } from "./pipeline";
import { assessQuality } from "./quality";
import type { PreviewListRow } from "./types";

// ── Card Builder: what the owner's own choices teach it ─────────────────────
// Three things are kept (prospect_message_events): each EDIT the owner makes
// to a written message, which version of the first text they PICK, and each
// message they SEND. From those and what happened next (a real view, a call
// that reached them, a meeting booked), this works out what is working, and
// hands the owner's own edits to /build-card as examples of their voice.
//
// Pure, so the arithmetic is tested (tests/prospect-preview-round2.test.ts).
// "Viewed" and the rest are facts about the PROSPECT after a message went,
// not proof that the message caused them: with a handful of sends the table
// says what happened, not what works. It says so on the screen.

export type MessageEvent = { at: string; preview_id: string; kind: "edit" | "pick" | "sent"; message: string; variant: string | null; before: string | null; after: string | null };

export type MessageStat = { message: string; variant: string | null; sent: number; viewed: number; picked_up: number; booked: number };

export const STAT_LABELS: Record<string, string> = {
  ask: "First text", text: "Text with the link", email: "Email", nudge_no_view: "Nudge: not opened", nudge_viewed: "Nudge: didn't pick up",
  linkedin_note: "LinkedIn note", linkedin_dm: "LinkedIn message",
};

/**
 * Per message (and per version of the first text): how many prospects it went
 * to, and of those how many then really viewed their card, were reached on a
 * call, and booked a meeting. One prospect counts once per message.
 */
export function messageStats(events: MessageEvent[], rows: PreviewListRow[]): MessageStat[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const firstSend = new Map<string, MessageEvent>();
  for (const e of [...events].sort((a, b) => a.at.localeCompare(b.at))) {
    if (e.kind !== "sent") continue;
    const key = `${e.preview_id}|${e.message}`;
    if (!firstSend.has(key)) firstSend.set(key, e);
  }
  const out = new Map<string, MessageStat>();
  for (const e of firstSend.values()) {
    const r = byId.get(e.preview_id);
    if (!r) continue;
    const key = `${e.message}|${e.variant ?? ""}`;
    const s = out.get(key) ?? { message: e.message, variant: e.variant, sent: 0, viewed: 0, picked_up: 0, booked: 0 };
    s.sent++;
    if (r.last_viewed_at && r.last_viewed_at >= e.at) s.viewed++;
    if (r.called && (r.called_at ?? "") >= e.at) s.picked_up++;
    const stage = stageOf(r);
    if (stage === "meeting_booked" || stage === "won") s.booked++;
    out.set(key, s);
  }
  const order = Object.keys(STAT_LABELS);
  return [...out.values()].sort((a, b) => order.indexOf(a.message) - order.indexOf(b.message) || (a.variant ?? "").localeCompare(b.variant ?? ""));
}

export type StyleNotes = {
  /** The owner's most recent edits, newest first: what was written, and what they changed it to. */
  edits: { message: string; before: string; after: string }[];
  /** How often they picked each version of the first text. */
  picks: { a: number; b: number };
  /** Messages they sent in their own words, changed on the Send screen at the last moment. */
  sent_as: { message: string; words: string }[];
};

/** What /build-card reads before it writes: the owner's voice, in their own corrections. */
export function styleNotes(events: MessageEvent[], limit = 20): StyleNotes {
  const newest = [...events].sort((a, b) => b.at.localeCompare(a.at));
  const edits = newest.filter((e) => e.kind === "edit" && e.before && e.after).slice(0, limit).map((e) => ({ message: e.message, before: e.before!, after: e.after! }));
  const picks = { a: 0, b: 0 };
  for (const e of newest) if (e.kind === "pick" && (e.variant === "a" || e.variant === "b")) picks[e.variant]++;
  const sent_as = newest.filter((e) => e.kind === "sent" && e.before && e.after && e.before !== e.after).slice(0, limit).map((e) => ({ message: e.message, words: e.after! }));
  return { edits, picks, sent_as };
}

// ── The batch brief ─────────────────────────────────────────────────────────

export type BatchItem = { office: string; outcome: "built" | "skipped" | "failed"; preview_id?: string | null; reason?: string | null; at?: string };
export type Batch = { id: string; created_at: string; label: string; kind: "now" | "tonight"; wanted: number | null; status: "running" | "finished"; finished_at: string | null; items: BatchItem[]; announced_at: string | null };

export function readBatchItems(v: unknown): BatchItem[] {
  if (!Array.isArray(v)) return [];
  const out: BatchItem[] = [];
  for (const raw of v) {
    const r = (raw ?? {}) as Record<string, unknown>;
    const office = typeof r.office === "string" ? r.office.trim().slice(0, 160) : "";
    const outcome = r.outcome === "built" || r.outcome === "skipped" || r.outcome === "failed" ? r.outcome : null;
    if (!office || !outcome) continue;
    out.push({
      office, outcome,
      preview_id: typeof r.preview_id === "string" ? r.preview_id : null,
      reason: typeof r.reason === "string" ? r.reason.replace(/\s+/g, " ").trim().slice(0, 240) || null : null,
      at: typeof r.at === "string" ? r.at : undefined,
    });
  }
  return out;
}

export type BatchBrief = {
  id: string; label: string; kind: Batch["kind"]; finished: boolean; finished_at: string | null;
  /** Its drafts still waiting for the owner, best score first. */
  ready: { id: string; office: string; owner: string; score: number; tooGeneric: boolean }[];
  built: number;
  /** Left out, grouped by why: "already contacted (3)". */
  skipped: { reason: string; offices: string[] }[];
  skippedCount: number;
};

/** "Ready to approve": how many drafts, best score first, how many were skipped and why. */
export function batchBrief(batch: Batch, rows: PreviewListRow[]): BatchBrief {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const built = batch.items.filter((i) => i.outcome === "built");
  const ready = built
    .map((i) => (i.preview_id ? byId.get(i.preview_id) : undefined))
    .filter((r): r is PreviewListRow => !!r && r.status === "draft" && !r.skipped_at)
    .map((r) => { const q = assessQuality(r); return { id: r.id, office: r.office_name, owner: r.owner_name, score: q.score, tooGeneric: !q.mayPublish }; })
    .sort((a, b) => b.score - a.score);
  const groups = new Map<string, string[]>();
  for (const i of batch.items) {
    if (i.outcome === "built") continue;
    const reason = i.reason || (i.outcome === "failed" ? "something went wrong" : "skipped");
    groups.set(reason, [...(groups.get(reason) ?? []), i.office]);
  }
  const skipped = [...groups.entries()].map(([reason, offices]) => ({ reason, offices })).sort((a, b) => b.offices.length - a.offices.length);
  return { id: batch.id, label: batch.label, kind: batch.kind, finished: batch.status === "finished", finished_at: batch.finished_at, ready, built: built.length, skipped, skippedCount: batch.items.length - built.length };
}

/** The lock-screen words for a finished batch. */
export function batchPush(b: BatchBrief): { title: string; body: string } {
  const n = b.ready.length;
  const best = b.ready[0];
  return {
    title: n === 1 ? "1 draft ready to approve" : `${n} drafts ready to approve`,
    body: [best ? `Best: ${best.office}, ${best.score} of 100.` : `${b.built} built.`, b.skippedCount ? `${b.skippedCount} skipped.` : ""].filter(Boolean).join(" ").slice(0, 170),
  };
}
