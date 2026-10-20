import { createSign } from "node:crypto";
import { env } from "../env";
import type { CrewStore } from "../store";
import type { Lead } from "../types";

// ── Google Sheets mirror of the lead lists (service account) ────────────────
// The database is the source of truth; the sheet is a copy for the owners.
// A service account signs a short-lived JWT (RS256), trades it for an access
// token, and appends rows (spreadsheets.values.append). Leads in GDPR-style
// regions are never written to the sheet. Writes are batched (up to 500 rows
// per request, a few requests per run), far inside the Sheets quota.

type ServiceAccount = { client_email: string; private_key: string };

let cached: { token: string; until: number } | null = null;

export function sheetsConfigured(list: Lead["list"]): boolean {
  return !!(env("GOOGLE_SHEETS_SA_JSON") && env(list === "office" ? "CREW_OFFICE_SHEET_ID" : "CREW_LEADS_SHEET_ID"));
}

function serviceAccount(): ServiceAccount {
  const sa = JSON.parse(env("GOOGLE_SHEETS_SA_JSON")!) as ServiceAccount;
  if (!sa.client_email || !sa.private_key) throw new Error("GOOGLE_SHEETS_SA_JSON is missing client_email or private_key");
  return sa;
}

const b64url = (s: string | Buffer) => Buffer.from(s).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");

export function signedJwt(sa: ServiceAccount, nowSec: number): string {
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64url(JSON.stringify({ iss: sa.client_email, scope: "https://www.googleapis.com/auth/spreadsheets", aud: "https://oauth2.googleapis.com/token", iat: nowSec, exp: nowSec + 3600 }));
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claim}`);
  return `${header}.${claim}.${b64url(signer.sign(sa.private_key.replace(/\\n/g, "\n")))}`;
}

async function accessToken(): Promise<string> {
  if (cached && cached.until > Date.now() + 60_000) return cached.token;
  const jwt = signedJwt(serviceAccount(), Math.floor(Date.now() / 1000));
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!r.ok) throw new Error(`google token: HTTP ${r.status}`);
  const j = (await r.json()) as { access_token: string; expires_in: number };
  cached = { token: j.access_token, until: Date.now() + j.expires_in * 1000 };
  return j.access_token;
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
    headers: { Authorization: `Bearer ${await accessToken()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ values: rows }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!r.ok) throw new Error(`sheets append: HTTP ${r.status}`);
}

/** Copy new leads to the sheet. Returns how many rows were written. */
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
