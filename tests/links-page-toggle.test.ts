import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { TOUR_STEPS } from "@/lib/tour-steps";

// The Links page (/share) is a Swift Links | Swift Signature switch (owner,
// 2026-10-07: the two stacked boxes left first-timers unsure what the page was
// for). The layout itself is measured in tests/render/links-page-tabs; this
// pins the wiring a render can't see — the pieces that each break something
// quietly when they go.

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const tabs = read("src/components/LinksPageTabs.tsx");
const share = read("src/app/share/page.tsx");
const sig = read("src/components/EmailSignatureBox.tsx");

describe("Links page: Swift Links | Swift Signature switch", () => {
  it("is a real tab list: roles, selection, the panels it controls", () => {
    expect(tabs).toContain('role="tablist"');
    expect(tabs).toContain('role="tab"');
    expect(tabs).toContain("aria-selected={on}");
    expect(tabs).toContain("aria-controls={`links-panel-${t.id}`}");
    expect(tabs.match(/role="tabpanel"/g)?.length).toBe(2);
    // Arrow keys move between sides, with a roving tabindex.
    expect(tabs).toMatch(/ArrowRight[\s\S]*ArrowLeft/);
    expect(tabs).toContain("tabIndex={on ? 0 : -1}");
  });

  it("keeps BOTH sides mounted and hides the other — nothing resets on a switch", () => {
    expect(tabs).toContain('hidden={tab !== "links"}');
    expect(tabs).toContain('hidden={tab !== "signature"}');
  });

  it("the #hash picks the side — read in an effect, written without a history entry", () => {
    // Never from initial state: the server can't see a hash (hydration mismatch).
    expect(tabs).toMatch(/useState<LinksTab>\("links"\)/);
    expect(tabs).toMatch(/useEffect\(\(\) => \{\s*if \(!syncHash\) return;[\s\S]*addEventListener\("hashchange"/);
    expect(tabs).toContain("window.history.replaceState(");
    expect(tabs).not.toContain("history.pushState");
  });

  it("the guided tour opens the right side for each Links step", () => {
    const links = TOUR_STEPS.find((s) => s.id === "swift-links");
    const signature = TOUR_STEPS.find((s) => s.id === "email-signature");
    expect(links?.section).toBe("links");
    expect(signature?.section).toBe("signature");
    // The anchors stay literal in the page, where the tour scans for them.
    expect(share).toContain('data-tour="swift-links"');
    expect(share).toContain('data-tour="email-signature"');
  });

  it("the signature capture card is portaled to <body> — a hidden side has no layout", () => {
    // Inside the hidden Swift Signature panel the offscreen card measured 0 and
    // the capture fell back to a 460×460 square, uploaded as the image every
    // follow-up email embeds.
    expect(sig).toMatch(/createPortal\(\s*<div aria-hidden inert[\s\S]*?document\.body,?\s*\)/);
  });

  it("the signature is in place: no pop-up, and a 404'd image never captures during hydration", () => {
    expect(sig).not.toMatch(/useState\(false\);\s*\/\/.*open|const \[open, setOpen\]/);
    expect(sig).not.toContain('className="fixed inset-0');
    const onImgError = sig.slice(sig.indexOf("function onImgError()"), sig.indexOf("function finishCopy("));
    // Deferred in the background, immediate only when the side is on screen.
    expect(onImgError).toContain("scheduleCapture(onScreen ? 0 : 1500)");
    expect(onImgError).not.toMatch(/\bcaptureAndUpload\(\)/);
  });

  it("the preview image is never lazy — it is hidden until loaded, and a hidden lazy image never loads", () => {
    // 2026-10-07: loading="lazy" + display:none-until-loaded left the box on
    // "Generating your card…" for good, with Copy greyed out.
    const img = sig.match(/<img src=\{src\}[^>]*\/>/)?.[0] ?? "";
    expect(img, "preview <img> not found").not.toBe("");
    expect(img).not.toContain("loading=");
  });

  it("Copy is always tappable and asks for the clipboard inside the tap", () => {
    // Never gated on the preview or a background capture…
    expect(sig).toContain('disabled={copyState === "copying" || copyState === "generating"}');
    expect(sig).not.toMatch(/disabled=\{!ready/);
    // …and the write is requested synchronously, with the image as a promise
    // when it still has to be generated (WebKit only allows it in the tap).
    const copy = sig.slice(sig.indexOf("  function copy() {"), sig.indexOf("const onLoad"));
    expect(copy).not.toMatch(/^\s*async function copy/m);
    expect(copy).toContain('new ClipboardItem({ "text/html": need(html), "text/plain": need(() => text()) })');
    expect(copy.indexOf("navigator.clipboard.write([item])")).toBeLessThan(copy.indexOf("write.then("));
    // One capture at a time, shared.
    expect(sig).toMatch(/if \(captureRef\.current\) return captureRef\.current;/);
  });

  it("a device that captured this exact card copies without capturing again", () => {
    expect(sig).toContain("const urlKey = `sc_sigurl_${username}`;");
    expect(sig).toMatch(/if \(prev === contentSig\) \{[\s\S]*?lastUrlRef\.current = url;[\s\S]*?lastSigRef\.current = contentSig;/);
    expect(sig).toContain("localStorage.setItem(urlKey, url);");
  });

  it("the re-copy warning still reaches someone on the Swift Links side", () => {
    expect(sig).toMatch(/dispatchEvent\(new CustomEvent\(SIGNATURE_STALE_EVENT, \{ detail: changedSinceCopy \}\)\)/);
    expect(tabs).toContain("addEventListener(SIGNATURE_STALE_EVENT");
    expect(tabs).toContain("(needs updating)");
  });

  it("/share#signature survives the card redirect", () => {
    expect(read("src/components/ShareCardResolver.tsx")).toContain("${window.location.hash}");
  });

  it("Edit my links opens the editor on Socials", () => {
    expect(share).toContain("href={`/cards/${activeCard.id}/edit?tab=sharing`}");
    expect(read("src/app/cards/[id]/edit/page.tsx")).toMatch(/tab === "sharing" \? \("sharing" as const\)/);
  });

  it("the Swift Links mini phone is fed like the live page — never the whole customization", () => {
    // Only the link-design keys reach the browser, colour/font CSS-guarded.
    expect(share).toContain("[...LINK_STYLE_KEYS, ...LINK_STRUCTURAL_KEYS]");
    expect(share).toContain("safeCssValue(linkStyle.linkBgColor)");
    expect(share).toContain("safeFontValue(linkStyle.linkFontFamily)");
    expect(share).toContain("cardHeadshot(activeCard.customization, profile.photo_url)");
    expect(share).toMatch(/Array\.isArray\(linkCust\.links\)/);
    // An overlay link, not a wrapping one: the preview holds the page's own <a>s.
    expect(share).toMatch(/aria-label="Open your Swift Links page"\s+className="absolute inset-0"/);
  });

  it("the welcome email's signature step lands on the signature side", () => {
    expect(read("src/lib/email-templates.ts")).toContain("const shareUrl = `${APP_URL}/share#signature`;");
  });
});
