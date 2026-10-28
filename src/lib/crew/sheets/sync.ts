import { blueskyConfigured, sheetShareEmails } from "../env";
import { a1, appendRows, batchGet, batchUpdateValues, clearRange, colLetter, sheetUrl, type CellValue, type ValueWrite } from "../google/sheets";
import { nyDayStart } from "../schedule";
import type { CrewStore } from "../store";
import type { Approval, SheetRow } from "../types";
import { logActivity } from "./activity";
import { applyChange, applyControlCell, applyPasteRow, applySuppressionRow } from "./apply";
import { HEADER_ROWS, createWorkbook, ensureWorkbook, shareWorkbook, sheetsHqConfigured, workbookId } from "./bootstrap";
import { dryRun } from "./controls";
import { activityRows, allLeadsRows, controlsRows, dashboardCells, intentRows, performanceRows, queueRows, sourceStatsRows, suppressionRows, top50Rows, type Counts, type Placement } from "./derived";
import { agentHash, buildRows, type BuiltRow, type RowSources } from "./rows";
import { ownerEditable, type TabSpec } from "./spec";
import { ACTIVITY, ALL_LEADS, ALL_TABS, CONTROLS, DASHBOARD, INTENT, PASTE, PERFORMANCE, QUEUE, SOURCE_STATS, SUPPRESSION, TOP50 } from "./tabs";

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

/** The most rows a computed tab (queue, All Leads…) is rewritten with; the agents' own tabs have no cap. */
export const MAX_DERIVED_ROWS = 5000;
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
const CONTROLS_SHOWN_KEY = "sheet:controls-shown";

/** A whole tab below the header, to its last filled row (no row cap: a long tab is read to the end). */
function dataRange(tab: TabSpec): string {
  return a1(tab.name, `A${HEADER_ROWS + 1}:${colLetter(Math.max(tab.columns.length, 1) - 1)}`);
}

/** Tabs whose cells the owner may change, plus the input tabs. */
export function readableTabs(): TabSpec[] {
  return ALL_TABS.filter((t) => t.layout !== "free" && t.layout !== "placeholder" && (t.layout === "input" || t.columns.some((c) => c.owner || c.editable || c.kind === "status")));
}

/** Which of a tab's columns are read back as the owner's: on the computed tabs only the Status (everything else there is a copy). */
export function inboundColumns(tab: TabSpec): number[] {
  return tab.columns.flatMap((col, k) => (ownerEditable(tab, col) ? [k] : []));
}

export async function loadSources(store: CrewStore, now: Date): Promise<RowSources> {
  const since = new Date(now.getTime() - APPROVAL_DAYS * 86400_000).toISOString();
  const [approvals, cold, office, findings, people, facts, known, geoState] = await Promise.all([
    store.listApprovals({ sinceIso: since, limit: 5000 }),
    store.listLeads("cold", 5000),
    store.listLeads("office", 2000),
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

/**
 * The owner's edits in the grid. A Status counts only when it differs from
 * what the sync last wrote into every copy of the row (shown_status): a copy
 * still showing that is stale, not a decision, so the Action Queue can never
 * undo a Status set on the agent's own tab, or the other way round. Owner
 * columns and edited messages are read on the agent's own tab only. When the
 * same row's Status was changed in two copies, the agent's own tab wins.
 */
export function ownerChanges(tabs: TabSpec[], grid: Map<string, CellValue[][]>, known: Map<string, SheetRow>, approvalBody: (id: string) => string | undefined): PendingChange[] {
  const statusByKey = new Map<string, PendingChange>();
  const other: PendingChange[] = [];
  for (const t of tabs) {
    if (t.layout === "input") continue;
    const keyIdx = t.columns.findIndex((c) => c.kind === "key");
    if (keyIdx < 0) continue;
    const cols = inboundColumns(t);
    (grid.get(t.id) ?? []).forEach((cells, i) => {
      const key = String(cells[keyIdx] ?? "").trim();
      const row = key ? known.get(key) : undefined;
      if (!row) return;
      const rowIndex = HEADER_ROWS + 1 + i;
      for (const k of cols) {
        const col = t.columns[k];
        const value = String(cells[k] ?? "").trim();
        const cell = a1(t.name, `${colLetter(k)}${rowIndex}`);
        if (col.kind === "status") {
          const shown = (row.shown_status ?? row.status).trim();
          if (!value || value === shown) continue; // a stale copy or a cleared cell is not a decision
          const prev = statusByKey.get(key);
          if (!prev || t.layout === "rows") statusByKey.set(key, { tab: t, key, col: col.key, value, cell, before: row.status });
          continue;
        }
        const before = (row.owner_cols[col.key] ?? (col.editable && row.entity_kind === "approval" ? (approvalBody(row.entity_id) ?? "") : "")).trim();
        if (value === before) continue;
        if (col.editable && !value) continue; // an emptied message is not a rewrite
        other.push({ tab: t, key, col: col.key, value, cell, before });
      }
    });
  }
  // Notes and edited messages first, Status last: an edit made in the same
  // sweep as an Approved (an option picked in Notes, a reworded message) must
  // be in place before the decision uses it.
  return [...other, ...statusByKey.values()];
}

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

  // 0. Shape and sharing. Only missing tabs or header rows stop the sync; a
  // formatting or protection request Google refuses is reported and the rows
  // are still written.
  let shaped: Awaited<ReturnType<typeof ensureWorkbook>>;
  try {
    shaped = await ensureWorkbook(store, id);
  } catch (e) {
    report.errors.push(`setup: ${msg(e)}`);
    await logActivity(store, { action: "sync", result: "failed", error: report.errors.join(" | ").slice(0, 500), message: "The workbook's tabs or header rows could not be set up; nothing was written." });
    return report;
  }
  if (shaped.changed) report.notes.push(`Workbook set up${shaped.created.length ? `: added ${shaped.created.join(", ")}` : ""}.`);
  for (const w of shaped.warnings) report.errors.push(w);
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
  // The admin page's "Open its tab" links land on the right tab with these.
  await store.kvSet("sheet:gids", Object.fromEntries(gid)).catch(() => undefined);

  // 1. Read every tab the owner can type in, to the last row: one request.
  const tabs = readableTabs();
  const ranges = tabs.map(dataRange);
  const data = await batchGet(id, ranges);
  report.tabsRead = tabs.length;
  const grid = new Map<string, CellValue[][]>(tabs.map((t, i) => [t.id, data[ranges[i]] ?? []]));

  // 2. Inbound: what the owner changed.
  let sources = await loadSources(store, now);
  const approvalById = new Map(sources.approvals.map((a) => [a.id, a]));
  const place: Placement = { gid, rowOf: new Map() };
  // Where each Key sits, per tab: a row is only ever updated on its own tab.
  const rowsByTab = new Map<string, Map<string, number>>();
  for (const t of tabs.filter((x) => x.layout === "rows")) {
    const keyIdx = t.columns.findIndex((c) => c.kind === "key");
    const at = new Map<string, number>();
    (grid.get(t.id) ?? []).forEach((cells, i) => {
      const key = keyIdx >= 0 ? String(cells[keyIdx] ?? "").trim() : "";
      if (key && !at.has(key)) at.set(key, HEADER_ROWS + 1 + i);
    });
    rowsByTab.set(t.id, at);
    for (const [key, row] of at) place.rowOf.set(key, row);
  }
  const writes: ValueWrite[] = [];
  for (const ch of ownerChanges(tabs, grid, sources.known, (eid) => approvalById.get(eid)?.body)) {
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
  sources = await loadSources(store, now); // statuses and drafts may have moved

  // 3. Outbound: the agents' rows, by Key. A row's hash is recorded only
  // after its cells are actually in the Sheet, so a failed write is retried.
  const built = buildRows(sources);
  const written: { key: string; hash: string }[] = [];
  const appends = new Map<string, { tab: TabSpec; rows: BuiltRow[] }>();
  for (const r of built) {
    const known = sources.known.get(r.key);
    const rowIndex = rowsByTab.get(r.tab.id)?.get(r.key);
    const hash = agentHash(r.tab, r.cells);
    const action = placeRow(known, rowIndex, r.tab.id);
    if (action === "gone") continue;
    if (action === "append") {
      const a = appends.get(r.tab.id) ?? { tab: r.tab, rows: [] };
      a.rows.push(r);
      appends.set(r.tab.id, a);
      continue;
    }
    if (!known) {
      // A row the Sheet has but the database doesn't (restored from a snapshot): adopt it with the Status the Sheet shows.
      const cells = grid.get(r.tab.id)?.[rowIndex! - HEADER_ROWS - 1] ?? [];
      const k = r.tab.columns.findIndex((c) => c.kind === "status");
      const shownWord = k >= 0 ? String(cells[k] ?? "").trim() || r.initialStatus : r.initialStatus;
      const adopted = await store.upsertSheetRow({ tab: r.tab.id, row_key: r.key, entity_kind: r.kind, entity_id: r.entityId, status: shownWord, owner_cols: {}, shown_status: shownWord, agent_hash: hash, synced_at: now.toISOString(), owner_edited_at: null });
      sources.known.set(r.key, adopted);
      continue;
    }
    // A draft the backend moved on (approved elsewhere, expired, failed) gets its new word.
    if (r.kind === "approval" && r.initialStatus !== known.status) {
      await store.patchSheetRow(r.key, { status: r.initialStatus });
      sources.known.set(r.key, { ...known, status: r.initialStatus });
    }
    if (known.agent_hash === hash) continue;
    for (const s of segments(r, known.owner_cols)) writes.push({ range: a1(r.tab.name, `${colLetter(s.from)}${rowIndex}:${colLetter(s.to)}${rowIndex}`), values: [s.values] });
    written.push({ key: r.key, hash });
  }
  // Every copy of a Status on the agents' own tabs shows the backend's word (stale copies are put right).
  writes.push(...statusFixes(tabs.filter((t) => t.layout === "rows"), grid, sources.known));
  try {
    await batchUpdateValues(id, writes);
    for (const w of written) await store.patchSheetRow(w.key, { agent_hash: w.hash, synced_at: now.toISOString() });
    report.updated += written.length;
  } catch (e) {
    report.errors.push(`write: ${msg(e)}`);
  }
  for (const { tab, rows } of appends.values()) {
    try {
      // A row that moved to a new tab in a release keeps the owner's notes.
      const mine = (r: BuiltRow) => sources.known.get(r.key)?.owner_cols ?? {};
      const values = rows.map((r) => tab.columns.map((col) => (col.kind === "key" ? r.key : col.kind === "status" ? r.initialStatus : col.owner ? (mine(r)[col.key] ?? "") : (r.cells[col.key] ?? ""))));
      const { firstRow } = await appendRows(id, tab.name, values);
      for (const [i, r] of rows.entries()) {
        if (firstRow) place.rowOf.set(r.key, firstRow + i);
        const saved = await store.upsertSheetRow({ tab: tab.id, row_key: r.key, entity_kind: r.kind, entity_id: r.entityId, status: r.initialStatus, owner_cols: mine(r), shown_status: r.initialStatus, agent_hash: agentHash(tab, r.cells), synced_at: now.toISOString(), owner_edited_at: null });
        sources.known.set(r.key, saved);
      }
      report.appended += rows.length;
    } catch (e) {
      report.errors.push(`${tab.name}: ${msg(e)}`);
    }
  }

  // 4. The computed tabs (they copy each row's current Status).
  await derivedTabs(store, id, { built, sources, place, now, report });

  // 5. Remember which word every copy now shows.
  await markShown(store, sources.known).catch((e) => report.errors.push(`remember: ${msg(e)}`));

  if (report.errors.length) await logActivity(store, { action: "sync", result: "failed", error: report.errors.join(" | ").slice(0, 500), message: `${report.changes} changes, ${report.updated} updated, ${report.appended} added` });
  return report;
}

/**
 * What one built row needs. Never placed before: add it. Placed before but
 * gone from the tab: the owner deleted it, so it stays gone (a deleted row
 * must never come back every 15 minutes). In the tab but unknown to the
 * database (restored from a snapshot): adopt it with the Status it shows.
 * Placed on another tab (its agent moved tabs in a release): add it to the
 * new one. Otherwise keep it current.
 */
export function placeRow(known: SheetRow | undefined, rowIndex: number | undefined, tabId: string): "append" | "gone" | "adopt" | "update" {
  if (!rowIndex) return known && known.tab === tabId ? "gone" : "append";
  return known ? "update" : "adopt";
}

/**
 * The Controls rows whose Value the owner changed: it differs from what the
 * sync last wrote there. Otherwise the admin page's Start / Stop and Pause
 * all would be undone by the old value still sitting in the cell. Nothing
 * counts before the sync has written the tab once.
 */
export function controlEdits(rows: CellValue[][], shown: Record<string, string> | null): { i: number; key: string; value: string }[] {
  if (!shown) return [];
  return rows.flatMap((cells, i) => {
    const key = String(cells[5] ?? "").trim();
    const value = String(cells[1] ?? "").trim();
    return key && shown[key] !== undefined && shown[key] !== value ? [{ i, key, value }] : [];
  });
}

/** Status cells on the agents' tabs that don't show the backend's word. */
export function statusFixes(tabs: TabSpec[], grid: Map<string, CellValue[][]>, known: Map<string, SheetRow>): ValueWrite[] {
  const out: ValueWrite[] = [];
  for (const t of tabs) {
    const keyIdx = t.columns.findIndex((c) => c.kind === "key");
    const k = t.columns.findIndex((c) => c.kind === "status");
    if (keyIdx < 0 || k < 0) continue;
    (grid.get(t.id) ?? []).forEach((cells, i) => {
      const row = known.get(String(cells[keyIdx] ?? "").trim());
      if (row && String(cells[k] ?? "").trim() !== row.status) out.push({ range: a1(t.name, `${colLetter(k)}${HEADER_ROWS + 1 + i}`), values: [[row.status]] });
    });
  }
  return out;
}

async function markShown(store: CrewStore, known: Map<string, SheetRow>): Promise<void> {
  const byStatus = new Map<string, string[]>();
  for (const r of known.values()) if (r.shown_status !== r.status) byStatus.set(r.status, [...(byStatus.get(r.status) ?? []), r.row_key]);
  for (const [status, keys] of byStatus) await store.markShown(status, keys);
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

/** The Controls the owner changed in the Sheet (controlEdits), applied through the same checks as the hook. */
async function inboundControls(store: CrewStore, grid: Map<string, CellValue[][]>, writes: ValueWrite[], report: SyncReport) {
  const shown = (await store.kvGet<Record<string, string>>(CONTROLS_SHOWN_KEY).catch(() => null)) ?? null;
  for (const { i, key, value } of controlEdits(grid.get(CONTROLS.id) ?? [], shown)) {
    try {
      const r = await applyControlCell(store, key, value, EDITOR);
      if (!r.ok) {
        report.refused++;
        writes.push({ range: a1(CONTROLS.name, `B${HEADER_ROWS + 1 + i}`), values: [[r.shown]] });
      } else if (r.changed) {
        report.changes++;
      }
    } catch (e) {
      report.errors.push(`controls ${key}: ${msg(e)}`);
    }
  }
}

/** True when the tab now shows `rows`. */
async function rewrite(store: CrewStore, id: string, tab: TabSpec, rows: CellValue[][], report: SyncReport, o: { clear?: boolean } = {}): Promise<boolean> {
  try {
    if (o.clear !== false) await clearRange(id, dataRange(tab));
    if (rows.length) await batchUpdateValues(id, [{ range: a1(tab.name, `A${HEADER_ROWS + 1}`), values: rows.slice(0, MAX_DERIVED_ROWS) }]);
    report.derived++;
    return true;
  } catch (e) {
    report.errors.push(`${tab.name}: ${msg(e)}`);
    return false;
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
    // Newest first: the Performance and Dashboard tabs take each agent's
    // first run in this list as its latest. Oldest first (runsSince's order)
    // they showed the state of a week-old run.
    store.runsSince(week).then((r) => [...r].sort((a, b) => (a.started_at < b.started_at ? 1 : a.started_at > b.started_at ? -1 : 0))),
    store.listActivity(500),
    store.getSettings(),
    dryRun(store),
  ]);
  const counts: Counts = { leadsToday, leads7d, leadsAll };
  const queue = queueRows(built, known, id, place);
  await rewrite(store, id, QUEUE, queue, report);
  await rewrite(store, id, INTENT, intentRows(built, sources.approvals, known), report);
  await rewrite(store, id, TOP50, top50Rows(built, known, now), report);
  await rewrite(store, id, ALL_LEADS, allLeadsRows(built, known), report);
  await rewrite(store, id, SOURCE_STATS, sourceStatsRows({ built, known, approvals: sources.approvals, counts, now }), report);
  const leads7dByAgent: Record<string, number> = {};
  const agentOf: Record<string, string> = { web: "leads-web", reddit: "leads-reddit", quora: "leads-quora", facebook: "leads-facebook", alignable: "leads-alignable" };
  for (const l of sources.leads.filter((x) => x.created_at >= week)) {
    const a = l.list === "office" ? "office-outreach" : (agentOf[l.source_platform] ?? "leads-web");
    leads7dByAgent[a] = (leads7dByAgent[a] ?? 0) + 1;
  }
  await rewrite(store, id, PERFORMANCE, await performanceRows({ store, approvals: sources.approvals, runs, known, built, now, leads7dByAgent }), report);
  await rewrite(store, id, ACTIVITY, activityRows(activity), report);
  const controls = await controlsRows(store);
  // What each Controls cell now says, so the next sync can tell the owner's
  // change from our own write. Only when the write landed: saved after a
  // failed write, the Sheet's older cells read as an owner's change next
  // time, and undid a Stop pressed in the admin.
  if (await rewrite(store, id, CONTROLS, controls, report)) {
    await store.kvSet(CONTROLS_SHOWN_KEY, Object.fromEntries(controls.map((r) => [String(r[5]), String(r[1])])));
  }
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
