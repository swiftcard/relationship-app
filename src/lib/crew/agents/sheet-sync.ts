import type { AgentDef } from "../agent-def";

// ── The Sheet keepers ───────────────────────────────────────────────────────
// Two code-only agents (no AI, no cost) that run the Google Sheets
// headquarters. They are infrastructure: always on, with no switch anywhere,
// and they keep running through Pause all, because the sync is what reads the
// Sheet's Controls (a Pause all set in the Sheet must be liftable from the
// Sheet) and what records the Statuses the owner sets. Only CREW_DISABLED
// stops them. They never draft, post or send anything.
//
// The sync module is imported lazily: it reads the registry (which lists
// these agents), and a static import would be a cycle.

// tier is never used (no model is ever called); "sonnet" keeps the registry rule that every worker is a Sonnet worker.
const sheetFree = { team: "system" as const, role: "worker" as const, tier: "sonnet" as const, infrastructure: true, freeInEconomy: true, needs: ["GOOGLE_SHEETS_SA_JSON" as const], maxPending: 1, dailyUsd: 0 };

/** Why a lead isn't on the Sheet, in the run summary. */
const LEAD_REASON = { region_restricted: "kept off by the privacy rules", finished: "already finished", no_link: "with no email or website" } as const;

export const sheetSync: AgentDef = {
  ...sheetFree,
  id: "sheet-sync",
  name: "Sheet sync",
  schedule: { kind: "every", minutes: 15 },
  purpose: "Every 15 minutes: puts what the agents wrote into the SwiftCard Leads sheet as Name, Message, Link, takes off anything already sent, skipped or expired (type sent, skip or not interested over a message), and puts back a row you deleted without recording anything. No AI.",
  async run(ctx) {
    const { syncSheet } = await import("../sheets/sync");
    const r = await syncSheet(ctx.store, ctx.now());
    ctx.stat("no_llm_needed");
    ctx.stat("sheet_changes", r.changes);
    ctx.stat("sheet_rows_added", r.appended);
    ctx.stat("sheet_rows_updated", r.updated);
    ctx.stat("sheet_rows_restored", r.restored);
    ctx.stat("sheet_rows_not_restored", r.notRestored);
    for (const n of r.notes) ctx.log(n);
    if (r.errors.length && !r.sheetId) return { summary: r.errors[0], status: "skipped" };
    const parts = [`${r.changes} of your changes applied${r.refused ? ` (${r.refused} put back)` : ""}`, `${r.appended} rows added`, `${r.updated} updated`];
    if (r.restored) parts.push(`${r.restored} deleted rows put back (nothing recorded as sent)`);
    if (r.notRestored) parts.push(`${r.notRestored} deleted rows not put back because a row on the tab lost its Key`);
    if (r.leads) {
      // Where every lead stands, in counts; a lead that can't be listed is logged by id with the reason.
      const l = r.leads;
      ctx.stat("sheet_leads_listed", l.listed);
      ctx.stat("sheet_leads_ready", l.ready);
      ctx.stat("sheet_leads_need_message", l.needsMessage);
      for (const [reason, n] of Object.entries(l.unlisted)) ctx.stat(`sheet_leads_not_listed_${reason}`, n);
      for (const m of l.missing) ctx.log(`lead ${m.id} not on the Sheet: ${m.reason}`);
      const off = Object.entries(l.unlisted).filter(([, n]) => n).map(([reason, n]) => `${n} ${LEAD_REASON[reason as keyof typeof LEAD_REASON]}`);
      parts.push(`leads on the Sheet: ${l.listed} (${l.ready} ready, ${l.needsMessage} need a message)${off.length ? `; not listed: ${off.join(", ")}` : ""}`);
    }
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
