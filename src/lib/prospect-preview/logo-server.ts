import { fetchVCardPhoto } from "@/lib/contact-photo";

// ── Card Builder: a logo with room around it ────────────────────────────────
// SERVER ONLY. A logo file taken from a prospect's site is almost always cut
// tight to the artwork (or carries a lopsided border of its own), and the
// card's logo tile clips to the file's edges: the wordmark ends up touching
// them (owner, 2026-11-12: "fix the logo padding"). The card templates are
// shared with every customer's card, so the fix is to the FILE, not to them:
// trim whatever border the file came with, then add an even margin in the
// file's own background colour (or leave it clear, when the logo is
// transparent, so it still sits on any card colour).
//
// Fetched through the SSRF-safe fetcher, like every other address the server
// is handed (lib/contact-photo).

/** The margin on every side, as a share of the artwork's shorter edge. */
export const LOGO_MARGIN = 0.18;

export type PaddedLogo = { png: Buffer; width: number; height: number };

export async function padLogoBytes(bytes: Buffer): Promise<PaddedLogo | null> {
  try {
    const sharp = (await import("sharp")).default;
    const src = sharp(bytes).ensureAlpha();
    const { data, info } = await src.clone().raw().toBuffer({ resolveWithObject: true });
    if (!info.width || !info.height) return null;
    // The file's ground is its top-left pixel: what trim() measures against too.
    const [r, g, b, a] = [data[0], data[1], data[2], data[3]];
    const clear = a < 16;
    const background = clear ? { r: 0, g: 0, b: 0, alpha: 0 } : { r, g, b, alpha: 1 };

    // A file that is one flat colour has nothing to trim to; keep it whole.
    let art = await src.clone().png().toBuffer({ resolveWithObject: true });
    try {
      const trimmed = await src.clone().trim({ threshold: 12 }).png().toBuffer({ resolveWithObject: true });
      if (trimmed.info.width >= 8 && trimmed.info.height >= 8) art = trimmed;
    } catch { /* nothing to trim */ }

    const pad = Math.max(6, Math.round(Math.min(art.info.width, art.info.height) * LOGO_MARGIN));
    const out = await sharp(art.data).extend({ top: pad, bottom: pad, left: pad, right: pad, background }).png().toBuffer({ resolveWithObject: true });
    return { png: out.data, width: out.info.width, height: out.info.height };
  } catch {
    return null;
  }
}

export async function paddedLogo(url: string | null): Promise<PaddedLogo | null> {
  if (!url || !/^https:\/\//.test(url)) return null;
  const got = await fetchVCardPhoto(url, "logo").catch(() => null);
  return got ? padLogoBytes(Buffer.from(got.base64, "base64")) : null;
}

/**
 * The answer both logo routes give: the padded PNG, or, when the file can't
 * be read here, a redirect to the file itself so the card still has its logo.
 */
export async function logoResponse(url: string | null): Promise<Response> {
  if (!url || !/^https:\/\//.test(url)) return new Response(null, { status: 404 });
  const padded = await paddedLogo(url);
  if (!padded) return new Response(null, { status: 302, headers: { Location: url, "Cache-Control": "no-store" } });
  return new Response(new Uint8Array(padded.png), {
    headers: {
      "Content-Type": "image/png",
      // The address carries ?v=<hash of the logo's address>, so it can be kept.
      "Cache-Control": "public, max-age=3600, s-maxage=86400",
      "X-Robots-Tag": "noindex",
    },
  });
}
