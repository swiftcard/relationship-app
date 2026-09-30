// The LinkedIn profile photo, as large and as sharp as we can get it.
//
// "Sign in with LinkedIn" hands back ONE picture URL, and it is usually the
// 100×100 thumbnail (…/profile-displayphoto-shrink_100_100/…). Every import
// used to store that as-is — never enlarged — so the headshot on a card, which
// is drawn far bigger, came out soft (owner, 2026-09-30: "extremely blurry").
//
// Two things happen here, in order:
//   1. Ask LinkedIn's CDN for the larger renditions of the SAME photo first
//      (800, then 400, then 200). The URL carries a signature, so a size swap
//      is not guaranteed to be honoured — when it is refused we fall back to
//      the URL we were given.
//   2. If what we end up with is still small, enhance it ourselves: a
//      Lanczos upscale to 400px plus a light sharpen. That cannot invent
//      detail a 100px file never had, but it is visibly better than the
//      browser stretching the thumbnail, and it is the honest best available.
//
// Both LinkedIn import paths (the signed-in "Use this photo" and the guest
// one-shot in the OAuth callback) call this, so they can never disagree.

const SHRINK_RE = /profile-displayphoto-shrink_(\d+)_(\d+)/;
const LARGER_SIZES = [800, 400, 200];
/** Below this width the photo is treated as a thumbnail and enhanced. */
export const SMALL_PHOTO_PX = 300;

export type LinkedInPhoto = {
  /** JPEG bytes, ready to store. */
  body: Buffer;
  /** Width of the source we ended up with, BEFORE any enhancement. */
  sourceWidth: number;
  /** True when the best LinkedIn would give us was a thumbnail. */
  wasSmall: boolean;
};

/** The URLs to try, largest first, ending with the original. */
export function linkedInPhotoCandidates(pictureUrl: string): string[] {
  const m = SHRINK_RE.exec(pictureUrl);
  if (!m) return [pictureUrl];
  const current = Number(m[1]);
  const bigger = LARGER_SIZES.filter((s) => s > current).map((s) =>
    pictureUrl.replace(SHRINK_RE, `profile-displayphoto-shrink_${s}_${s}`),
  );
  return [...bigger, pictureUrl];
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
export async function fetchLinkedInPhoto(pictureUrl: string, opts?: { timeoutMs?: number }): Promise<LinkedInPhoto | null> {
  const timeoutMs = opts?.timeoutMs ?? 8000;
  let bytes: Buffer | null = null;
  for (const url of linkedInPhotoCandidates(pictureUrl)) {
    bytes = await fetchImage(url, timeoutMs);
    if (bytes) break;
  }
  if (!bytes) return null;

  const sharp = (await import("sharp")).default;
  const src = sharp(bytes).rotate();
  const meta = await src.metadata();
  const sourceWidth = meta.width ?? 0;
  const wasSmall = sourceWidth > 0 && sourceWidth < SMALL_PHOTO_PX;

  const body = wasSmall
    ? await src
        .resize(400, 400, { fit: "inside", kernel: "lanczos3" })
        .sharpen({ sigma: 0.8, m1: 0.6, m2: 1.2 })
        .jpeg({ quality: 88 })
        .toBuffer()
    : await src.resize(1000, 1000, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();

  return { body, sourceWidth, wasSmall };
}
