import { META_GRAPH } from "@/lib/agent-connect-oauth";

// ── The Facebook bot's three sends ──────────────────────────────────────────
//
// THE CONTRACT (pinned in tests/agent-facebook.test.ts) — the same one as
// lib/instagram-send.ts:
//   • These are the ONLY functions that write to people on Facebook, and every
//     one of them answers something a person sent the SwiftCard Page first:
//       fbPrivateReply   — needs the id of a comment left on one of our posts
//       fbReplyToComment — same, replies publicly under that comment
//       fbSendMessage    — needs the id of someone who MESSAGED the Page;
//                          Messenger itself refuses it outside 24h of their
//                          last message
//     There is no function here that takes a name or searches for people, so a
//     cold message is not something this code can express.
//   • Imported by exactly two modules: lib/facebook-bot.ts (automatic sends,
//     gated by the owner's switch) and lib/agent-execute.ts (the owner's
//     Approve button).

export type FbSendResult = { ok: true; id?: string } | { ok: false; error: string; code?: number };

async function post(url: string, token: string, body: Record<string, unknown>): Promise<FbSendResult> {
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

const page = (pageId: string) => `${META_GRAPH}/${encodeURIComponent(pageId)}/messages`;

/** A private Messenger message to the person who left this comment (one per comment, within 7 days). */
export function fbPrivateReply(token: string, pageId: string, commentId: string, text: string): Promise<FbSendResult> {
  return post(page(pageId), token, { recipient: { comment_id: commentId }, messaging_type: "RESPONSE", message: { text: text.slice(0, 2000) } });
}

/** A public reply under a comment on one of our Page's posts. */
export function fbReplyToComment(token: string, commentId: string, text: string): Promise<FbSendResult> {
  return post(`${META_GRAPH}/${encodeURIComponent(commentId)}/comments`, token, { message: text.slice(0, 8000) });
}

/** A reply to someone who messaged the Page (Messenger allows it for 24h after their last message). */
export function fbSendMessage(token: string, pageId: string, psid: string, text: string): Promise<FbSendResult> {
  return post(page(pageId), token, { recipient: { id: psid }, messaging_type: "RESPONSE", message: { text: text.slice(0, 2000) } });
}
