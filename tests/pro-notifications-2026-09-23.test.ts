import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { redactForPlan, FREE_STATE_TYPES, unlockedLeadBody } from "@/lib/notification-privacy";
import { markPhrase, markPlace, stripLocationMarks, teaseLocation, TEASED_PLACE } from "@/lib/location-privacy";
import { markName, stripNameMarks, genericNames } from "@/lib/contact-privacy";
import { fitBodyKeepingPlace, MAX_BODY_CHARS, MAX_PLACE_BODY_CHARS } from "@/lib/push-policy";
import { cardEventNotice } from "@/lib/card-event-notify";

// Pro notifications review, 2026-09-23. Owner: "when it says Swift Links was
// viewed in New York, the New York should show and not be blurred … pro users
// never get notifications meant for free users."
const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const paidRender = (s: string) => stripNameMarks(stripLocationMarks(s));
const freeRender = (s: string) => teaseLocation(genericNames(s));

describe("the place reaches a Pro lock screen whole", () => {
  it("a long view/download sentence keeps its place instead of being cut before it", () => {
    const n = cardEventNotice({ eventType: "downloaded_vcard", source: "qr_code", location: "New York, US", geoAccuracy: "region" })!;
    const pro = fitBodyKeepingPlace(n.body, paidRender);
    expect(pro).toContain("New York");
    expect(pro.length).toBeLessThanOrEqual(MAX_PLACE_BODY_CHARS);
  });

  it("a very long name shortens the words BEFORE the place, never the place", () => {
    const body = `${markName("Christopher Fairweather-Blenkinsop of Northbeam Commercial Real Estate")} downloaded your contact card from a QR code${markPhrase(` in the ${markPlace("New York")} area`)}.`;
    const pro = fitBodyKeepingPlace(body, paidRender);
    expect(pro.endsWith("in the New York area.")).toBe(true);
    expect(pro.length).toBeLessThanOrEqual(MAX_PLACE_BODY_CHARS);
    expect(pro).toContain("…");
  });

  it("Swift Links viewed in New York: Pro reads the city, Free the shaded place", () => {
    const n = cardEventNotice({ eventType: "viewed_card", surface: "links", location: "New York, US", geoAccuracy: "region" })!;
    expect(fitBodyKeepingPlace(n.body, paidRender)).toBe("Someone viewed your Swift Links in the New York area.");
    expect(fitBodyKeepingPlace(n.body, freeRender)).toContain(TEASED_PLACE.trim());
    expect(fitBodyKeepingPlace(n.body, freeRender)).not.toContain("New York");
  });

  it("a body with no place keeps the plain 60-character rule", () => {
    const long = "Christopher Fairweather from Northbeam Commercial Real Estate Group shared their details";
    expect(fitBodyKeepingPlace(long, paidRender).length).toBeLessThanOrEqual(MAX_BODY_CHARS);
  });

  it("the one sender uses it", () => {
    expect(read("src/lib/push.ts")).toMatch(/body: fitBodyKeepingPlace\(payload\.body, plainBody\)/);
  });
});

describe("the bell never shows a Pro account a place blocked out", () => {
  it("a view row reads in full on Pro, marks gone", () => {
    const row = { type: "card_viewed", title: "Swift Links viewed", body: `Someone viewed your Swift Links${markPhrase(` in the ${markPlace("New York")} area`)}.` };
    const [pro] = redactForPlan([row], true);
    expect(pro.body).toBe("Someone viewed your Swift Links in the New York area.");
    const [free] = redactForPlan([row], false);
    expect(free.body).not.toContain("New York");
  });

  // The bell is the one list (the dashboard's went with Quick Contacts, 2026-09-29).
  it("the bell replaces rows whose words changed (an upgrade, a visit upgraded in place)", () => {
    for (const f of ["src/components/NotificationBell.tsx"]) {
      expect(read(f), f).toMatch(/\$\{n\.title\}:\$\{n\.body \?\? ""\}/);
    }
  });
});

describe("a paid account is never shown Free-plan copy", () => {
  const free = [
    { type: "pro_ended", title: "Your Pro plan has ended", body: "Subscribe to keep all your cards and your Pro design, or continue on Free. Nothing has been deleted." },
    { type: "plan_downgraded", title: "Your free month has ended", body: "… follow-up sequences are paused until you upgrade …" },
    { type: "sequence_paused", title: "Text follow-ups are paused", body: "Text follow-ups are part of Pro …" },
  ];

  it("plan-ended / paused-until-you-upgrade rows are not handed to a paid reader", () => {
    expect(redactForPlan(free, true)).toEqual([]);
    for (const r of free) expect(FREE_STATE_TYPES.has(r.type)).toBe(true);
  });

  it("…and still are to a Free one (they are true there)", () => {
    expect(redactForPlan(free, false)).toHaveLength(3);
  });

  it("a contact locked on Free and unlocked by the upgrade stops saying 'open to unlock'", () => {
    const row = { type: "new_lead", title: `New contact: ${markName("Dana Whitfield")}`, body: `${markName("Dana Whitfield")} shared their info — open to unlock.` };
    const [pro] = redactForPlan([row], true);
    expect(pro.title).toBe("New contact: Dana Whitfield");
    expect(pro.body).toBe("Dana Whitfield shared their info with you.");
    expect(unlockedLeadBody("Sam shared their info with you.")).toBe("Sam shared their info with you.");
  });

  it("the 8am catch-up applies the same rewrite and opens the contact on Pro", () => {
    const src = read("src/app/api/push/catchup/route.ts");
    expect(src).toMatch(/paid && top\.row\.type === "new_lead"\s*\?\s*unlockedLeadBody/);
    expect(src).toMatch(/lead=\$\{encodeURIComponent\(String\(top\.row\.lead_id\)\)\}/);
  });

  it("referral copy offers a paying account a month off the bill, not 'unlock Pro'", () => {
    const src = read("src/lib/referral-server.ts");
    expect(src).toMatch(/to earn a free month of Pro\./);
    expect(src).toMatch(/comes off your next bill/);
    expect(src).toMatch(/return \{ ok: true, monthsClaimed: after\.monthsClaimed, claimable: after\.claimable, kind \}/);
    // ReferAFriend (Settings and /grow) — the dashboard list's claim button
    // went with Quick Contacts (2026-09-29).
    for (const f of ["src/components/ReferAFriend.tsx"]) {
      expect(read(f), f).toMatch(/d\.kind === "credit"/);
    }
  });
});

describe("bell rows open what they are about", () => {
  it("a contact row in the bell opens Contacts — the contact itself when the row knows who", () => {
    const src = read("src/components/NotificationBell.tsx");
    expect(src).toMatch(/router\.push\(contactHref\(n\)\)/);
    expect(src).toMatch(/if \(n\.lead_id\) return `\/contacts\?/);
  });
});
