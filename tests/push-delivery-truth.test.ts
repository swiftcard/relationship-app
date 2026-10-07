import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildApnsAlert, sendApnsDetailed, type ApnsEnv, type ApnsPostDetail } from "@/lib/apns";
import { decidePush, pushCardTag, cardTagLine, readPushPrefs, DAILY_CAP, MAX_CARD_TAG_CHARS } from "@/lib/push-policy";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");

// ── The 2026-09-18 notification audit ───────────────────────────────────────
//
// Owner: the iPhone's "Allow notifications" prompt had stopped appearing, the
// notifications that did come through were "really messed up", a double
// notification is a spam/legal problem, and a push never said WHICH card it was
// about.
//
// What production showed: ONE push subscription in the whole system. Every
// iPhone that had ever registered was gone — an account went from two phones to
// one to none, losing one per send, each send logged as "sent". A Twilio reply
// and a new lead had both been logged "no_subscription" for the owner that day.

describe("a phone is only unregistered when Apple really says it is gone", () => {
  const payload = { title: "New contact: Dana", body: "(415) 555-0188", url: "https://swiftcard.me/contacts", tag: "visit-abc" };
  const detail = (result: ApnsPostDetail["result"], status: number, reason: string): ApnsPostDetail => ({ result, status, reason });

  function poster(answers: Partial<Record<ApnsEnv, ApnsPostDetail>>) {
    const calls: ApnsEnv[] = [];
    const post = async (env: ApnsEnv) => { calls.push(env); return answers[env] ?? detail("error", 0, "unexpected"); };
    return { calls, post: post as unknown as Parameters<typeof sendApnsDetailed>[2] };
  }

  it("a sandbox token (any build installed from Xcode) is delivered, not deleted", async () => {
    // BadDeviceToken is what Apple says for a GOOD token sent to the wrong
    // host. Believing it is what emptied the subscriptions table.
    const { calls, post } = poster({
      production: detail("gone", 400, "BadDeviceToken"),
      sandbox: detail("sent", 200, ""),
    });
    const r = await sendApnsDetailed("apns:tok-sandbox-1", payload, post);
    expect(r.result).toBe("sent");
    expect(r.env).toBe("sandbox");
    expect(calls).toEqual(["production", "sandbox"]);
  });

  it("remembers which environment a token lives in, so the next send asks once", async () => {
    const first = poster({ production: detail("gone", 400, "BadDeviceToken"), sandbox: detail("sent", 200, "") });
    await sendApnsDetailed("apns:tok-remember", payload, first.post);
    const second = poster({ sandbox: detail("sent", 200, "") });
    await sendApnsDetailed("apns:tok-remember", payload, second.post);
    expect(second.calls).toEqual(["sandbox"]);
  });

  it("is gone only when BOTH environments disown the token", async () => {
    const { post } = poster({
      production: detail("gone", 400, "BadDeviceToken"),
      sandbox: detail("gone", 400, "BadDeviceToken"),
    });
    expect((await sendApnsDetailed("apns:tok-dead", payload, post)).result).toBe("gone");
  });

  it("an inconclusive second answer keeps the row — a timeout proves nothing about a token", async () => {
    const { post } = poster({
      production: detail("gone", 400, "BadDeviceToken"),
      sandbox: detail("error", 0, "timeout"),
    });
    const r = await sendApnsDetailed("apns:tok-unsure", payload, post);
    expect(r.result).toBe("error");
    expect(r.reason).toContain("BadDeviceToken@production");
  });

  it("Unregistered is unambiguous (the app was deleted): gone at once, no second request", async () => {
    const { calls, post } = poster({ production: detail("gone", 410, "Unregistered") });
    expect((await sendApnsDetailed("apns:tok-uninstalled", payload, post)).result).toBe("gone");
    expect(calls).toEqual(["production"]);
  });

  it("a config error is never a second-environment question, and never a deletion", async () => {
    const { calls, post } = poster({ production: detail("error", 400, "BadTopic") });
    expect((await sendApnsDetailed("apns:tok-badtopic", payload, post)).result).toBe("error");
    expect(calls).toEqual(["production"]);
  });
});

describe("the log tells the truth about delivery", () => {
  const src = read("src/lib/push.ts");

  it("counts a send as delivered only when it reached a device", () => {
    // It used to count every SETTLED promise, so the APNs rejection that
    // deleted the subscription was logged "sent".
    expect(src).toMatch(/r\.status === "fulfilled" && r\.value === true/);
    expect(src).toMatch(/if \(r\.result === "sent"\) return true;/);
    expect(src).not.toMatch(/r\.value !== "blocked-endpoint"/);
  });

  it("deletes a subscription only on a real 'gone'", () => {
    expect(src).toMatch(/if \(r\.result === "gone"\) \{[\s\S]{0,260}?\.delete\(\)\.eq\("endpoint", sub\.endpoint\)/);
  });

  it("records why a push was not delivered, where the monitors already look", () => {
    expect(src).toMatch(/reportServerError\("push\.delivery"/);
    // …but an uninstalled app or an expired browser subscription is ordinary
    // life, not a fault: those prune and return before a failure is recorded.
    expect(src).toMatch(/delete\(\)\.eq\("endpoint", sub\.endpoint\);\s*\n\s*return false;\s*\n\s*\}\s*\n\s*failures\.push\(`apns/);
  });
});

describe("a push says which card it is about", () => {
  const two = [
    { username: "alex-coastline", label: "Work", name: "Alex Morgan", company: "Coastline Realty" },
    { username: "alex-djs", label: "", name: "Alex Morgan", company: "Morgan DJs" },
  ];

  it("uses the card's nickname when it has one", () => {
    expect(pushCardTag(two, "alex-coastline")).toBe("Work");
    expect(cardTagLine("Work")).toBe("Card: Work");
  });

  it("with no nickname, uses what tells the cards APART — not the name they share", () => {
    expect(pushCardTag(two, "alex-djs")).toBe("Morgan DJs");
  });

  it("falls back to the link when nothing else is unique", () => {
    const same = [
      { username: "alex-a", name: "Alex Morgan", company: "Coastline" },
      { username: "alex-b", name: "Alex Morgan", company: "Coastline" },
    ];
    expect(pushCardTag(same, "alex-b")).toBe("alex-b");
  });

  it("an account with ONE card is never tagged — that would be noise on every push", () => {
    expect(pushCardTag([two[0]], "alex-coastline")).toBeNull();
  });

  it("a Swift Links view belongs to its card, and the slug matches case-insensitively", () => {
    expect(pushCardTag(two, "Alex-Coastline__links")).toBe("Work");
  });

  it("a card that is not theirs, or no card at all, is untagged", () => {
    expect(pushCardTag(two, "someone-else")).toBeNull();
    expect(pushCardTag(two, null)).toBeNull();
  });

  it("a long nickname is trimmed to fit beside 'Card: '", () => {
    const long = [{ username: "a", label: "Commercial Real Estate Advisory Northern California" }, { username: "b", label: "B" }];
    expect((pushCardTag(long, "a") as string).length).toBeLessThanOrEqual(MAX_CARD_TAG_CHARS);
  });

  it("iOS shows it as its own line; an untagged alert is byte-for-byte what it was", () => {
    const base = { title: "Contact downloaded", body: "Someone downloaded your contact card.", url: "https://swiftcard.me/dashboard?card=alex-coastline", tag: "visit-x" };
    const tagged = JSON.parse(buildApnsAlert({ ...base, subtitle: "Card: Work" }, "me.swiftcard.app").body);
    expect(tagged.aps.alert).toEqual({ title: base.title, subtitle: "Card: Work", body: base.body });
    const plain = JSON.parse(buildApnsAlert(base, "me.swiftcard.app").body);
    expect(plain.aps.alert).toEqual({ title: base.title, body: base.body });
  });

  it("is resolved in ONE place, so no producer can forget it", () => {
    const push = read("src/lib/push.ts");
    expect(push).toMatch(/pushCardTag\(\(cards \?\? \[\]\) as PushCardRow\[\], payload\.cardOwner\)/);
    // The card tag is the line; an Office team push's "Team · <office>" only
    // fills it when there is no card tag (lib/team-alerts).
    expect(push).toContain("const line = cardLine ?? (payload.context?.trim() || null);");
    expect(push).toMatch(/subtitle: line/);
    // A browser notification has no subtitle: the card leads the BODY, never
    // the title (the line the OS truncates first).
    expect(push).toMatch(/body: `\$\{line\}\\n\$\{payload\.body\}`/);
    // Every producer that knows the card passes it.
    expect(read("src/lib/visit-notify.ts")).toMatch(/cardOwner: opts\.cardOwner,/);
    expect(read("src/app/api/twilio/inbound/route.ts")).toMatch(/cardOwner: target\.card_owner,/);
  });

  it("the tap still lands inside that exact card", () => {
    expect(read("src/app/api/card-events/route.ts")).toMatch(/\/dashboard\?card=\$\{encodeURIComponent\(card_owner_username\)\}/);
    expect(read("src/app/api/leads/route.ts")).toMatch(/\/contacts\?card=\$\{encodeURIComponent\(card_owner\)\}&lead=/);
    expect(read("src/app/api/twilio/inbound/route.ts")).toMatch(/\/contacts\?card=\$\{encodeURIComponent\(target\.card_owner\)\}&lead=/);
  });
});

describe("one event, one notification", () => {
  it("a Twilio redelivery cannot buzz twice: inbound replies are idempotent on MessageSid", () => {
    const src = read("src/app/api/twilio/inbound/route.ts");
    expect(src).toMatch(/const messageSid = \(params\.MessageSid \|\| params\.SmsSid \|\| ""\)/);
    expect(src).toMatch(/\.eq\("provider_sid", messageSid\)[\s\S]{0,120}?if \(seen\?\.length\) return twiml\(\);/);
    expect(src).toMatch(/providerSid: messageSid/);
    // …and the push rides on the bell row actually being written.
    expect(src).toMatch(/if \(wrote\) await sendPushToUser\(/);
  });

  it("identical words inside ten minutes are a redelivery, not news", () => {
    const src = read("src/lib/notify.ts");
    expect(src).toMatch(/DUPLICATE_WINDOW_MS = 10 \* 60 \* 1000/);
    expect(src).toMatch(/\.eq\("title", row\.title\)\s*\n\s*\.eq\("body", row\.body\)/);
    expect(src).toMatch(/if \(twin\?\.length\) return false;/);
    // A contact texting "Yes" twice is two replies: the caller with its own
    // idempotency key opts out.
    expect(src).toMatch(/if \(!opts\.allowRepeat\) try/);
    expect(read("src/app/api/twilio/inbound/route.ts")).toMatch(/\{ allowRepeat: true \}/);
  });

  it("a Stripe retry does not re-send 'Payment failed', and the failure leaves a bell row", () => {
    const src = read("src/app/api/stripe/webhook/route.ts");
    expect(src).toMatch(/type: "payment_failed",/);
    expect(src).toMatch(/if \(!wrote\) return;\s*\n\s*await sendPushToUser\(profile\.id as string, \{\s*\n\s*category: "billing_problem"/);
    // The 8am catch-up is built from bell rows of exactly this type.
    expect(read("src/app/api/push/catchup/route.ts")).toMatch(/payment_failed/);
  });

  it("the morning catch-up is not eaten by yesterday's cap after spending its once-a-day mark", () => {
    const prefs = readPushPrefs({ _push: { quietHours: false } });
    const busy = { category: "contact_saved" as const, prefs, cappedSentToday: DAILY_CAP, now: Date.parse("2026-09-18T14:00:00Z") };
    expect(decidePush(busy)).toEqual({ send: false, reason: "daily_cap" });
    expect(decidePush({ ...busy, catchup: true })).toEqual({ send: true, mode: "alert" });
    // A switch the person turned off still wins, catch-up or not.
    const off = readPushPrefs({ _push: { quietHours: false, contact_saved: false } });
    expect(decidePush({ ...busy, prefs: off, catchup: true })).toEqual({ send: false, reason: "category_off" });
    expect(read("src/app/api/push/catchup/route.ts")).toMatch(/catchup: true,/);
  });
});

describe("turning notifications on", () => {
  const src = read("src/components/EnablePushButton.tsx");
  const webBranch = src.slice(src.indexOf("// PERMISSION FIRST"));

  it("asks the browser for permission BEFORE anything else is awaited in the tap", () => {
    // Safari and Firefox only show the prompt while the click's user activation
    // is live. Awaiting the service worker first spent it: no prompt, and then
    // the page claimed notifications were blocked.
    const ask = webBranch.indexOf("await Notification.requestPermission()");
    const sw = webBranch.indexOf('navigator.serviceWorker.register("/sw.js")');
    expect(ask).toBeGreaterThan(-1);
    expect(sw).toBeGreaterThan(ask);
  });

  it("a dismissed prompt is not 'blocked' — on the web or in the app", () => {
    expect(webBranch).toMatch(/if \(perm === "denied"\) \{ setDeviceState\("denied"\); return false; \}/);
    expect(src).toMatch(/if \(perm\.receive === "denied"\) \{ setDeviceState\("denied"\); return false; \}/);
    expect(src).toMatch(/if \(perm\.receive !== "granted"\) \{ setDeviceState\("idle"\); return false; \}/);
  });

  it("the web path checks the server answer and reports failures, like the native path", () => {
    expect(webBranch).toMatch(/if \(!res\.ok\) \{\s*\n\s*reportPushFailure\(`web subscribe returned/);
    expect(webBranch).toMatch(/reportPushFailure\(`web enable threw:/);
  });

  it("after a 'Don't Allow', iOS never asks again — the way back is one tap", () => {
    expect(read("src/lib/app-settings.ts")).toContain('window.location.href = "app-settings:"');
    expect(src).toContain("openAppNotificationSettings()");
    expect(src).toContain('"Open iPhone Settings"');
  });

  it("a switch that shows ON re-confirms this device with the server, once per session", () => {
    expect(src).toMatch(/function reconfirmSubscription\(/);
    // Native: only for the account that enabled push on this device.
    expect(src).toMatch(/if \(uid && owner === uid\) reconfirmSubscription\(/);
    expect(src).toMatch(/sessionStorage\.getItem\(RECONFIRM_KEY\) === body\.endpoint/);
  });

  it("the next native build shows a banner while the app is open", () => {
    expect(read("capacitor.config.ts")).toMatch(/PushNotifications: \{\s*\n\s*presentationOptions: \["badge", "alert", "sound"\],/);
  });
});

describe("a broken push setup is visible, not silent", () => {
  it("asks Apple about a fake token: BadDeviceToken back proves the credentials are good", async () => {
    const { checkApnsCredentials } = await import("@/lib/apns");
    const good = await checkApnsCredentials((async () => ({ result: "gone", status: 400, reason: "BadDeviceToken" })) as never);
    expect(good).toEqual({ configured: true, ok: true, reason: "BadDeviceToken" });
  });

  it("the health endpoint reports it and the 15-minute uptime guard alerts on it", () => {
    const health = read("src/app/api/health/route.ts");
    expect(health).toMatch(/apns: await checkApnsCredentials\(\)/);
    // Reported, never part of `ok`: a bad APNs key must not take the site down.
    expect(health).toMatch(/\{ ok: db, db, dbMs: Date\.now\(\) - t0, push \}/);
    const guard = read("scripts/health-check.mjs");
    expect(guard).toMatch(/push\.apns\?\.configured === true && push\.apns\?\.ok === true && push\.webPush === true/);
  });
});
