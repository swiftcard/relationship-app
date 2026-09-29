import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pinOfficeLinks, overlayOfficeLinks, overlayOfficeInstagram, releaseOfficeLinks, OWN_BIO, OWN_INSTAGRAM } from "@/lib/office-brand";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

// ── The office's link buttons are ADDITIVE ──────────────────────────────────
//
// An earlier version of this was an all-or-nothing freeze: "only you can add
// link buttons", and a member could touch nothing. That was the wrong shape.
// An office wants its booking link on every page — not to stop a salesperson
// linking their own calendar. So the office PINS links, they lead the list and
// cannot be edited or removed by the member, and everything the member adds
// follows and stays theirs.

const OFFICE = [
  { label: "Book a meeting", url: "https://northwind.com/book" },
  { label: "Our listings", url: "https://northwind.com/listings" },
];
const brand = { links: OFFICE };

describe("pinOfficeLinks", () => {
  it("puts the office's links first and keeps the member's after", () => {
    const out = pinOfficeLinks([{ label: "My calendar", url: "https://cal.com/sam" }], brand) as { label: string; url: string }[];
    expect(out.map((l) => l.url)).toEqual([
      "https://northwind.com/book",
      "https://northwind.com/listings",
      "https://cal.com/sam",
    ]);
  });

  it("re-pins a link the member deleted", () => {
    // Their payload simply omits it; the office's own record puts it back.
    const out = pinOfficeLinks([{ label: "My calendar", url: "https://cal.com/sam" }], brand) as { url: string }[];
    expect(out.some((l) => l.url === "https://northwind.com/book")).toBe(true);
  });

  it("cannot be claimed by renaming it", () => {
    // Identity is the URL. Matching on label would let a member rename an
    // office link into "theirs" — and then remove it.
    const out = pinOfficeLinks([{ label: "Sam's own booking page", url: "https://northwind.com/book" }], brand) as { label: string }[];
    expect(out.filter((l) => l.label === "Sam's own booking page")).toHaveLength(0);
    expect(out[0].label).toBe("Book a meeting");
  });

  it("does not duplicate on a trailing slash or different case", () => {
    const out = pinOfficeLinks([{ label: "dupe", url: "https://Northwind.com/book/" }], brand) as unknown[];
    expect(out).toHaveLength(2);
  });

  it("never reorders the office's links, whatever order they arrive in", () => {
    const out = pinOfficeLinks(
      [{ label: "x", url: "https://northwind.com/listings" }, { label: "y", url: "https://northwind.com/book" }],
      brand,
    ) as { url: string }[];
    expect(out.map((l) => l.url)).toEqual(["https://northwind.com/book", "https://northwind.com/listings"]);
  });

  it("leaves a member alone when the office has pinned nothing", () => {
    const own = [{ label: "Mine", url: "https://mine.example" }];
    expect(pinOfficeLinks(own, { links: null })).toBe(own);
    expect(pinOfficeLinks(own, null)).toBe(own);
  });

  it("survives junk without throwing", () => {
    for (const junk of [null, undefined, "nope", 42, [null], [{}]]) {
      expect(() => pinOfficeLinks(junk, brand)).not.toThrow();
    }
    expect((pinOfficeLinks(null, brand) as unknown[]).length).toBe(2);
  });

  it("never mutates what it was given", () => {
    const own = [{ label: "Mine", url: "https://mine.example" }];
    const before = JSON.stringify(own);
    pinOfficeLinks(own, brand);
    expect(JSON.stringify(own)).toBe(before);
    // And the returned office entries are copies, so a caller cannot edit the
    // brand through them.
    const out = pinOfficeLinks(own, brand) as { label: string }[];
    out[0].label = "tampered";
    expect(OFFICE[0].label).toBe("Book a meeting");
  });
});

describe("the server pins them — the UI is not the boundary", () => {
  it("on save, sub-users only", () => {
    const route = read("src/app/api/cards/[id]/route.ts");
    expect(route).toMatch(/if \(subCtx && brand && updates\.customization\)/);
    expect(route).toMatch(/overlayOfficeLinks\(updates\.customization as Record<string, unknown>, brand\)/);
  });

  it("on a new member card too", () => {
    const route = read("src/app/api/cards/route.ts");
    expect(route).toMatch(/if \(subCtx\) \{\s*\n\s*cust = overlayOfficeLinks\(/);
    // …and the Instagram slot is resolved through the same helper, so a new
    // card preserves the member's handle exactly like an existing one.
    expect(route).toMatch(/officeInstagram = ig\.instagram/);
  });

  it("forces the office Instagram as a TOP-LEVEL column, not a customization key", () => {
    // cards.instagram is a real column. Writing customization.instagram would
    // have created a second copy that the links page never reads.
    // Resolved through overlayOfficeInstagram now rather than assigned raw, so
    // the member's own handle is stashed before the office's takes the slot.
    // What must still hold: it is written to the COLUMN, never customization.
    const idRoute = read("src/app/api/cards/[id]/route.ts");
    expect(idRoute).toMatch(/updates\.instagram = out\.instagram/);
    expect(idRoute).toMatch(/overlayOfficeInstagram\(/);
    // The STORED handle is what gets stashed — a submitted one is the company's.
    expect(idRoute).toMatch(/\.select\("instagram"\)/);
    expect(idRoute, "customization.instagram is a second, silently ignored copy")
      .not.toMatch(/customization\.instagram\s*=/);
    // The create route resolves the slot through the same helper: `officeInstagram`
    // is set only when an office owns it, and falls back to what the member typed.
    expect(read("src/app/api/cards/route.ts")).toMatch(/instagram: officeInstagram \?\? normalizeSocial\(/);
    const lib = read("src/lib/office-brand.ts");
    const fn = lib.slice(lib.indexOf("export function overlayOfficeLinks"), lib.indexOf("// ── Pure overlay: apply the company-controlled contact"));
    expect(fn, "the overlay is writing a customization.instagram copy").not.toMatch(/cust\.instagram =/);
  });

  it("no longer freezes a member's whole list", () => {
    // The old behaviour. A member must be able to add and remove their OWN
    // links while the office's stay put.
    for (const p of ["src/app/api/cards/[id]/route.ts", "src/app/api/cards/route.ts"]) {
      expect(read(p), `${p} still carries the old all-or-nothing lock`).not.toContain("lockLinks");
    }
  });
});

describe("the member can tell which links are theirs", () => {
  const form = read("src/app/cards/[id]/edit/CardEditForm.tsx");

  it("marks the office's links and gives them no remove control", () => {
    // A remove button the server undoes on save is worse than no button.
    // isOfficeRow, not isOfficeLink: a company SECTION HEADER has no URL, so a
    // URL-only matcher left company headers looking like the member's own —
    // editable and removable, then silently restored by the server on save.
    expect(form).toContain("isOfficeRow(l)");
    expect(form, "a URL-only matcher cannot see a company header").not.toContain("isOfficeLink(");
    expect(form).toMatch(/Company<\/span>/);
  });

  it("keeps the member's own links fully editable", () => {
    expect(form).toMatch(/\) : \(\s*<button type="button" onClick=\{\(\) => removeLink\(i\)\}/);
  });

  it("still offers the add form to everyone", () => {
    // Members add on top; that is the whole point of the additive rule.
    expect(form).not.toMatch(/turned off link buttons on team cards/);
  });
});

describe("the Swift Links DESIGN lock is separate from the links", () => {
  it("defaults off and reads from brand_locks.linkDesign", () => {
    const brandLib = read("src/lib/office-brand.ts");
    expect(brandLib).toMatch(/lockLinkDesign: locks\?\.linkDesign === true/);
    expect(brandLib).not.toMatch(/locks\?\.linkDesign !== false/);
  });

  it("replaces the whole design panel rather than showing dead controls", () => {
    for (const p of ["src/app/cards/[id]/edit/CardEditForm.tsx", "src/app/cards/new/NewCardWizard.tsx"]) {
      const src = read(p);
      expect(src, `${p} does not gate the design panel`).toMatch(/\{linkDesignLocked \? \(/);
      // And the per-link controls come back for everyone else.
      expect(src).toMatch(/links=\{links\}/);
      expect(src).toMatch(/onLinksChange=\{setLinks\}/);
    }
  });

  it("says what is still the member's", () => {
    const form = read("src/app/cards/[id]/edit/CardEditForm.tsx");
    expect(form).toMatch(/Your bio, your socials\s*\n?\s*and your own link buttons are still yours/);
  });
});

// ── overlayOfficeLinks: the two rules, kept apart ───────────────────────────
//
// THE LOOK follows the lock, exactly as the card's design follows lockTemplate.
// THE CONTENT (bio, pinned links) follows the company-information rule and
// applies whether or not the look is locked — the same way brand_company does.

const FULL = {
  linkDesign: { linkLook: "midnight", linkAccentColor: "#7c3aed" } as Record<string, unknown>,
  lockLinkDesign: true,
  linkBio: "Northwind Partners — commercial real estate.",
  linkInstagram: "@northwind",
  links: OFFICE,
};

describe("overlayOfficeLinks", () => {
  it("applies the look only while the office locks it", () => {
    const locked = overlayOfficeLinks({}, FULL);
    expect(locked.linkLook).toBe("midnight");
    const unlocked = overlayOfficeLinks({ linkLook: "paper" }, { ...FULL, lockLinkDesign: false });
    expect(unlocked.linkLook, "an unlocked office overwrote a member's look").toBe("paper");
  });

  it("clears a look key the office did NOT set, so nothing off-brand survives", () => {
    // Same rule as the card's design overlay: a member cannot keep a colour the
    // office left out of its scheme.
    const out = overlayOfficeLinks({ linkLook: "paper", linkBgColor: "#ff0000" }, FULL);
    expect(out.linkLook).toBe("midnight");
    expect(out.linkBgColor).toBeUndefined();
  });

  it("applies the bio and the links even when the look is UNLOCKED", () => {
    // Content is company information, not appearance. This is the distinction
    // the whole feature turns on.
    const out = overlayOfficeLinks({ bio: "mine" }, { ...FULL, lockLinkDesign: false });
    expect(out.bio).toBe(FULL.linkBio);
    expect((out.links as { url: string }[])[0].url).toBe(OFFICE[0].url);
  });

  it("leaves a member's bio alone when the office set none", () => {
    const out = overlayOfficeLinks({ bio: "mine" }, { ...FULL, linkBio: null });
    expect(out.bio).toBe("mine");
  });

  it("never writes a customization.instagram copy", () => {
    // cards.instagram is a real column; a second copy here would be silently
    // ignored by the links page and drift out of date forever.
    const out = overlayOfficeLinks({}, FULL);
    expect(out.instagram).toBeUndefined();
  });

  it("keeps the member's own links after the office's", () => {
    const out = overlayOfficeLinks({ links: [{ label: "Mine", url: "https://mine.example" }] }, FULL) as { links: { url: string }[] };
    expect(out.links.map((l) => l.url)).toEqual([OFFICE[0].url, OFFICE[1].url, "https://mine.example"]);
  });

  it("is a no-op for a member with no office", () => {
    const cust = { bio: "mine", linkLook: "paper" };
    expect(overlayOfficeLinks(cust, null)).toEqual(cust);
  });

  it("never mutates its input", () => {
    const cust = { bio: "mine", links: [{ label: "Mine", url: "https://mine.example" }] };
    const before = JSON.stringify(cust);
    overlayOfficeLinks(cust, FULL);
    expect(JSON.stringify(cust)).toBe(before);
  });

  it("survives an office that has set nothing at all", () => {
    const empty = { linkDesign: null, lockLinkDesign: false, linkBio: null, linkInstagram: null, links: null };
    expect(overlayOfficeLinks({ bio: "mine" }, empty)).toEqual({ bio: "mine" });
  });
});

describe("the member is never shown a field the server will overwrite", () => {
  const form = read("src/app/cards/[id]/edit/CardEditForm.tsx");

  it("a managed bio is read-only and labelled", () => {
    expect(form).toMatch(/readOnly=\{bioManaged\}/);
    expect(form).toMatch(/bioManaged\s*\n?\s*\? <ManagedTag/);
    expect(form).toMatch(/value=\{bioManaged \? \(org\?\.linkBio \?\? ""\) : bio\}/);
  });

  it("Instagram is the ONE social that can be managed", () => {
    expect(form).toMatch(/const managed = spec\.key === "instagram" && instagramManaged/);
    expect(form).toMatch(/managed=\{managed\}/);
    // …and the shared row makes a managed value read-only.
    expect(read("src/components/SocialHandleField.tsx")).toMatch(/readOnly=\{managed\}/);
  });
});

// ── The office replaces what a member wrote; it must never destroy it ────────
//
// Verified against a real office before this existed: the admin typed a company
// bio, pressed Save & apply, and every teammate's own bio was gone from the
// database with no copy anywhere. Clearing the company bio afterwards gave them
// an empty box, not their words back. Same for the company Instagram.
//
// A Swift Links page has ONE Instagram button and one bio, so the office's
// winning the slot is correct. Deleting the member's is not.
describe("a member's own bio and Instagram survive the office taking the slot", () => {
  const brand = (over: Record<string, unknown> = {}) => ({
    linkDesign: null, lockLinkDesign: false, linkBio: null, linkInstagram: null, links: null, ...over,
  }) as never;

  it("stashes the member's bio the first time the office sets one", () => {
    const out = overlayOfficeLinks({ bio: "Ben's own words" }, brand({ linkBio: "Northbeam — one team" }));
    expect(out.bio).toBe("Northbeam — one team");
    expect(out[OWN_BIO]).toBe("Ben's own words");
  });

  it("does not re-stash on every later save", () => {
    // The member's form posts the COMPANY bio back (the field is read-only), so
    // a naive stash would overwrite their words with the company's on save #2.
    const first = overlayOfficeLinks({ bio: "Ben's own words" }, brand({ linkBio: "Company bio" }));
    const second = overlayOfficeLinks(first, brand({ linkBio: "Company bio" }));
    expect(second[OWN_BIO]).toBe("Ben's own words");
  });

  it("hands the bio back when the office clears its own", () => {
    const set = overlayOfficeLinks({ bio: "Ben's own words" }, brand({ linkBio: "Company bio" }));
    const cleared = overlayOfficeLinks(set, brand({ linkBio: null }));
    expect(cleared.bio).toBe("Ben's own words");
    expect(cleared[OWN_BIO]).toBeUndefined();
  });

  it("remembers a member who had NO bio, and restores them to none", () => {
    const set = overlayOfficeLinks({}, brand({ linkBio: "Company bio" }));
    expect(set[OWN_BIO]).toBe("");
    expect(overlayOfficeLinks(set, brand({ linkBio: null })).bio).toBe("");
  });

  it("stashes the member's Instagram and returns the company's for the page", () => {
    const out = overlayOfficeInstagram({}, "benpersonal", brand({ linkInstagram: "northbeamgroup" }));
    expect(out.instagram).toBe("northbeamgroup");
    expect(out.customization[OWN_INSTAGRAM]).toBe("benpersonal");
  });

  it("never stashes a submitted company handle as the member's own", () => {
    // What the member's form posts back while the field is managed.
    const first = overlayOfficeInstagram({}, "benpersonal", brand({ linkInstagram: "northbeamgroup" }));
    const second = overlayOfficeInstagram(first.customization, "northbeamgroup", brand({ linkInstagram: "northbeamgroup" }));
    expect(second.customization[OWN_INSTAGRAM]).toBe("benpersonal");
  });

  it("hands the handle back when the office clears its own", () => {
    const set = overlayOfficeInstagram({}, "benpersonal", brand({ linkInstagram: "northbeamgroup" }));
    const cleared = overlayOfficeInstagram(set.customization, "northbeamgroup", brand({ linkInstagram: null }));
    expect(cleared.instagram).toBe("benpersonal");
    expect(cleared.customization[OWN_INSTAGRAM]).toBeUndefined();
  });

  it("leaves a non-member card alone when there is no brand", () => {
    const out = overlayOfficeInstagram({}, "benpersonal", null);
    expect(out.instagram).toBe("benpersonal");
  });
});

// ── Leaving the office ──────────────────────────────────────────────────────
// stripBrandFromUserCards exists so an ex-employee does not walk away with the
// former employer's branding live on their public page. The Swift Links fields
// were missing from it entirely when the feature shipped.
describe("leaving the office returns the page to the person", () => {
  const brand = {
    linkBio: "Northbeam — one team",
    linkInstagram: "northbeamgroup",
    links: [{ label: "Book a viewing", url: "https://northbeam.example.com/book" }],
  } as never;

  it("gives back their bio and handle, and drops the company's links", () => {
    const joined = {
      bio: "Northbeam — one team",
      [OWN_BIO]: "Ben's own words",
      [OWN_INSTAGRAM]: "benpersonal",
      links: [
        { label: "Book a viewing", url: "https://northbeam.example.com/book" },
        { label: "My calendar", url: "https://cal.example.com/ben" },
      ],
    };
    const out = releaseOfficeLinks(joined, "northbeamgroup", brand);
    expect(out.customization.bio).toBe("Ben's own words");
    expect(out.instagram).toBe("benpersonal");
    expect(out.customization.links).toEqual([{ label: "My calendar", url: "https://cal.example.com/ben" }]);
    expect(out.customization[OWN_BIO]).toBeUndefined();
    expect(out.customization[OWN_INSTAGRAM]).toBeUndefined();
  });

  it("does not touch a bio they changed away from the company's", () => {
    // Conservative, exactly like the logo/company strip above it: only clear a
    // field that still MATCHES the office's value.
    const out = releaseOfficeLinks({ bio: "Something else entirely", [OWN_BIO]: "old" }, "benpersonal", brand);
    expect(out.customization.bio).toBe("Something else entirely");
    expect(out.instagram).toBe("benpersonal");
  });

  it("matches company links loosely, so a trailing slash cannot orphan one", () => {
    const out = releaseOfficeLinks(
      { links: [{ label: "Book a viewing", url: "https://Northbeam.example.com/book/" }] },
      null,
      brand,
    );
    expect(out.customization.links).toEqual([]);
  });
});

// ── Section headers among the company links ─────────────────────────────────
//
// A company page can be chaptered the way a personal one can: a row with
// kind:"header" and no URL. That breaks the identity rule the rest of this file
// relies on — office links are matched BY URL, and every header's URL is the
// empty string, so without a second signal the office's first header and the
// member's own header are indistinguishable. Office rows are therefore stamped
// `office: true` as they are pinned, and the stamp is what identifies them.
describe("company section headers", () => {
  const brand = {
    links: [
      { label: "Listings", url: "", kind: "header" as const },
      { label: "Book a viewing", url: "https://northbeam.example.com/book" },
    ],
  } as never;

  it("pins a header with no URL, and stamps every office row", () => {
    const out = pinOfficeLinks([], brand) as Record<string, unknown>[];
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ label: "Listings", kind: "header", office: true });
    expect(out[1]).toMatchObject({ label: "Book a viewing", office: true });
  });

  it("keeps the member's OWN header, which also has no URL", () => {
    // The bug this prevents: matching on URL makes "" === "", so the member's
    // section header is swallowed as if it were the company's.
    const out = pinOfficeLinks(
      [{ label: "My videos", url: "", kind: "header" }, { label: "My calendar", url: "https://cal.example.com/me" }],
      brand,
    ) as Record<string, unknown>[];
    expect(out.map((l) => l.label)).toEqual(["Listings", "Book a viewing", "My videos", "My calendar"]);
    expect(out.find((l) => l.label === "My videos")?.office).toBeUndefined();
  });

  it("refuses a forged office stamp from a member payload", () => {
    // A crafted save claiming `office: true` must not make a member's own row
    // unremovable, or let it masquerade as company content.
    const out = pinOfficeLinks(
      [{ label: "Mine, pretending", url: "https://evil.example.com", office: true }],
      brand,
    ) as Record<string, unknown>[];
    expect(out.map((l) => l.label)).toEqual(["Listings", "Book a viewing"]);
  });

  it("a member cannot rename or delete a company header", () => {
    const out = pinOfficeLinks(
      [{ label: "Renamed by me", url: "", kind: "header", office: true }],
      brand,
    ) as Record<string, unknown>[];
    expect(out.find((l) => l.kind === "header")?.label).toBe("Listings");
  });

  it("leaving strips the company's headers and keeps the member's", () => {
    const joined = pinOfficeLinks([{ label: "My videos", url: "", kind: "header" }], brand);
    const out = releaseOfficeLinks({ links: joined }, null, brand);
    expect((out.customization.links as { label: string }[]).map((l) => l.label)).toEqual(["My videos"]);
  });
});

describe("the brand API accepts a header, but not a dead link", () => {
  const route = read("src/app/api/office/brand/route.ts");

  it("keeps a header on its label alone", () => {
    expect(route).toMatch(/l\.kind === "header" \? !!l\.label : !!l\.label && \/\^https\?/);
  });

  it("still rejects a link with no destination", () => {
    expect(route).toMatch(/\^https\?:\\\/\\\//);
  });

  it("coerces any other kind to a plain link", () => {
    // So a crafted payload cannot invent a third row type the page can't render.
    expect(route).toMatch(/l\.kind === "header" \? \("header" as const\) : undefined/);
  });
});

describe("the brand LOADER keeps section headers", () => {
  const lib = read("src/lib/office-brand.ts");

  it("carries kind through the parse", () => {
    // Dropping `kind` turned a header into a link with an empty URL, which the
    // next filter then deleted — so the header saved, rendered on the admin's
    // own screen, and never reached a single teammate's card. Nothing errored.
    expect(lib).toMatch(/\? \{ label, url: "", kind: "header" as const \}/);
  });

  it("does not require a URL on a header row", () => {
    expect(lib).toMatch(/l\.kind === "header" \? !!l\.label : !!l\.label && !!l\.url/);
  });
});

describe("a company header cannot be duplicated", () => {
  const brand = { links: [{ label: "Listings", url: "", kind: "header" as const }] } as never;

  it("drops an unmarked echo of the company's header", () => {
    // A card saved before office rows were stamped posts the header back with
    // no marker. Keeping it as "theirs" put a second copy on the page on every
    // single save — the list grew by one header each time.
    const out = pinOfficeLinks([{ label: "Listings", url: "", kind: "header" }], brand) as { label: string }[];
    expect(out.filter((l) => l.label === "Listings")).toHaveLength(1);
    expect(out).toHaveLength(1);
  });

  it("matches a header loosely on case and spacing", () => {
    const out = pinOfficeLinks([{ label: "  listings ", url: "", kind: "header" }], brand) as unknown[];
    expect(out).toHaveLength(1);
  });

  it("still keeps a genuinely different header of theirs", () => {
    const out = pinOfficeLinks([{ label: "My videos", url: "", kind: "header" }], brand) as { label: string }[];
    expect(out.map((l) => l.label)).toEqual(["Listings", "My videos"]);
  });

  it("removes an unmarked company header on the way out too", () => {
    const out = releaseOfficeLinks(
      { links: [{ label: "Listings", url: "", kind: "header" }, { label: "Mine", url: "", kind: "header" }] },
      null,
      brand,
    );
    expect((out.customization.links as { label: string }[]).map((l) => l.label)).toEqual(["Mine"]);
  });
});
