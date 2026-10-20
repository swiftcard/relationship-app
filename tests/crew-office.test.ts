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
  it("keeps decision-makers, drops agents, and refuses an email the site never showed", () => {
    const rows = officeLeads(site, {
      i: 0,
      talking_point: "Twelve agents; a shared lead inbox would help the broker see every lead.",
      people: [
        { name: "Maria Lopez", title: "Broker/Owner", email: "maria@brownstonerealty.example.com", phone: "" },
        { name: "Sam Kim", title: "Licensed Agent", email: "sam@brownstonerealty.example.com", phone: "" },
        { name: "Dana Fox", title: "Team Lead", email: "dana@invented.example.com", phone: "212-555-0100" },
      ],
    });
    expect(rows.map((r) => r.name)).toEqual(["Maria Lopez", "Dana Fox"]);
    expect(rows[0]).toMatchObject({ list: "office", email: "maria@brownstonerealty.example.com", phone: "7185550142", city: "New York", source_url: "https://brownstonerealty.example.com/" });
    expect(rows[1].email).toBeNull(); // not on the site → never saved
    expect(rows[1].phone).toBe("7185550142"); // their phone wasn't on the site either; the office line is
    expect(rows[0].notes).toMatch(/shared lead inbox/);
  });
  it("falls back to the main office line when no one is named", () => {
    const rows = officeLeads(site, { i: 0, talking_point: "", people: [] });
    expect(rows).toEqual([expect.objectContaining({ title: "Main office", phone: "7185550142" })]);
  });
  it("rotates through NYC areas and business types", () => {
    expect(officeQuery(0)).toEqual({ area: NYC_AREAS[0], type: "real estate teams" });
    expect(officeQuery(NYC_AREAS.length).type).toBe("real estate brokerages");
  });
  it("is registered with a manager, drafting emails as DMs through the ledger", () => {
    expect(OFFICE[0].id).toBe("office-outreach");
    expect(OFFICE[0].approvalKind).toBe("dm");
    expect(AGENTS.some((a) => a.id === "office-manager")).toBe(true);
  });
});

describe("untrusted URLs", () => {
  it("lead and office page reads go through the SSRF-safe fetch", () => {
    const src = readFileSync("src/lib/crew/leads/fetch-page.ts", "utf8");
    expect(src).toContain('import { safeFetch } from "@/lib/safe-fetch";');
    expect(src).not.toMatch(/\bawait fetch\(/);
  });
});
