import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";

// ── Audit round 26 (2026-10-18): the Office console says what really
//    happened ──────────────────────────────────────────────────────────────
//
// F-OFFICE-02  A failed Contacts load read "No contacts yet" and hid Export.
// F-OFFICE-05  Branding save showed "Something went wrong" for a lapsed plan,
//              an ended session and a real failure alike; inputs uncapped.
// F-OFFICE-06  A data failure on a teammate's page or their analytics threw
//              away the console for the site-wide error screen.

const read = (p: string) => readFileSync(p, "utf8");

describe("F-OFFICE-02: a failed load is never an empty office", () => {
  const page = read("src/app/office/admin/leads/page.tsx");

  it("the load failure is kept apart from an empty result and shown as an error", () => {
    expect(page).not.toMatch(/getOfficeLeads\(officeId\)\.catch\(\(\) => \(\{ leads: \[\], total: 0/);
    expect(page).toContain("if (!page) {");
    expect(page).toContain("Couldn&apos;t load your team&apos;s contacts right now — try refreshing in a moment.");
  });
});

describe("F-OFFICE-05: branding says why it couldn't save, and holds what a card prints", () => {
  const branding = read("src/components/OfficeBranding.tsx");

  it("shows the server's message, and a session that ended says so", () => {
    expect(branding).toContain('"Your session ended — sign in again to save."');
    expect(branding).toContain('{errMsg || "Something went wrong — please try again."}');
  });

  it("caps each company field at the length the card prints", () => {
    for (const k of ["company", "website", "phone", "fax"]) expect(branding).toContain(`maxLength={CARD_FIELD_MAX.${k}}`);
    expect(branding.match(/value=\{address\.\w+ \?\? ""\} maxLength=\{\d+\}/g)?.length).toBe(5);
  });
});

describe("F-OFFICE-06: an Office page that fails stays inside the console", () => {
  it("the console has its own error boundary, which reports and offers a retry", () => {
    expect(existsSync("src/app/office/admin/error.tsx")).toBe(true);
    const boundary = read("src/app/office/admin/error.tsx");
    expect(boundary.startsWith('"use client";')).toBe(true);
    expect(boundary).toContain('context: "react.boundary.office"');
    expect(boundary).toContain("isChunkLoadError(error)");
    expect(boundary).toMatch(/onClick=\{\(\) => \(staleDeploy \? location\.reload\(\) : reset\(\)\)\}/);
  });
});
