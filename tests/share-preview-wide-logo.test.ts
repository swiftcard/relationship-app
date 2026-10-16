import { describe, it, expect, vi } from "vitest";
import sharp from "sharp";

// ── A wide or banner logo in the stand-in preview is drawn at its own shape ──
//
// Owner, 2026-10-15: a wide or banner logo must fit perfectly — not too small —
// everywhere a card shows. The stand-in link preview (opengraph-image Tier 2)
// drew every logo in a fixed SQUARE box, so a 4:1 wordmark came out 56×14.
// These render it with Satori, as share-preview-standin does, and measure the
// logo's drawn box from the pixels.

const LOGO_RGB = [255, 0, 170] as const;
const meta = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }));
vi.mock("@/lib/resolve-card", () => ({ resolveCardMeta: async () => meta.current }));
vi.mock("@/lib/supabase-admin", () => ({ getAdminSupabase: () => ({}) }));
vi.mock("@/lib/card-active", () => ({ isCardActive: async () => true }));
vi.mock("@/lib/stored-capture", () => ({ storedCaptureIsCurrent: async () => false }));
vi.mock("@/lib/safe-fetch", () => ({ safeFetch: async () => new Response("nope", { status: 404 }) }));

async function logoAs(w: number, h: number): Promise<string> {
  const png = await sharp({ create: { width: w, height: h, channels: 3, background: { r: LOGO_RGB[0], g: LOGO_RGB[1], b: LOGO_RGB[2] } } }).png().toBuffer();
  return `data:image/png;base64,${png.toString("base64")}`;
}

/** The drawn logo's bounding box, in preview pixels. */
async function drawnLogo(template: string, logoUrl: string, company = "Coastline Realty") {
  meta.current = {
    name: "Alex Morgan", title: "Realtor", company,
    photoUrl: null, logoUrl, phone: "4155550188", email: "alex@coastline.com",
    website: "coastline.com", address: null, accentColor: null, template, style: {}, custom: null,
  };
  const { default: Image } = await import("@/app/card/[username]/opengraph-image");
  const res = await Image({ params: Promise.resolve({ username: "alexmorgan" }) });
  const { data, info } = await sharp(Buffer.from(await res.arrayBuffer())).raw().toBuffer({ resolveWithObject: true });
  let minX = Infinity, minY = Infinity, maxX = -1, maxY = -1;
  for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
    const i = (y * info.width + x) * info.channels;
    if (Math.abs(data[i] - LOGO_RGB[0]) < 12 && Math.abs(data[i + 1] - LOGO_RGB[1]) < 12 && Math.abs(data[i + 2] - LOGO_RGB[2]) < 12) {
      if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
  }
  return { w: maxX - minX + 1, h: maxY - minY + 1, frame: info.width, preview: res.headers.get("x-sc-preview") };
}

describe("the stand-in preview draws a 4:1 banner logo at its own shape", () => {
  // Templates whose stand-in places the logo in a row or a corner; Logo First
  // already draws it in a wide 230×170 tile.
  for (const template of ["modern-bold", "classic-pro", "photo-first", "local-business", "luxury-minimal", "custom"]) {
    it(template, async () => {
      const banner = await drawnLogo(template, await logoAs(800, 200));
      expect(banner.preview).toBe("standin");
      expect(banner.frame).toBe(1200);
      // Before: the banner was contained in a 54–96px square, so ≤96 wide.
      expect(banner.w, `${template}: banner drawn ${banner.w}×${banner.h}`).toBeGreaterThan(130);
      expect(banner.w / banner.h).toBeGreaterThan(3.6);
      // A square logo is drawn exactly as it was.
      const square = await drawnLogo(template, await logoAs(200, 200));
      expect(Math.abs(square.w - square.h), `${template}: square drawn ${square.w}×${square.h}`).toBeLessThanOrEqual(2);
    });
  }
});
