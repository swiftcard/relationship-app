// The LinkedIn profile photo, as large and as sharp as we can get it.
//
// "Sign in with LinkedIn" hands back ONE picture URL, and it is usually the
// 100×100 thumbnail (…/profile-displayphoto-shrink_100_100/…). Every import
// used to store that as-is — never enlarged — so the headshot on a card, which
// is drawn far bigger, came out soft (owner, 2026-09-30: "extremely blurry").
//
// Owner, 2026-10-20, again: "a very blurry image". Every stored import was the
// thumbnail blown up to 400px: the size swap below only replaced the FIRST
// "shrink_100_100" in the URL, and LinkedIn's photo URLs carry it twice
// (…/profile-displayphoto-shrink_100_100/profile-displayphoto-shrink_100_100/0/…),
// so each larger request asked for a path that doesn't exist and the thumbnail
// was all that ever came back.
//
// So, in order, stopping at the first that downloads as an image:
//   1. LinkedIn's own list of this photo's sizes (/v2/me, playableStreams),
//      read with the access token the import already holds. Each URL there is
//      signed by LinkedIn, so the 800px one is real. Skipped when the token's
//      scope doesn't allow the call.
//   2. The userinfo URL with EVERY size segment swapped (800, then 400, 200).
//   3. The userinfo URL as given.
// If the best of those is still small, it is enhanced: a Lanczos upscale to
// 400px plus a light sharpen. That cannot invent detail a 100px file never
// had, but it is visibly better than the browser stretching the thumbnail.
//
// Both LinkedIn import paths (the signed-in "Use this photo" and the one-shot
// in the OAuth callback) call this, so they can never disagree.

import { safeFetch } from "@/lib/safe-fetch";

const SHRINK_RE = /profile-displayphoto-shrink_(\d+)_(\d+)/;
const SHRINK_ALL_RE = /profile-displayphoto-shrink_\d+_\d+/g;
const LARGER_SIZES = [800, 400, 200];
/** Below this width the photo is treated as a thumbnail and enhanced. */
export const SMALL_PHOTO_PX = 300;

/** Every size of the member's photo, from the token holder's own profile. */
export const LINKEDIN_PHOTO_SIZES_URL =
  "https://api.linkedin.com/v2/me?projection=(id,profilePicture(displayImage~:playableStreams))";

export type LinkedInPhoto = {
  /** JPEG bytes, ready to store. */
  body: Buffer;
  /** Width of the source we ended up with, BEFORE any enhancement. */
  sourceWidth: number;
  /** True when the best LinkedIn would give us was a thumbnail. */
  wasSmall: boolean;
  /** Which of the three routes above the photo came from. */
  source: "api" | "swap" | "original";
};

/** The URLs to try, largest first, ending with the original. */
export function linkedInPhotoCandidates(pictureUrl: string): string[] {
  const m = SHRINK_RE.exec(pictureUrl);
  if (!m) return [pictureUrl];
  const current = Number(m[1]);
  const bigger = LARGER_SIZES.filter((s) => s > current).map((s) =>
    pictureUrl.replace(SHRINK_ALL_RE, `profile-displayphoto-shrink_${s}_${s}`),
  );
  return [...bigger, pictureUrl];
}

type StillImage = { storageSize?: { width?: number } };
type PhotoSizesResponse = {
  profilePicture?: {
    "displayImage~"?: {
      elements?: {
        data?: { "com.linkedin.digitalmedia.mediaartifact.StillImage"?: StillImage };
        identifiers?: { identifier?: unknown }[];
      }[];
    };
  };
};

/** The https URLs in a /v2/me playableStreams response, largest first. */
export function linkedInPhotoSizes(body: unknown): string[] {
  const elements = (body as PhotoSizesResponse | null)?.profilePicture?.["displayImage~"]?.elements;
  if (!Array.isArray(elements)) return [];
  return elements
    .map((e) => ({
      width: e?.data?.["com.linkedin.digitalmedia.mediaartifact.StillImage"]?.storageSize?.width ?? 0,
      url: e?.identifiers?.[0]?.identifier,
    }))
    .filter((e): e is { width: number; url: string } => typeof e.url === "string" && /^https:\/\//i.test(e.url))
    .sort((a, b) => b.width - a.width)
    .map((e) => e.url);
}

async function photoSizesFromApi(accessToken: string, timeoutMs: number): Promise<string[]> {
  try {
    const res = await safeFetch(LINKEDIN_PHOTO_SIZES_URL, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return [];
    return linkedInPhotoSizes(await res.json());
  } catch {
    return [];
  }
}

async function fetchImage(url: string, timeoutMs: number): Promise<Buffer | null> {
  try {
    const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.startsWith("image/")) return null;
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > 5 * 1024 * 1024) return null;
    return bytes;
  } catch {
    return null;
  }
}

/**
 * Download the best rendition of a LinkedIn picture and re-encode it as a
 * JPEG the way every other photo import does. Returns null when nothing
 * usable could be fetched.
 */
export async function fetchLinkedInPhoto(
  pictureUrl: string,
  opts?: { accessToken?: string; timeoutMs?: number },
): Promise<LinkedInPhoto | null> {
  const timeoutMs = opts?.timeoutMs ?? 8000;
  const candidates = linkedInPhotoCandidates(pictureUrl);
  const tries: { url: string; source: LinkedInPhoto["source"] }[] = [
    ...(opts?.accessToken ? await photoSizesFromApi(opts.accessToken, 5000) : []).map((url) => ({ url, source: "api" as const })),
    ...candidates.slice(0, -1).map((url) => ({ url, source: "swap" as const })),
    { url: pictureUrl, source: "original" as const },
  ];

  let bytes: Buffer | null = null;
  let source: LinkedInPhoto["source"] = "original";
  for (const t of tries) {
    bytes = await fetchImage(t.url, timeoutMs);
    if (bytes) {
      source = t.source;
      break;
    }
  }
  if (!bytes) return null;

  const sharp = (await import("sharp")).default;
  const src = sharp(bytes).rotate();
  const meta = await src.metadata();
  const sourceWidth = meta.width ?? 0;
  const wasSmall = sourceWidth > 0 && sourceWidth < SMALL_PHOTO_PX;
  // Which route won and how big it was — no URL (they carry signatures) and
  // nothing about the person, so a "blurry" report can be read off the logs.
  console.info(`[linkedin/photo] source=${source} width=${sourceWidth}`);

  const body = wasSmall
    ? await src
        .resize(400, 400, { fit: "inside", kernel: "lanczos3" })
        .sharpen({ sigma: 0.8, m1: 0.6, m2: 1.2 })
        .jpeg({ quality: 88 })
        .toBuffer()
    : await src.resize(1000, 1000, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();

  return { body, sourceWidth, wasSmall, source };
}
