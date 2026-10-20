import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ── A signed-in builder keeps its unfinished card through a refresh ──────────
//
// 2026-09-22 signup review, live on swiftcard.me: someone who created their
// account first and then built a card lost everything on a page refresh —
// drafts were a guest-only feature. Now each signed-in account keeps its OWN
// draft, keyed by account id, so it can never surface for another account on
// the same browser and is never mistaken for the guest draft that gets claimed.

const store = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => { store.set(k, v); },
  removeItem: (k: string) => { store.delete(k); },
});

const lib = await import("@/lib/guest-draft");
const { draftStore, accountDraftKey, GUEST_DRAFT_KEY, loadDraft, saveDraft, clearDraft, flushDraft } = lib;

beforeEach(() => {
  store.clear();
  clearDraft();
  draftStore(accountDraftKey("user-A")).clear();
  draftStore(accountDraftKey("user-B")).clear();
});

describe("per-account drafts", () => {
  it("an account's draft survives (it is written to storage) and reads back", () => {
    const a = draftStore(accountDraftKey("user-A"));
    a.save({ step: 3, payload: { name: "Morgan" } });
    a.flush();
    expect(JSON.parse(store.get("swiftcard_card_draft:user-A")!).payload.name).toBe("Morgan");
    expect(a.load()?.step).toBe(3);
  });

  it("is invisible to another account and to the guest draft — no cross-account leak, no accidental claim", () => {
    draftStore(accountDraftKey("user-A")).save({ payload: { name: "Morgan" } });
    draftStore(accountDraftKey("user-A")).flush();
    expect(draftStore(accountDraftKey("user-B")).load()).toBeNull();
    expect(loadDraft()).toBeNull();
    expect(store.has(GUEST_DRAFT_KEY)).toBe(false);
  });

  it("the guest draft works exactly as before, on its own key", () => {
    saveDraft({ step: 2, payload: { name: "Guest" } });
    flushDraft();
    expect(JSON.parse(store.get(GUEST_DRAFT_KEY)!).payload.name).toBe("Guest");
    expect(draftStore(accountDraftKey("user-A")).load()).toBeNull();
  });

  it("clear removes only that account's draft", () => {
    const a = draftStore(accountDraftKey("user-A"));
    a.save({ payload: { name: "A" } }); a.flush();
    saveDraft({ payload: { name: "G" } }); flushDraft();
    a.clear();
    expect(store.has("swiftcard_card_draft:user-A")).toBe(false);
    expect(store.has(GUEST_DRAFT_KEY)).toBe(true);
  });
});

describe("the builder uses it", () => {
  const w = readFileSync(join(process.cwd(), "src/app/cards/new/NewCardWizard.tsx"), "utf8");
  const page = readFileSync(join(process.cwd(), "src/app/cards/new/page.tsx"), "utf8");

  it("signed-in builders get their own account's draft; never an Office member", () => {
    expect(w).toMatch(/const canDraft = guest \|\| \(!!draftOwner && !org\);/);
    // An Office member's card is held under a separate key that only the
    // LinkedIn photo hop reads back — never offered as an unfinished card.
    expect(w).toMatch(/guest \|\| !draftOwner \? GUEST_DRAFT_KEY\s*: officeHop \? officeHopDraftKey\(draftOwner\)\s*: accountDraftKey\(draftOwner\)/);
    expect(page).toMatch(/draftOwner=\{authedAdd && user \? user\.id : null\}/);
  });

  it("restore, autosave and the resume question all follow canDraft, not guest", () => {
    // keepsDraft = canDraft, plus the Office member's hop-only copy.
    expect(w).toMatch(/const keepsDraft = canDraft \|\| officeHop;/);
    expect(w).toMatch(/if \(!keepsDraft\) \{ hydratedRef\.current = true; applyLiPhoto\(\); return; \}/);
    expect(w).toMatch(/if \(!keepsDraft\) return;/);
    expect(w).toMatch(/if \(canDraft && !resumesSilently\(\) && draftHasWork\(drafts\.load\(\)\)\)/);
    const noComments = w.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(noComments).not.toMatch(/\b(saveDraft|loadDraft|clearDraft)\(/);
  });

  it("a created card is not left behind as an unfinished one", () => {
    expect(w).toMatch(/if \(!guest\) drafts\.clear\(\);/);
    expect(w).toMatch(/if \(step >= 5\) return;/);
  });
});
