import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ── Connect LinkedIn from the headshot step: back to EXACTLY where you were ──
//
// Owner, 2026-10-19: from "Get Started", "See how your card looks" or "See how
// your SwiftLinks look", Connect with LinkedIn must sign in, come back to the
// same page and the same place — not the top of the website — open the photo
// to crop, and Apply. For every account: Free, Pro, Office admin, Office member.
//
// What was wrong:
//   • the card builder sits in the homepage's lazily-built template gallery
//     (2026-10-14 page-weight pass), so on the return nothing read the photo
//     until the visitor scrolled there — they landed at the top, builder shut;
//   • every homepage builder reopened on step 1, not the photo step;
//   • the photo was put on the card with no crop;
//   • an Office member was the last one on the consent popup (a second tab on a
//     phone, cut off from the page by LinkedIn's sign-in);
//   • the where-to-return cookie lived 10 minutes against the state's 15.
// The behaviour is driven in a real browser in
// tests/render/linkedin-photo-return.interactive.test.ts; these pin the wiring.

const read = (f: string) => readFileSync(join(process.cwd(), f), "utf8");

class MemStorage {
  private m = new Map<string, string>();
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string) { this.m.set(k, String(v)); }
  removeItem(k: string) { this.m.delete(k); }
  clear() { this.m.clear(); }
}

describe("the homepage builders come back on their photo step, with the crop open", () => {
  const builders: [string, string, number][] = [
    ["src/components/site/CardMiniBuilder.tsx", "card", 2],
    ["src/components/site/SwiftLinkMiniBuilder.tsx", "swiftlink", 0],
    ["src/components/site/SignatureMiniBuilder.tsx", "signature", 2],
  ];
  for (const [file, product, photoStep] of builders) {
    const src = read(file);
    it(`${product}: reopens on step ${photoStep + 1}, the one holding the Connect button`, () => {
      expect(src).toMatch(new RegExp(`const PHOTO_STEP = ${photoStep};`));
      expect(src).toMatch(/setStep\(PHOTO_STEP\); setOpen\(true\);/);
      expect(src).not.toMatch(/if \(linkedInReturn\) \{ setStep\(0\)/);
      // The step really is the one with the suggester on it.
      const steps = src.slice(src.indexOf("const steps: MiniStep[] = ["));
      const blocks = steps.split(/\n    \{\n|\n    \/\/ \d/).filter((b) => b.includes("title:"));
      expect(blocks[photoStep]).toMatch(/<ProfilePhotoSuggest/);
    });
    it(`${product}: the headshot tile gets the crop signal, and the hop is refused if the sketch can't be saved`, () => {
      expect(src).toMatch(/field="photo"[^\n]*adjustKey=\{photoAdjustKey\}/);
      expect(src).toMatch(new RegExp(`returnTo="/\\?builder=${product}" beforeLeave=\\{holdForHop\\}`));
    });
  }

  it("the template gallery (the card builder's home) is built at once on a ?builder=card return", () => {
    const lazy = read("src/components/site/HomeLazy.tsx");
    expect(lazy).toMatch(/get\("builder"\) === "card"/);
    expect(lazy).toMatch(/<Deferred minHeight=\{640\} now=\{cardBuilderReturn\}>/);
    const deferred = read("src/components/Deferred.tsx");
    const effect = deferred.slice(deferred.indexOf("useEffect(() => {"));
    // Checked before any observer is armed.
    expect(effect.indexOf("if (now?.())")).toBeGreaterThan(-1);
    expect(effect.indexOf("if (now?.())")).toBeLessThan(effect.indexOf("IntersectionObserver"));
  });
});

describe("the sketch save that guards the hop reports failure", () => {
  beforeEach(() => {
    (globalThis as unknown as { localStorage: MemStorage }).localStorage = new MemStorage();
  });

  it("true when written, true when there is nothing to keep, false when storage refuses", async () => {
    const { stashSketch } = await import("@/lib/prefill");
    expect(stashSketch({ product: "card", name: "Ada" } as never)).toBe(true);
    expect(stashSketch({ product: "card" } as never)).toBe(true);
    localStorage.setItem = () => { throw new Error("QuotaExceededError"); };
    expect(stashSketch({ product: "card", name: "Ada" } as never)).toBe(false);
  });
});

describe("the card wizard: one round trip for every account type", () => {
  const wizard = read("src/app/cards/new/NewCardWizard.tsx");

  it("an Office member takes the photo hop too, under a key nothing else reads", async () => {
    const { officeHopDraftKey, accountDraftKey } = await import("@/lib/guest-draft");
    expect(officeHopDraftKey("u1")).not.toBe(accountDraftKey("u1"));
    expect(wizard).toMatch(/const officeHop = !guest && !!draftOwner && !!org;/);
    expect(wizard).toMatch(/officeHop \? officeHopDraftKey\(draftOwner\)/);
    expect(wizard).toMatch(/photoReturn=\{keepsDraft\}/);
  });

  it("the held card is put back ONLY on the LinkedIn return, and the office's fields win", () => {
    const branch = wizard.slice(wizard.indexOf("if (officeHop) {"), wizard.indexOf("if (draft && draftHasWork(draft)) {\n        // A reload"));
    expect(branch).toMatch(/drafts\.clear\(\);/);
    expect(branch).toMatch(/backFromLinkedIn\(\)\) \{\s*restoreDraft\(draft\);\s*keepOrgFields\(\);/);
    // Never the "Continue your card?" question — that is for real drafts.
    expect(branch).not.toMatch(/setResumeChoice/);
  });

  it("a returning photo opens in the crop tool", () => {
    expect(wizard).toMatch(/setHeadshotUrl\(liPhotoRef\.current\);\s*setPhotoAdjustKey\(\(k\) => k \+ 1\);/);
    expect(wizard).toMatch(/adjustKey=\{photoAdjustKey\}/);
  });
});

describe("ImageUpload opens the crop tool on a photo applied from outside", () => {
  const upload = read("src/components/ImageUpload.tsx");
  it("each new adjustKey crops currentUrl; the Adjust button still crops the preview", () => {
    expect(upload).toMatch(/if \(!adjustKey \|\| !currentUrl\) return;/);
    expect(upload).toMatch(/void adjustCurrent\(url\);/);
    expect(upload).toMatch(/onClick=\{\(\) => adjustCurrent\(\)\}/);
  });
});

// ── The connect leg's return cookies ─────────────────────────────────────────
vi.mock("@/lib/connect-user", () => ({ resolveConnectUserId: async () => null }));

describe("the where-to-return cookie outlives the round trip", () => {
  beforeEach(() => {
    process.env.LINKEDIN_CLIENT_ID = "cid";
    process.env.LINKEDIN_CLIENT_SECRET = "secret";
    process.env.OAUTH_SECRET = "test-oauth-secret";
  });

  const cookie = (res: Response, name: string) =>
    res.headers.getSetCookie().find((c) => c.startsWith(`${name}=`)) ?? "";

  it("a guest's return path is kept past the state's 15 minutes, and goes to LinkedIn", async () => {
    const { GET } = await import("@/app/api/integrations/linkedin/connect/route");
    const res = await GET(new Request("https://swiftcard.me/api/integrations/linkedin/connect?guest=1&next=%2F%3Fbuilder%3Dcard"));
    expect(res.headers.get("location")).toMatch(/^https:\/\/www\.linkedin\.com\/oauth\/v2\/authorization\?/);
    const ret = cookie(res, "li_return_to");
    expect(decodeURIComponent(ret)).toMatch(/^li_return_to=\/\?builder=card;/);
    expect(Number(/Max-Age=(\d+)/i.exec(ret)?.[1])).toBeGreaterThan(15 * 60);
  });

  it("an attempt with no return path or not from the app clears the leftovers of an earlier one", async () => {
    const { GET } = await import("@/app/api/integrations/linkedin/connect/route");
    const res = await GET(new Request("https://swiftcard.me/api/integrations/linkedin/connect?guest=1"));
    expect(cookie(res, "li_return_to")).toMatch(/Max-Age=0/i);
    expect(cookie(res, "li_native")).toMatch(/Max-Age=0/i);
  });
});
