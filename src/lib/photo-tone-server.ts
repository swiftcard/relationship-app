import { unstable_cache } from "next/cache";
import { PHOTO_TONE_SAMPLE, toneFromPixels } from "@/lib/photo-tone";

// The server half of "Photo match" (lib/photo-tone): the colour of a header
// photo, read on the server so the public page renders in its matched colour
// on the very first paint — no flash of the fallback colour while a browser
// works it out.
//
// Cached per photo URL. A new photo is a new URL (api/upload time-stamps every
// object key),
// so a cached colour never outlives its picture in practice; the daily
// revalidate is there for the rare failure, which is cached as "no colour"
// and must not stick for longer than that.

const MAX_BYTES = 8 * 1024 * 1024;
/** A page must never wait long on its own photo: past this it renders in the
 *  fallback colour and the next view tries again. */
const TIMEOUT_MS = 2500;

async function readTone(url: string): Promise<string | null> {
  if (!/^https:\/\//.test(url)) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    // safeFetch: the URL is owner-written (a custom header photo can be any
    // https address), so the same SSRF guard the image proxy uses applies.
    const { safeFetch } = await import("@/lib/safe-fetch");
    const res = await safeFetch(url, { signal: ctrl.signal, headers: { "User-Agent": "Mozilla/5.0 (compatible; SwiftCard/1.0)" } });
    if (!res.ok) return null;
    if (Number(res.headers.get("content-length") || 0) > MAX_BYTES) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength > MAX_BYTES) return null;
    const sharp = (await import("sharp")).default;
    // Centre square, cover-cropped — the crop the cover hero shows.
    const { data, info } = await sharp(buf)
      .rotate()
      .resize(PHOTO_TONE_SAMPLE, PHOTO_TONE_SAMPLE, { fit: "cover", position: "centre" })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    return toneFromPixels(data, info.width, info.height);
  } finally {
    clearTimeout(timer);
  }
}

const cachedTone = unstable_cache(
  async (url: string): Promise<{ tone: string | null }> => {
    try {
      return { tone: await readTone(url) };
    } catch {
      return { tone: null };
    }
  },
  ["photo-tone-v1"],
  { revalidate: 86400 },
);

/** The header photo's colour as #RRGGBB, or null. Never throws. */
export async function getPhotoTone(url: string | null | undefined): Promise<string | null> {
  if (!url || !/^https:\/\//.test(url)) return null;
  try {
    return (await cachedTone(url)).tone;
  } catch {
    return null;
  }
}
