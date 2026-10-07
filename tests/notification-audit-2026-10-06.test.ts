import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cardEventNotice } from "@/lib/card-event-notify";
import { genericNames, redactNames, stripNameMarks } from "@/lib/contact-privacy";
import { teaseLocation, stripLocationMarks } from "@/lib/location-privacy";
import {
  decidePush, readPushPrefs, localHour, DEFAULT_TIMEZONE, SOFT_DAILY_CEILING, SOFT_CAP_CATEGORIES,
  LIVE_CATEGORIES, VIEW_BATCH_MS,
} from "@/lib/push-policy";
import {
  ACTIVATION_COPY, ACTIVATION_MIN_AGE_MS, ACTIVATION_MAX_AGE_MS, inActivationWindow, isActivationHour,
} from "@/lib/activation-nudge";
import { buildApnsAlert } from "@/lib/apns";
import { pushAskCopy } from "@/lib/push-ask";

// ── The 2026-10-06 notification audit ───────────────────────────────────────
//
// Owner: "make sure in-app notifications and push notifications … are working
// perfectly and precisely for all account types and plans … if some
// information needs to be blocked off, it's being blocked off correctly …
// not annoying but enough to give the user value."

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");

describe("a contact locked behind the Free cap is never named", () => {
  const view = (nameLocked: boolean) => cardEventNotice({
    eventType: "viewed_card", visitorName: "Priya Patel", location: "Austin, TX", geoAccuracy: "city", nameLocked,
  })!;

  it("Free lock screen: 'A contact', and the place shaded", () => {
    const body = teaseLocation(genericNames(view(true).body));
    expect(body).not.toContain("Priya");
    expect(body).not.toContain("Austin");
    expect(body.startsWith("A contact viewed your card")).toBe(true);
    expect(body).not.toMatch(/Looks like a contact/i);
  });

  it("Free bell: the name is blocked out on the server", () => {
    expect(redactNames(view(true).body)).not.toContain("Priya");
  });

  it("after an upgrade the same row names them", () => {
    expect(stripLocationMarks(stripNameMarks(view(true).body))).toContain("Priya Patel viewed your card");
  });

  it("a vCard download from a locked contact hides the name too", () => {
    const n = cardEventNotice({ eventType: "downloaded_vcard", visitorName: "Priya Patel", nameLocked: true })!;
    expect(genericNames(n.body)).not.toContain("Priya");
  });

  it("the events route marks it — only for a locked contact on a Free account", () => {
    const src = read("src/app/api/card-events/route.ts");
    expect(src).toMatch(/nameLocked: !!ownersOwnContact && isLockedContact\(ownersOwnContact\) && !isPaidProfile\(owner\)/);
  });

  it("an SMS reply from a locked contact on Free shows neither name nor words", () => {
    const src = read("src/app/api/twilio/inbound/route.ts");
    expect(src).toMatch(/const hidden = isLockedLead\(target\) && !isPaidPlan\(owner\.plan/);
    expect(src).toMatch(/hidden \? markName\(rawWho\) : rawWho/);
    expect(src).toMatch(/body: shownText,/);
  });

  it("the 8am catch-up never says more than the live Free push did", () => {
    const src = read("src/app/api/push/catchup/route.ts");
    expect(src).toMatch(/!paid && top\.category === "contact_return"\s*\n\s*\? "Open SwiftCard to see who"/);
  });
});

describe("one ceiling over the separate caps", () => {
  const base = { prefs: readPushPrefs({}), cappedSentToday: 0, now: Date.parse("2026-10-06T18:00:00Z") };

  it("past eight nice-to-know alerts in a day, the rest go to the bell only", () => {
    for (const category of SOFT_CAP_CATEGORIES) {
      expect(decidePush({ ...base, category, softSentToday: SOFT_DAILY_CEILING }), category)
        .toEqual({ send: false, reason: "daily_cap" });
    }
  });

  it("never holds back a lead, a reply, a billing problem or the Monday recap", () => {
    for (const category of ["new_lead", "lead_reply", "billing_problem", "weekly_recap"] as const) {
      expect(decidePush({ ...base, category, softSentToday: 50 }).send, category).toBe(true);
    }
  });

  it("a silent view-count update is not an interruption and is never counted", () => {
    const v = decidePush({ ...base, category: "card_view", softSentToday: 50, lastViewPushAt: base.now - VIEW_BATCH_MS / 2 });
    expect(v).toEqual({ send: true, mode: "update" });
  });

  it("the send path counts it from push_log", () => {
    expect(read("src/lib/push.ts")).toMatch(/if \(outcome === "sent" && SOFT_CAP_CATEGORIES\.includes\(cat\)\) softSentToday\+\+;/);
  });
});

describe("an unknown timezone is New York, not UTC", () => {
  it("quiet hours and the catch-up use the same fallback as the recap", () => {
    const now = Date.parse("2026-10-06T23:30:00Z"); // 7:30pm EDT
    expect(DEFAULT_TIMEZONE).toBe("America/New_York");
    expect(localHour(now, null)).toBe(localHour(now, "America/New_York"));
    const src = read("src/app/api/push/catchup/route.ts");
    expect(src).toContain("const tz = prefs.timezone || DEFAULT_TIMEZONE;");
    expect(src).not.toMatch(/if \(!prefs\.timezone\) continue;/);
  });
});

describe("the one getting-started push", () => {
  const now = Date.parse("2026-10-06T16:00:00Z"); // noon EDT
  const ago = (ms: number) => new Date(now - ms).toISOString();

  it("only from day 2 to day 7 — never to the existing base", () => {
    expect(inActivationWindow(ago(ACTIVATION_MIN_AGE_MS - 60_000), now)).toBe(false);
    expect(inActivationWindow(ago(ACTIVATION_MIN_AGE_MS + 60_000), now)).toBe(true);
    expect(inActivationWindow(ago(ACTIVATION_MAX_AGE_MS + 60_000), now)).toBe(false);
    expect(inActivationWindow(null, now)).toBe(false);
  });

  it("only in the working day, in their own zone", () => {
    expect(isActivationHour(now, "America/New_York")).toBe(true);
    expect(isActivationHour(Date.parse("2026-10-07T03:00:00Z"), "America/New_York")).toBe(false);
  });

  it("positive and actionable — never a number, never 'nobody'", () => {
    const text = `${ACTIVATION_COPY.title} ${ACTIVATION_COPY.body}`;
    expect(text).not.toMatch(/\d|nobody|no one|no views|haven't|yet/i);
  });

  it("once ever, marked before sending, zero views only, scheduled by the GitHub loop", () => {
    const src = read("src/app/api/push/activation/route.ts");
    expect(src.indexOf("outcome: ACTIVATION_MARK")).toBeLessThan(src.indexOf("await sendPushToUser("));
    expect(src).toMatch(/\.eq\("outcome", ACTIVATION_MARK\)\.limit\(1\)/);
    expect(src).toMatch(/\(count \?\? 0\) > 0\) continue;/);
    expect(read(".github/workflows/push-catchup.yml")).toContain("https://swiftcard.me/api/push/activation");
  });

  it("is not a settings switch nobody could ever see work", () => {
    expect(LIVE_CATEGORIES).not.toContain("getting_started");
  });

  it("is never held by the daily caps (it already fires once ever)", () => {
    expect(decidePush({ category: "getting_started", prefs: readPushPrefs({}), cappedSentToday: 99, softSentToday: 99, now }).send).toBe(true);
  });
});

describe("the iPhone app badge", () => {
  it("every APNs alert carries the unread count, clamped", () => {
    const one = JSON.parse(buildApnsAlert({ title: "t", body: "b", url: "/", badge: 3 }, "me.swiftcard.app").body);
    expect(one.aps.badge).toBe(3);
    const big = JSON.parse(buildApnsAlert({ title: "t", body: "b", url: "/", badge: 500 }, "me.swiftcard.app").body);
    expect(big.aps.badge).toBe(99);
    const none = JSON.parse(buildApnsAlert({ title: "t", body: "b", url: "/" }, "me.swiftcard.app").body);
    expect(none.aps).not.toHaveProperty("badge");
  });

  it("the bell sets it from its own unread count; sign-out clears it", () => {
    expect(read("src/components/NotificationBell.tsx")).toMatch(/if \(isNative\) setAppBadge\(unread\);/);
    expect(read("src/lib/device-sign-out.ts")).toContain("setAppBadge(0);");
  });

  it("the native plugin is registered (app-local plugins are never auto-discovered)", () => {
    expect(read("ios/App/App/MainViewController.swift")).toContain("bridge?.registerPluginInstance(AppBadgePlugin())");
    expect(read("ios/App/App.xcodeproj/project.pbxproj")).toContain("AppBadge.swift in Sources");
    expect(read("capacitor.config.ts")).toMatch(/presentationOptions: \["badge", "alert", "sound"\]/);
  });
});

describe("Android is not an iPhone", () => {
  it("the 'notifications off' reminder names Android's own path", () => {
    expect(pushAskCopy("phone", { denied: true, android: true }).sub).not.toMatch(/iPhone/);
    expect(pushAskCopy("phone", { denied: true }).sub).toMatch(/iPhone Settings/);
  });

  it("the settings button opens Android's notification screen through the app plugin", () => {
    const btn = read("src/components/EnablePushButton.tsx");
    expect(btn).toContain('{android ? "Open Settings" : "Open iPhone Settings"}');
    expect(read("android/app/src/main/java/me/swiftcard/app/MainActivity.java")).toContain("registerPlugin(AppSettingsPlugin.class);");
    expect(read("android/app/src/main/java/me/swiftcard/app/AppSettingsPlugin.java")).toContain("Settings.ACTION_APP_NOTIFICATION_SETTINGS");
  });

  it("the alert channel is made on every launch where push is allowed, not only on the enable tap", () => {
    const bridge = read("src/components/NativeAppBridge.tsx");
    expect(bridge).toMatch(/perm\.receive === "granted" && detectNativePlatform\(\) === "android"\) \{\s*\n\s*try \{\s*\n\s*await PushNotifications\.createChannel\(\{\s*\n\s*id: "swiftcard-alerts"/);
  });
});
