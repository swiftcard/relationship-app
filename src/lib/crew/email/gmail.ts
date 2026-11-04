import { youtubeClient } from "@/lib/agent-connections";
import { getAdminSupabase } from "@/lib/supabase-admin";
import { decryptToken, encryptToken } from "@/lib/token-crypto";

// ── The SwiftCard mailbox, through the Gmail API ────────────────────────────
// The owner connects the mailbox once (admin → Agents → Email → Connect,
// /api/admin/connect/google_gmail): the same owner-only, Workspace-internal
// Google client as the demo calendar, OAuth with exactly two Gmail scopes:
//   gmail.send      send a message (cannot read, list or delete anything)
//   gmail.metadata  headers and labels only, never a message body: enough to
//                   see that a thread got a reply or a bounce, and to find a
//                   message we sent by its Message-ID
// No domain-wide delegation and no service account: the token can act only
// as that one mailbox, and Disconnect (or myaccount.google.com/permissions)
// revokes it. The refresh token lives encrypted in agent_connections.
//
// Server-only: imports the service-role client.

export const GMAIL_PROVIDER = "google_gmail" as const;
export { GMAIL_SCOPES } from "./scopes";

const API = "https://gmail.googleapis.com/gmail/v1/users/me";
const SKEW_MS = 2 * 60 * 1000;

export type GmailAccount = { ok: true; email: string } | { ok: false; reason: "not_connected" | "revoked" | "unavailable"; detail?: string };
export type SendOutcome =
  | { ok: true; id: string; threadId: string }
  /** definite: Gmail answered and refused, so nothing went out. Not definite: no answer; it may have gone. */
  | { ok: false; definite: boolean; status: number | null; message: string };
export type ThreadMessage = { from: string; subject?: string; labelIds: string[] };

/** What the sender needs from Gmail. LiveGmail is the real one; the tests pass a fake. */
export interface GmailTransport {
  account(): Promise<GmailAccount>;
  send(raw: string): Promise<SendOutcome>;
  /**
   * The sent message with this Message-ID, looking back through Sent to
   * `sinceIso`. Null only when every Sent message back to then was checked;
   * "unavailable" when Gmail can't be asked or the window couldn't be covered.
   */
  findSent(messageIdHeader: string, sinceIso: string): Promise<{ id: string; threadId: string } | null | "unavailable">;
  /** The thread's messages (headers only), or null when it can't be read. */
  thread(threadId: string): Promise<ThreadMessage[] | null>;
  /** The newest messages in the inbox (headers only), or null when it can't be read. */
  inbox(limit: number): Promise<ThreadMessage[] | null>;
}

type ConnRow = { access_token: string; refresh_token: string | null; expires_at: string | null; account_label: string | null };

async function loadRow(): Promise<ConnRow | null> {
  try {
    const { data } = await getAdminSupabase().from("agent_connections").select("access_token, refresh_token, expires_at, account_label").eq("provider", GMAIL_PROVIDER).maybeSingle();
    return (data as ConnRow | null) ?? null;
  } catch {
    return null;
  }
}

async function token(): Promise<{ ok: true; token: string; email: string } | Exclude<GmailAccount, { ok: true }>> {
  const row = await loadRow();
  if (!row) return { ok: false, reason: "not_connected" };
  const email = (row.account_label ?? "").toLowerCase();
  let access: string;
  let refresh: string | null;
  try {
    access = decryptToken(row.access_token);
    refresh = row.refresh_token ? decryptToken(row.refresh_token) : null;
  } catch {
    return { ok: false, reason: "revoked", detail: "stored token can't be decrypted" };
  }
  if (row.expires_at && new Date(row.expires_at).getTime() - Date.now() > SKEW_MS) return { ok: true, token: access, email };
  if (!refresh) return { ok: false, reason: "revoked", detail: "no refresh token" };
  const { id, secret } = youtubeClient();
  let res: Response;
  try {
    res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refresh, client_id: id ?? "", client_secret: secret ?? "" }),
      signal: AbortSignal.timeout(8000),
    });
  } catch (e) {
    return { ok: false, reason: "unavailable", detail: e instanceof Error ? e.message : String(e) };
  }
  const j = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; refresh_token?: string; error?: string };
  if (!res.ok || !j.access_token) {
    const revoked = j.error === "invalid_grant" || j.error === "unauthorized_client";
    return { ok: false, reason: revoked ? "revoked" : "unavailable", detail: `${res.status} ${j.error ?? ""}`.trim() };
  }
  await getAdminSupabase()
    .from("agent_connections")
    .update({ access_token: encryptToken(j.access_token), refresh_token: encryptToken(j.refresh_token ?? refresh), expires_at: new Date(Date.now() + (j.expires_in ?? 3600) * 1000).toISOString(), updated_at: new Date().toISOString() })
    .eq("provider", GMAIL_PROVIDER);
  return { ok: true, token: j.access_token, email };
}

async function get(tok: string, path: string): Promise<Record<string, unknown> | null> {
  try {
    const r = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${tok}` }, signal: AbortSignal.timeout(10_000) });
    return r.ok ? ((await r.json()) as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

type Header = { name?: string; value?: string };
const header = (m: Record<string, unknown>, name: string) =>
  ((m.payload as { headers?: Header[] } | undefined)?.headers ?? []).find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? "";

const toMessage = (m: Record<string, unknown>): ThreadMessage => ({ from: header(m, "From"), subject: header(m, "Subject"), labelIds: (m.labelIds as string[] | undefined) ?? [] });

export class LiveGmail implements GmailTransport {
  async account(): Promise<GmailAccount> {
    const t = await token();
    return t.ok ? { ok: true, email: t.email } : t;
  }

  async send(raw: string): Promise<SendOutcome> {
    const t = await token();
    if (!t.ok) return { ok: false, definite: true, status: null, message: `the mailbox isn't connected (${t.reason})` };
    let r: Response;
    try {
      r = await fetch(`${API}/messages/send`, {
        method: "POST",
        headers: { Authorization: `Bearer ${t.token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ raw }),
        signal: AbortSignal.timeout(20_000),
      });
    } catch (e) {
      // Timed out or the connection dropped: Gmail may or may not have sent it.
      return { ok: false, definite: false, status: null, message: `no answer from Gmail (${e instanceof Error ? e.name : "error"})` };
    }
    const j = (await r.json().catch(() => ({}))) as { id?: string; threadId?: string; error?: { message?: string } };
    if (r.ok && j.id) return { ok: true, id: j.id, threadId: j.threadId ?? j.id };
    // A 4xx is Gmail refusing the request: nothing was sent. A 5xx can follow a send that went through.
    return { ok: false, definite: r.status >= 400 && r.status < 500, status: r.status, message: `Gmail ${r.status}: ${(j.error?.message ?? "").slice(0, 160)}` };
  }

  async findSent(messageIdHeader: string, sinceIso: string) {
    const t = await token();
    if (!t.ok) return "unavailable" as const;
    const since = Date.parse(sinceIso);
    let page = "";
    // At most 300 Sent messages (the cap is 50 a day); past that, say we can't tell.
    for (let checked = 0; checked < 300; ) {
      const list = await get(t.token, `/messages?labelIds=SENT&maxResults=50${page ? `&pageToken=${encodeURIComponent(page)}` : ""}`);
      if (!list) return "unavailable" as const;
      const msgs = (list.messages as { id: string; threadId: string }[] | undefined) ?? [];
      for (const m of msgs) {
        const full = await get(t.token, `/messages/${m.id}?format=metadata&metadataHeaders=Message-ID`);
        if (!full) return "unavailable" as const;
        checked++;
        if (header(full, "Message-ID").trim() === messageIdHeader.trim()) return { id: m.id, threadId: m.threadId };
        // Sent is newest first: once a message is older than the window, ours isn't there.
        if (Number(full.internalDate ?? 0) < since) return null;
      }
      page = String(list.nextPageToken ?? "");
      if (!page) return null; // the whole Sent folder was checked
    }
    return "unavailable" as const;
  }

  async thread(threadId: string) {
    const t = await token();
    if (!t.ok) return null;
    const j = await get(t.token, `/threads/${encodeURIComponent(threadId)}?format=metadata&metadataHeaders=From&metadataHeaders=Subject`);
    if (!j) return null;
    return ((j.messages as Record<string, unknown>[] | undefined) ?? []).map(toMessage);
  }

  async inbox(limit: number) {
    const t = await token();
    if (!t.ok) return null;
    const list = await get(t.token, `/messages?labelIds=INBOX&maxResults=${Math.min(100, Math.max(1, limit))}`);
    if (!list) return null;
    const out: ThreadMessage[] = [];
    for (const m of (list.messages as { id: string }[] | undefined) ?? []) {
      const full = await get(t.token, `/messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject`);
      if (!full) return null;
      out.push(toMessage(full));
    }
    return out;
  }
}
