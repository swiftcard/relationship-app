import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";

// ── Leftover QA accounts are removed, and nothing else ever is (F-AUTH-01) ──
//
// The daily cron deletes QA throwaway accounts a killed QA run left behind.
// It deletes production accounts, so what it may select is pinned here: only
// the reserved .invalid QA domain, only once a day old.

const purged: string[] = [];
let failFor = new Set<string>();
let throwFor = new Set<string>();
vi.mock("@/lib/account-purge", () => ({
  purgeUserData: async (_admin: unknown, id: string) => {
    if (throwFor.has(id)) throw new Error("db down");
    if (failFor.has(id)) return false;
    purged.push(id);
    return true;
  },
}));
vi.mock("@/lib/supabase-admin", () => ({ getAdminSupabase: () => ({}) }));

import { isLeftoverQaAccount, purgeLeftoverQaAccounts, QA_EMAIL_DOMAIN, QA_SWEEP_LIMIT } from "@/lib/qa-account-sweep";

const NOW = Date.UTC(2026, 9, 18, 12);
const DAY = 86_400_000;
const at = (ms: number) => new Date(ms).toISOString();

function adminWith(pages: { id: string; email: string | null; created_at: string }[][]) {
  return {
    auth: {
      admin: {
        listUsers: async ({ page }: { page: number }) => ({ data: { users: pages[page - 1] ?? [] }, error: null }),
      },
    },
  } as never;
}

beforeEach(() => { purged.length = 0; failFor = new Set(); throwFor = new Set(); });

describe("which accounts the sweep may touch", () => {
  it("only the reserved QA domain, and only once it is a day old", () => {
    expect(QA_EMAIL_DOMAIN).toBe("@swiftcard-test.invalid");
    expect(isLeftoverQaAccount({ email: "qa-flows-1@swiftcard-test.invalid", created_at: at(NOW - DAY) }, NOW)).toBe(true);
    expect(isLeftoverQaAccount({ email: "QA-Flows-2@SwiftCard-Test.Invalid", created_at: at(NOW - 2 * DAY) }, NOW)).toBe(true);
    // A QA run in progress.
    expect(isLeftoverQaAccount({ email: "qa-flows-3@swiftcard-test.invalid", created_at: at(NOW - DAY + 1) }, NOW)).toBe(false);
    // Real people, however old.
    for (const email of ["dana@gmail.com", "x@privaterelay.appleid.com", "qa@swiftcard.me", "a@swiftcard-test.invalid.com", "a@notswiftcard-test.invalid.co", null, ""]) {
      expect(isLeftoverQaAccount({ email, created_at: at(NOW - 400 * DAY) }, NOW)).toBe(false);
    }
    // No usable creation date: left alone.
    expect(isLeftoverQaAccount({ email: "qa@swiftcard-test.invalid", created_at: null }, NOW)).toBe(false);
    expect(isLeftoverQaAccount({ email: "qa@swiftcard-test.invalid", created_at: "garbage" }, NOW)).toBe(false);
  });
});

describe("the sweep", () => {
  it("purges leftover QA accounts across pages and leaves everyone else", async () => {
    const page1 = Array.from({ length: 1000 }, (_, i) => ({ id: `real-${i}`, email: `person${i}@example.com`, created_at: at(NOW - 30 * DAY) }));
    page1[10] = { id: "qa-old", email: "qa-flows-a@swiftcard-test.invalid", created_at: at(NOW - 3 * DAY) };
    const page2 = [
      { id: "qa-new", email: "qa-flows-b@swiftcard-test.invalid", created_at: at(NOW - 60_000) },
      { id: "qa-old-2", email: "qa-a11y-c@swiftcard-test.invalid", created_at: at(NOW - 2 * DAY) },
    ];
    const n = await purgeLeftoverQaAccounts(adminWith([page1, page2]), NOW);
    expect(n).toBe(2);
    expect(purged.sort()).toEqual(["qa-old", "qa-old-2"]);
  });

  it("counts only the ones that were really removed (a failed purge is retried tomorrow)", async () => {
    failFor = new Set(["qa-2"]);
    const users = ["qa-1", "qa-2", "qa-3"].map((id) => ({ id, email: `${id}@swiftcard-test.invalid`, created_at: at(NOW - 2 * DAY) }));
    expect(await purgeLeftoverQaAccounts(adminWith([users]), NOW)).toBe(2);
  });

  it("one account that throws doesn't stop the others", async () => {
    throwFor = new Set(["qa-3"]);
    const users = Array.from({ length: 12 }, (_, i) => ({ id: `qa-${i}`, email: `qa-${i}@swiftcard-test.invalid`, created_at: at(NOW - 2 * DAY) }));
    expect(await purgeLeftoverQaAccounts(adminWith([users]), NOW)).toBe(11);
    expect(purged).not.toContain("qa-3");
  });

  it("removes at most QA_SWEEP_LIMIT a run", async () => {
    const users = Array.from({ length: QA_SWEEP_LIMIT + 40 }, (_, i) => ({ id: `qa-${i}`, email: `qa-${i}@swiftcard-test.invalid`, created_at: at(NOW - 2 * DAY) }));
    await purgeLeftoverQaAccounts(adminWith([users]), NOW);
    expect(purged).toHaveLength(QA_SWEEP_LIMIT);
  });

  it("a listing error stops the sweep before anything is deleted", async () => {
    const admin = { auth: { admin: { listUsers: async () => ({ data: null, error: { message: "boom" } }) } } } as never;
    await expect(purgeLeftoverQaAccounts(admin, NOW)).rejects.toThrow(/listUsers/);
    expect(purged).toHaveLength(0);
  });

  it("runs from the daily cron, reported on failure", () => {
    const cron = readFileSync("src/app/api/reminders/route.ts", "utf8");
    expect(cron).toContain("qaAccountsPurged = await purgeLeftoverQaAccounts(supabase);");
    expect(cron).toContain('await reportError("reminders.purge-qa-accounts", e);');
  });
});
