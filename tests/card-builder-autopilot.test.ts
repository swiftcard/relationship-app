import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { nextSendAt, recipientTimeZone, stateOf } from "@/lib/prospect-preview/send-at";
import { backoffMs, MAX_ATTEMPTS, nextStep } from "@/lib/card-builder-jobs/jobs";
import { checkFollowUp, dueForFollowUp, FOLLOWUP_AFTER_MS } from "@/lib/card-builder-jobs/followups";
import { jsonIn } from "@/lib/card-builder-jobs/llm";
import { weekKey } from "@/lib/db-autopilot";
import type { PreviewListRow } from "@/lib/prospect-preview/types";

// Card Builder on autopilot (2026-11-16): the job queue's retry rules, the
// 9 AM recipient-time schedule, the 48-hour follow-up, and the clocks wired
// in vercel.json behind CRON_SECRET.

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8");

describe("send_at: 9 AM in the recipient's time zone", () => {
  it("reads the state from an address", () => {
    expect(stateOf("12 Front St, Brooklyn, NY 11201")).toBe("NY");
    expect(stateOf("500 Main St, Austin, TX")).toBe("TX");
    expect(stateOf("Somewhere without a state")).toBeNull();
    expect(recipientTimeZone("1 Market St, San Francisco, CA 94105", "America/New_York")).toBe("America/Los_Angeles");
    expect(recipientTimeZone(null, "America/Chicago")).toBe("America/Chicago");
  });
  it("is the next 9:00 there, today if it's still early, tomorrow if not", () => {
    // 2026-11-17 06:00 New York (EST, UTC-5) = 11:00 UTC → 9:00 EST same day = 14:00 UTC
    expect(nextSendAt(new Date("2026-11-17T11:00:00Z"), "America/New_York").toISOString()).toBe("2026-11-17T14:00:00.000Z");
    // 10:00 EST → tomorrow 9:00 EST
    expect(nextSendAt(new Date("2026-11-17T15:00:00Z"), "America/New_York").toISOString()).toBe("2026-11-18T14:00:00.000Z");
    // Los Angeles (PST, UTC-8): 9:00 PST = 17:00 UTC
    expect(nextSendAt(new Date("2026-11-17T15:00:00Z"), "America/Los_Angeles").toISOString()).toBe("2026-11-17T17:00:00.000Z");
    // Summer time (EDT, UTC-4)
    expect(nextSendAt(new Date("2026-07-01T05:00:00Z"), "America/New_York").toISOString()).toBe("2026-07-01T13:00:00.000Z");
  });
});

describe("the job queue's own retries", () => {
  it("walks research → build_card → write_opener → ready_for_review", () => {
    expect(nextStep("research")).toBe("build_card");
    expect(nextStep("build_card")).toBe("write_opener");
    expect(nextStep("write_opener")).toBe("ready_for_review");
    expect(nextStep("find")).toBe("ready_for_review");
  });
  it("backs off 5, 10, 20 minutes, and stops after three retries", () => {
    expect([1, 2, 3].map((a) => backoffMs(a) / 60_000)).toEqual([5, 10, 20]);
    expect(MAX_ATTEMPTS).toBe(4);
    const sql = read("supabase/card-builder-autopilot.sql");
    expect(sql).toMatch(/attempts < 4/);
    expect(sql).toMatch(/for update skip locked/);
  });
  it("reads the JSON out of a reply", () => {
    expect(jsonIn('Done.\n```json\n{ "outcome": "skip", "reason": "no mobile number" }\n```')).toEqual({ outcome: "skip", reason: "no mobile number" });
    expect(jsonIn("no json here")).toBeNull();
  });
});

describe("the 48-hour follow-up", () => {
  const now = Date.parse("2026-11-20T15:00:00Z");
  const row = (over: Partial<PreviewListRow>) => ({ status: "live", sent_at: new Date(now - FOLLOWUP_AFTER_MS - 60_000).toISOString(), views: 0, nudge_no_view_at: null, followup_at: null, expires_at: "2026-12-01T00:00:00Z", ...over }) as PreviewListRow;
  it("is due only for a live card sent 48+ hours ago, never opened, never nudged", () => {
    expect(dueForFollowUp(row({}), now)).toBe(true);
    expect(dueForFollowUp(row({ views: 1 }), now)).toBe(false);
    expect(dueForFollowUp(row({ sent_at: new Date(now - 3_600_000).toISOString() }), now)).toBe(false);
    expect(dueForFollowUp(row({ nudge_no_view_at: "2026-11-19T00:00:00Z" }), now)).toBe(false);
    expect(dueForFollowUp(row({ followup_at: "2026-11-19T00:00:00Z" }), now)).toBe(false);
    expect(dueForFollowUp(row({ status: "draft" }), now)).toBe(false);
  });
  it("never lets on that it wasn't opened, and keeps to a text's limits", () => {
    const link = "https://swiftcard.me/p/harbor-realty-x1y2";
    expect(checkFollowUp("Dana, the card for Harbor is still up before Sunday's open house on Hicks St: {link}", link)).toEqual([]);
    expect(checkFollowUp("Dana, saw you haven't opened the card yet: {link}", link).join(" ")).toMatch(/opened/);
    expect(checkFollowUp("Dana, the card is still up", link).join(" ")).toMatch(/\{link\}/);
    expect(checkFollowUp(`Dana, ${"x".repeat(150)} {link}`, link).join(" ")).toMatch(/characters/);
  });
  it("is the nudge the owner sees, and nothing sends it", () => {
    expect(read("src/lib/prospect-preview/outreach.ts")).toMatch(/followup_text/);
    const src = read("src/lib/card-builder-jobs/followups.ts");
    expect(src).not.toMatch(/sendIMessage|prospect_outbox|sendSms|twilio/i);
  });
});

describe("the clocks", () => {
  const vercel = JSON.parse(read("vercel.json")) as { crons: { path: string; schedule: string }[] };
  it("runs the worker and the release every 5 minutes, follow-ups hourly, the database check nightly", () => {
    const at = (p: string) => vercel.crons.find((c) => c.path === p)?.schedule;
    expect(at("/api/card-builder/worker")).toBe("*/5 * * * *");
    expect(at("/api/card-builder/release")).toBe("*/5 * * * *");
    expect(at("/api/card-builder/follow-ups")).toMatch(/^\d+ \* \* \* \*$/);
    expect(at("/api/db-autopilot")).toMatch(/^\d+ \d+ \* \* \*$/);
  });
  it("gives the worker room to finish and to stop cleanly", () => {
    const src = read("src/app/api/card-builder/worker/route.ts");
    expect(src).toMatch(/maxDuration = 800/);
    const budget = Number(/BUDGET_MS = ([\d_]+)/.exec(src)?.[1].replace(/_/g, ""));
    expect(budget).toBeLessThan(800_000);
  });
  it("traces the rules the server runs on into the function", () => {
    expect(read("next.config.ts")).toMatch(/"\/api\/card-builder\/worker": \["\.\/\.claude\/commands\/build-card\.md"/);
  });
  it("weeks are counted ISO-style for the once-a-week size alert", () => {
    expect(weekKey(new Date("2026-11-16T12:00:00Z"))).toBe("2026-W47");
    expect(weekKey(new Date("2027-01-01T12:00:00Z"))).toBe("2026-W53");
  });
});
