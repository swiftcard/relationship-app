import { describe, it, expect, vi, beforeEach } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { NextRequest } from "next/server";

// ── Every control in the site admin, and the test that proves it works ──────
//
// Owner, 2026-10-28: "make sure absolutely everything in the admin account is
// working properly and thought of for every tab, button, agent, and
// analytic". This is the checklist. Each admin screen's buttons, forms,
// selects, switches and inputs are COUNTED: add one and this fails until it
// is listed here with the test that drives it. The Agents tab (src/app/admin/
// crew) and Marketing are owned by their own threads and checked there.

const read = (p: string) => readFileSync(p, "utf8");

type Entry = { file: string; controls: string[]; provedBy: { test: string; mentions: string }[] };

const INVENTORY: Entry[] = [
  {
    file: "src/app/admin/OverviewClient.tsx",
    controls: ["Refresh (reloads every source; one failing blanks only its own numbers)"],
    provedBy: [{ test: "tests/render/admin-console.test.ts", mentions: "one source failing blanks only its own numbers and says so" }],
  },
  {
    file: "src/app/admin/_ui/TabButtons.tsx",
    controls: ["a tab that swaps the view in place"],
    provedBy: [{ test: "tests/render/admin-console.test.ts", mentions: "Company Analytics" }],
  },
  {
    file: "src/app/admin/_ui/states.tsx",
    controls: ["Try again (after a load fails)"],
    provedBy: [{ test: "tests/render/admin-console.test.ts", mentions: "The agents' status didn't load" }],
  },
  {
    file: "src/app/admin/notifications/NotificationsView.tsx",
    controls: ["Mark read", "Mark all read", "their hidden fields (id, all, kind, back ×2)"],
    provedBy: [
      { test: "tests/admin-notifications.test.ts", mentions: "one, by id, then back to the page it came from" },
      { test: "tests/render/admin-console.test.ts", mentions: "the list, the tabs and the forms" },
    ],
  },
  {
    file: "src/app/admin/plans/PlansClient.tsx",
    controls: ["switch my own account to a plan"],
    provedBy: [{ test: "tests/audit-round-33-numbers-admin-busy.test.ts", mentions: "PlansClient" }],
  },
  {
    file: "src/app/admin/users/UsersClient.tsx",
    controls: [
      "tabs with counts", "search", "sort", "Change plan (asks first, shows a refusal)", "Card ↗ / Links ↗", "a row opens the person",
      "Create card: every field, plan, template, colours, Create card, Close, Copy setup link, Done", "Try again",
    ],
    provedBy: [
      { test: "tests/render/admin-users.interactive.test.ts", mentions: "Closed accounts" },
      { test: "tests/render/admin-safety.interactive.test.ts", mentions: "the plan dropdown asks first" },
      { test: "tests/render/admin-create-card-line-colors.interactive.test.ts", mentions: "" },
      { test: "tests/render/admin-create-card-photo-shape.interactive.test.ts", mentions: "" },
    ],
  },
  {
    file: "src/app/admin/users/[id]/UserDetailClient.tsx",
    controls: ["tabs", "See all contacts", "Take offline / Bring online", "plan buttons", "Grant 1 month", "Set code (+ its input)"],
    provedBy: [
      { test: "tests/render/admin-users.interactive.test.ts", mentions: "a closed account's page says when, why" },
      { test: "tests/admin-controls-inventory.test.ts", mentions: "the user page's actions, server side" },
    ],
  },
  {
    file: "src/app/admin/crew/blog/BlogWriterView.tsx",
    controls: ["Generate", "Discard both", "Publish this one (top and bottom of each post)", "their hidden fields"],
    provedBy: [
      { test: "tests/crew-blog-writer.test.ts", mentions: "the pick goes live, the log remembers it" },
      { test: "tests/render/admin-console.test.ts", mentions: "two full posts to choose from, each with Publish" },
    ],
  },
  {
    file: "src/app/admin/website/WebsiteAnalyticsClient.tsx",
    controls: ["Include my team's visits (switch)", "Exclude my visits / Count this device again", "Try again"],
    provedBy: [
      { test: "tests/render/admin-website.interactive.test.ts", mentions: "the team switch adds exactly the team's visits" },
      { test: "tests/admin-controls-inventory.test.ts", mentions: "Exclude my visits sets the cookie" },
    ],
  },
];

/** The admin screens checked here. A new one must be added to the inventory. */
const SCREENS = [
  "src/app/admin/AdminNav.tsx", // links and the <details> menu only (render: the admin shell)
  ...INVENTORY.map((e) => e.file),
];

const PINNED: Record<string, number> = {
  "src/app/admin/AdminNav.tsx": 0,
  "src/app/admin/OverviewClient.tsx": 1,
  "src/app/admin/_ui/TabButtons.tsx": 1,
  "src/app/admin/_ui/states.tsx": 1,
  "src/app/admin/notifications/NotificationsView.tsx": 9,
  "src/app/admin/plans/PlansClient.tsx": 1,
  "src/app/admin/users/UsersClient.tsx": 23,
  "src/app/admin/users/[id]/UserDetailClient.tsx": 6,
  "src/app/admin/website/WebsiteAnalyticsClient.tsx": 3,
  "src/app/admin/crew/blog/BlogWriterView.tsx": 11,
};

function controlCount(src: string): number {
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  return ["<button", "<form ", "<select", 'role="switch"', "<input"].reduce((n, tag) => n + code.split(tag).length - 1, 0);
}

describe("every admin control is listed with the test that proves it", () => {
  for (const f of SCREENS) {
    it(`${f}: no control added without a test`, () => {
      expect(controlCount(read(f)), `${f} has a new or removed control — list it in INVENTORY with its test, then update PINNED`).toBe(PINNED[f]);
    });
  }

  for (const e of INVENTORY) {
    it(`${e.file}: its tests exist and drive it`, () => {
      expect(e.controls.length).toBeGreaterThan(0);
      for (const p of e.provedBy) {
        expect(existsSync(p.test), p.test).toBe(true);
        if (p.mentions) expect(read(p.test), `${p.test} should cover "${p.mentions}"`).toContain(p.mentions);
      }
    });
  }

  it("no admin screen is missing from the checklist", () => {
    const listed = new Set(SCREENS);
    const all = [
      "src/app/admin/OverviewClient.tsx", "src/app/admin/users/UsersClient.tsx", "src/app/admin/users/[id]/UserDetailClient.tsx",
      "src/app/admin/website/WebsiteAnalyticsClient.tsx", "src/app/admin/plans/PlansClient.tsx", "src/app/admin/notifications/NotificationsView.tsx",
    ];
    for (const f of all) expect(listed.has(f), f).toBe(true);
  });
});

// ── The server side of the two controls nothing else drove ──────────────────

const db = vi.hoisted(() => ({ card: null as { id: string; user_id: string } | null, profile: null as Record<string, unknown> | null, updates: [] as { table: string; values: Record<string, unknown> }[] }));
vi.mock("@/lib/supabase-admin", () => ({
  getAdminSupabase: () => ({
    from: (table: string) => {
      const chain: Record<string, unknown> = {};
      Object.assign(chain, {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => ({ data: table === "cards" ? db.card : db.profile, error: null }),
        update: (values: Record<string, unknown>) => { db.updates.push({ table, values }); return { eq: async () => ({ error: null }) }; },
      });
      return chain;
    },
  }),
}));
vi.mock("@/lib/admin", async (orig) => ({ ...(await orig<typeof import("@/lib/admin")>()), requireAdmin: async () => ({ id: "admin", email: "owner@example.com" }) }));

beforeEach(() => {
  db.card = null;
  db.profile = null;
  db.updates.length = 0;
});

describe("Website › Exclude my visits sets the cookie, and Count this device again clears it", () => {
  const post = (on: boolean) => new NextRequest("https://swiftcard.me/api/admin/website/internal", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ on }) });

  it("on: sc_internal=1 for a year, the whole site", async () => {
    const { POST } = await import("@/app/api/admin/website/internal/route");
    const cookie = (await POST(post(true))).headers.get("set-cookie") ?? "";
    expect(cookie).toContain("sc_internal=1");
    expect(cookie).toMatch(/Path=\//i);
    expect(cookie).toMatch(/Max-Age=\d{8}/i);
  });

  it("off: cleared", async () => {
    const { POST } = await import("@/app/api/admin/website/internal/route");
    expect((await POST(post(false))).headers.get("set-cookie") ?? "").toMatch(/sc_internal=;.*Max-Age=0/i);
  });
});

describe("the user page's actions, server side", () => {
  const patch = (body: Record<string, unknown>) =>
    new NextRequest("https://swiftcard.me/api/admin/users/u1", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const ctx = { params: Promise.resolve({ id: "u1" }) };

  it("Take offline flips only a card that belongs to this person", async () => {
    const { PATCH } = await import("@/app/api/admin/users/[id]/route");
    db.card = { id: "k2", user_id: "someone-else" };
    expect((await PATCH(patch({ cardOffline: { cardId: "k2", offline: true } }), ctx)).status).toBe(404);
    expect(db.updates).toEqual([]);
    db.card = { id: "k1", user_id: "u1" };
    expect((await PATCH(patch({ cardOffline: { cardId: "k1", offline: true } }), ctx)).status).toBe(200);
    expect(db.updates).toEqual([{ table: "cards", values: { is_offline: true } }]);
  });

  it("Grant 1 month refuses someone already paying through Stripe", async () => {
    const { PATCH } = await import("@/app/api/admin/users/[id]/route");
    db.profile = { stripe_subscription_id: "sub_1", customization: {} };
    expect((await PATCH(patch({ grantFreeMonth: true }), ctx)).status).toBe(409);
    db.profile = { stripe_subscription_id: null, customization: {} };
    const ok = await PATCH(patch({ grantFreeMonth: true }), ctx);
    expect(ok.status).toBe(200);
    expect(db.updates.at(-1)).toMatchObject({ table: "profiles", values: { plan: "pro" } });
  });
});
