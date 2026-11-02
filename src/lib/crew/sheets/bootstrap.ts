import { createHash } from "node:crypto";
import { env, sheetShareEmails } from "../env";
import { googleConfigured, serviceAccountEmail } from "../google/auth";
import { MIME, createFile, ensureFolder, shareWith } from "../google/drive";
import { batchUpdate, colLetter, getSpreadsheet, sheetUrl, type SpreadsheetMeta } from "../google/sheets";
import type { CrewStore } from "../store";
import { logActivity } from "./activity";
import { NEEDS_MESSAGE } from "./rows";
import { hasKeyColumn, type Column, type TabSpec } from "./spec";
import { ALL_TABS } from "./tabs";

// ── The workbook: created once, kept in shape ───────────────────────────────
// One workbook, "SwiftCard Leads", in the Shared Drive. Every tab from
// tabs.ts exists with its header row, frozen, bold, filtered, sized, wrapped,
// with the Key column hidden (each tab shows only Name, Message, Link), light
// alternating rows, the header row locked and the Key behind a warning.
// Idempotent: a hash of the tab specs (and of LOOKS_VERSION / PROTECT_VERSION)
// is kept in crew_kv, so this runs again only when one of them changes. Tabs are removed only by retireTabs, when the
// layout itself changes (sync.ts), and only by the names it is given.

export const WORKBOOK_NAME = "SwiftCard Leads";
export const DAILY_FOLDER = "Daily";
const SPEC_KEY = "sheet:spec-hash";
const PROTECT_KEY = "sheet:protect-hash";
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

// ── Colours (2026-11-02, owner: dark rows with dark text, blue links on dark) ──
// Every body cell now carries its own light background (white and a faint
// grey, alternating), dark text and a dark blue link, so nothing depends on
// what Google copies into a new row. Contrast on both bands, WCAG AA (4.5:1)
// or better on the darker band: header 14.7:1, ink 13.5:1, link 5.7:1,
// Key grey 5.3:1, "Needs a message" 8.1:1 (tests/crew-sheet-looks.test.ts).
export const SHEET_COLORS = {
  headerBg: hex("1f2937")!,
  headerText: { red: 1, green: 1, blue: 1 },
  ink: hex("1f2937")!,
  link: hex("1a56db")!,
  key: hex("5f6672")!,
  band1: { red: 1, green: 1, blue: 1 },
  band2: hex("f3f6fa")!,
  needsBg: hex("fef3c7")!,
  needsText: hex("78350f")!,
};

/**
 * Bump to make every workbook redo its looks / protections once, on the next
 * sync, when the code that makes them changes but the tab specs don't.
 */
const LOOKS_VERSION = "light-rows-2026-11-02";
const PROTECT_VERSION = "locked-header-key-2026-11-02";

/** The conditional colours this code adds; a refresh deletes exactly these before adding them again. */
const OUR_RULE_COLORS = [GREEN, YELLOW, GREY, RED, BLUE, SHEET_COLORS.needsBg];

/** The format of a body cell in this column (below the header): light, dark text, links dark blue. */
export function bodyFormat(col: Column): Record<string, unknown> {
  const f: Record<string, unknown> = {
    wrapStrategy: col.kind === "long" || col.editable ? "WRAP" : "CLIP",
    verticalAlignment: "TOP",
    textFormat: { foregroundColor: SHEET_COLORS.ink, fontSize: 10, bold: false, italic: false },
  };
  if (col.kind === "key") f.textFormat = { foregroundColor: SHEET_COLORS.key, fontSize: 9 };
  if (col.kind === "link") f.textFormat = { foregroundColor: SHEET_COLORS.link, fontSize: 10, underline: true };
  if (col.kind === "number") f.horizontalAlignment = "RIGHT";
  return f;
}

// The fill is cleared (both the old and the new field) so the alternating
// bands show; a fill copied from the header into a new row goes with it.
const BODY_FIELDS = "userEnteredFormat(backgroundColor,backgroundColorStyle,wrapStrategy,verticalAlignment,textFormat,horizontalAlignment)";

/** Format body rows [startRow, endRow) of a tab (0-based; no end = to the bottom). Formats only: never a value. */
export function bodyRowRequests(t: TabSpec, sheetId: number, startRow: number, endRow?: number): Req[] {
  return t.columns.map((col, k) => ({
    repeatCell: {
      range: { sheetId, startRowIndex: startRow, ...(endRow !== undefined ? { endRowIndex: endRow } : {}), startColumnIndex: k, endColumnIndex: k + 1 },
      cell: { userEnteredFormat: bodyFormat(col) },
      fields: BODY_FIELDS,
    },
  }));
}

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

type Req = Record<string, unknown>;

/**
 * Delete these tabs from the workbook (a layout change: sync.ts makes them
 * again, clean). Never the last tab: Google refuses that, so Paste a Post is
 * made first if nothing else would be left. Returns the names removed.
 */
export async function retireTabs(id: string, names: Set<string>): Promise<string[]> {
  const meta = await getSpreadsheet(id);
  const doomed = meta.sheets.filter((s) => names.has(s.title));
  if (!doomed.length) return [];
  const requests: Req[] = [];
  if (doomed.length === meta.sheets.length) {
    const keep = ALL_TABS.find((t) => !names.has(t.name)) ?? ALL_TABS[0];
    requests.push({ addSheet: { properties: { title: keep.name, gridProperties: { rowCount: 1000, columnCount: Math.max(8, keep.columns.length), frozenRowCount: HEADER_ROWS } } } });
  }
  for (const s of doomed) requests.push({ deleteSheet: { sheetId: s.sheetId } });
  await batchUpdate(id, requests);
  return doomed.map((s) => s.title);
}

/**
 * Make every tab exist and look right. Returns what it did. Only the tabs and
 * their header rows are required for the sync to write rows; the looks
 * (widths, dropdowns, colours, filters) and the protections are extras, so a
 * failure there comes back in `warnings` and never stops leads reaching the
 * Sheet. Each extra keeps its own hash and is retried by the next sync until
 * it goes through.
 */
export async function ensureWorkbook(store: CrewStore, id: string, o: { force?: boolean } = {}): Promise<{ changed: boolean; created: string[]; meta: SpreadsheetMeta; warnings: string[] }> {
  let meta = await getSpreadsheet(id);
  const spec = specHash();
  const wantLooks = `${spec}:${LOOKS_VERSION}`;
  const wantProtect = `${spec}:${PROTECT_VERSION}`;
  const [haveLooks, haveProtect] = await Promise.all([store.kvGet<string>(`${SPEC_KEY}:${id}`), store.kvGet<string>(`${PROTECT_KEY}:${id}`)]);
  const doLooks = haveLooks !== wantLooks || !!o.force;
  const doProtect = haveProtect !== wantProtect || !!o.force;
  if (!doLooks && !doProtect) return { changed: false, created: [], meta, warnings: [] };

  // 1. Tabs that don't exist yet, in spec order; the default "Sheet1" becomes the Dashboard.
  const byName = new Map(meta.sheets.map((s) => [s.title, s]));
  const requests: Req[] = [];
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

  // 2. Header rows: required (appends land under them, reads start below them).
  const parts = workbookRequests(meta.sheets, { editor: serviceAccountEmail() });
  await batchUpdate(id, parts.headers);

  // 3. The looks and the protections: optional, each in its own batch.
  const warnings: string[] = [];
  if (doLooks) {
    try {
      // Bands and our conditional colours from a previous run would pile up
      // (Google refuses a second band on the same cells): clear ours first, in
      // the same batch, so a refusal leaves the old looks exactly as they were.
      const managed = new Set(ALL_TABS.filter((t) => t.layout !== "free").map((t) => meta.sheets.find((s) => s.title === t.name)?.sheetId).filter((x): x is number => x !== undefined));
      const old = await existingLooks(id, managed);
      await batchUpdate(id, [...old, ...parts.looks]);
      await store.kvSet(`${SPEC_KEY}:${id}`, wantLooks);
    } catch (e) {
      warnings.push(`formatting: ${errText(e)}`);
    }
  }
  if (doProtect) {
    try {
      // Old protected ranges from a previous run would pile up: clear ours first.
      const old = await existingProtections(id);
      await batchUpdate(id, [...old.map((pid) => ({ deleteProtectedRange: { protectedRangeId: pid } })), ...parts.protection]);
      await store.kvSet(`${PROTECT_KEY}:${id}`, wantProtect);
    } catch (e) {
      warnings.push(`protection: ${errText(e)}`);
    }
  }
  await logActivity(store, {
    action: "sync",
    target: id,
    result: warnings.length ? "failed" : "ok",
    ...(warnings.length ? { error: warnings.join(" | ").slice(0, 500) } : {}),
    message: `Workbook set up: ${created.length ? `added ${created.join(", ")}; ` : ""}headers ${warnings.length ? "written; some formatting did not apply and will be retried" : "and formatting refreshed"}.`,
  });
  return { changed: true, created, meta: await getSpreadsheet(id), warnings };
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 300);

/**
 * Every formatting request for the workbook's tabs, in three groups: the
 * header rows (required), the looks, and the protections. Pure, so the
 * requests Google would reject can be caught in a test.
 */
export function workbookRequests(sheets: { sheetId: number; title: string }[], o: { editor?: string | null } = {}): { headers: Req[]; looks: Req[]; protection: Req[] } {
  const headers: Req[] = [];
  const looks: Req[] = [];
  const protection: Req[] = [];
  // The header row is locked: only the service account (the sync) may change
  // it; anyone else editing there is refused, not warned. Without the
  // account's address the lock can't name its editor, so it falls back to a
  // warning. The Key column stays a warning on purpose: a lock there would
  // refuse the owner sorting or deleting whole rows (both move Key cells),
  // which is exactly how SETUP.md says to sort, while still allowing the
  // harmful sort of the visible columns alone, which never touches a Key.
  const lock = o.editor ? { warningOnly: false, editors: { users: [o.editor] } } : { warningOnly: true };
  const warn = { warningOnly: true };
  ALL_TABS.forEach((t, i) => {
    const s = sheets.find((x) => x.title === t.name);
    if (!s) return;
    headers.push({ updateSheetProperties: { properties: { sheetId: s.sheetId, index: i, tabColor: hex(t.color), gridProperties: { frozenRowCount: t.layout === "free" ? 0 : HEADER_ROWS } }, fields: "index,tabColor,gridProperties.frozenRowCount" } });
    if (t.layout === "free") return;
    const n = t.columns.length;
    // Header cells: text, bold, dark background, note on A1.
    headers.push({
      updateCells: {
        range: { sheetId: s.sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: n },
        fields: "userEnteredValue,userEnteredFormat,note",
        rows: [
          {
            values: t.columns.map((col, k) => ({
              userEnteredValue: { stringValue: col.header },
              userEnteredFormat: { textFormat: { bold: true, foregroundColor: SHEET_COLORS.headerText }, backgroundColor: SHEET_COLORS.headerBg, wrapStrategy: "WRAP", verticalAlignment: "MIDDLE" },
              note: k === 0 ? `${t.description}${col.note ? `\n\n${col.header}: ${col.note}` : ""}${t.placeholder ? `\n\n${t.placeholder}` : ""}` : col.note,
            })),
          },
        ],
      },
    });
    if (t.layout === "placeholder" && t.placeholder) {
      headers.push({ updateCells: { range: { sheetId: s.sheetId, startRowIndex: 1, endRowIndex: 2, startColumnIndex: 0, endColumnIndex: 1 }, fields: "userEnteredValue,userEnteredFormat", rows: [{ values: [{ userEnteredValue: { stringValue: t.placeholder }, userEnteredFormat: { textFormat: { italic: true, foregroundColor: { red: 0.4, green: 0.4, blue: 0.4 } } } }] }] } });
    }
    looks.push({ updateDimensionProperties: { range: { sheetId: s.sheetId, dimension: "ROWS", startIndex: 0, endIndex: 1 }, properties: { pixelSize: 40 }, fields: "pixelSize" } });
    // Column widths and wrapping.
    t.columns.forEach((col, k) => {
      const width = col.width ?? (col.kind === "long" ? 320 : col.kind === "link" ? 140 : 140);
      looks.push({ updateDimensionProperties: { range: { sheetId: s.sheetId, dimension: "COLUMNS", startIndex: k, endIndex: k + 1 }, properties: { pixelSize: width }, fields: "pixelSize" } });
      if (col.kind === "key") {
        // The owner asked for three columns: the Key the sync finds rows by is hidden.
        looks.push({ updateDimensionProperties: { range: { sheetId: s.sheetId, dimension: "COLUMNS", startIndex: k, endIndex: k + 1 }, properties: { hiddenByUser: true }, fields: "hiddenByUser" } });
      }
      // Dropdowns on status columns.
      const options = col.kind === "status" ? (col.options ?? t.statuses) : null;
      if (options?.length) {
        looks.push({ setDataValidation: { range: { sheetId: s.sheetId, startRowIndex: HEADER_ROWS, startColumnIndex: k, endColumnIndex: k + 1 }, rule: { condition: { type: "ONE_OF_LIST", values: options.map((v) => ({ userEnteredValue: v })) }, showCustomUi: true, strict: false } } });
      }
    });
    // Every body cell: light, dark text, dark blue links (and no fill of its
    // own, so the bands below show through). The old cream tint on the
    // Message column goes; "Needs a message" gets its own colour instead.
    looks.push(...bodyRowRequests(t, s.sheetId, HEADER_ROWS));
    looks.push({ addBanding: { bandedRange: { range: { sheetId: s.sheetId, startRowIndex: HEADER_ROWS, startColumnIndex: 0, endColumnIndex: n }, rowProperties: { firstBandColor: SHEET_COLORS.band1, secondBandColor: SHEET_COLORS.band2 } } } });
    // The filter on the whole table.
    looks.push({ setBasicFilter: { filter: { range: { sheetId: s.sheetId, startRowIndex: 0, startColumnIndex: 0, endColumnIndex: n } } } });
    // Conditional colours: priorities, scores, and the statuses that need a look.
    const col = (key: string) => t.columns.findIndex((c) => c.key === key);
    const rule = (k: number, text: string, color: Record<string, number>, type = "TEXT_EQ") => ({
      addConditionalFormatRule: { rule: { ranges: [{ sheetId: s.sheetId, startRowIndex: HEADER_ROWS, startColumnIndex: k, endColumnIndex: k + 1 }], booleanRule: { condition: { type, values: [{ userEnteredValue: text }] }, format: { backgroundColor: color } } }, index: 0 },
    });
    const p = col("priority");
    if (p >= 0) looks.push(rule(p, "High", RED), rule(p, "Medium", YELLOW), rule(p, "Low", GREY));
    const sc = col("score");
    if (sc >= 0) looks.push(rule(sc, "80", GREEN, "NUMBER_GREATER_THAN_EQ"), rule(sc, "60", YELLOW, "NUMBER_GREATER_THAN_EQ"), rule(sc, "60", GREY, "NUMBER_LESS"));
    const st = col("status");
    if (st >= 0) looks.push(rule(st, "Ready", BLUE), rule(st, "Needs Review", YELLOW), rule(st, "Failed", RED), rule(st, "Sent / Posted", GREEN), rule(st, "Completed", GREEN), rule(st, "Customer", GREEN), rule(st, "Meeting", GREEN));
    const mention = col("mentioned");
    if (mention >= 0) looks.push(rule(mention, "Yes", GREEN), rule(mention, "No", RED));
    // A lead with no message yet stands out: amber, dark brown text.
    const m = col("message");
    if (m >= 0) {
      looks.push({
        addConditionalFormatRule: {
          rule: {
            ranges: [{ sheetId: s.sheetId, startRowIndex: HEADER_ROWS, startColumnIndex: m, endColumnIndex: m + 1 }],
            booleanRule: { condition: { type: "TEXT_STARTS_WITH", values: [{ userEnteredValue: NEEDS_MESSAGE.split(":")[0] }] }, format: { backgroundColor: SHEET_COLORS.needsBg, textFormat: { foregroundColor: SHEET_COLORS.needsText, italic: true } } },
          },
          index: 0,
        },
      });
    }
    // The header row: locked, all of it (the Name, Message and Link headings and the Key's).
    protection.push({ addProtectedRange: { protectedRange: { range: { sheetId: s.sheetId, startRowIndex: 0, endRowIndex: HEADER_ROWS, startColumnIndex: 0, endColumnIndex: n }, description: "The header row is written by the backend. Leave it alone.", ...lock } } });
    // Controls: everything but the Value column is read-only (a warning, not a lock: the owners are editors).
    // Google allows unprotectedRanges only on a protection that covers the WHOLE sheet, so the
    // range is the sheet itself ({ sheetId } and nothing else), not a block of columns.
    if (t.id === "controls") {
      const v = col("value");
      protection.push({ addProtectedRange: { protectedRange: { range: { sheetId: s.sheetId }, description: "Written by the backend. Change only the Value column.", warningOnly: true, unprotectedRanges: [{ sheetId: s.sheetId, startRowIndex: HEADER_ROWS, startColumnIndex: v, endColumnIndex: v + 1 }] } } });
    }
    if (hasKeyColumn(t)) {
      // Below the header (the header lock covers its first cell): every row's Key.
      const k = n - 1;
      protection.push({ addProtectedRange: { protectedRange: { range: { sheetId: s.sheetId, startRowIndex: HEADER_ROWS, startColumnIndex: k, endColumnIndex: k + 1 }, description: "The Key column is how the backend finds each row. Leave it alone.", ...warn } } });
    }
  });
  return { headers, looks, protection };
}

const near = (a: Record<string, number | undefined> | undefined, b: Record<string, number>) =>
  !!a && (["red", "green", "blue"] as const).every((ch) => Math.abs((a[ch] ?? 0) - b[ch]) < 0.01);

/**
 * The requests that take this code's own looks off the managed tabs: every
 * alternating band there, and each conditional rule whose colour is one of
 * ours (a rule the owner added in another colour stays). Rules go by index,
 * highest first, so the indexes still to go don't move.
 */
async function existingLooks(id: string, managed: Set<number>): Promise<Req[]> {
  const { googleFetch } = await import("../google/auth");
  const r = await googleFetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(id)}?fields=sheets(properties.sheetId,bandedRanges.bandedRangeId,conditionalFormats.booleanRule.format.backgroundColor)`, { what: "spreadsheets.get" });
  type Sheet = { properties?: { sheetId?: number }; bandedRanges?: { bandedRangeId: number }[]; conditionalFormats?: { booleanRule?: { format?: { backgroundColor?: Record<string, number> } } }[] };
  const j = (await r.json()) as { sheets?: Sheet[] };
  const out: Req[] = [];
  for (const s of j.sheets ?? []) {
    const sheetId = s.properties?.sheetId ?? 0; // Google leaves out a 0
    if (!managed.has(sheetId)) continue;
    for (const b of s.bandedRanges ?? []) out.push({ deleteBanding: { bandedRangeId: b.bandedRangeId } });
    const ours = (s.conditionalFormats ?? []).map((f, index) => ({ index, color: f.booleanRule?.format?.backgroundColor })).filter((f) => OUR_RULE_COLORS.some((c) => near(f.color, c)));
    for (const f of ours.reverse()) out.push({ deleteConditionalFormatRule: { sheetId, index: f.index } });
  }
  return out;
}

async function existingProtections(id: string): Promise<number[]> {
  const { googleFetch } = await import("../google/auth");
  const r = await googleFetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(id)}?fields=sheets.protectedRanges.protectedRangeId,sheets.protectedRanges.description`, { what: "spreadsheets.get" });
  const j = (await r.json()) as { sheets?: { protectedRanges?: { protectedRangeId: number; description?: string }[] }[] };
  return (j.sheets ?? []).flatMap((s) => (s.protectedRanges ?? []).filter((p) => /backend|Key column/.test(p.description ?? "")).map((p) => p.protectedRangeId));
}

export { colLetter, serviceAccountEmail };
