import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { buildVCard, cardContactLinks, contactInitials, escapeVCardText, escapeVCardValue, normalizeVCardUrl, pickContactImage } from "@/lib/vcard";

// A tiny 1x1 JPEG's base64 stand-in is enough to exercise the PHOTO path — the
// builder never decodes it, it only base64-frames + folds.
const SAMPLE_B64 =
  "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcU";

describe("escapeVCardValue", () => {
  it("escapes the vCard-significant characters", () => {
    expect(escapeVCardValue("Smith, John; Jr.\\")).toBe("Smith\\, John\\; Jr.\\\\");
  });
  it("collapses newlines so a value can't inject a fake field", () => {
    expect(escapeVCardValue("A\r\nTEL:911")).toBe("A TEL:911");
  });
  it("coerces null/undefined to empty string", () => {
    expect(escapeVCardValue(null)).toBe("");
    expect(escapeVCardValue(undefined)).toBe("");
  });
});

describe("normalizeVCardUrl", () => {
  it("leaves absolute URLs alone and prefixes bare domains", () => {
    expect(normalizeVCardUrl("https://swiftcard.me")).toBe("https://swiftcard.me");
    expect(normalizeVCardUrl("swiftcard.me")).toBe("https://swiftcard.me");
    expect(normalizeVCardUrl("")).toBe("");
  });
});

describe("buildVCard — structure", () => {
  it("always emits the required envelope + FN/N", () => {
    const out = buildVCard({ name: "Alex Morgan" });
    expect(out.startsWith("BEGIN:VCARD\r\nVERSION:3.0")).toBe(true);
    expect(out.trimEnd().endsWith("END:VCARD")).toBe(true);
    expect(out).toContain("FN:Alex Morgan");
    expect(out).toContain("N:Morgan;Alex;;;");
  });

  it("terminates END:VCARD with a CRLF, per RFC 6350", () => {
    // The assertion above uses trimEnd(), so it passed either way and the
    // missing terminator shipped unnoticed. Mainstream parsers tolerate it;
    // strict ones, and anything concatenating vCards into one stream, need it
    // to know where the card ends.
    const out = buildVCard({ name: "Alex Morgan" });
    expect(out.endsWith("END:VCARD\r\n")).toBe(true);
    // And exactly one — a blank line after it is not an extra record.
    expect(out.endsWith("END:VCARD\r\n\r\n")).toBe(false);
  });

  it("uses CRLF line endings", () => {
    const out = buildVCard({ name: "Alex Morgan", email: "a@b.com" });
    expect(out).toContain("\r\n");
    expect(out).not.toMatch(/[^\r]\n/); // every LF is preceded by CR
  });

  it("includes typed phones, fax, address and socials when present", () => {
    const out = buildVCard({
      name: "Alex Morgan",
      title: "CEO",
      company: "Morgan & Co.",
      email: "alex@x.com",
      phones: [
        { number: "555-1111", label: "mobile" },
        { number: "555-2222", label: "office" },
      ],
      fax: "555-3333",
      website: "morgan.com",
      address: { street: "1 Main", unit: "5", city: "NYC", state: "NY", zip: "10001" },
      linkedin: "linkedin.com/in/alex",
      instagram: "@alex",
    });
    expect(out).toContain("TITLE:CEO");
    expect(out).toContain("ORG:Morgan & Co.");
    expect(out).toContain("EMAIL;TYPE=WORK:alex@x.com");
    expect(out).toContain("TEL;TYPE=CELL,VOICE:555-1111");
    expect(out).toContain("TEL;TYPE=WORK,VOICE:555-2222");
    expect(out).toContain("TEL;TYPE=FAX:555-3333");
    expect(out).toContain("URL:https://morgan.com");
    expect(out).toContain("ADR;TYPE=WORK:;;1 Main Unit 5;NYC;NY;10001;");
    expect(out).toContain("item1.URL:https://linkedin.com/in/alex\r\nitem1.X-ABLabel:LinkedIn");
    expect(out).toContain("item2.URL:https://instagram.com/alex\r\nitem2.X-ABLabel:Instagram"); // leading @ stripped, tappable URL
  });

  it("falls back to the legacy single phone when no phones[] given", () => {
    const out = buildVCard({ name: "A B", phone: "555-9999" });
    expect(out).toContain("TEL:555-9999");
  });

  it("omits every optional field that is empty", () => {
    const out = buildVCard({ name: "Solo" });
    expect(out).not.toContain("TITLE:");
    expect(out).not.toContain("ORG:");
    expect(out).not.toContain("EMAIL");
    expect(out).not.toContain("TEL");
    expect(out).not.toContain("ADR");
    expect(out).not.toContain("PHOTO");
  });

  it("neutralizes an injection attempt in a visitor-supplied name", () => {
    const out = buildVCard({ name: "Eve\r\nTEL:911" });
    expect(out).toContain("FN:Eve TEL:911");
    expect(out).not.toMatch(/\r\nTEL:911\r\n/);
  });
});

describe("buildVCard — embedded PHOTO", () => {
  it("adds a folded vCard-3.0 PHOTO line from raw base64", () => {
    const out = buildVCard({ name: "Alex Morgan" }, { base64: SAMPLE_B64, mime: "image/jpeg" });
    expect(out).toContain("PHOTO;ENCODING=b;TYPE=JPEG:");
    // Continuation lines of a folded property start with a single space.
    const lines = out.split("\r\n");
    const photoIdx = lines.findIndex((l) => l.startsWith("PHOTO;"));
    expect(photoIdx).toBeGreaterThan(-1);
    // No source line should exceed 75 octets.
    for (const l of lines) expect(l.length).toBeLessThanOrEqual(75);
  });

  it("accepts a full data: URL and infers PNG type", () => {
    const out = buildVCard({ name: "A B" }, { base64: `data:image/png;base64,${SAMPLE_B64}` });
    expect(out).toContain("PHOTO;ENCODING=b;TYPE=PNG:");
  });

  it("omits PHOTO (and never throws) when the image is missing/garbage", () => {
    expect(buildVCard({ name: "A B" }, null)).not.toContain("PHOTO");
    expect(buildVCard({ name: "A B" }, { base64: "" })).not.toContain("PHOTO");
    expect(buildVCard({ name: "A B" }, { base64: "not base64 !!!" })).not.toContain("PHOTO");
  });

  it("saving a contact never breaks over a photo — the card is still valid", () => {
    const out = buildVCard({ name: "A B", email: "a@b.com" }, { base64: "%%%invalid%%%" });
    expect(out).toContain("BEGIN:VCARD");
    expect(out.trimEnd().endsWith("END:VCARD")).toBe(true);
    expect(out).toContain("EMAIL;TYPE=WORK:a@b.com");
  });
});

// ── The scanned contact must carry the WHOLE card ────────────────────────────
//
// The desktop QR encodes /api/card/<user>/vcard, so whatever that vCard omits
// is simply missing from the contact the scanner saves — silently, with no
// error anywhere. These pin the full payload and the link back to the card.

describe("a saved contact carries everything the card holds", () => {
  const full = {
    name: "Alex Morgan",
    title: "Realtor",
    company: "Coastline Realty",
    email: "alex@coastlinerealty.com",
    phone: "(415) 555-0188",
    fax: "(415) 555-0199",
    website: "coastlinehomes.com",
    cardUrl: "https://swiftcard.me/demo-realty",
    address: { street: "1200 Ocean Ave", unit: "4B", city: "San Francisco", state: "CA", zip: "94122" },
    linkedin: "alexmorgan",
    instagram: "@coastlinerealty",
    twitter: "@alexmorgan",
    tiktok: "@coastlinerealty",
    facebook: "facebook.com/coastlinerealty",
    snapchat: "@alexsnaps",
    youtube: "youtube.com/@coastlinetours",
    links: [
      { label: "Book a showing", url: "calendly.com/alexmorgan" },
      { label: "Listings", url: "https://coastlinehomes.com/listings" },
    ],
    note: "Bay Area realtor.\nCall any time.",
  };

  // The row for a label, with the URL it opens — iPhone pairs them by item group.
  function namedRows(out: string): Record<string, string> {
    const lines = out.split("\r\n");
    const rows: Record<string, string> = {};
    for (const l of lines) {
      const m = /^(item\d+)\.X-ABLabel:(.*)$/.exec(l);
      if (!m) continue;
      const url = lines.find((u) => u.startsWith(`${m[1]}.URL:`));
      rows[m[2]] = url ? url.slice(`${m[1]}.URL:`.length) : "";
    }
    return rows;
  }

  it("includes every field a card can hold, plus the photo", () => {
    const out = buildVCard(full, { base64: "/9j/4AAQSkZJRg==", mime: "image/jpeg" });
    for (const probe of [
      "FN:Alex Morgan",
      "TITLE:Realtor",
      "ORG:Coastline Realty",
      "EMAIL;TYPE=WORK:alex@coastlinerealty.com",
      "(415) 555-0188",
      "TEL;TYPE=FAX:",
      "URL:https://coastlinehomes.com",
      "ADR;TYPE=WORK:",
      "1200 Ocean Ave",
      "San Francisco",
      "94122",
      "NOTE:Bay Area realtor.\\nCall any time.",
      "PHOTO;ENCODING=b",
    ]) {
      expect(out, `missing from the saved contact: ${probe}`).toContain(probe);
    }
  });

  it("saves EVERY social and every Swift Links button as a named, tappable row", () => {
    // Facebook, Snapchat, YouTube and the Swift Links buttons used to be left
    // out of the contact entirely, and Instagram/X/TikTok were X-SOCIALPROFILE
    // lines that Android throws away.
    expect(namedRows(buildVCard(full))).toEqual({
      SwiftCard: "https://swiftcard.me/demo-realty",
      LinkedIn: "https://linkedin.com/in/alexmorgan",
      Instagram: "https://instagram.com/coastlinerealty",
      TikTok: "https://tiktok.com/@coastlinerealty",
      Facebook: "https://facebook.com/coastlinerealty",
      X: "https://x.com/alexmorgan",
      Snapchat: "https://snapchat.com/add/alexsnaps",
      YouTube: "https://youtube.com/@coastlinetours",
      "Book a showing": "https://calendly.com/alexmorgan",
      Listings: "https://coastlinehomes.com/listings",
    });
    expect(buildVCard(full)).not.toContain("X-SOCIALPROFILE");
  });

  it("carries the SwiftCard link so the card outlives the save", () => {
    // Without this the contact is a dead end: the design, Swift Links and
    // everything else on the card become unreachable once the sheet closes.
    expect(namedRows(buildVCard(full)).SwiftCard).toBe("https://swiftcard.me/demo-realty");
  });

  it("keeps the card link distinguishable from the personal website", () => {
    const out = buildVCard(full);
    expect(out).toContain("URL:https://coastlinehomes.com");
    expect(out.match(/^URL/gm)?.length).toBe(1); // the website; every other link is a named row
  });

  it("never saves the same link twice, and skips headers and non-links", () => {
    const rows = namedRows(buildVCard({
      name: "A B",
      website: "coastlinehomes.com",
      instagram: "@alex",
      links: [
        { label: "My site", url: "https://www.coastlinehomes.com/" },
        { label: "Insta", url: "instagram.com/alex" },
        { label: "Section", url: "", kind: "header" },
        { label: "Nothing", url: "not a link" },
        { label: "Menu", url: "menu.example.com" },
      ],
    }));
    expect(rows).toEqual({ Instagram: "https://instagram.com/alex", Menu: "https://menu.example.com" });
  });

  it("keeps every group's URL and label on adjacent, uniquely numbered lines", () => {
    const lines = buildVCard(full).split("\r\n");
    const items = lines.filter((l) => /^item\d+\./.test(l));
    expect(items.length % 2).toBe(0);
    for (let i = 0; i < items.length; i += 2) {
      const n = items[i].split(".")[0];
      expect(items[i]).toMatch(new RegExp(`^${n}\\.URL:https://`));
      expect(items[i + 1]).toMatch(new RegExp(`^${n}\\.X-ABLabel:.+`));
    }
    expect(new Set(items.map((l) => l.split(".")[0])).size).toBe(items.length / 2);
  });

  it("caps the Swift Links buttons the way the card does", () => {
    const links = [
      { label: "One", url: "one.com" },
      { label: "Head", url: "", kind: "header" },
      { label: "Two", url: "two.com" },
      { label: "Three", url: "three.com" },
    ];
    expect(cardContactLinks(links, null).map((l) => l.label)).toEqual(["One", "Two", "Three"]);
    // Free: the first FREE_MAX_LINKS entries, as sanitizeCustomizationForPlan
    // trims them for the card page — then headers drop out.
    expect(cardContactLinks(links, 2).map((l) => l.label)).toEqual(["One"]);
    expect(cardContactLinks("garbage", null)).toEqual([]);
  });

  it("omits the card link cleanly when there isn't one", () => {
    expect(buildVCard({ name: "A B" })).not.toContain("SwiftCard");
  });
});

// Owner order 2026-09-25: the contact a visitor saves carries a picture
// (headshot → logo → initials) and the Swift Links bio in Notes.
describe("saved contact — picture fallback and bio", () => {
  it("picks the headshot, then the logo, then nothing (initials are drawn)", () => {
    expect(pickContactImage("h.jpg", "l.png")).toEqual({ url: "h.jpg", kind: "headshot" });
    expect(pickContactImage("", "l.png")).toEqual({ url: "l.png", kind: "logo" });
    expect(pickContactImage(null, "  ")).toBeNull();
  });

  it("takes first + last initials", () => {
    expect(contactInitials("Alex Morgan")).toBe("AM");
    expect(contactInitials("alex j. van morgan")).toBe("AM");
    expect(contactInitials("Cher")).toBe("C");
    expect(contactInitials("  ")).toBe("");
    expect(contactInitials(null)).toBe("");
  });

  it("writes the bio into NOTE with its line breaks kept as \\n", () => {
    const out = buildVCard({ name: "A B", note: "Realtor, 10 yrs.\nCall me; anytime" });
    expect(out).toContain("NOTE:Realtor\\, 10 yrs.\\nCall me\\; anytime");
    // A raw line break can never start a new property.
    expect(escapeVCardText("x\r\nTEL:911")).toBe("x\\nTEL:911");
    expect(out.split("\r\n").some((l) => l.startsWith("Call me"))).toBe(false);
  });

  it("the card page, the button and the server vCard all carry the bio and the initials fallback", () => {
    const btn = readFileSync("src/components/SaveContactButton.tsx", "utf8");
    const route = readFileSync("src/app/api/card/[username]/vcard/route.ts", "utf8");
    const page = readFileSync("src/app/[username]/page.tsx", "utf8");
    expect(btn).toContain("note: person.bio");
    expect(btn).toContain("?? drawInitialsPhoto(person.name)");
    expect(route).toContain("note: str(custom.bio)");
    expect(route).toContain("?? (await renderInitialsPhoto(name))");
    expect(page).toMatch(/logoUrl: cardData\.logoUrl,[\s\S]{0,120}\bbio,/);
  });

  it("the page, the button and the server vCard all hand over every social and the Swift Links buttons", () => {
    const btn = readFileSync("src/components/SaveContactButton.tsx", "utf8");
    const route = readFileSync("src/app/api/card/[username]/vcard/route.ts", "utf8");
    const src = readFileSync("src/app/[username]/page.tsx", "utf8");
    const start = src.indexOf("const person = {");
    const person = src.slice(start, src.indexOf("\n  };", start));
    expect(start).toBeGreaterThan(-1);
    for (const s of ["linkedin", "instagram", "twitter", "tiktok", "facebook", "snapchat", "youtube", "links"]) {
      expect(btn, `button drops ${s}`).toContain(`${s}: person.${s}`);
    }
    for (const s of ["facebook", "snapchat", "youtube"]) {
      expect(route, `server vCard drops ${s}`).toContain(`${s}: str(custom.${s})`);
      expect(person, `card page drops ${s}`).toMatch(new RegExp(`\\n\\s+${s},`));
    }
    expect(route).toContain("links: cardContactLinks(custom.links, paid ? null : PLAN_LIMITS.FREE_MAX_LINKS)");
    expect(person).toContain("links: actionLinks,");
  });
});
