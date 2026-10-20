// Captures Maya's Swift Signature panel (MiniSignature, a mail client's message
// view) from the live /for/real-estate-agents showcase, flattened and at 6x.
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import path from "node:path";
const here = path.dirname(fileURLToPath(import.meta.url));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 1400 }, deviceScaleFactor: 6, reducedMotion: "reduce" });
await page.goto("https://swiftcard.me/for/real-estate-agents", { waitUntil: "networkidle" });
await page.waitForTimeout(1500);
await page.evaluate(() => {
  const el = [...document.querySelectorAll("div.w-\\[212px\\]")].find((d) => d.querySelector("img"));
  const clone = el.cloneNode(true);
  clone.id = "maya-sig";
  Object.assign(clone.style, { position: "fixed", left: "0px", top: "0px", zIndex: 2147483647, transform: "none" });
  document.body.appendChild(clone);
});
await page.waitForTimeout(600);
await page.locator("#maya-sig").screenshot({ path: path.join(here, "assets", "maya-sig.png") });
await browser.close();
