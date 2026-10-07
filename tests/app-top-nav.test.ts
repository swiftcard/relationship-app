import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// ONE TOP BAR FOR EVERY APP PAGE (owner, 2026-10-07: the app, the phone
// website and the computer website have to line up).
//
// Dashboard, Contacts, Links, Grow and Settings each used to build their own
// copy of the bar, and the copies drifted: Contacts switched at sm: (both navs
// at 640–767px), Grow had no Admin, only the dashboard had Site, and four of
// them added a "← Dashboard" beside the logo and the Dashboard tab. These pin
// the shared component so a sixth copy, or one of those, cannot come back.

const read = (p: string) => readFileSync(p, "utf8");
const stripComments = (s: string) => s.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\/[^\n]*/g, "");

const PAGES = [
  "src/app/dashboard/page.tsx",
  "src/app/contacts/page.tsx",
  "src/app/share/page.tsx",
  "src/app/grow/page.tsx",
  "src/app/settings/flows/page.tsx",
];

describe("every app page uses the shared top bar", () => {
  for (const p of PAGES) {
    it(p, () => {
      const src = read(p);
      expect(src, "the shared bar is missing").toMatch(/<AppTopNav\b/);
      // The only hand-built bars left are the dashboard's two pre-card screens
      // (no card yet / pick a card), which carry Sign out instead of tabs.
      const ownBars = (src.match(/<nav className="sc-app fixed top-0\.5/g) ?? []).length;
      expect(ownBars, "a page builds its own top bar again").toBe(p.endsWith("dashboard/page.tsx") ? 2 : 0);
      expect(stripComments(src), "a \"← Dashboard\" is back beside the Dashboard tab").not.toMatch(/←\s*(My )?Dashboard/);
      // Every page hands the phone tab bar the same Admin and Site answers it
      // gives its own bar, so the two never disagree.
      expect(src).toMatch(/<MobileNavGate showAdmin=\{[^}]+\} showSite=\{showSite\}|<MobileNavGate showAdmin=\{canSeeOfficeAdmin\} showSite=\{isAdmin\}/);
    });
  }
});

describe("the shared bar", () => {
  const nav = read("src/components/AppTopNav.tsx");

  it("switches at md, where MobileNav's tab bar takes over — never sm", () => {
    expect(nav).toMatch(/className="hidden md:flex items-center gap-0\.5"/);
    expect(nav).not.toMatch(/hidden sm:flex/);
    expect(read("src/components/MobileNav.tsx")).toMatch(/md:hidden/);
  });

  it("carries the same tabs as the phone's tab bar, in the same order", () => {
    const order = ["nav-dashboard", "nav-contacts", "nav-links", "nav-admin", '"/admin"'].map((t) => nav.indexOf(t));
    expect(order.every((i) => i > -1), "a tab is missing").toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("keeps every tour anchor a literal, so the tour can find it", () => {
    for (const a of ["nav-dashboard", "nav-contacts", "nav-links", "nav-admin", "nav-settings", "nav-grow"]) {
      expect(nav).toContain(`data-tour="${a}"`);
    }
  });
});
