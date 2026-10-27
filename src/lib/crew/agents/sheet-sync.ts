import type { AgentDef } from "../agent-def";

// ── The Sheet keepers ───────────────────────────────────────────────────────
// Two code-only agents (no AI, no cost) that run the Google Sheets
// headquarters. They sit on the system team with no door of their own: the
// Sheet keeps syncing while the marketing teams are paused, so a Status set
// in the Sheet is still honoured and the Controls tab still works. Only the
// whole-office lock (Pause all) and CREW_DISABLED stop them, and they never
// draft or send anything.
//
// The sync module is imported lazily: it reads the registry (which lists
// these agents), and a static import would be a cycle.

// tier is never used (no model is ever called); "sonnet" keeps the registry rule that every worker is a Sonnet worker.
const sheetFree = { team: "system" as const, role: "worker" as const, tier: "sonnet" as const, freeInEconomy: true, needs: ["GOOGLE_SHEETS_SA_JSON" as const], maxPending: 1, dailyUsd: 0 };

export const sheetSync: AgentDef = {
  ...sheetFree,
  id: "sheet-sync",
  name: "Sheet sync",
  schedule: { kind: "every", minutes: 15 },
  purpose: "Every 15 minutes: reads what you changed in the SwiftCard Leads sheet, writes what the agents found, and rebuilds the Dashboard, Action Queue and stats. No AI.",
  async run(ctx) {
    const { syncSheet } = await import("../sheets/sync");
    const r = await syncSheet(ctx.store, ctx.now());
    ctx.stat("no_llm_needed");
    ctx.stat("sheet_changes", r.changes);
    ctx.stat("sheet_rows_added", r.appended);
    ctx.stat("sheet_rows_updated", r.updated);
    for (const n of r.notes) ctx.log(n);
    if (r.errors.length && !r.sheetId) return { summary: r.errors[0], status: "skipped" };
    const parts = [`${r.changes} of your changes applied${r.refused ? ` (${r.refused} put back)` : ""}`, `${r.appended} rows added`, `${r.updated} updated`];
    if (r.errors.length) throw new Error(`Sheet sync: ${parts.join(", ")}; problems: ${r.errors.join(" | ")}`);
    return { summary: `${parts.join(", ")}.${r.notes.length ? ` ${r.notes.join(" ")}` : ""}` };
  },
};

export const sheetDaily: AgentDef = {
  ...sheetFree,
  id: "sheet-daily",
  name: "Sheet daily snapshot",
  schedule: { kind: "daily", hour: 7, minute: 30 },
  purpose: "At 7:30am New York: a full rebuild of every computed tab, then a dated copy of the workbook in the Shared Drive under SwiftCard Leads/Daily (kept 90 days). No AI.",
  async run(ctx) {
    const { syncSheet } = await import("../sheets/sync");
    const { snapshotWorkbook } = await import("../sheets/snapshot");
    const r = await syncSheet(ctx.store, ctx.now());
    ctx.stat("no_llm_needed");
    if (!r.sheetId) return { summary: r.errors[0] ?? "No workbook yet.", status: "skipped" };
    const snap = await snapshotWorkbook(ctx.store, r.sheetId, ctx.now());
    if (snap.error) throw new Error(`Snapshot: ${snap.error}`);
    return { summary: `Rebuilt the Sheet${snap.url ? ` and saved today's copy (${snap.removed} old copies removed)` : " (no Shared Drive, so no copy was saved)"}.` };
  },
};

export const SHEET_AGENTS: AgentDef[] = [sheetSync, sheetDaily];
