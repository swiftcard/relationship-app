import type { AgentDef } from "../agent-def";
import { readErrorEvents, type ErrorEvent } from "../sources/error-events";
import { fingerprintOf, reportFindings, type RawFinding } from "../watch/findings";

// ── W1 Bug watch (every 15 minutes) ─────────────────────────────────────────
// Reads new production crashes, groups them by fingerprint, and only asks a
// model about ones it has not seen before (or that came back). A quiet
// quarter-hour costs nothing.

/**
 * One crash, one key: the error's own fingerprint with the one-word label in
 * brackets taken out, so "push not delivered (card_view): web 403" and
 * "push not delivered (weekly_recap): web 403" are one card (they were three).
 */
export function bugKey(fingerprint: string): string {
  return fingerprint.replace(/\([a-z0-9_.-]+\)/gi, "(<x>)");
}

export function groupErrors(rows: ErrorEvent[]): RawFinding[] {
  const groups = new Map<string, { n: number; first: ErrorEvent; last: ErrorEvent; old: Set<string> }>();
  for (const r of rows) {
    const key = bugKey(r.fingerprint);
    const g = groups.get(key);
    if (g) {
      g.n++;
      g.last = r;
      g.old.add(r.fingerprint);
    } else groups.set(key, { n: 1, first: r, last: r, old: new Set([r.fingerprint]) });
  }
  return [...groups.entries()].map(([fp, g]) => ({
    fingerprint: `bug:${fingerprintOf(fp)}`,
    // How each was keyed before 2026-10-29, so a card already raised still counts.
    aliases: [...g.old].filter((o) => o !== fp).map((o) => `bug:${fingerprintOf(o)}`),
    kind: "bug" as const,
    source: "error_events",
    title: `${g.first.context}: ${g.first.message}`.slice(0, 200),
    count: g.n,
    detail: {
      context: g.first.context,
      message: g.first.message.slice(0, 500),
      stack: (g.first.stack ?? "").slice(0, 1500),
      extra: g.first.extra ?? null,
      last_at: g.last.created_at,
    },
  }));
}

const QUIET_DAYS_TO_CLOSE = 3;

export const watchBugs: AgentDef = {
  id: "watch-bugs",
  name: "Bug watch",
  team: "watchdog",
  role: "worker",
  tier: "sonnet",
  schedule: { kind: "every", minutes: 15 },
  dailyUsd: 1,
  // No key needed: in economy mode (or with no Claude key) it runs with no AI.
  needs: [],
  freeInEconomy: true,
  maxPending: 6,
  purpose: "Every 15 minutes, looks for new crashes on the site. New ones become a Fix card in plain words.",
  approvalKind: "code_fix",
  async run(ctx) {
    const since = ctx.config<string>("cursor", new Date(ctx.now().getTime() - 3600_000).toISOString());
    const rows = await readErrorEvents(since);
    const raws = groupErrors(rows);
    const r = await reportFindings(ctx, raws);
    if (rows.length) await ctx.saveConfig({ cursor: rows[rows.length - 1].created_at });
    // A bug not seen for 3 days is treated as fixed; if it comes back it is new again.
    const cutoff = ctx.now().getTime() - QUIET_DAYS_TO_CLOSE * 86400_000;
    for (const f of await ctx.store.listFindings(["open", "proposed"], 300)) {
      if (f.agent_id === ctx.def.id && new Date(f.last_seen).getTime() < cutoff) {
        await ctx.store.patchFinding(f.id, { status: "fixed" });
        ctx.stat("findings_cleared");
      }
    }
    ctx.stat("errors_read", rows.length);
    return {
      summary: rows.length ? `Read ${rows.length} new errors in ${raws.length} groups; ${r.fresh} new, ${r.proposed} fix cards.` : "All quiet: no new errors.",
    };
  },
};
