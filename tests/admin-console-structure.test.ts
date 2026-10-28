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

describe("Referrals and Retention are tabs of Company Analytics, not pages", () => {
  // Owner, 2026-10-27: "Why is there one page for referrals and one page for
  // retention? That doesn't make sense."
  const nav = read("src/app/admin/AdminNav.tsx");
  const tabs = read("src/app/admin/analytics/tabs.ts");

  it("the nav has no top-level Referrals or Retention", () => {
    expect(nav).not.toContain('href: "/admin/referrals"');
    expect(nav).not.toContain('href: "/admin/retention"');
  });

  it("Company Analytics has its seven tabs, in reading order", () => {
    const keys = [...tabs.matchAll(/key: "([a-z]+)"/g)].map((m) => m[1]);
    expect(keys).toEqual(["growth", "revenue", "funnel", "engagement", "retention", "referrals", "data"]);
  });

  it("the old addresses redirect into the tabs, behind the admin check", () => {
    for (const [file, tab] of [["src/app/admin/retention/page.tsx", "retention"], ["src/app/admin/referrals/page.tsx", "referrals"]] as const) {
      const src = read(file);
      expect(src).toContain("if (!(await requireAdmin())) notFound();");
      expect(src).toContain(`redirect("/admin/analytics?tab=${tab}")`);
      expect(src.indexOf("requireAdmin()")).toBeLessThan(src.indexOf("redirect("));
    }
  });

  it("the Company Analytics page checks the admin itself before reading retention", () => {
    const page = read("src/app/admin/analytics/page.tsx");
    expect(page.indexOf("if (!(await requireAdmin())) notFound();")).toBeGreaterThan(-1);
    expect(page.indexOf("requireAdmin()")).toBeLessThan(page.indexOf("retentionFunnel("));
  });

  it("reasons are shown in the words the person picked, not as ids", () => {
    const tab = read("src/app/admin/analytics/RetentionTab.tsx");
    expect(tab).toContain("reasonText(r.reason, r.plan)");
    expect(tab).toContain("reasonText(r.reason)");
  });
});

describe("Users › Closed accounts: who left, and why in their words", () => {
  // Owner, 2026-10-27: "we should also have Closed Accounts so we know which
  // users close their accounts. When we click on that user, it'll tell us why
  // they closed the account: all the description they put in."
  const users = read("src/app/admin/users/UsersClient.tsx");
  const list = read("src/app/api/admin/users/route.ts");
  const one = read("src/app/api/admin/users/[id]/route.ts");
  const detail = read("src/app/admin/users/[id]/UserDetailClient.tsx");

  it("the Users page has All, Free, Pro, Office and Closed accounts", () => {
    // Tab entries carry a count; the Create card form's fields don't.
    const keys = [...users.matchAll(/\{ key: "([a-z]+)", label: "([^"]+)", count:/g)].map((m) => `${m[1]}:${m[2]}`);
    expect(keys).toEqual(["all:All", "free:Free", "pro:Pro", "office:Office", "closed:Closed accounts"]);
  });

  it("the list API returns closed accounts with the reason in words and the plan they had", () => {
    expect(list).toContain("reason_text: reasonText(del.reason, plan)");
    expect(list).toContain("const plan = del.plan ??");
    expect(list).toContain("return NextResponse.json({ users, closed });");
    // QA's throwaway accounts are not customers.
    expect(list).toContain("QA_EMAIL_DOMAIN");
  });

  it("a user's page says why they left, or nearly did", () => {
    expect(one).toContain("saved_by_text: savedByText(ret.savedBy)");
    // Every earlier answer, each in words, not only the last one.
    expect(one).toContain("reason_text: reasonText(s.reason, s.plan)");
    expect(detail).toContain("{leaving && <LeavingCallout leaving={leaving} />}");
  });

  it("one list per page: a single plan dropdown per person, at every width", () => {
    expect(users.split("aria-label={`Change ${who}'s plan`}").length - 1).toBe(1);
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
