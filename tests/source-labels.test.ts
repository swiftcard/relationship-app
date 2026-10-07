import { describe, it, expect } from "vitest";
import { getSourceLabel, getSignupSourceLabel } from "@/lib/source-labels";

describe("getSourceLabel", () => {
  it("maps known contact sources to friendly labels", () => {
    expect(getSourceLabel("qr_code")).toBe("QR code scan");
    expect(getSourceLabel("nfc_card")).toBe("NFC tap");
    expect(getSourceLabel("direct_link")).toBe("Card link");
  });

  it("falls back to 'Not tracked' for null/undefined", () => {
    expect(getSourceLabel(null)).toBe("Not tracked");
    expect(getSourceLabel(undefined)).toBe("Not tracked");
  });

  it("humanizes an unknown source instead of showing raw snake_case", () => {
    expect(getSourceLabel("some_new_source")).toBe("some new source");
  });

  // Every source string the app actually WRITES must have a label. swift_links
  // is hardcoded by links/[username]/page.tsx on every Swift Links event, and
  // had no entry — so real leads from Swift Links displayed a lowercase
  // "swift links" via the humanize fallback.
  it("labels every source the app records", () => {
    for (const written of ["swift_links", "qr_code", "nfc_card", "direct_link", "email_signature", "create_link", "scanner", "manual", "imported"]) {
      const label = getSourceLabel(written);
      expect(label, `${written} has no SOURCE_LABELS entry`).not.toBe(written.replace(/_/g, " "));
    }
    expect(getSourceLabel("swift_links")).toBe("Swift Links");
  });
});

describe("getSignupSourceLabel", () => {
  it("defaults an empty source to the organic label", () => {
    expect(getSignupSourceLabel(null)).toContain("Organic");
    expect(getSignupSourceLabel(undefined)).toContain("Organic");
  });

  it("maps a known signup source", () => {
    expect(getSignupSourceLabel("referral")).toContain("Referral");
  });
});
