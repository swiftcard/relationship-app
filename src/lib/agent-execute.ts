// ── Approve-to-execute: the owner's Approve button does the posting ──────────
//
// THE CONTRACT (pinned in tests/agent-flow.test.ts):
//   • This module is imported by exactly one place: the admin items route,
//     behind requireAdmin. Agents remain structurally unable to post — the
//     LLM side never sees these hosts, and the only trigger is the owner's
//     authenticated Approve on a pending item.
//   • Each connector is armed by a connected account (agent_connections, set
//     from Settings → Connections) or, for the older shapes, by env vars.
//     Not armed = the item falls back to the classic Approve & Copy flow,
//     never an error.
//   • One item executes at most once: the caller only passes status=pending
//     items, and marks them 'posted' the moment execution succeeds.
//   • Everything public posts AS SWIFTCARD (standing rule 2026-09-09): the X
//     account, the Facebook Page + its Instagram, the YouTube channel, the
//     LinkedIn Page. A LinkedIn connection that can only post as a person is
//     held, not posted, unless LINKEDIN_ALLOW_MEMBER_POSTS=1.

import { getAdminSupabase } from "@/lib/supabase-admin";
import { type ConnectionMap, freshAccessToken, loadConnections } from "@/lib/agent-connections";
import { LINKEDIN_VERSION, META_GRAPH } from "@/lib/agent-connect-oauth";
import { igPrivateReply, igReplyToComment, igSendMessage } from "@/lib/instagram-send";
import { fbPrivateReply, fbReplyToComment, fbSendMessage } from "@/lib/facebook-send";

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
  ready: (conns: ConnectionMap) => boolean;
  matches: (it: QueueItemLite) => boolean;
  run: (it: QueueItemLite, conns: ConnectionMap) => Promise<ExecOutcome>;
};

// ── Shared helpers ───────────────────────────────────────────────────────────

/** The platform an item is for — the column, else the brain's payload field.
 *  Mirrored in AgentFlowClient.tsx (platformOf). */
function platformOf(it: QueueItemLite): string {
  return String(it.platform ?? it.payload?.platform ?? "").toLowerCase().trim();
}
const SOCIAL_KINDS = new Set(["social_post", "generic", "local_post"]);
const isSocial = (it: QueueItemLite) => SOCIAL_KINDS.has(it.item_type);

type Asset = { kind: "image" | "video"; url: string };

/** The picture/video attached to an item: a direct URL in the payload, or a
 *  READY row from the shared creative pool (payload.asset_id). */
async function resolveAsset(it: QueueItemLite): Promise<Asset | null> {
  const p = it.payload ?? {};
  const direct = [p.media_url, p.asset_url, p.video_url, p.image_url].find((u) => typeof u === "string" && /^https?:\/\//.test(u)) as string | undefined;
  if (direct) return { kind: p.media_kind === "video" || /\.(mp4|mov|webm|m4v)(\?|$)/i.test(direct) ? "video" : "image", url: direct };
  const id = typeof p.asset_id === "string" && /^[0-9a-f-]{36}$/i.test(p.asset_id) ? p.asset_id : null;
  if (!id) return null;
  try {
    const { data } = await getAdminSupabase().from("media_assets").select("kind,url,status").eq("id", id).maybeSingle();
    if (!data?.url || data.status !== "ready") return null;
    return { kind: data.kind === "video" ? "video" : "image", url: data.url };
  } catch {
    return null;
  }
}

function linkOf(it: QueueItemLite): string | null {
  const l = [it.payload?.link, it.payload?.url, it.target_url].find((u) => typeof u === "string" && /^https?:\/\//.test(u)) as string | undefined;
  return l ?? null;
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  return (await res.json().catch(() => ({}))) as Record<string, unknown>;
}
const errText = (j: Record<string, unknown>, status: number) => {
  const e = j.error as { message?: string } | undefined;
  return `${status}${e?.message ? `: ${e.message}` : ""}`.slice(0, 180);
};

// ── LinkedIn: publish a text post as the SwiftCard Page (Posts API) ─────────
// Connected account (agent_connections) with meta.org_urn → POST /rest/posts as
// the organization. A person-only connection is held (standing rule) unless
// LINKEDIN_ALLOW_MEMBER_POSTS=1. Env fallback for the original shape:
// LINKEDIN_ACCESS_TOKEN (w_member_social) + LINKEDIN_AUTHOR_URN → ugcPosts.
const linkedin: Connector = {
  id: "linkedin",
  label: "Post to LinkedIn",
  ready: (c) => {
    const conn = c.linkedin;
    if (conn) return !!conn.meta.org_urn || process.env.LINKEDIN_ALLOW_MEMBER_POSTS === "1";
    return !!(process.env.LINKEDIN_ACCESS_TOKEN && process.env.LINKEDIN_AUTHOR_URN);
  },
  matches: (it) => platformOf(it) === "linkedin" && (isSocial(it) || it.item_type === "video_script" || it.item_type === "blog_post"),
  run: async (it, c) => {
    const text = (it.content ?? "").trim();
    if (!text) return { executed: false, connector: "linkedin", reason: "empty content" };
    const conn = c.linkedin;
    const token = conn ? await freshAccessToken(conn) : process.env.LINKEDIN_ACCESS_TOKEN;
    if (!token) return { executed: false, connector: "linkedin", reason: "LinkedIn token expired — reconnect it in Settings" };
    const orgUrn = conn?.meta.org_urn as string | undefined;
    const author = orgUrn ?? (conn?.account_id ? `urn:li:person:${conn.account_id}` : process.env.LINKEDIN_AUTHOR_URN);
    if (!author) return { executed: false, connector: "linkedin", reason: "LinkedIn connection has no Page yet — reconnect once LinkedIn grants Page access" };

    let res: Response;
    if (orgUrn) {
      // Organization posts must use the versioned Posts API (ugcPosts for orgs
      // was sunset 2023-06-30) — flat payload, LinkedIn-Version header.
      res = await fetch("https://api.linkedin.com/rest/posts", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "X-Restli-Protocol-Version": "2.0.0", "LinkedIn-Version": LINKEDIN_VERSION },
        body: JSON.stringify({
          author, commentary: text.slice(0, 2900), visibility: "PUBLIC",
          distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
          lifecycleState: "PUBLISHED", isReshareDisabledByAuthor: false,
        }),
      });
    } else {
      res = await fetch("https://api.linkedin.com/v2/ugcPosts", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "X-Restli-Protocol-Version": "2.0.0" },
        body: JSON.stringify({
          author, lifecycleState: "PUBLISHED",
          specificContent: { "com.linkedin.ugc.ShareContent": { shareCommentary: { text: text.slice(0, 2900) }, shareMediaCategory: "NONE" } },
          visibility: { "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC" },
        }),
      });
    }
    if (!res.ok) return { executed: false, connector: "linkedin", reason: `LinkedIn API ${res.status}: ${(await res.text()).slice(0, 180)}` };
    const postId = res.headers.get("x-restli-id") ?? "";
    const url = postId ? `https://www.linkedin.com/feed/update/${postId}/` : undefined;
    return { executed: true, connector: "linkedin", detail: `Posted to LinkedIn${orgUrn ? " as the SwiftCard Page" : ""}`, url, payloadPatch: { posted_url: url ?? null, linkedin_post_id: postId } };
  },
};

// ── X: publish a post as the connected (SwiftCard) account ──────────────────
// OAuth2 user context, tweet.write. Pay-per-use since 2026-02: ~$0.015/post,
// $0.20 when the post carries a URL. Originals only — programmatic replies,
// likes and quotes are gated on X's side.
const x: Connector = {
  id: "x",
  label: "Post to X",
  ready: (c) => !!c.x,
  matches: (it) => ["x", "twitter"].includes(platformOf(it)) && isSocial(it),
  run: async (it, c) => {
    const text = (it.content ?? "").trim();
    if (!text) return { executed: false, connector: "x", reason: "empty content" };
    if (text.length > 280) return { executed: false, connector: "x", reason: `${text.length} characters — X allows 280. Edit it shorter and approve again.` };
    const token = await freshAccessToken(c.x!);
    if (!token) return { executed: false, connector: "x", reason: "X token expired — reconnect it in Settings" };
    const res = await fetch("https://api.x.com/2/tweets", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    const j = await readJson(res);
    if (!res.ok) return { executed: false, connector: "x", reason: `X API ${errText(j, res.status)}${typeof j.detail === "string" ? `: ${j.detail.slice(0, 120)}` : ""}` };
    const id = (j.data as { id?: string } | undefined)?.id ?? "";
    const handle = (c.x!.account_label ?? "").replace(/^@/, "");
    const url = id ? (handle ? `https://x.com/${handle}/status/${id}` : `https://x.com/i/web/status/${id}`) : undefined;
    return { executed: true, connector: "x", detail: "Posted to X", url, payloadPatch: { posted_url: url ?? null, x_post_id: id } };
  },
};

// ── Facebook: post to the SwiftCard Page (text, photo or video) ─────────────
// Page token from the Meta connection (never expires). Organic Page posting
// needs no App Review — Standard Access covers app role-holders.
const facebook: Connector = {
  id: "facebook",
  label: "Post to Facebook",
  ready: (c) => !!c.meta?.meta.page_id,
  matches: (it) => ["facebook", "fb"].includes(platformOf(it)) && isSocial(it),
  run: async (it, c) => {
    const text = (it.content ?? "").trim();
    if (!text) return { executed: false, connector: "facebook", reason: "empty content" };
    const conn = c.meta!;
    const page = String(conn.meta.page_id);
    const asset = await resolveAsset(it);
    const link = linkOf(it);
    const auth = { Authorization: `Bearer ${conn.access_token}`, "Content-Type": "application/json" };
    let res: Response;
    if (asset?.kind === "image") {
      res = await fetch(`${META_GRAPH}/${page}/photos`, { method: "POST", headers: auth, body: JSON.stringify({ url: asset.url, caption: text }) });
    } else if (asset?.kind === "video") {
      res = await fetch(`${META_GRAPH}/${page}/videos`, { method: "POST", headers: auth, body: JSON.stringify({ file_url: asset.url, description: text }) });
    } else {
      res = await fetch(`${META_GRAPH}/${page}/feed`, { method: "POST", headers: auth, body: JSON.stringify({ message: text, ...(link ? { link } : {}) }) });
    }
    const j = await readJson(res);
    if (!res.ok) return { executed: false, connector: "facebook", reason: `Facebook API ${errText(j, res.status)}` };
    const id = String(j.post_id ?? j.id ?? "");
    const url = id ? `https://www.facebook.com/${id}` : undefined;
    return { executed: true, connector: "facebook", detail: `Posted to the ${conn.meta.page_name ?? "Facebook"} Page`, url, payloadPatch: { posted_url: url ?? null, facebook_post_id: id } };
  },
};

/** A carousel's slides: payload.asset_ids (creative pool) or payload.media_urls, 2–10 of them. */
async function resolveCarousel(it: QueueItemLite): Promise<Asset[] | null> {
  const p = it.payload ?? {};
  const urls = Array.isArray(p.media_urls) ? p.media_urls.filter((u): u is string => typeof u === "string" && /^https?:\/\//.test(u)) : [];
  const ids = Array.isArray(p.asset_ids) ? p.asset_ids.filter((a): a is string => typeof a === "string" && /^[0-9a-f-]{36}$/i.test(a)) : [];
  if (urls.length < 2 && ids.length < 2) return null;
  const out: Asset[] = urls.map((url) => ({ kind: /\.(mp4|mov|webm|m4v)(\?|$)/i.test(url) ? "video" : "image", url }));
  if (!out.length) {
    try {
      const { data } = await getAdminSupabase().from("media_assets").select("id,kind,url,status").in("id", ids);
      // Keep the brief's slide order, and only slides that actually rendered.
      for (const id of ids) {
        const row = (data ?? []).find((r) => r.id === id);
        if (row?.url && row.status === "ready") out.push({ kind: row.kind === "video" ? "video" : "image", url: row.url });
      }
    } catch {
      return null;
    }
  }
  return out.length >= 2 ? out.slice(0, 10) : null;
}

// ── Instagram: publish a picture or reel to the Page's Business account ─────
// Two-step Content Publishing API (container → publish), 100 posts/24h.
// Instagram has no text-only posts, so an item without a ready asset is held.
const instagram: Connector = {
  id: "instagram",
  label: "Post to Instagram",
  ready: (c) => !!c.meta?.meta.ig_user_id,
  matches: (it) => ["instagram", "ig"].includes(platformOf(it)) && isSocial(it),
  run: async (it, c) => {
    const caption = (it.content ?? "").trim();
    const conn = c.meta!;
    const ig = String(conn.meta.ig_user_id);
    const auth = { Authorization: `Bearer ${conn.access_token}`, "Content-Type": "application/json" };
    // A carousel (swipe post): one child container per image, then the parent.
    // Image slides only — a video child needs its own transcode wait.
    const slides = await resolveCarousel(it);
    const asset: Asset | null = slides ? { kind: "image", url: slides[0].url } : await resolveAsset(it);
    if (!asset) return { executed: false, connector: "instagram", reason: "Instagram needs a picture or video — attach a ready asset from the creative pool (asset_id) and approve again" };
    let body: Record<string, unknown>;
    if (slides) {
      if (slides.some((sl) => sl.kind === "video")) return { executed: false, connector: "instagram", reason: "Instagram carousel: use images only (a video goes out as its own Reel)" };
      const children: string[] = [];
      for (const sl of slides) {
        const r = await fetch(`${META_GRAPH}/${ig}/media`, { method: "POST", headers: auth, body: JSON.stringify({ image_url: sl.url, is_carousel_item: true }) });
        const j = await readJson(r);
        if (!r.ok || !j.id) return { executed: false, connector: "instagram", reason: `Instagram carousel slide ${errText(j, r.status)}` };
        children.push(String(j.id));
      }
      body = { media_type: "CAROUSEL", children: children.join(","), caption: caption.slice(0, 2200) };
    } else {
      body = asset.kind === "video"
        ? { media_type: "REELS", video_url: asset.url, caption: caption.slice(0, 2200), share_to_feed: true }
        : { image_url: asset.url, caption: caption.slice(0, 2200) };
    }
    const cRes = await fetch(`${META_GRAPH}/${ig}/media`, { method: "POST", headers: auth, body: JSON.stringify(body) });
    const cj = await readJson(cRes);
    if (!cRes.ok || !cj.id) return { executed: false, connector: "instagram", reason: `Instagram container ${errText(cj, cRes.status)}` };
    const containerId = String(cj.id);
    // Videos transcode server-side; publishing before FINISHED fails with
    // "media not ready". Images are ready at once.
    if (asset.kind === "video") {
      const deadline = Date.now() + 80_000;
      let code = "IN_PROGRESS";
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 4000));
        const s = await readJson(await fetch(`${META_GRAPH}/${containerId}?fields=status_code,status`, { headers: auth }));
        code = String(s.status_code ?? "IN_PROGRESS");
        if (code === "FINISHED") break;
        if (code === "ERROR" || code === "EXPIRED") return { executed: false, connector: "instagram", reason: `Instagram rejected the video: ${String(s.status ?? code).slice(0, 140)}` };
      }
      if (code !== "FINISHED") return { executed: false, connector: "instagram", reason: "Instagram is still processing the video — wait a minute and approve again" };
    }
    const pRes = await fetch(`${META_GRAPH}/${ig}/media_publish`, { method: "POST", headers: auth, body: JSON.stringify({ creation_id: containerId }) });
    const pj = await readJson(pRes);
    if (!pRes.ok || !pj.id) return { executed: false, connector: "instagram", reason: `Instagram publish ${errText(pj, pRes.status)}` };
    const mediaId = String(pj.id);
    const perma = await readJson(await fetch(`${META_GRAPH}/${mediaId}?fields=permalink`, { headers: auth }));
    const url = typeof perma.permalink === "string" ? perma.permalink : undefined;
    return { executed: true, connector: "instagram", detail: `Posted to Instagram${conn.meta.ig_username ? ` (@${conn.meta.ig_username})` : ""}`, url, payloadPatch: { posted_url: url ?? null, instagram_media_id: mediaId } };
  },
};

// ── YouTube: upload the rendered video to the channel ───────────────────────
// Resumable upload, streamed straight from the creative pool URL. Until the
// API project passes YouTube's compliance audit every upload is forced to
// PRIVATE by Google regardless of what we ask — the detail says so.
const youtube: Connector = {
  id: "youtube",
  label: "Upload to YouTube",
  ready: (c) => !!c.youtube,
  matches: (it) => ["youtube", "youtube_shorts", "yt"].includes(platformOf(it)) && isSocial(it),
  run: async (it, c) => {
    const asset = await resolveAsset(it);
    if (!asset || asset.kind !== "video") return { executed: false, connector: "youtube", reason: "YouTube needs a rendered video — attach a ready video from the creative pool (asset_id) and approve again" };
    const token = await freshAccessToken(c.youtube!);
    if (!token) return { executed: false, connector: "youtube", reason: "YouTube token expired — reconnect it in Settings" };
    const p = it.payload ?? {};
    const title = String(p.title ?? p.headline ?? it.title).slice(0, 100);
    const description = (it.content ?? "").slice(0, 5000);
    const tags = Array.isArray(p.hashtags) ? (p.hashtags as unknown[]).map((h) => String(h).replace(/^#/, "")).slice(0, 15) : [];
    const privacy = ["public", "unlisted", "private"].includes(String(p.privacy)) ? String(p.privacy) : "public";

    const src = await fetch(asset.url);
    if (!src.ok || !src.body) return { executed: false, connector: "youtube", reason: `couldn't fetch the video (${src.status})` };
    const type = src.headers.get("content-type")?.startsWith("video/") ? src.headers.get("content-type")! : "video/mp4";
    const length = src.headers.get("content-length");

    const init = await fetch("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=UTF-8", "X-Upload-Content-Type": type, ...(length ? { "X-Upload-Content-Length": length } : {}) },
      body: JSON.stringify({ snippet: { title, description, tags, categoryId: "22" }, status: { privacyStatus: privacy, selfDeclaredMadeForKids: false } }),
    });
    if (!init.ok) return { executed: false, connector: "youtube", reason: `YouTube API ${errText(await readJson(init), init.status)}` };
    const location = init.headers.get("location");
    if (!location) return { executed: false, connector: "youtube", reason: "YouTube gave no upload session" };
    const up = await fetch(location, {
      method: "PUT",
      headers: { "Content-Type": type, ...(length ? { "Content-Length": length } : {}) },
      body: src.body,
      duplex: "half",
    } as RequestInit & { duplex: "half" });
    const j = await readJson(up);
    if (!up.ok || !j.id) return { executed: false, connector: "youtube", reason: `YouTube upload ${errText(j, up.status)}` };
    const id = String(j.id);
    const url = `https://youtu.be/${id}`;
    const got = ((j.status as { privacyStatus?: string } | undefined)?.privacyStatus) ?? privacy;
    return {
      executed: true, connector: "youtube",
      detail: `Uploaded to YouTube${got !== privacy ? ` — Google set it ${got} (unaudited API project); flip it in YouTube Studio` : ""}`,
      url, payloadPatch: { posted_url: url, youtube_video_id: id, youtube_privacy: got },
    };
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
  matches: (it) => (it.item_type === "video_script" || it.item_type === "image_brief") && platformOf(it) !== "linkedin",
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
// (a "script" app on the owner's Reddit account). Advised against (Reddit's
// Responsible Builder Policy bans automated promotion) — kept for the record.
const reddit: Connector = {
  id: "reddit",
  label: "Reply on Reddit",
  ready: () => !!(process.env.REDDIT_CLIENT_ID && process.env.REDDIT_CLIENT_SECRET && process.env.REDDIT_USERNAME && process.env.REDDIT_PASSWORD),
  matches: (it) => platformOf(it) === "reddit" && (it.item_type === "reply_draft" || it.item_type === "outreach_draft") && !!it.target_url,
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

// ── Instagram: answer someone who commented on our post or messaged us ───────
// The Instagram bot (lib/instagram-bot.ts) files these when it is switched off,
// when an answer is still a draft, or when Meta refused the automatic send.
// The owner's Approve sends the text as written (edits included):
//   ig_dm      → the card link, privately, to the commenter + a public reply
//   ig_reply   → a public reply under their comment
//   ig_message → a reply to their message (Instagram allows it for 24h)
// All three need an id that only exists because that person wrote to us first.
const IG_ENGAGE_KINDS = new Set(["ig_dm", "ig_reply", "ig_message"]);
const instagramEngage: Connector = {
  id: "instagram_engage",
  label: "Send on Instagram",
  ready: (c) => !!c.meta?.meta.ig_user_id,
  matches: (it) => IG_ENGAGE_KINDS.has(it.item_type),
  run: async (it, c) => {
    const token = c.meta!.access_token;
    const p = it.payload ?? {};
    const text = (it.content ?? "").trim();
    if (!text) return { executed: false, connector: "instagram_engage", reason: "nothing to send — write the reply first" };
    const commentId = typeof p.comment_id === "string" ? p.comment_id : null;
    const igsid = typeof p.igsid === "string" ? p.igsid : null;
    const sent =
      it.item_type === "ig_dm" && commentId ? await igPrivateReply(token, commentId, text)
      : it.item_type === "ig_reply" && commentId ? await igReplyToComment(token, commentId, text)
      : it.item_type === "ig_message" && igsid ? await igSendMessage(token, igsid, text)
      : null;
    if (!sent) return { executed: false, connector: "instagram_engage", reason: "this item has no comment or message to answer" };
    if (!sent.ok) return { executed: false, connector: "instagram_engage", reason: `Instagram: ${sent.error}` };
    if (it.item_type === "ig_dm" && commentId && typeof p.public_reply === "string") await igReplyToComment(token, commentId, p.public_reply).catch(() => null);
    if (typeof p.event_id === "string") {
      try { await getAdminSupabase().from("agent_ig_events").update({ status: "sent", reply: text, handled_at: new Date().toISOString() }).eq("id", p.event_id); } catch { /* the send already happened */ }
    }
    return { executed: true, connector: "instagram_engage", detail: it.item_type === "ig_reply" ? "Replied on Instagram" : "Sent on Instagram", url: it.target_url ?? undefined };
  },
};

// ── Facebook: answer the people who wrote to the Page ───────────────────────
// The Facebook bot's three kinds (lib/facebook-bot.ts), the mirror of the
// Instagram ones above:
//   fb_dm      → the card link, privately in Messenger, to someone who
//                commented the keyword (plus the short public reply)
//   fb_reply   → a public reply under their comment
//   fb_message → a reply to their Messenger message (allowed for 24h)
// All three need an id that only exists because that person wrote to us first.
const FB_ENGAGE_KINDS = new Set(["fb_dm", "fb_reply", "fb_message"]);
const facebookEngage: Connector = {
  id: "facebook_engage",
  label: "Send on Facebook",
  ready: (c) => !!c.meta?.meta.page_id,
  matches: (it) => FB_ENGAGE_KINDS.has(it.item_type),
  run: async (it, c) => {
    const token = c.meta!.access_token;
    const pageId = String(c.meta!.meta.page_id);
    const p = it.payload ?? {};
    const text = (it.content ?? "").trim();
    if (!text) return { executed: false, connector: "facebook_engage", reason: "nothing to send — write the reply first" };
    const commentId = typeof p.comment_id === "string" ? p.comment_id : null;
    // The shared decisions file the sender's id under the Instagram bot's name for it.
    const psid = typeof p.igsid === "string" ? p.igsid : null;
    const sent =
      it.item_type === "fb_dm" && commentId ? await fbPrivateReply(token, pageId, commentId, text)
      : it.item_type === "fb_reply" && commentId ? await fbReplyToComment(token, commentId, text)
      : it.item_type === "fb_message" && psid ? await fbSendMessage(token, pageId, psid, text)
      : null;
    if (!sent) return { executed: false, connector: "facebook_engage", reason: "this item has no comment or message to answer" };
    if (!sent.ok) return { executed: false, connector: "facebook_engage", reason: `Facebook: ${sent.error}` };
    if (it.item_type === "fb_dm" && commentId && typeof p.public_reply === "string") await fbReplyToComment(token, commentId, p.public_reply).catch(() => null);
    if (typeof p.event_id === "string") {
      try { await getAdminSupabase().from("agent_fb_events").update({ status: "sent", reply: text, handled_at: new Date().toISOString() }).eq("id", p.event_id); } catch { /* the send already happened */ }
    }
    return { executed: true, connector: "facebook_engage", detail: it.item_type === "fb_reply" ? "Replied on Facebook" : "Sent on Facebook", url: it.target_url ?? undefined };
  },
};

const CONNECTORS: Connector[] = [linkedin, x, facebook, instagram, instagramEngage, facebookEngage, youtube, higgsfield, reddit];

/** Which connectors are armed (for the board payload / Connections panel). */
export function connectorStatus(conns: ConnectionMap): Record<string, boolean> {
  return Object.fromEntries(CONNECTORS.map((c) => [c.id, c.ready(conns)]));
}

/** Execute one owner-approved item. Never throws. */
export async function executeItem(it: QueueItemLite): Promise<ExecOutcome> {
  const c = CONNECTORS.find((c) => c.matches(it));
  if (!c) return { executed: false, reason: "no connector for this platform" };
  const conns = await loadConnections();
  if (!c.ready(conns)) return { executed: false, connector: c.id, reason: `${c.id} is not connected yet` };
  try {
    return await c.run(it, conns);
  } catch (e) {
    return { executed: false, connector: c.id, reason: String(e).slice(0, 200) };
  }
}
