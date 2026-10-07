import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cardEventNotice } from "@/lib/card-event-notify";
import { stripLocationMarks, withoutLocation } from "@/lib/location-privacy";

// ─────────────────────────────────────────────────────────────────────────────
// THE EVENT ROW AND THE NOTIFICATION MUST BE THE SAME FACT.
//
// /api/card-events writes the row the owner's push, bell and contact timeline
// all read. Audit scenarios pinned here: exactly one notification per genuine
// view including repeats (dedup at the DATABASE, not per-instance memory);
// notifications carry the right card and location; forged event types and
// unbounded payloads are refused; a dead/deactivated card generates nothing.
// ─────────────────────────────────────────────────────────────────────────────

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8");
const route = read("src/app/api/card-events/route.ts");

describe("input hardening", () => {
  it("only the two real event types are accepted", () => {
    expect(route).toMatch(/EVENT_TYPES = new Set\(\["viewed_card", "downloaded_vcard", "clicked_link"\]\)/);
    expect(route).toMatch(/!EVENT_TYPES\.has\(event_type\)/);
  });

  it("every stored field is type-checked and length-capped", () => {
    // The str() helper is the single funnel: non-strings and oversized values
    // degrade to absent instead of becoming permanent row values.
    expect(route).toMatch(/function str\(v: unknown, max: number\)/);
    for (const field of ["card_owner_username", "event_type", "source", "visitor_name", "visitor_email", "visitor_phone", "device_info"]) {
      expect(route).toMatch(new RegExp(`const ${field} = (\\(?)str\\(body\\?\\.${field}`));
    }
    // visitor_id goes through str() like the rest AND then through the
    // server-side identity resolution — the body's value is never what a row
    // is keyed on (lib/visit-identity.ts, tests/view-identity.test.ts).
    expect(route).toMatch(/const client_visitor_id = str\(body\?\.visitor_id, 64\)/);
    expect(route).toMatch(/const visitor_id = visitIdentity\.visitorId/);
  });

  it("referrer URLs are stored without query strings — they carry other sites' tokens", () => {
    expect(route).toMatch(/referrer_url, 300\) \?\? ""\)\.split\(\/\[\?#\]\//);
  });

  it("refuses events for cards that don't serve — same rule /api/views has always had", () => {
    expect(route).toMatch(/isCardActive\(card_owner_username\)/);
  });
});

describe("one visit → one event → one notification", () => {
  it("dedups against the DATABASE, not an in-memory throttle", () => {
    // Serverless instances don't share memory — the old isRateLimited-based
    // view-notify throttle duplicated pushes whenever repeat requests landed
    // on different instances (and Upstash was never provisioned in prod).
    expect(route).toMatch(/from\("card_events"\)[\s\S]{0,200}\.eq\("visitor_id", visitor_id\)[\s\S]{0,200}\.gte\("created_at", windowStart\)/);
    expect(route).not.toMatch(/view-notify:/);
  });

  it("a no-visitor-id caller is capped to one event per IP per window", () => {
    // The target is in the key so a visitor with no browser id can still tap
    // more than one link in half an hour.
    expect(route).toMatch(/events-anon:\$\{ip\}:\$\{card_owner_username\}:\$\{event_type\}:\$\{target \?\? ""\}:\$\{target_label \?\? ""\}`, 1, VIEW_VISIT_WINDOW_MS/);
  });

  it("a failed insert means NO notification — the row and the push must never disagree", () => {
    const failBranch = route.slice(route.indexOf("if (insertErr) {"), route.indexOf("// Fire in-app notification"));
    // Still returns before the notification block; the response body the caller
    // sees is unchanged (`{ ok: true }`). The only addition is that the failure
    // now leaves a trace in analytics_ingest_log instead of vanishing.
    expect(failBranch).toMatch(/return decided\("error", \{\}, geoFields\)/);
    expect(failBranch).not.toMatch(/notifyVisit/);
  });

  it("a unique-index loser is a dedup, not an error", () => {
    expect(route).toMatch(/insertErr\.code === "23505"/);
  });

  it("rotating visitor ids can't ring the owner's phone all day — per-IP notify cap, events still record", () => {
    expect(route).toMatch(/notify-ip:\$\{card_owner_username\}:\$\{ip\}`, 6, 60 \* 60 \* 1000/);
  });

  it("created_at is set explicitly — the dedup window and conversation sort filter on it", () => {
    expect(route).toMatch(/created_at: new Date\(replayAt \?\? Date\.now\(\)\)\.toISOString\(\)/);
  });
});

describe("the notification carries the right context", () => {
  it("stores this request's own location on the event (with a column-missing fallback)", () => {
    expect(route).toMatch(/resolveGeo\(req, ip\)/);
    expect(route).toMatch(/withoutLocation/);
    // location, surface and geo_* all arrived in different migrations, so the
    // insert has to degrade one step at a time rather than losing the event.
    expect(route).toMatch(/withoutNew/);
  });

  it("reuses the view's own geo answer, so the two rows can't disagree", () => {
    // card_views and card_events used to resolve the location independently and
    // rely on a per-IP cache to agree. The event now takes the exact object
    // recordView used; only a vCard save (which records no view) resolves its own.
    expect(route).toMatch(/const liveGeo = viewGeo \?\? \(await resolveGeo\(req, ip\)\)/);
  });

  it("records WHICH PAGE the event happened on", () => {
    // Without a surface, card_events could not tell a Swift Links view from a
    // card view: the visit-bucket unique index rejected the second surface of
    // one visit as a duplicate, so the event was lost and the timeline
    // mislabelled the one that survived. Measured in production 2026-09-09:
    // 11 visits since 2026-08-14 had two card_views rows and one card_events row.
    expect(route).toMatch(/^\s+surface,$/m);
    // ...and the app-level dedup has to ask the surface-aware question too, or
    // it would still swallow the second surface before the index ever sees it.
    expect(route).toMatch(/byTarget\.or\("surface\.is\.null,surface\.eq\.card"\)/);
    expect(route).toMatch(/byTarget\.eq\("surface", surface\)/);
  });

  it("deep-links to THE CARD that was viewed, not a bare /dashboard", () => {
    expect(route).toMatch(/\/dashboard\?card=\$\{encodeURIComponent\(card_owner_username\)\}/);
  });
});

describe("cardEventNotice — surface + location copy", () => {
  // The sentence is unchanged; since 2026-09-11 it carries two INVISIBLE marks
  // around the location so a Free account's copy can have the place blocked out
  // (lib/location-privacy.ts). Every assertion on wording strips them, which is
  // exactly what every plain-text consumer does.
  const body = (input: Parameters<typeof cardEventNotice>[0]) =>
    stripLocationMarks(cardEventNotice(input)!.body);

  it("names the location when the event has one, honestly coarse", () => {
    expect(body({ eventType: "viewed_card", visitorName: "Mina R", nameConfirmed: true, location: "Austin, US" }))
      .toBe("Mina R viewed your card near Austin, US.");
  });

  // WHO, at the confidence actually held (owner report, 2026-09-18). A signed-in
  // viewer is proof. A name remembered from that visitor's own earlier share
  // lives in a DEVICE-global store, so on a shared iPad, a kiosk or a demo phone
  // the next person's view arrives under the last person's name — an
  // identification the product cannot stand behind, and it used to state it
  // flatly either way.
  it("states a name only when a session proves it, and hedges when it is a memory", () => {
    expect(body({ eventType: "viewed_card", visitorName: "Mina R", nameConfirmed: true }))
      .toBe("Mina R viewed your card.");
    expect(body({ eventType: "viewed_card", visitorName: "Mina R" }))
      .toBe("Looks like Mina R viewed your card.");
    expect(body({ eventType: "viewed_card", visitorName: "Mina R", nameConfirmed: false }))
      .toBe("Looks like Mina R viewed your card.");
    // No name at all is still the plain, honest sentence.
    expect(body({ eventType: "viewed_card" })).toBe("Someone viewed your card.");
    // The same rule on a download, which is the other notice this builds.
    expect(body({ eventType: "downloaded_vcard", visitorName: "Mina R" }))
      .toBe("Looks like Mina R downloaded your contact card.");
  });

  it("marks that location so a Free account never reads it", () => {
    const raw = cardEventNotice({ eventType: "viewed_card", visitorName: "Mina R", nameConfirmed: true, location: "Austin, US" })!.body;
    expect(raw).not.toBe(stripLocationMarks(raw));
    expect(withoutLocation(raw)).toBe("Mina R viewed your card.");
  });

  it("omits it entirely when unknown — never a placeholder", () => {
    expect(body({ eventType: "viewed_card", visitorName: "Mina R", nameConfirmed: true, location: null }))
      .toBe("Mina R viewed your card.");
    expect(body({ eventType: "viewed_card", location: "  " }))
      .toBe("Someone viewed your card.");
  });

  it("the explicit surface field decides the wording; legacy source=swift_links still works", () => {
    expect(body({ eventType: "viewed_card", surface: "links", source: "qr_code" }))
      .toBe("Someone viewed your Swift Links.");
    expect(body({ eventType: "viewed_card", source: "swift_links" }))
      .toBe("Someone viewed your Swift Links.");
  });

  it("a save keeps its source label and gains the location", () => {
    // "saved your contact card" was a claim we cannot make — the save happens in
    // the OS "Add to Contacts" sheet and no API reports the outcome back. The
    // download is the part SwiftCard performed, so that is what it says.
    expect(body({ eventType: "downloaded_vcard", visitorName: "Mina R", nameConfirmed: true, source: "qr_code", location: "Austin, US" }))
      .toMatch(/^Mina R downloaded your contact card from .+ near Austin, US\.$/);
    // The TYPE is unchanged: it is the VISIT_RANK key, the push category and the
    // CRM event name, and renaming it would break five consumers for nothing.
    expect(cardEventNotice({ eventType: "downloaded_vcard" })!.type).toBe("contact_saved");
  });
});
