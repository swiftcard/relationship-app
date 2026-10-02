import { NextRequest, NextResponse } from "next/server";
import { handleWebhook, verifyMetaSignature } from "@/lib/instagram-bot";

// Meta's webhook for the SwiftCard Instagram account: a comment on one of our
// posts, or a message to us, arrives here the moment it happens. The decisions
// are lib/instagram-bot.ts — the same ones the 10-minute pass makes, so this
// route only makes them faster. It works once the Meta app is Live and
// approved; until then Meta sends nothing and the pass does the job.

export const runtime = "nodejs";
export const maxDuration = 60;

// Meta's one-time handshake when the webhook URL is saved in the app dashboard.
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const expected = process.env.META_WEBHOOK_VERIFY_TOKEN;
  if (expected && q.get("hub.mode") === "subscribe" && q.get("hub.verify_token") === expected) {
    return new NextResponse(q.get("hub.challenge") ?? "", { status: 200, headers: { "Content-Type": "text/plain" } });
  }
  return new NextResponse("Forbidden", { status: 403 });
}

export async function POST(req: NextRequest) {
  // The signature is over the RAW body — read it as text before parsing.
  const raw = await req.text();
  if (!verifyMetaSignature(raw, req.headers.get("x-hub-signature-256"), process.env.META_APP_SECRET)) {
    return new NextResponse("Bad signature", { status: 401 });
  }
  let body: unknown;
  try { body = JSON.parse(raw); } catch { return new NextResponse("Bad request", { status: 400 }); }
  try {
    const r = await handleWebhook(body);
    return NextResponse.json({ ok: true, ...r });
  } catch {
    // Always 200 once the signature checks out: Meta retries (and eventually
    // disables the subscription) on errors, and the 10-minute pass will catch
    // anything this delivery missed.
    return NextResponse.json({ ok: true, handled: 0 });
  }
}
