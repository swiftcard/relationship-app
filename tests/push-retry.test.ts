import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── A push that didn't get an answer is tried once more (audit N-05) ────────
//
// Each device used to get exactly one attempt: a timeout or a busy answer
// from Apple was logged "failed" and the notification was gone. Now a
// transient failure is retried once; a permanent answer never is, and a
// dead device is still pruned at once.

type Row = Record<string, unknown>;

let subscriptions: Row[] = [];
const inserted: Row[] = [];
const deleted: string[] = [];
let apnsScript: Row[] = [];
let fcmScript: Row[] = [];
const apnsCalls: string[] = [];
const fcmCalls: string[] = [];

function logQuery() {
  const q: Record<string, unknown> = {};
  for (const k of ["eq", "in", "gte", "order"]) q[k] = () => q;
  q.limit = async () => ({ data: [] });
  return q;
}

vi.mock("@/lib/supabase-admin", () => ({
  getAdminSupabase: () => ({
    from: (table: string) => {
      if (table === "profiles") return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { plan: "pro", customization: {} } }) }) }) };
      if (table === "push_subscriptions") {
        return {
          select: () => ({ eq: async () => ({ data: subscriptions }) }),
          delete: () => ({ eq: async (_c: string, endpoint: string) => { deleted.push(endpoint); return {}; } }),
        };
      }
      if (table === "push_log") return { insert: async (row: Row) => { inserted.push(row); return {}; }, select: () => logQuery() };
      throw new Error("unexpected table " + table);
    },
  }),
}));
vi.mock("@/lib/report-error", () => ({ reportError: async () => {} }));
vi.mock("@/lib/apns", () => ({
  isApnsEndpoint: (e: string) => e.startsWith("apns:"),
  sendApnsDetailed: async (endpoint: string) => { apnsCalls.push(endpoint); return apnsScript.shift() ?? { result: "sent", status: 200, reason: "", env: "production" }; },
  sendApnsBadge: async () => ({ result: "sent", status: 200, reason: "" }),
}));
vi.mock("@/lib/fcm", () => ({
  isFcmEndpoint: (e: string) => e.startsWith("fcm:"),
  sendFcmDetailed: async (endpoint: string) => { fcmCalls.push(endpoint); return fcmScript.shift() ?? { result: "sent", status: 200, reason: "" }; },
}));

import { sendPushToUser, isTransientPushFailure } from "@/lib/push";

const MIDDAY = new Date("2026-09-06T14:00:00.000Z");

beforeEach(() => {
  // Only the clock is faked: the retry's real 1.2s wait has to run.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(MIDDAY);
  subscriptions = [{ endpoint: "apns:tok-1", p256dh: "apns", auth: "apns" }];
  inserted.length = 0;
  deleted.length = 0;
  apnsScript = [];
  fcmScript = [];
  apnsCalls.length = 0;
  fcmCalls.length = 0;
});
afterEach(() => vi.useRealTimers());

const lead = () => sendPushToUser("u1", { category: "new_lead", title: "New contact", body: "Maya Cohen shared her details", url: "/contacts", tag: "lead-L1" });
const outcome = () => inserted[inserted.length - 1]?.outcome;

describe("which failures get a second try", () => {
  it("no answer, a timeout, busy or a server error — yes", () => {
    expect(isTransientPushFailure({ result: "error", status: 0, reason: "timeout" }, "apns")).toBe(true);
    expect(isTransientPushFailure({ result: "error", status: 0, reason: "ECONNRESET" }, "apns")).toBe(true);
    expect(isTransientPushFailure({ result: "error", status: 429, reason: "TooManyRequests" }, "apns")).toBe(true);
    expect(isTransientPushFailure({ result: "error", status: 503, reason: "ServiceUnavailable" }, "fcm")).toBe(true);
    expect(isTransientPushFailure({ result: "error", status: 401, reason: "" }, "fcm")).toBe(true);
  });

  it("a permanent answer, a missing key or a dead device — never", () => {
    expect(isTransientPushFailure({ result: "sent", status: 200, reason: "" }, "apns")).toBe(false);
    expect(isTransientPushFailure({ result: "gone", status: 410, reason: "Unregistered" }, "apns")).toBe(false);
    expect(isTransientPushFailure({ result: "not_configured", status: 0, reason: "not_configured" }, "apns")).toBe(false);
    expect(isTransientPushFailure({ result: "error", status: 0, reason: "no_token" }, "apns")).toBe(false);
    expect(isTransientPushFailure({ result: "error", status: 0, reason: "bad_signing_key" }, "apns")).toBe(false);
    expect(isTransientPushFailure({ result: "error", status: 400, reason: "BadDeviceToken" }, "apns")).toBe(false);
    expect(isTransientPushFailure({ result: "error", status: 403, reason: "InvalidProviderToken" }, "apns")).toBe(false);
    expect(isTransientPushFailure({ result: "error", status: 401, reason: "" }, "apns")).toBe(false);
  });
});

describe("sendPushToUser", () => {
  it("a timeout, then success: delivered, and logged as sent", async () => {
    apnsScript = [{ result: "error", status: 0, reason: "timeout" }, { result: "sent", status: 200, reason: "" }];
    await lead();
    expect(apnsCalls).toHaveLength(2);
    expect(outcome()).toBe("sent");
  });

  it("an Android 503, then success: the same", async () => {
    subscriptions = [{ endpoint: "fcm:tok-a", p256dh: "fcm", auth: "fcm" }];
    fcmScript = [{ result: "error", status: 503, reason: "unavailable" }, { result: "sent", status: 200, reason: "" }];
    await lead();
    expect(fcmCalls).toHaveLength(2);
    expect(outcome()).toBe("sent");
  });

  it("only ONE more try: two timeouts is a failed push", async () => {
    apnsScript = [{ result: "error", status: 0, reason: "timeout" }, { result: "error", status: 0, reason: "timeout" }, { result: "sent", status: 200, reason: "" }];
    await lead();
    expect(apnsCalls).toHaveLength(2);
    expect(outcome()).toBe("failed");
  });

  it("a permanent refusal is not retried", async () => {
    apnsScript = [{ result: "error", status: 400, reason: "BadDeviceToken" }];
    await lead();
    expect(apnsCalls).toHaveLength(1);
    expect(outcome()).toBe("failed");
  });

  it("a dead device is pruned at once, never retried", async () => {
    apnsScript = [{ result: "gone", status: 410, reason: "Unregistered" }];
    await lead();
    expect(apnsCalls).toHaveLength(1);
    expect(deleted).toEqual(["apns:tok-1"]);
  });

  it("a first-try success sends once", async () => {
    await lead();
    expect(apnsCalls).toHaveLength(1);
    expect(outcome()).toBe("sent");
  });
});
