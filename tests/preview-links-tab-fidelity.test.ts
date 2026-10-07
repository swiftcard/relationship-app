import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// STRUCTURAL GUARD.
//
// /preview sells itself as "this is your dashboard — try it out", so its Links
// tab has to be the Links page people actually get. It once wasn't: the mock
// showed controls the real portal never had. The homepage's DashboardDemo is a
// second replica of the same page.
//
// Since 2026-10-07 the real page is a Swift Links | Swift Signature switch
// (LinksPageTabs). Each side leads with a one-line intro, then the real thing
// — a mini phone of the Swift Links page, or the signature in a sample email —
// then its actions. The signature is shown in place; the old "Preview & copy"
// pop-up is gone.
//
// The replicas are hand-built (they have no logged-in account to render from),
// so nothing but a test keeps them honest when the real page changes.

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8");

// Prose ABOUT the replica is not the replica. The files carry comments naming
// the old pop-up, so without stripping them the "no longer present" assertions
// would fail on the comment and the "still present" ones could pass on it.
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
}

const preview = stripComments(read("src/app/preview/PreviewClient.tsx"));
const demo = stripComments(read("src/components/site/DashboardDemo.tsx"));
const share = stripComments(read("src/app/share/page.tsx"));             // the real Links page
const sigBox = stripComments(read("src/components/EmailSignatureBox.tsx")); // its Swift Signature side
const tabs = read("src/components/LinksPageTabs.tsx");

// The copy the real page shows, taken FROM the real page — so if the product
// changes the wording, this test starts failing until the mocks are updated too.
const SWIFT_LINKS_TITLE = "Your link-in-bio page";
const SWIFT_LINKS_BLURB =
  "A separate link from your card — your bio, socials, and links in one place. Drop it in your Instagram, TikTok, or any social bio.";
const SIGNATURE_TITLE = "Your card in every email";
const SIGNATURE_BLURB =
  "Copy your Swift Signature and paste it into your email — a clickable link to your card at the bottom of every message you send.";

describe("the Links page replicas match the real Links page", () => {
  it("the strings under test really are the real page's strings", () => {
    // Without this, a product copy change would silently make every assertion
    // below test the mocks against a constant that no longer matches anything.
    for (const s of [SWIFT_LINKS_TITLE, SWIFT_LINKS_BLURB, SIGNATURE_TITLE, SIGNATURE_BLURB, "Open Swift Links →", "Edit my links"]) {
      expect(share, `the real Links page no longer carries "${s}"`).toContain(s);
    }
    expect(tabs).toContain('label: "Swift Links"');
    expect(tabs).toContain('label: "Swift Signature"');
    expect(sigBox, "the real signature side lost its Copy signature button").toContain('"Copy signature"');
    expect(sigBox).toContain("Here&apos;s how it looks at the bottom of an email you send:");
  });

  it("all three use the SAME switch component, not a copy of it", () => {
    for (const [name, src] of [["/share", share], ["/preview", preview], ["DashboardDemo", demo]] as const) {
      expect(src, `${name} no longer renders LinksPageTabs`).toMatch(/<LinksPageTabs\b/);
    }
    // The replicas sit inside other pages: they must never write that page's URL.
    expect(preview).toMatch(/<LinksPageTabs\s+syncHash=\{false\}/);
    expect(demo).toMatch(/<LinksPageTabs\s+syncHash=\{false\}/);
    expect(share).not.toMatch(/syncHash=\{false\}/);
  });

  it("each replica's sides read the same as the real ones", () => {
    for (const [name, src] of [["/preview", preview], ["DashboardDemo", demo]] as const) {
      for (const s of [SWIFT_LINKS_TITLE, SWIFT_LINKS_BLURB, SIGNATURE_TITLE, SIGNATURE_BLURB, "Open Swift Links →", "Edit my links", "Copy signature"]) {
        expect(src, `${name} is missing "${s}"`).toContain(s);
      }
    }
  });

  it("the signature is shown in place — the Preview & copy pop-up is gone everywhere", () => {
    for (const [name, src] of [["/share", share], ["EmailSignatureBox", sigBox], ["/preview", preview], ["DashboardDemo", demo]] as const) {
      expect(src, `${name} still offers "Preview & copy"`).not.toMatch(/Preview (&amp;|&) copy/);
      expect(src, `${name} still says "Update my signature"`).not.toContain("Update my signature");
    }
  });

  it("the invented controls are gone", () => {
    // These existed only in an old mock. Any of them coming back means the
    // demo is showing a portal the customer will never see.
    expect(preview, "'See it in an email' is back — no such control in the portal").not.toContain("See it in an email");
    expect(share, "the real page grew a 'See it in an email' button").not.toContain("See it in an email");
    expect(preview, "the fake signature URL line is back").not.toMatch(/text-blue-600 text-\[11px\] mt-1\.5 underline/);
  });
});
