import { NextResponse, type NextRequest } from "next/server";
import { sendOwnerDigest } from "@/lib/owner-digest";

// ── Email relay for the agents ───────────────────────────────────────────────
// GitHub Actions can't read the app's RESEND_API_KEY (it's a Vercel-sensitive
// var), so agents send their digest/cap/critical emails THROUGH the app.
// Abuse-proof by construction:
//   • Bearer AGENT_RELAY_SECRET (the route is a 404 until that secret
//     exists in the environment).
//   • The recipient is ALWAYS agent_system.digest_email from the DB — the
//     caller cannot choose who it mails, so the relay can't spam anyone
//     (see lib/owner-digest, shared with the Crew reports).
//   • Subjects are prefixed so nothing sent here can impersonate product mail.
export async function POST(req: NextRequest) {
  const secret = process.env.AGENT_RELAY_SECRET;
  if (!secret) return NextResponse.json({ error: "not found" }, { status: 404 });
  const auth = req.headers.get("authorization") ?? "";
  if (auth !== `Bearer ${secret}`) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!process.env.RESEND_API_KEY) return NextResponse.json({ ok: false, skipped: "no RESEND_API_KEY" });

  const body = (await req.json().catch(() => null)) as { subject?: string; html?: string } | null;
  if (!body?.subject || !body?.html) return NextResponse.json({ error: "subject and html required" }, { status: 400 });

  const r = await sendOwnerDigest(body.subject, body.html);
  return NextResponse.json({ ok: r.ok }, { status: r.ok ? 200 : 502 });
}
