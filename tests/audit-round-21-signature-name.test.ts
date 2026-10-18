import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { SIGNATURE_CAPTURE_VERSION } from "@/lib/share-capture-version";

// ── Audit round 21 (2026-10-18): the image every email points at, and a card
//    that always has a name ─────────────────────────────────────────────────
//
// C02-002  The signature route took any base64 labelled PNG: no capture
//          version, no PNG check, no shape check. The image is hot-linked from
//          every email ever sent, so a stale tab's broken capture replaced it
//          everywhere within a minute.
// C02-010  The signature capture skipped the pixel check (name, logo, headshot
//          actually painted) that the share preview and Download PNG run.
// C02-005  PATCH /api/cards/[id] accepted an empty name; creating refuses it.

const read = (p: string) => readFileSync(p, "utf8");

describe("C02-002: the signature route stores only a verified card picture", () => {
  const route = read("src/app/api/card-signature/route.ts");

  it("refuses capture code older than the pixel-verified one", () => {
    expect(SIGNATURE_CAPTURE_VERSION).toBeGreaterThanOrEqual(1);
    expect(route).toContain("if (typeof v !== \"number\" || v < SIGNATURE_CAPTURE_VERSION) {");
    expect(route).toContain('{ error: "outdated capture" }, { status: 409 }');
  });

  it("refuses anything that is not a card-shaped PNG, before it is stored", () => {
    expect(route).toContain("buffer.readUInt32BE(0) !== 0x89504e47");
    expect(route).toContain("if (pngW < 300 || ratio < 1.25 || ratio > 2.4) {");
    expect(route.indexOf('"not card-shaped"')).toBeLessThan(route.indexOf("uploadToPublicBucket(admin"));
  });
});

describe("C02-010: the signature capture checks its pixels like the share capture", () => {
  const box = read("src/components/EmailSignatureBox.tsx");

  it("runs capturePainted (with a retake) before uploading, and sends its version", () => {
    const check = box.indexOf('if (!(await capturePainted(el, cardData.name ?? "", dataUrl, w, raster))) { setCapture("error"); return null; }');
    expect(check).toBeGreaterThan(0);
    expect(check).toBeLessThan(box.indexOf('fetch("/api/card-signature"'));
    expect(box).toContain("JSON.stringify({ dataUrl, username, v: SIGNATURE_CAPTURE_VERSION })");
  });
});

describe("C02-005: an edit can't leave a card without a name", () => {
  it("PATCH refuses an empty or blank name, as creating does", () => {
    const patch = read("src/app/api/cards/[id]/route.ts");
    expect(patch).toContain('if ("name" in updates && (typeof updates.name !== "string" || !updates.name.trim())) {');
    expect(read("src/app/api/cards/route.ts")).toContain('if (typeof name !== "string" || !name.trim()) {');
  });
});
