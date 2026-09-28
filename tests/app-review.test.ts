import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The App Store rating system has two halves and this pins both:
//  - Apple's automatic sheet (lib/app-review.ts → AppReview.swift), which may
//    only follow a real win, never on first launch, at most once per 90 days,
//    and never from a tap;
//  - the "Rate us" button (RateUsCard), a plain link to the App Store built from
//    an env var — write-review in the app, the listing on the web.

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const DAY = 86_400_000;

// ── the rules, as a pure function ───────────────────────────────────────────
describe("shouldAskForReview", async () => {
  const { shouldAskForReview, REASK_DAYS, MIN_DAYS_INSTALLED, SHARES_NEEDED, ACTIVE_DAYS_NEEDED } = await import("@/lib/app-review");
  const now = Date.UTC(2026, 8, 11);
  const base = { firstSeen: now - 10 * DAY, lastPrompted: null, shares: 0, hadLead: true, activeDays: 5 };

  it("says yes after a lead, days after install, never asked before", () => {
    expect(shouldAskForReview(base, now)).toBe(true);
  });

  it("uses the thresholds the brief asked for", () => {
    expect(REASK_DAYS).toBe(90);
    expect(SHARES_NEEDED).toBe(3);
    expect(MIN_DAYS_INSTALLED).toBeGreaterThanOrEqual(1);
  });

  // Owner, 2026-09-28: a new user doesn't know the app yet and has nothing to
  // say; someone who has used it for about a week does.
  it("only asks someone who has used the app for about a week", () => {
    expect(MIN_DAYS_INSTALLED).toBeGreaterThanOrEqual(7);
    expect(ACTIVE_DAYS_NEEDED).toBeGreaterThanOrEqual(4);
    expect(shouldAskForReview({ ...base, firstSeen: now - 6 * DAY }, now)).toBe(false);
    expect(shouldAskForReview({ ...base, firstSeen: now - 7 * DAY }, now)).toBe(true);
  });

  it("a week-old install opened on too few days is still a new user", () => {
    expect(shouldAskForReview({ ...base, firstSeen: now - 30 * DAY, activeDays: 1 }, now)).toBe(false);
    expect(shouldAskForReview({ ...base, activeDays: ACTIVE_DAYS_NEEDED - 1 }, now)).toBe(false);
    expect(shouldAskForReview({ ...base, activeDays: ACTIVE_DAYS_NEEDED }, now)).toBe(true);
  });

  it("never on first launch — no install clock yet means no", () => {
    expect(shouldAskForReview({ ...base, firstSeen: null }, now)).toBe(false);
    expect(shouldAskForReview({ ...base, firstSeen: now }, now)).toBe(false);
    expect(shouldAskForReview({ ...base, firstSeen: now - (MIN_DAYS_INSTALLED * DAY - 1) }, now)).toBe(false);
  });

  it("needs a real win: a lead, or 3 shares", () => {
    const noWin = { ...base, hadLead: false };
    expect(shouldAskForReview({ ...noWin, shares: 0 }, now)).toBe(false);
    expect(shouldAskForReview({ ...noWin, shares: 2 }, now)).toBe(false);
    expect(shouldAskForReview({ ...noWin, shares: 3 }, now)).toBe(true);
  });

  it("at most once per 90 days", () => {
    expect(shouldAskForReview({ ...base, lastPrompted: now - 89 * DAY }, now)).toBe(false);
    expect(shouldAskForReview({ ...base, lastPrompted: now - 90 * DAY }, now)).toBe(true);
  });
});

// ── the real entry points, against an in-memory store ───────────────────────
describe("noteReviewMoment / maybeAskForReview", () => {
  let mem: Map<string, string>;
  let requestReview: ReturnType<typeof vi.fn>;
  let native = true;

  beforeEach(() => {
    vi.resetModules();
    mem = new Map();
    requestReview = vi.fn(async () => ({ requested: true }));
    native = true;
    vi.doMock("@/lib/platform", () => ({ detectNativeApp: () => native }));
    vi.doMock("@capacitor/preferences", () => ({
      Preferences: {
        get: async ({ key }: { key: string }) => ({ value: mem.get(key) ?? null }),
        set: async ({ key, value }: { key: string; value: string }) => { mem.set(key, value); },
      },
    }));
    vi.stubGlobal("window", { Capacitor: { Plugins: { AppReview: { requestReview } } } });
    vi.useFakeTimers();
    vi.setSystemTime(Date.UTC(2026, 8, 11));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.doUnmock("@/lib/platform");
    vi.doUnmock("@capacitor/preferences");
  });

  it("first launch starts the clock and asks nothing, even with a lead", async () => {
    const m = await import("@/lib/app-review");
    expect(await m.maybeAskForReview({ hasLead: true })).toBe(false);
    expect(mem.get("sc_review_first_seen")).toBeTruthy();
    expect(requestReview).not.toHaveBeenCalled();
  });

  it("asks once after 3 shares + a week of use, then not again for 90 days", async () => {
    const m = await import("@/lib/app-review");
    await m.maybeAskForReview();                      // day 0: clock starts (active day 1)
    for (let i = 0; i < 3; i++) await m.noteReviewMoment("card_shared");
    expect(requestReview).not.toHaveBeenCalled();     // recording never prompts

    vi.setSystemTime(Date.UTC(2026, 8, 18, 12));      // day 7, but only the 2nd day opened
    expect(await m.maybeAskForReview()).toBe(false);
    vi.setSystemTime(Date.UTC(2026, 8, 18, 15));      // same day again — still 2 days
    expect(await m.maybeAskForReview()).toBe(false);
    expect(mem.get("sc_review_active_days")).toBe("2");
    vi.setSystemTime(Date.UTC(2026, 8, 19, 12));      // 3rd day
    expect(await m.maybeAskForReview()).toBe(false);
    vi.setSystemTime(Date.UTC(2026, 8, 20, 12));      // 4th day: a week in, used on 4 days
    expect(await m.maybeAskForReview()).toBe(true);
    expect(requestReview).toHaveBeenCalledTimes(1);
    expect(mem.get("sc_review_last_prompted")).toBe(new Date(Date.UTC(2026, 8, 20, 12)).toISOString());

    vi.setSystemTime(Date.UTC(2026, 10, 1));          // ~48 days later
    expect(await m.maybeAskForReview()).toBe(false);
    vi.setSystemTime(Date.UTC(2026, 11, 19, 11));     // a hair under 90 days
    expect(await m.maybeAskForReview()).toBe(false);
    vi.setSystemTime(Date.UTC(2026, 11, 19, 12));     // 90 days later
    expect(await m.maybeAskForReview()).toBe(true);
    expect(requestReview).toHaveBeenCalledTimes(2);
  });

  it("marks before it asks — a throwing plugin still does not re-arm", async () => {
    requestReview.mockRejectedValueOnce(new Error("no plugin"));
    const m = await import("@/lib/app-review");
    mem.set("sc_review_first_seen", new Date(Date.UTC(2026, 7, 1)).toISOString());
    mem.set("sc_review_active_days", "10");
    expect(await m.maybeAskForReview({ hasLead: true })).toBe(true);
    expect(await m.maybeAskForReview({ hasLead: true })).toBe(false);
    expect(requestReview).toHaveBeenCalledTimes(1);
  });

  it("two overlapping checks ask once, not twice", async () => {
    const m = await import("@/lib/app-review");
    mem.set("sc_review_first_seen", new Date(Date.UTC(2026, 7, 1)).toISOString());
    mem.set("sc_review_active_days", "10");
    const [a, b] = await Promise.all([m.maybeAskForReview({ hasLead: true }), m.maybeAskForReview({ hasLead: true })]);
    expect([a, b]).toEqual([true, true]); // the same single check, shared
    expect(requestReview).toHaveBeenCalledTimes(1);
    expect(await m.maybeAskForReview({ hasLead: true })).toBe(false);
  });

  it("does nothing at all on the web", async () => {
    native = false;
    const m = await import("@/lib/app-review");
    await m.noteReviewMoment("card_shared");
    expect(await m.maybeAskForReview({ hasLead: true })).toBe(false);
    expect(mem.size).toBe(0);
    expect(requestReview).not.toHaveBeenCalled();
  });
});

// ── wiring: never from a tap, never on sentiment ────────────────────────────
describe("where the sheet can be requested from", () => {
  it("noteReviewMoment only records — it never reaches the plugin", () => {
    const s = code("src/lib/app-review.ts");
    const note = s.slice(s.indexOf("export async function noteReviewMoment"), s.indexOf("let inFlight"));
    expect(note).not.toMatch(/requestReview|maybeAskForReview/);
  });

  it("only the passive dashboard trigger calls maybeAskForReview", () => {
    const callers = ["src/components/ShareButton.tsx", "src/components/ShareMyInfoButton.tsx", "src/components/RateUsCard.tsx", "src/app/grow/page.tsx"];
    for (const f of callers) expect(code(f)).not.toMatch(/maybeAskForReview|requestReview/);
    const t = code("src/components/ReviewPromptTrigger.tsx");
    expect(t).toMatch(/maybeAskForReview/);
    expect(t).toMatch(/setTimeout/);
    expect(t).not.toMatch(/onClick/);
    expect(read("src/app/dashboard/page.tsx")).toMatch(/<ReviewPromptTrigger hasLead=\{realLeadCount > 0\} \/>/);
  });

  it("dashboard shares of your own card are the ones that count", () => {
    const d = read("src/app/dashboard/page.tsx");
    expect((d.match(/<ShareButton[\s\S]*?\/>/g) ?? []).every((tag) => /\bownCard\b/.test(tag))).toBe(true);
    expect(code("src/components/ShareButton.tsx")).toMatch(/if \(ownCard\)/);
  });

  it("nothing about the rating system looks at stars or sentiment", () => {
    for (const f of ["src/lib/app-review.ts", "src/components/RateUsCard.tsx", "src/components/ReviewPromptTrigger.tsx"]) {
      expect(code(f)).not.toMatch(/trustpilot|setRating|stars?\b|sentiment|happy|feedback/i);
    }
  });

  it("the native plugin holds its own 90-day line", () => {
    const s = read("ios/App/App/AppReview.swift");
    expect(s).toMatch(/90 \* 24 \* 60 \* 60/);
    expect(s.indexOf("lastRequestedKey) as? Date")).toBeLessThan(s.indexOf("AppStore.requestReview(in:"));
  });
});

// ── the Rate us button ──────────────────────────────────────────────────────
describe("Rate us links", () => {
  beforeEach(() => { vi.resetModules(); });
  afterEach(() => { vi.unstubAllEnvs(); });

  it("builds both URLs from NEXT_PUBLIC_APP_STORE_ID", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_STORE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_APP_STORE_ID", "1234567890");
    const m = await import("@/lib/app-store");
    expect(m.APP_STORE_ID).toBe("1234567890");
    expect(m.APP_STORE_LISTING_URL).toBe("https://apps.apple.com/app/id1234567890");
    expect(m.APP_STORE_WRITE_REVIEW_URL).toBe("https://apps.apple.com/app/id1234567890?action=write-review");
  });

  it("falls back to the id in NEXT_PUBLIC_APP_STORE_URL", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_STORE_ID", "");
    vi.stubEnv("NEXT_PUBLIC_APP_STORE_URL", "https://apps.apple.com/app/id6798875872");
    const m = await import("@/lib/app-store");
    expect(m.APP_STORE_WRITE_REVIEW_URL).toBe("https://apps.apple.com/app/id6798875872?action=write-review");
  });

  it("no id, no link — and junk in the env var is not baked into one", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_STORE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_APP_STORE_ID", "id123; evil");
    const m = await import("@/lib/app-store");
    expect(m.APP_STORE_ID).toBeNull();
    expect(m.APP_STORE_WRITE_REVIEW_URL).toBeNull();
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { createElement: h } = await import("react");
    const card = await import("@/components/RateUsCard");
    expect(renderToStaticMarkup(h(card.default))).toBe("");
  });

  it("the id is never hardcoded in the rating code", () => {
    for (const f of ["src/components/RateUsCard.tsx", "src/lib/app-review.ts", "src/lib/app-store.ts", "src/app/grow/page.tsx"]) {
      expect(code(f)).not.toMatch(/6798875872/);
    }
  });

  it("server render (= the web) links to the listing, opened outside the webview", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_STORE_ID", "6798875872");
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { createElement: h } = await import("react");
    const card = await import("@/components/RateUsCard");
    const out = renderToStaticMarkup(h(card.default));
    expect(out).toContain('href="https://apps.apple.com/app/id6798875872"');
    expect(out).toContain('target="_blank"');
    expect(out).toContain("Rate us on the App Store");
  });

  it("the app gets the write-review link", () => {
    expect(code("src/components/RateUsCard.tsx")).toMatch(/native \? APP_STORE_WRITE_REVIEW_URL : APP_STORE_LISTING_URL/);
  });
});
