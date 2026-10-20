import { NextResponse, type NextRequest } from "next/server";
import { from as senderAddress, INBOX_ADDRESS } from "@/lib/email-senders";
import { getAdminSupabase } from "@/lib/supabase-admin";
import { htmlToText } from "@/lib/email-text";

// ── Email relay for the agents ───────────────────────────────────────────────
// GitHub Actions can't read the app's RESEND_API_KEY (it's a Vercel-sensitive
// var), so agents send their digest/cap/critical emails THROUGH the app.
// Abuse-proof by construction:
//   • Bearer AGENT_RELAY_SECRET (the route is a 404 until that secret
//     exists in the environment).
//   • The recipient is ALWAYS agent_system.digest_email from the DB — the
//     caller cannot choose who it mails, so the relay can't spam anyone.
//   • Subjects are prefixed so nothing sent here can impersonate product mail.
export async function POST(req: NextRequest) {
  const secret = process.env.AGENT_RELAY_SECRET;
  if (!secret) return NextResponse.json({ error: "not found" }, { status: 404 });
  const auth = req.headers.get("authorization") ?? "";
  if (auth !== `Bearer ${secret}`) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) return NextResponse.json({ ok: false, skipped: "no RESEND_API_KEY" });

  const body = (await req.json().catch(() => null)) as { subject?: string; html?: string } | null;
  if (!body?.subject || !body?.html) return NextResponse.json({ error: "subject and html required" }, { status: 400 });

  let to = INBOX_ADDRESS;
  try {
    const { data } = await getAdminSupabase().from("agent_system").select("digest_email").limit(1).single();
    if (data?.digest_email) to = data.digest_email;
  } catch { /* pre-schema: fall back to the admin address */ }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      // Internal alerts land ON hello@, so they must not also come FROM it:
      // mail from your own address to your own address is the shape of a
      // spoof, and every one teaches the owner's mailbox that hello@ arrives
      // from outside — the same From their card shares depend on.
      from: senderAddress("support", "SwiftCard Agents"),
      to: [to],
      subject: `[Agents] ${body.subject.slice(0, 180)}`,
      html: body.html.slice(0, 100_000),
      // Internal mail, but it shares hello@swiftcard.me's reputation with
      // every card a user shares: HTML-only is a spam signal, so it gets the
      // same plain-text part as everything else.
      text: htmlToText(body.html.slice(0, 100_000)),
    }),
  });
  return NextResponse.json({ ok: res.ok }, { status: res.ok ? 200 : 502 });
}
