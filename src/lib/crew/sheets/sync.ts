import { blueskyConfigured, sheetShareEmails } from "../env";
import { a1, appendRows, batchGet, batchUpdateValues, clearRange, colLetter, sheetUrl, type CellValue, type ValueWrite } from "../google/sheets";
import { nyDayStart } from "../schedule";
import type { CrewStore } from "../store";
import type { Approval } from "../types";
import { logActivity } from "./activity";
import { applyChange, applyControlCell, applyPasteRow, applySuppressionRow } from "./apply";
import { HEADER_ROWS, createWorkbook, ensureWorkbook, shareWorkbook, sheetsHqConfigured, workbookId } from "./bootstrap";
import { dryRun } from "./controls";
import { activityRows, controlsRows, dashboardCells, intentRows, performanceRows, queueRows, sourceStatsRows, suppressionRows, top50Rows, type Counts, type Placement } from "./derived";
import { agentHash, buildRows, type BuiltRow, type RowSources } from "./rows";
import type { TabSpec } from "./spec";
import { ACTIVITY, ALL_TABS, CONTROLS, DASHBOARD, INTENT, PASTE, PERFORMANCE, QUEUE, SOURCE_STATS, SUPPRESSION, TOP50 } from "./tabs";

// ── One sync: read the Sheet, apply what the owner changed, write what the
// agents made, rebuild the computed tabs ────────────────────────────────────
// Runs every 15 minutes from the sheet-sync agent and on demand. Order
// matters: the owner's edits are read and applied BEFORE anything is written,
// so a Status set in the Sheet wins over what the database thought. Rows are
// found by their Key column, never by position, so sorting and filtering in
// the Sheet are safe. Everything is counted, nothing is modelled: a sync
// costs no AI. Requests: one read for every tab, one write for every changed
// cell, a clear and a write per computed tab: a few dozen a run, well inside
// the 300-a-minute quota.

export const MAX_ROWS = 3000;
export const APPROVAL_DAYS = 45;

export type SyncReport = {
  sheetId: string | null;
  url: string | null;
  tabsRead: number;
  changes: number;
  refused: number;
  updated: number;
  appended: number;
  derived: number;
  errors: string[];
  notes: string[];
};

const EDITOR = "sheet";
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 200);

function dataRange(tab: TabSpec): string {
  return a1(tab.name, `A${HEADER_ROWS + 1}:${colLetter(Math.max(tab.columns.length, 1) - 1)}${MAX_ROWS}`);
}

/** Tabs whose cells the owner may change, plus the input tabs. */
export function readableTabs(): TabSpec[] {
  return ALL_TABS.filter((t) => t.layout !== "free" && t.layout !== "placeholder" && (t.layout === "input" || t.columns.some((c) => c.owner || c.editable || c.kind === "status")));
}

export async function loadSources(store: CrewStore, now: Date): Promise<RowSources> {
  const since = new Date(now.getTime() - APPROVAL_DAYS * 86400_000).toISOString();
  const [approvals, cold, office, findings, people, facts, known, geoState] = await Promise.all([
    store.listApprovals({ sinceIso: since, limit: 2000 }),
    store.listLeads("cold", 2500),
    store.listLeads("office", 800),
    store.listFindings(["open", "proposed", "fixed"], 300),
    store.listTouchedPeople(400),
    store.competitorFacts(),
    store.listSheetRows(),
    store.getAgentState("marketing-geo"),
  ]);
  return {
    approvals: approvals.filter((a) => a.team !== "watchdog"),
    leads: [...cold, ...office].sort((x, y) => (x.created_at < y.created_at ? -1 : 1)),
    findings,
    people,
    facts,
    geoHistory: ((geoState.config.history as { day: string; q: string; mentioned: boolean }[] | undefined) ?? []).slice(-120),
    known: new Map(known.map((r) => [r.row_key, r])),
    blueskyLive: blueskyConfigured(),
  };
}

type PendingChange = { tab: TabSpec; key: string; col: string; value: string; cell: string; before: string };

export async function syncSheet(store: CrewStore, now = new Date()): Promise<SyncReport> {
  const report: SyncReport = { sheetId: null, url: null, tabsRead: 0, changes: 0, refused: 0, updated: 0, appended: 0, derived: 0, errors: [], notes: [] };
  if (!(await store.sheetsReady())) return { ...report, errors: ["Run supabase/crew-sheets.sql first."] };
  if (!sheetsHqConfigured()) return { ...report, errors: ["Needs GOOGLE_SHEETS_SA_JSON and CREW_SHEET_ID (or CREW_SHARED_DRIVE_ID to create the workbook)."] };

  let id = await workbookId(store);
  if (!id) {
    const made = await createWorkbook(store);
    if (!made) return { ...report, errors: ["No workbook: set CREW_SHEET_ID, or CREW_SHARED_DRIVE_ID so one can be created."] };
    id = made.id;
    report.notes.push(`Created the workbook: ${made.url}. Set CREW_SHEET_ID=${made.id} in Vercel.`);
  }
  report.sheetId = id;
  report.url = sheetUrl(id);

  // 0. Shape and sharing.
  const shaped = await ensureWorkbook(store, id);
  if (shaped.changed) report.notes.push(`Workbook set up${shaped.created.length ? `: added ${shaped.created.join(", ")}` : ""}.`);
  const shareKey = `sheet:shared:${id}`;
  const wantShare = sheetShareEmails().join(",");
  if (wantShare && (await store.kvGet<string>(shareKey)) !== wantShare) {
    try {
      const added = await shareWorkbook(id);
      if (added.length) report.notes.push(`Shared with ${added.join(", ")}.`);
      await store.kvSet(shareKey, wantShare);
    } catch (e) {
      report.errors.push(`share: ${msg(e)}`);
    }
  }
  const gid = new Map(shaped.meta.sheets.map((s) => [s.title, s.sheetId]));

  // 1. Read every tab the owner can type in: one request.
  const tabs = readableTabs();
  const ranges = tabs.map(dataRange);
  const data = await batchGet(id, ranges);
  report.tabsRead = tabs.length;
  const grid = new Map<string, CellValue[][]>(tabs.map((t, i) => [t.id, data[ranges[i]] ?? []]));

  // 2. Inbound: what the owner changed.
  let sources = await loadSources(store, now);
  const approvalById = new Map(sources.approvals.map((a) => [a.id, a]));
  const place: Placement = { gid, rowOf: new Map() };
  const pending: PendingChange[] = [];
  const writes: ValueWrite[] = [];
  for (const t of tabs) {
    const rows = grid.get(t.id) ?? [];
    const keyIdx = t.columns.findIndex((c) => c.kind === "key");
    rows.forEach((cells, i) => {
      const rowIndex = HEADER_ROWS + 1 + i;
      if (t.layout === "input" || keyIdx < 0) return;
      const key = String(cells[keyIdx] ?? "").trim();
      if (!key) return;
      if (t.layout === "rows") place.rowOf.set(key, rowIndex);
      const known = sources.known.get(key);
      if (!known) return;
      t.columns.forEach((col, k) => {
        if (!(col.owner || col.editable || col.kind === "status")) return;
        const value = String(cells[k] ?? "").trim();
        const before = (col.kind === "status" ? known.status : col.editable ? (known.owner_cols[col.key] ?? approvalById.get(known.entity_id)?.body ?? "") : (known.owner_cols[col.key] ?? "")).trim();
        if (value === before) return;
        if (!value && col.kind === "status") return; // a cleared Status is not a decision
        pending.push({ tab: t, key, col: col.key, value, cell: a1(t.name, `${colLetter(k)}${rowIndex}`), before });
      });
    });
  }
  for (const ch of pending) {
    report.changes++;
    try {
      const r = await applyChange(store, { rowKey: ch.key, column: ch.col, value: ch.value, by: EDITOR }, now);
      if (!r.ok) {
        report.refused++;
        writes.push({ range: ch.cell, values: [[r.status ?? ch.before]] });
      }
    } catch (e) {
      report.errors.push(`${ch.tab.name} ${ch.key}: ${msg(e)}`);
    }
  }
  // Input tabs: the Suppression List, Paste a Post, Controls.
  await inboundInputs(store, grid, writes, report);
  await inboundControls(store, grid, writes, report);
  if (pending.length || report.changes) sources = await loadSources(store, now); // statuses moved

  // 3. Outbound: the agents' rows, by Key.
  const built = buildRows(sources);
  const appends = new Map<string, { tab: TabSpec; rows: BuiltRow[] }>();
  for (const r of built) {
    const known = sources.known.get(r.key);
    const rowIndex = place.rowOf.get(r.key);
    const hash = agentHash(r.tab, r.cells);
    if (!rowIndex) {
      if (known && !grid.has(r.tab.id)) continue; // a tab we don't read (none today), nothing to place
      const a = appends.get(r.tab.id) ?? { tab: r.tab, rows: [] };
      a.rows.push(r);
      appends.set(r.tab.id, a);
      continue;
    }
    if (!known) {
      // A row the Sheet has but the database forgot (restored from a snapshot): adopt it.
      await store.upsertSheetRow({ tab: r.tab.id, row_key: r.key, entity_kind: r.kind, entity_id: r.entityId, status: r.initialStatus, owner_cols: {}, agent_hash: hash, synced_at: now.toISOString(), owner_edited_at: null });
      continue;
    }
    const statusMoved = r.kind === "approval" && r.initialStatus !== known.status;
    if (known.agent_hash === hash && !statusMoved) continue;
    const segs = segments(r, known.owner_cols);
    for (const s of segs) writes.push({ range: a1(r.tab.name, `${colLetter(s.from)}${rowIndex}:${colLetter(s.to)}${rowIndex}`), values: [s.values] });
    if (statusMoved) {
      const k = r.tab.columns.findIndex((c) => c.kind === "status");
      if (k >= 0) writes.push({ range: a1(r.tab.name, `${colLetter(k)}${rowIndex}`), values: [[r.initialStatus]] });
      await store.patchSheetRow(r.key, { status: r.initialStatus, agent_hash: hash, synced_at: now.toISOString() });
    } else await store.patchSheetRow(r.key, { agent_hash: hash, synced_at: now.toISOString() });
    report.updated++;
  }
  try {
    report.updated += 0;
    await batchUpdateValues(id, writes);
  } catch (e) {
    report.errors.push(`write: ${msg(e)}`);
  }
  for (const { tab, rows } of appends.values()) {
    try {
      const values = rows.map((r) => tab.columns.map((col) => (col.kind === "key" ? r.key : col.kind === "status" ? r.initialStatus : col.owner ? "" : (r.cells[col.key] ?? ""))));
      const { firstRow } = await appendRows(id, tab.name, values);
      for (const [i, r] of rows.entries()) {
        if (firstRow) place.rowOf.set(r.key, firstRow + i);
        await store.upsertSheetRow({ tab: tab.id, row_key: r.key, entity_kind: r.kind, entity_id: r.entityId, status: r.initialStatus, owner_cols: {}, agent_hash: agentHash(tab, r.cells), synced_at: now.toISOString(), owner_edited_at: null });
        sources.known.set(r.key, { id: "", created_at: now.toISOString(), tab: tab.id, row_key: r.key, entity_kind: r.kind, entity_id: r.entityId, status: r.initialStatus, owner_cols: {}, agent_hash: "", synced_at: null, owner_edited_at: null });
      }
      report.appended += rows.length;
    } catch (e) {
      report.errors.push(`${tab.name}: ${msg(e)}`);
    }
  }

  // 4. The computed tabs.
  await derivedTabs(store, id, { built, sources, place, now, report });

  if (report.errors.length) await logActivity(store, { action: "sync", result: "failed", error: report.errors.join(" | ").slice(0, 500), message: `${report.changes} changes, ${report.updated} updated, ${report.appended} added` });
  return report;
}

/** The agent-owned cells of a row, grouped into runs of adjacent columns. A message the owner edited is theirs now. */
function segments(r: BuiltRow, ownerCols: Record<string, string>): { from: number; to: number; values: CellValue[] }[] {
  const out: { from: number; to: number; values: CellValue[] }[] = [];
  let cur: { from: number; to: number; values: CellValue[] } | null = null;
  r.tab.columns.forEach((col, k) => {
    const mine = !col.owner && col.kind !== "key" && col.kind !== "status" && !(col.editable && ownerCols[col.key] !== undefined);
    if (!mine) {
      cur = null;
      return;
    }
    const v = r.cells[col.key] ?? "";
    if (cur && cur.to === k - 1) {
      cur.to = k;
      cur.values.push(v);
    } else {
      cur = { from: k, to: k, values: [v] };
      out.push(cur);
    }
  });
  return out;
}

async function inboundInputs(store: CrewStore, grid: Map<string, CellValue[][]>, writes: ValueWrite[], report: SyncReport) {
  // Suppression List: a Value with no Added stamp is new.
  for (const [i, cells] of (grid.get(SUPPRESSION.id) ?? []).entries()) {
    const value = String(cells[0] ?? "").trim();
    const added = String(cells[4] ?? "").trim();
    if (!value || added) continue;
    try {
      const ok = await applySuppressionRow(store, value, String(cells[2] ?? ""), EDITOR);
      report.changes++;
      if (!ok) {
        report.refused++;
        writes.push({ range: a1(SUPPRESSION.name, `E${HEADER_ROWS + 1 + i}`), values: [["not understood: use an email, @domain, or platform:handle"]] });
      }
    } catch (e) {
      report.errors.push(`suppression: ${msg(e)}`);
    }
  }
  // Paste a Post: text with no Taken stamp is new.
  for (const [i, cells] of (grid.get(PASTE.id) ?? []).entries()) {
    const text = String(cells[3] ?? "").trim();
    const taken = String(cells[4] ?? "").trim();
    if (!text || taken) continue;
    try {
      const ok = await applyPasteRow(store, { platform: String(cells[0] ?? ""), url: String(cells[1] ?? ""), kind: String(cells[2] ?? ""), text });
      report.changes++;
      writes.push({ range: a1(PASTE.name, `E${HEADER_ROWS + 1 + i}`), values: [[ok ? `Taken ${new Date().toLocaleDateString("en-US", { timeZone: "America/New_York" })}` : "Not taken: pick a platform and paste at least 20 characters"]] });
      if (!ok) report.refused++;
    } catch (e) {
      report.errors.push(`paste: ${msg(e)}`);
    }
  }
}

async function inboundControls(store: CrewStore, grid: Map<string, CellValue[][]>, writes: ValueWrite[], report: SyncReport) {
  for (const [i, cells] of (grid.get(CONTROLS.id) ?? []).entries()) {
    const key = String(cells[5] ?? "").trim();
    if (!key) continue;
    try {
      const r = await applyControlCell(store, key, String(cells[1] ?? ""), EDITOR);
      if (!r.ok) {
        report.refused++;
        writes.push({ range: a1(CONTROLS.name, `B${HEADER_ROWS + 1 + i}`), values: [[r.shown]] });
      } else if (r.shown !== String(cells[1] ?? "").trim()) {
        report.changes++;
        await store.setControl(`${key}:changed`, new Date().toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }), "sheet");
      }
    } catch (e) {
      report.errors.push(`controls ${key}: ${msg(e)}`);
    }
  }
}

async function rewrite(store: CrewStore, id: string, tab: TabSpec, rows: CellValue[][], report: SyncReport, o: { clear?: boolean } = {}) {
  try {
    if (o.clear !== false) await clearRange(id, dataRange(tab));
    if (rows.length) await batchUpdateValues(id, [{ range: a1(tab.name, `A${HEADER_ROWS + 1}`), values: rows.slice(0, MAX_ROWS - HEADER_ROWS) }]);
    report.derived++;
  } catch (e) {
    report.errors.push(`${tab.name}: ${msg(e)}`);
  }
}

async function derivedTabs(store: CrewStore, id: string, o: { built: BuiltRow[]; sources: RowSources; place: Placement; now: Date; report: SyncReport }) {
  const { built, sources, place, now, report } = o;
  const known = sources.known;
  const day = nyDayStart(now).toISOString();
  const week = new Date(now.getTime() - 7 * 86400_000).toISOString();
  const [leadsToday, leads7d, leadsAll, runs, activity, settings, dry] = await Promise.all([
    store.countLeadsSince(day),
    store.countLeadsSince(week),
    store.countLeadsSince("1970-01-01T00:00:00Z"),
    store.recentRuns(null, 600),
    store.listActivity(500),
    store.getSettings(),
    dryRun(store),
  ]);
  const counts: Counts = { leadsToday, leads7d, leadsAll };
  const queue = queueRows(built, known, id, place);
  await rewrite(store, id, QUEUE, queue, report);
  await rewrite(store, id, INTENT, intentRows(built, sources.approvals, known), report);
  await rewrite(store, id, TOP50, top50Rows(built, known, now), report);
  await rewrite(store, id, SOURCE_STATS, sourceStatsRows({ built, known, approvals: sources.approvals, counts, now }), report);
  const leads7dByAgent: Record<string, number> = {};
  const agentOf: Record<string, string> = { web: "leads-web", reddit: "leads-reddit", quora: "leads-quora", facebook: "leads-facebook", alignable: "leads-alignable" };
  for (const l of sources.leads.filter((x) => x.created_at >= week)) {
    const a = l.list === "office" ? "office-outreach" : (agentOf[l.source_platform] ?? "leads-web");
    leads7dByAgent[a] = (leads7dByAgent[a] ?? 0) + 1;
  }
  await rewrite(store, id, PERFORMANCE, await performanceRows({ store, approvals: sources.approvals, runs, known, built, now, leads7dByAgent }), report);
  await rewrite(store, id, ACTIVITY, activityRows(activity), report);
  await rewrite(store, id, CONTROLS, await controlsRows(store), report, { clear: false });
  await rewrite(store, id, SUPPRESSION, await suppressionRows(store), report);
  const cells = await dashboardCells({ store, sheetId: id, built, known, approvals: sources.approvals as Approval[], runs, activity: activity.filter((a) => a.at >= week), counts, now, place, queue, dryRun: dry, paused: settings.kill_all, errors: report.errors });
  try {
    await clearRange(id, a1(DASHBOARD.name, "A1:D200"));
    await batchUpdateValues(id, [{ range: a1(DASHBOARD.name, "A1"), values: cells }]);
    report.derived++;
  } catch (e) {
    report.errors.push(`Dashboard: ${msg(e)}`);
  }
}
