// Exports every <section data-out> in slides.html as a 1080x1350 PNG.
//   node marketing/instagram/launch/src/render.mjs          → the posts
//   node marketing/instagram/launch/src/render.mjs --safe   → same, with the grid-crop box drawn (to /tmp-style _safe/)
import { chromium } from "playwright";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import fs from "node:fs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const safe = process.argv.includes("--safe");
const outRoot = safe ? path.join(here, "_safe") : root;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1080, height: 1350 }, deviceScaleFactor: 1 });
await page.goto(pathToFileURL(path.join(here, "slides.html")).href + (safe ? "#safe" : ""), { waitUntil: "networkidle" });
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(500);
const outs = await page.$$eval("section[data-out]", (els) => els.map((e) => e.dataset.out));
for (const out of outs) {
  const file = path.join(outRoot, out);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await page.locator(`section[data-out="${out}"]`).screenshot({ path: file });
  console.log(path.relative(root, file));
}
await browser.close();
