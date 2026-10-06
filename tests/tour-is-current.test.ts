import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { TOUR_STEPS, buildTourSteps } from "@/lib/tour-steps";
import { ADMIN_TOUR_STEPS, adminTourSteps } from "@/lib/admin-tour-steps";

// ── A tour that describes a product we no longer ship ────────────────────────
//
// Owner, 2026-09-11: "I need you to run through every account type and every
// plan to make sure the Take a Tour is corrected. For example, in the admin
// account of the office plan, the Take a Tour needs to be updated. It doesn't
// show the new additions we did in branding."
//
// He was right, and the reason it rotted is that nothing connected a tour step
// to the screen it points at: Branding grew a whole second half (the Swift
// Links tab) and the tour went on describing only the card. These are the
// checks that make that impossible to repeat — every anchor has to exist, every
// path has to be a real route, and the surfaces we have shipped have to be
// visited by the tour that belongs to them.

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8");

/**
 * Every data-tour value the app can render.
 *
 * Two shapes: the literal attribute, and the nav config lists that feed it
 * (`tour: "nav-contacts"` → `data-tour={tour}`), which a plain attribute scan
 * would miss and call broken.
 */
function anchorsInApp(): Set<string> {
  // A Node walk, not `grep -r`. execSync goes through cmd.exe on Windows,
  // which has no grep and reads the `|` inside the pattern as a pipe — so this
  // whole file threw on the owner's machine ("'tour:' is not recognized") while
  // CI stayed green, which is the worst way for a guard to fail.
  const found = new Set<string>();
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else
        for (const m of readFileSync(full, "utf8").matchAll(/(?:data-tour=|tour: )"([a-z0-9-]+)"/g))
          found.add(m[1]);
    }
  };
  walk(join(root, "src"));
  return found;
}

const ALL_STEPS = [
  ...TOUR_STEPS.map((s) => ({ ...s, tour: "main" })),
  ...ADMIN_TOUR_STEPS.map((s) => ({ ...s, tour: "admin" })),
];

describe("every tour step points at something that exists", () => {
  const present = anchorsInApp();

  for (const step of ALL_STEPS) {
    if (!step.anchor) continue;
    it(`${step.tour}: "${step.id}" → data-tour="${step.anchor}"`, () => {
      expect(present.has(step.anchor!), `nothing in src/ renders data-tour="${step.anchor}"`).toBe(true);
    });
  }

  it("every step lands on a route that exists", () => {
    for (const step of ALL_STEPS) {
      const clean = step.path.split(/[?#]/)[0].replace(/\/$/, "");
      const candidates = [
        `src/app${clean}/page.tsx`,
        `src/app${clean}/page.ts`,
      ];
      expect(
        candidates.some((c) => existsSync(join(root, c))),
        `${step.tour} step "${step.id}" points at ${step.path}, which has no page`,
      ).toBe(true);
    }
  });

  it("no step id is used twice — the engine indexes by position and resumes by id", () => {
    for (const list of [TOUR_STEPS, ADMIN_TOUR_STEPS]) {
      const ids = list.map((s) => s.id);
      expect(new Set(ids).size, `duplicate step id in ${ids.join(", ")}`).toBe(ids.length);
    }
  });
});

describe("the Office admin tour covers what Branding actually does now", () => {
  const ids = ADMIN_TOUR_STEPS.map((s) => s.id);

  it("names both halves of Branding", () => {
    expect(ids).toContain("admin-branding-tabs");
    expect(ids).toContain("admin-branding-links");
    const tabs = ADMIN_TOUR_STEPS.find((s) => s.id === "admin-branding-tabs")!;
    expect(tabs.body).toMatch(/Swift Links/);
  });

  it("opens the Links tab before pointing at it", () => {
    // The Links half only renders when its tab is on, so the step has to ask
    // the engine to open it — the same `section` mechanism Settings uses.
    const links = ADMIN_TOUR_STEPS.find((s) => s.id === "admin-branding-links")!;
    expect(links.section).toBe("links");
    // ...and the component has to honour it.
    expect(read("src/components/OfficeBranding.tsx")).toMatch(/hashchange/);
    expect(read("src/components/OfficeBranding.tsx")).toMatch(/h === "links" \|\| h === "card"/);
  });

  it("describes the company Instagram and company links, which the tab really has", () => {
    const links = ADMIN_TOUR_STEPS.find((s) => s.id === "admin-branding-links")!;
    expect(links.body).toMatch(/Instagram/i);
    expect(links.body).toMatch(/bio/i);
    // And it promises the thing the code actually does: a teammate's own entries
    // are kept, not deleted (the office TAKES A SLOT — see OfficeLinksBranding).
    expect(links.body).toMatch(/theirs are kept|stays their own/i);
  });

  it("does not promise a Leads status an admin can no longer set", () => {
    const leads = ADMIN_TOUR_STEPS.find((s) => s.id === "admin-leads-table")!;
    expect(leads.body).not.toMatch(/contacted|closed|not interested|status/i);
  });
});

describe("the Office admin tour is built for the role taking it", () => {
  it("an owner/admin gets every step", () => {
    expect(adminTourSteps({ canBrand: true, canInvite: true })).toEqual(ADMIN_TOUR_STEPS);
  });

  it("a role without the Branding tab is never sent to it or told about it", () => {
    // OfficeAdminNav hides Branding without canBrand and the page redirects.
    const steps = adminTourSteps({ canBrand: false, canInvite: true });
    expect(steps.some((s) => s.path.startsWith("/office/admin/branding"))).toBe(false);
    expect(steps.some((s) => s.anchor?.includes("branding"))).toBe(false);
    for (const s of steps) expect(`${s.title} ${s.body}`, s.id).not.toMatch(/branding/i);
    expect(steps.at(-1)!.id).toBe("admin-finish");
  });

  it("a role that can't invite is not pointed at an invite button it doesn't have", () => {
    const steps = adminTourSteps({ canBrand: true, canInvite: false });
    expect(steps.map((s) => s.id)).not.toContain("admin-add-member");
  });

  it("nothing in the admin tour ranks teammates against each other", () => {
    for (const s of ADMIN_TOUR_STEPS) {
      expect(`${s.title} ${s.body}`, s.id).not.toMatch(/who's actually|cards are landing|numbers that matter|perform|top |most views|led with/i);
    }
  });
});

describe("the personal tour is built for the plan it is running on", () => {
  const tiers = [
    { tier: "free" as const, isOfficeMember: false },
    { tier: "pro" as const, isOfficeMember: false },
    { tier: "office" as const, isOfficeMember: false },
    { tier: "office" as const, isOfficeMember: true },
  ];

  for (const ctx of tiers) {
    const label = `${ctx.tier}${ctx.isOfficeMember ? " member" : ""}`;

    it(`${label}: every step it builds still points at a real anchor`, () => {
      const present = anchorsInApp();
      for (const step of buildTourSteps({ ...ctx, hasCards: true, isNative: false })) {
        if (step.anchor) expect(present.has(step.anchor), `${label}: ${step.id} → ${step.anchor}`).toBe(true);
      }
    });

    it(`${label}: builds a tour that actually has steps`, () => {
      expect(buildTourSteps({ ...ctx, hasCards: true, isNative: false }).length).toBeGreaterThan(3);
    });
  }

  it("an office member is never shown the admin console step", () => {
    const member = buildTourSteps({ tier: "office", isOfficeMember: true, hasCards: true, isNative: false });
    expect(member.map((s) => s.id)).not.toContain("nav-admin");
  });

  it("an account with no cards is not walked past eleven things it does not have", () => {
    const empty = buildTourSteps({ tier: "free", isOfficeMember: false, hasCards: false, isNative: false });
    const full = buildTourSteps({ tier: "free", isOfficeMember: false, hasCards: true, isNative: false });
    expect(empty.length).toBeLessThan(full.length);
  });
});
