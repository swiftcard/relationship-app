// The pinned row as the profile grid shows it: three 1:1 centre crops at
// thumbnail size, in pin order (One card · One link · One tap).
//   node marketing/instagram/launch/src/grid-preview-v2.mjs
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const posts = ["one-card", "one-link", "one-tap"].map((n) => `data:image/png;base64,${fs.readFileSync(path.join(root, "pinned-v2", `${n}.png`)).toString("base64")}`);
const html = `<!doctype html><body style="margin:0;background:#fff;width:1092px;padding:0">
<div style="display:grid;grid-template-columns:repeat(3,360px);gap:6px">
${posts.map((p) => `<div style="width:360px;height:360px;background:url(${p}) center/cover"></div>`).join("")}
</div></body>`;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1092, height: 360 }, deviceScaleFactor: 2 });
await page.setContent(html, { waitUntil: "networkidle" });
await page.waitForTimeout(300);
await page.screenshot({ path: path.join(root, "pinned-v2", "grid-preview.png") });
console.log("pinned-v2/grid-preview.png");
await browser.close();
