import { sheetShareEmails } from "../env";
import { a1, appendRows, batchGet, batchUpdate, batchUpdateValues, colLetter, sheetUrl, type CellValue, type ValueWrite } from "../google/sheets";
import type { CrewStore } from "../store";
import type { SheetRow } from "../types";
import { logActivity } from "./activity";
import { applyChange, applyPasteRow, statusCommand } from "./apply";
import { HEADER_ROWS, createWorkbook, ensureWorkbook, retireTabs, shareWorkbook, sheetsHqConfigured, workbookId } from "./bootstrap";
import { agentHash, buildRows, leadCoverage, type BuiltRow, type LeadCoverage, type RowSources } from "./rows";
import { ownerEditable, type TabSpec } from "./spec";
import { AGENT_TABS, ALL_TABS, PASTE, RETIRED_TAB_NAMES } from "./tabs";

// ── One sync: read the Sheet, apply what the owner did, write what the
// agents made ───────────────────────────────────────────────────────────────
// Runs every 15 minutes from the sheet-sync agent and on demand. Order
// matters: the owner's edits are read and applied BEFORE anything is written.
// Rows are found by their (hidden) Key column, never by position, so sorting
// and filtering in the Sheet are safe. A row changes what happened with a
// person only when the owner says so: "sent", "skip" or "not interested"
// typed over its message (apply.ts statusCommand), or the admin page. A row
// the owner deleted is put back, unchanged, with nothing recorded (owner,
// 2026-10-29: deleting must never count as outreach); the database is the
// source of truth. A row that stopped being open (sent, skipped, expired) is
// taken off the tab. A sync costs no AI.

export const APPROVAL_DAYS = 45;

/**
 * The workbook's layout. When it changes, every agent tab is deleted and made
 * again (old columns, dropdowns and colours can't be cleaned out of a tab
 * cell by cell), and every open item is added to its new tab. Bumped
 * 2026-10-29 for Name, Message, Link.
 */
export const LAYOUT_VERSION = "name-message-link-2026-10-29";

export type SyncReport = {
  sheetId: string | null;
  url: string | null;
  tabsRead: number;
  changes: number;
  refused: number;
  updated: number;
  appended: number;
  /** Rows that were missing from their tab (deleted by hand) and were put back. Nothing about them changed. */
  restored: number;
  /** Missing rows not put back, because the tab may still hold them without their Key (a copy would be a duplicate). */
  notRestored: number;
  /** Where every saved lead stands: listed (ready, or needing a message), or why not. */
  leads: LeadCoverage | null;
  /** Rows taken off because they are no longer waiting (sent elsewhere, skipped, expired). */
  removed: number;
  errors: string[];
  notes: string[];
};

const EDITOR = "sheet";
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 200);

/** A whole tab below the header, to its last filled row. */
function dataRange(tab: TabSpec): string {
  return a1(tab.name, `A${HEADER_ROWS + 1}:${colLetter(Math.max(tab.columns.length, 1) - 1)}`);
}

/** Every tab the sync reads: the agent tabs (Keys and edited messages) and Paste a Post. */
export function readableTabs(): TabSpec[] {
  return ALL_TABS.filter((t) => t.layout === "rows" || t.layout === "input");
}

/** Which of a tab's columns are read back as the owner's: the message, if they reworded it. */
export function inboundColumns(tab: TabSpec): number[] {
  return tab.columns.flatMap((col, k) => (ownerEditable(tab, col) ? [k] : []));
}

export async function loadSources(store: CrewStore, now: Date): Promise<RowSources> {
  const since = new Date(now.getTime() - APPROVAL_DAYS * 86400_000).toISOString();
  const [approvals, cold, office, known] = await Promise.all([
    store.listApprovals({ sinceIso: since, limit: 5000 }),
    store.listLeads("cold", 5000),
    store.listLeads("office", 2000),
    store.listSheetRows(),
  ]);
  return {
    approvals: approvals.filter((a) => a.team !== "watchdog"),
    leads: [...cold, ...office].sort((x, y) => (x.created_at < y.created_at ? -1 : 1)),
    known: new Map(known.map((r) => [r.row_key, r])),
  };
}

type PendingChange = { tab: TabSpec; key: string; col: string; value: string; cell: string; before: string };

/** The messages the owner reworded in the grid (the agent learns from them). */
export function ownerChanges(tabs: TabSpec[], grid: Map<string, CellValue[][]>, known: Map<string, SheetRow>, approvalBody: (id: string) => string | undefined): PendingChange[] {
  const out: PendingChange[] = [];
  for (const t of tabs) {
    if (t.layout !== "rows") continue;
    const keyIdx = t.columns.findIndex((c) => c.kind === "key");
    if (keyIdx < 0) continue;
    const cols = inboundColumns(t);
    (grid.get(t.id) ?? []).forEach((cells, i) => {
      const key = String(cells[keyIdx] ?? "").trim();
      const row = key ? known.get(key) : undefined;
      if (!row) return;
      for (const k of cols) {
        const col = t.columns[k];
        // Only a draft's message can be reworded (apply.ts refuses the rest).
        // A lead's message read as "changed from nothing" and was put back
        // as an empty cell, blanking five rows (2026-10-29, 18:00 UTC).
        // A lead's message cell is read only for a status word ("sent").
        const value = String(cells[k] ?? "").trim();
        if (col.editable && row.entity_kind !== "approval" && !statusCommand(value, row.entity_kind)) continue;
        const before = (row.owner_cols[col.key] ?? (col.editable && row.entity_kind === "approval" ? (approvalBody(row.entity_id) ?? "") : "")).trim();
        if (value === before) continue;
        if (col.editable && !value) continue; // an emptied message is not a rewrite
        out.push({ tab: t, key, col: col.key, value, cell: a1(t.name, `${colLetter(k)}${HEADER_ROWS + 1 + i}`), before });
      }
    });
  }
  return out;
}

export async function syncSheet(store: CrewStore, now = new Date()): Promise<SyncReport> {
  const report: SyncReport = { sheetId: null, url: null, tabsRead: 0, changes: 0, refused: 0, updated: 0, appended: 0, restored: 0, notRestored: 0, removed: 0, leads: null, errors: [], notes: [] };
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

  // 0. A new layout: the old agent tabs and the retired ones go, and every
  // item that was on them is placed again (it wasn't deleted by the owner).
  const layoutKey = `sheet:layout:${id}`;
  let rebuilt = false;
  if ((await store.kvGet<string>(layoutKey)) !== LAYOUT_VERSION) {
    try {
      const gone = await retireTabs(id, new Set([...RETIRED_TAB_NAMES, ...AGENT_TABS.map((t) => t.name)]));
      const agentTabIds = new Set(AGENT_TABS.map((t) => t.id));
      for (const r of await store.listSheetRows()) if (agentTabIds.has(r.tab)) await store.patchSheetRow(r.row_key, { tab: `moved:${r.tab}` });
      await store.kvSet(layoutKey, LAYOUT_VERSION);
      rebuilt = true;
      report.notes.push(`Rebuilt the workbook as Name, Message, Link${gone.length ? `; removed ${gone.join(", ")}` : ""}.`);
    } catch (e) {
      report.errors.push(`rebuild: ${msg(e)}`);
      return report;
    }
  }

  // 1. Shape and sharing. Only missing tabs or header rows stop the sync.
  let shaped: Awaited<ReturnType<typeof ensureWorkbook>>;
  try {
    shaped = await ensureWorkbook(store, id, { force: rebuilt });
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

  // 2. Read every tab, to the last row: one request.
  const tabs = readableTabs();
  const ranges = tabs.map(dataRange);
  const data = await batchGet(id, ranges);
  report.tabsRead = tabs.length;
  const grid = new Map<string, CellValue[][]>(tabs.map((t, i) => [t.id, data[ranges[i]] ?? []]));

  // 3. Inbound: reworded messages, then pasted posts.
  let sources = await loadSources(store, now);
  const approvalById = new Map(sources.approvals.map((a) => [a.id, a]));
  const rowsByTab = new Map<string, Map<string, number>>();
  /** Per tab, the Name of each row that has lost its Key. */
  const keyless = new Map<string, Set<string>>();
  for (const t of tabs.filter((x) => x.layout === "rows")) {
    const keyIdx = t.columns.findIndex((c) => c.kind === "key");
    const at = new Map<string, number>();
    const names = new Set<string>();
    (grid.get(t.id) ?? []).forEach((cells, i) => {
      const key = keyIdx >= 0 ? String(cells[keyIdx] ?? "").trim() : "";
      if (key && !at.has(key)) at.set(key, HEADER_ROWS + 1 + i);
      if (!key && String(cells[0] ?? "").trim()) names.add(String(cells[0]).trim());
    });
    rowsByTab.set(t.id, at);
    keyless.set(t.id, names);
  }
  const writes: ValueWrite[] = [];
  for (const ch of ownerChanges(tabs, grid, sources.known, (eid) => approvalById.get(eid)?.body)) {
    report.changes++;
    try {
      const r = await applyChange(store, { rowKey: ch.key, column: ch.col, value: ch.value, by: EDITOR }, now);
      if (!r.ok) {
        report.refused++;
        if (ch.before) writes.push({ range: ch.cell, values: [[ch.before]] });
      }
    } catch (e) {
      report.errors.push(`${ch.tab.name} ${ch.key}: ${msg(e)}`);
    }
  }
  await inboundPaste(store, grid, writes, report);

  sources = await loadSources(store, now); // drafts and leads may have moved

  // 4. Outbound: the open items, by Key. A row's hash is recorded only after
  // its cells are actually in the Sheet, so a failed write is retried. A row
  // missing from its tab is put back, unless its Key sits on another tab or a
  // row with its Name lost its Key (putting it back would make a duplicate).
  const built = buildRows(sources);
  report.leads = leadCoverage(sources);
  const restoring = new Set<string>();
  const keyedAnywhere = new Set([...rowsByTab.values()].flatMap((m) => [...m.keys()]));
  const written: { key: string; hash: string }[] = [];
  const appends = new Map<string, { tab: TabSpec; rows: BuiltRow[] }>();
  for (const r of built) {
    const known = sources.known.get(r.key);
    const rowIndex = rowsByTab.get(r.tab.id)?.get(r.key);
    const hash = agentHash(r.tab, r.cells);
    const action = placeRow(known, rowIndex, r.tab.id);
    if (action === "restore" && (keyedAnywhere.has(r.key) || keyless.get(r.tab.id)?.has(String(r.cells.name ?? "").trim()))) {
      report.notRestored++;
      continue;
    }
    if (action === "append" || action === "restore") {
      if (action === "restore") restoring.add(r.key);
      const a = appends.get(r.tab.id) ?? { tab: r.tab, rows: [] };
      a.rows.push(r);
      appends.set(r.tab.id, a);
      continue;
    }
    if (!known) {
      // A row the Sheet has but the database doesn't (restored from a snapshot): adopt it.
      const adopted = await store.upsertSheetRow({ tab: r.tab.id, row_key: r.key, entity_kind: r.kind, entity_id: r.entityId, status: r.initialStatus, owner_cols: {}, shown_status: r.initialStatus, agent_hash: hash, synced_at: now.toISOString(), owner_edited_at: null });
      sources.known.set(r.key, adopted);
      continue;
    }
    if (r.kind === "approval" && r.initialStatus !== known.status) {
      await store.patchSheetRow(r.key, { status: r.initialStatus, shown_status: r.initialStatus });
      sources.known.set(r.key, { ...known, status: r.initialStatus });
    }
    // A message the Sheet shows empty when it shouldn't (the 18:00 blanking
    // above) is written again even though the row's hash says it's current.
    const msgIdx = r.tab.columns.findIndex((c) => c.key === "message");
    const shownMessage = msgIdx >= 0 && rowIndex ? String(grid.get(r.tab.id)?.[rowIndex - HEADER_ROWS - 1]?.[msgIdx] ?? "").trim() : "x";
    const blanked = !shownMessage && !!String(r.cells.message ?? "").trim() && known.owner_cols.message === undefined;
    if (known.agent_hash === hash && !blanked) continue;
    for (const s of segments(r, known.owner_cols)) writes.push({ range: a1(r.tab.name, `${colLetter(s.from)}${rowIndex}:${colLetter(s.to)}${rowIndex}`), values: [s.values] });
    written.push({ key: r.key, hash });
  }
  try {
    await batchUpdateValues(id, writes);
    for (const w of written) await store.patchSheetRow(w.key, { agent_hash: w.hash, synced_at: now.toISOString() });
    report.updated += written.length;
  } catch (e) {
    report.errors.push(`write: ${msg(e)}`);
  }

  // 5. Rows that are no longer waiting come off their tab (bottom up, so the
  // row numbers above stay right). Their record says so, so they never read
  // as deleted by the owner.
  const open = new Set(built.map((r) => r.key));
  const removals: { sheetId: number; row: number; key: string }[] = [];
  for (const t of tabs.filter((x) => x.layout === "rows")) {
    const sheetId = gid.get(t.name);
    if (sheetId === undefined) continue;
    for (const [key, row] of rowsByTab.get(t.id) ?? []) if (!open.has(key)) removals.push({ sheetId, row, key });
  }
  if (removals.length) {
    try {
      removals.sort((x, y) => (x.sheetId - y.sheetId) || (y.row - x.row));
      await batchUpdate(id, removals.map((x) => ({ deleteDimension: { range: { sheetId: x.sheetId, dimension: "ROWS", startIndex: x.row - 1, endIndex: x.row } } })));
      for (const x of removals) {
        const k = sources.known.get(x.key);
        if (k && !k.tab.startsWith("closed:")) await store.patchSheetRow(x.key, { tab: `closed:${k.tab}` });
      }
      report.removed += removals.length;
    } catch (e) {
      report.errors.push(`remove: ${msg(e)}`);
    }
  }

  // 6. New rows, and rows put back, at the bottom of their tab. A row put back
  // keeps its status, the owner's own words and when they last changed it.
  for (const { tab, rows } of appends.values()) {
    try {
      const mine = (r: BuiltRow) => sources.known.get(r.key)?.owner_cols ?? {};
      const values = rows.map((r) => tab.columns.map((col) => (col.kind === "key" ? r.key : col.editable && mine(r)[col.key] !== undefined ? mine(r)[col.key] : (r.cells[col.key] ?? ""))));
      await appendRows(id, tab.name, values);
      for (const r of rows) {
        const saved = await store.upsertSheetRow({ tab: tab.id, row_key: r.key, entity_kind: r.kind, entity_id: r.entityId, status: r.initialStatus, owner_cols: mine(r), shown_status: r.initialStatus, agent_hash: agentHash(tab, r.cells), synced_at: now.toISOString(), owner_edited_at: sources.known.get(r.key)?.owner_edited_at ?? null });
        sources.known.set(r.key, saved);
      }
      report.appended += rows.length;
      report.restored += rows.filter((r) => restoring.has(r.key)).length;
    } catch (e) {
      report.errors.push(`${tab.name}: ${msg(e)}`);
    }
  }

  if (report.errors.length) await logActivity(store, { action: "sync", result: "failed", error: report.errors.join(" | ").slice(0, 500), message: `${report.updated} updated, ${report.appended} added (${report.restored} put back), ${report.removed} removed` });
  return report;
}

/**
 * What one built row needs. Never placed before, or placed on another tab or
 * before a rebuild: add it. Placed before on this tab but gone from it (the
 * owner deleted it): put it back, as it was; deleting records nothing. In the
 * tab but unknown to the database (restored from a snapshot): adopt it.
 */
export function placeRow(known: SheetRow | undefined, rowIndex: number | undefined, tabId: string): "append" | "restore" | "adopt" | "update" {
  if (!rowIndex) return known && known.tab === tabId ? "restore" : "append";
  return known ? "update" : "adopt";
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

/** Paste a Post: text with no Taken stamp is new. */
async function inboundPaste(store: CrewStore, grid: Map<string, CellValue[][]>, writes: ValueWrite[], report: SyncReport) {
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
