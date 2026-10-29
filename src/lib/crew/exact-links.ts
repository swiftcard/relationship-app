import type { Platform } from "./types";

// ── Exact links ─────────────────────────────────────────────────────────────
// Every row in the Sheet ends with a link the owner taps to land exactly where
// the message goes: the Reddit comment or thread to reply to, the Threads
// post, the Quora question, the LinkedIn post, the Hacker News comment. A
// subreddit's front page, a search page, a hashtag page or a profile where a
// post was promised is not an exact link, so a found item without one never
// becomes a row (replies/engine.ts drops it). Pure, so tests pin each shape.

const clean = (u: URL) => {
  u.hash = "";
  for (const k of [...u.searchParams.keys()]) if (/^(utm_|ref|share|igsh|igshid|rdt|context|sort)/i.test(k)) u.searchParams.delete(k);
  return u;
};

function parse(raw: string): URL | null {
  try {
    const u = new URL(raw.trim());
    return u.protocol === "https:" || u.protocol === "http:" ? u : null;
  } catch {
    return null;
  }
}

/** The exact post (or comment) a reply goes under, normalized; null when the link isn't one. */
export function exactPostLink(platform: Platform, raw: string | null | undefined): string | null {
  if (!raw) return null;
  const u = parse(raw);
  if (!u) return null;
  const host = u.hostname.replace(/^(www|old|m|new|np)\./, "");
  const path = u.pathname.replace(/\/+$/, "");
  switch (platform) {
    case "reddit": {
      // /r/<sub>/comments/<post>[/<slug>[/<comment>]]
      const m = /^\/r\/([A-Za-z0-9_]+)\/comments\/([a-z0-9]+)(?:\/([^/]*)(?:\/([a-z0-9]+))?)?$/i.exec(path);
      if (host !== "reddit.com" || !m) return null;
      return `https://www.reddit.com/r/${m[1]}/comments/${m[2]}/${m[3] || "_"}/${m[4] ? `${m[4]}/` : ""}`;
    }
    case "threads": {
      const m = /^\/@([\w.]+)\/post\/([\w-]+)$/.exec(path);
      return (host === "threads.com" || host === "threads.net") && m ? `https://www.threads.com/@${m[1]}/post/${m[2]}` : null;
    }
    case "quora": {
      if (host !== "quora.com") return null;
      // A question, or an answer on it: the owner answers the question.
      const seg = path.split("/").filter(Boolean);
      if (!seg.length || /^(profile|topic|search|spaces|q|unanswered|answer|about|careers|settings|notifications)$/i.test(seg[0])) return null;
      if (seg.length === 1 || (seg.length === 3 && seg[1] === "answer")) return /-/.test(seg[0]) ? `https://www.quora.com/${seg[0]}` : null;
      return null;
    }
    case "indiehackers": {
      const m = /^\/(post|forum\/[\w-]+|product\/[\w-]+\/[\w-]+)\/[\w-]+$/.exec(path);
      return host === "indiehackers.com" && m ? `https://www.indiehackers.com${path}` : null;
    }
    case "linkedin": {
      if (host !== "linkedin.com") return null;
      if (/^\/posts\/[\w%.-]+$/.test(path) || /^\/feed\/update\/urn:li:(activity|share|ugcPost):\d+$/.test(path)) return `https://www.linkedin.com${path}/`;
      return null;
    }
    case "instagram": {
      const m = /^\/(?:[\w.]+\/)?(p|reel|reels)\/([\w-]+)$/.exec(path);
      return host === "instagram.com" && m ? `https://www.instagram.com/${m[1] === "reels" ? "reel" : m[1]}/${m[2]}/` : null;
    }
    case "bluesky": {
      const m = /^\/profile\/([\w.:-]+)\/post\/([a-z0-9]+)$/i.exec(path);
      return host === "bsky.app" && m ? `https://bsky.app/profile/${m[1]}/post/${m[2]}` : null;
    }
    case "facebook": {
      if (host !== "facebook.com") return null;
      return /\/(posts|permalink|story\.php|groups\/[\w.]+\/posts|groups\/[\w.]+\/permalink)/.test(path) || u.searchParams.has("story_fbid") ? clean(u).toString() : null;
    }
    case "hackernews": {
      const id = u.searchParams.get("id");
      return host === "news.ycombinator.com" && path === "/item" && id && /^\d+$/.test(id) ? `https://news.ycombinator.com/item?id=${id}` : null;
    }
    case "x": {
      const m = /^\/(\w{1,15})\/status\/(\d+)$/.exec(path);
      return (host === "x.com" || host === "twitter.com" || host === "mobile.twitter.com") && m ? `https://x.com/${m[1]}/status/${m[2]}` : null;
    }
    case "tiktok": {
      const m = /^\/@([\w.]{2,24})\/(video|photo)\/(\d+)$/.exec(path);
      return host === "tiktok.com" && m ? `https://www.tiktok.com/@${m[1]}/${m[2]}/${m[3]}` : null;
    }
    default:
      return null;
  }
}

const X_RESERVED = /^(home|explore|search|i|messages|settings|notifications|compose|login|signup|tos|privacy|hashtag|intent|share)$/i;

const IG_RESERVED = /^(p|reel|reels|explore|stories|accounts|about|developer|legal|direct|tv|tags|locations|web)$/i;

/** A person's own profile page, normalized; null when the link isn't one. */
export function exactProfileLink(platform: Platform, raw: string | null | undefined): string | null {
  if (!raw) return null;
  const u = parse(raw);
  if (!u) return null;
  const host = u.hostname.replace(/^(www|m)\./, "");
  const path = u.pathname.replace(/\/+$/, "");
  switch (platform) {
    case "instagram": {
      const m = /^\/([\w.]{1,30})$/.exec(path);
      return host === "instagram.com" && m && !IG_RESERVED.test(m[1]) ? `https://www.instagram.com/${m[1].toLowerCase()}/` : null;
    }
    case "linkedin": {
      const m = /^\/in\/([\w%.-]+)$/.exec(path);
      return host === "linkedin.com" && m ? `https://www.linkedin.com/in/${m[1]}/` : null;
    }
    case "x": {
      const m = /^\/(\w{1,15})$/.exec(path);
      return (host === "x.com" || host === "twitter.com" || host === "mobile.twitter.com") && m && !X_RESERVED.test(m[1]) ? `https://x.com/${m[1]}` : null;
    }
    case "tiktok": {
      const m = /^\/@([\w.]{2,24})$/.exec(path);
      return host === "tiktok.com" && m ? `https://www.tiktok.com/@${m[1]}` : null;
    }
    case "alignable": {
      return host === "alignable.com" && path.split("/").filter(Boolean).length >= 1 && !/^\/(search|biz\/search|forum)/.test(path) ? `https://www.alignable.com${path}` : null;
    }
    default:
      return null;
  }
}

/** Instagram handle from a profile link or "@name". */
export function instagramHandle(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const fromUrl = exactProfileLink("instagram", raw);
  const h = (fromUrl ? fromUrl.split("/")[3] : raw.trim().replace(/^@/, "")).toLowerCase();
  return /^[\w.]{1,30}$/.test(h) && !IG_RESERVED.test(h) ? h : null;
}

/** Opens a direct-message thread with this Instagram account in the Instagram app (Meta's ig.me link). */
export function instagramDmLink(handle: string): string {
  return `https://ig.me/m/${handle}`;
}

/** Opens Reddit's private-message screen addressed to this user, with the message already typed in when one is given. */
export function redditMessageLink(username: string, message?: string): string {
  const to = encodeURIComponent(username.replace(/^\/?u\//i, ""));
  return `https://www.reddit.com/message/compose/?to=${to}${message ? `&message=${encodeURIComponent(message)}` : ""}`;
}

/** The account a post on X or TikTok belongs to, from the post's own link. */
export function handleFromPost(platform: "x" | "tiktok", raw: string | null | undefined): string | null {
  const post = exactPostLink(platform, raw);
  if (!post) return null;
  const m = platform === "x" ? /^https:\/\/x\.com\/(\w+)\/status\//.exec(post) : /^https:\/\/www\.tiktok\.com\/@([\w.]+)\//.exec(post);
  return m ? m[1] : null;
}

/** The account a profile link on X or TikTok is. */
export function handleFromProfile(platform: "x" | "tiktok", raw: string | null | undefined): string | null {
  const prof = exactProfileLink(platform, raw);
  if (!prof) return null;
  const m = platform === "x" ? /^https:\/\/x\.com\/(\w+)$/.exec(prof) : /^https:\/\/www\.tiktok\.com\/@([\w.]+)$/.exec(prof);
  return m ? m[1] : null;
}

/** A new email to this address with the subject and the message already in it (the mail app opens on tap). */
export function emailComposeLink(email: string, message: string): string | null {
  const to = email.trim();
  if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(to)) return null;
  // Email drafts start with "Subject: …" on their first line.
  const m = /^subject:[ \t]*(.+)\n+/i.exec(message);
  const subject = m ? m[1].trim() : "";
  const body = (m ? message.slice(m[0].length) : message).trim();
  return `mailto:${to}?${[subject ? `subject=${encodeURIComponent(subject)}` : "", `body=${encodeURIComponent(body)}`].filter(Boolean).join("&")}`;
}
