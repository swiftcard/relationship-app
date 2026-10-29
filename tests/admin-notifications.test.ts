import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";
import type Stripe from "stripe";

// ── The site admin's notification center (owner, 2026-10-28) ────────────────
// "a notification center in our admin page … for really important things":
// money, customers leaving, the agents. Admin only — no email, no push.

const read = (p: string) => readFileSync(p, "utf8");

const writes = vi.hoisted(() => ({ upserts: [] as { row: Record<string, unknown>; opts: unknown }[], updates: [] as { values: Record<string, unknown>; filters: [string, string, unknown][] }[], fail: false }));
vi.mock("@/lib/supabase-admin", () => ({
  getAdminSupabase: () => ({
    from: () => ({
      upsert: async (row: Record<string, unknown>, opts: unknown) => {
        if (writes.fail) throw new Error("db down");
        writes.upserts.push({ row, opts });
        return { error: null };
      },
      update: (values: Record<string, unknown>) => {
        const u = { values, filters: [] as [string, string, unknown][] };
        writes.updates.push(u);
        const chain = {
          is: (k: string, v: unknown) => (u.filters.push(["is", k, v]), chain),
          eq: (k: string, v: unknown) => (u.filters.push(["eq", k, v]), chain),
          then: (res: (x: { error: null }) => unknown) => Promise.resolve({ error: null }).then(res),
        };
        return chain;
      },
    }),
  }),
}));
vi.mock("@/lib/admin", async (orig) => ({ ...(await orig<typeof import("@/lib/admin")>()), requireAdmin: async () => ({ id: "admin", email: "owner@example.com" }) }));

beforeEach(() => {
  writes.upserts.length = 0;
  writes.updates.length = 0;
  writes.fail = false;
});

const ev = (type: string, object: Record<string, unknown>, extra: Partial<Stripe.Event> = {}) =>
  ({ id: `evt_${type}`, type, livemode: true, created: 1_793_000_000, data: { object, previous_attributes: undefined }, ...extra }) as unknown as Stripe.Event;
const who = (over: Partial<{ email: string; customization: Record<string, unknown>; plan: string }> = {}) =>
  ({ id: "u1", plan: over.plan ?? "pro", customization: over.customization ?? {}, email: over.email ?? "dana@example.com" });

describe("money, from Stripe", () => {
  it("a first real payment is news; a renewal is not", async () => {
    const { stripeNotification } = await import("@/lib/admin-notify-stripe");
    const inv = { id: "in_1", amount_paid: 499, lines: { data: [] } };
    expect(stripeNotification(ev("invoice.payment_succeeded", inv), who())).toMatchObject({
      kind: "money", title: "New paying customer", body: "dana@example.com paid $4.99 for Pro.", href: "/admin/users/u1", dedupeKey: "stripe:evt_invoice.payment_succeeded",
    });
    expect(stripeNotification(ev("invoice.payment_succeeded", inv), who({ customization: { _everPaid: true } }))).toBeNull();
    expect(stripeNotification(ev("invoice.payment_succeeded", inv), who({ customization: { _trialEndsAt: "2026-11-01" } }))?.title).toBe("A free trial turned into a payment");
    expect(stripeNotification(ev("invoice.payment_succeeded", { ...inv, amount_paid: 0 }), who())).toBeNull();
  });

  it("a failed payment is urgent", async () => {
    const { stripeNotification } = await import("@/lib/admin-notify-stripe");
    expect(stripeNotification(ev("invoice.payment_failed", { id: "in_2", amount_due: 4990 }), who())).toMatchObject({ severity: "urgent", title: "A payment failed", body: expect.stringContaining("$49.90 didn't go through") });
  });

  it("test mode, our own accounts and QA's are never news", async () => {
    const { stripeNotification } = await import("@/lib/admin-notify-stripe");
    const failed = { id: "in_3", amount_due: 499 };
    expect(stripeNotification(ev("invoice.payment_failed", failed, { livemode: false }), who())).toBeNull();
    expect(stripeNotification(ev("invoice.payment_failed", failed), who({ email: "qa-pro-1@swiftcard-test.invalid" }))).toBeNull();
    expect(stripeNotification(ev("invoice.payment_failed", failed), who({ email: "hello@swiftcard.me" }))).toBeNull();
  });

  it("a cancellation is told once, as someone leaving, under the key the cancel flow uses", async () => {
    const { stripeNotification } = await import("@/lib/admin-notify-stripe");
    const { cancelKey } = await import("@/lib/admin-notify");
    const sub = { id: "sub_1", cancel_at_period_end: true, cancel_at: 1_795_000_000, items: { data: [] } };
    const e = { ...ev("customer.subscription.updated", sub), data: { object: sub, previous_attributes: { cancel_at_period_end: false, cancel_at: null } } } as unknown as Stripe.Event;
    expect(stripeNotification(e, who())).toMatchObject({ kind: "leaving", title: "A customer is cancelling", dedupeKey: cancelKey("sub_1", new Date(1_793_000_000 * 1000)) });
    // Some other change to a subscription that was already cancelling: nothing new.
    const other = { ...ev("customer.subscription.updated", sub), data: { object: sub, previous_attributes: { quantity: 2 } } } as unknown as Stripe.Event;
    expect(stripeNotification(other, who())).toBeNull();
  });

  it("an ended trial that never paid says so", async () => {
    const { stripeNotification } = await import("@/lib/admin-notify-stripe");
    expect(stripeNotification(ev("customer.subscription.deleted", { id: "sub_2", trial_end: 1_793_000_000, items: { data: [] } }), who())?.title).toBe("A free trial ended without paying");
    expect(stripeNotification(ev("customer.subscription.deleted", { id: "sub_3", trial_end: null, items: { data: [] } }), who({ customization: { _everPaid: true } }))?.title).toBe("A subscription ended");
  });

  it("refunds, and disputes with the deadline and a link to answer it in Stripe", async () => {
    const { stripeNotification } = await import("@/lib/admin-notify-stripe");
    expect(stripeNotification(ev("charge.refunded", { id: "ch_1", amount_refunded: 499 }), who())?.body).toBe("$4.99 back to dana@example.com.");
    const d = stripeNotification(ev("charge.dispute.created", { id: "dp_1", amount: 499, reason: "product_not_received", evidence_details: { due_by: 1_794_000_000 } }), null);
    expect(d).toMatchObject({ severity: "urgent", title: "A payment was disputed", meta: expect.objectContaining({ stripeUrl: "https://dashboard.stripe.com/disputes/dp_1" }) });
    expect(d?.body).toContain("product not received");
  });

  it("the webhook asks before any handler runs (so a first payment still looks first)", () => {
    const hook = read("src/app/api/stripe/webhook/route.ts");
    const ask = hook.indexOf("await notifyAdminOfStripeEvent(event);");
    expect(ask).toBeGreaterThan(-1);
    expect(ask).toBeLessThan(hook.indexOf('if (event.type === "checkout.session.completed")'));
    expect(ask).toBeLessThan(hook.indexOf('if (event.type === "invoice.payment_succeeded")'));
  });
});

describe("the writer", () => {
  it("one row per event: a redelivery is ignored, not a second notification", async () => {
    const { notifyAdmin } = await import("@/lib/admin-notify");
    await notifyAdmin({ kind: "money", title: "t", dedupeKey: "stripe:evt_1" });
    expect(writes.upserts[0].row).toMatchObject({ kind: "money", severity: "important", dedupe_key: "stripe:evt_1" });
    expect(writes.upserts[0].opts).toEqual({ onConflict: "dedupe_key", ignoreDuplicates: true });
  });

  it("never throws into a payment or a deletion", async () => {
    writes.fail = true;
    const { notifyAdmin } = await import("@/lib/admin-notify");
    await expect(notifyAdmin({ kind: "leaving", title: "t", dedupeKey: "k" })).resolves.toBeUndefined();
  });
});

describe("customers leaving", () => {
  it("a closed account says who and why, in the words they tapped; QA's don't", async () => {
    const { alertRetention } = await import("@/lib/retention-alert");
    await alertRetention({ userId: "u9", email: "dana@example.com", plan: "pro", outcome: "deleted", reason: "too-expensive", comment: "Two events a year." });
    await alertRetention({ userId: "u8", email: "qa-1@swiftcard-test.invalid", plan: "pro", outcome: "deleted", reason: "testing" });
    expect(writes.upserts).toHaveLength(1);
    expect(writes.upserts[0].row).toMatchObject({ kind: "leaving", title: "An account was closed", href: "/admin/users/u9" });
    expect(String(writes.upserts[0].row.body)).toContain('Why: "It costs more than I get out of it"');
    expect(String(writes.upserts[0].row.body)).toContain('In their words: "Two events a year."');
  });

  it("someone an offer kept is told too", async () => {
    const { alertRetention } = await import("@/lib/retention-alert");
    await alertRetention({ userId: "u7", email: "sam@example.com", plan: "pro", outcome: "discount", reason: "too-expensive" });
    expect(writes.upserts[0].row).toMatchObject({ title: "Kept by an offer" });
    expect(String(writes.upserts[0].row.body)).toContain("took 50% off for 3 months");
  });

  it("the cancel flow writes the reason under the key the webhook uses", () => {
    const route = read("src/app/api/stripe/subscription/cancel/route.ts");
    expect(route).toContain("dedupeKey: cancelKey(profile.stripe_subscription_id as string)");
    expect(route).toContain("reasonText(reason, profile.plan as string | null)");
  });
});

describe("the agents", () => {
  it("one notification per episode, so the 15-minute tick can write them every time", async () => {
    const { agentNotifications, summarizeAgents } = await import("@/lib/admin-data/agents-health");
    const now = new Date("2026-10-29T15:00:00Z");
    const err = (agent_id: string, h: number) => ({ agent_id, status: "error", started_at: new Date(now.getTime() - h * 3600_000).toISOString(), finished_at: new Date(now.getTime() - h * 3600_000).toISOString(), summary: "Google said no" });
    const h = summarizeAgents({
      killAll: true, settingsUpdatedAt: "2026-10-27T21:31:00Z",
      states: [{ id: "leads-web", enabled: true, next_run_at: null, status_note: null }],
      runs: [err("sheet-sync", 1), err("sheet-sync", 2), err("sheet-sync", 3), err("leads-web", 1), err("leads-web", 2), err("leads-web", 3)],
      sheetRows: [], waiting: 2, missing: () => [],
    });
    const keys = agentNotifications(h, now).map((n) => n.dedupeKey);
    expect(keys).toEqual(["agents:sheet:never", "agents:failing:leads-web:2026-10-29", "agents:paused:2026-10-27T21:31:00Z", "agents:waiting:2026-10-29"]);
    expect(agentNotifications(h, now).every((n) => n.kind === "agents" && n.href === "/admin/crew")).toBe(true);
  });

  it("a missing connection is named, once per agent and key", async () => {
    const { agentNotifications, summarizeAgents } = await import("@/lib/admin-data/agents-health");
    const h = summarizeAgents({ killAll: false, settingsUpdatedAt: null, states: [{ id: "leads-reddit", enabled: true, next_run_at: null, status_note: null }], runs: [], sheetRows: [], waiting: 0, missing: (d) => (d.id === "leads-reddit" ? ["REDDIT_CLIENT_ID", "REDDIT_CLIENT_SECRET"] : []) });
    expect(agentNotifications(h)).toEqual([expect.objectContaining({ dedupeKey: "agents:setup:leads-reddit:REDDIT_CLIENT_ID,REDDIT_CLIENT_SECRET", body: "It can't run until REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET are set up." })]);
  });

  it("Pause all only becomes a notification after a day", async () => {
    const { agentNotifications, summarizeAgents } = await import("@/lib/admin-data/agents-health");
    const h = summarizeAgents({ killAll: true, settingsUpdatedAt: "2026-10-29T10:00:00Z", states: [], runs: [], sheetRows: [], waiting: 0, missing: () => [] });
    expect(agentNotifications(h, new Date("2026-10-29T15:00:00Z"))).toEqual([]);
  });

  it("the tick writes them after answering, so they never eat its time", () => {
    expect(read("src/app/api/crew/tick/route.ts")).toContain("after(() => recordAgentNotifications());");
  });
});

describe("Mark read", () => {
  const post = (fields: Record<string, string>, headers: Record<string, string> = {}) => {
    const body = new URLSearchParams(fields);
    return new NextRequest("https://swiftcard.me/api/admin/notifications/read", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", ...headers }, body });
  };

  it("one, by id, then back to the page it came from (a 303, so it works with no JavaScript)", async () => {
    const { POST } = await import("@/app/api/admin/notifications/read/route");
    const res = await POST(post({ id: "11111111-2222-4333-8444-555555555555", back: "/admin/notifications?tab=money&unread=1" }));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("https://swiftcard.me/admin/notifications?tab=money&unread=1");
    expect(writes.updates[0].values).toHaveProperty("read_at");
    expect(writes.updates[0].filters).toEqual([["is", "read_at", null], ["eq", "id", "11111111-2222-4333-8444-555555555555"]]);
  });

  it("all of one tab", async () => {
    const { POST } = await import("@/app/api/admin/notifications/read/route");
    await POST(post({ all: "1", kind: "agents", back: "/admin/notifications?tab=agents" }));
    expect(writes.updates[0].filters).toEqual([["is", "read_at", null], ["eq", "kind", "agents"]]);
  });

  it("never sends you anywhere but this page, and refuses another site's form", async () => {
    const { POST } = await import("@/app/api/admin/notifications/read/route");
    const res = await POST(post({ all: "1", back: "https://evil.example/" }));
    expect(res.headers.get("location")).toBe("https://swiftcard.me/admin/notifications");
    expect((await POST(post({ all: "1" }, { origin: "https://evil.example" }))).status).toBe(403);
  });

  it("the page's forms post, never get (they work before hydration)", () => {
    const view = read("src/app/admin/notifications/NotificationsView.tsx");
    const forms = (view.match(/<form [^>]*>/g) ?? []).filter((f) => f.includes("action="));
    expect(forms.length).toBe(2);
    for (const f of forms) expect(f).toBe('<form method="post" action="/api/admin/notifications/read">');
  });
});
