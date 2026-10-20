import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { grantMonthWarning, planChangeWarning, takeOfflineWarning } from "@/lib/admin-confirm";

// ── Audit round 3 (2026-10-15): admin safety ────────────────────────────────
//
// SEC-06     The site admin (export every user, email all of them, change any
//            plan, merge code to production) was gated by the admin email. An
//            authenticator-app second step was added, then removed at the
//            owner's request (2026-10-19): the gate is the admin email again.
// F-ADMIN-01 The Users list plan dropdown changed plans on the first click and
//            ignored every refusal.
// F-ADMIN-02 The user page's plan buttons, "Grant 1 month of Pro" and "Take
//            offline" did the same.

let session: { user: { id: string; email: string } | null } = { user: null };
vi.mock("@/lib/supabase-server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: session.user } }),
    },
  }),
}));

process.env.ADMIN_EMAILS = "owner@swiftcard.me";

beforeEach(() => {
  session = { user: null };
});

describe("SEC-06: the admin gate is the admin email, with no second step", () => {
  it("signed out, not an admin, and the admin", async () => {
    const { adminAccess, requireAdmin } = await import("@/lib/admin");
    expect((await adminAccess()).state).toBe("signed_out");

    session = { user: { id: "u", email: "someone@else.com" } };
    expect((await adminAccess()).state).toBe("not_admin");
    expect(await requireAdmin()).toBeNull();

    session = { user: { id: "a", email: "Owner@SwiftCard.me" } };
    expect((await adminAccess()).state).toBe("ok");
    expect((await requireAdmin())?.id).toBe("a");
  });

  it("asks the admin for no authenticator code anywhere", () => {
    expect(readFileSync("src/lib/admin.ts", "utf8")).not.toMatch(/mfa|aal2/);
    const layout = readFileSync("src/app/admin/layout.tsx", "utf8");
    expect(layout).not.toMatch(/TwoStep|second_step/);
  });

  // Every admin API route goes through requireAdmin, so there is one gate to
  // keep right. Two used to check the email themselves.
  const routes: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name === "route.ts") routes.push(p);
    }
  };
  walk("src/app/api/admin");

  it.each(routes)("%s is gated by requireAdmin in every handler", (file) => {
    const src = readFileSync(file, "utf8");
    const handlers = [...src.matchAll(/export async function (GET|POST|PATCH|PUT|DELETE)\b/g)];
    expect(handlers.length, "exports a handler").toBeGreaterThan(0);
    for (let i = 0; i < handlers.length; i++) {
      const body = src.slice(handlers[i].index, handlers[i + 1]?.index ?? src.length);
      expect(body, `${handlers[i][1]} handler`).toMatch(/requireAdmin\(\)/);
    }
    expect(src).not.toMatch(/isAdminEmail\(user\.email\)/);
  });
});

describe("F-ADMIN-01/02: every risky admin button says what it will do first", () => {
  it("moving a paying customer to Free names the cancellation and the team", () => {
    const m = planChangeWarning("maya@x.com", "enterprise", "free");
    expect(m).toContain("from Office to Free");
    expect(m).toContain("cancelled now, with no refund");
    expect(m).toContain("Office team is released");
  });

  it("Office to Pro names the team", () => {
    expect(planChangeWarning("a", "enterprise", "pro")).toContain("every member loses Office access");
  });

  it("a grant says nothing is charged", () => {
    expect(planChangeWarning("a", "free", "pro")).toContain("Nothing is charged");
    expect(grantMonthWarning("a")).toContain("ends by itself");
  });

  it("taking a card offline says what stops working", () => {
    expect(takeOfflineWarning("maya")).toContain("stop loading for everyone");
  });

  const users = readFileSync("src/app/admin/users/UsersClient.tsx", "utf8");
  const detail = readFileSync("src/app/admin/users/[id]/UserDetailClient.tsx", "utf8");

  it("the Users list asks before the request and shows a refusal", () => {
    const ask = users.indexOf("window.confirm(planChangeWarning(");
    expect(ask).toBeGreaterThan(-1);
    expect(users.indexOf('fetch("/api/admin/set-plan"')).toBeGreaterThan(ask);
    expect(users).toContain("setError(await adminErrorText(res))");
  });

  it("the user page asks before plan changes, the free month and taking a card offline, and shows refusals", () => {
    expect(detail).toContain("window.confirm(planChangeWarning(who");
    expect(detail).toContain("window.confirm(grantMonthWarning(who))");
    expect(detail).toContain("!c.offline && !window.confirm(takeOfflineWarning(c.username))");
    expect(detail).toContain("setActionError(await adminErrorText(res))");
    expect(detail).toMatch(/\{actionError && <p role="alert"/);
  });
});
