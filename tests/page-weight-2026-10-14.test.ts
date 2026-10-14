import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { drawQr, qrSvgMarkup, qrTarget } from "@/lib/qr-svg";

// Source pins for the 2026-10-14 page-weight pass (SEO audit: homepage HTML
// 2.4 MB, 1.9 MB of it inline QR path data; the autoplaying hero video was
// the LCP at 6.0 s; 3,698 DOM elements). Each line below is a measured cost
// that a later tidy-up would quietly put back.
const read = (p: string) => readFileSync(p, "utf8");
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

describe("the homepage hero paints its poster first", () => {
  const home = code("src/app/page.tsx");

  it("the first HTML holds no autoplaying <video> — HeroVideo adds it after load", () => {
    expect(home).not.toMatch(/<video/);
    expect(home).toContain("<HeroVideo />");
  });

  it("the poster is an eager, high-priority <img> with sizes for a phone", () => {
    const img = home.slice(home.indexOf('src="/hero-bg-poster.jpg'), home.indexOf("<HeroVideo />"));
    expect(img).toMatch(/fetchPriority="high"/);
    expect(img).toMatch(/loading="eager"/);
    expect(img).toMatch(/srcSet="\/hero-bg-poster-640\.jpg 640w/);
  });

  it("HeroVideo waits for load + idle, honours reduced motion and Save-Data, and plays the small file", () => {
    const src = code("src/components/site/HeroVideo.tsx");
    expect(src).toMatch(/prefers-reduced-motion: reduce/);
    expect(src).toMatch(/saveData/);
    expect(src).toMatch(/addEventListener\("load"/);
    expect(src).toMatch(/requestIdleCallback/);
    expect(src).toContain('src="/hero-bg-720.mp4"');
    expect(src).not.toContain('"/hero-bg.mp4');
    expect(src).toMatch(/motion-reduce:hidden/);
  });
});

describe("marketing cards carry their QR as a cached image, the product inline", () => {
  it.each([
    "src/app/page.tsx",
    "src/app/for/[slug]/page.tsx",
    "src/app/templates/page.tsx",
  ])("%s wraps its cards in QrAsImages", (p) => {
    expect(code(p)).toContain("<QrAsImages>");
  });

  it("the card page and the app never do (the popup and PNG read the inline SVG)", () => {
    for (const p of ["src/app/[username]/page.tsx", "src/app/dashboard/page.tsx", "src/components/QRCodeModal.tsx"]) {
      expect(read(p)).not.toContain("QrAsImages");
    }
  });

  it("a vCard payload is always inline — personal data belongs in no URL", () => {
    const src = code("src/components/card-templates/MiniQR.tsx");
    expect(src).toMatch(/mode === "img" && !payload/);
  });

  it("the image route is immutable for a year on the CDN too, and only takes a hex colour", () => {
    const src = code("src/app/api/qr/route.ts");
    expect(src).toMatch(/max-age=31536000, s-maxage=31536000, immutable/);
    expect(src).toMatch(/isHexColor\(fg\)/);
  });

  it("draws the same code as a file and inline, with short numbers", () => {
    const target = qrTarget("swiftcard.me/alexmorgan");
    expect(target).toBe("https://swiftcard.me/alexmorgan");
    const d = drawQr(target)!;
    expect(d.count).toBeGreaterThan(20);
    expect(d.modules).not.toMatch(/\d\.\d{3,}/);
    const svg = qrSvgMarkup(target, "#111827")!;
    expect(svg).toContain(`viewBox="0 0 ${d.count} ${d.count}"`);
    expect(svg).toContain(d.modules);
    expect(svg.length).toBeLessThan(60_000);
  });
});

describe("below-the-fold replicas are built in the browser, not shipped in the HTML or the first chunks", () => {
  const home = code("src/app/page.tsx");
  const lazy = code("src/components/site/HomeLazy.tsx");

  it("the desktop hero showcase is deferred and gated on the width that shows it", () => {
    expect(lazy).toMatch(/<Deferred when="idle" media="\(min-width: 1280px\)">\s*<HeroShowcase \/>/);
  });

  it.each(["HeroShowcase", "TemplateGallery", "DashboardDemo", "TeamsDashboard", "SignatureDemo", "ShareWaysPhones", "WatchShareImage", "SwiftLinksPhone", "HomeCardPhone", "HowItWorksScenes"])(
    "%s is a dynamic import the homepage never imports directly",
    (name) => {
      expect(lazy).toMatch(new RegExp(`dynamic\\(\\(\\) => import\\("@/components/site/${name}"\\)`));
      expect(home).not.toMatch(new RegExp(`from "@/components/site/${name}"`));
    },
  );

  it("every lazy component mounts through a Deferred", () => {
    const renders = lazy.match(/<(HeroShowcase|TemplateGallery|SwiftLinksPhone|SignatureDemo|DashboardDemo|ShareWaysPhones|WatchShareImage|TeamsDashboard|HomeCardPhone|Scene)\b/g) ?? [];
    expect(renders.length).toBe(10);
    for (const r of renders) {
      const at = lazy.indexOf(r);
      expect(lazy.lastIndexOf("<Deferred", at), r).toBeGreaterThan(lazy.lastIndexOf("</Deferred>", at));
    }
  });

  it("the section copy around them stays server-rendered in page.tsx", () => {
    for (const heading of ["A card they", "Everything you do.", "See who&apos;s looking.", "One brand.", "From hello to"]) {
      expect(home, heading).toContain(heading);
    }
    expect(home).not.toContain("<Deferred");
  });

  it("ScrollReveal observes elements added after load, so a deferred block is never stuck invisible", () => {
    const src = code("src/components/ScrollReveal.tsx");
    expect(src).toMatch(/new MutationObserver/);
    expect(src).toMatch(/mo\.observe\(document\.body, \{ childList: true, subtree: true \}\)/);
  });
});
