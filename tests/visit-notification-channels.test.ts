import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { visitDetailFields } from "@/lib/visit-device";

// ── Where the new visit details travel, channel by channel (owner, 2026-10-19)
// "Make sure everything was thought of… push, in-app, our integrations."
// No new notification TYPE was added: the view / contact-download notification
// gained the device (and work network) as words. Every surface those rows and
// events reach is pinned here, with the rule each one follows.

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("the bell (web, phone web, and the iPhone app's list)", () => {
  it("every reader goes through redactForPlan: Free never gets the device or network", () => {
    expect(read("src/app/api/notifications/route.ts")).toMatch(/redactForPlan\(/);
    expect(read("src/app/dashboard/page.tsx")).toContain("bellNotifications = redactForPlan(bellNotifications ?? [], isPro);");
    expect(read("src/lib/notification-privacy.ts")).toContain("const free = withoutDetail(body);");
  });
  it("the iPhone app swaps only billing copy — a view row reads the same as on the web", () => {
    const remap = read("src/lib/native-notification-copy.ts");
    expect(remap).not.toMatch(/card_viewed|contact_saved/);
  });
});

describe("pushes (Apple, Android, web) — live, and the 8am catch-up", () => {
  it("one sender: Free never, paid only when the whole sentence fits the lock screen", () => {
    const push = read("src/lib/push.ts");
    expect(push).toContain("payload = { ...payload, body: withDeviceIfItFits(payload.body, paid, plainBody) };");
  });
  it("the morning catch-up re-sends the STORED body through that same sender", () => {
    const catchup = read("src/app/api/push/catchup/route.ts");
    expect(catchup).toContain("await sendPushToUser(userId, {");
    expect(catchup).toContain(": String(top.row.body ?? \"\"),");
  });
  it("the browser's own banner shows what the sender prepared, nothing else", () => {
    expect(read("public/sw.js")).toContain("self.registration.showNotification(data.title ?? \"SwiftCard\", {");
  });
});

describe("integrations — Zapier is the one that receives views (Pro, re-checked at send)", () => {
  it("the details go as fields of their own on both events, not only inside a sentence", () => {
    const route = read("src/app/api/card-events/route.ts");
    expect(route).toContain("const crmDetail = visitDetailFields(device_info, { model: device_model, os: device_os }, referrer_url);");
    expect((route.match(/^\s+crmDetail,$/gm) ?? []).length).toBe(2); // both recordView calls
    expect(route).toMatch(/location: location \?\? undefined,\n(\s*\/\/[^\n]*\n)*\s*\.\.\.crmDetail,\n\s*\.\.\.\(geo\.workNetwork \? \{ network: geo\.workNetwork \} : \{\}\),/);
    const rv = read("src/lib/record-view.ts");
    expect(rv).toContain("...(opts.crmDetail ?? {}),");
    expect(rv).toContain("...(geo.workNetwork ? { network: geo.workNetwork } : {}),");
  });
  it("the plain-text body sent to it carries no invisible marks", () => {
    expect(read("src/app/api/card-events/route.ts")).toContain("body: stripNameMarks(stripLocationMarks(notice.body)),");
  });
  it("only paid accounts' Zaps are ever resolved", () => {
    expect(read("src/lib/crm-events.ts")).toContain("const target = await resolveZapierTarget(userId, (card?.id as string | undefined) ?? null);");
  });
  it("an offline replay names no network, in the view event as in the bell", () => {
    expect(read("src/lib/record-view.ts")).toContain("{ ...liveGeo, label: null, accuracy: null, source: null, workNetwork: null }");
  });
  it("the direct CRM connections take contacts, not views — nothing new reaches them", () => {
    for (const f of ["src/lib/crm-run.ts", "src/lib/crm-sync.ts"]) expect(read(f), f).not.toMatch(/view\.card|card_viewed/);
  });
});

describe("the fields themselves", () => {
  it("are only what the request said, and absent when unknown", () => {
    const ig = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_3_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/22D72 Instagram 451.0.0.37.60 (iPhone17,1; iOS 18_3_1; en_US; en; scale=3.00; 1206x2622; IABMV/1; 1088109557) Safari/604.1";
    expect(visitDetailFields(ig, {}, "https://lnkd.in/x")).toEqual({ device: "iPhone 16 Pro · iOS 18", opened_in: "Instagram", came_from: "LinkedIn" });
    expect(visitDetailFields(null, {}, null)).toEqual({});
    expect(visitDetailFields(ig, {}, "https://swiftcard.me/someone")).not.toHaveProperty("came_from");
  });
});
