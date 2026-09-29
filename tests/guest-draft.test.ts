import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  buildClaimInsert,
  sanitizeUsername,
  findClaimedCard,
  findOwnCardByUsername,
  isDataUrl,
  parseDataUrl,
  extFromMime,
  CLAIM_DRAFT_ID_KEY,
} from "@/lib/draft-claim";

// ── Claim ownership + gating (the pure core the route calls) ─────────────────
describe("buildClaimInsert — ownership", () => {
  it("always attaches the row to the SESSION user, never the payload's user_id", () => {
    // Attacker-controlled draft trying to smuggle a foreign owner / row id.
    const payload = {
      username: "acme",
      name: "Mallory",
      user_id: "attacker-id",
      id: "evil-card-id",
      created_at: "1999-01-01",
    };
    const r = buildClaimInsert("session-user-123", payload, false);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.insert.user_id).toBe("session-user-123");
    // The allow-list means smuggled fields never reach the insert.
    expect(r.insert).not.toHaveProperty("id");
    expect(r.insert).not.toHaveProperty("created_at");
    expect(r.insert.name).toBe("Mallory");
  });

  it("cannot claim one user's draft under another user's id (account switching)", () => {
    const payload = { username: "shared", name: "x" };
    const a = buildClaimInsert("user-A", payload, false);
    const b = buildClaimInsert("user-B", payload, false);
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.insert.user_id).toBe("user-A");
    expect(b.insert.user_id).toBe("user-B");
    expect(a.insert.user_id).not.toBe(b.insert.user_id);
  });

  it("ignores fields outside the allow-list", () => {
    const r = buildClaimInsert("u1", { username: "x", plan: "enterprise", evil: "y" }, false);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.insert).not.toHaveProperty("plan");
    expect(r.insert).not.toHaveProperty("evil");
  });
});

describe("buildClaimInsert — plan gating (mirrors api/cards)", () => {
  it("free: strips Pro-only design keys and downgrades a custom template", () => {
    const r = buildClaimInsert(
      "u1",
      { username: "x", template: "custom", customization: { accentColor: "#f00", font: "serif", bio: "hi" } },
      false,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.insert.template).toBe("classic-pro");
    expect(r.insert.customization).not.toHaveProperty("accentColor");
    expect(r.insert.customization).not.toHaveProperty("font");
    // Free-baseline customization survives.
    expect(r.insert.customization.bio).toBe("hi");
  });

  it("paid: keeps the custom template and Pro design keys", () => {
    const r = buildClaimInsert(
      "u1",
      { username: "x", template: "custom", customization: { accentColor: "#f00" } },
      true,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.insert.template).toBe("custom");
    expect(r.insert.customization.accentColor).toBe("#f00");
  });
});

describe("sanitizeUsername", () => {
  it("lowercases valid slugs and rejects invalid ones", () => {
    expect(sanitizeUsername("john-smith")).toBe("john-smith");
    expect(sanitizeUsername("JohnSmith")).toBe("johnsmith");
    expect(sanitizeUsername("  ada99 ")).toBe("ada99");
    expect(sanitizeUsername("john smith")).toBeNull(); // space
    expect(sanitizeUsername("bad,name")).toBeNull(); // filter-breaking char
    expect(sanitizeUsername("")).toBeNull();
    expect(sanitizeUsername(undefined)).toBeNull();
  });

  it("buildClaimInsert fails without a username / with an invalid one", () => {
    expect(buildClaimInsert("u1", { name: "x" }, false).ok).toBe(false);
    expect(buildClaimInsert("u1", { username: "bad name" }, false).ok).toBe(false);
  });
});

describe("idempotency helpers", () => {
  it("finds an already-claimed card by draft id", () => {
    const cards = [
      { id: "c1", username: "a", customization: { [CLAIM_DRAFT_ID_KEY]: "draft-1" } },
      { id: "c2", username: "b", customization: {} },
    ];
    expect(findClaimedCard(cards, "draft-1")?.id).toBe("c1");
    expect(findClaimedCard(cards, "missing")).toBeNull();
    expect(findClaimedCard(cards, null)).toBeNull();
    expect(findClaimedCard([], "draft-1")).toBeNull();
  });

  it("finds an own card by username (resolves a unique-violation)", () => {
    const cards = [{ id: "c1", username: "acme" }];
    expect(findOwnCardByUsername(cards, "acme")?.id).toBe("c1");
    expect(findOwnCardByUsername(cards, "other")).toBeNull();
  });
});

describe("deferred image data URLs", () => {
  it("detects and parses base64 data URLs", () => {
    expect(isDataUrl("data:image/png;base64,AAAA")).toBe(true);
    expect(isDataUrl("https://x/y.png")).toBe(false);
    expect(isDataUrl(null)).toBe(false);
    expect(parseDataUrl("data:image/png;base64,AAAA")).toEqual({ mime: "image/png", base64: "AAAA" });
    expect(parseDataUrl("data:image/png,notbase64")).toBeNull(); // non-base64 unsupported
    expect(extFromMime("image/jpeg")).toBe("jpg");
    expect(extFromMime("image/webp")).toBe("webp");
    expect(extFromMime("application/pdf")).toBe("jpg"); // fallback
  });
});

// ── Guest draft store (localStorage) ─────────────────────────────────────────
function makeLocalStorage() {
  const store = new Map<string, string>();
  return {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  };
}

// Fresh module instance (module-level in-memory cache reset) sharing the given
// localStorage — simulates a page load.
async function freshStore(ls: ReturnType<typeof makeLocalStorage>) {
  vi.resetModules();
  (globalThis as unknown as { localStorage: unknown }).localStorage = ls;
  return await import("@/lib/guest-draft");
}

describe("guest draft store", () => {
  let ls: ReturnType<typeof makeLocalStorage>;
  beforeEach(() => {
    // saveDraft debounces its storage write by 400ms on a real setTimeout. A
    // test that saved without flushing left that timer running, and under a
    // busy full-suite run it fired during the NEXT test — writing the old
    // draft into that test's fresh localStorage (the global is swapped per
    // test), so "no draft → no consent" suddenly had a draft. Fake timers,
    // cleared after each test, keep every test's writes its own. No test here
    // waits on the debounce: each flushes explicitly.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    ls = makeLocalStorage();
    (globalThis as unknown as { localStorage: unknown }).localStorage = ls;
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("persists guest CARD edits as a payload snapshot", async () => {
    const m = await freshStore(ls);
    m.saveDraft({ payload: { username: "acme", name: "Ada" }, step: 1 });
    m.flushDraft();
    expect(m.hasPendingDraft()).toBe(true);
    expect((m.loadDraft()?.payload as { name?: string }).name).toBe("Ada");
    const raw = JSON.parse(ls.getItem("swiftcard_guest_draft")!);
    expect(raw.payload.username).toBe("acme");
    expect(raw.kind).toBe("card");
  });

  it("persists SwiftLink AND Email Signature settings (all live in payload.customization)", async () => {
    const m = await freshStore(ls);
    m.saveDraft({
      payload: {
        username: "x",
        customization: {
          bio: "my swiftlink bio",
          links: [{ label: "site", url: "https://x" }],
          signature: { enabled: true, layout: "modern" },
        },
      },
    });
    m.flushDraft();
    const cust = (m.loadDraft()?.payload as { customization: Record<string, unknown> }).customization;
    expect(cust.bio).toBe("my swiftlink bio");
    expect((cust.signature as { enabled: boolean }).enabled).toBe(true);
    expect((cust.links as unknown[]).length).toBe(1);
  });

  it("stores deferred images (base64) alongside the payload", async () => {
    const m = await freshStore(ls);
    m.saveDraft({ payload: { username: "x" }, images: { logo: "data:image/png;base64,AAAA" } });
    m.flushDraft();
    expect(m.loadDraft()?.images.logo).toBe("data:image/png;base64,AAAA");
  });

  it("recovers a draft after a page reload (fresh module, same storage)", async () => {
    const m1 = await freshStore(ls);
    m1.saveDraft({ payload: { username: "recover" } });
    m1.flushDraft();
    const m2 = await freshStore(ls);
    expect(m2.hasPendingDraft()).toBe(true);
    expect((m2.loadDraft()?.payload as { username?: string }).username).toBe("recover");
  });

  it("keeps a stable id across saves and sets updatedAt", async () => {
    const m = await freshStore(ls);
    m.saveDraft({ payload: { username: "a" } });
    const id1 = m.loadDraft()?.id;
    expect(id1).toBeTruthy();
    m.saveDraft({ payload: { username: "a", name: "b" } });
    expect(m.loadDraft()?.id).toBe(id1);
    expect(typeof m.loadDraft()?.updatedAt).toBe("number");
  });

  it("clearDraft removes it (post-claim cleanup)", async () => {
    const m = await freshStore(ls);
    m.saveDraft({ payload: { username: "a" } });
    m.flushDraft();
    m.clearDraft();
    expect(m.hasPendingDraft()).toBe(false);
    expect(ls.getItem("swiftcard_guest_draft")).toBeNull();
  });

  it("treats a corrupt stored draft as none (never throws)", async () => {
    ls.setItem("swiftcard_guest_draft", "{not valid json");
    const m = await freshStore(ls);
    expect(m.loadDraft()).toBeNull();
    expect(m.hasPendingDraft()).toBe(false);
  });

  // ── Claim consent — the cross-account leak guard ───────────────────────────
  // A draft may ONLY be claimed when the guest explicitly chose an account for
  // it at the gate. An abandoned draft must never attach to whichever account
  // signs in next on the same browser.
  it("a fresh draft carries NO claim consent", async () => {
    const m = await freshStore(ls);
    m.saveDraft({ payload: { name: "Guest Work" } });
    m.flushDraft();
    expect(m.hasClaimConsent()).toBe(false);
  });

  it("markClaimConsent grants consent, and it survives a reload", async () => {
    const m1 = await freshStore(ls);
    m1.saveDraft({ payload: { name: "Guest Work" } });
    m1.markClaimConsent();
    expect(m1.hasClaimConsent()).toBe(true);
    // Same browser, new page load (login round-trip / email-confirm return).
    const m2 = await freshStore(ls);
    expect(m2.hasClaimConsent()).toBe(true);
  });

  it("consent expires after CLAIM_CONSENT_MAX_AGE_MS", async () => {
    const m = await freshStore(ls);
    m.saveDraft({ payload: { name: "Guest Work" } });
    m.markClaimConsent();
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now + m.CLAIM_CONSENT_MAX_AGE_MS + 1);
    try {
      expect(m.hasClaimConsent()).toBe(false);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("consent without a draft is meaningless (no draft → no consent)", async () => {
    const m = await freshStore(ls);
    m.markClaimConsent(); // no-op: nothing to consent about
    expect(m.hasClaimConsent()).toBe(false);
  });

  it("editing after consenting keeps the consent (same draft, same person)", async () => {
    const m = await freshStore(ls);
    m.saveDraft({ payload: { name: "v1" } });
    m.markClaimConsent();
    m.saveDraft({ payload: { name: "v2" } });
    m.flushDraft();
    expect(m.hasClaimConsent()).toBe(true);
  });
});

// ── Claim normalizes socials like /api/cards does ────────────────────────────
describe("buildClaimInsert — social normalization", () => {
  it("stores a guest-typed LinkedIn value in linkable form", () => {
    const r = buildClaimInsert("session-user", {
      username: "acme",
      name: "A",
      linkedin: "https://www.linkedin.com/in/aaron-lavi/",
      instagram: "https://instagram.com/aaron",
      twitter: "aaron",
    }, false);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.insert.linkedin).toBe("linkedin.com/in/aaron-lavi");
    expect(r.insert.instagram).toBe("@aaron");
    expect(r.insert.twitter).toBe("@aaron");
  });

  it("a spaced name in the LinkedIn field becomes a hyphenated handle path", () => {
    const r = buildClaimInsert("session-user", { username: "acme", name: "A", linkedin: "John Doe" }, false);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.insert.linkedin).toBe("linkedin.com/in/john-doe");
  });
});
