import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { officeLeads, officeQuery, NYC_AREAS, OFFICE } from "@/lib/crew/agents/office";
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
    expect(rows[0]).toMatchObject({ list: "office", email: "maria@brownstonerealty.example.com", phone: "7185550142", city: "New York", source_url: "https://brownstonerealty.example.com/" });
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
