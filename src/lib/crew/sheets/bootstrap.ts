import { createHash } from "node:crypto";
import { env, sheetShareEmails } from "../env";
import { googleConfigured, serviceAccountEmail } from "../google/auth";
import { MIME, createFile, ensureFolder, shareWith } from "../google/drive";
import { batchUpdate, colLetter, getSpreadsheet, sheetUrl, type SpreadsheetMeta } from "../google/sheets";
import type { CrewStore } from "../store";
import { logActivity } from "./activity";
import { hasKeyColumn, type TabSpec } from "./spec";
import { ALL_TABS } from "./tabs";

// ── The workbook: created once, kept in shape ───────────────────────────────
// One workbook, "SwiftCard Leads", in the Shared Drive. Every tab from
// tabs.ts exists with its header row, frozen, bold, filtered, sized, with
// dropdowns on Status columns, colours for priorities and scores, wrapping on
// long columns, and the Controls tab protected except its Value column.
// Idempotent: a hash of the tab specs is kept in crew_kv, so this runs again
// only when a spec changes, and never removes a tab or a row (a tab that is
// no longer in tabs.ts is left alone with "(old)" in front of its name).

export const WORKBOOK_NAME = "SwiftCard Leads";
export const DAILY_FOLDER = "Daily";
const SPEC_KEY = "sheet:spec-hash";
const ID_KEY = "sheet:id";
export const HEADER_ROWS = 1;

export function sheetsHqConfigured(): boolean {
  return googleConfigured() && (!!env("CREW_SHEET_ID") || !!env("CREW_SHARED_DRIVE_ID"));
}

/** The workbook id: the env var, else the one the sync created (crew_kv), else null. In development the test workbook wins. */
export async function workbookId(store: CrewStore): Promise<string | null> {
  if (process.env.NODE_ENV !== "production" && env("CREW_SHEET_ID_TEST")) return env("CREW_SHEET_ID_TEST")!;
  return env("CREW_SHEET_ID") ?? (await store.kvGet<string>(ID_KEY));
}

export function specHash(tabs: TabSpec[] = ALL_TABS): string {
  return createHash("sha1").update(JSON.stringify(tabs.map((t) => [t.id, t.name, t.layout, t.color, t.description, t.statuses, t.columns]))).digest("hex").slice(0, 12);
}

const hex = (h?: string) => {
  const m = /^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(h ?? "");
  return m ? { red: parseInt(m[1], 16) / 255, green: parseInt(m[2], 16) / 255, blue: parseInt(m[3], 16) / 255 } : undefined;
};

const GREEN = { red: 0.78, green: 0.93, blue: 0.8 };
const YELLOW = { red: 1, green: 0.95, blue: 0.75 };
const GREY = { red: 0.93, green: 0.93, blue: 0.93 };
const RED = { red: 0.98, green: 0.82, blue: 0.82 };
const BLUE = { red: 0.82, green: 0.89, blue: 0.99 };

/** Create the workbook in the Shared Drive and remember its id. Null when it can't be created (no drive id). */
export async function createWorkbook(store: CrewStore): Promise<{ id: string; url: string } | null> {
  const drive = env("CREW_SHARED_DRIVE_ID");
  if (!drive) return null;
  const file = await createFile({ name: WORKBOOK_NAME, mimeType: MIME.spreadsheet, parentId: drive });
  await store.kvSet(ID_KEY, file.id);
  await ensureFolder(DAILY_FOLDER, drive, drive).catch(() => null);
  await logActivity(store, { action: "sync", target: file.id, message: `Created the workbook "${WORKBOOK_NAME}" in the Shared Drive. Set CREW_SHEET_ID=${file.id} in Vercel so it is pinned.` });
  return { id: file.id, url: sheetUrl(file.id) };
}

/** Share the workbook with the owners' accounts (CREW_SHEET_SHARE_EMAILS). Returns the emails newly added. */
export async function shareWorkbook(id: string): Promise<string[]> {
  const added: string[] = [];
  for (const email of sheetShareEmails()) if (await shareWith(id, email, "writer").catch(() => false)) added.push(email);
  return added;
}

/** Make every tab exist and look right. Returns what it did. */
export async function ensureWorkbook(store: CrewStore, id: string, o: { force?: boolean } = {}): Promise<{ changed: boolean; created: string[]; meta: SpreadsheetMeta }> {
  let meta = await getSpreadsheet(id);
  const want = specHash();
  const have = await store.kvGet<string>(`${SPEC_KEY}:${id}`);
  if (have === want && !o.force) return { changed: false, created: [], meta };

  // 1. Tabs that don't exist yet, in spec order; the default "Sheet1" becomes the Dashboard.
  const byName = new Map(meta.sheets.map((s) => [s.title, s]));
  const requests: Record<string, unknown>[] = [];
  const created: string[] = [];
  const first = meta.sheets.find((s) => s.title === "Sheet1" && meta.sheets.length === 1);
  if (first && !byName.has(ALL_TABS[0].name)) {
    requests.push({ updateSheetProperties: { properties: { sheetId: first.sheetId, title: ALL_TABS[0].name }, fields: "title" } });
    byName.set(ALL_TABS[0].name, first);
    byName.delete("Sheet1");
  }
  ALL_TABS.forEach((t, i) => {
    if (byName.has(t.name)) return;
    requests.push({ addSheet: { properties: { title: t.name, index: i, tabColor: hex(t.color), gridProperties: { rowCount: t.layout === "free" ? 60 : 1000, columnCount: Math.max(8, t.columns.length), frozenRowCount: t.layout === "free" ? 0 : HEADER_ROWS } } } });
    created.push(t.name);
  });
  if (requests.length) {
    await batchUpdate(id, requests);
    meta = await getSpreadsheet(id);
  }
  const sheetOf = (t: TabSpec) => meta.sheets.find((s) => s.title === t.name)!;

  // 2. Headers, formatting, validation, colours, protection: one batch.
  const fmt: Record<string, unknown>[] = [];
  ALL_TABS.forEach((t, i) => {
    const s = sheetOf(t);
    if (!s) return;
    fmt.push({ updateSheetProperties: { properties: { sheetId: s.sheetId, index: i, tabColor: hex(t.color), gridProperties: { frozenRowCount: t.layout === "free" ? 0 : HEADER_ROWS } }, fields: "index,tabColor,gridProperties.frozenRowCount" } });
    if (t.layout === "free") return;
    const n = t.columns.length;
    // Header cells: text, bold, dark background, note on A1.
    fmt.push({
      updateCells: {
        range: { sheetId: s.sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: n },
        fields: "userEnteredValue,userEnteredFormat,note",
        rows: [
          {
            values: t.columns.map((col, k) => ({
              userEnteredValue: { stringValue: col.header },
              userEnteredFormat: { textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 } }, backgroundColor: { red: 0.13, green: 0.16, blue: 0.22 }, wrapStrategy: "WRAP", verticalAlignment: "MIDDLE" },
              note: k === 0 ? `${t.description}${col.note ? `\n\n${col.header}: ${col.note}` : ""}${t.placeholder ? `\n\n${t.placeholder}` : ""}` : col.note,
            })),
          },
        ],
      },
    });
    fmt.push({ updateDimensionProperties: { range: { sheetId: s.sheetId, dimension: "ROWS", startIndex: 0, endIndex: 1 }, properties: { pixelSize: 40 }, fields: "pixelSize" } });
    // Column widths and wrapping.
    t.columns.forEach((col, k) => {
      const width = col.width ?? (col.kind === "long" ? 320 : col.kind === "link" ? 140 : 140);
      fmt.push({ updateDimensionProperties: { range: { sheetId: s.sheetId, dimension: "COLUMNS", startIndex: k, endIndex: k + 1 }, properties: { pixelSize: width }, fields: "pixelSize" } });
      const format: Record<string, unknown> = { wrapStrategy: col.kind === "long" || col.editable ? "WRAP" : "CLIP", verticalAlignment: "TOP" };
      if (col.kind === "key") format.textFormat = { foregroundColor: { red: 0.6, green: 0.6, blue: 0.6 }, fontSize: 9 };
      if (col.kind === "number") format.horizontalAlignment = "RIGHT";
      fmt.push({ repeatCell: { range: { sheetId: s.sheetId, startRowIndex: HEADER_ROWS, startColumnIndex: k, endColumnIndex: k + 1 }, cell: { userEnteredFormat: format }, fields: "userEnteredFormat(wrapStrategy,verticalAlignment,textFormat,horizontalAlignment)" } });
      // Dropdowns on status columns.
      const options = col.kind === "status" ? (col.options ?? t.statuses) : null;
      if (options?.length) {
        fmt.push({ setDataValidation: { range: { sheetId: s.sheetId, startRowIndex: HEADER_ROWS, startColumnIndex: k, endColumnIndex: k + 1 }, rule: { condition: { type: "ONE_OF_LIST", values: options.map((v) => ({ userEnteredValue: v })) }, showCustomUi: true, strict: false } } });
      }
      // Owner columns get a faint tint so it's obvious where to type.
      if (col.owner || col.editable) {
        fmt.push({ repeatCell: { range: { sheetId: s.sheetId, startRowIndex: HEADER_ROWS, startColumnIndex: k, endColumnIndex: k + 1 }, cell: { userEnteredFormat: { backgroundColor: { red: 0.99, green: 0.98, blue: 0.93 } } }, fields: "userEnteredFormat.backgroundColor" } });
      }
    });
    // The filter on the whole table.
    fmt.push({ setBasicFilter: { filter: { range: { sheetId: s.sheetId, startRowIndex: 0, startColumnIndex: 0, endColumnIndex: n } } } });
    // Conditional colours: priorities, scores, and the statuses that need a look.
    const col = (key: string) => t.columns.findIndex((c) => c.key === key);
    const rule = (k: number, text: string, color: Record<string, number>, type = "TEXT_EQ") => ({
      addConditionalFormatRule: { rule: { ranges: [{ sheetId: s.sheetId, startRowIndex: HEADER_ROWS, startColumnIndex: k, endColumnIndex: k + 1 }], booleanRule: { condition: { type, values: [{ userEnteredValue: text }] }, format: { backgroundColor: color } } }, index: 0 },
    });
    const p = col("priority");
    if (p >= 0) fmt.push(rule(p, "High", RED), rule(p, "Medium", YELLOW), rule(p, "Low", GREY));
    const sc = col("score");
    if (sc >= 0) fmt.push(rule(sc, "80", GREEN, "NUMBER_GREATER_THAN_EQ"), rule(sc, "60", YELLOW, "NUMBER_GREATER_THAN_EQ"), rule(sc, "60", GREY, "NUMBER_LESS"));
    const st = col("status");
    if (st >= 0) fmt.push(rule(st, "Ready", BLUE), rule(st, "Needs Review", YELLOW), rule(st, "Failed", RED), rule(st, "Sent / Posted", GREEN), rule(st, "Completed", GREEN), rule(st, "Customer", GREEN), rule(st, "Meeting", GREEN));
    const mention = col("mentioned");
    if (mention >= 0) fmt.push(rule(mention, "Yes", GREEN), rule(mention, "No", RED));
    // Controls: everything but the Value column is read-only (a warning, not a lock: the owners are editors).
    if (t.id === "controls") {
      const v = col("value");
      fmt.push({ addProtectedRange: { protectedRange: { range: { sheetId: s.sheetId, startRowIndex: 0, startColumnIndex: 0, endColumnIndex: n }, description: "Written by the backend. Change only the Value column.", warningOnly: true, unprotectedRanges: [{ sheetId: s.sheetId, startRowIndex: HEADER_ROWS, startColumnIndex: v, endColumnIndex: v + 1 }] } } });
    }
    if (hasKeyColumn(t)) {
      const k = n - 1;
      fmt.push({ addProtectedRange: { protectedRange: { range: { sheetId: s.sheetId, startRowIndex: 0, startColumnIndex: k, endColumnIndex: k + 1 }, description: "The Key column is how the backend finds each row. Leave it alone.", warningOnly: true } } });
    }
    if (t.layout === "placeholder" && t.placeholder) {
      fmt.push({ updateCells: { range: { sheetId: s.sheetId, startRowIndex: 1, endRowIndex: 2, startColumnIndex: 0, endColumnIndex: 1 }, fields: "userEnteredValue,userEnteredFormat", rows: [{ values: [{ userEnteredValue: { stringValue: t.placeholder }, userEnteredFormat: { textFormat: { italic: true, foregroundColor: { red: 0.4, green: 0.4, blue: 0.4 } } } }] }] } });
    }
  });
  // Old protected ranges from a previous run would pile up: clear ours first.
  const old = await existingProtections(id);
  await batchUpdate(id, [...old.map((pid) => ({ deleteProtectedRange: { protectedRangeId: pid } })), ...fmt]);
  await store.kvSet(`${SPEC_KEY}:${id}`, want);
  await logActivity(store, { action: "sync", target: id, message: `Workbook set up: ${created.length ? `added ${created.join(", ")}; ` : ""}headers, dropdowns and colours refreshed.` });
  return { changed: true, created, meta: await getSpreadsheet(id) };
}

async function existingProtections(id: string): Promise<number[]> {
  const { googleFetch } = await import("../google/auth");
  const r = await googleFetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(id)}?fields=sheets.protectedRanges.protectedRangeId,sheets.protectedRanges.description`, { what: "spreadsheets.get" });
  const j = (await r.json()) as { sheets?: { protectedRanges?: { protectedRangeId: number; description?: string }[] }[] };
  return (j.sheets ?? []).flatMap((s) => (s.protectedRanges ?? []).filter((p) => /backend|Key column/.test(p.description ?? "")).map((p) => p.protectedRangeId));
}

export { colLetter, serviceAccountEmail };
