import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// ── The site admin's structure, pinned (owner, 2026-10-27) ──────────────────
//
// "I don't like how it's dark. I want it to be light." and "everything is all
// over the place … I really just want everything to be very organized and also
// visually organized." The layout facts are measured in
// tests/render/admin-console.test.ts; this pins the decisions that a quiet
// edit could undo without any layout changing first: the console is light on
// every device, every section lives in one grouped nav, and the pieces every
// page is built from don't grow raw colours.

const read = (p: string) => readFileSync(p, "utf8");

describe("the site admin is always light", () => {
  it("the shell joins the app's theme system and holds the light theme while open", () => {
    const shell = read("src/app/admin/AdminShell.tsx");
    expect(shell).toMatch(/className="sc-app sc-admin /);
    expect(shell).toContain("<ForceLightTheme />");
    expect(read("src/app/admin/layout.tsx")).toContain('import "./admin.css";');
  });

  it("the boot script forces light before first paint on /admin, and only there", () => {
    const boot = read("src/app/layout.tsx");
    expect(boot).toContain("location.pathname.indexOf('/admin')===0");
    // "Starts with" — /office/admin keeps the person's own theme.
    expect(boot).not.toContain("indexOf('/office/admin')");
  });
});

describe("one grouped navigation", () => {
  const nav = read("src/app/admin/AdminNav.tsx");

  it("groups the sections into Business and Tools", () => {
    expect(nav).toContain('title: "Business"');
    expect(nav).toContain('title: "Tools"');
    for (const label of ["Overview", "Users", "Company Analytics", "Website", "Marketing", "Agents", "Sandbox"]) {
      expect(nav, label).toContain(`label: "${label}"`);
    }
  });

  it("the phone menu works before hydration (a <details>, not a JS toggle)", () => {
    expect(nav).toMatch(/<details ref=\{menu\} className="adm-menu">/);
    // The native shell keeps the bar below the status bar with the Office fix.
    expect(nav).toContain("sc-office-header");
  });
});

describe("the building blocks stay on the semantic palette", () => {
  it("no raw hex colour in any _ui component (they live in admin.css)", () => {
    const dir = "src/app/admin/_ui";
    for (const f of readdirSync(dir).filter((n) => n.endsWith(".tsx") || n.endsWith(".ts"))) {
      expect(read(join(dir, f)), `${f} carries a raw hex colour`).not.toMatch(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/);
    }
  });

  it("the chart palette is defined once, in admin.css", () => {
    const css = read("src/app/admin/admin.css");
    for (const token of ["--adm-series-1", "--adm-series-2", "--adm-plan-free", "--adm-plan-pro", "--adm-plan-office"]) {
      expect(css).toContain(`${token}:`);
    }
  });
});
