import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ── The iPhone icon's red number has to come DOWN, too ──────────────────────
//
// Owner, 2026-10-07: "I went into my Bell notifications and I read those
// notifications but the red number still shows on the top right of my icon."
//
// Production showed why: since 2026-10-06 every push carried the unread count,
// so a card view put "1" on the icon — and the only thing that could take it
// off again was a plugin in an app build most phones did not have yet. The
// owner read and cleared the bell; the bell had 0 rows; the icon kept its 1.
//
// The number is the BELL's unread count — not a count of pushes. iOS never
// counts anything itself and an app is never told a banner was swiped away,
// so the only number that can be kept true is the in-app one, exactly like
// Mail. These tests hold the three ways it is kept true:
//   1. reading on the website re-sends it to the phone (badge-only push);
//   2. reading in the app is left to the app (no second writer racing it);
//   3. the app, on EVERY installed build, clears the icon once nothing is
//      unread.

type Row = Record<string, unknown>;

let subscriptions: Row[] = [];
let profile: Row | null = { plan: "free", customization: {} };
let unread = 0;
let countFails = false;
const badgeSent: { endpoint: string; count: number }[] = [];
const deleted: string[] = [];
let gone = new Set<string>();

vi.mock("@/lib/supabase-admin", () => ({
  getAdminSupabase: () => ({
    from: (table: string) => {
      if (table === "push_subscriptions") {
        return {
          select: () => ({ eq: async () => ({ data: subscriptions }) }),
          delete: () => ({ eq: async (_c: string, endpoint: string) => { deleted.push(endpoint); return {}; } }),
        };
      }
      if (table === "profiles") {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: profile }) }) }) };
      }
      if (table === "notifications") {
        const q = {
          eq: () => q,
          not: async () => (countFails ? { count: null, error: { message: "down" } } : { count: unread, error: null }),
        };
        return { select: () => q };
      }
      throw new Error("unexpected table " + table);
    },
  }),
}));

vi.mock("@/lib/apns", async (orig) => ({
  ...(await orig<typeof import("@/lib/apns")>()),
  sendApnsBadge: async (endpoint: string, count: number) => {
    badgeSent.push({ endpoint, count });
    return gone.has(endpoint)
      ? { result: "gone", status: 410, reason: "Unregistered", env: "production" }
      : { result: "sent", status: 200, reason: "", env: "production" };
  },
}));

import { syncAppBadge } from "@/lib/push";
import { buildApnsBadge, sendApnsBadge as realSendApnsBadge } from "@/lib/apns";
import { isNativeRequest } from "@/lib/native-request";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");

beforeEach(() => {
  subscriptions = [];
  profile = { plan: "free", customization: {} };
  unread = 0;
  countFails = false;
  badgeSent.length = 0;
  deleted.length = 0;
  gone = new Set();
});

describe("a badge-only push sets the number and shows nothing", () => {
  it("carries the badge and nothing else: no alert, no sound, no url", () => {
    const { headers, body } = buildApnsBadge(0, "me.swiftcard.app");
    expect(JSON.parse(body)).toEqual({ aps: { badge: 0 } });
    expect(headers["apns-push-type"]).toBe("alert");
    expect(headers["apns-priority"]).toBe("10");
    expect(headers["apns-topic"]).toBe("me.swiftcard.app");
    // No collapse id: nothing is displayed, so there is nothing to replace.
    expect(headers).not.toHaveProperty("apns-collapse-id");
  });

  it("is clamped like every other badge", () => {
    expect(JSON.parse(buildApnsBadge(500, "t").body).aps.badge).toBe(99);
    expect(JSON.parse(buildApnsBadge(-3, "t").body).aps.badge).toBe(0);
    expect(JSON.parse(buildApnsBadge(2.6, "t").body).aps.badge).toBe(3);
  });

  it("goes through the same two-host delivery as an alert", () => {
    // A sandbox token answered BadDeviceToken by production must be retried on
    // sandbox, never deleted — the 2026-09 outage (tests/push-delivery-truth).
    const src = read("src/lib/apns.ts");
    expect(src).toMatch(/return deliverToToken\(endpoint, buildApnsAlert\(payload, topic\), post\);/);
    expect(src).toMatch(/return deliverToToken\(endpoint, buildApnsBadge\(count, topic\), post\);/);
    expect(typeof realSendApnsBadge).toBe("function");
  });
});

describe("syncAppBadge: the website tells the phone", () => {
  it("sends the unread count to every iPhone on the account, and nothing to browsers", async () => {
    subscriptions = [
      { endpoint: "apns:phone-1" },
      { endpoint: "apns:phone-2" },
      { endpoint: "https://web.push.apple.com/abc" },
      { endpoint: "fcm:android-1" },
    ];
    unread = 2;
    await syncAppBadge("u1");
    expect(badgeSent).toEqual([
      { endpoint: "apns:phone-1", count: 2 },
      { endpoint: "apns:phone-2", count: 2 },
    ]);
  });

  it("sends 0 when everything is read — that is the whole point", async () => {
    subscriptions = [{ endpoint: "apns:phone-1" }];
    unread = 0;
    await syncAppBadge("u1");
    expect(badgeSent).toEqual([{ endpoint: "apns:phone-1", count: 0 }]);
  });

  it("does nothing for an account with no iPhone", async () => {
    subscriptions = [{ endpoint: "https://fcm.googleapis.com/x" }];
    await syncAppBadge("u1");
    expect(badgeSent).toEqual([]);
  });

  it("a failed count sends no badge, never a wrong one", async () => {
    subscriptions = [{ endpoint: "apns:phone-1" }];
    countFails = true;
    await syncAppBadge("u1");
    expect(badgeSent).toEqual([]);
  });

  it("prunes a phone only when Apple says it is gone", async () => {
    subscriptions = [{ endpoint: "apns:kept" }, { endpoint: "apns:uninstalled" }];
    gone = new Set(["apns:uninstalled"]);
    await syncAppBadge("u1");
    expect(deleted).toEqual(["apns:uninstalled"]);
  });

  it("never throws into the route that called it", async () => {
    subscriptions = [{ endpoint: "apns:phone-1" }];
    profile = null; // no profile row: counted as Free, still sent
    await expect(syncAppBadge("u1")).resolves.toBeUndefined();
    expect(badgeSent).toHaveLength(1);
  });

  it("is not a notification: no push_log row, no caps, no quiet hours", () => {
    const src = read("src/lib/push.ts");
    const body = src.slice(src.indexOf("export async function syncAppBadge"));
    expect(body).not.toMatch(/push_log|decidePush|quietHours/);
  });

  it("every push and every sync read the number from ONE function", () => {
    const src = read("src/lib/push.ts");
    expect(src.match(/await unreadBadgeCount\(admin, userId, /g)).toHaveLength(2);
    // The count itself lives in exactly one place.
    expect(src.match(/\.from\("notifications"\)/g)).toHaveLength(1);
  });
});

describe("every way the bell changes on the website re-sends the number", () => {
  it("read / unread / mark all read (PATCH) and dismiss / clear read (DELETE)", () => {
    const src = read("src/app/api/notifications/route.ts");
    const patch = src.slice(src.indexOf("export async function PATCH"), src.indexOf("export async function DELETE"));
    const del = src.slice(src.indexOf("export async function DELETE"));
    expect(patch).toContain("syncPhoneBadgeAfter(req, user.id);");
    expect(del).toContain("syncPhoneBadgeAfter(req, user.id);");
  });

  it("\"Wrong person?\" removes the alert, so it re-sends too", () => {
    expect(read("src/app/api/leads/[id]/wrong-person/route.ts")).toContain("syncPhoneBadgeAfter(req, user.id);");
  });

  it("skips requests from the app, which sets its own icon", () => {
    const src = read("src/lib/app-badge-sync.ts");
    expect(src).toMatch(/if \(isNativeRequest\(req\.headers\.get\("user-agent"\), req\.cookies\.get\("sc_shell"\)\?\.value \?\? null\)\) return;/);
    expect(src).toMatch(/after\(\(\) => syncAppBadge\(userId\)\)/);
    // The two signals it relies on.
    expect(isNativeRequest("Mozilla/5.0 (iPhone) SwiftCardApp SwiftCardSplash/3", null)).toBe(true);
    expect(isNativeRequest("Mozilla/5.0 (iPhone) Mobile Safari", "1")).toBe(true);
    expect(isNativeRequest("Mozilla/5.0 (Macintosh) Safari", null)).toBe(false);
  });
});

describe("the app clears its own icon on every installed build", () => {
  it("once nothing is unread, it clears the delivered notifications — which sets the icon to 0 even without AppBadge.swift", () => {
    const src = read("src/lib/app-badge.ts");
    expect(src).toContain("if (n === 0) clearDelivered(0);");
    expect(src).toContain("PushNotifications.removeAllDeliveredNotifications()");
    // The plugin call that clears the number lives in the push plugin every
    // shipped build carries.
    const plugin = read("node_modules/@capacitor/push-notifications/ios/Sources/PushNotificationsPlugin/PushNotificationsPlugin.swift");
    const clearAll = plugin.slice(plugin.indexOf("func removeAllDeliveredNotifications"));
    expect(clearAll.slice(0, 600)).toContain("applicationIconBadgeNumber = 0");
  });

  it("still sets the exact number where AppBadge exists, and is a no-op on the web", () => {
    const src = read("src/lib/app-badge.ts");
    expect(src).toContain("if (plugin) void plugin.set({ count: n })");
    expect(src).toMatch(/if \(!detectNativeApp\(\)\) return;/);
  });

  it("the bell still drives it, and sign-out still clears it", () => {
    expect(read("src/components/NotificationBell.tsx")).toMatch(/if \(isNative\) setAppBadge\(unread\);/);
    expect(read("src/lib/device-sign-out.ts")).toContain("setAppBadge(0);");
  });
});
