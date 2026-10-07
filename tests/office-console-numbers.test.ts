import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MEMBER_STATUS_LABEL } from "@/lib/member-status";
import { officeNotificationPath } from "@/lib/office-notification-links";
import { teamRecapCopy } from "@/lib/weekly-recap";
import { noFollowUpCopy } from "@/lib/team-alerts";

// ── The Office console's numbers: one source, one meaning (owner, 2026-10-06) ─
//
// "If one sub-user has 30 card views, that shows properly on the admin page."
// Before this, the Team tab ran its own head counts that folded Swift Links
// views into "Card views" over the UTC calendar month, the Analytics table
// kept card views apart, and the person/card pages used a rolling 720 hours —
// one person, three different view counts, none equal to the "SwiftCard views"
// on their own dashboard. And the console called every contact a "lead".

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8").replace(/\r/g, "");
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const fnBody = (src: string, signature: string) => {
  const start = src.indexOf(signature);
  expect(start, signature).toBeGreaterThan(-1);
  return src.slice(start, src.indexOf("\nexport ", start + 1));
};

describe("every console number goes through the Analytics tab's function", () => {
  const lib = code("src/lib/office-analytics.ts");

  it("the Team tab (all time), a person's page and a card's page", () => {
    for (const sig of [
      "export async function getOfficeAnalytics(",
      "export async function getMemberDetail(",
      "export async function getCardStats(",
    ]) {
      const body = fnBody(lib, sig);
      expect(body, sig).toContain("getOfficeEmployeeMetricsForTeam(");
      expect(body, sig).toContain("ALL_TIME_SINCE");
      // No private head counts beside it.
      expect(body, sig).not.toMatch(/from\("card_views"\)/);
    }
  });

  it("the old head counts that mixed Swift Links into card views are gone", () => {
    expect(lib).not.toMatch(/async function countViews\(/);
    expect(lib).not.toMatch(/async function countViewsSince\(/);
    expect(lib).not.toContain("views30");
  });

  it("the Team tab takes its tiles from that sum, not from monthly counts", () => {
    const team = code("src/lib/office-team.ts");
    expect(team).toContain("const analytics = await getOfficeAnalytics(officeId, ownerId);");
    expect(team).toContain("totals: analytics.totals,");
    expect(team).not.toContain("monthStartIso");
    expect(team).not.toMatch(/leadsThisMonth|viewsThisMonth/);
    const page = code("src/app/office/admin/page.tsx");
    for (const t of ["totals.views", "totals.swiftlinkViews", "totals.leads", "totals.contactsSaved"]) {
      expect(page).toContain(`value={${t}}`);
    }
  });

  it("card views and Swift Link views are never added together into one tile", () => {
    for (const f of [
      "src/app/office/admin/analytics/page.tsx",
      "src/app/office/admin/analytics/[id]/page.tsx",
      "src/app/office/admin/page.tsx",
      "src/app/office/admin/team/[id]/page.tsx",
      "src/app/office/admin/cards/[id]/page.tsx",
    ]) {
      const c = code(f);
      expect(c, f).not.toContain('label="Total views"');
      expect(c, f).not.toMatch(/StatTile label="Card views" value=\{[^}]*swiftlinkViews/);
    }
    const a = code("src/app/office/admin/analytics/page.tsx");
    expect(a).toContain("const totalViews = employees.reduce((s, e) => s + e.views, 0);");
  });

  it("a person's displayed card is the same one on every load", () => {
    const team = fnBody(lib, "async function getOfficeTeam(");
    expect(team).toContain('.order("is_office_card", { ascending: false, nullsFirst: false })');
    expect(team).toContain('.order("created_at", { ascending: true })');
  });

  it("the milestone's \"card views\" count the card alone, like the tile it opens", () => {
    const r = code("src/app/api/push/recap/route.ts");
    expect(r).toContain('admin.from("card_views").select("id", { count: "exact", head: true }).in("username", slugs),');
    expect(officeNotificationPath("team_milestone")).toBe("/office/admin");
  });
});

describe("the same names everywhere in the console", () => {
  const FOUR = ["Card views", "Swift Link views", "Contacts captured", "Contact downloads"];

  it("Team tab, drawer, person page, card page, Analytics and the CSV", () => {
    for (const f of [
      "src/app/office/admin/page.tsx",
      "src/components/office/TeamList.tsx",
      "src/app/office/admin/team/[id]/page.tsx",
      "src/app/office/admin/cards/[id]/page.tsx",
      "src/app/office/admin/analytics/page.tsx",
      "src/app/office/admin/analytics/[id]/page.tsx",
      "src/app/office/admin/analytics/EmployeeAnalyticsTable.tsx",
      "src/lib/office-analytics-csv.ts",
      "src/components/site/TeamsDashboard.tsx",
    ]) {
      const c = read(f);
      for (const label of FOUR) expect(c, `${f}: ${label}`).toContain(label);
    }
  });

  it("one name for scans and for an offline card", () => {
    for (const f of [
      "src/app/office/admin/analytics/page.tsx",
      "src/app/office/admin/analytics/[id]/page.tsx",
      "src/app/office/admin/analytics/EmployeeAnalyticsTable.tsx",
      "src/lib/office-analytics-csv.ts",
    ]) {
      expect(read(f), f).toContain("QR & NFC scans");
      expect(read(f), f).not.toMatch(/Card\/QR scans|QR\/NFC scans|label: "Scans"|label="Scans"/);
    }
    expect(MEMBER_STATUS_LABEL.card_deactivated).toBe("Card offline");
    expect(read("src/app/office/admin/team/[id]/page.tsx")).not.toContain("Turned off");
  });

  it("an idle teammate is not told they never started", () => {
    expect(MEMBER_STATUS_LABEL.idle).toBe("No recent activity");
  });
});

describe("contacts, not leads — anywhere an admin reads it", () => {
  // Visible text only: JSX text, string literals and template literals. Code
  // names (leads, getOfficeLeads, /office/admin/leads) are not on screen.
  const visible = (src: string) =>
    [
      ...src.matchAll(/>([^<>{}]+)</g),
      ...src.matchAll(/"([^"\n]*)"/g),
      ...src.matchAll(/`([^`]*)`/g),
    ]
      .map((m) => m[1])
      // Not shown to anyone: identifiers and tour anchors ("admin-nav-leads"),
      // paths, imports, and the code between two generics (`<Row[]>(leads); … <`).
      .filter((t) => !/^[@./]|^[\w-]+$|[;=]|office\/admin\/leads|api\/office\/leads|lead-followup|office-leads/.test(t.trim()));

  for (const f of [
    "src/app/office/admin/OfficeAdminNav.tsx",
    "src/app/office/admin/page.tsx",
    "src/app/office/admin/leads/page.tsx",
    "src/app/office/admin/leads/LeadsTable.tsx",
    "src/app/office/admin/analytics/page.tsx",
    "src/app/office/admin/analytics/[id]/page.tsx",
    "src/app/office/admin/analytics/EmployeeAnalyticsTable.tsx",
    "src/app/office/admin/team/[id]/page.tsx",
    "src/app/office/admin/cards/[id]/page.tsx",
    "src/components/office/TeamList.tsx",
    "src/components/office/ContactDrawer.tsx",
    "src/lib/office-contact-timeline.ts",
    "src/components/office/TeamActions.tsx",
    "src/components/office/OfficeNotificationBell.tsx",
    "src/lib/admin-tour-steps.ts",
    "src/lib/office-analytics-csv.ts",
  ]) {
    it(f, () => {
      const hits = visible(code(f)).filter((t) => /\blead(s)?\b/i.test(t));
      expect(hits, f).toEqual([]);
    });
  }

  it("the tab is Contacts; the old URL still works", () => {
    const nav = read("src/app/office/admin/OfficeAdminNav.tsx");
    expect(nav).toContain('{ href: "/office/admin/leads", label: "Contacts", tour: "admin-nav-leads" }');
  });

  it("team alerts say contacts", () => {
    expect(teamRecapCopy({ views: 42, leads: 5, quiet: 0 })!.title).toBe("Team week: 42 views · 5 new contacts");
    expect(noFollowUpCopy([{ name: "Mia", n: 1 }]).title).toBe("1 team contact has no follow-up yet");
    const alerts = read("src/lib/team-alerts.ts");
    expect(alerts).toContain("title: `First contact for ${first} 🎉`,");
    const recap = read("src/app/api/push/recap/route.ts");
    expect(recap).toContain('kind === "leads" ? "contacts" : "card views"');
  });

  it("the help assistant uses the tab's real name", () => {
    expect(read("src/components/HelpWidget.tsx")).toContain("Team, Analytics, Contacts, and Branding tabs");
    expect(read("src/lib/knowledge/personas.ts")).not.toContain("Leads, and Branding");
    expect(read("src/lib/knowledge/docs/office.ts")).not.toMatch(/Status dropdown|New, Contacted, Closed/);
  });
});
