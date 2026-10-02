import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ── Notification audit, 2026-10-02 ───────────────────────────────────────────
// Owner: "make sure the whole notification system is working properly for both
// internal app notifications and external push phone notifications … for each
// plan and each account type". Each block pins one defect the audit found, so
// it cannot quietly come back.

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

type Row = Record<string, unknown>;
let offices: Row[] = [];
let profiles: Row[] = [];
let members: Row[] = [];
const insertedTeamRows: Row[] = [];
let failReads = false;

vi.mock("@/lib/supabase-admin", () => ({
  getAdminSupabase: () => ({
    from: (table: string) => {
      const rows = table === "offices" ? offices : table === "profiles" ? profiles : table === "office_members" ? members : [];
      const filters: [string, unknown][] = [];
      const q = {
        select: () => q,
        eq: (col: string, val: unknown) => { filters.push([col, val]); return q; },
        maybeSingle: async () => {
          if (failReads) return { data: null, error: { message: "down" } };
          const hit = rows.find((r) => filters.every(([c, v]) => r[c] === v));
          return { data: hit ?? null, error: null };
        },
        then: (resolve: (v: unknown) => void) => resolve({ data: rows.filter((r) => filters.every(([c, v]) => r[c] === v)), error: null }),
        insert: async (row: Row) => { if (table === "office_notifications") insertedTeamRows.push(row); return { error: null }; },
      };
      return q;
    },
  }),
}));

import { officeIsLive, notifyOffice } from "@/lib/office-notify";
import { teamAlertRecipients } from "@/lib/team-alerts";

beforeEach(() => {
  offices = [{ id: "o1", owner_id: "owner" }];
  profiles = [{ id: "owner", plan: "enterprise" }];
  members = [{ office_id: "o1", user_id: "admin", role: "admin", status: "active" }, { office_id: "o1", user_id: "emp", role: "employee", status: "active" }];
  insertedTeamRows.length = 0;
  failReads = false;
});

describe("a team is live only while its owner is on the Office plan", () => {
  it("Office owner → live; lapsed to Free or Pro → not; owner account gone → not", async () => {
    expect(await officeIsLive("o1")).toBe(true);
    for (const plan of ["free", "pro"]) {
      profiles = [{ id: "owner", plan }];
      expect(await officeIsLive("o1"), plan).toBe(false);
    }
    profiles = [];
    expect(await officeIsLive("o1")).toBe(false);
    offices = [];
    expect(await officeIsLive("o1")).toBe(false);
  });

  it("fails open on a database error — a real team must not lose its news to a blip", async () => {
    failReads = true;
    expect(await officeIsLive("o1")).toBe(true);
  });

  it("a lapsed team's inbox gets no rows (nobody can open it)", async () => {
    await notifyOffice("o1", { type: "leads_waiting", title: "2 leads waiting" });
    expect(insertedTeamRows).toHaveLength(1);
    profiles = [{ id: "owner", plan: "free" }];
    await notifyOffice("o1", { type: "leads_waiting", title: "2 leads waiting" });
    expect(insertedTeamRows).toHaveLength(1);
  });

  it("team pushes go to the owner and admins of a live team, and to nobody once it lapses", async () => {
    expect((await teamAlertRecipients("o1")).sort()).toEqual(["admin", "owner"]);
    profiles = [{ id: "owner", plan: "pro" }];
    expect(await teamAlertRecipients("o1")).toEqual([]);
  });

  it("the hourly sweep re-checks the owner's plan, including pending-only offices", () => {
    const recap = read("src/app/api/push/recap/route.ts");
    expect(recap).toContain("const allTeams = await liveTeams(admin, await teams(admin));");
    expect(recap).toContain("const toCheck = await liveTeams(admin, candidates);");
    expect(recap).toMatch(/isOfficePlan\(planOf\.get\(t\.ownerId\) \?\? null\)/);
  });
});

describe("a contact notification in the bell opens THAT contact", () => {
  it("new_lead: the bell row carries the lead, not only the push", () => {
    expect(read("src/app/api/leads/route.ts")).toContain("leadId: insertedLead?.id ?? null,");
  });

  it("lead_reply: the bell row carries the lead", () => {
    expect(read("src/app/api/twilio/inbound/route.ts")).toMatch(/type: "lead_reply"/);
    expect(read("src/app/api/twilio/inbound/route.ts")).toContain("lead_id: target.id,");
  });

  it("the writer accepts it", () => {
    expect(read("src/lib/notify.ts")).toMatch(/lead_id\?: string \| null;/);
  });
});

describe("the weekly recap reaches every account, not only those with a phone", () => {
  const recap = read("src/app/api/push/recap/route.ts");
  it("is driven by profiles, paged, not by push_subscriptions", () => {
    expect(recap).toMatch(/from\("profiles"\)\.select\("id, plan, customization"\)\.order\("id"\)\.range\(/);
    expect(recap).not.toMatch(/from\("push_subscriptions"\)/);
  });
  it("skips a deleted account", () => {
    expect(recap).toMatch(/_deleted\?: boolean \} \| null\)\?\._deleted\) continue;/);
  });
});

describe("no notification job silently stops at 1,000 rows", () => {
  it("catch-up and recap page every unbounded read", () => {
    const catchup = read("src/app/api/push/catchup/route.ts");
    expect(catchup).toMatch(/from\("push_subscriptions"\)\.select\("user_id"\)\.order\("id"\)\.range\(/);
    expect(catchup).not.toMatch(/from\("push_subscriptions"\)\.select\("user_id"\);/);
  });
});

describe("milestones are 'once ever' per OWNER, not per slug", () => {
  it("scopes the ledger check to the user as well as the card", () => {
    expect(read("src/lib/milestones.ts")).toMatch(/\.eq\("user_id", ownerId\)\s*\.eq\("card_owner", base\)/);
  });
});

describe("bell rows that say 'Tap here' can be tapped, and opening one reads it", () => {
  const bell = read("src/components/NotificationBell.tsx");
  it("referral rows open Refer a friend", () => {
    expect(bell).toContain('if (REFERRAL_ROW_TYPES.has(n.type)) return "/grow#refer";');
  });
  it("opening a row marks it read", () => {
    expect(bell).toContain("if (!n.read) void setRead(n.id, true);");
  });
});

describe("uptime watches Android push too", () => {
  it("health-check fails on a configured-but-broken FCM key", () => {
    expect(read("scripts/health-check.mjs")).toContain('const fcmOk = push.fcm?.configured !== true || push.fcm?.ok === true;');
  });
});

describe("signing a phone out in Settings → Devices stops its pushes", () => {
  it("a push registration records which device it is", () => {
    const sub = read("src/app/api/push/subscribe/route.ts");
    expect(sub).toContain("const cookieDevice = req.cookies.get(DEVICE_COOKIE)?.value;");
    expect(sub).toContain("{ user_id: user.id, endpoint, p256dh, auth, device_id: deviceId }");
  });
  it("the device sign-out deletes that device's push rows, for this user only", () => {
    expect(read("src/app/api/devices/route.ts")).toContain(
      '.from("push_subscriptions").delete().eq("user_id", user.id).eq("device_id", deviceId)',
    );
  });
  it("the column exists in a checked-in migration", () => {
    expect(read("supabase/push-subscription-device.sql")).toMatch(/add column if not exists device_id text/);
  });
});

describe("production proves it nightly", () => {
  it("qa-notifications runs in the nightly workflow and counts in its verdict", () => {
    expect(read(".github/workflows/nightly-qa.yml")).toContain("OUT=nightly/notifications node scripts/qa-notifications.mjs || true");
    expect(read("scripts/qa-nightly-summary.mjs")).toContain('"nightly/notifications/failures.json"');
  });
  it("covers every account type and all three surfaces", () => {
    const s = read("scripts/qa-notifications.mjs");
    for (const who of ['makeUser("free"', 'makeUser("pro"', 'makeUser("owner"', 'makeUser("admin"', 'makeUser("emp"', 'makeUser("lapsed"']) expect(s).toContain(who);
    expect(s).toContain("/api/notifications");          // the bell
    expect(s).toContain("/api/office/notifications");   // the team inbox
    expect(s).toContain("/rest/v1/push_log");           // the phone
  });
  it("cleans up offices in the order the database allows", () => {
    const s = read("scripts/qa-notifications.mjs");
    expect(s.indexOf("profiles?office_id=eq.")).toBeLessThan(s.indexOf("offices?id=eq."));
  });
});
