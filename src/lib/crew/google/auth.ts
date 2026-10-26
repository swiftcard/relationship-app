import { createSign } from "node:crypto";
import { env } from "../env";

// ── Google, as the service account ──────────────────────────────────────────
// One service account (GOOGLE_SHEETS_SA_JSON) does everything Google-side:
// the workbook, the Drive snapshots, reading the booking calendar. It signs a
// short-lived RS256 JWT itself (no googleapis package; the SDK is 10 MB for
// four endpoints) and trades it for an access token per scope set. Tokens are
// cached in module memory for their lifetime.
//
// Why a service account and a Shared Drive: a service account has no Drive
// storage of its own and cannot own a file in anyone's My Drive
// (storageQuotaExceeded), but it can create files in a Workspace Shared Drive
// it is a member of. So the workbook and the daily snapshots live in the
// Shared Drive from CREW_SHARED_DRIVE_ID.

export type ServiceAccount = { client_email: string; private_key: string };

export const SCOPES = {
  sheets: "https://www.googleapis.com/auth/spreadsheets",
  drive: "https://www.googleapis.com/auth/drive",
  calendar: "https://www.googleapis.com/auth/calendar.readonly",
} as const;
export type Scope = keyof typeof SCOPES;

const cache = new Map<string, { token: string; until: number }>();

export function googleConfigured(): boolean {
  return !!env("GOOGLE_SHEETS_SA_JSON");
}

export function serviceAccount(): ServiceAccount {
  const raw = env("GOOGLE_SHEETS_SA_JSON");
  if (!raw) throw new Error("GOOGLE_SHEETS_SA_JSON is not set");
  const sa = JSON.parse(raw) as ServiceAccount;
  if (!sa.client_email || !sa.private_key) throw new Error("GOOGLE_SHEETS_SA_JSON is missing client_email or private_key");
  return sa;
}

/** The service account's email: share a Drive or a sheet with it. */
export function serviceAccountEmail(): string | null {
  try {
    return serviceAccount().client_email;
  } catch {
    return null;
  }
}

const b64url = (s: string | Buffer) => Buffer.from(s).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");

export function signedJwt(sa: ServiceAccount, nowSec: number, scopes: string[] = [SCOPES.sheets]): string {
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64url(JSON.stringify({ iss: sa.client_email, scope: scopes.join(" "), aud: "https://oauth2.googleapis.com/token", iat: nowSec, exp: nowSec + 3600 }));
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claim}`);
  return `${header}.${claim}.${b64url(signer.sign(sa.private_key.replace(/\\n/g, "\n")))}`;
}

export async function accessToken(scopes: Scope[] = ["sheets"]): Promise<string> {
  const key = scopes.slice().sort().join(" ");
  const hit = cache.get(key);
  if (hit && hit.until > Date.now() + 60_000) return hit.token;
  const jwt = signedJwt(serviceAccount(), Math.floor(Date.now() / 1000), scopes.map((s) => SCOPES[s]));
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!r.ok) throw new Error(`google token: HTTP ${r.status}`);
  const j = (await r.json()) as { access_token: string; expires_in: number };
  cache.set(key, { token: j.access_token, until: Date.now() + j.expires_in * 1000 });
  return j.access_token;
}

export class GoogleHttpError extends Error {
  constructor(
    public status: number,
    public body: string,
    what: string,
  ) {
    super(`${what}: HTTP ${status}${body ? ` ${body.slice(0, 200)}` : ""}`);
    this.name = "GoogleHttpError";
  }
}

/**
 * One Google API call with the right token. 429 and 5xx are retried with
 * backoff (the Sheets quota is 300 reads and 300 writes a minute per project;
 * Google asks for exponential backoff on "Too many requests").
 */
export async function googleFetch(url: string, init: RequestInit & { scopes?: Scope[]; what?: string; timeoutMs?: number } = {}): Promise<Response> {
  const { scopes = ["sheets"], what = "google", timeoutMs = 30_000, ...rest } = init;
  let wait = 1500;
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(url, {
      ...rest,
      headers: { ...(rest.headers ?? {}), Authorization: `Bearer ${await accessToken(scopes)}`, ...(rest.body ? { "Content-Type": "application/json" } : {}) },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (r.ok) return r;
    const retry = (r.status === 429 || r.status >= 500) && attempt < 4;
    const body = await r.text().catch(() => "");
    if (!retry) throw new GoogleHttpError(r.status, body, what);
    await new Promise((res) => setTimeout(res, wait));
    wait = Math.min(wait * 2, 20_000);
  }
}
