import { googleFetch } from "./auth";

// ── Google Sheets API v4, the few calls the headquarters needs ──────────────
// Every call here is one request against the per-minute quota, so the sync
// batches: one values.batchGet for every tab it reads, one values.batchUpdate
// for every cell it writes, one spreadsheets.batchUpdate for formatting.

const BASE = "https://sheets.googleapis.com/v4/spreadsheets";

export type SheetMeta = { sheetId: number; title: string; index: number; rowCount: number; columnCount: number; frozenRows: number };
export type SpreadsheetMeta = { spreadsheetId: string; title: string; url: string; sheets: SheetMeta[] };

export type CellValue = string | number | boolean | null;

/** Column number (0-based) → letters: 0 → A, 25 → Z, 26 → AA. */
export function colLetter(i: number): string {
  let s = "";
  for (let n = i; n >= 0; n = Math.floor(n / 26) - 1) s = String.fromCharCode(65 + (n % 26)) + s;
  return s;
}

/** 'Tab name'!A1:C5, with the quotes Sheets wants around a tab name. */
export function a1(tab: string, range?: string): string {
  const t = `'${tab.replace(/'/g, "''")}'`;
  return range ? `${t}!${range}` : t;
}

/**
 * Text that Sheets would otherwise run as a formula (a leading = + - @) gets
 * a leading apostrophe, so scraped text can never become a formula. Our own
 * HYPERLINK formulas are built by `link()` and pass through untouched.
 */
export function safeCell(v: CellValue): CellValue {
  if (typeof v !== "string") return v;
  if (v.startsWith("=HYPERLINK(")) return v;
  return /^[=+\-@]/.test(v) ? `'${v}` : v;
}

/** A clickable cell: =HYPERLINK("url","label"). Web links and mailto: only; anything else (javascript:, a paste id) is no link. */
export function link(url: string | null | undefined, label: string): string {
  if (!url || !/^(https?:\/\/|mailto:[^@\s]+@[^@\s]+$)/i.test(url)) return "";
  const q = (s: string) => s.replace(/"/g, '""');
  return `=HYPERLINK("${q(url)}","${q(label)}")`;
}

export async function getSpreadsheet(id: string): Promise<SpreadsheetMeta> {
  const r = await googleFetch(`${BASE}/${encodeURIComponent(id)}?fields=spreadsheetId,properties.title,spreadsheetUrl,sheets.properties`, { what: "spreadsheets.get" });
  const j = (await r.json()) as { spreadsheetId: string; spreadsheetUrl: string; properties: { title: string }; sheets: { properties: { sheetId: number; title: string; index: number; gridProperties?: { rowCount?: number; columnCount?: number; frozenRowCount?: number } } }[] };
  return {
    spreadsheetId: j.spreadsheetId,
    title: j.properties.title,
    url: j.spreadsheetUrl,
    sheets: (j.sheets ?? []).map((s) => ({
      sheetId: s.properties.sheetId,
      title: s.properties.title,
      index: s.properties.index,
      rowCount: s.properties.gridProperties?.rowCount ?? 0,
      columnCount: s.properties.gridProperties?.columnCount ?? 0,
      frozenRows: s.properties.gridProperties?.frozenRowCount ?? 0,
    })),
  };
}

/** Several ranges in one request. Missing ranges come back as empty arrays. */
export async function batchGet(id: string, ranges: string[], o: { formulas?: boolean } = {}): Promise<Record<string, CellValue[][]>> {
  if (!ranges.length) return {};
  const out: Record<string, CellValue[][]> = {};
  // The URL has a practical length limit; 40 ranges per request keeps it safe.
  for (let i = 0; i < ranges.length; i += 40) {
    const chunk = ranges.slice(i, i + 40);
    const qs = chunk.map((r) => `ranges=${encodeURIComponent(r)}`).join("&");
    const r = await googleFetch(`${BASE}/${encodeURIComponent(id)}/values:batchGet?${qs}&valueRenderOption=${o.formulas ? "FORMULA" : "UNFORMATTED_VALUE"}&dateTimeRenderOption=FORMATTED_STRING`, { what: "values.batchGet" });
    const j = (await r.json()) as { valueRanges?: { range: string; values?: CellValue[][] }[] };
    (j.valueRanges ?? []).forEach((vr, k) => {
      out[chunk[k]] = vr.values ?? [];
    });
  }
  return out;
}

export type ValueWrite = { range: string; values: CellValue[][] };

/** Write cells in one request (USER_ENTERED, so HYPERLINK formulas work; text is escaped by safeCell). */
export async function batchUpdateValues(id: string, writes: ValueWrite[]): Promise<number> {
  if (!writes.length) return 0;
  let cells = 0;
  for (let i = 0; i < writes.length; i += 200) {
    const chunk = writes.slice(i, i + 200);
    await googleFetch(`${BASE}/${encodeURIComponent(id)}/values:batchUpdate`, {
      method: "POST",
      what: "values.batchUpdate",
      body: JSON.stringify({ valueInputOption: "USER_ENTERED", data: chunk.map((w) => ({ range: w.range, values: w.values.map((row) => row.map(safeCell)) })) }),
    });
    cells += chunk.reduce((n, w) => n + w.values.reduce((m, r) => m + r.length, 0), 0);
  }
  return cells;
}

/** Append rows under the last filled row of a tab. */
export async function appendRows(id: string, tab: string, rows: CellValue[][]): Promise<{ firstRow: number }> {
  if (!rows.length) return { firstRow: 0 };
  const r = await googleFetch(`${BASE}/${encodeURIComponent(id)}/values/${encodeURIComponent(a1(tab, "A1"))}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS&includeValuesInResponse=false`, {
    method: "POST",
    what: "values.append",
    body: JSON.stringify({ values: rows.map((row) => row.map(safeCell)) }),
  });
  const j = (await r.json()) as { updates?: { updatedRange?: string } };
  const m = /![A-Z]+(\d+):/.exec(j.updates?.updatedRange ?? "");
  return { firstRow: m ? Number(m[1]) : 0 };
}

export async function clearRange(id: string, range: string): Promise<void> {
  await googleFetch(`${BASE}/${encodeURIComponent(id)}/values/${encodeURIComponent(range)}:clear`, { method: "POST", what: "values.clear", body: "{}" });
}

/** Structural and formatting changes (add tab, freeze, widths, validation, colours, protection). */
export async function batchUpdate(id: string, requests: Record<string, unknown>[]): Promise<Record<string, unknown>[]> {
  if (!requests.length) return [];
  const replies: Record<string, unknown>[] = [];
  for (let i = 0; i < requests.length; i += 100) {
    const r = await googleFetch(`${BASE}/${encodeURIComponent(id)}/:batchUpdate`, { method: "POST", what: "spreadsheets.batchUpdate", body: JSON.stringify({ requests: requests.slice(i, i + 100) }), timeoutMs: 60_000 });
    const j = (await r.json()) as { replies?: Record<string, unknown>[] };
    replies.push(...(j.replies ?? []));
  }
  return replies;
}

export function sheetUrl(id: string, gid?: number): string {
  return `https://docs.google.com/spreadsheets/d/${id}/edit${gid !== undefined ? `#gid=${gid}` : ""}`;
}
