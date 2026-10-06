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
//     the whole render to the "SwiftCard" brand fallback, which had no name;
//   • a logo the logo picker suggested (img.logo.dev, kept as a remote URL)
//     is fetched at all — the old host allowlist dropped it (Malve Capital).

const SUPABASE = "https://test-project.supabase.co";
const LOGO_URL = `${SUPABASE}/storage/v1/object/public/logos/brand.webp`;
const LOGO_DEV_URL = "https://img.logo.dev/coastline.com?token=pk_test";
// A logo colour no template uses anywhere, so finding it proves the logo drew.
const LOGO_RGB = [255, 0, 170] as const;

const meta = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }));
vi.mock("@/lib/resolve-card", () => ({ resolveCardMeta: async () => meta.current }));
vi.mock("@/lib/supabase-admin", () => ({ getAdminSupabase: () => ({}) }));
vi.mock("@/lib/card-active", () => ({ isCardActive: async () => true }));
vi.mock("@/lib/stored-capture", () => ({ storedCaptureIsCurrent: async () => false }));
// The network, at the one door the preview may use (safeFetch, via
// fetchVCardPhoto). Records what was asked for.
const fetched = vi.hoisted(() => [] as string[]);
const images = vi.hoisted(() => ({ webp: null as Buffer | null, jpeg: null as Buffer | null }));
vi.mock("@/lib/safe-fetch", () => ({
  safeFetch: async (url: string) => {
    fetched.push(url);
    if (url.startsWith("https://test-project.supabase.co/") && images.webp) return new Response(new Uint8Array(images.webp), { headers: { "content-type": "image/webp" } });
    if (url.startsWith("https://img.logo.dev/") && images.jpeg) return new Response(new Uint8Array(images.jpeg), { headers: { "content-type": "image/jpeg" } });
    return new Response("nope", { status: 404 });
  },
}));

beforeAll(async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE;
  const solid = sharp({ create: { width: 200, height: 200, channels: 3, background: { r: LOGO_RGB[0], g: LOGO_RGB[1], b: LOGO_RGB[2] } } });
  images.webp = await solid.clone().webp().toBuffer();
  images.jpeg = await solid.clone().jpeg({ quality: 95 }).toBuffer();
});
afterAll(() => { images.webp = null; images.jpeg = null; });

async function render(template: string, logoUrl: string = LOGO_URL) {
  meta.current = {
    name: "Alex Morgan", title: "Realtor", company: "Coastline Realty",
    photoUrl: null, logoUrl, phone: "4155550188", email: "alex@coastline.com",
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
      expect(res.headers.get("x-sc-preview")).toBe("standin");
      // Complete (logo embedded) → the stand-in policy, not the degraded or
      // brand-fallback one.
      expect(res.headers.get("cache-control")).toBe("public, max-age=0, s-maxage=1, stale-while-revalidate=604800");
      expect(logoPixels, `${template}: the logo is missing from the preview`).toBeGreaterThan(1500);
    });
  }
});

describe("every kind of logo a card can hold reaches the preview", () => {
  it("a logo the logo picker suggested (img.logo.dev), at the sharper size", async () => {
    fetched.length = 0;
    const { res, logoPixels } = await render("luxury-minimal", LOGO_DEV_URL);
    expect(fetched).toEqual(["https://img.logo.dev/coastline.com?token=pk_test&size=256"]);
    expect(res.headers.get("cache-control")).toBe("public, max-age=0, s-maxage=1, stale-while-revalidate=604800");
    expect(logoPixels).toBeGreaterThan(1500);
  });

  it("an SVG logo stored as a data URL", async () => {
    const svg = `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="rgb(${LOGO_RGB.join(",")})"/></svg>`)}`;
    const { res, logoPixels } = await render("photo-first", svg);
    expect(res.headers.get("cache-control")).toBe("public, max-age=0, s-maxage=1, stale-while-revalidate=604800");
    expect(logoPixels).toBeGreaterThan(1500);
  });

  it("a logo that won't load costs only the logo: the name still draws, and it expires fast", async () => {
    const { res, logoPixels } = await render("modern-bold", "https://elsewhere.example/missing.png");
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("cache-control")).toBe("public, max-age=60, s-maxage=60");
    expect(logoPixels).toBe(0);
    // …and says so, so the production monitor can flag it.
    expect(res.headers.get("x-sc-preview")).toBe("standin; missing=logo");
  });
});
