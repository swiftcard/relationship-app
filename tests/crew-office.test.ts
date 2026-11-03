import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { nextOfficeQuery, officeLeads, officeQuery, searchedRecently, NYC_AREAS, OFFICE, OFFICE_ROTATION, PRIORITY_TYPES } from "@/lib/crew/agents/office";
import { AGENTS } from "@/lib/crew/registry";

// Phase 5, Office outreach: decision-makers only, and only the contact
// details the business's own site shows (a model can't invent an email).

const site = {
  name: "Brownstone Realty",
  website: "https://brownstonerealty.example.com",
  area: "Brooklyn",
  type: "real estate teams",
  pages: [
    { url: "https://brownstonerealty.example.com/", html: "<title>Brownstone Realty</title> Call (718) 555-0142" },
    { url: "https://brownstonerealty.example.com/team", html: "Maria Lopez, Broker/Owner, maria@brownstonerealty.example.com. Sam Kim, Licensed Agent, sam@brownstonerealty.example.com" },
  ],
};

describe("office leads", () => {
  it("one row per office: the decision-maker the site names, never a person or an email it doesn't show", () => {
    const rows = officeLeads(site, {
      i: 0,
      talking_point: "Twelve agents; a shared lead inbox would help the broker see every lead.",
      people: [
        { name: "Maria Lopez", title: "Broker/Owner", email: "maria@brownstonerealty.example.com", phone: "" },
        { name: "Sam Kim", title: "Licensed Agent", email: "sam@brownstonerealty.example.com", phone: "" },
        { name: "Dana Fox", title: "Team Lead", email: "dana@invented.example.com", phone: "212-555-0100" },
      ],
    });
    // Sam isn't a decision-maker; Dana isn't on the site at all, so the model invented her.
    expect(rows.map((r) => r.name)).toEqual(["Maria Lopez"]);
    expect(rows[0]).toMatchObject({ list: "office", email: "maria@brownstonerealty.example.com", phone: "7185550142", city: "New York", source_url: "https://brownstonerealty.example.com/team" });
    expect(rows[0].notes).toMatch(/shared lead inbox/);
    expect(rows[0].notes).not.toMatch(/Dana/);
  });
  it("names the other decision-makers in the talking point, and refuses an email the site never showed", () => {
    const two = { ...site, pages: [...site.pages, { url: "https://brownstonerealty.example.com/about", html: "Ray Ortiz, Managing Partner" }] };
    const rows = officeLeads(two, {
      i: 0,
      talking_point: "Point.",
      people: [
        { name: "Ray Ortiz", title: "Managing Partner", email: "ray@invented.example.com", phone: "" },
        { name: "Maria Lopez", title: "Broker/Owner", email: "maria@brownstonerealty.example.com", phone: "" },
      ],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("Maria Lopez"); // the one whose email the site shows
    expect(rows[0].notes).toContain("Also on the site: Ray Ortiz (Managing Partner).");
    const onlyRay = officeLeads(two, { i: 0, talking_point: "", people: [{ name: "Ray Ortiz", title: "Managing Partner", email: "ray@invented.example.com", phone: "" }] });
    expect(onlyRay[0]).toMatchObject({ name: "Ray Ortiz", email: null, phone: "7185550142" });
  });
  it("falls back to the main office line when no one is named", () => {
    const rows = officeLeads(site, { i: 0, talking_point: "", people: [] });
    expect(rows).toEqual([expect.objectContaining({ title: "Main office", phone: "7185550142" })]);
  });
  it("rotates through NYC areas and business types", () => {
    expect(officeQuery(0)).toEqual({ area: NYC_AREAS[0], type: "real estate teams" });
    expect(officeQuery(NYC_AREAS.length).type).toBe("real estate brokerages");
  });
  it("searches real estate teams and brokerages in every area before any other type, with no target twice", () => {
    const re = OFFICE_ROTATION.slice(0, NYC_AREAS.length * PRIORITY_TYPES.length);
    expect(re.every((q) => PRIORITY_TYPES.includes(q.type))).toBe(true);
    expect(OFFICE_ROTATION.slice(re.length).some((q) => PRIORITY_TYPES.includes(q.type))).toBe(false);
    expect(new Set(OFFICE_ROTATION.map((q) => `${q.type}|${q.area}`)).size).toBe(OFFICE_ROTATION.length);
    expect(new Set(NYC_AREAS).size).toBe(NYC_AREAS.length);
    expect(NYC_AREAS.length).toBeGreaterThanOrEqual(40);
    expect(officeQuery(OFFICE_ROTATION.length)).toEqual(officeQuery(0)); // wraps
  });
  it("skips a search it ran in the last 90 days, read from its own run summaries", () => {
    const now = new Date("2026-11-03T15:00:00Z");
    const runs = [
      { started_at: "2026-11-02T22:45:07Z", summary: "real estate teams in Upper West Side: 2 new call rows, 0 email drafts. Funnel: search 7" },
      { started_at: "2026-11-02T22:00:00Z", summary: "real estate teams in Harlem: no readable sites this time. Funnel: search 3" },
      { started_at: "2026-06-01T00:00:00Z", summary: "real estate teams in Chelsea: 1 new call rows" }, // more than 90 days ago
      { started_at: "2026-11-02T21:00:00Z", summary: "Done for today: 30 call rows are ready. Back tomorrow." },
      { started_at: "2026-11-02T20:00:00Z", summary: null },
    ];
    const searched = searchedRecently(runs, now);
    expect([...searched].sort()).toEqual(["real estate teams|harlem", "real estate teams|upper west side"]);
    const uws = OFFICE_ROTATION.findIndex((q) => q.area === "Upper West Side" && q.type === "real estate teams");
    // Upper West Side and Harlem were just searched; Chelsea was long enough ago to search again.
    expect(nextOfficeQuery(uws, searched)).toEqual({ index: uws + 2, area: "Chelsea", type: "real estate teams" });
    expect(nextOfficeQuery(5, new Set())).toEqual({ index: 5, ...officeQuery(5) });
  });
  it("falls back to its own slot when every search was run recently", () => {
    const all = new Set(OFFICE_ROTATION.map((q) => `${q.type}|${q.area}`.toLowerCase()));
    expect(nextOfficeQuery(7, all)).toEqual({ index: 7, ...officeQuery(7) });
  });
  it("is registered without a manager, drafting emails as DMs through the ledger", () => {
    expect(OFFICE[0].id).toBe("office-outreach");
    expect(OFFICE[0].approvalKind).toBe("dm");
    expect(AGENTS.some((a) => a.id === "office-manager")).toBe(false); // retired 2026-10-27: the Sheet replaced its room
  });
});

describe("untrusted URLs", () => {
  it("lead and office page reads go through the SSRF-safe fetch", () => {
    const src = readFileSync("src/lib/crew/leads/fetch-page.ts", "utf8");
    expect(src).toContain('import { safeFetch } from "@/lib/safe-fetch";');
    expect(src).not.toMatch(/\bawait fetch\(/);
  });
});
