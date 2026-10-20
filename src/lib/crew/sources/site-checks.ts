import { promises as dns } from "node:dns";
import tls from "node:tls";
import { getAdminSupabase } from "@/lib/supabase-admin";

// Read-only checks of our own domain and our own tables. Nothing here sends
// traffic anywhere but swiftcard.me and our database.

export const SITE_HOST = "swiftcard.me";

export async function tlsDaysLeft(host = SITE_HOST): Promise<number | null> {
  return new Promise((resolve) => {
    const s = tls.connect({ host, port: 443, servername: host, timeout: 8000 }, () => {
      const cert = s.getPeerCertificate();
      s.end();
      resolve(cert?.valid_to ? Math.floor((new Date(cert.valid_to).getTime() - Date.now()) / 86400_000) : null);
    });
    s.on("error", () => resolve(null));
    s.on("timeout", () => {
      s.destroy();
      resolve(null);
    });
  });
}

export const REQUIRED_HEADERS = ["strict-transport-security", "x-frame-options", "x-content-type-options", "referrer-policy"];

export async function missingSecurityHeaders(url = `https://${SITE_HOST}/`): Promise<string[] | null> {
  try {
    const r = await fetch(url, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(10_000) });
    return REQUIRED_HEADERS.filter((h) => !r.headers.get(h));
  } catch {
    return null;
  }
}

export async function dnsProblems(host = SITE_HOST): Promise<string[]> {
  const out: string[] = [];
  try {
    if (!(await dns.resolve4(host)).length) out.push("no A record");
  } catch {
    out.push("A record lookup failed");
  }
  try {
    if (!(await dns.resolveMx(host)).length) out.push("no MX record (email to the domain would bounce)");
  } catch {
    out.push("MX lookup failed");
  }
  return out;
}

/** Rows created in the last hour vs the average hour of the week before. */
export async function hourlyRate(table: "profiles" | "error_events", now: Date): Promise<{ lastHour: number; avgHour: number } | null> {
  const db = getAdminSupabase();
  const hourAgo = new Date(now.getTime() - 3600_000).toISOString();
  const weekAgo = new Date(now.getTime() - 7 * 86400_000).toISOString();
  const last = await db.from(table).select("id", { count: "exact", head: true }).gte("created_at", hourAgo);
  const week = await db.from(table).select("id", { count: "exact", head: true }).gte("created_at", weekAgo).lt("created_at", hourAgo);
  if (last.error || week.error) return null;
  return { lastHour: last.count ?? 0, avgHour: (week.count ?? 0) / (7 * 24 - 1) };
}

export function isSpike(r: { lastHour: number; avgHour: number }, floor: number): boolean {
  return r.lastHour >= floor && r.lastHour > 5 * Math.max(1, r.avgHour);
}
