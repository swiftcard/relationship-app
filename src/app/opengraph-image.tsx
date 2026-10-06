import { ImageResponse } from "next/og";
import { BrandOg, loadBrandOgInputs } from "@/lib/brand-og";

// Site-wide link-preview image (1200×630) for the homepage and every marketing
// page. Per-card pages keep their own dynamic card/[username]/opengraph-image
// (a picture of the real card) and fall back to this same picture when the
// card can't be shown. The design lives in lib/brand-og so both stay identical.
//
// No dynamic data → Next prerenders it once at build time, so the asset reads
// and the Google Fonts fetch cost nothing per share.
export const alt = "SwiftCard: The digital business card that shares everything";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function OG() {
  const { fonts, ...inputs } = await loadBrandOgInputs();
  return new ImageResponse(<BrandOg {...inputs} height={630} />, { ...size, fonts: fonts.length ? fonts : undefined });
}
