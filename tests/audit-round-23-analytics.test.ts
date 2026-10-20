import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { storedSource, getSourceLabel } from "@/lib/source-labels";
import { pruneLogTables } from "@/lib/log-retention";

// ── Audit round 23 (2026-10-18): numbers built on what is true ──────────────
//
// A-02  ?source= was stored verbatim: any word became a Traffic row, and a
//       typed ?source=nfc_card counted as a tag tap.
// A-10  QA teardown deleted card_events by a column that doesn't exist (and
//       card_views without the Swift Links key), so every run left rows.
// A-11  The funnel read one 1,000-row page of 12,000+ events; the log tables'
//       promised retention was never applied.

const read = (p: string) => readFileSync(p, "utf8");

describe("A-02: only sources SwiftCard puts on its own links are stored", () => {
  it("known keys pass; anything else is a plain card link (or the page's own default)", () => {
    for (const k of ["qr_code", "nfc_card", "email_signature", "apple_wallet", "google_wallet", "contact_qr", "swift_links", "widget"]) expect(storedSource(k)).toBe(k);
    expect(storedSource("my_campaign")).toBe("direct_link");
    expect(storedSource("toString")).toBe("direct_link"); // not an inherited key
    expect(storedSource(undefined)).toBe("direct_link");
    expect(storedSource("nope", "swift_links")).toBe("swift_links");
  });

  it("the widget has a real label now", () => {
    expect(getSourceLabel("widget")).toBe("Home-screen widget");
  });

  it("all three ingest points use it", () => {
    expect(read("src/app/[username]/page.tsx")).toContain("const source = storedSource(sourceParam);");
    expect(read("src/app/links/[username]/page.tsx")).toContain('const source = storedSource(sourceParam, "swift_links");');
    expect(read("src/app/api/card-events/route.ts")).toContain("const source = rawSource ? storedSource(rawSource) : null;");
  });
});

describe("A-10: QA teardown deletes what it created", () => {
  it.each(["scripts/qa-flows.mjs", "scripts/qa-sweep.mjs", "scripts/qa-android-shell.mjs"])("%s deletes card_events by its real column", (f) => {
    const s = read(f);
    expect(s).not.toMatch(/card_events\?username=/);
    expect(s).toMatch(/card_events\?card_owner_username=eq\./);
  });

  it.each(["scripts/qa-a11y.mjs", "scripts/qa-mac.mjs", "scripts/qa-prod-probe.mjs"])("%s deletes the Swift Links views too", (f) => {
    expect(read(f)).toMatch(/card_views\?username=in\.\(\$\{[a-z.]+\},\$\{[a-z.]+\}__links\)/);
  });
});

describe("A-11: every row counted, and the logs kept to their own retention", () => {
  it("the funnel pages through the database's 1,000-row limit", () => {
    const route = read("src/app/api/admin/analytics/route.ts");
    expect(route).toContain(".range(p * PAGE, p * PAGE + PAGE - 1);");
    expect(route).toContain("if ((data ?? []).length < PAGE) break;");
    expect(route).not.toMatch(/\.limit\(20_000\)/);
  });

  it("the prunes run, each on its own, and failures are named not thrown", async () => {
    const rpc = vi.fn(async (fn: string) => ({ error: fn === "prune_error_events" ? { message: "boom" } : null }));
    const lt = vi.fn(async () => ({ error: null }));
    const admin = { rpc, from: () => ({ delete: () => ({ lt }) }) };
    expect(await pruneLogTables(admin as never, Date.UTC(2026, 9, 18))).toEqual({ failed: ["error_events"] });
    expect(rpc).toHaveBeenCalledWith("prune_product_events");
    expect(lt).toHaveBeenCalledWith("created_at", new Date(Date.UTC(2026, 9, 18) - 14 * 86_400_000).toISOString());
  });

  it("the daily cron runs them; the website's history is left to the owner", () => {
    expect(read("src/app/api/reminders/route.ts")).toContain("const logPrune = await pruneLogTables(supabase);");
    expect(read("src/lib/log-retention.ts")).not.toMatch(/from\("site_pageviews"\)/);
  });
});
