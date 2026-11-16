import { NextResponse } from "next/server";
import { openIdTokenTicket } from "@/lib/native-google-login";
import { isRateLimited } from "@/lib/rate-limit";
import { clientIp } from "@/lib/client-ip";

export const runtime = "nodejs";

/**
 * Trades the sealed ticket that came back over swiftcard://auth-callback for the
 * Google ID token inside it — but only for the webview that started the sign-in,
 * which proves itself by presenting the handoff secret whose SHA-256 was bound
 * into the ticket at /start. Anyone who intercepted the custom-scheme URL has
 * ciphertext and nothing to unseal it with.
 *
 * The token is returned to the caller, not exchanged here: the WEBVIEW must be
 * the one to call signInWithIdToken so the Supabase session cookies land in the
 * webview's own store (the system browser's jar is a different one), exactly as
 * the web GIS button does.
 */
export async function POST(request: Request) {
  // Guessing tickets is hopeless (they are sealed), but an unauthenticated
  // POST should not be free to hammer. 120 per 10 minutes per address; the
  // answer is the same opaque failure the app already handles.
  if (await isRateLimited(`native-google-redeem:${clientIp(request)}`, 120, 10 * 60 * 1000)) {
    return NextResponse.json({ error: "invalid_ticket" }, { status: 429, headers: { "Cache-Control": "no-store" } });
  }
  const body = (await request.json().catch(() => null)) as
    | { ticket?: unknown; secret?: unknown }
    | null;
  const ticket = typeof body?.ticket === "string" ? body.ticket : "";
  const secret = typeof body?.secret === "string" ? body.secret : "";

  const idToken = openIdTokenTicket(ticket, secret);
  // One opaque failure for every cause (tampered, wrong secret, expired, replayed
  // after expiry) — a probing caller learns nothing about which check it failed.
  if (!idToken) {
    return NextResponse.json({ error: "invalid_ticket" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }

  return NextResponse.json({ idToken }, { headers: { "Cache-Control": "no-store" } });
}
