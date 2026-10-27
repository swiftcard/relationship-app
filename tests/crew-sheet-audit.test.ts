import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { authorKey, propose } from "@/lib/crew/approvals";
import { decide } from "@/lib/crew/decide";
import { paged } from "@/lib/crew/paged";
import { AGENTS } from "@/lib/crew/registry";
import { runEngagement, type Candidate } from "@/lib/crew/replies/engine";
import { EVERY_CHOICES, plainSchedule } from "@/lib/crew/schedule";
import { applyChange, normalizeSuppression } from "@/lib/crew/sheets/apply";
import { applyControl, changedStamp, parseScheduleText } from "@/lib/crew/sheets/controls";
import { NO_LINK, approvalKey, approvalRows, leadRows, type RowSources } from "@/lib/crew/sheets/rows";
import { ownerEditable, type TabSpec } from "@/lib/crew/sheets/spec";
import { controlEdits, inboundColumns, ownerChanges, placeRow, statusFixes } from "@/lib/crew/sheets/sync";
import { ALL_LEADS, QUEUE, REDDIT_REPLY, TOP50 } from "@/lib/crew/sheets/tabs";
import { MemoryStore } from "@/lib/crew/store-memory";
import { runTick } from "@/lib/crew/tick";
import type { Approval, Schedule, SheetRow } from "@/lib/crew/types";
import { fakeAgent, setup } from "./crew-helpers";

// ── The 2026-10-27 audit of the Sheet system, pinned ────────────────────────
// Each block is one finding that was real: the Sheet keepers never ran, the
// Controls tab undid an admin Stop, Completed published a blog post nobody
// approved, a stale Action Queue copy reverted a decision, deleted rows came
// back every 15 minutes, region-restricted leads reached the Sheet, an
// opt-out by display name blocked nothing, and old drafts without an exact
// link were shown. No network: pure functions and the in-memory store.

// The edit hook's refusals must never reach the database.
vi.mock("@/lib/crew/store-supabase", () => ({
  SupabaseStore: class {
    constructor() {
      throw new Error("the database was touched");
    }
  },
}));

afterEach(() => vi.unstubAllEnvs());

const sources = (over: Partial<RowSources> = {}): RowSources => ({ approvals: [], leads: [], findings: [], people: [], facts: [], geoHistory: [], known: new Map(), blueskyLive: false, ...over });

function approval(o: Partial<Approval>): Approval {
  return {
    id: "0b2f6c1e-1111-4222-8333-444455556666",
    created_at: "2026-10-25T14:00:00Z",
    agent_id: "replies-reddit",
    team: "replies",
    kind: "reply",
    status: "pending",
    title: "Reddit r/realtors: card and link page?",
    summary: "s",
    body: "Honestly one app that does both is easier.",
    platform: "reddit",
    target_url: "https://www.reddit.com/r/realtors/comments/abc123/is_there/xyz789/",
    person_id: null,
    debate: null,
    model_used: null,
    meta: { score: 0.8, author: "jane_sells", community: "realtors" },
    decided_at: null,
    reject_reason: null,
    done_at: null,
    expires_at: "2026-11-01T14:00:00Z",
    ...o,
  };
}

const KEY = "A-0123456789";
const known = (o: Partial<SheetRow> = {}): SheetRow => ({ id: "r1", tab: REDDIT_REPLY.id, row_key: KEY, entity_kind: "approval", entity_id: "e1", status: "Ready", owner_cols: {}, shown_status: "Ready", agent_hash: "h", synced_at: null, owner_edited_at: null, ...o });
/** One grid row for `tab`, cells placed by column key. */
const cells = (tab: TabSpec, v: Record<string, string>) => tab.columns.map((c) => (c.kind === "key" ? KEY : c.kind === "status" ? (v.status ?? "") : (v[c.key] ?? "")));

describe("the Sheet keepers", () => {
  it("run while their switch is off and through Pause all; nothing else does", async () => {
    const store = new MemoryStore();
    const keeper = fakeAgent({ id: "keeper", infrastructure: true, run: async () => ({ summary: "synced" }) });
    const worker = fakeAgent({ id: "worker" });
    await store.patchAgentState("worker", { enabled: true });
    await store.updateSettings({ kill_all: true });
    const r = await runTick({ store, providers: { claude: null, critic: null }, agents: [worker, keeper] });
    expect(r.ran.map((x) => x.agent)).toEqual(["keeper"]);
    expect(r.stopped).toBeTruthy();
    // CREW_DISABLED is the one thing that stops them.
    vi.stubEnv("CREW_DISABLED", "1");
    const off = await runTick({ store, providers: { claude: null, critic: null }, agents: [keeper] });
    expect(off.ran).toEqual([]);
  });

  it("a Pause lifted or a Start set in the Sheet applies in the same tick; a Pause set there stops the rest", async () => {
    const store = new MemoryStore();
    const worker = fakeAgent({ id: "worker" });
    // The keeper does what the sync does when the owner typed in Controls.
    const lift = fakeAgent({ id: "keeper", infrastructure: true, run: async (ctx) => (await ctx.store.updateSettings({ kill_all: false }), await ctx.store.patchAgentState("worker", { enabled: true }), { summary: "applied" }) });
    await store.updateSettings({ kill_all: true });
    const r = await runTick({ store, providers: { claude: null, critic: null }, agents: [worker, lift] });
    expect(r.ran.map((x) => x.agent)).toEqual(["keeper", "worker"]);
    expect(r.stopped).toBeUndefined();

    const store2 = new MemoryStore();
    await store2.patchAgentState("worker", { enabled: true });
    const pause = fakeAgent({ id: "keeper", infrastructure: true, run: async (ctx) => (await ctx.store.updateSettings({ kill_all: true }), { summary: "applied" }) });
    const r2 = await runTick({ store: store2, providers: { claude: null, critic: null }, agents: [worker, pause] });
    expect(r2.ran.map((x) => x.agent)).toEqual(["keeper"]);
    expect(r2.stopped).toBeTruthy();
  });

  it("are the two Sheet agents, and they go first in a tick", () => {
    expect(AGENTS.filter((d) => d.infrastructure).map((d) => d.id).sort()).toEqual(["sheet-daily", "sheet-sync"]);
  });
});

describe("Controls", () => {
  it("a value the sync wrote is not a decision, so an admin Stop is not undone by the old Running in the cell", () => {
    const rows = [
      ["Reddit Reply: Start / Stop", "Running", "", "", "", "agent:replies-reddit"],
      ["Dry run", "No", "", "", "", "dry_run"],
      ["Brand new", "Yes", "", "", "", "agent:not-written-yet"],
    ];
    expect(controlEdits(rows, null)).toEqual([]); // before the sync has written the tab once
    expect(controlEdits(rows, { "agent:replies-reddit": "Running", dry_run: "Yes" })).toEqual([{ i: 1, key: "dry_run", value: "No" }]);
  });

  it("a real change is stamped in Last Changed and logged once; the same value again changes nothing", async () => {
    const store = new MemoryStore();
    const r = await applyControl(store, "dry_run", "No", "owner@example.com", new Date("2026-10-27T19:05:00Z"));
    expect(r).toMatchObject({ ok: true, changed: true, shown: "No" });
    expect((await store.getControls())["dry_run:changed"]).toBe("Oct 27, 3:05pm");
    expect(await applyControl(store, "dry_run", "no", "owner")).toMatchObject({ ok: true, changed: false });
    expect(store.activity.filter((a) => a.action === "control")).toHaveLength(1);
    expect(changedStamp(new Date("2026-10-27T13:00:00Z"))).toBe("Oct 27, 9:00am");
  });

  it("a schedule set back to default reads as Default, not a garbled time", async () => {
    const store = new MemoryStore();
    await applyControl(store, "schedule:replies-reddit", "weekdays 10am", "owner");
    const back = await applyControl(store, "schedule:replies-reddit", "default", "owner");
    expect(back).toMatchObject({ ok: true, changed: true, shown: expect.stringMatching(/^Default \(/) });
    expect(store.activity.at(-1)!.message).toMatch(/Weekdays at 10:00am → Default \(/);
    expect(store.activity.at(-1)!.message).not.toMatch(/NaN|undefined/);
  });

  it("every schedule the tab shows reads back as itself", () => {
    for (const minutes of EVERY_CHOICES) {
      const s: Schedule = { kind: "every", minutes };
      expect(parseScheduleText(plainSchedule(s)), plainSchedule(s)).toEqual(s);
    }
    for (const days of [undefined, [1, 2, 3, 4, 5], [0, 6], [1, 3], [1, 3, 5], [2]]) {
      for (const [hour, minute] of [[9, 0], [13, 30], [0, 15], [12, 45]]) {
        const s: Schedule = days ? { kind: "daily", hour, minute, days } : { kind: "daily", hour, minute };
        expect(parseScheduleText(plainSchedule(s)), plainSchedule(s)).toEqual(s);
      }
    }
    expect(parseScheduleText("Default (all the time, every 15 minutes)")).toBe("default");
  });
});

describe("Sent / Posted and Completed record what the owner did; they never run anything", () => {
  it("Completed on a blog post nobody approved closes the row and publishes nothing, even with dry run off", async () => {
    const { store, ctx } = await setup({ def: fakeAgent({ id: "marketing-blog", team: "marketing", approvalKind: "blog_post" }) });
    await store.setControl("dry_run", false, "admin");
    const r = await propose(ctx, { kind: "blog_post", title: "Blog: A HiHello alternative", summary: "s", body: "# Post", platform: "site", meta: { slug: "hihello-alternative", description: "d" } });
    if (!r.ok) throw new Error(r.reason);
    const key = approvalKey(r.id);
    await store.upsertSheetRow({ tab: "blog", row_key: key, entity_kind: "approval", entity_id: r.id, status: "Ready", owner_cols: {}, shown_status: "Ready", agent_hash: "x", synced_at: null, owner_edited_at: null });
    expect((await applyChange(store, { rowKey: key, column: "status", value: "Completed", by: "owner" })).ok).toBe(true);
    const a = (await store.getApproval(r.id))!;
    expect(a.status).toBe("done");
    expect(a.meta.done_by_hand).toBe(true);
    expect(store.activity.map((x) => x.action)).toEqual(["status"]); // no publish, simulated or real
  });

  it("the done-by-hand branch of decide() never reaches an executor", () => {
    const src = readFileSync("src/lib/crew/decide.ts", "utf8");
    const branch = src.slice(src.indexOf('if (d.action === "done_by_hand")'), src.indexOf("// posted"));
    expect(branch.length).toBeGreaterThan(100);
    expect(branch).not.toMatch(/execute|tier2Executable|dispatch/i);
    expect(readFileSync("src/lib/crew/sheets/apply.ts", "utf8")).toMatch(/SENT_WORDS[\s\S]{0,200}action: "done_by_hand"/);
  });

  it("a code fix marked Completed is recorded, not opened as a pull request", async () => {
    const { store, ctx } = await setup({ def: fakeAgent({ id: "marketing-seo", team: "marketing", approvalKind: "code_fix" }) });
    const r = await propose(ctx, { kind: "code_fix", title: "Fix: missing meta description on /pricing", summary: "s", body: "Add a description.", platform: "site" });
    if (!r.ok) throw new Error(r.reason);
    expect(await decide(store, r.id, { action: "done_by_hand", by: "owner" })).toMatchObject({ ok: true });
    expect((await store.getApproval(r.id))!.status).toBe("done");
    expect(store.activity).toEqual([]);
  });
});

describe("one row, several copies: only a real change counts", () => {
  it("a copy still showing what the sync wrote is stale, not the owner undoing a decision", () => {
    // Approved on the admin page since the last sync: both copies still say Ready.
    const row = known({ status: "Approved", shown_status: "Ready" });
    const grid = new Map([
      [REDDIT_REPLY.id, [cells(REDDIT_REPLY, { status: "Ready" })]],
      [QUEUE.id, [cells(QUEUE, { status: "Ready" })]],
    ]);
    expect(ownerChanges([REDDIT_REPLY, QUEUE], grid, new Map([[KEY, row]]), () => undefined)).toEqual([]);
    // …and the sync puts the agent's tab right.
    expect(statusFixes([REDDIT_REPLY], grid, new Map([[KEY, row]]))).toEqual([{ range: "'Reddit Reply'!J2", values: [["Approved"]] }]);
  });

  it("changed in two copies in one sweep, the agent's own tab wins, whatever the order", () => {
    const grid = new Map([
      [REDDIT_REPLY.id, [cells(REDDIT_REPLY, { status: "Sent / Posted" })]],
      [QUEUE.id, [cells(QUEUE, { status: "Skipped" })]],
    ]);
    const k = new Map([[KEY, known()]]);
    for (const order of [[REDDIT_REPLY, QUEUE], [QUEUE, REDDIT_REPLY]]) {
      const ch = ownerChanges(order, grid, k, () => undefined);
      expect(ch.map((c) => [c.tab.id, c.col, c.value])).toEqual([[REDDIT_REPLY.id, "status", "Sent / Posted"]]);
    }
  });

  it("notes come before the Status, so an Approved uses the option picked in the same sweep", () => {
    const grid = new Map([[REDDIT_REPLY.id, [cells(REDDIT_REPLY, { status: "Approved", notes: "2" })]]]);
    const ch = ownerChanges([REDDIT_REPLY], grid, new Map([[KEY, known()]]), () => undefined);
    expect(ch.map((c) => c.col)).toEqual(["notes", "status"]);
  });

  it("the computed tabs are copies: only their Status is read; messages and notes are edited on the agent's tab", () => {
    for (const tab of [QUEUE, TOP50, ALL_LEADS]) {
      expect(inboundColumns(tab).map((k) => tab.columns[k].kind), tab.name).toEqual(["status"]);
    }
    const message = REDDIT_REPLY.columns.find((c) => c.key === "message")!;
    expect(ownerEditable(REDDIT_REPLY, message)).toBe(true);
    expect(ownerEditable(QUEUE, QUEUE.columns.find((c) => c.key === "message")!)).toBe(false);
    const grid = new Map([[QUEUE.id, [cells(QUEUE, { status: "Ready", message: "rewritten in the queue" })]]]);
    expect(ownerChanges([QUEUE], grid, new Map([[KEY, known()]]), () => "original")).toEqual([]);
  });
});

describe("rows the owner deleted stay deleted", () => {
  it("placed before and gone from its tab: never added again; never placed: added; restored: adopted", () => {
    expect(placeRow(undefined, undefined, REDDIT_REPLY.id)).toBe("append");
    expect(placeRow(known(), undefined, REDDIT_REPLY.id)).toBe("gone");
    expect(placeRow(undefined, 7, REDDIT_REPLY.id)).toBe("adopt");
    expect(placeRow(known(), 7, REDDIT_REPLY.id)).toBe("update");
    // An agent whose rows moved to a new tab in a release: they are added there.
    expect(placeRow(known({ tab: "reddit-dms" }), undefined, REDDIT_REPLY.id)).toBe("append");
  });
});

describe("what reaches the Sheet", () => {
  const lead = { id: "11111111-2222-3333-4444-555555555555", created_at: "2026-10-25T10:00:00Z", source_platform: "web" as const, source_url: "https://acme.com/contact" };

  it("leads from restricted regions never do", () => {
    expect(leadRows({ ...lead, list: "cold", email: "hi@acme.co.uk", region_restricted: true }, sources())).toEqual([]);
    expect(leadRows({ ...lead, list: "office", name: "Sam", region_restricted: true }, sources())).toEqual([]);
    expect(leadRows({ ...lead, list: "cold", email: "hi@acme.com" }, sources())).toHaveLength(1);
  });

  it("an office prospect opens an email to them when their site shows one, else their website", () => {
    const [withEmail] = leadRows({ ...lead, list: "office", name: "Sam", email: "sam@nycteam.com" }, sources());
    expect(withEmail.cells.open).toBe('=HYPERLINK("mailto:sam@nycteam.com","Email sam@nycteam.com")');
    const [noEmail] = leadRows({ ...lead, list: "office", name: "Sam" }, sources());
    expect(noEmail.cells.open).toBe('=HYPERLINK("https://acme.com/contact","Open website")');
  });

  it("an old draft without an exact link is dropped; one pasted without a link says so", () => {
    expect(approvalRows(approval({ target_url: "https://www.reddit.com/r/realtors/" }), sources())).toEqual([]);
    const [reddit] = approvalRows(approval({ target_url: null }), sources());
    expect(reddit.cells.open).toBe(NO_LINK);
    const [quora] = approvalRows(approval({ agent_id: "replies-quora", platform: "quora", target_url: "paste:abc", meta: { score: 0.8, author: "Jane Doe" } }), sources());
    expect(quora.cells.open).toBe(NO_LINK);
  });
});

describe("opt-outs", () => {
  const score = (req: { schema?: unknown; prompt: string }) => {
    if (req.schema && JSON.stringify(req.schema).includes("asks_for_tools")) {
      const n = (req.prompt.match(/^#\d+/gm) ?? []).length;
      return JSON.stringify({ items: Array.from({ length: n }, (_, i) => ({ i, score: 0.9, why: "asks for a tool", angle: "card plus link page", asks_for_tools: true, business_pro: true })) });
    }
    return "A card with the link page built in is what I ended up using.";
  };

  it("Unsubscribed on someone known only by a display name blocks that name on that platform", async () => {
    const { store, ctx } = await setup({ def: fakeAgent({ id: "replies-quora", maxPending: 50 }), script: score });
    await store.setRateLimit("quora", "reply", 100, "2026-01-01");
    const r = await propose(ctx, { kind: "reply", title: "Quora: sharing contact info", summary: "s", body: "A card with the link page built in works.", platform: "quora", targetUrl: "https://www.quora.com/How-do-realtors-share-contact-info", meta: { author: "Jane Doe" } });
    if (!r.ok) throw new Error(r.reason);
    const key = approvalKey(r.id);
    await store.upsertSheetRow({ tab: "quora", row_key: key, entity_kind: "approval", entity_id: r.id, status: "Ready", owner_cols: {}, shown_status: "Ready", agent_hash: "x", synced_at: null, owner_edited_at: null });
    expect((await applyChange(store, { rowKey: key, column: "status", value: "Unsubscribed", by: "owner" })).ok).toBe(true);
    expect(await store.isSuppressed([authorKey("quora", "jane  DOE")])).toBe(true);

    const find = async (): Promise<Candidate[]> => [{ platform: "quora", url: "https://www.quora.com/Whats-the-best-digital-business-card", author: "Jane Doe", title: "Best digital business card?", text: "linktree plus a card app is too much", community: "", promoAllowed: true }];
    const before = store.approvals.length;
    await runEngagement(ctx, { platform: "quora", kind: "reply", action: "reply", ceiling: 8, register: "", length: "", label: (c) => c.title, find });
    expect(store.approvals.length).toBe(before);
    expect(ctx.stats.skipped_suppressed).toBe(1);
  });

  it("what the owner types in the Suppression List is stored in the exact form the agents check", () => {
    expect(normalizeSuppression("Jane+news@Example.com")).toEqual({ value: "jane@example.com", channel: "email" });
    expect(normalizeSuppression("@Spam.example")).toEqual({ value: "@spam.example", channel: "domain" });
    expect(normalizeSuppression("reddit:/u/Spez")).toEqual({ value: "reddit:u/spez", channel: "reddit" });
    expect(normalizeSuppression("Instagram:@Jane.Realtor")).toEqual({ value: "instagram:@jane.realtor", channel: "instagram" });
    expect(normalizeSuppression("linkedin:https://www.linkedin.com/in/Jane-Doe/")).toEqual({ value: "linkedin:in/jane-doe", channel: "linkedin" });
    // A typo'd platform or an empty handle would block no one.
    expect(normalizeSuppression("instgram:jane")).toBeNull();
    expect(normalizeSuppression("reddit:")).toBeNull();
    expect(normalizeSuppression("instagram:@")).toBeNull();
    expect(normalizeSuppression("not an address")).toBeNull();
  });
});

describe("the edit hook refuses before it touches the database", () => {
  async function call(body: Record<string, string>) {
    vi.stubEnv("CREW_SHEET_HOOK_SECRET", "s3cret");
    const { POST } = await import("@/app/api/crew/sheet-hook/route");
    const res = await POST(new NextRequest("https://swiftcard.me/api/crew/sheet-hook", { method: "POST", headers: { authorization: "Bearer s3cret", "content-type": "application/json" }, body: JSON.stringify(body) }));
    return (await res.json()) as { ok: boolean; message?: string };
  }

  it("on Controls only the Value column is a switch", async () => {
    expect(await call({ tab: "Controls", key: "dry_run", header: "Setting", value: "No" })).toMatchObject({ ok: false, message: "Change only the Value column." });
    expect(await call({ tab: "Controls", key: "dry_run", header: "Allowed Values", value: "No" })).toMatchObject({ ok: false });
  });

  it("on a computed tab only the Status counts; an agent's own columns are the agent's", async () => {
    expect((await call({ tab: QUEUE.name, key: KEY, header: "Message / Action", value: "x" })).message).toMatch(/on the agent's own tab/);
    expect((await call({ tab: REDDIT_REPLY.name, key: KEY, header: "Why It's Relevant", value: "x" })).message).toMatch(/written by the agent/);
    expect((await call({ tab: REDDIT_REPLY.name, key: "", header: "Status", value: "Approved" })).message).toMatch(/no key/);
  });
});

describe("admin routes after the marketing rooms were retired", () => {
  it("the chat and the group switch answer only for the Watchdog, before anything is read or written", () => {
    for (const f of ["src/app/api/admin/crew/chat/[team]/route.ts", "src/app/api/admin/crew/teams/[team]/route.ts"]) {
      const src = readFileSync(f, "utf8");
      const gate = src.indexOf("ADMIN_TEAMS as string[]).includes(raw)");
      expect(gate, f).toBeGreaterThan(0);
      expect(gate, f).toBeLessThan(src.indexOf("new SupabaseStore()"));
    }
  });

  it("saving Settings keeps a group's money limit that has no field on the form", () => {
    const src = readFileSync("src/app/api/admin/crew/settings/route.ts", "utf8");
    expect(src).toContain("{ ...(await store.getSettings()).team_caps }");
    expect(src).toMatch(/if \(!form\.has\(`team_cap_\$\{t\}`\)\) continue;/);
  });
});

describe("the database has every column the code writes", () => {
  it("each Sheet row field is a column of crew_sheet_rows (created, or added for an older copy)", () => {
    const sql = readFileSync("supabase/crew-sheets.sql", "utf8");
    const table = /create table if not exists crew_sheet_rows \(([\s\S]*?)\n\);/.exec(sql)![1];
    const cols = new Set([...table.matchAll(/^\s+([a-z_]+)\s+[a-z]/gm)].map((m) => m[1]));
    for (const m of sql.matchAll(/alter table crew_sheet_rows\s+add column if not exists ([a-z_]+)/g)) cols.add(m[1]);
    for (const field of Object.keys(known())) expect(cols.has(field), `crew_sheet_rows.${field}`).toBe(true);
    // The sync refuses to run against a table that lacks it.
    expect(readFileSync("src/lib/crew/store-supabase.ts", "utf8")).toContain('from("crew_sheet_rows").select("id, shown_status")');
  });
});

describe("reading past 1,000 rows", () => {
  it("pages through until a short page, never past max, and fails loudly on an error", async () => {
    const all = Array.from({ length: 2500 }, (_, i) => i);
    const asked: [number, number][] = [];
    const build = async (from: number, to: number) => (asked.push([from, to]), { data: all.slice(from, to + 1), error: null });
    expect(await paged(build, 10_000, "t")).toHaveLength(2500);
    expect(asked).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
    expect(await paged(build, 1500, "t")).toHaveLength(1500);
    await expect(paged(async () => ({ data: null, error: { message: "boom" } }), 10, "runs")).rejects.toThrow("crew store runs: boom");
  });
});
