import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { withSource, qrScanUrl } from "@/lib/share-source";
import { SOURCE_LABELS } from "@/lib/source-labels";

const root = process.cwd();
const code = (p: string) =>
  readFileSync(join(root, p), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

// Every QR of a card must encode ?source=qr_code, or the scan lands in Traffic
// as "Card link" and the QR figure reads zero forever. Three surfaces render a
// QR now, so the rule lives in one module and these keep it there.

describe("share-source tagging", () => {
  it("appends the marker to a bare URL", () => {
    expect(withSource("https://swiftcard.me/card/alex", "qr_code"))
      .toBe("https://swiftcard.me/card/alex?source=qr_code");
  });

  it("uses & when the URL already has a query string", () => {
    expect(withSource("https://swiftcard.me/card/alex?x=1", "qr_code"))
      .toBe("https://swiftcard.me/card/alex?x=1&source=qr_code");
  });

  it("qrScanUrl is withSource pinned to the QR marker", () => {
    expect(qrScanUrl("https://swiftcard.me/card/alex"))
      .toBe("https://swiftcard.me/card/alex?source=qr_code");
  });

  it("the marker it writes is a key Traffic can actually label", () => {
    // A typo here would be invisible: the visit still records, just under an
    // unknown source. Bind the writer to the reader.
    const marker = qrScanUrl("https://x.test").split("source=")[1];
    expect(Object.keys(SOURCE_LABELS)).toContain(marker);
    expect(SOURCE_LABELS[marker as keyof typeof SOURCE_LABELS]).toBe("QR code scan");
  });
});

describe("every QR surface goes through the shared helper", () => {
  it("the share modal does", () => {
    const c = code("src/components/MoreShareOptions.tsx");
    expect(c).toMatch(/qrScanUrl\(url\)/);
    expect(c, "a local copy of the tagging rule is back").not.toMatch(/function withSource/);
  });

  it("the dashboard's full-screen card does — its printed QR is what gets scanned", () => {
    // "Scan to connect (QR)" was replaced by tapping the card (owner,
    // 2026-09-29). The QR on the card encodes data.cardUrl, so the full-screen
    // copy must hand the template a TAGGED url or every scan reads "Card link".
    const c = code("src/components/CardPreviewDownload.tsx");
    expect(c).toMatch(/<CardFullscreen[\s\S]{0,200}cardUrl: qrScanUrl\(shown\.cardUrl\)/);
  });

  it("the old Scan-to-connect popup is gone, not left orphaned", () => {
    expect(existsSync(join(root, "src/components/ScanToConnectButton.tsx"))).toBe(false);
    expect(code("src/components/CardPreviewDownload.tsx")).not.toMatch(/ScanToConnectButton/);
  });

  it("but NFC gets the PLAIN url — it tags itself", () => {
    // NFCWriter appends ?source=nfc_card ONLY when the caller passed no query
    // string. Hand it the QR-tagged URL and it silently skips its own tag, so
    // every tap lands in Traffic as a QR scan.
    const c = code("src/components/MoreShareOptions.tsx");
    expect(c).toMatch(/<NFCWriter url=\{url\}/);
    expect(c, "NFC taps would be recorded as QR scans").not.toMatch(/<NFCWriter url=\{qrUrl\}/);
  });
});

describe("the mobile card panel swaps QR and download", () => {
  const preview = () => code("src/components/CardPreviewDownload.tsx");
  const share = () => code("src/components/MoreShareOptions.tsx");

  it("the card PICTURE is inert, so its links are not controls buried under the tap target", () => {
    // Nightly QA (issue #47, 2026-09-29): the preview card's phone and email
    // links were reported as covered by "Show your card full screen". They
    // were never tappable (pointer-events-none) but could take keyboard focus.
    // The QA sweeps treat an [inert] subtree as a picture and skip it.
    expect(preview()).toMatch(/ref=\{cardRef\}\s+inert\s+className="pointer-events-none"/);
    expect(code("src/components/CardFullscreen.tsx")).toMatch(/ref=\{cardRef\}\s+inert\s+className="pointer-events-none"/);
  });

  it("on the card: full-screen tap on mobile, and no download under it anywhere", () => {
    const c = preview();
    expect(c).toMatch(/onClick=\{\(\) => setFullscreen\(true\)\}[\s\S]{0,160}className="lg:hidden absolute inset-0/);
    // Owner, 2026-10-07: the desktop kept a Download under the card after
    // Other ways to share offered "Download card (PNG)" at every width — two
    // card downloads on a computer, one on a phone. The card box is just the
    // card now; the picture is saved from the share options on every device.
    expect(c, "a Download is back under the dashboard card").not.toMatch(/<DownloadCardButton/);
  });

  it("splits at lg, the width where the whole panel moves", () => {
    // The dashboard renders this panel under My Cards below lg and in the
    // sticky right column above it. Splitting the controls at sm: would put a
    // desktop control inside the mobile-positioned panel on a tablet.
    const c = preview();
    expect(c, "the control split no longer matches the panel's own breakpoint").not.toMatch(
      /className="sm:hidden absolute inset-0/,
    );
  });

  it("in the share modal: one list at every width, Wallet first, no QR picture", () => {
    // Owner, 2026-10-06. Show QR already shows the code full size.
    const c = share();
    expect(c).not.toMatch(/lg:hidden|hidden lg:block|<QRCard/);
    const at = (s: string) => c.indexOf(`data-share-option="${s}"`);
    expect(at("wallet")).toBeGreaterThan(-1);
    expect(at("wallet")).toBeLessThan(at("pictures"));
    expect(at("pictures")).toBeLessThan(at("link"));
    expect(at("link")).toBeLessThan(at("nfc"));
  });

  it("the card download is labelled, not a bare 'Download'", () => {
    // It sits directly above "Download QR (PNG)"; two buttons where one says
    // only "Download" is a coin flip.
    expect(share()).toMatch(/label="Download card \(PNG\)"/);
  });

  it("DownloadCardButton's label override leaves the busy states alone", () => {
    const c = code("src/components/DownloadCardButton.tsx");
    expect(c).toMatch(/const idleLabel = labelOverride \?\?/);
    expect(c).toMatch(/loading \? "Saving…"/);
  });
});

describe("the capture context is scoped per panel copy, not per page", () => {
  it("the provider wraps the panel fragment", () => {
    const c = code("src/app/dashboard/page.tsx");
    expect(c).toMatch(/const cardSharePanel = \(\s*<CardCaptureProvider>/);
  });

  it("and the panel is still rendered in both layout slots", () => {
    // Two copies, one display:none. If the provider were hoisted above both,
    // the hidden card could register last and the modal would rasterize a
    // display:none node — a blank PNG.
    const c = code("src/app/dashboard/page.tsx");
    expect((c.match(/\{cardSharePanel\}/g) ?? []).length).toBe(2);
  });

  it("consumers must tolerate a missing provider", () => {
    // /preview renders the share modal with its card in an <iframe>; there is
    // nothing to capture, so the hook has to return null rather than throw.
    const c = code("src/components/CardCaptureContext.tsx");
    expect(c).toMatch(/useContext\(Ctx\)\?\.capture \?\? null/);
    expect(code("src/components/MoreShareOptions.tsx")).toMatch(/\{capture && \(/);
  });

  it("registration is undone on unmount", () => {
    const c = code("src/components/CardCaptureContext.tsx");
    expect(c).toMatch(/return \(\) => register\(null\)/);
  });
});
