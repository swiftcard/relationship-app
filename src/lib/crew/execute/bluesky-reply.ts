import { blueskyConfigured, env } from "../env";
import type { Approval } from "../types";
import type { ExecResult } from "./index";

// ── Approved Bluesky reply → posted from the SwiftCard account ──────────────
// Bluesky's AT Protocol is open: an app password (never the account password)
// creates a session, and app.bsky.feed.post records are written with
// com.atproto.repo.createRecord. A reply names its root and parent by URI and
// CID, which we resolve from the post's bsky.app link first. Runs only from
// the Approve path, only when Controls says "Approval posts it" for Bluesky,
// and never in dry run.

const PDS = "https://bsky.social";

export { blueskyConfigured };

type Session = { accessJwt: string; did: string };
type PostView = { uri: string; cid: string; record?: { reply?: { root?: { uri: string; cid: string } } } };

async function session(): Promise<Session> {
  const r = await fetch(`${PDS}/xrpc/com.atproto.server.createSession`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier: env("BLUESKY_HANDLE"), password: env("BLUESKY_APP_PASSWORD") }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!r.ok) throw new Error(`bluesky login: HTTP ${r.status}`);
  return (await r.json()) as Session;
}

/** https://bsky.app/profile/<handle>/post/<rkey> → the post's URI and CID (public AppView). */
export async function resolvePost(url: string): Promise<PostView | null> {
  const m = /bsky\.app\/profile\/([^/]+)\/post\/([A-Za-z0-9]+)/.exec(url);
  if (!m) return null;
  const [, actor, rkey] = m;
  let did = actor;
  if (!actor.startsWith("did:")) {
    const r = await fetch(`https://api.bsky.app/xrpc/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(actor)}`, { signal: AbortSignal.timeout(10_000) });
    if (!r.ok) return null;
    did = ((await r.json()) as { did: string }).did;
  }
  const uri = `at://${did}/app.bsky.feed.post/${rkey}`;
  const r = await fetch(`https://api.bsky.app/xrpc/app.bsky.feed.getPosts?uris=${encodeURIComponent(uri)}`, { signal: AbortSignal.timeout(10_000) });
  if (!r.ok) return null;
  const j = (await r.json()) as { posts?: PostView[] };
  return j.posts?.[0] ?? null;
}

export async function postBlueskyReply(a: Approval): Promise<ExecResult> {
  if (!blueskyConfigured()) return { ok: false, message: "Bluesky isn't connected (BLUESKY_HANDLE and BLUESKY_APP_PASSWORD)." };
  if (!a.target_url) return { ok: false, message: "No post to reply to." };
  const text = a.body.trim();
  if (text.length > 300) return { ok: false, message: `The reply is ${text.length} characters; Bluesky allows 300.` };
  const parent = await resolvePost(a.target_url);
  if (!parent) return { ok: false, message: "That Bluesky post can't be found any more." };
  const root = parent.record?.reply?.root ?? { uri: parent.uri, cid: parent.cid };
  const s = await session();
  const r = await fetch(`${PDS}/xrpc/com.atproto.repo.createRecord`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${s.accessJwt}` },
    body: JSON.stringify({
      repo: s.did,
      collection: "app.bsky.feed.post",
      record: { $type: "app.bsky.feed.post", text, createdAt: new Date().toISOString(), langs: ["en"], reply: { root, parent: { uri: parent.uri, cid: parent.cid } } },
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!r.ok) return { ok: false, message: `Bluesky refused the reply: HTTP ${r.status}` };
  const j = (await r.json()) as { uri: string };
  const rkey = j.uri.split("/").pop();
  const url = `https://bsky.app/profile/${env("BLUESKY_HANDLE")}/post/${rkey}`;
  return { ok: true, message: `Posted on Bluesky: ${url}`, result: { url } };
}
