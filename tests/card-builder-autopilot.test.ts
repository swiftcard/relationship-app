import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { nextSendAt, recipientTimeZone, stateOf } from "@/lib/prospect-preview/send-at";
import { backoffMs, MAC_GONE_MS, macGone, macReady, MAX_ATTEMPTS, nextStep } from "@/lib/card-builder-jobs/jobs";
import { checkFollowUp, dueForFollowUp, FOLLOWUP_AFTER_MS } from "@/lib/card-builder-jobs/followups";
import { dollarsOf, jsonIn, MODEL, modelOf, NO_USAGE } from "@/lib/card-builder-jobs/llm";
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

describe("Mac first: free on the Mac while it's on, the server only when it isn't", () => {
  const at = (msAgo: number) => ({ at: new Date(Date.parse("2026-11-17T04:00:00Z") - msAgo).toISOString(), note: null, next_send_at: null });
  const now = Date.parse("2026-11-17T04:00:00Z");
  it("gives a batch to a Mac that checked in a minute ago, and takes it back from one silent for 10+ minutes", () => {
    expect(macReady(at(60_000), now)).toBe(true);
    expect(macReady(at(5 * 60_000), now)).toBe(false);
    expect(macGone(at(60_000), now)).toBe(false);
    expect(macGone(at(MAC_GONE_MS + 1), now)).toBe(true);
    expect(macGone({ at: null, note: null, next_send_at: null }, now)).toBe(true);
  });
  it("routes a run-now batch to the Mac when it's on, and the worker hands over or takes over at the start", () => {
    const route = read("src/app/api/admin/card-builder/batches/route.ts");
    expect(route).toMatch(/macReady\(/);
    expect(route).toMatch(/engine: onMac \? "mac" : "server"/);
    const jobs = read("src/lib/card-builder-jobs/jobs.ts");
    expect(jobs).toMatch(/takeOverFromMac\(mac, now\(\)\)/);
    expect(jobs).toMatch(/handToMac\(/);
  });
  it("the Mac stops a chunk the server took over, so no office is built twice", () => {
    const agent = read("scripts/card-builder-mac/agent.mjs");
    expect(agent).toMatch(/\.eq\("engine", "mac"\)/);
    expect(agent).toMatch(/dropMovedBatch/);
    expect(agent).toMatch(/after\.engine !== "mac"/);
  });
  it("lets the Mac's Claude Code write its JSON files (Edit rules govern writes; a Write rule is ignored)", () => {
    const agent = read("scripts/card-builder-mac/agent.mjs");
    expect(agent).toMatch(/"--allowedTools", "[^"]*Edit\(\.\/work\/\*\*\)/);
    expect(agent).not.toMatch(/Write\(\.\/work/);
    expect(agent).not.toMatch(/"--disallowedTools", "[^"]*\bEdit\b/);
  });
});

describe("what a server card costs, by model", () => {
  const u = { ...NO_USAGE, input: 1_000_000, output: 1_000_000 };
  it("prices Opus 5.5, Sonnet 5.5 and Haiku 5.5 at their list prices", () => {
    expect(dollarsOf(u, "claude-opus-5-5")).toBeCloseTo(24);
    expect(dollarsOf(u)).toBeCloseTo(12); // the default is Sonnet
    expect(dollarsOf(u, "claude-sonnet-5-5")).toBeCloseTo(12);
    expect(dollarsOf(u, "claude-haiku-5-5")).toBeCloseTo(3);
  });
  it("a job may be pinned to a model; anything else is the default", () => {
    expect(modelOf("claude-sonnet-5-5")).toBe("claude-sonnet-5-5");
    expect(modelOf("gpt-4")).toBe(MODEL);
    expect(modelOf(undefined)).toBe(MODEL);
    // The server builds on Sonnet unless a job is pinned (owner's pick, 2026-11-17).
    expect(MODEL).toBe("claude-sonnet-5-5");
    expect(modelOf("claude-opus-5-5")).toBe("claude-opus-5-5");
  });
});
