// node scripts/qa-share-preview.mjs   env: BASE=<url> (default https://swiftcard.me)  OUT=<dir>
//                                       CARDS=a,b,c (optional — check these slugs instead of listing)
//
// "Any time a card link is sent and there is a preview, the preview looks
// perfect … it'll miss my name or it'll miss my logo. It cannot do that."
// (owner, 2026-10-06)
//
// The link preview is a stored screenshot of the card, taken in the owner's
// browser (components/ShareCardCapture), with a server-drawn stand-in when
// there is none. Every check before this one looked at code or the DOM. The
// failure the owner hit was in the PIXELS: on 2026-10-06 two real cards
// (aaronlavi-nadlanhomesllc, aaronlavi-malvecapital) were unfurling with the
// logo slot laid out but empty. Nothing noticed until the owner texted his
// own link.
//
// So this looks at what a messenger gets, for REAL cards, every night and
// after every deploy (.github/workflows/nightly-qa.yml):
//   1. og:title is the person's name, and og:image answers fast as an image;
//   2. a live card never unfurls as the generic SwiftCard picture;
//   3. when the preview is the stored screenshot (JPEG), every logo, photo and
//      the name that the REAL card shows (rendered here in Chromium from
//      ?embed=card) has ink in the same place in the preview. A region that is
//      busy on the card and flat in the preview is a dropped element.
//
// Read-only: lists cards with the service key, renders ?embed=card (which
// mounts no view tracker, so no owner gets a phantom view), writes nothing.
import { existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const sharp = require("sharp");
const { chromium } = require("playwright");

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1").replace(/\/$/, "");
const BASE = (process.env.BASE || "https://swiftcard.me").replace(/\/$/, "");
const OUT = process.env.OUT || "qa-share-preview-out";
mkdirSync(OUT, { recursive: true });
const env = existsSync(`${ROOT}/.env.local`) ? readFileSync(`${ROOT}/.env.local`, "utf8") : "";
const g = (k) => process.env[k] ?? process.env[k.replace(/^NEXT_PUBLIC_/, "")] ?? (env.match(new RegExp("^" + k + "=(.*)$", "m")) || [])[1]?.trim().replace(/^["']|["']$/g, "");

/** Cards the QA scripts and App Review mint — never a customer's. */
const INTERNAL = /^(qa-|apple-review-|iaptest-)/;
/** A preview has to arrive before the messenger gives up on it. */
const IMAGE_BUDGET_MS = 8000;
/** Most recent cards checked per run, so the job stays minutes long at any scale. */
const MAX_CARDS = Number(process.env.MAX_CARDS || 80);
const OG_W = 1200, OG_H = 686;

const failures = [];
const fail = (slug, msg) => { const m = `${slug}: ${msg}`; console.log("FAIL " + m); failures.push(m); };
const note = (m) => console.log("     " + m);

const decode = (s) => s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
const meta = (html, prop) => {
  const m = html.match(new RegExp(`<meta[^>]+property="${prop}"[^>]+content="([^"]*)"`)) ?? html.match(new RegExp(`<meta[^>]+content="([^"]*)"[^>]+property="${prop}"`));
  return m ? decode(m[1]) : null;
};

async function listCards() {
  if (process.env.CARDS) return process.env.CARDS.split(",").map((s) => s.trim()).filter(Boolean).map((username) => ({ username }));
  const SB = g("NEXT_PUBLIC_SUPABASE_URL"), SVC = g("SUPABASE_SERVICE_ROLE_KEY");
  if (!SB || !SVC) { console.error("missing SUPABASE url / service role key (or pass CARDS=…)"); process.exit(2); }
  const r = await fetch(`${SB}/rest/v1/cards?select=username,name,logo_url,is_offline,created_at&is_offline=not.is.true&order=created_at.desc&limit=${MAX_CARDS * 3}`, {
    headers: { apikey: SVC, Authorization: "Bearer " + SVC },
  });
  if (!r.ok) { console.error("card list failed:", r.status); process.exit(2); }
  return (await r.json()).filter((c) => c.username && !INTERNAL.test(c.username)).slice(0, MAX_CARDS);
}

/** Small grey thumbnail, for "is this the same picture?" */
async function thumb(buf) {
  return sharp(buf).resize(48, 27, { fit: "fill" }).greyscale().raw().toBuffer();
}
const mad = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]); return s / a.length; };

/** Luminance standard deviation of a box (OG pixel coords) in a raw greyscale image. */
function stdIn(raw, w, h, box) {
  const x0 = Math.max(0, Math.floor(box.x)), y0 = Math.max(0, Math.floor(box.y));
  const x1 = Math.min(w, Math.ceil(box.x + box.w)), y1 = Math.min(h, Math.ceil(box.y + box.h));
  let n = 0, sum = 0, sq = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const v = raw[y * w + x]; n++; sum += v; sq += v * v; }
  if (n < 16) return null;
  const mean = sum / n;
  return Math.sqrt(Math.max(0, sq / n - mean * mean));
}

const cards = await listCards();
console.log(`checking ${cards.length} card(s) against ${BASE}`);

// The generic picture an address with no live card unfurls with. A LIVE card
// matching it means its preview fell all the way through to the brand image.
let brandThumb = null;
try {
  const r = await fetch(`${BASE}/qa-no-such-card-${Date.now().toString(36)}/opengraph-image`, { signal: AbortSignal.timeout(20000) });
  if (r.ok) brandThumb = await thumb(Buffer.from(await r.arrayBuffer()));
} catch { /* without it, check 2 is skipped — never a false failure */ }

const browser = await chromium.launch();
let checked = 0, skipped = 0;
try {
  for (const card of cards) {
    const slug = card.username;
    let html;
    try {
      const res = await fetch(`${BASE}/${slug}`, { headers: { "User-Agent": "facebookexternalhit/1.1" }, signal: AbortSignal.timeout(20000) });
      if (res.status === 404) { skipped++; note(`${slug}: not live (404) — its brand preview is correct`); continue; }
      if (!res.ok) { fail(slug, `card page answered ${res.status}`); continue; }
      html = await res.text();
    } catch (e) { fail(slug, `card page did not answer: ${e.message}`); continue; }
    checked++;

    // ── 1. title + image arrive ───────────────────────────────────────────
    const title = meta(html, "og:title");
    if (!title || /^SwiftCard\b/.test(title)) fail(slug, `og:title is "${title ?? ""}", not the person's name`);
    else if (card.name && title.trim() !== String(card.name).trim()) fail(slug, `og:title "${title}" is not the card's name "${card.name}"`);
    const imgUrl = meta(html, "og:image");
    if (!imgUrl) { fail(slug, "no og:image — the link unfurls with no picture"); continue; }
    let img, type, ms;
    try {
      const t0 = Date.now();
      const r = await fetch(imgUrl, { signal: AbortSignal.timeout(30000) });
      ms = Date.now() - t0;
      type = r.headers.get("content-type") ?? "";
      if (!r.ok || !type.startsWith("image/")) { fail(slug, `preview image answered ${r.status} ${type}`); continue; }
      img = Buffer.from(await r.arrayBuffer());
    } catch (e) { fail(slug, `preview image did not arrive: ${e.message}`); continue; }
    if (ms > IMAGE_BUDGET_MS) fail(slug, `preview image took ${ms}ms (budget ${IMAGE_BUDGET_MS}ms) — messengers give up and show none`);

    // ── 2. never the generic picture for a live card ──────────────────────
    if (brandThumb && mad(await thumb(img), brandThumb) < 4) {
      fail(slug, "a LIVE card unfurls as the generic SwiftCard picture, not the card");
      writeFileSync(`${OUT}/${slug}.og.${type.includes("jpeg") ? "jpg" : "png"}`, img);
      continue;
    }

    // ── 3. a stored screenshot shows everything the card shows ────────────
    // JPEG = the stored capture (the server's stand-in is PNG and draws from
    // the card's data, so its contents are pinned by unit tests instead).
    if (!type.includes("jpeg")) { note(`${slug}: stand-in preview (${type}), ${ms}ms`); continue; }
    const page = await browser.newPage({ viewport: { width: 460, height: 900 } });
    try {
      await page.goto(`${BASE}/${slug}?embed=card`, { waitUntil: "networkidle", timeout: 45000 });
      await page.evaluate(() => document.fonts?.ready);
      await page.waitForTimeout(600);
      const shape = await page.evaluate((name) => {
        const holder = document.querySelector("#sc-card-only");
        const root = holder?.firstElementChild?.firstElementChild?.firstElementChild ?? holder;
        if (!root) return null;
        const o = root.getBoundingClientRect();
        const rel = (r) => ({ x: (r.left - o.left) / o.width, y: (r.top - o.top) / o.height, w: r.width / o.width, h: r.height / o.height });
        const boxes = [];
        for (const im of root.querySelectorAll("img")) {
          const r = im.getBoundingClientRect();
          if (r.width < 12 || r.height < 12 || !im.naturalWidth) continue;
          // The QR is drawn, not a photo, and is checked by its own tests.
          if (/qr/i.test(im.alt || "") || /qr/i.test(im.src)) continue;
          boxes.push({ what: im.alt === "logo" ? "logo" : (im.alt ? "photo" : "image"), ...rel(r) });
        }
        const first = (name || "").trim().split(/\s+/)[0];
        if (first && first.length >= 2) {
          const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
          for (let n = walk.nextNode(); n; n = walk.nextNode()) {
            if (!(n.textContent || "").includes(first)) continue;
            const range = document.createRange(); range.selectNodeContents(n);
            const r = range.getBoundingClientRect();
            if (r.width < 6 || r.height < 6) continue;
            boxes.push({ what: "name", ...rel(r) }); break;
          }
        }
        return { w: o.width, h: o.height, boxes };
      }, card.name ?? title ?? "");
      if (!shape) { fail(slug, "could not find the card on ?embed=card to compare with"); continue; }
      const live = await page.locator("#sc-card-only").screenshot();

      // The preview is the capture cover-fitted into 1200×686; map card
      // fractions into it the same way.
      const k = Math.max(OG_W / shape.w, OG_H / shape.h);
      const offX = (OG_W - shape.w * k) / 2, offY = (OG_H - shape.h * k) / 2;
      const toOg = (b) => ({ x: offX + b.x * shape.w * k, y: offY + b.y * shape.h * k, w: b.w * shape.w * k, h: b.h * shape.h * k });
      const og = await sharp(img).resize(OG_W, OG_H, { fit: "fill" }).greyscale().raw().toBuffer();
      const lv = await sharp(live).resize(Math.round(shape.w), Math.round(shape.h), { fit: "fill" }).greyscale().raw().toBuffer();
      const lw = Math.round(shape.w), lh = Math.round(shape.h);

      const missing = [];
      for (const b of shape.boxes) {
        // Shrink a little so a neighbouring edge can't lend the box its ink.
        const inset = (r, f = 0.12) => ({ x: r.x + r.w * f, y: r.y + r.h * f, w: r.w * (1 - 2 * f), h: r.h * (1 - 2 * f) });
        const sLive = stdIn(lv, lw, lh, inset({ x: b.x * lw, y: b.y * lh, w: b.w * lw, h: b.h * lh }));
        const sOg = stdIn(og, OG_W, OG_H, inset(toOg(b)));
        if (sLive === null || sOg === null) continue;
        // Busy on the card, flat in the preview → it never painted.
        if (sLive >= 10 && sOg < Math.max(3, sLive * 0.25)) missing.push(`${b.what} (card ${sLive.toFixed(0)} vs preview ${sOg.toFixed(0)})`);
      }
      if (missing.length) {
        fail(slug, `the link preview is missing the ${missing.join(", ")} — the stored screenshot dropped it`);
        writeFileSync(`${OUT}/${slug}.og.jpg`, img);
        writeFileSync(`${OUT}/${slug}.card.png`, live);
      } else {
        note(`${slug}: screenshot preview has its ${shape.boxes.map((b) => b.what).join(", ") || "content"}, ${ms}ms`);
      }
    } catch (e) {
      fail(slug, `comparison crashed: ${e.message}`);
    } finally {
      await page.close();
    }
  }
} finally {
  await browser.close();
}

console.log(`\n${checked} live card(s) checked, ${skipped} not live, ${failures.length} problem(s)`);
writeFileSync(`${OUT}/failures.json`, JSON.stringify(failures, null, 2));
process.exitCode = failures.length ? 1 : 0;
