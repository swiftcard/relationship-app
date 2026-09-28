// ── Approve-to-execute: the owner's Approve button does the posting ──────────
//
// THE CONTRACT (pinned in tests/agent-flow.test.ts):
//   • This module is imported by exactly one place: the admin items route,
//     behind requireAdmin. Agents remain structurally unable to post — the
//     LLM side never sees these hosts, and the only trigger is the owner's
//     authenticated Approve on a pending item.
//   • Each connector is armed purely by env vars. Missing env = the item
//     falls back to the classic Approve & Copy flow, never an error.
//   • One item executes at most once: the caller only passes status=pending
//     items, and marks them 'posted' the moment execution succeeds.

import { getAdminSupabase } from "@/lib/supabase-admin";

export type QueueItemLite = {
  id: string;
  agent_id: string;
  item_type: string;
  platform: string | null;
  target: string | null;
  target_url: string | null;
  title: string;
  content: string | null;
  payload: Record<string, unknown> | null;
};

export type ExecOutcome =
  | { executed: true; connector: string; detail: string; url?: string; payloadPatch?: Record<string, unknown> }
  | { executed: false; connector?: string; reason: string };

type Connector = {
  id: string;
  /** Button label fragment, e.g. "Post to LinkedIn". */
  label: string;
  ready: () => boolean;
  matches: (it: QueueItemLite) => boolean;
  run: (it: QueueItemLite) => Promise<ExecOutcome>;
};

// ── LinkedIn: publish a text post as the owner (UGC Posts API) ──────────────
// Env: LINKEDIN_ACCESS_TOKEN (OAuth token with w_member_social),
//      LINKEDIN_AUTHOR_URN (e.g. urn:li:person:AbC123).
const linkedin: Connector = {
  id: "linkedin",
  label: "Post to LinkedIn",
  ready: () => !!(process.env.LINKEDIN_ACCESS_TOKEN && process.env.LINKEDIN_AUTHOR_URN),
  matches: (it) => it.platform === "linkedin" && (it.item_type === "generic" || it.item_type === "video_script" || it.item_type === "blog_post"),
  run: async (it) => {
    const text = (it.content ?? "").trim();
    if (!text) return { executed: false, connector: "linkedin", reason: "empty content" };
    const res = await fetch("https://api.linkedin.com/v2/ugcPosts", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.LINKEDIN_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
        "X-Restli-Protocol-Version": "2.0.0",
      },
      body: JSON.stringify({
        author: process.env.LINKEDIN_AUTHOR_URN,
        lifecycleState: "PUBLISHED",
        specificContent: {
          "com.linkedin.ugc.ShareContent": {
            shareCommentary: { text: text.slice(0, 2900) },
            shareMediaCategory: "NONE",
          },
        },
        visibility: { "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC" },
      }),
    });
    if (!res.ok) return { executed: false, connector: "linkedin", reason: `LinkedIn API ${res.status}: ${(await res.text()).slice(0, 180)}` };
    const postId = res.headers.get("x-restli-id") ?? "";
    const url = postId ? `https://www.linkedin.com/feed/update/${postId}/` : undefined;
    return { executed: true, connector: "linkedin", detail: "Posted to LinkedIn", url, payloadPatch: { posted_url: url ?? null, linkedin_post_id: postId } };
  },
};

// ── Higgsfield: submit the approved script/prompt as a generation job ────────
// Env: HIGGSFIELD_API_KEY_ID + HIGGSFIELD_API_KEY_SECRET
//      (optional HIGGSFIELD_ENDPOINT / HIGGSFIELD_VIDEO_ENDPOINT overrides).
//
// TWO endpoints, not one. Verified against the live OpenAPI spec at
// https://docs.higgsfield.ai/docs/openapi.json on 2026-09-09:
//  * Soul is IMAGE generation only. Sending a video_script there returned a
//    still, so Vince's videos would have rendered as one frame.
//  * The old default carried a "/v2/" segment that does not exist in the spec
//    (the real path is /higgsfield-ai/soul/standard). Every call would have
//    404'd the moment a real key was added — the connector had never been run
//    against live credentials, so nothing surfaced it.
//  * The dop/* video models are image-TO-video and require an image_url, so
//    they cannot take a bare script. hailuo-02 standard is text-to-video and
//    needs only `prompt`, which is what a video_script actually carries.
const higgsfield: Connector = {
  id: "higgsfield",
  label: "Send to Higgsfield",
  ready: () => !!(process.env.HIGGSFIELD_API_KEY_ID && process.env.HIGGSFIELD_API_KEY_SECRET),
  // Video AND image. Milo's scripts carry a HIGGSFIELD PROMPT for motion;
  // "image_brief" items are the still-image path (ad creative, post graphics),
  // which the owner asked for alongside video.
  matches: (it) => (it.item_type === "video_script" || it.item_type === "image_brief") && it.platform !== "linkedin",
  run: async (it) => {
    const prompt = (it.content ?? "").trim();
    if (!prompt) return { executed: false, connector: "higgsfield", reason: "empty script" };
    const isVideo = it.item_type === "video_script";
    const endpoint = isVideo
      ? process.env.HIGGSFIELD_VIDEO_ENDPOINT || "https://api.higgsfield.ai/minimax/hailuo-02/standard/text-to-video"
      : process.env.HIGGSFIELD_ENDPOINT || "https://api.higgsfield.ai/higgsfield-ai/soul/standard";
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Key ${process.env.HIGGSFIELD_API_KEY_ID}:${process.env.HIGGSFIELD_API_KEY_SECRET}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ prompt: prompt.slice(0, 4000) }),
    });
    if (!res.ok) return { executed: false, connector: "higgsfield", reason: `Higgsfield API ${res.status}: ${(await res.text()).slice(0, 180)}` };
    const j = (await res.json().catch(() => ({}))) as { request_id?: string; status_url?: string };

    // Record it in the SHARED POOL, not just this item's payload. Before this,
    // the job id went into the payload and nothing ever polled it — the finished
    // media URL was never captured anywhere, so Milo's videos were generated
    // into the void and paid ads had no asset to attach. The watchdog loop polls
    // media_assets every 60s and fills in the URL; both Milo (organic) and Addy
    // (paid) then draw from the same rendered asset instead of each paying to
    // render the same concept twice.
    const kind = it.item_type === "image_brief" ? "image" : "video";
    try {
      await getAdminSupabase().from("media_assets").insert({
        kind,
        prompt: prompt.slice(0, 4000),
        provider: "higgsfield",
        provider_job: j.request_id ?? null,
        status_url: j.status_url ?? null,
        source_item: it.id,
        source_agent: it.agent_id,
        concept: it.title?.slice(0, 200) ?? null,
      });
    } catch {
      /* pool insert is best-effort — the generation was still submitted, and a
         missing row must not report the submission as failed */
    }

    return {
      executed: true, connector: "higgsfield",
      detail: `${kind === "image" ? "Image" : "Video"} generation submitted${j.request_id ? ` (${j.request_id})` : ""} — it lands in the shared creative pool when it finishes`,
      url: j.status_url,
      payloadPatch: { higgsfield_request_id: j.request_id ?? null, higgsfield_status_url: j.status_url ?? null, media_kind: kind },
    };
  },
};

// ── Reddit: post the approved reply into the live thread ─────────────────────
// Env: REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET, REDDIT_USERNAME, REDDIT_PASSWORD
// (a "script" app on the owner's Reddit account).
const reddit: Connector = {
  id: "reddit",
  label: "Reply on Reddit",
  ready: () => !!(process.env.REDDIT_CLIENT_ID && process.env.REDDIT_CLIENT_SECRET && process.env.REDDIT_USERNAME && process.env.REDDIT_PASSWORD),
  matches: (it) => it.platform === "reddit" && (it.item_type === "reply_draft" || it.item_type === "outreach_draft") && !!it.target_url,
  run: async (it) => {
    const m = it.target_url!.match(/\/comments\/([a-z0-9]+)/i);
    if (!m) return { executed: false, connector: "reddit", reason: "couldn't find a thread id in the target URL" };
    const ua = "swiftcard-agent-flow/1.0 (owner-approved replies)";
    const tok = await fetch("https://www.reddit.com/api/v1/access_token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${process.env.REDDIT_CLIENT_ID}:${process.env.REDDIT_CLIENT_SECRET}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": ua,
      },
      body: new URLSearchParams({ grant_type: "password", username: process.env.REDDIT_USERNAME!, password: process.env.REDDIT_PASSWORD! }),
    });
    if (!tok.ok) return { executed: false, connector: "reddit", reason: `Reddit auth ${tok.status}` };
    const { access_token } = (await tok.json()) as { access_token?: string };
    if (!access_token) return { executed: false, connector: "reddit", reason: "Reddit auth: no token returned" };
    const res = await fetch("https://oauth.reddit.com/api/comment", {
      method: "POST",
      headers: { Authorization: `Bearer ${access_token}`, "Content-Type": "application/x-www-form-urlencoded", "User-Agent": ua },
      body: new URLSearchParams({ api_type: "json", thing_id: `t3_${m[1]}`, text: (it.content ?? "").slice(0, 9500) }),
    });
    const j = (await res.json().catch(() => null)) as { json?: { errors?: unknown[][]; data?: { things?: Array<{ data?: { permalink?: string } }> } } } | null;
    const errs = j?.json?.errors ?? [];
    if (!res.ok || errs.length) return { executed: false, connector: "reddit", reason: `Reddit API: ${errs.length ? JSON.stringify(errs[0]).slice(0, 160) : res.status}` };
    const permalink = j?.json?.data?.things?.[0]?.data?.permalink;
    const url = permalink ? `https://www.reddit.com${permalink}` : it.target_url ?? undefined;
    return { executed: true, connector: "reddit", detail: "Reply posted on Reddit", url, payloadPatch: { posted_url: url ?? null } };
  },
};

const CONNECTORS: Connector[] = [linkedin, higgsfield, reddit];

/** Which connectors are armed (for the board payload / Connections panel). */
export function connectorStatus(): Record<string, boolean> {
  return Object.fromEntries(CONNECTORS.map((c) => [c.id, c.ready()]));
}

/** Execute one owner-approved item. Never throws. */
export async function executeItem(it: QueueItemLite): Promise<ExecOutcome> {
  const c = CONNECTORS.find((c) => c.matches(it));
  if (!c) return { executed: false, reason: "no connector for this platform" };
  if (!c.ready()) return { executed: false, connector: c.id, reason: `${c.id} is not connected yet` };
  try {
    return await c.run(it);
  } catch (e) {
    return { executed: false, connector: c.id, reason: String(e).slice(0, 200) };
  }
}
