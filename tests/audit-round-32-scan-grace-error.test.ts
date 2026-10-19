import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { DELETION_GRACE_DAYS, deletionGraceOver } from "@/lib/deletion-grace";
import { PURGE_GRACE_DAYS } from "@/lib/account-purge";

// ── Audit round 32 (2026-10-18): messages that match what happened ──────────
//
// F-SCAN-02      A rate limit, an oversized photo and an AI outage were all
//                "try a clear, well-lit photo" — which can help none of them.
// F-SETTINGS-03  The 30-day deletion window was three literals, and reopen and
//                the purge disagreed about the last instant.
// F-MKT-03       The error screen offered "Go to my dashboard" to visitors on
//                public pages, which bounced them to sign-in.

const read = (p: string) => readFileSync(p, "utf8");

describe("F-SCAN-02: the scanner says why it couldn't try", () => {
  it("429, 413 and 503 get their own words; the modal shows them", () => {
    const lib = read("src/lib/scan-card.ts");
    expect(lib).toContain("if (res.status === 429 || res.status === 413 || res.status === 503) {");
    expect(lib).toContain("That photo is too large");
    expect(lib).toContain("You're scanning very quickly");
    expect(lib).toContain("The card reader isn't available right now");
    expect(read("src/components/AddContactModal.tsx")).toContain('else if (err instanceof ScanServiceError) { setScanState("error"); setScanMsg(err.message); }');
  });
});

describe("F-SETTINGS-03: one deletion window, one edge", () => {
  it("every reader uses the same number", () => {
    expect(PURGE_GRACE_DAYS).toBe(DELETION_GRACE_DAYS);
    expect(read("src/app/api/account/reopen/route.ts")).toContain("const expired = !at || deletionGraceOver(at);");
    expect(read("src/app/account-deleted/page.tsx")).toContain("const GRACE_DAYS = DELETION_GRACE_DAYS;");
    for (const f of ["src/app/api/account/reopen/route.ts", "src/app/account-deleted/page.tsx"]) expect(read(f)).not.toMatch(/GRACE_DAYS = 30/);
  });

  it("the last instant is the same for reopen and the purge", () => {
    const t0 = Date.UTC(2026, 9, 1);
    const day = 86_400_000;
    expect(deletionGraceOver(t0, t0 + DELETION_GRACE_DAYS * day - 1)).toBe(false);
    expect(deletionGraceOver(t0, t0 + DELETION_GRACE_DAYS * day)).toBe(true);
  });
});

describe("F-MKT-03: the way out of an error fits where you were", () => {
  it("app pages offer the dashboard; public pages offer the homepage", () => {
    const err = read("src/app/error.tsx");
    expect(err).toContain('const inApp = useSyncExternalStore(noSubscribe, inAppPath, () => false);');
    expect(err).toContain('href={inApp ? "/dashboard" : "/"}');
    expect(err).toContain('{inApp ? "Go to my dashboard" : "Go to the homepage"}');
    const re = new RegExp(err.match(/const APP_PATH = \/(.+)\/;/)![1]);
    expect(re.test("/dashboard")).toBe(true);
    expect(re.test("/settings/flows")).toBe(true);
    expect(re.test("/pricing")).toBe(false);
    expect(re.test("/dana")).toBe(false);
  });
});
