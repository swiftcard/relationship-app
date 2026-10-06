import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import QRCode from "qrcode";
import jsQR from "jsqr";
import {
  buildContactQr,
  contactPersonFromCardRow,
  contactQrColors,
  CONTACT_QR_MAX_BYTES,
} from "@/lib/contact-qr";
import { getSourceLabel } from "@/lib/source-labels";

// ── The Contact QR (lib/contact-qr.ts) ──────────────────────────────────────
//
// The one code that works with no signal on either phone: the vCard is IN the
// code, so the scanning phone's camera saves the contact without internet.
// These pin that the code decodes back to exactly what was meant, holds the
// same contact Save Contact hands over, and stays scannable when a card is full.

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const bytes = (s: string) => new TextEncoder().encode(s).length;

/** Encode at level M exactly as MiniQR does, rasterize, and read it back. */
function decode(text: string): string | null {
  const qr = QRCode.create(text, { errorCorrectionLevel: "M" });
  const n = qr.modules.size;
  const scale = 4;
  const quiet = 4;
  const w = (n + quiet * 2) * scale;
  const px = new Uint8ClampedArray(w * w * 4).fill(255);
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (!qr.modules.data[r * n + c]) continue;
      for (let y = 0; y < scale; y++) {
        for (let x = 0; x < scale; x++) {
          const i = (((r + quiet) * scale + y) * w + (c + quiet) * scale + x) * 4;
          px[i] = px[i + 1] = px[i + 2] = 0;
        }
      }
    }
  }
  return jsQR(px, w, w)?.data ?? null;
}

const FULL_ROW = {
  username: "alexmorgan",
  name: "Alex Morgan",
  title: "Senior Sales Director",
  company: "Coastline Realty Group",
  email: "alex.morgan@coastlinerealty.com",
  phone: "(415) 555-0100",
  website: "coastlinehomes.com",
  customization: {
    phones: [
      { number: "(415) 555-0188", label: "mobile", showOnCard: true },
      { number: "(415) 555-0199", label: "Office", showOnCard: true },
    ],
    address: { street: "1200 Ocean Ave", unit: "Suite 4", city: "San Francisco", state: "CA", zip: "94122" },
  },
};

describe("the Contact QR's contact", () => {
  const person = contactPersonFromCardRow(FULL_ROW, "https://swiftcard.me")!;
  const vcard = buildContactQr(person);

  it("is a vCard the phone camera recognises", () => {
    expect(vcard.startsWith("BEGIN:VCARD\r\nVERSION:3.0\r\n")).toBe(true);
    expect(vcard.endsWith("\r\nEND:VCARD")).toBe(true);
  });

  it("carries what the card's Save Contact carries, minus what can't fit in a code", () => {
    expect(vcard).toContain("FN:Alex Morgan");
    expect(vcard).toContain("N:Morgan;Alex;;;");
    expect(vcard).toContain("TITLE:Senior Sales Director");
    expect(vcard).toContain("ORG:Coastline Realty Group");
    expect(vcard).toContain("TEL;TYPE=CELL:(415) 555-0188");
    // Typed like buildVCard: an "Office" label, any case, is a WORK number.
    expect(vcard).toContain("TEL;TYPE=WORK:(415) 555-0199");
    expect(vcard).toContain("EMAIL;TYPE=WORK:alex.morgan@coastlinerealty.com");
    expect(vcard).toContain("URL:https://coastlinehomes.com");
    expect(vcard).toContain("ADR;TYPE=WORK:;;1200 Ocean Ave");
    // No photo, bio or socials: a QR has no room, and they'd make it unscannable.
    expect(vcard).not.toMatch(/PHOTO|NOTE|X-SOCIALPROFILE/);
  });

  it("keeps the door back to the full card, tagged so those visits are attributed", () => {
    expect(vcard).toContain("URL;type=SwiftCard:https://swiftcard.me/alexmorgan?source=contact_qr");
    expect(getSourceLabel("contact_qr")).toBe("Contact QR");
  });

  it("decodes back to exactly the vCard, at the level MiniQR draws", () => {
    expect(decode(vcard)).toBe(vcard);
  });

  it("reads its fields from the same places the server vCard route does", () => {
    // Parity with src/app/api/card/[username]/vcard/route.ts: phones and the
    // address live in customization, everything else on the row.
    const route = read("src/app/api/card/[username]/vcard/route.ts");
    for (const f of ["custom.phones", "custom.address", "c.title", "c.company", "c.email", "c.phone", "c.website"]) {
      expect(route, f).toContain(f);
    }
    const lib = read("src/lib/contact-qr.ts");
    for (const f of ["custom.phones", "custom.address", "row.title", "row.company", "row.email", "row.phone", "row.website"]) {
      expect(lib, f).toContain(f);
    }
  });
});

describe("a very full card stays scannable", () => {
  const huge = {
    ...FULL_ROW,
    title: "Executive Vice President of Strategic Partnerships and Business Development",
    company: "The Extremely Long Named International Holdings Company of North America, Incorporated",
    email: "firstname.middlename.lastname.department@very-long-company-domain-name.example.com",
    website: "https://www.very-long-company-domain-name.example.com/about/our-team/executive-leadership",
    customization: {
      phones: Array.from({ length: 6 }, (_, i) => ({ number: `+1 (415) 555-01${10 + i} ext. 1234`, label: i ? "mobile" : "Office", showOnCard: true })),
      address: { street: "12345 Some Extraordinarily Long Boulevard Name", unit: "Floor 42, Suite 4200", city: "South San Francisco", state: "California", zip: "94080-1234" },
    },
  };
  const vcard = buildContactQr(contactPersonFromCardRow(huge, "https://swiftcard.me")!);

  it("fits the byte budget by dropping the least-needed fields first", () => {
    expect(bytes(vcard)).toBeLessThanOrEqual(CONTACT_QR_MAX_BYTES);
    expect(vcard).not.toContain("ADR;");
    expect(vcard).not.toMatch(/^URL:/m);
    // Name, a way to reach them, and the card link always stay.
    expect(vcard).toContain("FN:Alex Morgan");
    expect(vcard).toMatch(/TEL;TYPE=(CELL|WORK):/);
    expect(vcard).toContain("URL;type=SwiftCard:");
    expect(decode(vcard)).toBe(vcard);
  });

  it("never reaches a code too dense for a phone screen (≤ version 16 at level M)", () => {
    expect(QRCode.create(vcard, { errorCorrectionLevel: "M" }).version).toBeLessThanOrEqual(16);
  });
});

describe("escaping", () => {
  it("a comma, semicolon or newline in a field can't add or shift vCard fields", () => {
    const v = buildContactQr(contactPersonFromCardRow({
      username: "x", name: "Ann; Lee", company: "A, B\r\nTEL:999", customization: {},
    }, "https://swiftcard.me")!);
    expect(v).toContain("FN:Ann\\; Lee");
    expect(v).toContain("ORG:A\\, B TEL:999");
    expect(v.split("\r\n").filter((l) => l.startsWith("TEL"))).toEqual([]);
  });

  it("no card slug → no contact (never a code pointing nowhere)", () => {
    expect(contactPersonFromCardRow({ name: "No Slug" }, "https://swiftcard.me")).toBeNull();
  });
});

describe("colours", () => {
  it("keeps the card's QR colours when they contrast enough for a dense code", () => {
    expect(contactQrColors("#ffffff", "#0d1b3e")).toEqual({ bg: "#ffffff", fg: "#0d1b3e" });
  });
  it("falls back to dark on white when they don't, or when the code is inverted", () => {
    expect(contactQrColors("#ffffff", "#9ca3af")).toEqual({ bg: "#ffffff", fg: "#111827" });
    expect(contactQrColors("#0d1b3e", "#ffffff")).toEqual({ bg: "#ffffff", fg: "#111827" });
    expect(contactQrColors("rgb(0,0,0)", "#fff")).toEqual({ bg: "#ffffff", fg: "#111827" });
  });
});
