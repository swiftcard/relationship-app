// ── Agent Flow: the owner's connected platform accounts ─────────────────────
//
// Agent Flow → Settings → Connections presses Connect, the platform's own
// consent screen runs, and the resulting tokens land here — encrypted with
// OAUTH_SECRET exactly like the CRM integrations (lib/token-crypto). Before
// this, every connector was armed by pasting tokens into Vercel env vars,
// which a non-coder cannot do and which silently expire (LinkedIn's 60-day
// member token surfaced as a bare 401). Env vars still work as a fallback
// for the LinkedIn/Higgsfield/Reddit shapes that predate this file.
//
// Readers: src/lib/agent-execute.ts (posting, behind the owner's Approve) and
// the admin board route (Connected ✓ / Connect button). Both run server-side
// behind requireAdmin; this module imports the service-role client and must
// never be reached from a client component (tests/server-only-boundary).

import { getAdminSupabase } from "@/lib/supabase-admin";
import { decryptToken, encryptToken } from "@/lib/token-crypto";

export type AgentProvider = "x" | "meta" | "youtube" | "linkedin" | "pinterest";
export const AGENT_PROVIDERS: AgentProvider[] = ["x", "meta", "youtube", "linkedin", "pinterest"];

export type AgentConnection = {
  provider: AgentProvider;
  account_label: string | null;
  account_id: string | null;
  /** Decrypted. */
  access_token: string;
  /** Decrypted; null where the provider issues none. */
  refresh_token: string | null;
  expires_at: string | null;
  scopes: string | null;
  meta: Record<string, unknown>;
  connected_at: string;
};

export type ConnectionMap = Partial<Record<AgentProvider, AgentConnection>>;

/** The platform APP (client id/secret) exists in env — the prerequisite for the Connect button. */
export function providerAppConfigured(p: AgentProvider): boolean {
  switch (p) {
    case "x": return !!(process.env.X_CLIENT_ID && process.env.X_CLIENT_SECRET);
    case "meta": return !!(process.env.META_APP_ID && process.env.META_APP_SECRET);
    // YouTube has its own OAuth client (a project under the hello@swiftcard.me
    // Workspace, so the consent screen can be Internal and refresh tokens
    // don't die after 7 days). Falls back to the sign-in client if unset.
    case "youtube": return !!(youtubeClient().id && youtubeClient().secret);
    // The Agent Flow app is a separate LinkedIn app from the profile-photo
    // import one (different Page, different products). Falls back to it.
    case "linkedin": return !!(linkedinClient().id && linkedinClient().secret);
    case "pinterest": return !!(process.env.PINTEREST_APP_ID && process.env.PINTEREST_APP_SECRET);
  }
}

export function youtubeClient(): { id: string | undefined; secret: string | undefined } {
  return {
    id: process.env.YOUTUBE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID,
    secret: process.env.YOUTUBE_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET,
  };
}

export function linkedinClient(): { id: string | undefined; secret: string | undefined } {
  return {
    id: process.env.LINKEDIN_AGENT_CLIENT_ID || process.env.LINKEDIN_CLIENT_ID,
    secret: process.env.LINKEDIN_AGENT_CLIENT_SECRET || process.env.LINKEDIN_CLIENT_SECRET,
  };
}

export function isAgentProvider(p: string): p is AgentProvider {
  return (AGENT_PROVIDERS as string[]).includes(p);
}

type Row = {
  provider: string; account_label: string | null; account_id: string | null;
  access_token: string; refresh_token: string | null; expires_at: string | null;
  scopes: string | null; meta: Record<string, unknown> | null; connected_at: string;
};

/** Every connection, decrypted. Never throws — a missing table reads as "nothing connected". */
export async function loadConnections(): Promise<ConnectionMap> {
  const out: ConnectionMap = {};
  try {
    const { data } = await getAdminSupabase().from("agent_connections").select("*");
    for (const r of (data ?? []) as Row[]) {
      if (!isAgentProvider(r.provider)) continue;
      try {
        out[r.provider] = {
          provider: r.provider,
          account_label: r.account_label, account_id: r.account_id,
          access_token: decryptToken(r.access_token),
          refresh_token: r.refresh_token ? decryptToken(r.refresh_token) : null,
          expires_at: r.expires_at, scopes: r.scopes, meta: r.meta ?? {}, connected_at: r.connected_at,
        };
      } catch {
        /* undecryptable row (OAUTH_SECRET rotated) = not connected; Connect again overwrites it */
      }
    }
  } catch {
    /* table not created yet — Connections panel shows everything as not connected */
  }
  return out;
}

export async function saveConnection(c: Omit<AgentConnection, "connected_at"> & { connected_by?: string | null }): Promise<boolean> {
  const { error } = await getAdminSupabase().from("agent_connections").upsert({
    provider: c.provider,
    account_label: c.account_label, account_id: c.account_id,
    access_token: encryptToken(c.access_token),
    refresh_token: c.refresh_token ? encryptToken(c.refresh_token) : null,
    expires_at: c.expires_at, scopes: c.scopes, meta: c.meta,
    connected_by: c.connected_by ?? null,
    connected_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }, { onConflict: "provider" });
  return !error;
}

export async function deleteConnection(p: AgentProvider): Promise<void> {
  await getAdminSupabase().from("agent_connections").delete().eq("provider", p);
}

// ── Refresh ──────────────────────────────────────────────────────────────────
// X access tokens live 2 hours and Google's 1 hour; both hand out a refresh
// token (X: offline.access, Google: access_type=offline). Meta page tokens
// derived from a long-lived user token don't expire; LinkedIn member tokens
// live 60 days with no refresh (non-partner) — that one surfaces on the panel
// as an expiry date so it can be reconnected in time.
const REFRESH_SKEW_MS = 2 * 60 * 1000;

export async function freshAccessToken(conn: AgentConnection): Promise<string | null> {
  const expiring = !!conn.expires_at && new Date(conn.expires_at).getTime() - Date.now() < REFRESH_SKEW_MS;
  if (!expiring) return conn.access_token;
  if (!conn.refresh_token) return null; // expired for good — panel asks for a reconnect
  let res: Response;
  if (conn.provider === "x") {
    res = await fetch("https://api.x.com/2/oauth2/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${Buffer.from(`${process.env.X_CLIENT_ID}:${process.env.X_CLIENT_SECRET}`).toString("base64")}`,
      },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: conn.refresh_token, client_id: process.env.X_CLIENT_ID! }),
    });
  } else if (conn.provider === "youtube") {
    res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: conn.refresh_token, client_id: youtubeClient().id!, client_secret: youtubeClient().secret! }),
    });
  } else if (conn.provider === "pinterest") {
    // Pinterest access tokens live 30 days; the refresh token a year.
    res = await fetch("https://api.pinterest.com/v5/oauth/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${Buffer.from(`${process.env.PINTEREST_APP_ID}:${process.env.PINTEREST_APP_SECRET}`).toString("base64")}`,
      },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: conn.refresh_token }),
    });
  } else {
    return null;
  }
  if (!res.ok) return null;
  const j = (await res.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; expires_in?: number };
  if (!j.access_token) return null;
  const expires_at = j.expires_in ? new Date(Date.now() + j.expires_in * 1000).toISOString() : conn.expires_at;
  // X rotates the refresh token on every use — store the new one or the next
  // refresh fails with invalid_request.
  await getAdminSupabase().from("agent_connections").update({
    access_token: encryptToken(j.access_token),
    refresh_token: encryptToken(j.refresh_token ?? conn.refresh_token),
    expires_at, updated_at: new Date().toISOString(),
  }).eq("provider", conn.provider);
  return j.access_token;
}

// ── What the Connections panel shows (no tokens ever leave the server) ──────
export type ConnectionSummary = {
  app: boolean;                 // client id/secret present → Connect button works
  connected: boolean;
  account: string | null;
  connected_at: string | null;
  expires_at: string | null;
  note: string | null;          // e.g. "posting as a person is off — needs Page access"
};

export function summarizeConnections(conns: ConnectionMap): Record<AgentProvider, ConnectionSummary> {
  const out = {} as Record<AgentProvider, ConnectionSummary>;
  for (const p of AGENT_PROVIDERS) {
    const c = conns[p];
    let note: string | null = null;
    if (p === "linkedin" && c && !c.meta.org_urn) note = "connected as a person — posts are held until the SwiftCard Page is authorized (standing rule: everything public comes from SwiftCard)";
    if (p === "meta" && c && !c.meta.ig_user_id) note = "Facebook Page connected; no Instagram Business account is linked to that Page yet";
    out[p] = {
      app: providerAppConfigured(p),
      connected: !!c,
      account: c?.account_label ?? null,
      connected_at: c?.connected_at ?? null,
      expires_at: c && !c.refresh_token ? c.expires_at : null,
      note,
    };
  }
  return out;
}
