// Draws a social post for the Agents tab's social media manager.
//
//   node scripts/crew-render-social.mjs <spec.json> <options|final> <out-dir>
//
// The spec comes from /api/crew/ingest?social_spec=<id> (see
// .github/workflows/crew-render.yml). Same visual system as the launch posts
// (marketing/instagram/launch/src/pinned-v2.html): light background, the
// SwiftCard lockup, a two-line Bricolage headline with one word in the blue
// gradient, a short subline, "swiftcard.me · Free to start", and a real
// product capture. "options" draws the first slide of each option at 4:5;
// "final" draws every slide of the chosen option at every size. Writes PNGs
// and a files.json listing them. Publishes nothing.
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const assets = path.resolve(here, "../marketing/instagram/launch/src/assets");
const [specPath, step, outDir] = process.argv.slice(2);
if (!specPath || !["options", "final"].includes(step) || !outDir) {
  console.error("usage: crew-render-social.mjs <spec.json> <options|final> <out-dir>");
  process.exit(2);
}
const spec = JSON.parse(fs.readFileSync(specPath, "utf8"));
fs.mkdirSync(outDir, { recursive: true });

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
// Inlined: a page set from a string can't load file:// pictures.
const assetCache = new Map();
const asset = (f) => {
  if (!assetCache.has(f)) {
    const type = f.endsWith(".svg") ? "image/svg+xml" : "image/png";
    assetCache.set(f, `data:${type};base64,${fs.readFileSync(path.join(assets, f)).toString("base64")}`);
  }
  return assetCache.get(f);
};

function headline(s) {
  const words = esc(s.headline).split(/\s+/);
  const accent = String(s.accent ?? "").replace(/[.,!?]/g, "").toLowerCase();
  const html = words.map((w) => (w.replace(/[.,!?]/g, "").toLowerCase() === accent ? `<span class="aur">${w}</span>` : w));
  // Two lines like the launch posts: break before the last word.
  return html.length > 1 ? `${html.slice(0, -1).join(" ")}<br>${html[html.length - 1]}` : html.join("");
}

function visual(s, w, h) {
  const tall = h / w > 1.1;
  if (s.visual === "none") return "";
  if (s.visual === "card") {
    // Fit the card in the band between the headline and the subline.
    const u = Math.min(w, h) / 1080;
    const headBottom = (tall ? 318 + 2 * 200 * 0.88 : 230 + 2 * 170 * 0.88) * u + 40 * u;
    const subTop = h - (tall ? 190 : 150) * u - 2 * 49 * u - 40 * u;
    const band = Math.max(120 * u, subTop - headBottom);
    const cw = Math.round(Math.min(w * 0.63, band * 1.55));
    const top = Math.round(headBottom + (band - cw / 1.63) / 2);
    return `<img class="card" src="${asset("dw-card.png")}" style="right:${Math.round(w * 0.06)}px;top:${top}px;width:${cw}px;transform:rotate(3deg)">`;
  }
  const pw = Math.round(Math.min(w * 0.44, h * 0.36));
  const shot = s.visual === "link" ? "dw-links.png" : "dw-page.png";
  const bg = s.visual === "link" ? "#0B1220" : "#FAF7F2";
  return `<div class="phone" style="right:${Math.round(w * 0.045)}px;top:${Math.round(h * (tall ? 0.22 : 0.18))}px;width:${pw}px"><div class="screen" style="background:${bg}"><div class="island"></div><img class="shot" src="${asset(shot)}"></div></div>`;
}

function section(s, w, h, out) {
  const u = Math.min(w, h) / 1080;
  const tall = h / w > 1.1;
  const textW = s.visual === "none" ? w - 160 * u : tall ? w * 0.5 : w * 0.46;
  return `<section data-out="${out}" style="width:${w}px;height:${h}px">
  <div class="lockup" style="left:${80 * u}px;top:${(tall ? 150 : 90) * u}px"><img src="${asset("logo.svg")}" style="width:${68 * u}px;height:${68 * u}px"><span style="font-size:${40 * u}px">SwiftCard</span></div>
  <h1 class="display" style="left:${76 * u}px;top:${(tall ? 318 : 230) * u}px;font-size:${(s.visual === "none" ? 230 : tall ? 200 : 170) * u}px;width:${textW}px">${headline(s)}</h1>
  <p class="sub" style="left:${80 * u}px;bottom:${(tall ? 190 : 150) * u}px;width:${Math.min(textW, 520 * u)}px;font-size:${40 * u}px">${esc(s.sub)}</p>
  <div class="foot" style="left:${80 * u}px;bottom:${(tall ? 58 : 50) * u}px;font-size:${30 * u}px"><b>swiftcard.me</b> &nbsp;·&nbsp; Free to start</div>
  ${visual(s, w, h)}
</section>`;
}

const jobs = [];
if (step === "options") {
  spec.options.forEach((o, i) => jobs.push({ slide: o.slides[0], w: 1080, h: 1350, key: `opt-${i + 1}` }));
} else {
  const o = spec.options[(spec.choice ?? 1) - 1];
  for (const [size, d] of Object.entries(spec.sizes)) o.slides.forEach((s, i) => jobs.push({ slide: s, w: d.w, h: d.h, key: `${size}-${i + 1}` }));
}

const html = `<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500..800&family=Geist:wght@400;500;600;700&display=block" rel="stylesheet">
<style>
  :root { --ink:#0B1022; --ink-2:#3B4357; --muted:#6B7390; --aurora:linear-gradient(110deg,#1D4ED8 0%,#2563EB 45%,#4DA8F5 100%); }
  * { box-sizing:border-box; margin:0; padding:0; }
  body { background:#333; font-family:"Geist",system-ui,sans-serif; -webkit-font-smoothing:antialiased; }
  section { position:relative; overflow:hidden; margin:0 0 40px; color:var(--ink);
    background: radial-gradient(ellipse 46% 40% at 76% 62%, rgba(37,99,235,.20), transparent 70%), radial-gradient(ellipse 40% 30% at 90% 100%, rgba(77,168,245,.16), transparent 70%), linear-gradient(180deg,#FFFFFF 0%,#F5F8FE 100%); }
  section > * { position:absolute; z-index:1; }
  .display { font-family:"Bricolage Grotesque",sans-serif; font-variation-settings:"opsz" 96; font-weight:800; letter-spacing:-.045em; line-height:.88; }
  .aur { background:var(--aurora); -webkit-background-clip:text; background-clip:text; color:transparent; padding-right:.08em; }
  .lockup { display:flex; align-items:center; gap:18px; } .lockup img { border-radius:16px; } .lockup span { font-family:"Bricolage Grotesque",sans-serif; font-weight:800; letter-spacing:-.02em; }
  .sub { line-height:1.22; color:var(--ink-2); font-weight:500; letter-spacing:-.015em; }
  .foot { color:var(--muted); font-weight:500; } .foot b { color:var(--ink); font-weight:600; }
  .phone { background:linear-gradient(160deg,#4b505b 0%,#1c1f26 30%,#2a2e36 70%,#4b505b 100%); border-radius:76px; padding:13px; box-shadow:0 0 0 1.5px rgba(255,255,255,.35) inset, 0 60px 110px -30px rgba(11,16,34,.55), 0 30px 60px -20px rgba(37,99,235,.35); }
  .screen { border-radius:64px; overflow:hidden; position:relative; } .screen img.shot { display:block; width:100%; margin-top:58px; }
  .island { position:absolute; top:15px; left:50%; transform:translateX(-50%); width:33%; height:36px; background:#000; border-radius:40px; z-index:4; }
  .card { display:block; border-radius:24px; box-shadow:0 70px 100px -40px rgba(11,16,34,.45), 0 30px 70px -30px rgba(37,99,235,.45), 0 0 0 1px rgba(11,16,34,.06); }
</style></head><body>
${jobs.map((j) => section(j.slide, j.w, j.h, j.key)).join("\n")}
</body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 2000 }, deviceScaleFactor: 1 });
await page.setContent(html, { waitUntil: "networkidle" });
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(400);
const files = [];
for (const j of jobs) {
  const file = path.join(outDir, `${j.key}.png`);
  await page.locator(`section[data-out="${j.key}"]`).screenshot({ path: file });
  files.push({ key: j.key, file });
  console.log(j.key);
}
await browser.close();
fs.writeFileSync(path.join(outDir, "files.json"), JSON.stringify(files));
