import { env } from "../env";
import { accessToken, googleConfigured } from "../google/auth";
import type { CrewStore } from "../store";
import type { Lead } from "../types";

// ── The old two-sheet lead mirror (service account) ─────────────────────────
// Before the headquarters workbook existed, new leads were appended to two
// plain sheets (cold leads, Office prospects). That still works while
// CREW_SHEET_ID is unset; once the workbook exists, its All Leads and Office
// Prospects tabs carry every lead (src/lib/crew/sheets) and this mirror stays
// quiet. The database is the source of truth either way.

export { signedJwt } from "../google/auth";

export function sheetsConfigured(list: Lead["list"]): boolean {
  if (env("CREW_SHEET_ID")) return false; // the workbook has these tabs now
  return googleConfigured() && !!env(list === "office" ? "CREW_OFFICE_SHEET_ID" : "CREW_LEADS_SHEET_ID");
}

export const SHEET_HEADER = ["Found", "Name", "Email", "Phone", "Company", "Title", "Business type", "City", "State", "Country", "Source", "Source URL", "Notes"];

export function leadRow(l: Lead & { created_at: string }): string[] {
  return [l.created_at.slice(0, 10), l.name ?? "", l.email ?? "", l.phone ?? "", l.company ?? "", l.title ?? "", l.business_type ?? "", l.city ?? "", l.region ?? "", l.country ?? "", l.source_platform, l.source_url, l.notes ?? ""].map((v) =>
    // A leading = + - @ would be run as a formula by Sheets; never let scraped text do that.
    /^[=+\-@]/.test(v) ? `'${v}` : v,
  );
}

async function append(sheetId: string, rows: string[][]): Promise<void> {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}/values/${encodeURIComponent("A1")}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`;
  const r = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${await accessToken(["sheets"])}`, "Content-Type": "application/json" },
    body: JSON.stringify({ values: rows }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!r.ok) throw new Error(`sheets append: HTTP ${r.status}`);
}

/** Copy new leads to the old plain sheet. Returns how many rows were written. */
export async function syncLeadsToSheet(store: CrewStore, list: Lead["list"], maxRows = 1500): Promise<number> {
  if (!sheetsConfigured(list)) return 0;
  const sheetId = env(list === "office" ? "CREW_OFFICE_SHEET_ID" : "CREW_LEADS_SHEET_ID")!;
  let written = 0;
  if (!(await store.kvGet<boolean>(`sheet-header:${list}`))) {
    await append(sheetId, [SHEET_HEADER]);
    await store.kvSet(`sheet-header:${list}`, true);
  }
  while (written < maxRows) {
    const batch = (await store.unsyncedLeads(list, 500)).filter((l) => !l.region_restricted);
    if (!batch.length) break;
    await append(sheetId, batch.map(leadRow));
    await store.markLeadsSynced(batch.map((l) => l.id));
    written += batch.length;
  }
  return written;
}
