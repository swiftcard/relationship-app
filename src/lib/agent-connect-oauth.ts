// ── Agent Flow connect: the OAuth leg for each platform ─────────────────────
//
// Owner-only. The admin presses Connect on Agent Flow → Settings, lands on the
// platform's consent screen, and comes back to /api/admin/connect/<p>/callback
// with a code. This module knows, per platform, where to send them, how to
// swap the code for tokens, and how to name the account that will be posting.
//
// What each platform actually gives us (verified against first-party docs,
// 2026-09-09 / 2026-09-28):
//   x        OAuth 2.0 + PKCE, user context. tweet.write + offline.access.
//            Access token 2h, refresh token rotates on each use.
//   meta     Facebook Login. Short user token → long-lived user token →
//            page tokens (long-lived, never expire). The Page's linked
//            Instagram Business account rides on the same page token.
//   youtube  Google OAuth, youtube.upload (+ readonly for the channel name).
//            Refresh token only on access_type=offline&prompt=consent.
//   linkedin OpenID + w_member_social (self-serve). Posting AS THE PAGE needs
//            the Community Management API (LinkedIn vets the company); until
//            then the connection stores the person and the connector holds
//            posts — see summarizeConnections().

import { type AgentProvider, linkedinClient, youtubeClient } from "@/lib/agent-connections";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://swiftcard.me";
export const META_GRAPH = "https://graph.facebook.com/v26.0";
export const LINKEDIN_VERSION = "202509";

export function connectRedirectUri(p: AgentProvider): string {
  return `${APP_URL}/api/admin/connect/${p}/callback`;
}

export function usesPkce(p: AgentProvider): boolean {
  return p === "x";
}

// Cookies that tie the callback to THIS browser (see lib/oauth-state for why a
// signed state alone is not enough). Path-scoped to the connect routes.
export const bindCookie = (p: string) => `agent_connect_bind_${p}`;
export const pkceCookie = (p: string) => `agent_connect_pkce_${p}`;
export const CONNECT_COOKIE = { httpOnly: true, secure: true, sameSite: "lax" as const, maxAge: 15 * 60, path: "/api/admin/connect" };

const SCOPES: Record<AgentProvider, string> = {
  x: "tweet.read tweet.write users.read offline.access",
  // pages_manage_posts publishes to the Page; instagram_content_publish to the
  // linked IG Business account; the rest are what the two need to list + read.
  meta: "pages_show_list pages_read_engagement pages_manage_posts instagram_basic instagram_content_publish business_management",
  youtube: "https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly",
  // Add "w_organization_social r_organization_admin" via LINKEDIN_AGENT_SCOPES
  // once the Community Management API is granted — requesting them before that
  // makes LinkedIn refuse the whole authorization (unauthorized_scope_error).
  linkedin: process.env.LINKEDIN_AGENT_SCOPES || "openid profile w_member_social",
};

export function authorizeUrl(p: AgentProvider, state: string, codeChallenge?: string): string {
  const redirect_uri = connectRedirectUri(p);
  switch (p) {
    case "x": {
      const q = new URLSearchParams({ response_type: "code", client_id: process.env.X_CLIENT_ID!, redirect_uri, scope: SCOPES.x, state, code_challenge: codeChallenge ?? "", code_challenge_method: "S256" });
      return `https://x.com/i/oauth2/authorize?${q}`;
    }
    case "meta": {
      const q = new URLSearchParams({ client_id: process.env.META_APP_ID!, redirect_uri, scope: SCOPES.meta, state, response_type: "code" });
      return `https://www.facebook.com/v26.0/dialog/oauth?${q}`;
    }
    case "youtube": {
      const q = new URLSearchParams({ client_id: youtubeClient().id!, redirect_uri, response_type: "code", scope: SCOPES.youtube, access_type: "offline", prompt: "consent", include_granted_scopes: "true", state });
      return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
    }
    case "linkedin": {
      const q = new URLSearchParams({ response_type: "code", client_id: linkedinClient().id!, redirect_uri, scope: SCOPES.linkedin, state });
      return `https://www.linkedin.com/oauth/v2/authorization?${q}`;
    }
  }
}

export type TokenSet = { access_token: string; refresh_token?: string | null; expires_in?: number | null; scope?: string | null };

async function form(url: string, body: Record<string, string>, headers: Record<string, string> = {}): Promise<Record<string, unknown>> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", ...headers }, body: new URLSearchParams(body) });
  const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error(`token exchange ${res.status}: ${JSON.stringify(j).slice(0, 200)}`);
  return j;
}

export async function exchangeCode(p: AgentProvider, code: string, codeVerifier?: string): Promise<TokenSet> {
  const redirect_uri = connectRedirectUri(p);
  switch (p) {
    case "x": {
      const j = await form("https://api.x.com/2/oauth2/token",
        { grant_type: "authorization_code", code, redirect_uri, client_id: process.env.X_CLIENT_ID!, code_verifier: codeVerifier ?? "" },
        { Authorization: `Basic ${Buffer.from(`${process.env.X_CLIENT_ID}:${process.env.X_CLIENT_SECRET}`).toString("base64")}` });
      return { access_token: String(j.access_token), refresh_token: (j.refresh_token as string) ?? null, expires_in: Number(j.expires_in ?? 7200), scope: (j.scope as string) ?? null };
    }
    case "meta": {
      const short = await form(`${META_GRAPH}/oauth/access_token`, { client_id: process.env.META_APP_ID!, client_secret: process.env.META_APP_SECRET!, redirect_uri, code });
      // Long-lived user token (60 days); page tokens minted from it never expire.
      const long = await fetch(`${META_GRAPH}/oauth/access_token?${new URLSearchParams({ grant_type: "fb_exchange_token", client_id: process.env.META_APP_ID!, client_secret: process.env.META_APP_SECRET!, fb_exchange_token: String(short.access_token) })}`)
        .then((r) => r.json()).catch(() => ({})) as { access_token?: string };
      return { access_token: long.access_token ?? String(short.access_token), refresh_token: null, expires_in: null, scope: null };
    }
    case "youtube": {
      const j = await form("https://oauth2.googleapis.com/token", { grant_type: "authorization_code", code, redirect_uri, client_id: youtubeClient().id!, client_secret: youtubeClient().secret! });
      return { access_token: String(j.access_token), refresh_token: (j.refresh_token as string) ?? null, expires_in: Number(j.expires_in ?? 3600), scope: (j.scope as string) ?? null };
    }
    case "linkedin": {
      const j = await form("https://www.linkedin.com/oauth/v2/accessToken", { grant_type: "authorization_code", code, redirect_uri, client_id: linkedinClient().id!, client_secret: linkedinClient().secret! });
      return { access_token: String(j.access_token), refresh_token: (j.refresh_token as string) ?? null, expires_in: Number(j.expires_in ?? 5184000), scope: (j.scope as string) ?? null };
    }
  }
}

export type AccountInfo = {
  account_id: string | null;
  account_label: string | null;
  /** The token the connector should actually use (Meta: the PAGE token, not the user token). */
  access_token: string;
  expires_at: string | null;
  meta: Record<string, unknown>;
};

async function getJson(url: string, headers: Record<string, string>): Promise<Record<string, unknown>> {
  const res = await fetch(url, { headers });
  const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error(`${res.status}: ${JSON.stringify(j).slice(0, 200)}`);
  return j;
}

/** Who will be posting. Runs once, right after the code exchange. */
export async function describeAccount(p: AgentProvider, t: TokenSet): Promise<AccountInfo> {
  const expires_at = t.expires_in ? new Date(Date.now() + t.expires_in * 1000).toISOString() : null;
  const bearer = { Authorization: `Bearer ${t.access_token}` };
  switch (p) {
    case "x": {
      const j = (await getJson("https://api.x.com/2/users/me", bearer)) as { data?: { id?: string; username?: string; name?: string } };
      return { account_id: j.data?.id ?? null, account_label: j.data?.username ? `@${j.data.username}` : j.data?.name ?? null, access_token: t.access_token, expires_at, meta: {} };
    }
    case "meta": {
      type Page = { id: string; name: string; access_token: string; instagram_business_account?: { id: string; username?: string } };
      const j = (await getJson(`${META_GRAPH}/me/accounts?fields=id,name,access_token,instagram_business_account{id,username}&limit=50`, bearer)) as { data?: Page[] };
      const pages = j.data ?? [];
      if (!pages.length) throw new Error("this Facebook login administers no Page — create the SwiftCard Page first, then connect again");
      // META_PAGE_ID picks among several Pages; otherwise the first (usually only) one.
      const page = pages.find((pg) => pg.id === process.env.META_PAGE_ID) ?? pages[0];
      return {
        account_id: page.id,
        account_label: page.instagram_business_account?.username ? `${page.name} · @${page.instagram_business_account.username}` : `${page.name} (Page)`,
        access_token: page.access_token,
        expires_at: null,
        meta: {
          page_id: page.id, page_name: page.name,
          ig_user_id: page.instagram_business_account?.id ?? null, ig_username: page.instagram_business_account?.username ?? null,
          pages: pages.map((pg) => ({ id: pg.id, name: pg.name })),
        },
      };
    }
    case "youtube": {
      const j = (await getJson("https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true", bearer)) as { items?: Array<{ id: string; snippet?: { title?: string; customUrl?: string } }> };
      const ch = j.items?.[0];
      if (!ch) throw new Error("this Google account has no YouTube channel — sign in with the account that owns the SwiftCard channel");
      return { account_id: ch.id, account_label: ch.snippet?.customUrl ?? ch.snippet?.title ?? ch.id, access_token: t.access_token, expires_at, meta: { channel_title: ch.snippet?.title ?? null } };
    }
    case "linkedin": {
      const me = (await getJson("https://api.linkedin.com/v2/userinfo", bearer)) as { sub?: string; name?: string };
      const meta: Record<string, unknown> = {};
      let label = me.name ?? null;
      // Page admin lookup needs r_organization_admin (Community Management API).
      // Without it this simply 403s and the connection stays person-scoped.
      if ((t.scope ?? "").includes("r_organization_admin")) {
        try {
          const acl = (await getJson("https://api.linkedin.com/rest/organizationAcls?q=roleAssignee&role=ADMINISTRATOR&state=APPROVED&projection=(elements*(organization~(localizedName)))",
            { ...bearer, "LinkedIn-Version": LINKEDIN_VERSION, "X-Restli-Protocol-Version": "2.0.0" })) as { elements?: Array<{ organization?: string; "organization~"?: { localizedName?: string } }> };
          const org = acl.elements?.[0];
          if (org?.organization) {
            meta.org_urn = org.organization;
            label = `${org["organization~"]?.localizedName ?? "Page"} (Page)`;
          }
        } catch { /* no Page access on this token — person-scoped connection */ }
      }
      return { account_id: me.sub ?? null, account_label: label, access_token: t.access_token, expires_at, meta };
    }
  }
}
