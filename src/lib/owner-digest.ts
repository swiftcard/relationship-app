import { from as senderAddress, INBOX_ADDRESS } from "@/lib/email-senders";
import { getAdminSupabase } from "@/lib/supabase-admin";
import { htmlToText } from "@/lib/email-text";

// ── Internal mail to the owner (agent digests, reports, alerts) ─────────────
// Extracted from /api/agent-email so the Crew reports (src/lib/crew) send the
// exact same way the relay always has. Abuse-proof by construction:
//   • The recipient is ALWAYS agent_system.digest_email from the DB (falling
//     back to the admin inbox) — no caller can choose who it mails.
//   • Subjects are prefixed so nothing sent here can impersonate product mail.
export async function sendOwnerDigest(subject: string, html: string): Promise<{ ok: boolean; skipped?: string }> {
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) return { ok: false, skipped: "no RESEND_API_KEY" };

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
      subject: `[Agents] ${subject.slice(0, 180)}`,
      html: html.slice(0, 100_000),
      // Internal mail, but it shares hello@swiftcard.me's reputation with
      // every card a user shares: HTML-only is a spam signal, so it gets the
      // same plain-text part as everything else.
      text: htmlToText(html.slice(0, 100_000)),
    }),
  });
  return { ok: res.ok };
}
