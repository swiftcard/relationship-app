import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cardEventNotice } from "@/lib/card-event-notify";
import { locationPhrase } from "@/lib/location-display";
import {
  PLACE_MARK, PHRASE_MARK,
  redactPlaces, redactLegacyPlace, splitLocationParts, stripLocationMarks, withoutLocation, teaseLocation, redactPlaceLabel } from "@/lib/location-privacy";
import { redactForPlan } from "@/lib/notification-privacy";

// ── Locations are Pro, including the ones hiding inside a sentence ───────────
//
// Owner, 2026-09-11: "for the free account, we don't offer locations, so users
// who have the free account cannot see locations of SwiftCard views and
// SwiftLink views, but when they get notifications, it says 'Someone viewed
// your SwiftLinks in the New York area.' They should not be getting that
// location… it should just blur the location name. Don't say anything about pro
// or upgrading."
//
// The Locations tab was gated and the Free lead list carries no location
// column, so this one sentence was the whole leak — several times a day, for
// free. The place is now blocked out ON THE SERVER (a CSS blur over real text
// is readable in devtools) and the app blurs what is left.

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("the sentence marks where its location is", () => {
  it("wraps the fragment and the place name, invisibly", () => {
    const n = cardEventNotice({
      eventType: "viewed_card", surface: "links", visitorName: "Sam", nameConfirmed: true,
      location: "New York, US", geoAccuracy: "region",
    })!;
    expect(n.body).toContain(PLACE_MARK);
    expect(n.body).toContain(PHRASE_MARK);
    // Both marks are invisible separators — the sentence still reads normally.
    expect(stripLocationMarks(n.body)).toBe("Sam viewed your Swift Links in the New York area.");
  });

  it("leaves every other caller's plain sentence exactly as it was", () => {
    // The Locations tab, the contact panel and everything else call this
    // without the option and must be byte-identical to before.
    expect(locationPhrase("Great Neck, NY", "city_approx")).toBe(" near Great Neck, NY");
    expect(locationPhrase("New York, US", "region")).toBe(" in the New York area");
    expect(locationPhrase(null, "city")).toBe("");
  });

  it("says nothing at all when there is no location", () => {
    const n = cardEventNotice({ eventType: "viewed_card", visitorName: "Sam", nameConfirmed: true })!;
    expect(n.body).toBe("Sam viewed your card.");
    expect(n.body).not.toContain(PLACE_MARK);
  });
});

describe("what a Free account is actually sent", () => {
  const notice = cardEventNotice({
    eventType: "viewed_card", surface: "links", visitorName: "Sam", nameConfirmed: true,
    location: "Roslyn, NY", geoAccuracy: "city",
  })!;

  it("has the place replaced with blocks — there is nothing to read in devtools", () => {
    const [row] = redactForPlan([{ type: "card_viewed", body: notice.body }], false);
    expect(row.body).not.toContain("Roslyn");
    expect(row.body).toMatch(/█+/);
    // The sentence keeps its shape around the redaction — ONE shape, whatever
    // the precision: "near" (a city) vs "in the … area" (a region) told a Free
    // account how precise the hidden place was (2026-09-23 analytics audit).
    expect(stripLocationMarks(row.body!)).toMatch(/^Sam viewed your Swift Links in █+\.$/);
  });

  it("keeps the preposition readable, so only the place looks hidden", () => {
    const [row] = redactForPlan([{ type: "card_viewed", body: notice.body }], false);
    const parts = splitLocationParts(row.body!);
    expect(parts.filter((p) => !p.place).map((p) => p.text).join("")).toBe("Sam viewed your Swift Links in .");
    expect(parts.filter((p) => p.place)).toHaveLength(1);
  });

  it("says nothing about Pro, upgrading or price", () => {
    const [row] = redactForPlan([{ type: "card_viewed", body: notice.body }], false);
    expect(row.body).not.toMatch(/pro|upgrade|plan|unlock/i);
    // The renderer draws a smudge and nothing else — no badge, no link, no
    // pitch. (Comments stripped: the file quotes the instruction itself.)
    const code = read("src/components/NotificationBody.tsx")
      .replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
    expect(code).not.toMatch(/Upgrade|Pro\b|price|\/upgrade/i);
  });

  it("redacts rows written before the marks existed, by type", () => {
    const legacy = [
      { type: "card_viewed", body: "Someone viewed your Swift Links in the New York area." },
      { type: "contact_saved", body: "Someone downloaded your contact card near Great Neck, NY." },
      { type: "milestone_50", body: "Someone viewed your card near Austin, TX. That's 50 views on /dana." },
      // A lead body has no location in it and must not be touched, or the
      // company name would be eaten by a hunt for the word "in".
      { type: "new_lead", body: "Dana Whitfield shared their info with you from a QR code." },
    ];
    const out = redactForPlan(legacy, false);
    expect(out[0].body).not.toContain("New York");
    expect(out[1].body).not.toContain("Great Neck");
    expect(out[3].body).toBe(legacy[3].body);
  });

  it("never redacts a paid account, and strips the invisible marks for them", () => {
    const [row] = redactForPlan([{ type: "card_viewed", body: notice.body }], true);
    expect(row.body).toBe("Sam viewed your Swift Links near Roslyn, NY.");
    expect(row.body).not.toContain(PLACE_MARK);
  });
});

describe("the lock screen, where nothing can be blurred", () => {
  // Owner, 2026-09-22: the place stays in the sentence, shaded out — the Free
  // banner shows there IS a where, and never what it is.
  it("shades the place out in one fixed shape", () => {
    const n = cardEventNotice({
      eventType: "viewed_card", visitorName: "Sam", nameConfirmed: true, location: "Roslyn, NY", geoAccuracy: "city",
    })!;
    expect(teaseLocation(n.body)).toBe("Sam viewed your card in ▒▒▒▒▒, ▒▒.");
  });

  it("every shape the composer can produce looks identical — no length or precision leaks", () => {
    for (const [loc, acc] of [["Roslyn, NY", "city"], ["Great Neck, NY", "city_approx"], ["New York, US", "region"], ["US", "country"]] as const) {
      const n = cardEventNotice({ eventType: "viewed_card", visitorName: "Sam", nameConfirmed: true, location: loc, geoAccuracy: acc })!;
      const out = teaseLocation(n.body);
      expect(out, `${loc}/${acc}`).toBe("Sam viewed your card in ▒▒▒▒▒, ▒▒.");
      expect(out).not.toMatch(/Roslyn|Neck|New York|\bUS\b|\bNY\b/);
    }
  });

  it("a view with no location gets no invented one", () => {
    const n = cardEventNotice({ eventType: "viewed_card", visitorName: "Sam", nameConfirmed: true })!;
    expect(teaseLocation(n.body)).toBe("Sam viewed your card.");
  });

  it("withoutLocation still closes the sentence up where no place is wanted", () => {
    const n = cardEventNotice({ eventType: "viewed_card", visitorName: "Sam", nameConfirmed: true, location: "Roslyn, NY", geoAccuracy: "city" })!;
    expect(withoutLocation(n.body)).toBe("Sam viewed your card.");
  });

  it("is applied in the one place every push goes through", () => {
    const push = read("src/lib/push.ts");
    // Known-contact names ride the same path (lib/contact-privacy.ts): paid
    // strips the marks, Free turns the name into "a contact" before the
    // location is shaded out.
    expect(push).toMatch(/paid \? stripNameMarks\(stripLocationMarks\(s\)\) : teaseLocation\(genericNames\(s\)\)/);
    // Title as well as body — a producer could put a place in either.
    expect(push).toMatch(/plainBody\(payload\.title\)/);
    expect(push).toMatch(/fitBodyKeepingPlace\(payload\.body, plainBody\)/);
  });
});

describe("nothing else has to remember", () => {
  it("the CRM gets plain text, never the marks", () => {
    expect(read("src/app/api/card-events/route.ts")).toMatch(/body: stripNameMarks\(stripLocationMarks\(notice\.body\)\)/);
  });

  it("both endpoints that hand notifications to a browser redact by plan", () => {
    // The route resolves the plan into `paid` (alongside the office reader, in
    // one round trip) and redacts with it — same guarantee, one fetch fewer.
    // Both halves are pinned: drop either and this fails.
    const api = read("src/app/api/notifications/route.ts");
    expect(api).toMatch(/isPaidUser\(user\.id\)/);
    expect(api).toMatch(/redactForPlan\(data \?\? \[\], paid\)/);
    // The dashboard's bell (its per-card panel went with Quick Contacts, 2026-09-29).
    expect(read("src/app/dashboard/page.tsx")).toMatch(/redactForPlan\(bellNotifications \?\? \[\], isPro\)/);
  });

  it("an unknown plan is treated as Free, not as paid", () => {
    const src = read("src/lib/notification-privacy.ts");
    const fallback = src.slice(src.indexOf("} catch {"));
    expect(fallback).toMatch(/return false;/);
  });

  it("redacting is idempotent — a second pass cannot eat the blocks", () => {
    const once = redactPlaces(cardEventNotice({
      eventType: "viewed_card", visitorName: "Sam", nameConfirmed: true, location: "Roslyn, NY", geoAccuracy: "city",
    })!.body);
    expect(redactPlaces(once)).toBe(once);
    expect(redactLegacyPlace("Someone viewed your card near █████.")).toContain("█");
  });
});

// ── The contacts panel, added 2026-09-11 ────────────────────────────────────
//
// The notification bodies were fixed first, and the very next probe found the
// same place name printed in plain text on every contact a Free account opened
// — the lead's own `location` column, straight out of the database. Locations
// are a Pro feature wherever they appear, so the column is redacted on the
// server and blurred in the panel, exactly like a notification body.
describe("a lead's location is a Pro feature too", () => {
  const page = readFileSync("src/app/contacts/page.tsx", "utf8");
  const panel = readFileSync("src/components/ContactsClient.tsx", "utf8");

  it("replaces the place on the SERVER for a Free account, before it can be shipped", () => {
    expect(page).toMatch(/import \{ redactPlaceLabel \} from "@\/lib\/location-privacy"/);
    expect(page).toMatch(/location: redactPlaceLabel\(l\.location as string\), geo_accuracy: null/);
    // and only for Free — a paid account still gets the real rows untouched
    expect(page).toMatch(/const leads = paid\s*\n\s*\? rawLeads/);
  });

  it("blurs what is left instead of printing blocks", () => {
    expect(panel).toMatch(/hasMarkedPlace\(selected\.location\)/);
    expect(panel).toMatch(/<BlurredPlace text=\{splitLocationParts\(selected\.location\)/);
  });

  it("says nothing about Pro, upgrading or price", () => {
    const block = panel.slice(Math.max(0, panel.indexOf("hasMarkedPlace(selected.location)") - 600), panel.indexOf("hasMarkedPlace(selected.location)") + 600);
    expect(block).not.toMatch(/\bPro\b|upgrade|\$\d/i);
  });

  it("redactPlaceLabel keeps nothing readable and keeps the shape", () => {
    const out = redactPlaceLabel("Roslyn, New York")!;
    expect(out).not.toMatch(/Roslyn|New York/);
    expect(splitLocationParts(out).some((p) => p.place)).toBe(true);
    expect(redactPlaceLabel("")).toBeNull();
    expect(redactPlaceLabel(null)).toBeNull();
  });
});

// ── A milestone must never send a Free account to a padlock ─────────────────
//
// lib/milestones.ts states the rule itself: "Every action below is a feature
// the person already has on whatever plan they are on." The 50-view note broke
// it by pointing at Locations, which is Pro. These fire for everybody, so the
// copy is held to the plan with the least.
describe("milestone copy works on every plan", () => {
  const src = readFileSync("src/lib/milestones.ts", "utf8");
  const bodies = [...src.matchAll(/body: "([^"]+)"/g)].map((m) => m[1]);

  it("has milestones to check", () => {
    expect(bodies.length).toBeGreaterThan(5);
  });

  it("never sends anyone to a Pro-only surface", () => {
    for (const body of bodies) {
      expect(body, body).not.toMatch(/\bLocations\b/);
      expect(body, body).not.toMatch(/\bCSV\b|\bexport\b/i);
      expect(body, body).not.toMatch(/custom designer/i);
    }
  });

  it("still says nothing about price, plans or upgrading (App Review 3.1.1)", () => {
    for (const body of bodies) {
      expect(body, body).not.toMatch(/\bPro\b|upgrade|unlock|\$\d|free trial/i);
    }
  });
});
