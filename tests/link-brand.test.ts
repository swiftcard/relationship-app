import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  hostLabel, faviconFor, monogramFor, monogramTint,
  fullHref, brandBackground, iconHost,
} from "@/lib/link-brand";

const root = process.cwd();
const code = (p: string) =>
  readFileSync(join(root, p), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("hostLabel", () => {
  it("strips scheme, www and path", () => {
    expect(hostLabel("https://www.LevLevEducationalFund.Org/donate")).toBe("levleveducationalfund.org");
  });
  it("copes with a schemeless URL, which is what owners type", () => {
    expect(hostLabel("levleveducationalfund.org/apply")).toBe("levleveducationalfund.org");
  });
  it("returns empty for junk instead of throwing", () => {
    expect(hostLabel("")).toBe("");
    expect(hostLabel("   ")).toBe("");
    expect(hostLabel("http://")).toBe("");
  });
});

describe("every action link is the same quiet row", () => {
  const c = () => code("src/components/CardActionLinks.tsx");

  it("no link is singled out — no feature/rest split", () => {
    // The first link used to be an accent-filled plate. Dropped on owner call:
    // a saturated button reads as advertising on a professional's card.
    expect(c(), "the feature/rest split is back").not.toMatch(/const \[feature, \.\.\.rest\]/);
    expect(c()).toMatch(/links\.map\(/);
  });

  it("nothing on this surface reads the card's accent colour", () => {
    // Not just here — the section as a whole is free of saturated blocks now.
    for (const f of ["src/components/CardActionLinks.tsx", "src/components/SocialLinkIntercept.tsx"]) {
      expect(code(f), `${f} still fills something with the accent`).not.toMatch(/safeAccent|inkOn|color-mix/);
    }
    expect(code("src/app/[username]/page.tsx"), "the page still passes an accent down")
      .not.toMatch(/accent=\{customization\.accentColor\}/);
  });

  it("all rows live in ONE container with internal hairlines", () => {
    // The grouping is the part that survived — N floating slabs read as a pile.
    expect(c()).toMatch(/rounded-\[14px\] overflow-hidden bg-white/);
    expect(c()).toMatch(/border-b border-\[#F1EBE3\] last:border-b-0/);
  });

  it("has a real hover state, plus keyboard focus", () => {
    expect(c()).toMatch(/hover:bg-\[#F2F6FF\]/);
    expect(c()).toMatch(/active:bg-\[#E4ECFE\]/);
    expect(c(), "keyboard users get no visible affordance").toMatch(/focus-visible:/);
  });

  it("every tappable row in the section shares the SAME blue hover", () => {
    // Owner asked for blue. Three row shapes across two files — the links
    // table, the website row/capsule, and the lone-social row — and a
    // mismatch between them is the kind of thing only a side-by-side catches.
    for (const f of ["src/components/CardActionLinks.tsx", "src/components/SocialLinkIntercept.tsx"]) {
      const s = code(f);
      expect(s, `${f} kept a warm hover`).not.toMatch(/hover:bg-\[#FBF9F6\]|active:bg-\[#F4EFE7\]/);
      expect(s).toMatch(/hover:bg-\[#F2F6FF\]/);
    }
    // Every row that hovers also turns its chevron blue.
    const rail = code("src/components/SocialLinkIntercept.tsx");
    expect((rail.match(/group-hover:text-\[#1D4ED8\]/g) ?? []).length).toBe(2);
    expect(code("src/components/CardActionLinks.tsx")).toMatch(/group-hover:text-\[#1D4ED8\]/);
  });

  it("hover changes COLOUR, never position", () => {
    // A row inside a shared container must not move independently or the
    // hairlines visibly break. The chevron may lean; the row may not.
    const rowClass = c().match(/className="group flex items-center gap-3 min-h-\[52px\][^"]*"/)?.[0] ?? "";
    expect(rowClass).toBeTruthy();
    expect(rowClass, "the row itself translates or scales on hover").not.toMatch(/hover:(translate|scale)/);
  });
});

describe("monogram", () => {
  it("is the first letter of the host, uppercased", () => {
    expect(monogramFor("https://levleveducationalfund.org/donate")).toBe("L");
    expect(monogramFor("https://www.example.com")).toBe("E");
  });
  it("never returns empty", () => {
    expect(monogramFor("")).toBe("?");
  });
  it("is tinted by HOSTNAME, so reordering links never reshuffles colours", () => {
    const a = monogramTint("https://example.com/one");
    const b = monogramTint("https://example.com/two");
    expect(a).toBe(b);
  });
  it("different hosts generally get different tints", () => {
    const tints = new Set(
      ["a.com", "b.org", "c.net", "d.io", "example.com", "swiftcard.me"].map((h) => monogramTint(`https://${h}`)),
    );
    expect(tints.size).toBeGreaterThan(1);
  });
});

describe("faviconFor", () => {
  it("is derived from the hostname — no scrape, no /api/link-preview", () => {
    expect(faviconFor("https://levleveducationalfund.org/donate"))
      .toBe("/api/link-icon?host=levleveducationalfund.org");
  });
  it("is one address per site: www and case don't make a second cache entry", () => {
    expect(faviconFor("https://WWW.Zillow.com/homes")).toBe("/api/link-icon?host=zillow.com");
    expect(faviconFor("zillow.com")).toBe("/api/link-icon?host=zillow.com");
  });
  it("returns null for junk", () => {
    expect(faviconFor("")).toBeNull();
    expect(faviconFor("not a url")).toBeNull();
  });
});

describe("iconHost", () => {
  it("accepts real hostnames only", () => {
    expect(iconHost("calendly.com")).toBe("calendly.com");
    expect(iconHost("api.leadconnectorhq.com")).toBe("api.leadconnectorhq.com");
    expect(iconHost("localhost")).toBeNull();
    expect(iconHost("evil.com/../x")).toBeNull();
    expect(iconHost(".com")).toBeNull();
  });
});

describe("fullHref matches the rule the old component used", () => {
  it("leaves absolute URLs alone", () => {
    expect(fullHref("https://x.test/a")).toBe("https://x.test/a");
  });
  it("adds https to a bare domain", () => {
    expect(fullHref("x.test/a")).toBe("https://x.test/a");
  });
  it("neutralises a hostile scheme", () => {
    expect(fullHref("javascript:alert(1)")).toBe("https://alert(1)");
    expect(fullHref("")).toBe("#");
  });
});

describe("brandBackground is shared, so the two surfaces can't disagree", () => {
  it("Instagram is the gradient on both", () => {
    expect(brandBackground("Instagram", "#E1306C")).toContain("radial-gradient");
  });
  it("everything else is its flat brand colour", () => {
    expect(brandBackground("LinkedIn", "#0A66C2")).toBe("#0A66C2");
  });
  it("SocialIcons imports it rather than keeping a copy", () => {
    const c = code("src/components/SocialIcons.tsx");
    expect(c, "SocialIcons re-declared brandBackground").not.toMatch(/function brandBackground/);
    expect(c).toMatch(/from "@\/lib\/link-brand"/);
  });
});

describe("the marketing mockups show the card page's real Swift Links design", () => {
  // Reversed on purpose (owner request, 2026-08-12). The rail used to be
  // card-page-only and this block pinned the three mockups to "bars" so
  // marketing wouldn't shift under it. That is exactly backwards now: the
  // mockups advertise the card, so showing a design the card no longer has was
  // the regression. They render the real section through site/DemoSwiftLinks.
  const MOCKUPS = [
    "src/components/site/LeadCapturePhone.tsx",
    "src/components/site/SignatureDemo.tsx",
    "src/components/site/TemplateGallery.tsx",
  ];

  it('SocialLinkIntercept still defaults to the original "bars"', () => {
    expect(code("src/components/SocialLinkIntercept.tsx")).toMatch(/variant = "bars"/);
  });

  it("every mockup goes through the one shared section, not its own copy", () => {
    // The copies are what drifted the first time. If a mockup ever renders
    // SocialLinkIntercept directly again, it has its own Swift Links markup
    // and this whole class of bug is back.
    for (const f of MOCKUPS) {
      const c = code(f);
      expect(c, `${f} no longer renders DemoSwiftLinks`).toMatch(/DemoSwiftLinks/);
      expect(c, `${f} hand-rolls its own Swift Links box again`).not.toMatch(/SocialLinkIntercept/);
    }
  });

  it("the shared section renders the rail and the action links", () => {
    const c = code("src/components/site/DemoSwiftLinks.tsx");
    expect(c).toMatch(/variant="rail"/);
    expect(c).toMatch(/CardActionLinks/);
    // Display-only: a mockup must never fire a lead POST or a nudge.
    expect((c.match(/pointerEvents: "none"/g) ?? []).length).toBe(2);
  });

  it("the public card page still opts in", () => {
    expect(code("src/app/[username]/page.tsx")).toMatch(/variant="rail"/);
  });

  it("links navigate DIRECTLY — the intercept is gone (owner decision 2026-08-25)", () => {
    const c = code("src/components/SocialLinkIntercept.tsx");
    // Three anchors in the rail (website, solo social, disc) + one in bars,
    // every one a plain new-tab anchor with the incidental nudge on click.
    expect((c.match(/onClick=\{handleClick\}/g) ?? []).length).toBe(4);
    expect((c.match(/target="_blank"/g) ?? []).length).toBe(4);
    // Nothing may re-grow a capture form here: no interception, no lead post.
    expect(c).not.toMatch(/preventDefault/);
    expect(c).not.toMatch(/api\/leads/);
    expect(c).toMatch(/triggerSignupNudge\("link_button"\)/);
  });

  it("the signup nudge still fires on every action link", () => {
    // One render site now (a single map over all links), so one call covers
    // every row — but it must be INSIDE the map, not on a wrapper.
    const c = code("src/components/CardActionLinks.tsx");
    const map = c.slice(c.indexOf("links.map("));
    expect(map, "the nudge is no longer attached to each row").toMatch(
      /triggerSignupNudge\("link_button"\)/,
    );
    expect((c.match(/triggerSignupNudge\(/g) ?? []).length).toBe(1);
  });
});

describe("public card page copy and controls", () => {
  const PAGE = "src/app/[username]/page.tsx";

  it('the Swift Links chip says "View Swift Link page", not "View all"', () => {
    const c = code(PAGE);
    expect(c).toMatch(/View Swift Link page →/);
    expect(c, "the vague label is back").not.toMatch(/>\s*View all →\s*</);
  });

  it("Share this card no longer offers Show QR Code", () => {
    // A sharer's control sitting in a viewer's flow: it asked the person
    // already holding the card to display a QR for someone ELSE to scan.
    const c = code(PAGE);
    expect(c, "the QR modal is back on the public card").not.toMatch(/<QRCodeModal/);
    expect(c, "an unused import was left behind").not.toMatch(/import QRCodeModal/);
  });

  it("but Share this card still shares", () => {
    // Removing one control must not have taken the box's actual job with it.
    const c = code(PAGE);
    expect(c).toMatch(/<ShareButton/);
    expect(c).toMatch(/label="Share this card"/);
  });

  it("no mockup renders the QR modal the live card page removed", () => {
    // "Show QR Code" was removed from the public card page (a sharer's tool in
    // a viewer's flow); the marketing mockups mirror that page, so none of them
    // may show the control either. The QRCodeModal component itself may exist,
    // but nothing on the card page or its mockups renders it.
    for (const f of [
      "src/components/site/LeadCapturePhone.tsx",
      "src/components/site/SignatureDemo.tsx",
      "src/components/site/TemplateGallery.tsx",
      "src/app/[username]/page.tsx",
    ]) {
      expect(code(f), `${f} renders the retired QR modal`).not.toMatch(/<QRCodeModal/);
    }
  });
});

describe("the section costs no first-party network", () => {
  it("neither new component calls /api/link-preview", () => {
    for (const f of ["src/components/LinkMark.tsx", "src/components/CardActionLinks.tsx"]) {
      expect(code(f), `${f} fetches a preview`).not.toMatch(/link-preview|fetch\(/);
    }
  });

  it("the favicon is lazy and never leaves an empty box", () => {
    const c = code("src/components/LinkMark.tsx");
    expect(c).toMatch(/loading="lazy"/);
    // The monogram is painted underneath and only fades out once the image loads.
    expect(c).toMatch(/opacity: showFavicon \? 0 : 1/);
    expect(c).toMatch(/onError=\{\(\) => setFailed\(true\)\}/);
  });

  // Live 2026-10-07: the mark is server-rendered, the icon loaded before
  // hydration, onLoad never fired, and every logo sat downloaded at opacity 0
  // behind its monogram (all rows on WebKit). The mount-time read is the fix.
  it("adopts an icon that loaded before React was listening", () => {
    const c = code("src/components/LinkMark.tsx");
    expect(c).toMatch(/ref=\{imgRef\}/);
    expect(c).toMatch(/el\?\.complete && el\.naturalWidth > 0\) setLoaded\(true\)/);
  });
});
