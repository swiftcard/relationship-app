// Design exploration for the App Store screenshots.
//
// Both surfaces we are designing — the public card and the Swift Links page —
// are PUBLIC, so this needs no login: seed one throwaway account, then patch
// its design and re-shoot the two pages once per candidate. Comparing real
// renders beats picking a palette from a preset list and hoping.
//
//   node scripts/appstore-explore.mjs
import { localBase, seededAdmin } from "./lib/qa-local.mjs";
import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "node:fs";
import { markInternal } from "./qa-internal.mjs";

const OUT = process.env.OUT || "app-store/screenshots/_explore";
const BASE = localBase(process.env.BASE);
mkdirSync(OUT, { recursive: true });

const env = readFileSync(".env.local", "utf8");
const g = (k) => (env.match(new RegExp("^" + k + "=(.*)$", "m")) || [])[1]?.trim().replace(/^["']|["']$/g, "");
const SB = g("NEXT_PUBLIC_SUPABASE_URL"), SVC = g("SUPABASE_SERVICE_ROLE_KEY");
const adm = seededAdmin((p, i) => fetch(SB + p, {
  ...i,
  headers: { apikey: SVC, Authorization: "Bearer " + SVC, "Content-Type": "application/json", ...(i?.headers ?? {}) },
}));

const stamp = Date.now().toString().slice(-8);
const uname = `lena-${stamp}`;
const email = `explore-${stamp}@swiftcard-test.invalid`;
const PHOTO = `${BASE}/showcase/lena.jpg`;
const BIO = "Weddings, portraits and brand shoots — natural light, real moments. Portland, OR.";

const ROWS = [
  { emoji: "🎬", label: "Watch the 2026 wedding reel", url: "https://lenabrooks.photo/reel", size: "compact" },
  { emoji: "📸", label: "Portfolio", url: "https://lenabrooks.photo/portfolio", size: "compact" },
  { emoji: "💍", label: "Wedding packages", url: "https://lenabrooks.photo/weddings", size: "compact" },
  { emoji: "🌅", label: "Mini sessions", url: "https://lenabrooks.photo/minis", size: "compact" },
  { emoji: "📅", label: "Check my 2026 availability", url: "https://lenabrooks.photo/book", size: "compact" },
  { emoji: "✉️", label: "Join the newsletter", url: "https://lenabrooks.photo/news", size: "compact" },
];
const MIXED = [
  { emoji: "🎬", label: "Watch the 2026 wedding reel", url: "https://lenabrooks.photo/reel", size: "compact" },
  { emoji: "📸", label: "Portfolio", url: "https://lenabrooks.photo/portfolio", size: "grid" },
  { emoji: "💍", label: "Wedding packages", url: "https://lenabrooks.photo/weddings", size: "grid" },
  { emoji: "📅", label: "Check my 2026 availability", url: "https://lenabrooks.photo/book", size: "compact" },
  { emoji: "✉️", label: "Join the newsletter", url: "https://lenabrooks.photo/news", size: "compact" },
];
const LINKS = ROWS;

// ── Candidates ───────────────────────────────────────────────────────────────
// Card: the question is which template + palette reads "expensive" at thumbnail
// size, and whether the headshot helps or crowds it.
const CARDS = [
  { id: "card-g-photo-onyx-gold", template: "photo-first",
    d: { bgColor: "#0a0a0a", textColor: "#ffffff", accentColor: "#b8863b", photoUrl: PHOTO } },
  { id: "card-h-photo-onyx-ink",  template: "photo-first",
    d: { bgColor: "#0a0a0a", textColor: "#ffffff", accentColor: "#111827", photoUrl: PHOTO } },
  { id: "card-i-luxe-charcoal",   template: "luxury-minimal",
    d: { bgColor: "#1c1612", textColor: "#d4af7a", accentColor: "#1c1612" } },
];

// Links: monotone icons throughout (owner: "maybe the social icons should be
// monotone"), varying the Look and whether the links render as rich tiles or
// clean rows. The rainbow gradient tiles are what made the last pass loud.
const LINKS_VARIANTS = [
  { id: "links-g-aura-rows",  links: ROWS,  d: { linkLook: "aura",  linkIconFill: "accent", linkIconShape: "circle" } },
  { id: "links-h-sand-rows",  links: ROWS,  d: { linkLook: "sand",  linkIconFill: "accent", linkIconShape: "circle" } },
  { id: "links-i-aura-mixed", links: MIXED, d: { linkLook: "aura",  linkIconFill: "accent", linkIconShape: "circle" } },
  { id: "links-j-onyx-rows",  links: ROWS,  d: { linkLook: "onyx",  linkIconFill: "accent", linkIconShape: "circle" } },
  { id: "links-k-dawn-rows",  links: ROWS,  d: { linkLook: "dawn",  linkIconFill: "accent", linkIconShape: "circle" } },
  { id: "links-l-orchid-rows",links: ROWS,  d: { linkLook: "orchid",linkIconFill: "accent", linkIconShape: "circle" } },
];

let userId = null, cardId = null, browser;
const extraCards = [];
try {
  const u = await (await adm("/auth/v1/admin/users", {
    method: "POST", body: JSON.stringify({ email, password: `Ex!aA1${stamp}`, email_confirm: true }),
  })).json();
  userId = u.id;
  if (!userId) throw new Error("no user id");

  await adm("/rest/v1/profiles", {
    method: "POST", headers: { Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify({ id: userId, username: uname, name: "Lena Brooks", email, plan: "pro", photo_url: PHOTO,
      customization: { bio: BIO, photoUrl: PHOTO, _aiConsent: "accepted" } }),
  });
  const card = await (await adm("/rest/v1/cards", {
    method: "POST", headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      user_id: userId, username: uname, name: "Lena Brooks", title: "Photographer",
      company: "Lena Brooks Photography", phone: "(503) 555-0143",
      email: "hello@lenabrooks.photo", website: "lenabrooks.photo",
      linkedin: "lenabrooks", instagram: "lenabrooks.photo", tiktok: "lenabrooks",
      template: "luxury-minimal", customization: { bio: BIO, links: LINKS },
    }),
  })).json();
  cardId = card?.[0]?.id;
  console.log("seeded", uname);

  browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 440, height: 956 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  });
  await markInternal(ctx, BASE);
  const page = await ctx.newPage();

  const makeCard = async (slug, template, extra) => {
    const r = await adm("/rest/v1/cards", {
      method: "POST", headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        user_id: userId, username: slug, name: "Lena Brooks", title: "Photographer",
        company: "Lena Brooks Photography", phone: "(503) 555-0143",
        email: "hello@lenabrooks.photo", website: "lenabrooks.photo",
        linkedin: "lenabrooks", instagram: "lenabrooks.photo", tiktok: "lenabrooks",
        template,
        customization: { bio: BIO, links: extra.links ?? LINKS, youtube: "lenabrooks", facebook: "lenabrooks.photo", ...extra, links: extra.links ?? LINKS },
      }),
    });
    const j = await r.json();
    return j?.[0]?.id ?? null;
  };

  for (const v of CARDS) {
    const slug = `${uname}-${v.id}`;
    extraCards.push(await makeCard(slug, v.template, v.d));
    await page.goto(`${BASE}/${slug}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${OUT}/${v.id}.png` });
    console.log(" ", v.id);
  }

  for (const v of LINKS_VARIANTS) {
    const slug = `${uname}-${v.id}`;
    extraCards.push(await makeCard(slug, "luxury-minimal", {
      photoUrl: PHOTO, accentColor: "#b08d57",
      linkHeroStyle: "cover", linkHeroContent: "photo", links: v.links, ...v.d,
    }));
    await page.goto(`${BASE}/links/${slug}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${OUT}/${v.id}.png`, fullPage: true });
    console.log(" ", v.id);
  }

} catch (e) {
  console.error("FAILED:", e.message);
} finally {
  if (browser) await browser.close().catch(() => {});
  try {
    await adm(`/rest/v1/cards?user_id=eq.${userId}`, { method: "DELETE" });
    if (userId) {
      await adm(`/rest/v1/profiles?id=eq.${userId}`, { method: "DELETE" });
      await adm(`/auth/v1/admin/users/${userId}`, { method: "DELETE" });
    }
    console.log("cleaned up", uname);
  } catch (e) { console.error("CLEANUP FAILED:", uname, e.message); }
}
