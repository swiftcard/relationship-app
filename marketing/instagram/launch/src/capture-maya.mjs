// Captures Maya Castillo's real card page and Swift Links page from the live
// /for/real-estate-agents showcase (HeroShowcase's PersonaShowcase), at their
// natural widths (375 / 430) instead of the shrunken hero scale.
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import path from "node:path";
const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, "assets");
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 1400 }, deviceScaleFactor: 4, reducedMotion: "reduce" });
await page.goto("https://swiftcard.me/for/real-estate-agents", { waitUntil: "networkidle" });
await page.waitForTimeout(1500);
for (const [scale, name] of [["scale(0.7)", "maya-page"], ["scale(0.46)", "maya-links"]]) {
  await page.evaluate(({ scale, name }) => {
    const el = [...document.querySelectorAll("div")].find((d) => d.style.transform === scale && d.querySelector("img"));
    const clone = el.cloneNode(true);
    clone.id = name;
    Object.assign(clone.style, { transform: "none", position: "fixed", left: "0px", top: "0px", zIndex: 2147483647 });
    // The card page sits on the real page's accent wash (phoneScreenWash in HeroShowcase).
    if (name === "maya-page") clone.style.height = "auto";
    if (name === "maya-page") clone.style.background = "linear-gradient(180deg, rgba(109,40,217,0.14) 0%, rgba(250,247,242,0) 46%), #FAF7F2";
    document.querySelectorAll("[id^=maya-]").forEach((n) => n.remove());
    document.body.appendChild(clone);
  }, { scale, name });
  await page.waitForTimeout(600);
  await page.locator(`#${name}`).screenshot({ path: path.join(out, `${name}.png`) });
  console.log(name);
}
await browser.close();
