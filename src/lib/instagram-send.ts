import { META_GRAPH } from "@/lib/agent-connect-oauth";

// ── The Instagram bot's three sends ─────────────────────────────────────────
//
// THE CONTRACT (pinned in tests/agent-instagram.test.ts):
//   • These are the ONLY functions that write to people on Instagram, and every
//     one of them answers something a person sent us first:
//       igPrivateReply  — needs the id of a comment left on one of our posts
//       igReplyToComment — same, replies publicly under that comment
//       igSendMessage   — needs the id of someone who MESSAGED us; Instagram
//                         itself refuses it outside 24h of their last message
//     There is no function here that takes a username or searches for people,
//     so a cold message is not something this code can express.
//   • Imported by exactly two modules: lib/instagram-bot.ts (automatic sends,
//     gated by the owner's switch) and lib/agent-execute.ts (the owner's
//     Approve button).

export type SendResult = { ok: true; id?: string } | { ok: false; error: string; code?: number };

async function post(url: string, token: string, body: Record<string, unknown>): Promise<SendResult> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = (await res.json().catch(() => ({}))) as { id?: string; message_id?: string; error?: { message?: string; code?: number } };
    if (!res.ok || j.error) return { ok: false, error: String(j.error?.message ?? `HTTP ${res.status}`).slice(0, 300), code: j.error?.code };
    return { ok: true, id: j.message_id ?? j.id };
  } catch (e) {
    return { ok: false, error: String((e as Error)?.message ?? e).slice(0, 300) };
  }
}

/** A private message to the person who left this comment (one per comment, within 7 days). */
export function igPrivateReply(token: string, commentId: string, text: string): Promise<SendResult> {
  return post(`${META_GRAPH}/me/messages`, token, { recipient: { comment_id: commentId }, message: { text: text.slice(0, 1000) } });
}

/** A public reply under a comment on one of our posts. */
export function igReplyToComment(token: string, commentId: string, text: string): Promise<SendResult> {
  return post(`${META_GRAPH}/${encodeURIComponent(commentId)}/replies`, token, { message: text.slice(0, 2200) });
}

/** A reply to someone who messaged us (Instagram allows it for 24h after their last message). */
export function igSendMessage(token: string, igsid: string, text: string): Promise<SendResult> {
  return post(`${META_GRAPH}/me/messages`, token, { recipient: { id: igsid }, messaging_type: "RESPONSE", message: { text: text.slice(0, 1000) } });
}

/** Meta refused because the app lacks the permission / review — hand it to the owner instead of retrying. */
export function isAccessError(r: SendResult): boolean {
  return !r.ok && (r.code === 10 || r.code === 200 || r.code === 190 || r.code === 3 || /permission|not authorized|access|capability/i.test(r.error));
}
