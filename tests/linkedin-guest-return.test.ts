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
    expect(guestBranch).toMatch(/const res = isNative\s*\?\s*nativeReturnPage\(/);
    expect(guestBranch).toContain('url.searchParams.set("li_photo", publicUrl)');
    // Every cookie cleared on this exit too, like every other.
    expect(guestBranch).toContain("return clearCookies(res);");
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
// to the website losing all progress." The sheet has none of the app's
// cookies, and the return leg reloaded the editor. Now every account takes the
// one-shot import (guest=1 — no session to carry), and the return finishes in
// place: the page under the sheet picks the photo up by its ticket.
describe("signed-in LinkedIn connect from the iOS shell", () => {
  it("needs no session in the sheet: the one-shot import for everyone", () => {
    const src = read("src/components/ProfilePhotoSuggest.tsx");
    const nativeBranch = src.slice(src.indexOf("if (detectNativeApp())"), src.indexOf("if (!opts.sameTab)"));
    expect(nativeBranch).toContain("${opts.hopHref}&native=1");
    expect(nativeBranch).not.toContain("/api/integrations/handoff");
    expect(src).toContain('const connectBase = "/api/integrations/linkedin/connect?guest=1";');
  });

  it("finishes in place on the page that started it, never reloading it", () => {
    const bridge = read("src/components/NativeAppBridge.tsx");
    const branch = bridge.slice(bridge.indexOf("swiftcard://linkedin-callback"), bridge.indexOf("// Integration OAuth return legs."));
    expect(branch).toContain("window.dispatchEvent(new Event(LINKEDIN_RETURN_EVENT))");
    expect(branch).not.toMatch(/location\.(href|replace|assign)/);
    // Settings' own account connect (status=connected) still goes back to Settings.
    expect(branch).toMatch(/liStatus !== "connected"/);
  });
});
