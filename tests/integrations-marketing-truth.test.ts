import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { INTEGRATIONS, integrationNames } from "@/components/site/integration-brands";

// The marketing site may only advertise integrations that actually work.
//
// This exists because the site drifted: GoHighLevel and Pipedrive shipped and
// the public pages kept saying "Zapier, Google Contacts and HubSpot" for weeks,
// across five separately-maintained copies of the same list. The reverse is the
// worse failure though — advertising a CRM we don't really sync to is a promise
// to a paying customer we can't keep. Both directions are pinned here.

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8");

const leadsRoute = read("src/app/api/leads/route.ts");
// Every contact path (share form, manual add / card scan, edits) fans out
// through one module, so a provider is "synced" when that module runs it AND
// the capture route calls the module.
const crmSync = read("src/lib/crm-sync.ts");
const capturesToAll = () => expect(leadsRoute, "lead capture no longer runs the CRM fan-out").toContain("syncLeadToAllCrms(");
const settingsUi = read("src/components/IntegrationsSettings.tsx");
// syncLeadToAllCrms runs every provider registered in CRM_PROVIDERS, so a
// provider is "synced" when it is registered there.

/**
 * What has to be TRUE in the product for each name we put on the website.
 * Adding a brand to the marketing list without wiring it up fails here.
 */
const PROOF: Record<string, () => void> = {
  GoHighLevel: () => {
    expect(read("src/lib/sync-highlevel.ts")).toBeTruthy();
    capturesToAll();
    expect(crmSync, "GoHighLevel is advertised but never synced on lead capture").toContain("highlevel: highlevelProvider");
    expect(settingsUi, "GoHighLevel has no card in Settings → Integrations").toContain('title="GoHighLevel"');
  },
  Pipedrive: () => {
    expect(read("src/lib/sync-pipedrive.ts")).toBeTruthy();
    capturesToAll();
    expect(crmSync, "Pipedrive is advertised but never synced on lead capture").toContain("pipedrive: pipedriveProvider");
    expect(settingsUi, "Pipedrive has no card in Settings → Integrations").toContain('title="Pipedrive"');
  },
  Salesforce: () => {
    expect(read("src/lib/sync-salesforce.ts")).toBeTruthy();
    capturesToAll();
    expect(crmSync, "Salesforce is advertised but never synced on lead capture").toContain("salesforce: salesforceProvider");
    expect(settingsUi, "Salesforce has no card in Settings → Integrations").toContain('name="Salesforce"');
  },
  HubSpot: () => {
    expect(read("src/lib/sync-hubspot.ts")).toBeTruthy();
    capturesToAll();
    expect(crmSync, "HubSpot is advertised but never synced on lead capture").toContain("hubspot: hubspotProvider");
    expect(settingsUi, "HubSpot has no card in Settings → Integrations").toContain('title="HubSpot"');
  },
  "Google Contacts": () => {
    expect(read("src/lib/sync-google.ts")).toBeTruthy();
    capturesToAll();
    expect(crmSync, "Google Contacts is advertised but never synced on lead capture").toContain("google: googleProvider");
    expect(settingsUi, "Google Contacts has no card in Settings → Integrations").toContain('name="Google Contacts"');
  },
  Zapier: () => {
    // Zapier is a webhook rather than a sync module — the lead route has to fire it.
    expect(leadsRoute, "Zapier is advertised but no webhook is fired").toContain("sendLeadToZapier(");
    expect(crmSync, "the Zapier sender no longer reads the webhook").toContain("zapier_webhook_url");
  },
  "CSV export": () => {
    expect(read("src/app/api/leads/export/route.ts")).toBeTruthy();
  },
};

describe("every integration the website advertises actually exists", () => {
  for (const brand of INTEGRATIONS) {
    it(`${brand.name} is real, connectable and synced`, () => {
      const proof = PROOF[brand.name];
      expect(proof, `No proof defined for "${brand.name}". Add one — do not delete this check.`).toBeTypeOf("function");
      proof();
    });
  }

  it("every brand carries the copy the pages need", () => {
    for (const b of INTEGRATIONS) {
      expect(b.short.length, `${b.name}: short label missing`).toBeGreaterThan(0);
      // Short labels sit in a narrow two-column grid on the product page.
      expect(b.short.length, `${b.name}: short label too long for the grid`).toBeLessThanOrEqual(20);
      expect(b.blurb.length, `${b.name}: blurb missing`).toBeGreaterThan(40);
    }
  });
});

describe("the CRMs our users run on come first", () => {
  it("leads with GoHighLevel and Pipedrive", () => {
    // Owner decision — these are the two most commonly used, so they head the
    // logo strip and the product page grid.
    expect(INTEGRATIONS[0].name).toBe("GoHighLevel");
    expect(INTEGRATIONS[1].name).toBe("Pipedrive");
  });
});

describe("no public surface keeps its own copy of the list", () => {
  // The drift was caused by hand-maintained duplicates. These pages must render
  // from the canonical array, so adding an integration updates them for free.
  it("the homepage logo band renders from the canonical list", () => {
    const src = read("src/components/site/IntegrationLogos.tsx");
    expect(src).toContain("INTEGRATIONS");
    expect(src, "logo band hardcodes a brand name again").not.toMatch(/name:\s*"(Zapier|HubSpot|Pipedrive|GoHighLevel)"/);
  });

  it("the integrations product page renders from the canonical list", () => {
    const src = read("src/app/products/[slug]/page.tsx");
    expect(src).toContain("INTEGRATIONS.map");
    expect(src, "product page rebuilt its own feature list").not.toMatch(/\{\s*t:\s*"Zapier"/);
  });

  it("running copy that names integrations includes the new CRMs", () => {
    // Prose can't be generated, but it must not silently fall back to the old
    // three. Any sentence listing tools has to mention the two that shipped.
    const surfaces = [
      "src/components/site/SiteNav.tsx",
      "src/lib/plan-content.ts",
      "src/app/api/ai/help/route.ts",
      "src/app/api/ai/sales/route.ts",
      // The legal pages enumerate the integrations too, and were missed on the
      // first pass precisely because nobody thinks of Terms as marketing copy.
      // They are the surfaces where being out of date actually matters most.
      "src/app/terms/page.tsx",
      "src/app/privacy/page.tsx",
      "src/lib/tour-steps.ts",
    ];
    for (const path of surfaces) {
      const src = read(path);
      const mentionsOld = /Zapier|HubSpot|Google Contacts/.test(src);
      if (!mentionsOld) continue;
      expect(src, `${path} lists integrations but never mentions GoHighLevel`).toMatch(/GoHighLevel/);
      expect(src, `${path} lists integrations but never mentions Pipedrive`).toMatch(/Pipedrive/);
    }
  });
});

describe("integrationNames()", () => {
  it("reads as a sentence and covers the whole list", () => {
    const s = integrationNames();
    expect(s).toContain("GoHighLevel");
    expect(s).toContain("CSV export");
    expect(s).toMatch(/ and CSV export$/);
  });
});
