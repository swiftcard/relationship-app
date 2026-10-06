import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import sharp from "sharp";

// ── The stand-in preview is the whole card, in every template ────────────────
//
// Owner, 2026-10-06: "sometimes it'll miss my name, sometimes it'll miss my
// logo." The rendered stand-in (opengraph-image Tier 2) is what a link shows
// right after an edit, until the pixel-perfect capture lands. These render it
// for real with Satori and read the pixels:
//   • every template draws the logo where it sits on the card;
//   • a WebP logo — what phones and design tools export — no longer throws
//     the whole render to the "SwiftCard" brand fallback, which had no name.

const SUPABASE = "https://test-project.supabase.co";
const LOGO_URL = `${SUPABASE}/storage/v1/object/public/logos/brand.webp`;
// A logo colour no template uses anywhere, so finding it proves the logo drew.
const LOGO_RGB = [255, 0, 170] as const;

const meta = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }));
vi.mock("@/lib/resolve-card", () => ({ resolveCardMeta: async () => meta.current }));
vi.mock("@/lib/supabase-admin", () => ({ getAdminSupabase: () => ({}) }));
vi.mock("@/lib/card-active", () => ({ isCardActive: async () => true }));
vi.mock("@/lib/stored-capture", () => ({ storedCaptureIsCurrent: async () => false }));

let webp: Buffer;
const realFetch = globalThis.fetch;

beforeAll(async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE;
  webp = await sharp({ create: { width: 200, height: 200, channels: 3, background: { r: LOGO_RGB[0], g: LOGO_RGB[1], b: LOGO_RGB[2] } } }).webp().toBuffer();
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    if (String(input) === LOGO_URL) return new Response(new Uint8Array(webp), { headers: { "content-type": "image/webp" } });
    return realFetch(input);
  }) as typeof fetch;
});
afterAll(() => { globalThis.fetch = realFetch; });

async function render(template: string) {
  meta.current = {
    name: "Alex Morgan", title: "Realtor", company: "Coastline Realty",
    photoUrl: null, logoUrl: LOGO_URL, phone: "4155550188", email: "alex@coastline.com",
    website: "coastline.com", address: null, accentColor: null, template, style: {}, custom: null,
  };
  const { default: Image } = await import("@/app/card/[username]/opengraph-image");
  const res = await Image({ params: Promise.resolve({ username: "alexmorgan" }) });
  const png = Buffer.from(await res.arrayBuffer());
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
  let logoPixels = 0;
  for (let i = 0; i < data.length; i += info.channels) {
    if (Math.abs(data[i] - LOGO_RGB[0]) < 12 && Math.abs(data[i + 1] - LOGO_RGB[1]) < 12 && Math.abs(data[i + 2] - LOGO_RGB[2]) < 12) logoPixels++;
  }
  return { res, logoPixels, width: info.width };
}

describe("the stand-in draws the logo in every template", () => {
  for (const template of ["modern-bold", "classic-pro", "photo-first", "local-business", "luxury-minimal", "logo-first", "custom"]) {
    it(template, async () => {
      const { res, logoPixels, width } = await render(template);
      expect(res.headers.get("content-type")).toBe("image/png");
      expect(width).toBe(1200);
      // Complete (logo embedded) → the stand-in policy, not the degraded or
      // brand-fallback one.
      expect(res.headers.get("cache-control")).toBe("public, max-age=0, s-maxage=1, stale-while-revalidate=604800");
      expect(logoPixels, `${template}: the logo is missing from the preview`).toBeGreaterThan(1500);
    });
  }
});
