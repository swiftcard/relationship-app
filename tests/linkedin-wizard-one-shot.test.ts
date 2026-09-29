import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { draftStore } from "@/lib/guest-draft";

// ── Connect LinkedIn while CREATING a card ──────────────────────────────────
//
// Owner, 2026-09-29, on a friend's phone: "we suggested a headshot and pressed
// Connect to LinkedIn … it fully glitched and just didn't work. We did this so
// many times."
//
// A signed-in builder ran the ACCOUNT connect: a popup (a new tab on a phone,
// cut off from its opener by LinkedIn's COOP, closing itself or not), or in the
// app a session hand-off token, and then a SECOND request to import the photo.
// Each link was patched on its own and something new broke every time.
//
// The wizard now takes the round trip guests already take: one hop in this tab
// (the in-app sheet on iOS), and the photo comes back as ?li_photo=. Its own
// draft carries the card across, written before the hop, and the hop is
// refused if it can't be written.

const read = (f: string) => readFileSync(join(process.cwd(), f), "utf8");
const suggest = read("src/components/ProfilePhotoSuggest.tsx");
const wizard = read("src/app/cards/new/NewCardWizard.tsx");

describe("the card wizard uses the one-shot photo import", () => {
  it("opts in whenever it keeps a draft, and flushes the draft before leaving", () => {
    expect(wizard).toMatch(/photoReturn=\{canDraft\}/);
    expect(wizard).toMatch(/beforeLeave=\{\(\) => drafts\.flush\(\)\}/);
  });

  it("one-shot means the guest=1 connect, run as a page hop (no popup, no hand-off)", () => {
    expect(suggest).toMatch(/const oneShot = guest \|\| photoReturn/);
    expect(suggest).toMatch(/const connectHref = oneShot \? guestConnectHref : connectUrl/);
    expect(suggest).toMatch(/openLinkedInConnect\(connectHref, \{ guest: oneShot/);
  });

  it("never leaves when the draft could not be saved", () => {
    const fn = suggest.slice(suggest.indexOf("function connectLinkedIn"), suggest.indexOf("async function suggest"));
    const guard = fn.indexOf("!beforeLeave()");
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(fn.indexOf("openLinkedInConnect("));
  });

  it("a failed import is SAID, on the web return and in the app's in-place return", () => {
    expect(suggest).toMatch(/if \(!oneShot\) return;[\s\S]*oneShotFailure\(status \?\? takeGuestLinkedInStatus\(\)\)/);
    expect(suggest).toMatch(/addEventListener\("message", onOneShotMessage\)/);
    expect(suggest).toMatch(/status === "nophoto"/);
  });

  it("the returning ?li_photo= is APPLIED, not just stored (effect order)", () => {
    // Review 2026-09-29: the restore effect is declared first, so it runs
    // first, and its body is synchronous — it called applyLiPhoto() before the
    // reader below had set the ref, and in production (no StrictMode double
    // run) the photo was silently dropped. The reader must apply it itself once
    // hydration is done.
    const restoreAt = wizard.indexOf("if (!canDraft) { hydratedRef.current = true; applyLiPhoto(); return; }");
    const readerAt = wizard.indexOf('const photo = url.searchParams.get("li_photo");');
    expect(restoreAt).toBeGreaterThan(0);
    expect(readerAt, "the reader effect moved — re-check the order argument").toBeGreaterThan(restoreAt);
    const reader = wizard.slice(readerAt, wizard.indexOf("}, []);", readerAt));
    expect(reader).toMatch(/liPhotoRef\.current = photo;\s*if \(hydratedRef\.current\) applyLiPhoto\(\);/);
  });

  it("comes back to THIS builder with its parameters, not a fixed ?add=1", () => {
    expect(wizard).toMatch(/returnTo=\{photoReturnTo\}/);
    expect(wizard).not.toMatch(/returnTo=\{guest \? "\/cards\/new" : "\/cards\/new\?add=1"\}/);
    const def = wizard.slice(wizard.indexOf("const photoReturnTo = "), wizard.indexOf("})();", wizard.indexOf("const photoReturnTo = ")));
    expect(def).toMatch(/new URLSearchParams\(searchParams\.toString\(\)\)/);
    expect(def).toMatch(/for \(const k of \["li_photo", "integration", "status"\]\) p\.delete\(k\);/);
  });

  it("the phone tip's \"connect your LinkedIn\" is a working link, not text", () => {
    expect(suggest).toMatch(/<a href=\{connectHref\} onClick=\{connectLinkedIn\}[^>]*>\s*connect your LinkedIn\s*<\/a>/);
  });
});

describe("draft flush reports whether it reached storage", () => {
  beforeEach(() => {
    const mem = new Map<string, string>();
    (globalThis as unknown as { localStorage: Storage }).localStorage = {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => { mem.set(k, v); },
      removeItem: (k: string) => { mem.delete(k); },
      clear: () => mem.clear(),
      key: () => null,
      length: 0,
    } as Storage;
  });

  it("true when written", () => {
    const d = draftStore(`t-ok-${Math.random()}`);
    d.save({ payload: { name: "Ada" } });
    expect(d.flush()).toBe(true);
  });

  it("false when storage refuses the write (quota)", () => {
    const d = draftStore(`t-full-${Math.random()}`);
    d.save({ payload: { name: "Ada" } });
    localStorage.setItem = () => { throw new Error("QuotaExceededError"); };
    expect(d.flush()).toBe(false);
  });
});
