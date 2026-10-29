import { describe, expect, it } from "vitest";
import { generateKeyPairSync, createVerify } from "node:crypto";
import { LEADS, leadsFromSite, queryAt, BUSINESS_TYPES, US_CITIES } from "@/lib/crew/agents/leads";
import { robotsAllows, phonesIn, textOf } from "@/lib/crew/leads/fetch-page";
import { cleanEmails, recordLeads } from "@/lib/crew/leads/record";
import { isRestrictedRegion } from "@/lib/crew/leads/region";
import { leadRow, signedJwt } from "@/lib/crew/sources/sheets";
import { AGENTS } from "@/lib/crew/registry";
import { setup, fakeAgent } from "./crew-helpers";

// Phase 4, the lead list: public business emails only, source and date on
// every row, suppression and region flags enforced, robots.txt obeyed, and
// nothing ever sent.

describe("polite fetching", () => {
  it("obeys robots.txt for everyone and for us specifically", () => {
    const robots = "User-agent: *\nDisallow: /private\nAllow: /private/contact\n\nUser-agent: SwiftCardCrew\nDisallow: /\n";
    expect(robotsAllows(robots, "/contact")).toBe(false); // our own group wins: everything off limits
    const generic = "User-agent: *\nDisallow: /private\nAllow: /private/contact\n";
    expect(robotsAllows(generic, "/contact")).toBe(true);
    expect(robotsAllows(generic, "/private/x")).toBe(false);
    expect(robotsAllows(generic, "/private/contact")).toBe(true);
    expect(robotsAllows("", "/anything")).toBe(true);
  });
  it("extracts text, phones and mailto addresses", () => {
    expect(textOf("<p>Call <b>(704) 555-0100</b></p><script>x='a@b.com'</script>")).toBe("Call (704) 555-0100");
    expect(phonesIn("Call (704) 555-0100 or 704.555.0100")).toEqual(["7045550100"]);
  });
});

describe("emails", () => {
  it("prefers the site's own domain and drops system addresses", () => {
    expect(cleanEmails(["info@acmerealty.com sales@acmerealty.com noreply@acmerealty.com john@gmail.com x@wix.com"], "www.acmerealty.com")).toEqual(["info@acmerealty.com", "sales@acmerealty.com", "john@gmail.com"]);
  });
  it("turns a site into leads with source and company", () => {
    const leads = leadsFromSite({ name: "Acme Realty", website: "https://acmerealty.com", city: "Charlotte", state: "NC" }, [
      { url: "https://acmerealty.com/", html: "<title>Acme Realty</title><a href='/contact'>Contact</a>" },
      { url: "https://acmerealty.com/contact", html: "<a href='mailto:hello@acmerealty.com'>Email</a> (704) 555-0100" },
    ], "real estate offices");
    expect(leads).toEqual([expect.objectContaining({ email: "hello@acmerealty.com", company: "Acme Realty", source_url: "https://acmerealty.com/contact", phone: "7045550100", region: "NC", country: "US" })]);
  });
});

describe("recording", () => {
  it("skips suppressed addresses and domains, flags restricted regions, never counts listing as contact", async () => {
    const { ctx, store } = await setup({ def: fakeAgent({ id: "leads-web", team: "leads" }) });
    await store.addSuppression("@unsubscribed.com", "asked to be removed");
    await store.addSuppression("stop@acme.com", "unsubscribe");
    const n = await recordLeads(ctx, [
      { list: "cold", email: "a@unsubscribed.com", source_platform: "web", source_url: "https://unsubscribed.com" },
      { list: "cold", email: "STOP@acme.com", source_platform: "web", source_url: "https://acme.com" },
      { list: "cold", email: "hi@shop.de", source_platform: "web", source_url: "https://shop.de/kontakt" },
      { list: "cold", email: "hi@ok.com", source_platform: "web", source_url: "https://ok.com" },
      { list: "cold", email: "hi@ok.com", source_platform: "web", source_url: "https://ok.com/again" },
    ]);
    expect(n).toBe(2);
    expect(store.leads.find((l) => l.email === "hi@shop.de")!.region_restricted).toBe(true);
    expect(store.leads.every((l) => l.source_url && l.created_at)).toBe(true);
    expect((await store.unsyncedLeads("cold", 10)).map((l) => l.email)).toEqual(["hi@ok.com"]);
    expect(store.touches.every((t) => t.kind === "lead_listed")).toBe(true);
  });
  it("region flag by country, code or TLD", () => {
    expect(isRestrictedRegion({ country: "US", host: "a.com" })).toBe(false);
    expect(isRestrictedRegion({ country: "Germany" })).toBe(true);
    expect(isRestrictedRegion({ country: "CA" })).toBe(true);
    expect(isRestrictedRegion({ email: "x@firm.co.uk" })).toBe(true);
  });
});

describe("sheet", () => {
  it("signs a valid RS256 JWT for the service account", () => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const jwt = signedJwt({ client_email: "crew@x.iam.gserviceaccount.com", private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString() }, 1_700_000_000);
    const [h, c, sig] = jwt.split(".");
    expect(JSON.parse(Buffer.from(c, "base64url").toString())).toMatchObject({ iss: "crew@x.iam.gserviceaccount.com", scope: "https://www.googleapis.com/auth/spreadsheets", exp: 1_700_003_600 });
    const v = createVerify("RSA-SHA256");
    v.update(`${h}.${c}`);
    expect(v.verify(publicKey, Buffer.from(sig, "base64url"))).toBe(true);
  });
  it("scraped text can never become a spreadsheet formula", () => {
    const row = leadRow({ list: "cold", name: "=HYPERLINK(\"http://evil\")", email: "a@b.com", source_platform: "web", source_url: "https://b.com", created_at: "2026-10-20T00:00:00Z" });
    expect(row[1].startsWith("'=")).toBe(true);
  });
});

describe("registry", () => {
  it("Web Leads is the one lead agent (the others never saved a lead or wrote a message, removed 2026-10-29), and it rotates queries", () => {
    expect(LEADS.map((a) => a.id)).toEqual(["leads-web"]);
    for (const id of ["leads-reddit", "leads-facebook", "leads-alignable", "leads-quora", "leads-linkedin"]) expect(AGENTS.some((a) => a.id === id), id).toBe(false);
    expect(AGENTS.some((a) => a.id === "leads-manager")).toBe(false); // retired 2026-10-27: the Sheet replaced its room
    expect(queryAt(0)).toEqual({ type: BUSINESS_TYPES[0], city: US_CITIES[0] });
    expect(queryAt(BUSINESS_TYPES.length)).toEqual({ type: BUSINESS_TYPES[0], city: US_CITIES[1] });
    for (const a of LEADS) expect(a.approvalKind ?? null, a.id).toBeNull(); // they never draft a message
  });
});
