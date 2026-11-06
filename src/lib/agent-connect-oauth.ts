// ── Platform connect: the OAuth leg for each platform ─────────────────────
//
// Owner-only. The admin opens /api/admin/connect/<p>, lands on the
// platform's consent screen, and comes back to /api/admin/connect/<p>/callback
// with a code. This module knows, per platform, where to send them, how to
// swap the code for tokens, and how to name the account that will be posting.
//
// What each platform actually gives us (verified against first-party docs,
// 2026-09-09 / 2026-09-28):
//   x        OAuth 2.0 + PKCE, user context. tweet.write + offline.access.
//            Access token 2h, refresh token rotates on each use.
//   meta     Facebook Login. Short user token → long-lived user token (about
//            60 days; Connect again before it lapses). Since 2026-11-06 it
//            is read-only: Instagram Business Discovery for the crew.
//   youtube  Google OAuth, youtube.upload (+ readonly for the channel name).
//            Refresh token only on access_type=offline&prompt=consent.
//   linkedin OpenID + w_member_social (self-serve). Posting AS THE PAGE needs
//            the Community Management API (LinkedIn vets the company); until
//            then the connection stores the person and the connector holds
//            posts — see summarizeConnections().

//   google_calendar  (2026-11-03) the owner's hello@swiftcard.me calendar, for
//            demo booking: create events with a Meet link, read free/busy.
//            Same owner-only Google client as YouTube; offline + consent for
//            the refresh token. openid email names the account, and any
//            account but DEMO_CALENDAR_EMAIL is refused.
//   google_gmail  (2026-11-04) the SwiftCard mailbox approved outreach emails
//            are sent from (lib/crew/email). gmail.send + gmail.metadata only:
//            it can send, and read headers to see replies and bounces, never a
//            message body. Its OWN Workspace-Internal OAuth client
//            (CREW_GMAIL_CLIENT_ID/SECRET), never the customer sign-in app,
//            which is External: restricted scopes there need Google's
//            verification. Any account but
//            CREW_EMAIL_FROM (default hello@swiftcard.me) is refused.

import { type OwnerConnectProvider, linkedinClient, youtubeClient } from "@/lib/agent-connections";
import { DEMO_CALENDAR_EMAIL_DEFAULT } from "@/lib/demo/config";
import { GMAIL_SCOPES } from "@/lib/crew/email/scopes";
import { emailMailbox, gmailClient } from "@/lib/crew/env";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://swiftcard.me";
export const META_GRAPH = "https://graph.facebook.com/v26.0";
export const LINKEDIN_VERSION = "202509";

export function connectRedirectUri(p: OwnerConnectProvider): string {
  return `${APP_URL}/api/admin/connect/${p}/callback`;
}

export function usesPkce(p: OwnerConnectProvider): boolean {
  return p === "x";
}

/** Where the owner lands after a connect: the Demos page for the calendar,
 *  the admin's Connections panel for everything else. */
export function connectReturnUrl(p: string, result?: { ok: boolean; msg: string }): string {
  const base = p === "google_calendar" ? `${APP_URL}/admin/demos?connect=1` : p === "google_gmail" ? `${APP_URL}/admin/crew/email?connect=1` : `${APP_URL}/admin?connect=1`;
  return result ? `${base}&${result.ok ? "connected" : "connect_error"}=${encodeURIComponent(result.msg)}` : base;
}

function demoCalendarEmail(): string {
  return (process.env.DEMO_CALENDAR_EMAIL || DEMO_CALENDAR_EMAIL_DEFAULT).trim().toLowerCase();
}

// Cookies that tie the callback to THIS browser (see lib/oauth-state for why a
// signed state alone is not enough). Path-scoped to the connect routes.
export const bindCookie = (p: string) => `agent_connect_bind_${p}`;
export const pkceCookie = (p: string) => `agent_connect_pkce_${p}`;
export const CONNECT_COOKIE = { httpOnly: true, secure: true, sameSite: "lax" as const, maxAge: 15 * 60, path: "/api/admin/connect" };

/** What Business Discovery needs, and all the Meta connection asks for. */
export const META_DISCOVERY_SCOPES = "pages_show_list pages_read_engagement instagram_basic instagram_manage_insights";

const SCOPES: Record<OwnerConnectProvider, string> = {
  google_calendar: "openid email https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.freebusy",
  google_gmail: ["openid", "email", ...GMAIL_SCOPES].join(" "),
  x: "tweet.read tweet.write users.read offline.access",
  // Read-only since 2026-11-06: the "SwiftCard Discovery" Meta app looks up
  // other businesses' public Instagram profiles and posts (Business Discovery,
  // lib/crew/sources/instagram-discovery). Nothing here can post, comment or
  // message. The four scopes are the ones that app was set up with; an unknown
  // scope fails the consent screen outright, and META_SCOPES overrides the list.
  meta: process.env.META_SCOPES || META_DISCOVERY_SCOPES,
  youtube: "https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly",
  // The Page-attached "SwiftCard Agent Flow" app (LINKEDIN_AGENT_CLIENT_ID) can
  // only hold the Community Management API — LinkedIn refuses to add Sign In /
  // Share products next to it — so it asks for the organization scopes alone.
  // Until LinkedIn grants that product the authorization fails with
  // unauthorized_scope_error, which the panel shows as a connect error. The
  // legacy fallback (sign-in app) keeps the member scopes.
  // Pins and the boards they go on, plus the account name for the panel.
  pinterest: "boards:read boards:write pins:read pins:write user_accounts:read",
  linkedin: process.env.LINKEDIN_AGENT_SCOPES
    || (process.env.LINKEDIN_AGENT_CLIENT_ID ? "w_organization_social r_organization_admin" : "openid profile w_member_social"),
};

export function authorizeUrl(p: OwnerConnectProvider, state: string, codeChallenge?: string): string {
  const redirect_uri = connectRedirectUri(p);
  switch (p) {
    case "google_calendar": {
      const q = new URLSearchParams({ client_id: youtubeClient().id!, redirect_uri, response_type: "code", scope: SCOPES.google_calendar, access_type: "offline", prompt: "consent", include_granted_scopes: "true", login_hint: demoCalendarEmail(), state });
      return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
    }
    case "google_gmail": {
      // No include_granted_scopes: this token must carry these scopes and nothing the client was granted elsewhere.
      const q = new URLSearchParams({ client_id: gmailClient().id!, redirect_uri, response_type: "code", scope: SCOPES.google_gmail, access_type: "offline", prompt: "consent", login_hint: emailMailbox(), state });
      return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
    }
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
    case "pinterest": {
      const q = new URLSearchParams({ client_id: process.env.PINTEREST_APP_ID!, redirect_uri, response_type: "code", scope: SCOPES.pinterest.replace(/ /g, ","), state });
      return `https://www.pinterest.com/oauth/?${q}`;
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

export async function exchangeCode(p: OwnerConnectProvider, code: string, codeVerifier?: string): Promise<TokenSet> {
  const redirect_uri = connectRedirectUri(p);
  switch (p) {
    case "google_calendar":
    case "google_gmail": {
      const c = p === "google_gmail" ? gmailClient() : youtubeClient();
      const j = await form("https://oauth2.googleapis.com/token", { grant_type: "authorization_code", code, redirect_uri, client_id: c.id!, client_secret: c.secret! });
      return { access_token: String(j.access_token), refresh_token: (j.refresh_token as string) ?? null, expires_in: Number(j.expires_in ?? 3600), scope: (j.scope as string) ?? null };
    }
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
        .then((r) => r.json()).catch(() => ({})) as { access_token?: string; expires_in?: number };
      // A short token lasts about an hour; the long one about 60 days (Meta can't refresh it: Connect again before then).
      if (!long.access_token) throw new Error("Meta didn't extend the login to a long-lived token. Press Connect again");
      return { access_token: long.access_token, refresh_token: null, expires_in: Number(long.expires_in) || 60 * 86400, scope: null };
    }
    case "youtube": {
      const j = await form("https://oauth2.googleapis.com/token", { grant_type: "authorization_code", code, redirect_uri, client_id: youtubeClient().id!, client_secret: youtubeClient().secret! });
      return { access_token: String(j.access_token), refresh_token: (j.refresh_token as string) ?? null, expires_in: Number(j.expires_in ?? 3600), scope: (j.scope as string) ?? null };
    }
    case "linkedin": {
      const j = await form("https://www.linkedin.com/oauth/v2/accessToken", { grant_type: "authorization_code", code, redirect_uri, client_id: linkedinClient().id!, client_secret: linkedinClient().secret! });
      return { access_token: String(j.access_token), refresh_token: (j.refresh_token as string) ?? null, expires_in: Number(j.expires_in ?? 5184000), scope: (j.scope as string) ?? null };
    }
    case "pinterest": {
      // Pinterest wants the app credentials as HTTP Basic, not in the body.
      const res = await fetch("https://api.pinterest.com/v5/oauth/token", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Basic ${Buffer.from(`${process.env.PINTEREST_APP_ID}:${process.env.PINTEREST_APP_SECRET}`).toString("base64")}`,
        },
        body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri, continuous_refresh: "true" }),
      });
      const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok || !j.access_token) throw new Error(`Pinterest token exchange failed: ${String(j.message ?? j.error ?? res.status).slice(0, 160)}`);
      return { access_token: String(j.access_token), refresh_token: (j.refresh_token as string) ?? null, expires_in: Number(j.expires_in ?? 2592000), scope: (j.scope as string) ?? null };
    }
  }
}

export type AccountInfo = {
  account_id: string | null;
  account_label: string | null;
  /** The token the connector should actually use (Meta: the long-lived user token, for Business Discovery). */
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
export async function describeAccount(p: OwnerConnectProvider, t: TokenSet): Promise<AccountInfo> {
  const expires_at = t.expires_in ? new Date(Date.now() + t.expires_in * 1000).toISOString() : null;
  const bearer = { Authorization: `Bearer ${t.access_token}` };
  switch (p) {
    case "google_calendar": {
      const j = (await getJson("https://openidconnect.googleapis.com/v1/userinfo", bearer)) as { email?: string; email_verified?: boolean };
      const email = (j.email ?? "").toLowerCase();
      const expected = demoCalendarEmail();
      // Demos must land in the inbox and calendar the owner reads. Any other
      // Google account is refused here, before a token is stored.
      if (!email || email !== expected) throw new Error(`signed in as ${email || "an unknown account"}. Sign in as ${expected} instead`);
      const granted = t.scope ?? "";
      if (!granted.includes("calendar.events") || !granted.includes("calendar.freebusy")) {
        throw new Error("calendar access wasn't allowed. Press Connect again and tick both calendar boxes");
      }
      if (!t.refresh_token) throw new Error("Google sent no refresh token. Remove SwiftCard's access at myaccount.google.com/permissions, then connect again");
      return { account_id: email, account_label: email, access_token: t.access_token, expires_at, meta: { email } };
    }
    case "google_gmail": {
      const j = (await getJson("https://openidconnect.googleapis.com/v1/userinfo", bearer)) as { email?: string };
      const email = (j.email ?? "").toLowerCase();
      const expected = emailMailbox();
      // Outreach goes out from the one SwiftCard mailbox. Any other account is refused before a token is stored.
      if (!email || email !== expected) throw new Error(`signed in as ${email || "an unknown account"}. Sign in as ${expected} instead`);
      const granted = t.scope ?? "";
      if (!GMAIL_SCOPES.every((s) => granted.includes(s))) throw new Error("Gmail access wasn't allowed. Press Connect again and tick both Gmail boxes");
      if (!t.refresh_token) throw new Error("Google sent no refresh token. Remove SwiftCard's access at myaccount.google.com/permissions, then connect again");
      return { account_id: email, account_label: email, access_token: t.access_token, expires_at, meta: { email, scopes: granted } };
    }
    case "x": {
      const j = (await getJson("https://api.x.com/2/users/me", bearer)) as { data?: { id?: string; username?: string; name?: string } };
      return { account_id: j.data?.id ?? null, account_label: j.data?.username ? `@${j.data.username}` : j.data?.name ?? null, access_token: t.access_token, expires_at, meta: {} };
    }
    case "meta": {
      // The Page is found three ways, since a Page owned by a business
      // portfolio is missing from /me/accounts without business_management
      // (SwiftCard's is, 2026-11-06): META_PAGE_ID, then /me/accounts, then the
      // Pages ticked on the consent screen (debug_token's granular scopes).
      type Page = { id: string; name?: string; instagram_business_account?: { id: string; username?: string } };
      const ids: string[] = [];
      if (process.env.META_PAGE_ID) ids.push(process.env.META_PAGE_ID);
      try {
        const j = (await getJson(`${META_GRAPH}/me/accounts?fields=id&limit=50`, bearer)) as { data?: Array<{ id: string }> };
        ids.push(...(j.data ?? []).map((x) => x.id));
      } catch { /* checked below */ }
      try {
        const appToken = `${process.env.META_APP_ID}|${process.env.META_APP_SECRET}`;
        const d = (await getJson(`${META_GRAPH}/debug_token?input_token=${encodeURIComponent(t.access_token)}`, { Authorization: `Bearer ${appToken}` })) as { data?: { granular_scopes?: Array<{ scope?: string; target_ids?: string[] }> } };
        for (const g of d.data?.granular_scopes ?? []) if (g.scope?.startsWith("pages_")) ids.push(...(g.target_ids ?? []));
      } catch { /* checked below */ }
      let page: Page | null = null;
      for (const id of [...new Set(ids)]) {
        try {
          const pg = (await getJson(`${META_GRAPH}/${encodeURIComponent(id)}?fields=id,name,instagram_business_account{id,username}`, bearer)) as Page;
          if (pg.instagram_business_account?.id) { page = pg; break; }
          page ??= pg;
        } catch { /* a Page this login can't read */ }
      }
      if (!page) throw new Error("no Facebook Page was shared. Press Connect again and tick the SwiftCard Page and its Instagram account");
      const ig = page.instagram_business_account;
      if (!ig?.id) throw new Error(`the ${page.name ?? "Facebook"} Page has no Instagram business account linked (or it wasn't ticked). Link it in Meta Business Suite, then press Connect again`);
      // Prove the stored token does the one thing it's for: Business Discovery, on our own account.
      if (ig.username) {
        const self = (await getJson(`${META_GRAPH}/${ig.id}?fields=${encodeURIComponent(`business_discovery.username(${ig.username}){username,media_count}`)}`, bearer).catch((e) => ({ error: String(e) }))) as { business_discovery?: { username?: string }; error?: string };
        if (!self.business_discovery?.username) throw new Error(`connected, but Instagram's Business Discovery refused this login (${String(self.error ?? "no data").slice(0, 120)}). Check that instagram_basic and instagram_manage_insights were allowed`);
      }
      let granted: string[] = [];
      try {
        const perms = (await getJson(`${META_GRAPH}/me/permissions`, bearer)) as { data?: Array<{ permission?: string; status?: string }> };
        granted = (perms.data ?? []).filter((x) => x.status === "granted" && x.permission).map((x) => String(x.permission));
      } catch { /* best-effort */ }
      return {
        account_id: page.id,
        account_label: ig.username ? `${page.name ?? "Page"} · @${ig.username}` : `${page.name ?? page.id} (Page)`,
        // The long-lived USER token: Business Discovery is asked as the user (Meta's reference), not the Page.
        access_token: t.access_token,
        expires_at,
        meta: { page_id: page.id, page_name: page.name ?? null, ig_user_id: ig.id, ig_username: ig.username ?? null, granted },
      };
    }
    case "youtube": {
      const j = (await getJson("https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true", bearer)) as { items?: Array<{ id: string; snippet?: { title?: string; customUrl?: string } }> };
      const ch = j.items?.[0];
      if (!ch) throw new Error("this Google account has no YouTube channel — sign in with the account that owns the SwiftCard channel");
      return { account_id: ch.id, account_label: ch.snippet?.customUrl ?? ch.snippet?.title ?? ch.id, access_token: t.access_token, expires_at, meta: { channel_title: ch.snippet?.title ?? null } };
    }
    case "pinterest": {
      const j = (await getJson("https://api.pinterest.com/v5/user_account", bearer)) as { id?: string; username?: string; account_type?: string };
      return { account_id: j.id ?? null, account_label: j.username ? `@${j.username}` : null, access_token: t.access_token, expires_at, meta: { account_type: j.account_type ?? null } };
    }
    case "linkedin": {
      // userinfo needs the openid scope, which the Page-only app cannot request.
      const me = (t.scope ?? SCOPES.linkedin).includes("openid")
        ? ((await getJson("https://api.linkedin.com/v2/userinfo", bearer)) as { sub?: string; name?: string })
        : {};
      const meta: Record<string, unknown> = {};
      let label = me.name ?? null;
      // Page admin lookup needs r_organization_admin (Community Management API).
      // Without it this simply 403s and the connection stays person-scoped.
      if ((t.scope ?? SCOPES.linkedin).includes("r_organization_admin")) {
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
