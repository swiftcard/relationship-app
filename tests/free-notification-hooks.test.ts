import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cardEventNotice } from "@/lib/card-event-notify";
import { teaseLocation, stripLocationMarks } from "@/lib/location-privacy";
import { NATIVE_BODY_REMAP, NATIVE_HIDDEN_TYPES } from "@/lib/native-notification-copy";
import { sourcePhrase } from "@/lib/source-labels";
import { locationPhrase } from "@/lib/location-display";
import { redactPlaces, redactLegacyPlace, redactPlaceLabel } from "@/lib/location-privacy";
import { redactNames, markName } from "@/lib/contact-privacy";

// ── Notifications people want to open (owner, 2026-09-22) ────────────────────
//
// "If a free user, how are their push notifications going to look on their
// phone? We have to make it attractive to get them to want to upgrade. Maybe
// … it'll have the state blurred on the phone."
//
// The rules that make that safe: the push shows WHAT is being held back and
// never says Pro, upgrade or price (App Review 4.5.4 and, in the app, 3.1.1);
// the way to the blurred part lives on the website only.

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("someone who keeps coming back", () => {
  it("is named as a repeat visit, every plan", () => {
    const n = cardEventNotice({ eventType: "viewed_card", repeatVisits: 3, location: "Austin, TX", geoAccuracy: "city" })!;
    expect(n.title).toBe("3rd visit this week 👀");
    // The body keeps the where, so the Free lock screen still shows the gap.
    expect(teaseLocation(n.body)).toBe("Someone viewed your card in ▒▒▒▒▒, ▒▒.");
    expect(stripLocationMarks(n.body)).toBe("Someone viewed your card near Austin, TX.");
  });

  it("a first or second-ever look reads as before", () => {
    expect(cardEventNotice({ eventType: "viewed_card", repeatVisits: 1 })!.title).toBe("Card viewed");
    expect(cardEventNotice({ eventType: "viewed_card", surface: "links" })!.title).toBe("Swift Links viewed");
    // The card's first view ever outranks a repeat headline.
    expect(cardEventNotice({ eventType: "viewed_card", firstEver: true, repeatVisits: 4 })!.title).toBe("Your card's first view!");
  });

  it("fits the 40-character lock-screen title at any count", () => {
    for (const n of [2, 3, 11, 22, 99, 1234]) {
      expect(cardEventNotice({ eventType: "viewed_card", repeatVisits: n })!.title.length).toBeLessThanOrEqual(40);
    }
  });

  it("the ingest route counts visits by this browser, on this page, over 7 days", () => {
    const route = read("src/app/api/card-events/route.ts");
    expect(route).toMatch(/async function countRecentVisits/);
    expect(route).toMatch(/\.eq\("visitor_id", visitorId\)/);
    expect(route).toMatch(/\.eq\("surface", surface\)/);
    expect(route).toMatch(/Date\.now\(\) - REPEAT_VISIT_LOOKBACK_MS/);
    // Not for a known contact — "Priya is back" is the bigger news there.
    expect(route).toMatch(/repeatVisits: isView && !firstEver && !returning && visitor_id/);
  });
});

describe("the way to the blurred part", () => {
  it("is web-only, only on a redacted row, and names no plan or price", () => {
    const c = code("src/components/SeeWhoLink.tsx");
    expect(c).toMatch(/if \(isNative \|\| !text\.includes\("█"\)\) return null/);
    expect(c).not.toMatch(/\bPro\b|upgrade to|price|\$\d/i);
    expect(c).toContain("See who and where");
  });

  // The bell is the one notification list since the dashboard's went with
  // Quick Contacts (owner, 2026-09-29).
  it("sits under the notification list", () => {
    expect(read("src/components/NotificationBell.tsx")).toContain("<SeeWhoLink");
  });
});

describe("the app never shows selling or billing copy in a notification", () => {
  it("rewords every stored body that sells", () => {
    for (const body of Object.values(NATIVE_BODY_REMAP)) {
      expect(body).not.toMatch(/upgrade|price|subscribe|cancel|billing/i);
    }
    expect(NATIVE_BODY_REMAP.plan_downgraded).toBeDefined();
    expect(NATIVE_HIDDEN_TYPES.has("personal_sub_reminder")).toBe(true);
  });

  it("the bell applies the rules — it used to apply none", () => {
    const bell = read("src/components/NotificationBell.tsx");
    expect(bell).toMatch(/NATIVE_HIDDEN_TYPES\.has\(n\.type\)/);
    expect(bell).toMatch(/NATIVE_BODY_REMAP\[n\.type\]/);
    expect(bell).toMatch(/n\.type !== "referral_claim"/);
    expect(bell).toMatch(/useIsNativeApp\(\)/);
  });
});

// ── 2026-09-23 notification review ──────────────────────────────────────────

describe("notification sentences read like sentences", () => {
  it("a source is a phrase, not a column heading", () => {
    expect(sourcePhrase("qr_code")).toBe(" from a QR code");
    expect(sourcePhrase("nfc_card")).toBe(" from an NFC tap");
    expect(sourcePhrase("direct_link")).toBe("");
    expect(sourcePhrase(null)).toBe("");
    const n = cardEventNotice({ eventType: "downloaded_vcard", source: "qr_code" })!;
    expect(n.body).toBe("Someone downloaded your contact card from a QR code.");
    expect(n.body).not.toContain("QR code scan");
  });

  it("a region already called an area is not an 'area area'", () => {
    expect(locationPhrase("San Francisco Bay Area, US", "region")).toBe(" in the San Francisco Bay Area");
    expect(locationPhrase("New York, US", "region")).toBe(" in the New York area");
  });
});

describe("a hidden place or name gives nothing away — not even its length", () => {
  it("every place is the same width", () => {
    const a = redactPlaces(cardEventNotice({ eventType: "viewed_card", location: "Waco, TX", geoAccuracy: "city" })!.body);
    const b = redactPlaces(cardEventNotice({ eventType: "viewed_card", location: "San Francisco Bay Area, US", geoAccuracy: "region" })!.body);
    expect(a.match(/█+/)![0].length).toBe(b.match(/█+/)![0].length);
    expect(redactLegacyPlace("Someone viewed your card near Waco, TX.").match(/█+/)![0].length).toBe(8);
    expect(redactPlaceLabel("Zzyzx, California")!.match(/█+/)![0].length).toBe(8);
  });

  it("every hidden contact name is the same width", () => {
    expect(redactNames(`${markName("Al")} re-opened your card`).match(/█+/)![0].length)
      .toBe(redactNames(`${markName("Christopher")} re-opened your card`).match(/█+/)![0].length);
  });
});

describe("the last free contact of the month is announced, once, in the bell", () => {
  const route = code("src/app/api/leads/route.ts");

  it("fires exactly when this lead is the month's last free one", () => {
    expect(route).toMatch(/lastFreeLead = usedThisMonth \+ 1 === PLAN_LIMITS\.FREE_LEADS_PER_MONTH;/);
    expect(route).toMatch(/if \(lastFreeLead\) \{[\s\S]{0,200}insertNotification\(\{[\s\S]{0,120}type: "lead_cap_reached"/);
  });

  it("never reaches a phone — a bell row with no push category, and the morning catch-up does not replay it", () => {
    const block = route.slice(route.indexOf("if (lastFreeLead) {"), route.indexOf("if (lastFreeLead) {") + 900);
    expect(block).not.toMatch(/pushCategory|sendPushToUser|notifyVisit/);
    expect(code("src/app/api/push/catchup/route.ts")).not.toContain("lead_cap_reached");
  });

  it("says only what is true — held contacts open with Pro; the reset frees new ones", () => {
    expect(route).toContain("nothing is lost, and Pro opens every one of them. Your free contacts reset on the 1st.");
    expect(NATIVE_BODY_REMAP.lead_cap_reached).toBe("Anyone else who shares their info this month is still saved — nothing is lost. Your free contacts reset on the 1st.");
  });
});

// ── 2026-09-23 follow-ups ────────────────────────────────────────────────────

describe("the bell's card chip only appears when it tells cards apart", () => {
  it("a one-card account does not see its own card name on every row", () => {
    expect(code("src/components/NotificationBell.tsx")).toMatch(
      /n\.card_owner && \(!cardLabels \|\| Object\.keys\(cardLabels\)\.length > 1 \|\| !\(n\.card_owner in cardLabels\)\) && \(/,
    );
  });
});

describe("the Free contact meter never reads past its limit", () => {
  // The capped "N/5 this month · N waiting" meter lived in the Quick Contacts
  // header and went with it (owner, 2026-09-29). What is left is the amber
  // banner, which prints the raw count ONLY in its near-limit branch — at the
  // limit, or with contacts waiting, it names that instead — so it can never
  // read "13/5".
  it("stops at 5/5 and names the rest as waiting", () => {
    const dash = code("src/app/dashboard/page.tsx");
    expect(dash).not.toMatch(/this month\{lockedCount > 0/);
    expect(dash).toMatch(/\{lockedCount > 0\s*\? `\$\{lockedCount\} new lead\$\{lockedCount === 1 \? " is" : "s are"\} locked this month\.[^`]*`\s*: atLimit\s*\? `You've used your \$\{FREE_LIMIT\} free leads this month\.[^`]*`\s*: `\$\{monthlyLeadsUsed\}\/\$\{FREE_LIMIT\} free leads used this month`\}/);
    expect(dash).toMatch(/lockedCount > 0 \|\| atLimit \? \(/);
  });
});

describe("upgrading leaves no Free-only notification behind", () => {
  it("a paid account is never shown the 5-of-5 heads-up", async () => {
    const { redactForPlan, FREE_STATE_TYPES } = await import("@/lib/notification-privacy");
    expect(FREE_STATE_TYPES.has("lead_cap_reached")).toBe(true);
    const rows = [{ type: "lead_cap_reached", title: "That's 5 of 5 new contacts this month", body: "…" }];
    expect(redactForPlan(rows, true)).toHaveLength(0);
    expect(redactForPlan(rows, false)).toHaveLength(1);
  });
});
