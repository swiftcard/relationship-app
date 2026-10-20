import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";

// ── NM-10: no team-inbox row, no team push ──────────────────────────────────
//
// For a team milestone, a first lead, members with no card and an expired
// invite, the inbox row IS the once-only ledger the next hourly check looks
// for. notifyOffice never read the insert's {error}, and alertTeam pushed
// regardless, so a failed write meant the same push every hour.
//
// ── NM-06: one type for "Your Office access ended" ──────────────────────────
//
// Three type names carried the same title, and the 10-minute dedupe keys on
// type, so a member caught by a seat trim and then the subscription ending
// got two identical-looking rows.

type Row = Record<string, unknown>;
let offices: Row[] = [];
let profiles: Row[] = [];
let members: Row[] = [];
const insertedTeamRows: Row[] = [];
let failInsert = false;
const pushes: { userId: string; title: string }[] = [];
const reported: string[] = [];

vi.mock("@/lib/supabase-admin", () => ({
  getAdminSupabase: () => ({
    from: (table: string) => {
      const rows = table === "offices" ? offices : table === "profiles" ? profiles : table === "office_members" ? members : [];
      const filters: [string, (v: unknown) => boolean][] = [];
      const q = {
        select: () => q,
        eq: (col: string, val: unknown) => { filters.push([col, (v) => v === val]); return q; },
        in: (col: string, vals: unknown[]) => { filters.push([col, (v) => vals.includes(v)]); return q; },
        maybeSingle: async () => ({ data: rows.find((r) => filters.every(([c, f]) => f(r[c]))) ?? null, error: null }),
        then: (resolve: (v: unknown) => void) => resolve({ data: rows.filter((r) => filters.every(([c, f]) => f(r[c]))), error: null }),
        insert: async (row: Row) => {
          if (table !== "office_notifications") return { error: null };
          if (failInsert) return { error: { message: "insert failed" } };
          insertedTeamRows.push(row);
          return { error: null };
        },
      };
      return q;
    },
  }),
}));
vi.mock("@/lib/push", () => ({
  sendPushToUser: async (userId: string, p: { title: string }) => { pushes.push({ userId, title: p.title }); },
}));
vi.mock("@/lib/report-error", () => ({
  reportError: async (where: string) => { reported.push(where); },
}));

import { notifyOffice } from "@/lib/office-notify";
import { alertTeam } from "@/lib/team-alerts";

beforeEach(() => {
  offices = [{ id: "o1", owner_id: "owner", name: "Acme" }];
  profiles = [{ id: "owner", plan: "enterprise" }];
  members = [{ office_id: "o1", user_id: "admin", role: "admin", status: "active" }];
  insertedTeamRows.length = 0;
  pushes.length = 0;
  reported.length = 0;
  failInsert = false;
});

const milestone = { type: "team_milestone" as const, title: "Your team passed 100 views", body: "Nice.", push: {} };

describe("team alerts and their inbox row", () => {
  it("a written row pushes, as before", async () => {
    expect(await notifyOffice("o1", { type: "member_joined", title: "x" })).toBe(true);
    await alertTeam("o1", milestone);
    expect(insertedTeamRows.some((r) => r.type === "team_milestone")).toBe(true);
    expect(pushes.length).toBeGreaterThan(0);
  });

  it("a failed row does not push, and the failure is reported", async () => {
    failInsert = true;
    expect(await notifyOffice("o1", { type: "member_joined", title: "x" })).toBe(false);
    await alertTeam("o1", milestone);
    expect(pushes).toEqual([]);
    expect(reported).toContain("office-notify.insert");
  });

  it("a lapsed team writes nothing and pushes nothing", async () => {
    profiles = [{ id: "owner", plan: "free" }];
    expect(await notifyOffice("o1", { type: "member_joined", title: "x" })).toBe(false);
    await alertTeam("o1", milestone);
    expect(pushes).toEqual([]);
  });
});

describe("one type for one message", () => {
  it("every 'Your Office access ended' row is office_plan_downgraded", () => {
    const files = ["src/app/api/stripe/webhook/route.ts", "src/app/api/office/members/route.ts", "src/lib/office-billing-sync.ts"];
    let seen = 0;
    for (const f of files) {
      const src = readFileSync(f, "utf8").replace(/\r\n/g, "\n");
      for (const m of src.matchAll(/type: "([a-z_]+)",[^\n]*\n\s*title: "Your Office access ended"/g)) {
        expect(m[1], f).toBe("office_plan_downgraded");
        seen++;
      }
      expect(src, f).not.toMatch(/office_seat_trimmed"|office_subscription_ended"/);
    }
    expect(seen).toBe(4);
  });
});
