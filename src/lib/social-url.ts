// Last-resort escape so a stored value with stray whitespace still yields a
// VALID absolute URL. Deliberately narrower than encodeURI, which would
// double-encode already-%-encoded values (…%20… → …%2520…).
function escapeSpaces(url: string): string {
  return url.replace(/\s/g, "%20");
}

// Build a valid profile URL from whatever was stored: a full URL, a platform URL
// (e.g. "instagram.com/x"), an "@handle", or a bare handle.
/** Networks whose handles are one word: a space is never valid in them. */
const HANDLE_ONLY = new Set(["instagram", "twitter", "tiktok", "snapchat", "youtube"]);

export function socialUrl(platform: string, raw?: string | null): string | null {
  if (!raw) return null;
  const v = raw.trim();
  if (!v) return null;
  if (/^https?:\/\//i.test(v)) return escapeSpaces(v);

  const lower = v.toLowerCase();
  const domain: Record<string, string> = {
    linkedin: "linkedin.com",
    instagram: "instagram.com",
    twitter: "x.com",
    tiktok: "tiktok.com",
    facebook: "facebook.com",
    snapchat: "snapchat.com",
    youtube: "youtube.com",
  };
  if ((domain[platform] && lower.includes(domain[platform])) || (platform === "twitter" && lower.includes("twitter.com"))) {
    return escapeSpaces(`https://${v.replace(/^\/+/, "")}`);
  }

  let handle = v.replace(/^@+/, "").trim();
  // Strip a leading slash before anything else. Selecting the PATH out of the
  // address bar — "/in/johndoe" instead of "linkedin.com/in/johndoe" — is an
  // ordinary way to copy "your LinkedIn", and it contains neither "://" nor a
  // dot, so normalizeSocial stores it untouched. The switch below then pastes
  // it after its own prefix and built https://linkedin.com/in//in/johndoe: a
  // button that looks correct in the editor and 404s for every visitor.
  handle = handle.replace(/^\/+/, "");
  // The site name typed without its ".com" ("linkedin/in/johndoe") lands the
  // same way. Drop a leading platform-name segment so what follows is the
  // handle the rules below expect.
  handle = handle.replace(new RegExp(`^${platform}/+`, "i"), "");
  if (!handle) return null;
  // A spaced value is a person's/page's NAME, not a handle. LinkedIn (and
  // Facebook) default handles are the hyphenated name — "John Doe" →
  // "john-doe" — which at worst lands on the right profile and at best is
  // exactly it. A raw space would produce an invalid URL that opens nothing.
  if (/\s/.test(handle) && (platform === "linkedin" || platform === "facebook")) {
    handle = handle.toLowerCase().replace(/\s+/g, "-");
  }
  // Instagram, X, TikTok, Snapchat and YouTube handles can never contain a
  // space, so a spaced value ("Sam Builder") built a link that opens nothing.
  // Closing the gap gives the likeliest handle and at least a valid URL
  // (2026-09-22 signup review). Here, at render, so stored rows are covered.
  if (/\s/.test(handle) && HANDLE_ONLY.has(platform)) handle = handle.replace(/\s+/g, "");

  switch (platform) {
    case "linkedin":
      if (/^(in|company|pub|school)\//i.test(handle)) return escapeSpaces(`https://linkedin.com/${handle}`);
      return escapeSpaces(`https://linkedin.com/in/${handle}`);
    case "instagram": return escapeSpaces(`https://instagram.com/${handle}`);
    case "twitter":   return escapeSpaces(`https://x.com/${handle}`);
    case "tiktok":    return escapeSpaces(`https://tiktok.com/@${handle}`);
    case "facebook":  return escapeSpaces(`https://facebook.com/${handle}`);
    case "snapchat":  return escapeSpaces(`https://snapchat.com/add/${handle}`);
    case "youtube":
      // The box shows "youtube.com/@", which invites typing the rest of an
      // older channel address — "c/Name", "channel/UC…", "user/…". Those are
      // paths, not @handles: youtube.com/@channel/UC… is a 404.
      if (/^(c|channel|user)\//i.test(handle)) return escapeSpaces(`https://youtube.com/${handle}`);
      return escapeSpaces(`https://youtube.com/@${handle}`);
    case "website":   return /\.[a-z]{2,}/i.test(handle) ? escapeSpaces(`https://${handle.replace(/^\/+/, "")}`) : null;
    default:          return escapeSpaces(`https://${handle}`);
  }
}

export function handleLabel(raw?: string | null): string {
  return (raw || "").trim().replace(/^https?:\/\//i, "");
}

// Turn whatever the user types (a URL, an @handle, or a bare handle) into a clean,
// linkable value so the card connects to the right account. Shared by the new-card
// wizard and the edit form so both behave identically.
export function normalizeSocial(raw: string, platform: string): string {
  const v = raw.trim();
  if (!v) return "";
  const urlLike = platform === "linkedin" || platform === "youtube" || platform === "facebook";
  try {
    if (v.includes("://") || v.includes(".")) {
      // URL() encodes stray spaces in the path (…/in/John Doe → John%20Doe),
      // so a pasted profile URL always normalizes to something linkable.
      const url = new URL(v.includes("://") ? v : `https://${v}`);
      const parts = url.pathname.split("/").filter(Boolean);
      if (platform === "linkedin") return parts.length ? `linkedin.com/${parts.join("/")}` : v;
      if (platform === "youtube") return parts.length ? `youtube.com/${parts.join("/")}` : v;
      if (platform === "facebook") return parts.length ? `facebook.com/${parts.join("/")}` : v;
      const handle = parts[parts.length - 1]?.replace(/^@/, "");
      if (handle) return `@${handle}`;
    }
  } catch {
    /* not a URL — fall through */
  }
  if (urlLike) {
    // No dot, so this is a name or bare handle. A spaced name ("John Doe")
    // can never be linked as-is — store the platform's hyphenated-handle
    // convention instead so the built URL actually resolves.
    if (/\s/.test(v) && (platform === "linkedin" || platform === "facebook")) {
      const slug = v.toLowerCase().replace(/\s+/g, "-");
      return platform === "linkedin" ? `linkedin.com/in/${slug}` : `facebook.com/${slug}`;
    }
    return v;
  }
  // One-word handle networks: close any spaces up (see socialUrl).
  return `@${v.replace(/^@/, "").replace(/\s+/g, "")}`;
}

/**
 * The destination a social field will actually open, written the way a person
 * reads a link (no scheme). `null` when the value cannot produce a link at all.
 *
 * WHY THIS EXISTS: the editor showed an "Open link" button but never said WHERE
 * it went, so the only way to discover that a handle was wrong was to click
 * through to a 404 — which nobody does while filling in a form. Reported
 * 2026-09-08 as "LinkedIn isn't working for some users": the link had been
 * built from a value that looked fine in the box. Printing the resolved
 * destination under the field makes a wrong entry visible at the moment it is
 * typed, and it also exposes the GUESSES — "John Doe" quietly becomes
 * linkedin.com/in/john-doe, which is right often enough to ship and wrong often
 * enough that the owner should see it.
 */
export function socialDestination(platform: string, raw?: string | null): string | null {
  const url = socialUrl(platform, raw);
  return url ? url.replace(/^https?:\/\//i, "") : null;
}

// For these URL-style networks, show the exact format to copy so the link works.
export type ConnectLink = { label: string; href: string; sub?: string; color: string; textColor?: string };

// Socials in the canonical order: Website, LinkedIn, Instagram, TikTok, Facebook, X, Snapchat, YouTube.
export function buildConnectLinks(s: {
  website?: string | null;
  linkedin?: string | null;
  instagram?: string | null;
  tiktok?: string | null;
  facebook?: string | null;
  twitter?: string | null;
  snapchat?: string | null;
  youtube?: string | null;
}): ConnectLink[] {
  return [
    { label: "Website",     href: socialUrl("website", s.website),     sub: handleLabel(s.website),     color: "#1D4ED8" },
    { label: "LinkedIn",    href: socialUrl("linkedin", s.linkedin),   sub: handleLabel(s.linkedin),    color: "#0A66C2" },
    { label: "Instagram",   href: socialUrl("instagram", s.instagram), sub: handleLabel(s.instagram),   color: "#E1306C" },
    { label: "TikTok",      href: socialUrl("tiktok", s.tiktok),       sub: handleLabel(s.tiktok),      color: "#010101" },
    { label: "Facebook",    href: socialUrl("facebook", s.facebook),   sub: handleLabel(s.facebook),    color: "#1877F2" },
    { label: "X / Twitter", href: socialUrl("twitter", s.twitter),     sub: handleLabel(s.twitter),     color: "#000000" },
    { label: "Snapchat",    href: socialUrl("snapchat", s.snapchat),   sub: handleLabel(s.snapchat),    color: "#FFCA28", textColor: "#1a1a00" },
    { label: "YouTube",     href: socialUrl("youtube", s.youtube),     sub: handleLabel(s.youtube),     color: "#FF0000" },
  ].filter((l) => l.href) as ConnectLink[];
}
