import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Browser push with no keys to sign with is a fault, not a quiet skip (NM-12) ──
//
// Web pushes are only built when both VAPID keys are set. Without them every
// browser subscription was skipped with no failure string, and a person with
// only browser subscriptions was logged "no_deliverable_endpoint", which reads
// like an ordinary policy outcome. Now it reaches push.delivery like any other
// undelivered push.

type Row = Record<string, unknown>;

let subscriptions: Row[] = [];
const inserted: Row[] = [];
const reported: string[] = [];

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
        return { select: () => ({ eq: async () => ({ data: subscriptions }) }), delete: () => ({ eq: async () => ({}) }) };
      }
      if (table === "push_log") return { insert: async (row: Row) => { inserted.push(row); return {}; }, select: () => logQuery() };
      throw new Error("unexpected table " + table);
    },
  }),
}));
vi.mock("@/lib/report-error", () => ({
  reportError: async (where: string, e: unknown) => { reported.push(`${where}: ${e instanceof Error ? e.message : String(e)}`); },
}));
vi.mock("@/lib/apns", () => ({
  isApnsEndpoint: (e: string) => e.startsWith("apns:"),
  sendApnsDetailed: async () => ({ result: "sent", status: 200, reason: "", env: "production" }),
  sendApnsBadge: async () => ({ result: "sent", status: 200, reason: "" }),
}));
vi.mock("@/lib/fcm", () => ({
  isFcmEndpoint: (e: string) => e.startsWith("fcm:"),
  sendFcmDetailed: async () => ({ result: "sent", status: 200, reason: "" }),
}));

import { sendPushToUser } from "@/lib/push";

const saved = { priv: process.env.VAPID_PRIVATE_KEY, pub: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-06T14:00:00.000Z")); // midday, outside quiet hours
  delete process.env.VAPID_PRIVATE_KEY;
  delete process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  inserted.length = 0;
  reported.length = 0;
});
afterEach(() => {
  vi.useRealTimers();
  if (saved.priv !== undefined) process.env.VAPID_PRIVATE_KEY = saved.priv;
  if (saved.pub !== undefined) process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = saved.pub;
});

const lead = () => sendPushToUser("u1", { category: "new_lead", title: "New contact", body: "Maya Cohen shared her details", url: "/contacts", tag: "lead-L1" });
const outcome = () => inserted[inserted.length - 1]?.outcome;

describe("browser subscriptions with no VAPID keys", () => {
  it("only browser subscriptions: logged failed and reported, not 'no endpoint'", async () => {
    subscriptions = [{ endpoint: "https://push.example.com/abc", p256dh: "p", auth: "a" }];
    await lead();
    expect(outcome()).toBe("failed");
    expect(reported.join("\n")).toMatch(/push\.delivery: .*web vapid-keys-missing/);
  });

  it("an iPhone beside them still gets the push, and the missing keys are still reported", async () => {
    subscriptions = [
      { endpoint: "apns:tok-1", p256dh: "apns", auth: "apns" },
      { endpoint: "https://push.example.com/abc", p256dh: "p", auth: "a" },
    ];
    await lead();
    expect(outcome()).toBe("sent");
    expect(reported.join("\n")).toMatch(/web vapid-keys-missing/);
  });

  it("no subscriptions at all is still the ordinary outcome", async () => {
    subscriptions = [];
    await lead();
    expect(reported).toEqual([]);
  });
});
