import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Owner, 2026-09-23: "When you connect with LinkedIn it makes you log in to
// LinkedIn. When you log in it then just brings you back to the front page."
//
// LinkedIn's sign-in page sends Cross-Origin-Opener-Policy:
// same-origin-allow-popups, which severs our popup's window.opener. The relay
// then found no opener and loaded the editor INSIDE the popup — a second copy
// of the page from the top, with no photo. The result now travels through
// same-origin storage, which COOP does not touch, and the popup only closes.
const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

// A tiny in-memory localStorage for the node test environment.
class MemStorage {
  private m = new Map<string, string>();
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string) { this.m.set(k, String(v)); }
  removeItem(k: string) { this.m.delete(k); }
  clear() { this.m.clear(); }
}

describe("the result survives the popup losing its opener", () => {
  beforeEach(() => {
    (globalThis as unknown as { localStorage: MemStorage }).localStorage = new MemStorage();
    (globalThis as unknown as { sessionStorage: MemStorage }).sessionStorage = new MemStorage();
  });

  it("the relay leaves it; only the page holding the same nonce takes it, once", async () => {
    const { leaveLinkedInResult, takeLinkedInResult } = await import("@/lib/linkedin-popup");
    leaveLinkedInResult("nonce-A", "connected");
    expect(takeLinkedInResult("nonce-B")).toBeNull();
    expect(takeLinkedInResult("nonce-A")?.status).toBe("connected");
    expect(takeLinkedInResult("nonce-A")).toBeNull(); // handled once
  });

  it("a stale result is ignored", async () => {
    const { takeLinkedInResult, LINKEDIN_RESULT_KEY } = await import("@/lib/linkedin-popup");
    localStorage.setItem(LINKEDIN_RESULT_KEY, JSON.stringify({ n: "x", status: "connected", at: Date.now() - 60 * 60 * 1000 }));
    expect(takeLinkedInResult("x")).toBeNull();
  });

  it("the popup's relay URL carries the nonce", async () => {
    (globalThis as unknown as { window: { location: { origin: string } } }).window = { location: { origin: "https://swiftcard.me" } };
    const { popupConnectUrl } = await import("@/lib/linkedin-popup");
    const u = new URL(popupConnectUrl("/api/integrations/linkedin/connect?next=%2Fprofile", "/cards/1/edit", "abc"));
    expect(u.searchParams.get("next")).toBe("/linkedin-connected?to=%2Fcards%2F1%2Fedit&n=abc");
  });

  it("a guest's failed import is handed to the suggester once; a success is not", async () => {
    const { stashGuestLinkedInStatus, takeGuestLinkedInStatus } = await import("@/lib/linkedin-popup");
    stashGuestLinkedInStatus("photo");
    expect(takeGuestLinkedInStatus()).toBeNull();
    stashGuestLinkedInStatus("nophoto");
    expect(takeGuestLinkedInStatus()).toBe("nophoto");
    expect(takeGuestLinkedInStatus()).toBeNull();
  });
});

describe("the popup never becomes a second copy of the page", () => {
  const relay = read("src/app/linkedin-connected/page.tsx");

  it("with a nonce, the relay stores the result and only closes — it never navigates", () => {
    const branch = relay.slice(relay.indexOf("if (nonce) {"), relay.indexOf("// An older popup"));
    expect(branch).toMatch(/leaveLinkedInResult\(nonce, status\)/);
    expect(branch).toMatch(/window\.close\(\)/);
    expect(branch).not.toMatch(/location\.(replace|href|assign)/);
  });

  it("if it cannot close, it says so and offers the page only as an explicit link", () => {
    expect(relay).toMatch(/LinkedIn is connected/);
    expect(relay).toMatch(/Open SwiftCard here instead/);
  });
});

describe("the page that opened the popup picks the result up", () => {
  const suggest = read("src/components/ProfilePhotoSuggest.tsx");

  it("every Connect/Reconnect button starts a nonce'd attempt", () => {
    // One entry point for every LinkedIn button; the account connect (popup)
    // always carries a fresh nonce, the one-shot page hop needs none.
    expect(suggest).toMatch(/nonce: oneShot \? undefined : startConnect\(\)/);
    expect(suggest.match(/onClick=\{connectLinkedIn\}/g)?.length).toBeGreaterThanOrEqual(3);
    expect(suggest).toMatch(/popupConnectUrl\(href, opts\.returnTo, opts\.nonce\)/);
  });

  it("listens on storage and on refocus, not only postMessage", () => {
    expect(suggest).toMatch(/addEventListener\("storage", onStorage\)/);
    expect(suggest).toMatch(/addEventListener\("visibilitychange", onVisible\)/);
    expect(suggest).toMatch(/takeLinkedInResult\(nonce, raw\)/);
  });

  it("a popup message is accepted only for this page's pending nonce", () => {
    expect(suggest).toMatch(/data\.n !== pendingNonce\.current\) return/);
  });

  it("a guest's failed import is shown, not silent", () => {
    expect(suggest).toMatch(/Your LinkedIn profile doesn't have a photo to import/);
    expect(suggest).toMatch(/takeGuestLinkedInStatus\(\)/);
    expect(read("src/components/site/useProductSketch.ts")).toMatch(/stashGuestLinkedInStatus\(url\.searchParams\.get\("status"\)\)/);
  });
});
