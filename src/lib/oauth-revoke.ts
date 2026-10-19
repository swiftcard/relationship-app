import { getAdminSupabase } from "@/lib/supabase-admin";
import { decryptToken } from "@/lib/token-crypto";

export type OAuthCrm = "google" | "salesforce" | "hubspot";

const REVOKE_TIMEOUT_MS = 3000;

function plain(enc: unknown): string | null {
  if (typeof enc !== "string" || !enc) return null;
  try { return decryptToken(enc); } catch { return null; }
}

/**
 * Ask the provider to end SwiftCard's access (audit I-07). Disconnect used to
 * delete only SwiftCard's own row: "SwiftCard" stayed under the person's
 * Google Account → Third-party access (or Salesforce's connected apps), with
 * contacts-write scope, and any copy of the refresh token stayed usable.
 * Best-effort and bounded: a provider that is down never stops a disconnect.
 */
export async function revokeProviderGrant(
  provider: OAuthCrm,
  row: { access_token?: unknown; refresh_token?: unknown; metadata?: unknown },
): Promise<boolean> {
  const token = plain(row.refresh_token) ?? plain(row.access_token);
  if (!token) return false;
  const signal = AbortSignal.timeout(REVOKE_TIMEOUT_MS);
  try {
    if (provider === "google") {
      const r = await fetch("https://oauth2.googleapis.com/revoke", {
        method: "POST", signal,
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token }),
      });
      return r.ok;
    }
    if (provider === "salesforce") {
      const instance = (row.metadata as { instance_url?: unknown } | null)?.instance_url;
      const base = typeof instance === "string" && /^https:\/\/[a-z0-9.-]+\.(salesforce|force)\.com$/i.test(instance) ? instance : "https://login.salesforce.com";
      const r = await fetch(`${base}/services/oauth2/revoke`, {
        method: "POST", signal,
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token }),
      });
      return r.ok;
    }
    const refresh = plain(row.refresh_token);
    if (!refresh) return false;
    const r = await fetch(`https://api.hubapi.com/oauth/v1/refresh-tokens/${encodeURIComponent(refresh)}`, { method: "DELETE", signal });
    return r.ok || r.status === 204;
  } catch {
    return false;
  }
}

/** Revoke at the provider, then remove SwiftCard's connection. */
export async function disconnectOAuthCrm(userId: string, provider: OAuthCrm): Promise<{ error: unknown }> {
  const admin = getAdminSupabase();
  const { data: row } = await admin
    .from("integrations")
    .select("access_token, refresh_token, metadata")
    .eq("user_id", userId)
    .eq("provider", provider)
    .maybeSingle();
  if (row) await revokeProviderGrant(provider, row);
  const { error } = await admin.from("integrations").delete().eq("user_id", userId).eq("provider", provider);
  return { error };
}
