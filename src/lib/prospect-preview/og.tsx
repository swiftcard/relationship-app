import { ImageResponse } from "next/og";
import { fetchVCardPhoto } from "@/lib/contact-photo";
import { initialsOf } from "./card";
import type { ProspectPreview } from "./types";

// ── Card Builder: the link preview of /p/<slug> ─────────────────────────────
// What a prospect sees in iMessage, WhatsApp or email before they tap: their
// own card, with their name and their logo on it. Drawn here (Satori) in the
// house style: the brand colour panel with the mark on the left, the name,
// title, office and contact details on the right, like the Logo First card
// on the page itself.
//
// Its own small renderer on purpose. The customers' link preview
// (app/card/[username]/opengraph-image.tsx) is watched nightly against real
// cards (scripts/qa-share-preview.mjs); nothing here touches it.

export const OG_SIZE = { width: 1200, height: 630 } as const;

const hexRgb = (hex: string): [number, number, number] => {
  const n = parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
/** Perceived brightness, 0–255. */
const yiq = (hex: string) => {
  const [r, g, b] = hexRgb(hex);
  return (r * 299 + g * 587 + b * 114) / 1000;
};

/**
 * The logo as a data URL Satori can draw, with its proportions. Fetched
 * through the SSRF-safe fetcher (lib/contact-photo): the address is typed in
 * by staff, but this runs on a public route, so it gets the same guard as
 * every other picture the server fetches.
 */
async function embedLogo(url: string | null): Promise<{ src: string; aspect: number } | null> {
  if (!url || !/^https:\/\//.test(url)) return null;
  try {
    const got = await fetchVCardPhoto(url, "logo");
    if (!got || !/^image\/(png|jpe?g)$/.test(got.mime ?? "")) return null;
    const sharp = (await import("sharp")).default;
    const { width, height } = await sharp(Buffer.from(got.base64, "base64")).metadata();
    return { src: `data:${got.mime};base64,${got.base64}`, aspect: width && height ? width / height : 1 };
  } catch {
    return null;
  }
}

export async function renderPreviewOg(p: ProspectPreview): Promise<Response> {
  const logo = await embedLogo(p.logo_url);
  const ground = p.brand_primary;
  const dark = yiq(ground) < 150;
  const ink = dark ? "#FFFFFF" : "#141B26";
  const soft = dark ? "rgba(255,255,255,0.72)" : "rgba(20,27,38,0.68)";
  const rule = dark ? "rgba(255,255,255,0.22)" : "rgba(20,27,38,0.16)";
  // The accent draws the title; if it can't be read on the ground, use the ink.
  const accent = Math.abs(yiq(p.brand_secondary) - yiq(ground)) > 70 ? p.brand_secondary : ink;

  // A wide wordmark gets its width; a square mark gets its height.
  const logoBox = logo ? (logo.aspect >= 1 ? { width: 260, height: Math.round(260 / logo.aspect) } : { width: Math.round(260 * logo.aspect), height: 260 }) : null;
  const details = [p.phone, p.email].filter(Boolean) as string[];
  const nameSize = p.owner_name.length > 24 ? 58 : p.owner_name.length > 16 ? 70 : 84;

  const image = new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", background: ground, color: ink, fontFamily: "sans-serif" }}>
        <div style={{ width: 400, height: "100%", display: "flex", alignItems: "center", justifyContent: "center", padding: 56 }}>
          {logo && logoBox ? (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", background: "#FFFFFF", borderRadius: 28, padding: 24 }}>
              {/* eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text */}
              <img src={logo.src} width={logoBox.width} height={logoBox.height} style={{ objectFit: "contain" }} />
            </div>
          ) : (
            <div style={{ width: 240, height: 240, borderRadius: 120, display: "flex", alignItems: "center", justifyContent: "center", border: `4px solid ${rule}`, fontSize: 96, fontWeight: 700 }}>
              {initialsOf(p.office_name) || initialsOf(p.owner_name)}
            </div>
          )}
        </div>
        <div style={{ width: 2, height: 430, alignSelf: "center", background: rule }} />
        <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", padding: "56px 64px" }}>
          <div style={{ fontSize: nameSize, fontWeight: 700, lineHeight: 1.05, letterSpacing: -1.5 }}>{p.owner_name}</div>
          {p.owner_title ? <div style={{ marginTop: 16, fontSize: 36, color: accent, fontWeight: 600 }}>{p.owner_title}</div> : null}
          <div style={{ marginTop: 10, fontSize: 32, color: soft }}>{p.office_name}</div>
          <div style={{ marginTop: 40, display: "flex", flexDirection: "column" }}>
            {details.map((d) => (
              <div key={d} style={{ fontSize: 30, color: soft, marginTop: 8 }}>{d}</div>
            ))}
          </div>
        </div>
      </div>
    ),
    { ...OG_SIZE },
  );

  // Says what was drawn, like the customers' preview does, so a missing logo
  // is visible from outside (curl -I).
  const missing = p.logo_url && !logo;
  return new Response(image.body, {
    headers: {
      "Content-Type": "image/png",
      "X-SC-Preview": missing ? "prospect; missing=logo" : "prospect",
      // A picture whose logo failed to load must not be frozen for a day.
      "Cache-Control": missing ? "public, max-age=60, s-maxage=60" : "public, max-age=600, s-maxage=3600, stale-while-revalidate=86400",
      "X-Robots-Tag": "noindex",
    },
  });
}
