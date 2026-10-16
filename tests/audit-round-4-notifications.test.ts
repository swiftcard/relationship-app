import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";

// ── Audit round 4 (2026-10-15): notifications that reach people ─────────────
//
// NS-05  Signing out severed the device's push for good: the same person
//        signing back in got nothing back, and a lapsed session that came
//        back was unbound too. Production was down to one registered device.
// N-11   The switch read "On" from a token that belonged to nobody signed in,
//        launch-time re-registration failures vanished, and someone whose push
//        WORKED and was lost had already used up their reminders.
// N-01   Only a tap inside the bell marked anything read, so the bell and the
//        icon's red number counted news already answered from the lock screen.

type Row = Record<string, unknown>;
let openRows: Row[] = [];
const inserted: Row[] = [];
const pushed: Row[] = [];

vi.mock("@/lib/supabase-admin", () => ({
  getAdminSupabase: () => ({
    from: () => {
      const q = {
        select: () => q, in: () => q, eq: () => q, gte: () => q, order: () => q,
        limit: async () => ({ data: openRows }),
        insert: async (row: Row) => { inserted.push(row); return { error: null }; },
        update: () => ({ eq: () => ({ eq: async () => ({ error: null }) }) }),
      };
      return q;
    },
  }),
}));
vi.mock("@/lib/push", () => ({
  sendPushToUser: async (userId: string, payload: Row) => { pushed.push({ userId, ...payload }); },
}));

import { notifyVisit } from "@/lib/visit-notify";
import { buildApnsAlert } from "@/lib/apns";
import { buildFcmMessage } from "@/lib/fcm";
import { PUSH_ASK_MAX, decidePushAsk, readPushAsk, stopPushAsk } from "@/lib/push-ask";

const read = (p: string) => readFileSync(p, "utf8");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

beforeEach(() => {
  openRows = [];
  inserted.length = 0;
  pushed.length = 0;
});

describe("N-01: a push carries the bell row it announces, and a tap marks it read", () => {
  const notice = (type: string, pushCategory: string) => ({
    type, pushCategory: pushCategory as never, title: "t", body: "b", url: "https://swiftcard.me/contacts",
  });

  it("a new row: the push names the very row that was written", async () => {
    expect(await notifyVisit({ userId: "u1", cardOwner: "dana", visitorId: "v1", notice: notice("card_viewed", "card_view") })).toBe("created");
    expect(inserted[0].id).toMatch(UUID);
    expect(pushed[0].notificationId).toBe(inserted[0].id);
  });

  it("an upgraded row: the push names the row it upgraded", async () => {
    openRows = [{ id: "11111111-2222-4333-8444-555555555555", type: "card_viewed", visit_key: "k" }];
    expect(await notifyVisit({ userId: "u1", cardOwner: "dana", visitorId: "v1", notice: notice("new_lead", "new_lead") })).toBe("upgraded");
    expect(pushed[0].notificationId).toBe("11111111-2222-4333-8444-555555555555");
  });

  it("the id reaches the iPhone (aps custom key), Android (data) and the browser", () => {
    const apns = JSON.parse(buildApnsAlert({ title: "t", body: "b", url: "/x", notificationId: "abc" }, "me.swiftcard").body);
    expect(apns.nid).toBe("abc");
    expect(JSON.parse(buildApnsAlert({ title: "t", body: "b", url: "/x" }, "me.swiftcard").body)).not.toHaveProperty("nid");
    const fcm = buildFcmMessage({ title: "t", body: "b", url: "/x", notificationId: "abc" }, "tok") as { message: { data: Record<string, string> } };
    expect(fcm.message.data).toEqual({ url: "/x", nid: "abc" });
    const sw = read("public/sw.js");
    expect(sw).toContain('nid: data.notificationId ?? null');
  });

  it("the app's tap handler marks the row read, and only ever by id", () => {
    const bridge = read("src/components/NativeAppBridge.tsx");
    const tap = bridge.slice(bridge.indexOf('"pushNotificationActionPerformed"'));
    expect(tap.indexOf("markNotificationRead(data?.nid)")).toBeGreaterThan(-1);
    expect(tap.indexOf("markNotificationRead(data?.nid)")).toBeLessThan(tap.indexOf("window.location.href = path"));
    // A PATCH without an id would mark EVERYTHING read.
    expect(bridge).toMatch(/if \(typeof id !== "string" \|\| !NOTIFICATION_ID\.test\(id\)\) return;/);
  });

  it("the browser's click handler does the same, and only with a real id", () => {
    const sw = read("public/sw.js");
    const click = sw.slice(sw.indexOf('addEventListener("notificationclick"'));
    expect(click).toMatch(/const markRead = nid\s*\?\s*fetch\("\/api\/notifications"/);
    expect(click).toContain(': Promise.resolve();');
    expect(click).toContain("event.waitUntil(Promise.all([markRead,");
  });

  it("opening a contact marks every notification about them read", () => {
    const page = read("src/app/contacts/page.tsx");
    expect(page).toMatch(/\.update\(\{ read: true \}\)\s*\.eq\("user_id", ownerId\)\s*\.eq\("lead_id", selectedLeadParam\)/);
    expect(page).toContain("if (!error && !inApp) await syncAppBadge(ownerId);");
  });
});

describe("N-11: one more reminder when push WORKED and was lost", () => {
  const spent = (() => {
    let l = readPushAsk(undefined);
    for (let i = 0; i < PUSH_ASK_MAX; i++) l = decidePushAsk(l, "app", `n${i}`, i * 10 * 86400_000).next!;
    return l;
  })();
  const later = 100 * 86400_000;

  it("the normal budget is still the limit for someone who never had push", () => {
    expect(decidePushAsk(spent, "app", "x", later).show).toBe(false);
  });

  it("exactly one more for someone whose push worked and was lost", () => {
    const d = decidePushAsk(spent, "app", "x", later, { lostPush: true });
    expect(d.show).toBe(true);
    expect(d.next!.app.again).toBe(true);
    expect(decidePushAsk(d.next!, "app", "y", later * 2, { lostPush: true }).show).toBe(false);
  });

  it("\"Don't ask again\" still wins", () => {
    expect(decidePushAsk(stopPushAsk(spent)!, "app", "x", later, { lostPush: true }).show).toBe(false);
  });

  it("the route only counts push as lost when a delivered push is on record", () => {
    const route = read("src/app/api/push/ask/route.ts");
    expect(route).toMatch(/\.from\("push_log"\)[\s\S]{0,120}\.eq\("outcome", "sent"\)/);
    expect(route.indexOf("const lostPush = await hadPushBefore(user.id);")).toBeGreaterThan(route.indexOf("if (await alreadyOn(user.id, platform))"));
  });

  it("the switch reads ON only for the account the binding belongs to", () => {
    expect(read("src/components/EnablePushButton.tsx")).toContain('const on = perm.receive === "granted" && !!stored && !!uid && owner === uid;');
  });

  it("a failed launch-time re-registration is reported, not swallowed", () => {
    const bridge = read("src/components/NativeAppBridge.tsx");
    expect(bridge).toContain("reportPushRefreshFailure(`launch re-register returned ${r.status}`)");
    expect(bridge).toContain("reportPushRefreshFailure(`launch re-register threw:");
  });
});

describe("NS-05: the same person signing back in gets their push back", () => {
  const store = new Map<string, string>();
  const calls: { url: string; method: string; body: Record<string, unknown> | null }[] = [];

  beforeEach(() => {
    store.clear();
    calls.length = 0;
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v); },
      removeItem: (k: string) => { store.delete(k); },
    });
    vi.stubGlobal("window", { location: { origin: "https://swiftcard.me" } });
    vi.stubGlobal("location", { origin: "https://swiftcard.me", pathname: "/" });
    vi.stubGlobal("Notification", { permission: "granted" });
    const sub = { endpoint: "https://push.example/abc", toJSON: () => ({ endpoint: "https://push.example/abc", keys: { p256dh: "p", auth: "a" } }), unsubscribe: async () => true };
    let current: typeof sub | null = sub;
    vi.stubGlobal("navigator", {
      userAgent: "Mozilla/5.0 (Macintosh)",
      serviceWorker: { ready: Promise.resolve({ pushManager: { getSubscription: async () => current, subscribe: async () => (current = sub) } }) },
    });
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : null });
      if (init?.method === "DELETE") current = null;
      return new Response("{}", { status: 200 });
    });
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = "BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U";
  });
  afterEach(() => vi.unstubAllGlobals());

  it("a plain sign-out remembers who had push on here; their own sign-in reconnects it, without asking", async () => {
    const { unbindDevicePush, resumePushForSameAccount } = await import("@/lib/push-device");
    await unbindDevicePush({ rememberFor: "uid-a" });
    expect(calls.some((c) => c.method === "DELETE")).toBe(true);
    expect(store.get("swiftcard_push_resume_uid")).toBe("uid-a");

    calls.length = 0;
    expect(await resumePushForSameAccount("uid-a")).toBe(true);
    const sub = calls.find((c) => c.url === "/api/push/subscribe" && c.method === "POST");
    expect(sub?.body).toMatchObject({ endpoint: "https://push.example/abc", p256dh: "p", auth: "a" });
    // Used once.
    expect(store.has("swiftcard_push_resume_uid")).toBe(false);
  });

  it("someone else signing in gets nothing, and the memory is gone", async () => {
    const { unbindDevicePush, resumePushForSameAccount } = await import("@/lib/push-device");
    await unbindDevicePush({ rememberFor: "uid-a" });
    calls.length = 0;
    expect(await resumePushForSameAccount("uid-b")).toBe(false);
    expect(calls).toEqual([]);
    expect(store.has("swiftcard_push_resume_uid")).toBe(false);
    expect(await resumePushForSameAccount("uid-a")).toBe(false);
  });

  it("never asks: with notifications no longer allowed, nothing happens", async () => {
    const { unbindDevicePush, resumePushForSameAccount } = await import("@/lib/push-device");
    await unbindDevicePush({ rememberFor: "uid-a" });
    vi.stubGlobal("Notification", { permission: "default" });
    calls.length = 0;
    expect(await resumePushForSameAccount("uid-a")).toBe(false);
    expect(calls).toEqual([]);
  });

  it("a sign-out on a device without push remembers nothing", async () => {
    const { unbindDevicePush } = await import("@/lib/push-device");
    vi.stubGlobal("navigator", { userAgent: "x", serviceWorker: { ready: Promise.resolve({ pushManager: { getSubscription: async () => null } }) } });
    await unbindDevicePush({ rememberFor: "uid-a" });
    expect(store.has("swiftcard_push_resume_uid")).toBe(false);
  });

  it("only a plain Sign out remembers; switching account, Devices and deleting don't", () => {
    expect(read("src/components/SignOutButton.tsx")).toContain("releaseDevice({ rememberPush: true })");
    for (const f of ["src/components/DeviceManager.tsx", "src/components/JoinSwitchAccount.tsx", "src/components/LeaveDeletedAccount.tsx", "src/components/ManageAccount.tsx"]) {
      expect(read(f), f).not.toContain("rememberPush");
    }
  });

  it("the account guard keeps the binding when it is this person's, and reconnects after severing", () => {
    const guard = read("src/components/AccountIsolationGuard.tsx");
    expect(guard).toMatch(/if \(sessionUid && pushBindingOwner\(\) === sessionUid\) return;\s*await unbindDevicePush\(\);\s*if \(sessionUid\) await resumePushForSameAccount\(sessionUid\);/);
  });
});
