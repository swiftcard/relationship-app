import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { effectivePlan, isPaidProfile } from "@/lib/effective-plan";
import { forwardQuery } from "@/lib/forward-query";
import { reconcileDetailed, type GeoGuess } from "@/lib/request-geo";

// ─────────────────────────────────────────────────────────────────────────────
// 2026-10-06 FINAL ANALYTICS REVIEW — every fix it shipped, pinned.
// Owner's ask: views and locations "as precise as possible", every plan getting
// exactly what it pays for, Free never seeing a place.
// ─────────────────────────────────────────────────────────────────────────────

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const route = () => read("src/app/api/card-events/route.ts");

afterEach(() => vi.useRealTimers());

describe("an expired timed grant is Free the moment it expires, not at the next cron", () => {
  const past = new Date(Date.now() - 60_000).toISOString();
  const future = new Date(Date.now() + 86_400_000).toISOString();

  it("free month / comp / app trial past its date → Free", () => {
    expect(effectivePlan({ plan: "pro", plan_expires_at: past })).toBe("free");
    expect(isPaidProfile({ plan: "pro", plan_expires_at: past })).toBe(false);
    expect(isPaidProfile({ plan: "enterprise", plan_expires_at: past })).toBe(false);
  });

  it("a grant still running, or no grant at all, is untouched", () => {
    expect(isPaidProfile({ plan: "pro", plan_expires_at: future })).toBe(true);
    expect(isPaidProfile({ plan: "pro", plan_expires_at: null })).toBe(true);
    expect(isPaidProfile({ plan: "enterprise" })).toBe(true);
    expect(isPaidProfile({ plan: "free" })).toBe(false);
    expect(isPaidProfile(null)).toBe(false);
  });

  it("a real subscriber is never expired by a stale grant date (mirrors expireFreeMonths)", () => {
    expect(isPaidProfile({ plan: "pro", plan_expires_at: past, stripe_subscription_id: "sub_123" })).toBe(true);
    expect(isPaidProfile({ plan: "pro", plan_expires_at: past, customization: { _planSource: "apple" } })).toBe(true);
  });

  it("every surface that shows a place asks the effective plan", () => {
    expect(read("src/app/dashboard/page.tsx")).toMatch(/const isPro = isPaidProfile\(profile\);/);
    expect(read("src/app/contacts/page.tsx")).toMatch(/const paid = isPaidProfile\(profile\);/);
    expect(read("src/lib/notification-privacy.ts")).toMatch(/return isPaidProfile\(data\);/);
    expect(read("src/lib/push.ts")).toMatch(/const paid = isPaidProfile\(profile\);/);
    expect(read("src/app/api/leads/export/route.ts")).toMatch(/if \(!isPaidProfile\(profile\)\)/);
    expect(route()).not.toMatch(/isPaidPlan\(owner\.plan/);
  });
});

describe("Free never receives a place — the remaining paths", () => {
  it("the dashboard doesn't even read the Locations rows for Free", () => {
    expect(read("src/app/dashboard/page.tsx")).toMatch(/viewsRange === "locations" && isPro\s*\n?\s*\?/);
  });

  it("the sample contact's place is redacted for Free", () => {
    const s = read("src/app/api/contacts/seed-demo/route.ts");
    expect(s).toMatch(/!isPaidProfile\(profile\)/);
    expect(s).toMatch(/redactPlaceLabel\(/);
  });

  it("the old visitor-id path honours the Free contact lock like the lead_id path", () => {
    expect(route()).toMatch(/else if \(visitorId && !\(await isPaidUser\(user\.id\)\)\)/);
  });

  it("native CRM sync re-checks the plan itself, so no future caller can stream a Free account's places", () => {
    const s = read("src/lib/crm-sync.ts");
    const body = s.slice(s.indexOf("export async function syncLeadToAllCrms"));
    expect(body.indexOf("isPaidProfile(data)")).toBeGreaterThan(-1);
    expect(body.indexOf("isPaidProfile(data)")).toBeLessThan(body.indexOf("syncLeadToGoogle"));
  });
});

describe("the office console agrees with the office APIs about a lapsed owner", () => {
  it("guard + nav both check the owner is still on Office", () => {
    expect(read("src/lib/office-admin-guard.ts")).toMatch(/!\(await officeOwnerStillOnOffice\(ctx\.ownerId\)\)\) redirect\("\/dashboard"\)/);
    expect(read("src/lib/office-roles.ts")).toMatch(/roleHasCapability\(ctx\.role, "view_org_analytics"\) && \(await officeOwnerStillOnOffice\(ctx\.ownerId\)\)/);
  });
});

describe("counting precision", () => {
  it("datacenter traffic is refused for link taps and saves, not just views", () => {
    expect(route()).toMatch(/if \(!viewGeo && liveGeo\.isHosting\) \{\s*return decided\("hosting"/);
  });

  it("each event kind has its own rate budget, so taps can't starve views on shared Wi-Fi", () => {
    expect(route()).toMatch(/RATE_BUDGET: Record<string, number> = \{ viewed_card: 60, clicked_link: 60, downloaded_vcard: 20 \}/);
  });

  it("two buttons to the same site are two taps (label is in the dedupe and the index)", () => {
    expect(route()).toMatch(/byHost\.eq\("target_label", target_label\)/);
    const sql = read("supabase/analytics-final-review-2026-10-06.sql");
    expect(sql).toMatch(/coalesce\(target_label, ''\)/);
    expect(sql).toMatch(/DROP INDEX IF EXISTS uq_card_events_visitor_surface_bucket;/);
  });

  it("a contact save also records the view (the desktop QR loses the dwell)", () => {
    const s = route();
    const branch = s.slice(s.indexOf('} else if (event_type === "downloaded_vcard") {'));
    expect(branch.slice(0, 2000)).toMatch(/await recordView\(\{/);
  });

  it("'Nth visit this week' counts visit buckets, not rows", () => {
    expect(route()).toMatch(/new Set\(\s*\(visitRows \?\? \[\]\)\.map\(\(r\) => Math\.floor\(new Date\(r\.viewed_at as string\)\.getTime\(\) \/ VIEW_VISIT_WINDOW_MS\)\)/);
  });

  it("the milestone copy names what the number counts", () => {
    expect(route()).toMatch(/views across your card and Swift Links\. \$\{milestone\.body\}/);
  });

  it("slugs are lowercased on the event path like recordView does", () => {
    expect(route()).toMatch(/str\(body\?\.card_owner_username, 80\)\?\.toLowerCase\(\)/);
  });

  it("the Locations tab is aggregated in the database (no 10k-row ceiling), service-role only", () => {
    expect(read("src/app/dashboard/page.tsx")).toMatch(/rpc\("card_location_counts"/);
    const sql = read("supabase/analytics-final-review-2026-10-06.sql");
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.card_location_counts\(text\[\]\) FROM PUBLIC, anon, authenticated;/);
  });

  it("a rename carries the ingest log and open visit keys", () => {
    const sql = read("supabase/analytics-final-review-2026-10-06.sql");
    expect(sql).toMatch(/UPDATE analytics_ingest_log SET entity_key = p_new_slug WHERE entity_key = v_old_slug;/);
    expect(sql).toMatch(/UPDATE notifications SET visit_key = p_new_slug/);
  });
});

describe("offline replays are filed when they happened, with no invented place", () => {
  it("the outbox stamps the original time", () => {
    expect(read("src/lib/offline-outbox.ts")).toMatch(/"X-SC-Queued-At": String\(item\.at\)/);
  });

  it("the server trusts it only within the outbox's 7 days, drops the place, files the real time, and never pushes stale news", () => {
    const s = route();
    expect(s).toMatch(/req\.headers\.get\("x-sc-queued-at"\)/);
    expect(s).toMatch(/Date\.now\(\) - queuedAt <= 7 \* 24 \* 3600 \* 1000/);
    expect(s).toMatch(/replayAt \? \{ \.\.\.liveGeo, label: null, accuracy: null, source: null \} : liveGeo/);
    expect(s).toMatch(/created_at: new Date\(replayAt \?\? Date\.now\(\)\)\.toISOString\(\)/);
    expect(s).toMatch(/if \(owner\?\.id && !staleReplay\)/);
    const rv = read("src/lib/record-view.ts");
    expect(rv).toMatch(/viewed_at: new Date\(happenedAt\)\.toISOString\(\)/);
    expect(rv).toMatch(/\.lte\("viewed_at", until\)/);
  });
});

describe("a privacy relay never names a town", () => {
  const g = (o: Partial<GeoGuess>): GeoGuess => ({ city: null, regionCode: null, regionName: null, country: null, org: null, ...o });

  it("two databases agreeing on the relay's town → the state, labelled as the state", () => {
    const edge = g({ city: "Newark", regionCode: "NJ", country: "US" });
    const second = g({ city: "Newark", regionCode: "NJ", regionName: "New Jersey", country: "US", org: "Cloudflare" });
    expect(reconcileDetailed(edge, second).label).toBe("Newark, NJ"); // not a relay
    expect(reconcileDetailed(edge, second, { townUnsupported: true })).toEqual({ label: "New Jersey, US", accuracy: "region" });
  });

  it("one unconfirmed database on a relay → the country only", () => {
    expect(reconcileDetailed(g({ city: "Newark", country: "US" }), null, { townUnsupported: true })).toEqual({ label: "US", accuracy: "country" });
  });
});

describe("redirects keep where the visitor came from", () => {
  it("every param rides along, first value of a repeat", () => {
    expect(forwardQuery("/dana-acme", { source: "nfc_card", save: "1", ct: "abc" })).toBe("/dana-acme?source=nfc_card&save=1&ct=abc");
    expect(forwardQuery("/dana-acme", { source: ["qr_code", "x"] })).toBe("/dana-acme?source=qr_code");
    expect(forwardQuery("/dana-acme", {})).toBe("/dana-acme");
  });

  it("both pages use it for the case redirect AND the renamed-slug redirect", () => {
    const card = read("src/app/[username]/page.tsx");
    expect(card).toMatch(/permanentRedirect\(forwardQuery\(`\/\$\{username\}`, query\)\)/);
    expect(card).toMatch(/permanentRedirect\(forwardQuery\(`\/\$\{alias\}`, query\)\)/);
    const links = read("src/app/links/[username]/page.tsx");
    expect(links).toMatch(/permanentRedirect\(forwardQuery\(`\/links\/\$\{username\}`, query\)\)/);
    expect(links).toMatch(/permanentRedirect\(forwardQuery\(`\/links\/\$\{alias\}`, query\)\)/);
  });
});

describe("the dashboard reads the owner's calendar", () => {
  it("today has 23/24/25 hour bars on DST days", () => {
    expect(read("src/app/dashboard/page.tsx")).toMatch(/viewsRange === "week" \? 7 : hoursToday;/);
  });
  it("first load uses the zone learned for push before falling back to UTC, then refreshes once", () => {
    expect(read("src/app/dashboard/page.tsx")).toMatch(/cookieStore\.get\("sc_tz"\)\?\.value \?\? readPushPrefs\(profile\.customization\)\.timezone/);
    expect(read("src/components/TimezoneCookie.tsx")).toMatch(/router\.refresh\(\);/);
  });
});
