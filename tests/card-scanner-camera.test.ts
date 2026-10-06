import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// The business-card scanner's camera (owner, 2026-10-06): our own viewfinder
// with a card frame that turns green, not the phone's camera app. These are the
// parts that would quietly break it on one surface while another still works.
// The behaviour itself is driven in tests/render/card-scan-camera.interactive.test.ts.

const read = (p: string) => readFileSync(p, "utf8");
const camera = read("src/components/CardScanCamera.tsx");
const modal = read("src/components/AddContactModal.tsx");
const contacts = read("src/components/ContactsClient.tsx");
const scan = read("src/lib/scan-card.ts");

describe("CardScanCamera", () => {
  it("is a live in-page camera that plays inline (iOS would otherwise go fullscreen)", () => {
    expect(camera).toContain("getUserMedia");
    expect(camera).toContain('facingMode: { ideal: "environment" }');
    expect(camera).toMatch(/<video[\s\S]*?playsInline[\s\S]*?muted/);
  });

  it("stops the camera on close, capture and backgrounding", () => {
    expect(camera).toContain("getTracks().forEach((t) => t.stop())");
    expect(camera).toMatch(/return \(\) => \{ cancelled = true; stopStream\(\); \}/);
    expect(camera).toContain("visibilitychange");
  });

  it("sends the card crop, not the whole camera frame", () => {
    expect(camera).toMatch(/const MAX_SIDE = 1400/);
    expect(camera).toContain('canvas.toBlob(resolve, "image/jpeg"');
    expect(camera).toContain("guideRect(w, h)");
  });

  it("always has a way out when the camera can't open", () => {
    expect(camera).toContain("Choose a photo instead");
    expect(camera).toContain("iPhone Settings → SwiftCard → Camera");
  });

  it("green is a guide, not a lock: the shutter only waits for the camera, never for the frame", () => {
    expect(camera).toMatch(/disabled=\{phase !== "live"\}/);
  });
});

describe("AddContactModal wiring", () => {
  it("opens the camera from the scan button; the file input stays as the photo-library fallback", () => {
    expect(modal).toContain("<CardScanCamera");
    expect(modal).toContain("onClick={openScanner}");
    expect(modal).toMatch(/type="file"\s+accept="image\/\*"/);
    // capture= would force the camera app again and hide the photo library.
    expect(modal).not.toMatch(/capture="environment"/);
  });

  it("Free hears 'Pro' before the camera opens", () => {
    expect(modal).toMatch(/if \(canScan === false\) \{\s*setScanState\("pro"\)/);
    expect(contacts.match(/canScan=\{isPro\}/g)).toHaveLength(2);
  });

  it("the camera's crop goes up untouched; an empty read is an error, not a green tick", () => {
    expect(modal).toContain("handleScan(photo, true)");
    expect(scan).toContain("opts.prepared");
    expect(scan).toContain("throw new EmptyScanError()");
  });
});
