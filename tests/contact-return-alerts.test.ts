import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  decidePush,
  DEFAULT_PUSH_PREFS,
  LIVE_CATEGORIES,
  PUSH_CATEGORY_COPY,
  type PushPrefs,
} from "@/lib/push-policy";
import {
  contactReturnNotice,
  isLockedContact,
  isReturnVisit,
  metContext,
  ordinal,
} from "@/lib/contact-return-notify";
import { genericNames, markName, redactNames, stripNameMarks } from "@/lib/contact-privacy";
import { redactForPlan } from "@/lib/notification-privacy";
import { VISIT_RANK } from "@/lib/visit-notify";
import type { KnownContact } from "@/lib/known-contact";

// Warm-lead plan PR B1: "Priya re-opened your card".

const prefs = (over: Partial<PushPrefs> = {}): PushPrefs => ({ ...DEFAULT_PUSH_PREFS, quietHours: false, ...over });
const NOON_UTC = Date.UTC(2026, 8, 18, 12);

const priya = (over: Partial<KnownContact> = {}): KnownContact => ({
  kind: "known",
  leadId: "lead-priya",
  name: "Priya Shah",
  cardOwner: "dana-lee",
  confidence: "form",
  capturedAt: "2026-09-10T15:00:00Z",
  status: null,
  tags: [],
  whereMet: "RE/MAX Summit",
  ...over,
});

describe("the push policy for a returning contact (decision D4)", () => {
  const base = { category: "contact_return" as const, prefs: prefs(), cappedSentToday: 0, now: NOON_UTC };

  it("alerts the first time a contact comes back today", () => {
    expect(decidePush(base)).toEqual({ send: true, mode: "alert" });
  });

  it("at most once per contact per day", () => {
    expect(decidePush({ ...base, sameContactSentToday: 1 })).toEqual({ send: false, reason: "contact_cap" });
  });

  it("at most five a day across all contacts", () => {
    expect(decidePush({ ...base, contactReturnSentToday: 5 })).toEqual({ send: false, reason: "daily_cap" });
    expect(decidePush({ ...base, contactReturnSentToday: 4 })).toMatchObject({ send: true });
  });

  it("is not crowded out by five card views earlier in the day", () => {
    expect(decidePush({ ...base, cappedSentToday: 5 })).toMatchObject({ send: true });
  });

  it("is never folded into the silent hourly view count", () => {
    expect(decidePush({ ...base, lastViewPushAt: NOON_UTC - 60_000 })).toEqual({ send: true, mode: "alert" });
  });

  it("still respects its switch and quiet hours", () => {
    expect(decidePush({ ...base, prefs: prefs({ contact_return: false }) })).toEqual({ send: false, reason: "category_off" });
    const night = Date.UTC(2026, 8, 18, 3);
    expect(decidePush({ ...base, prefs: prefs({ quietHours: true, timezone: "UTC" }), now: night })).toEqual({ send: false, reason: "quiet_hours" });
  });

  it("is a switch in Settings, on by default", () => {
    expect(LIVE_CATEGORIES).toContain("contact_return");
    expect(DEFAULT_PUSH_PREFS.contact_return).toBe(true);
    expect(PUSH_CATEGORY_COPY.contact_return.label).toBe("Returning contacts");
  });
});

describe("what counts as coming back", () => {
  it("not the visit they were captured in — that was 'New contact'", () => {
    const now = Date.parse("2026-09-10T15:20:00Z");
    expect(isReturnVisit(priya(), now)).toBe(false);
    expect(isReturnVisit(priya(), now + 15 * 60_000)).toBe(true);
  });

  it("never names a Free lead locked behind the monthly cap", () => {
    expect(isLockedContact(priya({ tags: ["sc-locked"] }))).toBe(true);
    expect(isLockedContact(priya())).toBe(false);
  });
});

describe("the words", () => {
  it("names them, says where they met, and how often they've been back (Pro)", () => {
    const n = contactReturnNotice({ contact: priya(), eventType: "viewed_card", surface: "card", visitsThisWeek: 3, paid: true })!;
    expect(n.type).toBe("contact_returned");
    expect(stripNameMarks(n.title)).toBe("Priya re-opened your card");
    expect(stripNameMarks(n.body)).toBe("Priya Shah (met at RE/MAX Summit) re-opened your card — 3rd visit this week.");
    expect(n.pushBody).toBe("Met at RE/MAX Summit · 3rd visit this week");
    expect(n.pushCategory).toBe("contact_return");
  });

  it("falls back to the day they met when the owner didn't say where", () => {
    expect(metContext({ whereMet: null, capturedAt: "2026-09-10T15:00:00Z" })).toBe("met Sep 10");
    const n = contactReturnNotice({ contact: priya({ whereMet: null }), eventType: "viewed_card", surface: "links", visitsThisWeek: 1, paid: true })!;
    expect(stripNameMarks(n.title)).toBe("Priya re-opened your Swift Links");
    expect(n.pushBody).toBe("Met Sep 10");
  });

  it("on a Free lock screen: the fact and a reason to open the app, never a price", () => {
    const n = contactReturnNotice({ contact: priya(), eventType: "viewed_card", surface: "card", visitsThisWeek: 2, paid: false })!;
    expect(n.pushBody).toBe("Open SwiftCard to see who");
    expect(genericNames(n.title)).toBe("A contact re-opened your card");
    expect(`${n.title} ${n.body} ${n.pushBody}`).not.toMatch(/pro|upgrade|\$|price|plan/i);
  });

  it("a link tap upgrades the visit in silence", () => {
    const n = contactReturnNotice({ contact: priya(), eventType: "clicked_link", surface: "links", linkName: "Book a call", visitsThisWeek: 1, paid: true })!;
    expect(n.type).toBe("contact_engaged");
    expect(stripNameMarks(n.title)).toBe("Priya tapped your Book a call link");
    expect(n.pushCategory).toBeUndefined();
  });

  it("a forwarded link is the link, never the person, and never a push (D3)", () => {
    const n = contactReturnNotice({ contact: priya({ confidence: "forwarded" }), eventType: "viewed_card", surface: "card", visitsThisWeek: 1, paid: true })!;
    expect(n.title).toBe("Your link was opened on another device");
    expect(stripNameMarks(n.body)).toBe("Your link to Priya Shah was opened on another device.");
    expect(n.pushCategory).toBeUndefined();
  });

  it("closed contacts reach the bell but not the lock screen (D5)", () => {
    for (const c of [priya({ status: "not_interested" }), priya({ status: "dissolved" })]) {
      const n = contactReturnNotice({ contact: c, eventType: "viewed_card", surface: "card", visitsThisWeek: 1, paid: true })!;
      expect(n.pushCategory).toBeUndefined();
    }
  });

  it("counts visits like a person would", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101].map(ordinal)).toEqual(
      ["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "23rd", "101st"],
    );
  });
});

describe("a contact's name is Pro, decided on read", () => {
  const row = { type: "contact_returned", title: `${markName("Priya")} re-opened your card`, body: `${markName("Priya Shah")} re-opened your card.` };

  it("Free never receives the name — blocks the app blurs", () => {
    const [free] = redactForPlan([row], false);
    expect(free.title).not.toContain("Priya");
    expect(free.body).not.toContain("Priya");
    expect(free.title).toMatch(/█{3,}/);
  });

  it("Pro gets the name, unmarked", () => {
    const [pro] = redactForPlan([row], true);
    expect(pro.title).toBe("Priya re-opened your card");
    expect(pro.body).toBe("Priya Shah re-opened your card.");
  });

  it("Free does not receive the contact's id either — tapping must not open them", () => {
    const withId = { ...row, lead_id: "11111111-1111-1111-1111-111111111111" };
    const [free] = redactForPlan([withId], false);
    expect(free).not.toHaveProperty("lead_id");
    const [pro] = redactForPlan([withId], true);
    expect(pro.lead_id).toBe(withId.lead_id);
  });

  it("where they met stays readable on Free — only the name is withheld", () => {
    const met = { ...row, body: `${markName("Priya Shah")} (met at RE/MAX Summit) re-opened your card.` };
    const [free] = redactForPlan([met], false);
    expect(free.body).toContain("(met at RE/MAX Summit)");
    expect(free.body).not.toContain("Priya");
  });

  // Lands on that card's dashboard, where the row waits in the bell with the
  // name still blurred (the dashboard's own notifications list, which the URL
  // used to name, went with Quick Contacts on 2026-09-29).
  it("a Free push for a returning contact opens the card's dashboard, not the contact", () => {
    const src = readFileSync(join(process.cwd(), "src/app/api/card-events/route.ts"), "utf8");
    expect(src).toMatch(/url: returning && isPaidProfile\(owner\)/);
    expect(src).toMatch(/: `\$\{APP_URL\}\/dashboard\?card=\$\{encodeURIComponent\(card_owner_username\)\}`,/);
    expect(src).not.toMatch(/view=notifications/);
    expect(readFileSync(join(process.cwd(), "src/app/api/push/catchup/route.ts"), "utf8")).not.toMatch(/view=notifications/);
  });

  it("the lock screen reads naturally without the name", () => {
    expect(genericNames(`Your link to ${markName("Priya")} was opened.`)).toBe("Your link to a contact was opened.");
    expect(redactNames(markName("Al"))).not.toContain("Al");
  });
});

describe("one visit, one row", () => {
  it("a returning contact ranks above a plain view and below a milestone", () => {
    expect(VISIT_RANK.card_viewed).toBeLessThan(VISIT_RANK.contact_returned);
    expect(VISIT_RANK.contact_returned).toBeLessThan(VISIT_RANK.contact_engaged);
    expect(VISIT_RANK.contact_engaged).toBeLessThan(VISIT_RANK.milestone);
    expect(VISIT_RANK.milestone).toBeLessThan(VISIT_RANK.contact_saved);
  });
});

describe("wired the way the rules assume", () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
  const events = read("src/app/api/card-events/route.ts");
  const push = read("src/lib/push.ts");
  const catchup = read("src/app/api/push/catchup/route.ts");

  it("only a returning, unlocked, known contact is named — and upgrading unlocks it", () => {
    expect(events).toMatch(/contact\.kind === "known" && isReturnVisit\(contact\) && \(!isLockedContact\(contact\) \|\| isPaidProfile\(owner\)\) \? contact : null/);
  });

  it("a returning contact's push opens their contact — under the card they were captured on", () => {
    // Isolation audit 2026-09-24: opened under the VISITED card, a contact
    // captured on another of the owner's cards was missing from that list.
    expect(events).toMatch(/\/contacts\?card=\$\{encodeURIComponent\(returning\.cardOwner \|\| card_owner_username\)\}&lead=\$\{returning\.leadId\}/);
  });

  it("the per-contact cap is counted from push_log.lead_id", () => {
    expect(push).toMatch(/\.eq\("lead_id", payload\.leadId\)/);
    expect(push).toMatch(/!OWN_CAP\.includes\(cat\)/);
  });

  it("a returning contact held by quiet hours is in the 8am catch-up", () => {
    expect(catchup).toMatch(/contact_returned: "contact_return"/);
  });
});
