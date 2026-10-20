import { NextRequest, NextResponse } from "next/server";
import { hasGoogleWalletConfig } from "@/lib/google-wallet-config";
import { isRateLimited } from "@/lib/rate-limit";
import { clientIp } from "@/lib/client-ip";

// Signing needs Node — never the edge runtime.
export const runtime = "nodejs";

// GET /api/wallet/google?card=<slug> → writes that card's Google Wallet pass
// and redirects to Google's "Add to Google Wallet" page for it. Public like
// /api/wallet/pass: the card is public, so anyone viewing it may save it.
export async function GET(req: NextRequest) {
  if (!hasGoogleWalletConfig()) {
    return NextResponse.json(
      { error: "not_configured", message: "Google Wallet isn't set up yet." },
      { status: 501 }
    );
  }

  const username = req.nextUrl.searchParams.get("card");
  if (!username) return NextResponse.json({ error: "missing_card" }, { status: 400 });

  // Each save writes to Google's API, so it gets the same cap as the Apple
  // pass and for the same reason — sized for a booth of fifty phones on one
  // venue wifi, not for an attacker (see api/wallet/pass).
  if (await isRateLimited(`wallet-google:${clientIp(req) ?? "anon"}`, 120, 10 * 60 * 1000)) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  try {
    const { googleWalletSaveUrl } = await import("@/lib/google-wallet");
    const url = await googleWalletSaveUrl(username);
    if (!url) return NextResponse.json({ error: "not_found" }, { status: 404 });
    const res = NextResponse.redirect(url, 302);
    res.headers.set("Cache-Control", "no-store");
    return res;
  } catch (e) {
    console.error("[google-wallet] save link failed:", e);
    return NextResponse.json({ error: "build_failed" }, { status: 500 });
  }
}
