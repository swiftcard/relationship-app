import { afterEach, describe, expect, it, vi } from "vitest";
import { leadsFromSite } from "@/lib/crew/agents/leads";
import { officeLeads } from "@/lib/crew/agents/office";
import { assessPrompt, type SiteAssessment } from "@/lib/crew/leads/assess";
import { EMAIL_STATUS, companyKey, dnsLookup, emailDomainStatus, leadScore, usable, withEmailStatus } from "@/lib/crew/leads/quality";
import { recordLeads } from "@/lib/crew/leads/record";
import { specHash } from "@/lib/crew/sheets/bootstrap";
import { agentHash, leadRows, type RowSources } from "@/lib/crew/sheets/rows";
import { OFFICE_PROSPECTS, WEB_LEADS } from "@/lib/crew/sheets/tabs";
import type { Lead } from "@/lib/crew/types";
import { fakeAgent, setup } from "./crew-helpers";

// ── Phase 1 of the lead agents: fewer, better rows ──────────────────────────
// One lead per company across Web Leads and Office Prospects, a decision-maker
// only when the business's own site names them, an email domain checked for a
// mail server (never called a verified mailbox), a score, why, hook and an
// opener on the row, and run stats that say what was rejected and why. The
// leads already saved are never changed, and their Sheet rows stay byte for
// byte what they were, so the sync never rewrites them.

afterEach(() => vi.restoreAllMocks());

const sources = (): RowSources => ({ approvals: [], leads: [], findings: [], people: [], facts: [], geoHistory: [], known: new Map(), blueskyLive: false });
const cold = (o: Partial<Lead>): Lead => ({ list: "cold", email: null, source_platform: "web", source_url: "https://acmerealty.com/contact", ...o });

describe("companyKey", () => {
  it("is the site's host, without www", () => {
    expect(companyKey({ source_url: "https://www.AcmeRealty.com/contact", company: "Acme Realty" })).toBe("acmerealty.com");
    expect(companyKey({ source_url: "http://acmerealty.com/", company: "Anything" })).toBe("acmerealty.com");
  });
  it("on a shared brokerage or site-builder host, is the host plus the team's name", () => {
    expect(companyKey({ source_url: "https://www.compass.com/agents/ryan-team/", company: "The Ryan + Ryan Team" })).toBe("compass.com/ryan-ryan-team");
    expect(companyKey({ source_url: "https://www.compass.com/agents/other/", company: "Aaron and Geoff at Compass" })).toBe("compass.com/aaron-and-geoff-at-compass");
  });
  it("falls back to the name for a pasted source, and to nothing when there is neither", () => {
    expect(companyKey({ source_url: "paste:123", company: "Shiny Windows LLC" })).toBe("name:shiny-windows");
    expect(companyKey({ source_url: "paste:123", company: null })).toBeNull();
  });
});

describe("email domain check", () => {
  it("says Domain OK only when the domain has a mail server, and never 'Verified'", async () => {
    vi.spyOn(dnsLookup, "mx").mockResolvedValue([{ exchange: "mx.acme.com", priority: 10 }]);
    expect(await emailDomainStatus("jo@acme.com")).toBe("Domain OK");
    expect(Object.values(EMAIL_STATUS)).not.toContain("Verified");
  });
  it("No Mail Server only when the domain doesn't exist, publishes a null MX, or has no MX and no address", async () => {
    const spy = vi.spyOn(dnsLookup, "mx");
    const address = vi.spyOn(dnsLookup, "address");
    spy.mockRejectedValueOnce(Object.assign(new Error("x"), { code: "ENOTFOUND" }));
    expect(await emailDomainStatus("jo@gone.example")).toBe("No Mail Server");
    spy.mockResolvedValueOnce([{ exchange: ".", priority: 0 }]);
    expect(await emailDomainStatus("jo@nullmx.example")).toBe("No Mail Server");
    spy.mockRejectedValueOnce(Object.assign(new Error("x"), { code: "ENODATA" }));
    address.mockResolvedValueOnce(false);
    expect(await emailDomainStatus("jo@bare.example")).toBe("No Mail Server");
  });
  it("no MX but an address record is 'No MX Record', not undeliverable: senders fall back to that address (RFC 5321 §5.1)", async () => {
    vi.spyOn(dnsLookup, "mx").mockRejectedValueOnce(Object.assign(new Error("x"), { code: "ENODATA" }));
    vi.spyOn(dnsLookup, "address").mockResolvedValueOnce(true);
    expect(await emailDomainStatus("jo@amx.example")).toBe("No MX Record");
    expect(usable(cold({ email: "jo@amx.example", email_status: "No MX Record" }))).toBe(true);
    const ok = leadScore({ fit: 20, name: null, title: null, email: "jo@a.com", emailStatus: "Domain OK", phone: null, industry: null });
    const noMx = leadScore({ fit: 20, name: null, title: null, email: "jo@a.com", emailStatus: "No MX Record", phone: null, industry: null });
    const none = leadScore({ fit: 20, name: null, title: null, email: "jo@a.com", emailStatus: "No Mail Server", phone: null, industry: null });
    expect(ok).toBeGreaterThan(noMx);
    expect(noMx).toBeGreaterThan(none);
  });
  it("a failed or slow lookup is Unchecked, not a verdict", async () => {
    vi.spyOn(dnsLookup, "mx").mockRejectedValueOnce(Object.assign(new Error("x"), { code: "ESERVFAIL" }));
    expect(await emailDomainStatus("jo@flaky.example")).toBe("Unchecked");
    vi.spyOn(dnsLookup, "mx").mockImplementationOnce(() => new Promise(() => undefined));
    expect(await emailDomainStatus("jo@slow.example", 20)).toBe("Unchecked");
  });
  it("skips the lookup for free mail and for no email, and looks each domain up once", async () => {
    const spy = vi.spyOn(dnsLookup, "mx").mockResolvedValue([{ exchange: "mx.acme.com", priority: 10 }]);
    expect(await emailDomainStatus("jo@gmail.com")).toBe("Domain OK");
    expect(await emailDomainStatus(null)).toBe("None");
    const out = await withEmailStatus([cold({ email: "a@acme.com" }), cold({ email: "b@acme.com" }), cold({ email: null, phone: "7045550100" })]);
    expect(out.map((l) => l.email_status)).toEqual(["Domain OK", "Domain OK", "None"]);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe("score", () => {
  it("a named decision-maker with their own email and phone in a core industry beats an info@ inbox", () => {
    const best = leadScore({ fit: 30, name: "Maria Lopez", title: "Broker/Owner", email: "maria@acme.com", emailStatus: "Domain OK", phone: "7185550142", industry: "real estate teams" });
    const generic = leadScore({ fit: 30, name: null, title: null, email: "info@acme.com", emailStatus: "Domain OK", phone: null, industry: "roofing contractors" });
    expect(best).toBeGreaterThan(generic);
    expect(best).toBeLessThanOrEqual(100);
    expect(leadScore({ fit: 99, name: "A B", title: "Owner", email: "a@b.com", emailStatus: null, phone: "1", industry: "mortgage" })).toBe(100);
    expect(leadScore({ fit: 0, name: null, title: null, email: "info@x.com", emailStatus: "No Mail Server", phone: null, industry: null })).toBe(0);
  });
  it("usable means a phone, or an email whose domain can receive mail", () => {
    expect(usable(cold({ email: "a@x.com", email_status: "No Mail Server" }))).toBe(false);
    expect(usable(cold({ email: "a@x.com", email_status: "No Mail Server", phone: "7045550100" }))).toBe(true);
    expect(usable(cold({ email: "a@x.com", email_status: "Domain OK" }))).toBe(true);
    expect(usable(cold({ email: "a@x.de", email_status: "Domain OK", region_restricted: true }))).toBe(false);
  });
});

describe("Web Leads: one lead per business, from the site", () => {
  const pages = [
    { url: "https://acmerealty.com/", html: "<title>Acme Realty</title> Our team of 14 agents opened a second office in Ballantyne. <a href='/team'>Team</a>" },
    { url: "https://acmerealty.com/team", html: "Jane Park, Owner &amp; Broker, <a href='mailto:jane@acmerealty.com'>jane@acmerealty.com</a>. Office: info@acmerealty.com, (704) 555-0100" },
  ];
  const biz = { name: "Acme Realty", website: "https://acmerealty.com", city: "Charlotte", state: "NC" };
  const read = (o: Partial<SiteAssessment> = {}): SiteAssessment => ({ i: 0, people: [{ name: "Jane Park", title: "Owner & Broker", email: "jane@acmerealty.com", phone: "" }], fit: 32, why: "A 14-agent team that meets buyers in person every week.", hook: "Opened a second office in Ballantyne.", opener: "Congrats on the Ballantyne office.", talking_point: "", ...o });

  it("names the decision-maker with their own email, and fills score, why, hook and opener", () => {
    const [l] = leadsFromSite(biz, pages, "real estate offices", read());
    expect(l).toMatchObject({ name: "Jane Park", title: "Owner & Broker", email: "jane@acmerealty.com", phone: "7045550100", why: "A 14-agent team that meets buyers in person every week.", hook: "Opened a second office in Ballantyne.", message: "Congrats on the Ballantyne office." });
    expect(l.score).toBeGreaterThanOrEqual(80);
    expect(l.notes).toBe("Other addresses on the site: info@acmerealty.com");
  });
  it("never keeps a person or an email the site doesn't show", () => {
    const [l] = leadsFromSite(biz, pages, "real estate offices", read({ people: [{ name: "Tom Invented", title: "Owner", email: "tom@acmerealty.com", phone: "" }] }));
    expect(l.name).toBeNull();
    expect(l.email).toBe("jane@acmerealty.com"); // the site's best address: a person's, before info@
  });
  it("drops an opener or hook that greets a person the site doesn't show", () => {
    const [l] = leadsFromSite(biz, pages, "real estate offices", read({ people: [{ name: "Tom Invented", title: "Owner", email: "", phone: "" }], opener: "Hi Tom, congrats on Ballantyne.", hook: "Second office in Ballantyne." }));
    expect(l.message).toBeNull();
    expect(l.hook).toBe("Second office in Ballantyne.");
    const [kept] = leadsFromSite(biz, pages, "real estate offices", read({ opener: "Hi Jane, congrats on Ballantyne." }));
    expect(kept.message).toBe("Hi Jane, congrats on Ballantyne.");
  });
  it("skips a business the read calls no fit, and still works with no read at all", () => {
    expect(leadsFromSite(biz, pages, "real estate offices", read({ fit: 0 }))).toEqual([]);
    const [l] = leadsFromSite(biz, pages, "real estate offices");
    expect(l).toMatchObject({ email: "jane@acmerealty.com", name: null, score: null, why: null });
  });
  it("one lead per site, however many addresses it publishes", () => {
    expect(leadsFromSite(biz, pages, "real estate offices", read())).toHaveLength(1);
  });
  it("the read is told to copy, never invent, and to leave the hook empty when the site says nothing specific", () => {
    const { system } = assessPrompt([{ name: "Acme", website: "https://acme.com", type: "x", area: "y", pages }], { office: false });
    expect(system).toMatch(/EXACTLY as the site shows/);
    expect(system).toMatch(/Never guess or build an email/);
    expect(system).toMatch(/leave hook empty rather than inventing/);
  });
});

describe("Office Prospects: a call opener whenever there's a phone", () => {
  const site = { name: "Brownstone Realty", website: "https://brownstone.example.com", area: "Brooklyn", type: "real estate teams", pages: [{ url: "https://brownstone.example.com/", html: "Maria Lopez, Broker/Owner. Call (718) 555-0142" }] };
  const found = { i: 0, people: [{ name: "Maria Lopez", title: "Broker/Owner", email: "", phone: "" }], fit: 30, why: "Twelve agents.", hook: "Twelve agents in Park Slope.", opener: "Hi Maria, this is [your name] from SwiftCard. How do your twelve agents share their details at open houses?", talking_point: "Matching cards and one lead inbox." };
  it("writes the opener into the row even with no email", () => {
    const [r] = officeLeads(site, found);
    expect(r).toMatchObject({ name: "Maria Lopez", email: null, phone: "7185550142", message: found.opener });
    expect(r.score).toBeGreaterThan(0);
  });
  it("no phone, no opener", () => {
    const noPhone = { ...site, pages: [{ url: site.pages[0].url, html: "Maria Lopez, Broker/Owner. maria@brownstone.example.com" }] };
    const [r] = officeLeads(noPhone, { ...found, people: [{ ...found.people[0], email: "maria@brownstone.example.com" }] });
    expect(r.phone).toBeNull();
    expect(r.message).toBeNull();
  });
});

describe("recordLeads: one per company, across both lists, and stats that add up", () => {
  it("rejects a company already on either list, in this batch or saved before company keys existed, and leaves saved leads untouched", async () => {
    const { ctx, store } = await setup({ def: fakeAgent({ id: "office-outreach", team: "office" }) });
    // A lead saved before this change: no company_key, no score.
    await store.insertLeads([cold({ email: "info@acmerealty.com", company: "Acme Realty", source_url: "https://www.acmerealty.com/contact" })]);
    const before = structuredClone(store.leads);
    await store.addSuppression("@blocked.com", "asked to be removed");

    const n = await recordLeads(ctx, [
      { list: "office", name: "Jane Park", title: "Owner", email: "jane@acmerealty.com", source_platform: "web", source_url: "https://acmerealty.com/team" }, // same company, other list
      { list: "office", email: "a@blocked.com", source_platform: "web", source_url: "https://blocked.com" }, // suppressed
      { list: "office", email: "x@newco.com", email_status: "Domain OK", source_platform: "web", source_url: "https://newco.com" },
      { list: "office", email: "y@newco.com", source_platform: "web", source_url: "https://newco.com/about" }, // same company, same batch
      { list: "office", phone: "7185550142", email_status: "None", source_platform: "web", source_url: "https://callonly.com" },
      { list: "office", email: "z@nomail.example", email_status: "No Mail Server", source_platform: "web", source_url: "https://nomail.example" }, // saved, not usable
    ]);
    expect(n).toBe(3);
    expect(ctx.stats).toMatchObject({ leads_added: 3, duplicates_rejected: 2, contacts_suppressed: 1, usable_leads: 2 });
    expect(store.leads.slice(0, before.length)).toEqual(before); // the old lead is exactly as it was
    expect(store.leads.find((l) => l.email === "x@newco.com")?.company_key).toBe("newco.com");
  });
  it("an email the database already has counts as a duplicate, not a lead", async () => {
    const { ctx, store } = await setup({ def: fakeAgent({ id: "leads-web", team: "leads" }) });
    await store.insertLeads([cold({ email: "jo@shared.com", source_url: "paste:1", company: null })]);
    expect(await recordLeads(ctx, [cold({ email: "jo@shared.com", source_url: "paste:2", company: null })])).toBe(0);
    expect(ctx.stats).toMatchObject({ leads_added: 0, duplicates_rejected: 1 });
  });
});

describe("one company, even when two runs save it at the same moment", () => {
  /** Both runs pass the company check before either inserts: the race the database index decides. */
  function raceTheCheck(store: { companyKeysTaken: (k: string[]) => Promise<Set<string>> }, runs = 2) {
    const real = store.companyKeysTaken.bind(store);
    let waiting = 0;
    let open!: () => void;
    const gate = new Promise<void>((r) => (open = r));
    vi.spyOn(store, "companyKeysTaken").mockImplementation(async (keys) => {
      const seen = await real(keys);
      if (++waiting === runs) open();
      await gate;
      return seen;
    });
  }

  it("Web Leads and Office Prospects on the same business: one lead, the other run counts a rejected duplicate and doesn't fail", async () => {
    const web = await setup({ def: fakeAgent({ id: "leads-web", team: "leads" }) });
    const office = await setup({ def: fakeAgent({ id: "office-outreach", team: "office" }) });
    Object.assign(office.ctx, { store: web.store }); // one database
    raceTheCheck(web.store);
    const [a, b] = await Promise.all([
      recordLeads(web.ctx, [cold({ email: "jane@acmerealty.com", company: "Acme Realty", source_url: "https://acmerealty.com/team" })]),
      recordLeads(office.ctx, [{ list: "office", name: "Maria Lopez", title: "Broker", email: "maria@acmerealty.com", phone: "7045550100", company: "Acme Realty", source_platform: "web", source_url: "https://www.acmerealty.com/" }]),
    ]);
    expect(a + b).toBe(1);
    expect(web.store.leads.filter((l) => l.company_key === "acmerealty.com")).toHaveLength(1);
    expect((web.ctx.stats.duplicates_rejected ?? 0) + (office.ctx.stats.duplicates_rejected ?? 0)).toBe(1);
    expect((web.ctx.stats.leads_added ?? 0) + (office.ctx.stats.leads_added ?? 0)).toBe(1);
    expect((web.ctx.stats.usable_leads ?? 0) + (office.ctx.stats.usable_leads ?? 0)).toBe(1);
    // The loser listed nobody: only the saved lead's person got a "lead_listed" mark.
    expect(web.store.touches.filter((t) => t.kind === "lead_listed")).toHaveLength(1);
  });

  it("on compass.com: two different teams are two companies; the same team from both runs is one", async () => {
    const web = await setup({ def: fakeAgent({ id: "leads-web", team: "leads" }) });
    const office = await setup({ def: fakeAgent({ id: "office-outreach", team: "office" }) });
    Object.assign(office.ctx, { store: web.store });
    raceTheCheck(web.store);
    const team = (list: "cold" | "office", email: string, company: string, path: string): Lead => ({ list, email, company, source_platform: "web", source_url: `https://www.compass.com/agents/${path}/` });
    await Promise.all([
      recordLeads(web.ctx, [team("cold", "a@compass.com", "The Kantha Team", "kantha"), team("cold", "b@compass.com", "Aaron and Geoff at Compass", "aaron-geoff")]),
      recordLeads(office.ctx, [team("office", "c@compass.com", "The Kantha Team", "kantha-team")]),
    ]);
    expect(web.store.leads.map((l) => l.company_key).sort()).toEqual(["compass.com/aaron-and-geoff-at-compass", "compass.com/kantha-team"]);
    expect((web.ctx.stats.duplicates_rejected ?? 0) + (office.ctx.stats.duplicates_rejected ?? 0)).toBe(1);
  });

  it("a suppressed contact is still counted as suppressed, not as a duplicate, in a race", async () => {
    const web = await setup({ def: fakeAgent({ id: "leads-web", team: "leads" }) });
    await web.store.addSuppression("@acmerealty.com", "asked to be removed");
    expect(await recordLeads(web.ctx, [cold({ email: "jane@acmerealty.com", company: "Acme Realty" })])).toBe(0);
    expect(web.ctx.stats).toMatchObject({ contacts_suppressed: 1, duplicates_rejected: 0, leads_added: 0 });
  });
});

describe("a lead on the Sheet is Name, Message, Link (owner, 2026-10-29)", () => {
  const legacyCold = { list: "cold" as const, id: "11111111-1111-4111-8111-111111111111", created_at: "2026-10-27T14:00:00Z", name: null, email: "info@acmerealty.com", phone: "7045550100", company: "Acme Realty", business_type: "real estate offices", city: "Charlotte", region: "NC", country: "US", source_platform: "web" as const, source_url: "https://acmerealty.com/contact", notes: null };
  const legacyOffice = { ...legacyCold, id: "22222222-2222-4222-8222-222222222222", list: "office" as const, name: "Maria Lopez", title: "Broker/Owner", notes: "Twelve agents." };

  it("a lead saved before messages were written has nothing to send, so it isn't a row", () => {
    expect(leadRows(legacyCold, sources())).toEqual([]);
    expect(leadRows(legacyOffice, sources())).toEqual([]);
  });

  it("a lead with a message: the person, the message, and a new email with it already written", () => {
    const [w] = leadRows({ ...legacyCold, name: "Jane Park", title: "Owner", email_status: "Domain OK", score: 87, why: "Fourteen agents.", hook: "Second office.", message: "Subject: the new office\n\nJane, congrats on the new office. I built SwiftCard for teams like yours." }, sources());
    expect(w.tab).toBe(WEB_LEADS);
    expect(w.cells.name).toBe("Jane Park, Owner, Acme Realty");
    expect(w.cells.message).toContain("I built SwiftCard");
    expect(String(w.cells.link)).toContain("mailto:info@acmerealty.com?subject=the%20new%20office&body=Jane%2C%20congrats");
    const [o] = leadRows({ ...legacyOffice, message: "Hi Maria, quick one about your agents' cards." }, sources());
    expect(o.tab).toBe(OFFICE_PROSPECTS);
    expect(o.cells.name).toBe("Maria Lopez, Broker/Owner, Acme Realty");
    expect(agentHash(OFFICE_PROSPECTS, o.cells)).toMatch(/^[a-f0-9]{16}$/);
  });
});

describe("the workbook's layout", () => {
  // Any change to a tab spec (a column, a header note, a colour) changes this
  // hash, and the next Sheet sync then re-formats the whole workbook. Changed
  // on purpose 2026-10-29: every tab became Name, Message, Link (owner). Change
  // this pin only when that reset is intended.
  it("the spec hash is the Name, Message, Link one", () => {
    expect(specHash()).toBe("63df4615245f");
  });
});

