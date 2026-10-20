// Captures the REAL card templates from the live /pin/<slug> pages (which render
// the homepage personas' actual template components) as transparent PNGs.
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, "assets");
const BASE = process.env.BASE || "https://swiftcard.me";
const PERSONAS = {
  realtor: "realtor-business-card-ideas",
  electrician: "qr-code-business-card",
  insurance: "insurance-agent-business-card",
  banker: "luxury-business-cards",
  lawyer: "modern-business-cards",
  cars: "car-salesperson-business-card",
  photographer: "photographer-business-card",
  barber: "modern-barber-business-card",
  "loan-officer": "loan-officer-business-card",
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1000, height: 1500 }, deviceScaleFactor: 4 });
for (const [key, slug] of Object.entries(PERSONAS)) {
  await page.goto(`${BASE}/pin/${slug}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  const handle = await page.evaluateHandle(() => {
    const scaled = [...document.querySelectorAll("div")].find((d) => d.style.transform.startsWith("scale("));
    // Unscale, drop the shadow and the page background so the card stands alone.
    scaled.style.transform = "none";
    scaled.style.filter = "none";
    let p = scaled.parentElement;
    while (p && p !== document.body) { p.style.background = "transparent"; p = p.parentElement; }
    document.documentElement.style.background = "transparent";
    document.body.style.background = "transparent";
    return scaled.firstElementChild;
  });
  await page.waitForTimeout(200);
  await handle.asElement().screenshot({ path: path.join(out, `card-${key}.png`), omitBackground: true });
  console.log("captured", key);
}
await browser.close();
