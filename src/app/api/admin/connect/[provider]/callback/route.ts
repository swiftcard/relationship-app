import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { isOwnerConnectProvider, justConnected, saveConnection } from "@/lib/agent-connections";
import { bindCookie, connectReturnUrl, describeAccount, exchangeCode, pkceCookie, usesPkce } from "@/lib/agent-connect-oauth";
import { stateBoundToBrowser, verifyState } from "@/lib/oauth-state";

export const runtime = "nodejs";

// GET /api/admin/connect/<provider>/callback?code=…&state=…
// Three gates before a token is stored: the admin session (same browser), the
// signed state (issued to THIS admin, <15 min old), and the bind cookie (this
// browser started the connect). Then exchange, name the account, encrypt, save.
// The demo calendar (google_calendar) returns to /admin/demos, the agents to /admin.
export async function GET(req: NextRequest, ctx: { params: Promise<{ provider: string }> }) {
  const { provider } = await ctx.params;
  if (!isOwnerConnectProvider(provider)) return NextResponse.json({ error: "unknown provider" }, { status: 404 });
  const done = (ok: boolean, msg: string) => {
    const res = NextResponse.redirect(connectReturnUrl(provider, { ok, msg }));
    res.cookies.set(bindCookie(provider), "", { maxAge: 0, path: "/api/admin/connect" });
    res.cookies.set(pkceCookie(provider), "", { maxAge: 0, path: "/api/admin/connect" });
    return res;
  };

  const user = await requireAdmin();
  if (!user) return done(false, "sign in as the admin first");
  const q = req.nextUrl.searchParams;
  const code = q.get("code");
  const state = q.get("state");
  if (q.get("error") || !code || !state) {
    console.warn(`[agent-connect/${provider}] bounced:`, q.get("error") ?? "no code", q.get("error_description") ?? "");
    return done(false, `${provider}: ${q.get("error_description") ?? q.get("error") ?? "the platform sent no code"}`);
  }
  if (verifyState(state) !== user.id) return done(false, `${provider}: this connect link is stale — press Connect again`);
  if (!stateBoundToBrowser(state, req.cookies.get(bindCookie(provider))?.value)) return done(false, `${provider}: finish the connect in the browser that started it`);
  const verifier = usesPkce(provider) ? req.cookies.get(pkceCookie(provider))?.value : undefined;
  if (usesPkce(provider) && !verifier) return done(false, `${provider}: the connect took too long — press Connect again`);

  try {
    const tokens = await exchangeCode(provider, code, verifier);
    const acct = await describeAccount(provider, tokens);
    const ok = await saveConnection({
      provider,
      account_label: acct.account_label, account_id: acct.account_id,
      access_token: acct.access_token, refresh_token: tokens.refresh_token ?? null,
      expires_at: acct.expires_at, scopes: tokens.scope ?? null, meta: acct.meta,
      connected_by: user.email ?? null,
    });
    if (!ok) return done(false, `${provider}: connected, but saving failed — run supabase/agent-connections.sql`);
    return done(true, `${provider}:${acct.account_label ?? "connected"}`);
  } catch (e) {
    // The same code delivered twice (the browser repeats the callback request):
    // the first request already exchanged it and saved the connection, and
    // Google answers the second with invalid_grant. Report what actually
    // happened: connected, if this admin's connection was saved moments ago.
    if (/invalid_grant/.test(String(e))) {
      const just = await justConnected(provider, user.email ?? null);
      if (just) return done(true, `${provider}:${just}`);
    }
    console.warn(`[agent-connect/${provider}] failed:`, String(e).slice(0, 300));
    return done(false, `${provider}: ${String(e instanceof Error ? e.message : e).slice(0, 160)}`);
  }
}
