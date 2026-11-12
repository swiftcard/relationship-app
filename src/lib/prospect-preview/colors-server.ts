import { fetchVCardPhoto } from "@/lib/contact-photo";
import { safeFetch } from "@/lib/safe-fetch";
import { pickBrandColors, themeColorIn, type BrandColors } from "./colors";

// ── Card Builder: fetch a logo or a site and read its colours ───────────────
// SERVER ONLY. Both addresses are typed in by staff, but they are fetched from
// our servers, so both go through the SSRF-safe fetcher like every other
// address the app is handed (lib/safe-fetch).

export type PulledColors = BrandColors & { from: "logo" | "site"; url: string };

async function fromLogo(url: string): Promise<BrandColors | null> {
  try {
    const got = await fetchVCardPhoto(url, "logo");
    if (!got) return null;
    const sharp = (await import("sharp")).default;
    const { data } = await sharp(Buffer.from(got.base64, "base64")).resize(64, 64, { fit: "inside" }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    return pickBrandColors(data);
  } catch {
    return null;
  }
}

async function fromSite(url: string): Promise<BrandColors | null> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6000);
    const res = await safeFetch(url, { signal: ctrl.signal, headers: { accept: "text/html" } }).finally(() => clearTimeout(timer));
    if (!res.ok || !(res.headers.get("content-type") ?? "").includes("html")) return null;
    // The <head> is all this needs; a site's first 200KB always holds it.
    const html = (await res.text()).slice(0, 200_000);
    const primary = themeColorIn(html);
    return primary ? { primary, secondary: "#FFFFFF" } : null;
  } catch {
    return null;
  }
}

/** The logo first (it IS the brand); the site's own theme colour when there is no logo to read. */
export async function pullBrandColors(p: { logo_url: string | null; website: string | null }): Promise<PulledColors | null> {
  if (p.logo_url) {
    const c = await fromLogo(p.logo_url);
    if (c) return { ...c, from: "logo", url: p.logo_url };
  }
  if (p.website) {
    const c = await fromSite(p.website);
    if (c) return { ...c, from: "site", url: p.website };
  }
  return null;
}
