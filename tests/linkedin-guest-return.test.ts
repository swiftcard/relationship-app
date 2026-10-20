import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readGuestLinkedInReturn } from "@/components/site/useProductSketch";

// ── Guest LinkedIn photo → back into the homepage builder ────────────────────
//
// Owner, 2026-09-22: "whenever I create a card on 'See how your SwiftLink would
// look', LinkedIn profile pictures do not connect properly."
//
// The callback always did its job: it copied the consented photo into our
// storage and sent the visitor back to `returnTo` with ?li_photo=. The hole was
// on the receiving end. The three homepage builders returned to "/" — and only
// /cards/new ever read ?li_photo=. So the visitor landed on the top of the
// homepage, builder closed, and GuestFlowReset (which treats every signed-out
// homepage load as a fresh start) wiped the sketch on top of that.
//
// Now each builder returns to /?builder=<product>: the matching builder
// re-opens on step 1 with its stashed sketch, the photo goes on top, and the
// homepage reset stands aside for that one load.

const read = (f: string) => readFileSync(join(process.cwd(), f), "utf8");
const STORAGE = "https://example.supabase.co";
const PHOTO = `${STORAGE}/storage/v1/object/public/card-uploads/guest-linkedin/abc.jpg`;

describe("readGuestLinkedInReturn", () => {
  it("hands the matching builder its photo and tells it to re-open", () => {
    expect(readGuestLinkedInReturn(`?builder=swiftlink&integration=linkedin&status=photo&li_photo=${encodeURIComponent(PHOTO)}`, "swiftlink", STORAGE))
      .toEqual({ returned: true, photo: PHOTO });
  });

  it("ignores a return meant for another builder", () => {
    expect(readGuestLinkedInReturn(`?builder=card&li_photo=${encodeURIComponent(PHOTO)}`, "swiftlink", STORAGE))
      .toEqual({ returned: false, photo: null });
    expect(readGuestLinkedInReturn("", "swiftlink", STORAGE)).toEqual({ returned: false, photo: null });
  });

  it("still re-opens when LinkedIn had no photo, so the visitor is not dumped on the homepage", () => {
    expect(readGuestLinkedInReturn("?builder=signature&integration=linkedin&status=nophoto", "signature", STORAGE))
      .toEqual({ returned: true, photo: null });
  });

  it("never trusts a photo URL off our own storage host", () => {
    for (const bad of ["https://evil.example/x.jpg", `${STORAGE}/other/x.jpg`, "javascript:alert(1)"]) {
      expect(readGuestLinkedInReturn(`?builder=card&li_photo=${encodeURIComponent(bad)}`, "card", STORAGE).photo).toBeNull();
    }
    expect(readGuestLinkedInReturn(`?builder=card&li_photo=${encodeURIComponent(PHOTO)}`, "card", undefined).photo).toBeNull();
  });
});

describe("every homepage builder is wired the same way", () => {
  const BUILDERS: [string, string][] = [
    ["src/components/site/SwiftLinkMiniBuilder.tsx", "swiftlink"],
    ["src/components/site/CardMiniBuilder.tsx", "card"],
    ["src/components/site/SignatureMiniBuilder.tsx", "signature"],
  ];

  it.each(BUILDERS)("%s returns LinkedIn to its own builder and re-opens without reset", (file, product) => {
    const src = read(file);
    expect(src).toContain(`useProductSketch("${product}", open)`);
    expect(src).toContain(`returnTo="/?builder=${product}"`);
    expect(src).toContain("linkedInReturn");
    // Re-open keeps the stashed sketch: no reset() on this path — and it opens
    // on the photo step, where the Connect button was (2026-10-19).
    const reopen = src.slice(src.indexOf("if (!linkedInReturn) return;"), src.indexOf("}, [linkedInReturn]);"));
    expect(reopen).toMatch(/setStep\(PHOTO_STEP\); setOpen\(true\);/);
    expect(reopen).not.toMatch(/reset\(\)/);
  });

  it("a builder's guest=1 connect always comes back as a photo, even for a signed-in visitor", () => {
    // Found live (owner's own Chrome, 2026-09-22): the session "won", the
    // callback stored a token and returned status=connected with no photo, and
    // the homepage builder — which can only receive ?li_photo= — showed
    // nothing. guest=1 is the builder saying "photo, please"; honour it.
    const connect = read("src/app/api/integrations/linkedin/connect/route.ts");
    expect(connect).toContain("const userId = guestRequested ? null : await resolveConnectUserId(request);");
    expect(connect).not.toMatch(/A session always wins/);
  });

  it("the homepage reset stands aside for a LinkedIn return", () => {
    expect(read("src/components/GuestFlowReset.tsx")).toContain('has("builder")');
  });

  it("a guest inside the iOS shell gets the photo back in the APP, not in the browser sheet", () => {
    // Sign up → the card builder, signed out, in the shell: the hop runs in
    // the in-app sheet, so the guest branch must finish at swiftcard:// like
    // DONE does, with li_photo carried in `next` for the wizard's reader.
    const cb = read("src/app/api/integrations/linkedin/callback/route.ts");
    const guestBranch = cb.slice(cb.indexOf("if (userId === GUEST_STATE)"));
    expect(guestBranch).toContain("swiftcard://linkedin-callback?status=photo&next=");
    expect(guestBranch).toMatch(/const res = isNative\s*\?/);
    expect(guestBranch).toContain('url.searchParams.set("li_photo", publicUrl)');
    // Both cookies cleared on this exit too, like every other.
    expect(guestBranch).toContain('res.cookies.set("li_native", "", { maxAge: 0, path: "/" })');
  });

  it("the wizard's own ?li_photo= reader is untouched", () => {
    const wizard = read("src/app/cards/new/NewCardWizard.tsx");
    expect(wizard).toContain('url.searchParams.get("li_photo")');
    expect(wizard).toContain("/storage/v1/object/public/");
  });
});

// ── Signed in, inside the iOS shell ──────────────────────────────────────────
//
// Owner, 2026-09-22: "whenever I try to connect LinkedIn it just glitches out
// to the website losing all progress." Two causes, both in the shell:
//
//  1. The in-app sheet has none of the app's cookies, so the connect route saw
//     no session and sent the user to the WEBSITE's sign-in page. The CRM
//     connects had already solved this with a signed handoff token (?h=); the
//     headshot import never got it.
//  2. The return leg reloaded the editor to deliver the status, which threw
//     away every unsaved edit. It now finishes in place, like the web popup.
describe("signed-in LinkedIn connect from the iOS shell", () => {
  it("carries the session into the sheet as the handoff token", () => {
    const src = read("src/components/ProfilePhotoSuggest.tsx");
    const nativeBranch = src.slice(src.indexOf("if (detectNativeApp())"), src.indexOf("// Web."));
    expect(nativeBranch).toContain('fetch("/api/integrations/handoff", { method: "POST" })');
    expect(nativeBranch).toContain("&h=${encodeURIComponent(h)}");
    // Guests have no session to carry — guest=1 already does the job.
    expect(nativeBranch).toMatch(/if \(!opts\.guest\)/);
  });

  it("finishes in place on the editor that started it, never reloading it", () => {
    const bridge = read("src/components/NativeAppBridge.tsx");
    const branch = bridge.slice(bridge.indexOf("swiftcard://linkedin-callback"), bridge.indexOf('url.startsWith("swiftcard:")'));
    expect(branch).toContain("window.postMessage({ source: LINKEDIN_MESSAGE, status }, window.location.origin)");
    // Only when the webview is already on that page, and never for a guest's
    // photo, which travels in the URL and is read on mount.
    expect(branch).toMatch(/provider === "linkedin" &&\s*status !== "photo" &&\s*new URL\(next, window\.location\.origin\)\.pathname === window\.location\.pathname/);
    // The listener that receives it accepts exactly this shape.
    const suggest = read("src/components/ProfilePhotoSuggest.tsx");
    expect(suggest).toContain("data.source !== LINKEDIN_MESSAGE");
    expect(suggest).toContain("e.origin !== window.location.origin");
  });
});
