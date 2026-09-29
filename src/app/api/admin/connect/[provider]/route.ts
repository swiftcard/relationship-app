import { NextResponse, type NextRequest } from "next/server";
import { createHash, randomBytes } from "node:crypto";
import { requireAdmin } from "@/lib/admin";
import { deleteConnection, isAgentProvider, providerAppConfigured } from "@/lib/agent-connections";
import { authorizeUrl, bindCookie, CONNECT_COOKIE, pkceCookie, usesPkce } from "@/lib/agent-connect-oauth";
import { signState, oauthBindCookieValue } from "@/lib/oauth-state";

export const runtime = "nodejs";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://swiftcard.me";
const SETTINGS = `${APP_URL}/admin/agent-flow?view=settings`;

// GET /api/admin/connect/<provider> → the platform's consent screen.
// Owner only: the admin gate is the same one every /api/admin route uses.
export async function GET(_req: NextRequest, ctx: { params: Promise<{ provider: string }> }) {
  const user = await requireAdmin();
  if (!user) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { provider } = await ctx.params;
  if (!isAgentProvider(provider)) return NextResponse.json({ error: "unknown provider" }, { status: 404 });
  if (!providerAppConfigured(provider)) return NextResponse.redirect(`${SETTINGS}&connect_error=${encodeURIComponent(`${provider}: app credentials are not set in Vercel yet`)}`);

  const state = signState(user.id);
  let challenge: string | undefined;
  let verifier: string | undefined;
  if (usesPkce(provider)) {
    verifier = randomBytes(32).toString("base64url");
    challenge = createHash("sha256").update(verifier).digest("base64url");
  }
  const res = NextResponse.redirect(authorizeUrl(provider, state, challenge));
  res.cookies.set(bindCookie(provider), oauthBindCookieValue(state), CONNECT_COOKIE);
  if (verifier) res.cookies.set(pkceCookie(provider), verifier, CONNECT_COOKIE);
  return res;
}

// DELETE /api/admin/connect/<provider> → forget the tokens (Disconnect).
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ provider: string }> }) {
  const user = await requireAdmin();
  if (!user) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { provider } = await ctx.params;
  if (!isAgentProvider(provider)) return NextResponse.json({ error: "unknown provider" }, { status: 404 });
  await deleteConnection(provider);
  return NextResponse.json({ ok: true });
}
