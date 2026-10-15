import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildCardData, formatCardAddress, cardInitials } from "@/lib/card-data";
import { META, FALLBACK_META, freeSafeValues } from "@/lib/template-style-presets";

// The Swift Signature has to look IDENTICAL to the card. It cannot, while being
// a second implementation of the card.
//
// It was one: five files each built their own CardData from a card row, and
// they had already drifted — /share read snapchat and address out of the RAW
// customization where /card read them out of the plan-sanitized one, and the
// dashboard omitted snapchat altogether. These tests pin the two halves of the
// fix: the builder does the right thing, and the surfaces all go through it.

const src = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

const CARD = {
  name: "Aaron Lavi",
  title: "Director of Originations",
  company: "Malve Capital",
  phone: "4048550515",
  email: "aaron@malvecapital.com",
  website: "malvecapital.com",
  instagram: "@aaronlavi",
  linkedin: "linkedin.com/in/aaronlavi",
  twitter: "@aaron_lavi",
  tiktok: "@aaronlavi",
  username: "aaron-lavi",
  logo_url: "https://cdn/logo.png",
  template: "logo-first",
  customization: {
    snapchat: "@aaronsnap",
    address: { street: "26 Harbor Park Dr", unit: "4B", city: "Port Washington", state: "NY", zip: "11050" },
    accentColor: "#b08d57",
  },
};
const OPTS = { appUrl: "https://swiftcard.me", isPro: true, accountPhotoUrl: null };

describe("every surface builds the same card", () => {
  it("is byte-identical for the same row and options", () => {
    // Whatever the surfaces are, they call this with the same inputs — so the
    // only thing that could make them differ is the function being impure.
    const a = buildCardData(CARD, OPTS);
    const b = buildCardData(CARD, OPTS);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("carries snapchat — the field the dashboard used to drop", () => {
    expect(buildCardData(CARD, OPTS).data.snapchat).toBe("@aaronsnap");
  });

  it("takes snapchat and address from the SANITIZED blob, like the card page", () => {
    // On Free the sanitizer may rewrite design keys. Whatever it does, both
    // fields have to come from its output, because that is what the public card
    // renders — reading them from the raw blob is how /share drifted.
    const free = buildCardData(CARD, { ...OPTS, isPro: false });
    expect(free.data.snapchat).toBe(free.customization.snapchat ?? "");
    expect(free.data.address).toBe(formatCardAddress(free.customization.address));
  });

  it("plan-gates the template the same way for everyone", () => {
    const custom = { ...CARD, template: "custom" };
    expect(buildCardData(custom, { ...OPTS, isPro: true }).template).toBe("custom");
    expect(buildCardData(custom, { ...OPTS, isPro: false }).template).toBe("classic-pro");
  });

  it("sanitizes with the card's OWN template, not a default", () => {
    // On Free, colours snap to the nearest preset OF THE CARD'S TEMPLATE.
    // Passing the wrong template is what made a Free card's signature and its
    // live card land on different colours — so the invariant is that the
    // result belongs to the right template's palette, whatever that palette is.
    for (const template of ["luxury-minimal", "classic-pro", "modern-bold"]) {
      const out = buildCardData(
        { ...CARD, template, customization: { ...CARD.customization, accentColor: "#00ff88" } },
        { ...OPTS, isPro: false },
      );
      const meta = META[template] ?? FALLBACK_META;
      // Its own palette: the swatches plus the accents its Looks offer.
      expect(freeSafeValues(meta, "accent"), `${template} snapped outside its own palette`)
        .toContain(out.data.customization?.accentColor);
    }
  });
});

describe("nothing bleeds in from the account", () => {
  it("reads every rendered field from the CARD row", () => {
    const other = { ...CARD, name: "", title: "", company: "", phone: "", email: "", website: "" };
    const { data } = buildCardData(other, OPTS);
    for (const v of [data.name, data.title, data.company, data.phone, data.email, data.website]) {
      expect(v).toBe("");
    }
  });

  it("uses the account photo ONLY for a card that never set one", () => {
    const legacy = { ...CARD, customization: { ...CARD.customization } };
    expect(buildCardData(legacy, { ...OPTS, accountPhotoUrl: "acct.jpg" }).data.photoUrl).toBe("acct.jpg");
  });

  it("a card that set photoUrl to null shows NOTHING, not the account photo", () => {
    // This is the exact bleed: a second card that never uploaded a headshot was
    // showing the first card's face.
    const owned = { ...CARD, customization: { ...CARD.customization, photoUrl: null } };
    expect(buildCardData(owned, { ...OPTS, accountPhotoUrl: "acct.jpg" }).data.photoUrl).toBeNull();
  });

  it("a card with its own photo keeps it", () => {
    const owned = { ...CARD, customization: { ...CARD.customization, photoUrl: "mine.jpg" } };
    expect(buildCardData(owned, { ...OPTS, accountPhotoUrl: "acct.jpg" }).data.photoUrl).toBe("mine.jpg");
  });

  it("the card URL is the CARD's username", () => {
    expect(buildCardData(CARD, OPTS).data.cardUrl).toBe("swiftcard.me/aaron-lavi");
  });
});

describe("the derivations that used to be copy-pasted", () => {
  it("joins an address into the three lines the templates expect", () => {
    expect(formatCardAddress(CARD.customization.address))
      .toBe("26 Harbor Park Dr, Unit 4B\nPort Washington\nNY 11050");
  });

  it("survives a missing or empty address", () => {
    expect(formatCardAddress(undefined)).toBe("");
    expect(formatCardAddress({})).toBe("");
  });

  it("derives initials, and falls back rather than rendering empty", () => {
    expect(cardInitials("Aaron Lavi")).toBe("AL");
    expect(cardInitials("Cher")).toBe("C");
    expect(cardInitials("  ")).toBe("SC");
    expect(cardInitials(null)).toBe("SC");
  });
});

describe("the surfaces actually go through the builder", () => {
  // Source scan, because the value of the refactor is that NOBODY hand-rolls a
  // CardData again. A new copy would pass every test above while reintroducing
  // exactly the drift they exist to prevent.
  const SURFACES = [
    "src/app/[username]/page.tsx",
    "src/app/share/page.tsx",
    "src/app/dashboard/page.tsx",
  ];

  for (const f of SURFACES) {
    it(`${f} calls buildCardData`, () => {
      expect(src(f)).toMatch(/buildCardData\(/);
    });

    it(`${f} does not hand-roll a card object`, () => {
      // `initials:` appears in every hand-written CardData literal and in none
      // that come from the builder.
      expect(src(f), "a hand-rolled CardData is back").not.toMatch(/^\s*initials:/m);
    });
  }
});
