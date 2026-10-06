import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { reconcileDetailed, type GeoGuess } from "@/lib/request-geo";
import { locationLabel, locationPhrase, groupAccuracy, LOCATION_UNAVAILABLE } from "@/lib/location-display";
import { cardEventNotice } from "@/lib/card-event-notify";
import { linkTarget } from "@/lib/track-link-click";

// ─────────────────────────────────────────────────────────────────────────────
// ANALYTICS MUST NOT CLAIM MORE THAN IT KNOWS.
//
// Three things were measured wrong in production on 2026-09-09 and are pinned
// here so they cannot come back:
//
//  1. LOCATION. 19 of the last 26 views were stored as "New York, US". That
//     string is what the pipeline writes when its two IP databases DISAGREE on
//     the town and fall back to the state they share — but it is shaped exactly
//     like a city label, so the Locations tab and the push both read as New York
//     City. The confidence was computed and then discarded.
//
//  2. SURFACE. card_events stores the bare slug with no surface, so the
//     visit-bucket unique index treated a Swift Links view and a card view as
//     the same event. 11 visits since 2026-08-14 produced two card_views rows
//     and one card_events row: the second surface was lost, and the survivor was
//     labelled by whichever fired first.
//
//  3. CONTACT SAVES. "Contact saved" / "saved your contact" is a claim no web or
//     native API can support — the Add-to-Contacts sheet belongs to the
//     operating system. The download is what SwiftCard performed.
// ─────────────────────────────────────────────────────────────────────────────

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8");

const geo = (g: Partial<GeoGuess>): GeoGuess => ({
  city: null, regionCode: null, regionName: null, country: null, org: null, ...g,
});

describe("the confidence ladder matches the decision that produced the label", () => {
  it("two sources naming one town is the only thing that earns a flat city", () => {
    const r = reconcileDetailed(
      geo({ city: "Ithaca", regionCode: "NY", country: "US" }),
      geo({ city: "Ithaca", regionName: "New York", country: "US" }),
    );
    expect(r).toEqual({ label: "Ithaca, NY", accuracy: "city" });
  });

  it("one source alone is 'near', never 'in' — the Bolton Landing lesson", () => {
    // 2026-09-03: a Long Island viewer was confidently placed in Bolton Landing
    // (four hours away) by one database and Trumansburg by three others. A
    // single database's town is a guess, and the label has to say so.
    const r = reconcileDetailed(geo({ city: "Great Neck", regionCode: "NY", country: "US" }), null);
    expect(r).toEqual({ label: "Great Neck, NY", accuracy: "city_approx" });
  });

  it("two sources disagreeing on the town is a REGION, flagged as one", () => {
    // This is the "New York, US" case — the label is unchanged (it is the
    // Locations tab's grouping key) and the accuracy is what makes it readable.
    const r = reconcileDetailed(
      geo({ city: "Great Neck", country: "US" }),
      geo({ city: "Bolton Landing", regionName: "New York", country: "US" }),
    );
    expect(r).toEqual({ label: "New York, US", accuracy: "region" });
  });

  it("a cellular gateway is a region even when the towns agree", () => {
    const r = reconcileDetailed(
      geo({ city: "Ithaca", country: "US" }),
      geo({ city: "Ithaca", regionName: "New York", country: "US", org: "AS6167 Verizon Wireless" }),
    );
    expect(r.accuracy).toBe("region");
  });

  it("two countries collapses to the country, and says so", () => {
    // Different towns AND different countries — there is nothing left but the
    // edge's country. (Two sources agreeing on a town keeps it, even across
    // countries: see request-geo.test.ts.)
    const r = reconcileDetailed(
      geo({ city: "Paris", country: "FR" }),
      geo({ city: "Austin", country: "US" }),
    );
    expect(r).toEqual({ label: "FR", accuracy: "country" });
  });

  it("a bare country is a country, and nothing at all is null", () => {
    expect(reconcileDetailed(geo({ country: "US" }), null)).toEqual({ label: "US", accuracy: "country" });
    expect(reconcileDetailed(geo({}), null)).toEqual({ label: null, accuracy: null });
    expect(reconcileDetailed(geo({}), geo({}))).toEqual({ label: null, accuracy: null });
  });

  it("the accuracy never outlives the label it describes", () => {
    // The region rung can degrade to a bare country (no region name, or the two
    // sources clashing on the region too). Claiming "region" there would promise
    // a state the label does not contain.
    const r = reconcileDetailed(
      geo({ city: "A", regionCode: "NY", country: "US" }),
      geo({ city: "B", regionCode: "CA", country: "US" }),
    );
    expect(r.label).toBe("US");
    expect(r.accuracy).toBe("country");
  });
});

describe("a relay or datacenter network cannot support a town", () => {
  it("downgrades a city to a region, and is NOT an exclusion", () => {
    // iCloud Private Relay egresses through Cloudflare/Akamai/Fastly and Apple
    // promises only the right country and rough region. Those are real people:
    // their view must still count, their town must not be claimed. A hosting
    // match that DROPPED the view would silently stop counting a slice of
    // ordinary iPhone users.
    const src = read("src/lib/request-geo.ts");
    expect(src).toMatch(/RELAY_OR_HOSTING/);
    expect(src).toMatch(/isRelay && \(base\.accuracy === "city" \|\| base\.accuracy === "city_approx"\)/);
    // Nothing in the geo layer may refuse, drop, or bot-flag on this signal.
    expect(src).not.toMatch(/isRelay \) return null|if \(isRelay\) return/);
  });

  it("records the signal rather than acting on it alone", () => {
    expect(read("supabase/analytics-accuracy.sql")).toMatch(/is_relay\s+boolean/);
  });
});

describe("the words a person reads", () => {
  it("states a confirmed town, qualifies everything less", () => {
    expect(locationLabel("Ithaca, NY", "city")).toBe("Ithaca, NY");
    expect(locationLabel("Great Neck, NY", "city_approx")).toBe("Near Great Neck, NY");
    expect(locationLabel("New York, US", "region")).toBe("New York (approximate)");
    expect(locationLabel("US", "country")).toBe("United States (approximate)");
    expect(locationLabel(null, "city")).toBe(LOCATION_UNAVAILABLE);
    expect(locationLabel("   ", null)).toBe(LOCATION_UNAVAILABLE);
  });

  it("never turns a region into the city of the same name", () => {
    // The whole point. "New York, US" must never render as anything a reader
    // could take for New York City.
    const shown = locationLabel("New York, US", "region");
    expect(shown).not.toBe("New York, US");
    expect(shown).not.toMatch(/,/);
  });

  it("keeps the multi-comma region whole", () => {
    expect(locationLabel("Washington, D.C., US", "region")).toBe("Washington, D.C. (approximate)");
  });

  it("renders pre-accuracy rows EXACTLY as before — no backfill, no guessing", () => {
    // Every row written before the column existed has no accuracy. The Locations
    // tab a customer looked at yesterday has to look the same today.
    expect(locationLabel("Great Neck, US", null)).toBe("Great Neck, US");
    expect(locationLabel("Great Neck, US", undefined)).toBe("Great Neck, US");
    expect(locationPhrase("Great Neck, US", null)).toBe(" near Great Neck, US");
  });

  it("fits a sentence without claiming a city it doesn't have", () => {
    expect(locationPhrase("Ithaca, NY", "city")).toBe(" near Ithaca, NY");
    expect(locationPhrase("Great Neck, NY", "city_approx")).toBe(" near Great Neck, NY");
    expect(locationPhrase("New York, US", "region")).toBe(" in the New York area");
    expect(locationPhrase("US", "country")).toBe(" in the United States");
    expect(locationPhrase(null, "city")).toBe("");
    // A lock screen has ~60 characters (push-policy.MAX_BODY_CHARS); the region
    // form changes shape instead of appending "(approximate)" to spend them.
    expect(locationPhrase("New York, US", "region")).not.toMatch(/approximate/);
  });

  it("an unknown country code degrades to the code, never to a wrong name", () => {
    expect(locationLabel("ZZ", "country")).toBe("ZZ (approximate)");
  });

  it("a group of rows is shown at its LEAST precise confidence", () => {
    // One label really can arrive two ways: "New York, US" is written both when
    // the databases disagree (region) and when the edge alone names the city
    // (city_approx). Showing the group as "Near New York, US" would promise the
    // city to rows that never meant it.
    expect(groupAccuracy(["city", "city_approx"])).toBe("city_approx");
    expect(groupAccuracy(["city_approx", "region"])).toBe("region");
    expect(groupAccuracy(["region", "country"])).toBe("country");
    // A MIXED group may not inherit the confident row's precision (owner
    // report, 2026-09-18). "Ithaca, US" ×8 with no accuracy, folded together
    // with one two-source "Ithaca, NY", used to render as a flat, confirmed
    // "Ithaca, NY" — nine visits presented as a confirmed town when one earned
    // it. An unknown row is at best one source's guess at a town, so the group
    // can read no better than that.
    expect(groupAccuracy([null, "city"])).toBe("city_approx");
    // A weaker known value still wins over the unknown floor.
    expect(groupAccuracy([null, "region"])).toBe("region");
    expect(groupAccuracy([null, undefined])).toBe(null);
    expect(groupAccuracy([])).toBe(null);
  });
});

describe("the confidence actually reaches storage and the screen", () => {
  it("both counted tables store it beside the label", () => {
    expect(read("src/lib/record-view.ts")).toMatch(/geo_accuracy: geo\.accuracy/);
    expect(read("src/app/api/card-events/route.ts")).toMatch(/geo_accuracy: geo\.accuracy/);
    // A lead's location is the one inferred line on a panel of things the
    // contact typed in themselves.
    expect(read("src/app/api/leads/route.ts")).toMatch(/geo_accuracy: geo\.accuracy/);
  });

  it("an unmigrated column loses the qualifier, never the row", () => {
    // A lead is the product. Losing one to a column that doesn't exist yet —
    // and showing the visitor "something went wrong" so they submit again —
    // would be the worst possible trade for a display nicety.
    for (const f of ["src/lib/record-view.ts", "src/app/api/card-events/route.ts", "src/app/api/leads/route.ts"]) {
      expect(read(f), f).toMatch(/42703|PGRST204/);
    }
  });

  it("the Locations tab renders the pair, and still groups on the stored label", () => {
    const dash = read("src/app/dashboard/page.tsx");
    expect(dash).toMatch(/locationLabel\(location, groupAccuracy\(c\.acc\)\)/);
    // locationAliases must keep folding "Great Neck, US" into "Great Neck, NY",
    // which only works while the RAW label is the key.
    expect(dash).toMatch(/const alias = locationAliases\(/);
    expect(dash).toMatch(/const loc = alias\.get\(v\.loc\) \?\? v\.loc/);
  });

  it("selecting the new column can never empty a customer's screen", () => {
    // Asking PostgREST for a column that isn't migrated fails the WHOLE query.
    // An unqualified list beats an empty one, on both screens.
    expect(read("src/app/dashboard/page.tsx")).toMatch(/cols = "username, location"/);
    expect(read("src/app/contacts/page.tsx")).toMatch(/return loadLeads\(LEAD_COLS\)/);
  });
});

describe("a Swift Links event stops being erased by the card event beside it", () => {
  const route = read("src/app/api/card-events/route.ts");
  const sql = read("supabase/analytics-accuracy.sql");

  it("the row says which page it happened on", () => {
    expect(route).toMatch(/^\s+surface,$/m);
  });

  it("every client that posts an event declares the surface", () => {
    expect(read("src/components/CardEventTracker.tsx")).toMatch(/surface: viewSurface/);
    expect(read("src/components/SaveContactButton.tsx")).toMatch(/surface: "card"/);
    expect(read("src/components/ScanSaveContact.tsx")).toMatch(/surface: "card"/);
  });

  it("the unique backstop includes the surface, and the old one is gone", () => {
    expect(sql).toMatch(/uq_card_events_visitor_surface_bucket/);
    expect(sql).toMatch(/coalesce\(surface, 'card'\)/);
    expect(sql).toMatch(/DROP INDEX IF EXISTS uq_card_events_visitor_bucket/);
    // Created BEFORE the drop, so no request is ever unprotected from the race.
    expect(sql.indexOf("uq_card_events_visitor_surface_bucket"))
      .toBeLessThan(sql.indexOf("DROP INDEX IF EXISTS uq_card_events_visitor_bucket"));
  });

  it("history keeps the uniqueness it already had", () => {
    // Rows written before the column have NULL surface. A NULL-distinct index
    // would let them accumulate duplicates they were previously protected from;
    // coalesce(surface,'card') keeps their semantics exactly as they were.
    expect(sql).toMatch(/coalesce\(surface, 'card'\)/);
    expect(sql).toMatch(/created_at >= '2026-08-14 00:00:00\+00'/);
  });

  it("the app-level dedup asks the same surface-aware question", () => {
    // Without this the app check would still swallow the second surface before
    // the index ever saw it, and the fix would look applied while changing nothing.
    expect(route).toMatch(/byTarget\.or\("surface\.is\.null,surface\.eq\.card"\)/);
    expect(route).toMatch(/byTarget\.eq\("surface", surface\)/);
  });

  it("the conversation timeline names the surface it reads", () => {
    const contacts = read("src/components/ContactsClient.tsx");
    expect(contacts).toMatch(/"Viewed your Swift Links"/);
    expect(contacts).toMatch(/viewed your Swift Links/);
    expect(route).toMatch(/let cols = `\$\{WANT\}, surface, target`/);
  });
});

describe("contact saves say only what happened", () => {
  it("the notification and activity copy report a download, not a save", () => {
    // Asserted on the OUTPUT, not the source: the source deliberately explains
    // in a comment what the old wording claimed and why it was wrong.
    const n = cardEventNotice({ eventType: "downloaded_vcard", visitorName: "Mina R", nameConfirmed: true })!;
    expect(n.title).toBe("Contact downloaded");
    expect(n.body).toBe("Mina R downloaded your contact card.");
    expect(cardEventNotice({ eventType: "downloaded_vcard" })!.body)
      .toBe("Someone downloaded your contact card.");
  });

  it("no customer-facing STRING anywhere still claims a save", () => {
    // Comments are stripped first — several of these files now carry a comment
    // quoting the old wording to explain why it went.
    const withoutComments = (src: string) =>
      src.replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    const surfaces = [
      "src/lib/card-event-notify.ts",
      "src/components/ContactsClient.tsx",
      "src/app/office/admin/analytics/page.tsx",
      "src/app/office/admin/analytics/[id]/page.tsx",
      "src/app/office/admin/analytics/EmployeeAnalyticsTable.tsx",
      "src/lib/office-analytics-csv.ts",
      "src/lib/knowledge/docs/office.ts",
    ];
    for (const f of surfaces) {
      expect(withoutComments(read(f)), `${f} still tells the owner a contact was saved`)
        .not.toMatch(/"Contact saved"|Contacts saved|saved your contact/);
    }
  });

  it("the stored event type is untouched — five consumers key on it", () => {
    // VISIT_RANK, the push category, the CRM event name, the office RPC and its
    // partial index all read "downloaded_vcard"/"contact_saved". The wording was
    // the lie; the identifiers were fine.
    expect(read("src/app/api/card-events/route.ts")).toMatch(/"viewed_card", "downloaded_vcard"/);
    expect(read("src/lib/card-event-notify.ts")).toMatch(/type: "contact_saved"/);
    expect(read("src/lib/visit-notify.ts")).toMatch(/contact_saved: 3/);
  });
});

describe("the milestone ledger has the index it has always claimed", () => {
  it("creates the type-based index for real", () => {
    // lib/milestones.ts named this index as "the real ledger" in a comment, and
    // it existed in no migration in the repository — so the check-then-write in
    // front of it was an open TOCTOU window.
    const sql = read("supabase/analytics-accuracy.sql");
    expect(sql).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS notifications_milestone_once_idx/);
    expect(sql).toMatch(/type LIKE 'milestone_%'/);
  });

  it("and the ledger it now actually uses — a column no upgrade can erase", () => {
    const sql = read("supabase/milestone-one-bell.sql");
    expect(sql).toMatch(/alter table public\.notifications add column if not exists milestone text/);
    expect(sql).toMatch(/notifications_milestone_once_idx_v2/);
    // History is backfilled so nothing already announced fires a second time.
    expect(sql).toMatch(/set milestone = type/);
    // Additive only — the older index is kept, not swapped out.
    expect(sql).not.toMatch(/drop index/i);
    expect(sql).not.toMatch(/DROP COLUMN|DROP TABLE/i);
  });
});

describe("the raw IP stays out of storage", () => {
  it("no writer populates card_views.ip, and the migration does not drop it", () => {
    // Verified against production 2026-09-09: NULL in all 229 rows. The column
    // is dead, not dangerous — and dropping a column is not a migration this
    // project makes without being told to.
    const rec = read("src/lib/record-view.ts");
    const viewRow = rec.slice(rec.indexOf("const viewRow = {"), rec.indexOf("let { error: insertErr }"));
    expect(viewRow).not.toMatch(/\bip\b/);
    const sql = read("supabase/analytics-accuracy.sql");
    expect(sql).not.toMatch(/DROP COLUMN/i);
    expect(sql).toMatch(/COMMENT ON COLUMN public\.card_views\.ip/);
  });

  it("the migration is additive — no drops, no renames, no RLS weakening", () => {
    const sql = read("supabase/analytics-accuracy.sql");
    expect(sql).not.toMatch(/DROP TABLE|DROP COLUMN|RENAME/i);
    expect(sql).not.toMatch(/DISABLE ROW LEVEL SECURITY/i);
    // The one DROP is the unique index replaced in the same file.
    const drops = sql.match(/DROP INDEX[^\n;]*/gi) ?? [];
    expect(drops).toEqual(["DROP INDEX IF EXISTS uq_card_events_visitor_bucket"]);
  });
});

describe("outbound link taps are finally counted — and counted honestly", () => {
  const route = read("src/app/api/card-events/route.ts");
  const tracker = read("src/lib/track-link-click.ts");

  it("stores the destination HOST, never the full URL", () => {
    // A full URL is where tracking parameters, campaign ids and tokens live.
    // The host is what identifies the link to its owner, and it is the owner's
    // own published link — nothing about the visitor.
    expect(linkTarget("https://www.calendly.com/alex/30min?utm_source=x&token=abc")).toBe("calendly.com");
    expect(linkTarget("https://instagram.com/alex")).toBe("instagram.com");
  });

  it("refuses anything that isn't a web link", () => {
    // A mailto:/tel: tap is a contact action, not a link click; inventing a host
    // for it would be worse than recording nothing.
    expect(linkTarget("mailto:a@b.com")).toBe(null);
    expect(linkTarget("tel:+15551234567")).toBe(null);
    expect(linkTarget("javascript:alert(1)")).toBe(null);
    expect(linkTarget("not a url at all")).toBe(null);
    expect(linkTarget("ftp://files.example.com")).toBe(null);
  });

  it("feeds the ONE canonical route — there is no second pipeline", () => {
    // Comments stripped: the file documents WHY the /l/<token> redirect design
    // was rejected, so the words appear in prose.
    const code = tracker.replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(code).toMatch(/"\/api\/card-events"/);
    expect(code).not.toMatch(/\/api\/analytics\/event|\/api\/views/);
    // Nothing is fetched from a second endpoint at all. (Three mentions: the
    // beacon, its fetch fallback, and the no-signal outbox, which replays to
    // the same route.)
    expect([...new Set([...code.matchAll(/["'`](\/api\/[^"'`]+)["'`]/g)].map((m) => m[1]))])
      .toEqual(["/api/card-events"]);
  });

  it("a relative or malformed href is never recorded as OUR host", () => {
    // Resolving against window.location would turn a broken link into a tap on
    // swiftcard.me — a fabricated measurement, which is worse than none.
    expect(linkTarget("/about")).toBe(null);
    expect(linkTarget("#")).toBe(null);
    expect(linkTarget("")).toBe(null);
  });

  it("uses a beacon, and can never delay or block the navigation", () => {
    // Every tracked anchor is target="_blank", so the page is not unloading and
    // an ordinary request completes — except SocialIcons' app-scheme handoff,
    // which replaces the document. sendBeacon survives that; keepalive fetch is
    // the fallback.
    expect(tracker).toMatch(/navigator\.sendBeacon\?\.\("\/api\/card-events", blob\)/);
    expect(tracker).toMatch(/keepalive: true/);
    // Nothing here is awaited, and nothing throws out of it.
    expect(tracker).not.toMatch(/await /);
    expect(tracker).toMatch(/export function trackLinkClick/);
  });

  it("the anchors keep their real destinations", () => {
    // The rejected alternative was rewriting every href to a /l/<token> redirect.
    // A visitor long-pressing a link must still see where it goes, and a link
    // that worked for a year must not break because our analytics is down.
    for (const f of [
      "src/components/SwiftLinkButtons.tsx",
      "src/components/CardActionLinks.tsx",
      "src/components/SocialIcons.tsx",
      "src/components/SocialLinkIntercept.tsx",
    ]) {
      const src = read(f);
      expect(src, `${f} must not route links through our own server`).not.toMatch(/href=\{`\/l\//);
      // The tap handler must not cancel the navigation to make room for tracking.
      expect(src).not.toMatch(/trackLinkClick[\s\S]{0,200}?preventDefault/);
    }
  });

  it("never notifies — eight links is eight taps and none of them is news", () => {
    expect(cardEventNotice({ eventType: "clicked_link", visitorName: "Mina R", nameConfirmed: true })).toBeNull();
  });

  it("is deduped per LINK, not per visit — two links is two events", () => {
    // Without the target in both the app check and the unique index, a second
    // tap on a DIFFERENT link inside one visit would be rejected as a duplicate
    // of the first: the same defect as the surface collision, one day later.
    expect(route).toMatch(/base\.eq\("target", target\) : base\.is\("target", null\)/);
    expect(read("supabase/analytics-accuracy.sql")).toMatch(/coalesce\(target, ''\)/);
  });

  it("records nothing from a preview, a designer, or the owner's own page", () => {
    // These components render inside the card wizard, the live Social-design
    // preview and three marketing mockups. Tracking is OPT-IN (trackFor defaults
    // to null) so a surface that forgets to opt in is silent, never noisy.
    expect(read("src/components/SwiftLinkButtons.tsx")).toMatch(/trackFor = null,/);
    expect(read("src/components/SocialIcons.tsx")).toMatch(/trackFor = null,/);
    expect(read("src/components/CardActionLinks.tsx")).toMatch(/trackFor = null,/);
    expect(read("src/components/site/DemoSwiftLinks.tsx")).toMatch(/suppressTracking/);
    // The live pages opt in, and suppress for the owner and the /preview frame.
    expect(read("src/app/links/[username]/page.tsx")).toMatch(/suppressTracking=\{isEmbed \|\| isOwnerView\}/);
    expect(read("src/app/[username]/page.tsx")).toMatch(/suppressTracking=\{isEmbed \|\| isOwnerView\}/);
    // SwiftLinkProfile renders in the designer too — `embedded` kills tracking
    // there even if a caller passes a slug.
    expect(read("src/components/SwiftLinkProfile.tsx")).toMatch(/trackFor=\{embedded \? null : trackFor\}/);
  });

  it("the owner can actually see them", () => {
    const dash = read("src/app/dashboard/page.tsx");
    expect(dash).toMatch(/\.eq\("event_type", "clicked_link"\)/);
    // Omitted until there IS one: a confident zero on a card whose links predate
    // tracking would read as "nobody taps my links".
    expect(dash).toMatch(/\{linkTaps > 0 && \(/);
    // And the contact's timeline names the link.
    expect(read("src/components/ContactsClient.tsx")).toMatch(/tapped your \$\{e\.target\} link/);
  });
});
