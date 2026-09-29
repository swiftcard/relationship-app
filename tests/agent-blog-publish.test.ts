import { describe, it, expect, vi, beforeEach } from "vitest";

// Bo's finding (2026-09-29): a blog pick published without a slug looked
// "published" in the queue but never reached /blog — the write to
// agent_blog_posts only ran when a slug was already present, and its result
// was never checked, so a failed write also looked like success.

let items: Array<Record<string, unknown>> = [];
let upsertResult: { error: { message: string } | null } = { error: null };
const calls: Array<{ table: string; op: string; row?: Record<string, unknown>; patch?: Record<string, unknown> }> = [];

vi.mock("@/lib/admin", () => ({ requireAdmin: async () => ({ id: "admin", email: "hello@swiftcard.me" }) }));
vi.mock("@/lib/agent-execute", () => ({ executeItem: async () => ({ executed: false, reason: "not connected" }) }));
vi.mock("@/lib/supabase-admin", () => ({
  getAdminSupabase: () => ({
    from: (table: string) => ({
      select: () => ({ in: async () => { calls.push({ table, op: "select.in" }); return { data: items }; } }),
      update: (patch: Record<string, unknown>) => ({
        eq: async () => { calls.push({ table, op: "update", patch }); return {}; },
      }),
      upsert: async (row: Record<string, unknown>) => { calls.push({ table, op: "upsert", row }); return upsertResult; },
      insert: async (row: Record<string, unknown>) => { calls.push({ table, op: "insert", row }); return {}; },
    }),
  }),
}));

import { POST } from "@/app/api/admin/agents/items/route";

const post = (body: Record<string, unknown>) =>
  POST(new Request("https://swiftcard.me/api/admin/agents/items", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  }) as never);

beforeEach(() => {
  calls.length = 0;
  upsertResult = { error: null };
  items = [{
    id: "q1", status: "pending", item_type: "blog_post", agent_id: "seo",
    title: "SwiftCard raises $250,000 in private angel funding", content: "c",
    payload: {
      title: "SwiftCard raises $250,000 in private angel funding",
      description: "SwiftCard closes a private angel round.",
      content_md: "# body",
    },
  }];
});

describe("a blog pick with no slug still publishes", () => {
  it("generates a slug from the title and writes the row before marking the item published", async () => {
    const res = await post({ ids: ["q1"], action: "published" });
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.execFailed).toEqual([]);

    const upsert = calls.find((c) => c.table === "agent_blog_posts" && c.op === "upsert");
    expect(upsert?.row?.slug).toBe("swiftcard-raises-250-000-in-private-angel-funding");

    const publish = calls.find((c) => c.table === "agent_queue_items" && c.op === "update" && c.patch?.status === "published");
    expect(publish).toBeTruthy();
    // The blog table write must happen BEFORE the queue item is marked published.
    expect(calls.indexOf(upsert!)).toBeLessThan(calls.indexOf(publish!));
  });
});

describe("a failed write is never reported as published", () => {
  it("leaves the queue item unpublished and returns a visible error", async () => {
    upsertResult = { error: { message: "connection reset" } };
    const res = await post({ ids: ["q1"], action: "published" });
    const json = await res.json();

    expect(calls.some((c) => c.table === "agent_blog_posts" && c.op === "upsert")).toBe(true);
    const publish = calls.find((c) => c.table === "agent_queue_items" && c.op === "update" && c.patch?.status === "published");
    expect(publish).toBeUndefined();

    expect(json.execFailed).toHaveLength(1);
    expect(json.execFailed[0]).toMatchObject({ id: "q1" });
    expect(json.execFailed[0].reason).toMatch(/connection reset/);
  });
});
