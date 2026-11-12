import type { PreviewListRow } from "./types";

// ── Card Builder: where each prospect is, and who to chase today ────────────
// Pure, so every rule is tested without a database
// (tests/prospect-preview-pipeline.test.ts).
//
// A preview's stage is mostly a FACT, not a setting: it is a draft until it is
// published, sent once the link has gone out, viewed once a real view exists,
// called once the box is ticked. Working it out from those facts means the
// stage can never disagree with them (a "sent" preview with three views that
// nobody remembered to move). Only what a person decides is stored:
// meeting booked, won, lost (the `stage` column).

export const STAGES = ["draft", "ready", "sent", "viewed", "called", "meeting_booked", "won", "lost"] as const;
export type Stage = (typeof STAGES)[number];
export const STAGE_LABELS: Record<Stage, string> = {
  draft: "Draft", ready: "Ready", sent: "Sent", viewed: "Viewed", called: "Called", meeting_booked: "Meeting booked", won: "Won", lost: "Lost",
};

/** The stages a person sets by hand (the outcome of a call). */
export const OUTCOME_STAGES = ["meeting_booked", "won", "lost"] as const;
export type OutcomeStage = (typeof OUTCOME_STAGES)[number];
export const isOutcomeStage = (v: unknown): v is OutcomeStage => (OUTCOME_STAGES as readonly unknown[]).includes(v);

type Staged = Pick<PreviewListRow, "status" | "stage" | "called" | "views" | "sent_at">;

export function stageOf(p: Staged): Stage {
  if (isOutcomeStage(p.stage)) return p.stage;
  if (p.status === "draft") return "draft";
  if (p.called) return "called";
  if (p.views > 0) return "viewed";
  if (p.sent_at) return "sent";
  return "ready";
}

export function stageCounts(rows: Staged[]): Record<Stage, number> {
  const out = Object.fromEntries(STAGES.map((s) => [s, 0])) as Record<Stage, number>;
  for (const r of rows) out[stageOf(r)]++;
  return out;
}

// ── Follow up today ─────────────────────────────────────────────────────────

const DAY = 24 * 60 * 60 * 1000;

export type FollowUpKind = "viewed_not_reached" | "sent_not_viewed" | "asked_no_link" | "called_no_outcome" | "ready_not_sent";
export type FollowUp = {
  id: string;
  kind: FollowUpKind;
  /** What happened, as a sentence about this prospect. */
  why: string;
  /** What to do about it. */
  next: string;
  /** Which screen does that. */
  screen: "call" | "send" | "edit";
};

const daysSince = (iso: string | null, now: number): number => (iso ? Math.floor((now - Date.parse(iso)) / DAY) : 0);
const days = (n: number) => (n === 1 ? "1 day" : `${n} days`);
const ago = (iso: string | null, now: number) => {
  const n = daysSince(iso, now);
  return n < 1 ? "today" : n === 1 ? "yesterday" : `${n} days ago`;
};

type Row = Pick<PreviewListRow, "id" | "status" | "stage" | "called" | "called_at" | "views" | "last_viewed_at" | "sent_at" | "asked_at" | "expires_at" | "updated_at">;

/**
 * Who needs something from you today, most urgent first:
 *
 *   1. viewed but not reached        they looked; call (any age, it only gets colder)
 *   2. sent, not opened after a day  nudge them
 *   3. asked, no link after a day    they haven't said yes; follow up or send it
 *   4. called 2+ days ago, no outcome logged
 *   5. published a day ago and never sent
 *
 * Drafts, and anything with an outcome (meeting booked, won, lost), are not
 * on the list.
 */
export function followUps(rows: Row[], now: number): FollowUp[] {
  const out: (FollowUp & { rank: number; at: number })[] = [];
  for (const r of rows) {
    const stage = stageOf(r);
    const expired = Date.parse(r.expires_at) <= now;
    const expiring = !expired && Date.parse(r.expires_at) - now <= 2 * DAY;
    const linkNote = expired ? " The link has expired: publish it again first." : expiring ? " The link expires within 2 days." : "";
    const add = (rank: number, kind: FollowUpKind, at: string | null, why: string, next: string, screen: FollowUp["screen"]) =>
      out.push({ id: r.id, kind, why, next, screen, rank, at: at ? Date.parse(at) : 0 });

    if (stage === "viewed") {
      add(1, "viewed_not_reached", r.last_viewed_at, `Viewed ${ago(r.last_viewed_at, now)}, not reached yet.`, "Call them.", "call");
    } else if (stage === "sent" && daysSince(r.sent_at, now) >= 1) {
      add(2, "sent_not_viewed", r.sent_at, `Sent ${ago(r.sent_at, now)}, not opened.`, `Send a short nudge.${linkNote}`, "send");
    } else if (stage === "ready" && r.asked_at && daysSince(r.asked_at, now) >= 1) {
      add(3, "asked_no_link", r.asked_at, `Asked ${ago(r.asked_at, now)}, link not sent.`, `Follow up, or send the link.${linkNote}`, "send");
    } else if (stage === "called" && daysSince(r.called_at, now) >= 2) {
      add(4, "called_no_outcome", r.called_at, `Called ${days(daysSince(r.called_at, now))} ago, no outcome logged.`, "Log how it went, or call again.", "call");
    } else if (stage === "ready" && !r.asked_at && daysSince(r.updated_at, now) >= 1) {
      add(5, "ready_not_sent", r.updated_at, "Published, never sent.", `Send the first text.${linkNote}`, "send");
    }
  }
  // Most urgent kind first; within a kind, the most recent event first for
  // "viewed" (the warmest), the oldest first for everything that is overdue.
  return out
    .sort((a, b) => a.rank - b.rank || (a.rank === 1 ? b.at - a.at : a.at - b.at))
    .map((f) => ({ id: f.id, kind: f.kind, why: f.why, next: f.next, screen: f.screen }));
}
