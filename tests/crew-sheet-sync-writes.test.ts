import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sheetSync } from "@/lib/crew/agents/sheet-sync";
import { GoogleHttpError } from "@/lib/crew/google/auth";
import { workbookRequests } from "@/lib/crew/sheets/bootstrap";
import { leadKey } from "@/lib/crew/sheets/rows";
import { LAYOUT_VERSION, syncSheet } from "@/lib/crew/sheets/sync";
import { ALL_TABS, REDDIT_REPLY, WEB_LEADS } from "@/lib/crew/sheets/tabs";
import { MemoryStore } from "@/lib/crew/store-memory";
import type { Lead } from "@/lib/crew/types";
import { setup } from "./crew-helpers";

// ── The Sheet sync writes leads, or says it didn't ──────────────────────────
// 2026-10-27: the Web Leads agent saved 31 leads, the SwiftCard Leads sheet
// stayed empty. The workbook's formatting batch carried a Controls protection
// with unprotectedRanges on a block of columns; Google allows that only on a
// whole-sheet protection, refused the entire batch with HTTP 400, and the
// sync stopped there every 15 minutes, before writing a single row. These
// tests run the whole sync against a fake Sheets API that refuses what Google
// refuses.
//
// 2026-10-29 (owner): every tab is Name, Message, Link; a row that is no
// longer waiting comes off; the old tabs go once, and nothing on them counts
// as sent. Later that day (owner): deleting a row must never count as
// outreach, and no lead may drop off the Sheet without a reason on record. A
// deleted row is put back exactly as it was; "sent" typed over the message is
// how a row is finished.

type Fake = { sheets: { sheetId: number; title: string }[]; rows: Map<string, unknown[][]>; failProtection: boolean; failValueWrites: boolean; batches: Record<string, unknown>[][]; writes: { range: string; values: unknown[][] }[] };
const fake: Fake = { sheets: [], rows: new Map(), failProtection: false, failValueWrites: false, batches: [], writes: [] };

const tabOf = (range: string) => decodeURIComponent(range).replace(/^'/, "").replace(/'!.*$/, "").replace(/''/g, "'");
const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200 });

/** What Google says about one spreadsheets.batchUpdate request, or null when it accepts it. */
function refusal(req: Record<string, unknown>): string | null {
  const add = req.addProtectedRange as { protectedRange: { range: Record<string, unknown>; unprotectedRanges?: unknown[] } } | undefined;
  if (!add) return null;
  if (fake.failProtection) return "The caller does not have permission";
  const wholeSheet = Object.keys(add.protectedRange.range).every((k) => k === "sheetId");
  if (add.protectedRange.unprotectedRanges?.length && !wholeSheet) return "unprotectedRanges are only allowed on ProtectedRanges covering a whole sheet.";
  return null;
}

vi.mock("@/lib/crew/google/auth", async (orig) => {
  const real = await orig<typeof import("@/lib/crew/google/auth")>();
  return {
    ...real,
    googleConfigured: () => true,
    googleFetch: async (url: string, init: RequestInit & { what?: string } = {}) => {
      const body = init.body ? JSON.parse(String(init.body)) : {};
      if (url.includes("fields=sheets.protectedRanges")) return json({ sheets: [] });
      if (url.includes("?fields=spreadsheetId")) return json({ spreadsheetId: "test-sheet", spreadsheetUrl: "https://example.test", properties: { title: "SwiftCard Leads" }, sheets: fake.sheets.map((s, index) => ({ properties: { ...s, index } })) });
      if (url.endsWith("/:batchUpdate")) {
        const requests = body.requests as Record<string, unknown>[];
        // Atomic like Google: one bad request and nothing in the batch applies.
        for (const [i, r] of requests.entries()) {
          const why = refusal(r);
          if (why) throw new real.GoogleHttpError(400, JSON.stringify({ error: { code: 400, message: `Invalid requests[${i}].addProtectedRange: ${why}` } }), "spreadsheets.batchUpdate");
        }
        fake.batches.push(requests);
        for (const r of requests) {
          const add = r.addSheet as { properties: { title: string } } | undefined;
          if (add) fake.sheets.push({ sheetId: fake.sheets.length + 100, title: add.properties.title });
          const del = r.deleteSheet as { sheetId: number } | undefined;
          if (del) {
            const gone = fake.sheets.find((x) => x.sheetId === del.sheetId);
            fake.sheets = fake.sheets.filter((x) => x.sheetId !== del.sheetId);
            if (gone) fake.rows.delete(gone.title);
          }
          const dim = r.deleteDimension as { range: { sheetId: number; startIndex: number } } | undefined;
          if (dim) {
            const title = fake.sheets.find((x) => x.sheetId === dim.range.sheetId)?.title ?? "";
            const rows = fake.rows.get(title) ?? [];
            rows.splice(dim.range.startIndex - 1, 1); // the header is row 1
            fake.rows.set(title, rows);
          }
        }
        return json({ replies: [] });
      }
      if (url.includes("values:batchGet")) {
        const ranges = new URL(url).searchParams.getAll("ranges");
        return json({ valueRanges: ranges.map((r) => ({ range: r, values: fake.rows.get(tabOf(r)) ?? [] })) });
      }
      if (url.includes(":append")) {
        const tab = tabOf(url.split("/values/")[1].split(":append")[0]);
        const have = fake.rows.get(tab) ?? [];
        fake.rows.set(tab, [...have, ...(body.values as unknown[][])]);
        return json({ updates: { updatedRange: `'${tab}'!A${have.length + 2}:Z${have.length + 1 + body.values.length}` } });
      }
      if (url.includes("values:batchUpdate")) {
        if (fake.failValueWrites) throw new real.GoogleHttpError(503, "backend error", "values.batchUpdate");
        fake.writes.push(...(body.data as { range: string; values: unknown[][] }[]));
        return json({});
      }
      if (url.includes(":clear")) return json({});
      throw new Error(`unexpected Google call ${url}`);
    },
  };
});

const lead = (email: string, company: string): Lead => ({ list: "cold", name: null, email, phone: null, company, business_type: "real estate offices", city: "Charlotte", region: "NC", country: "US", source_platform: "web", source_url: `https://${email.split("@")[1]}/contact`, message: "Subject: your open houses\n\nI built SwiftCard so visitors tap and save you, free to start." });

async function storeWithLeads(n = 3) {
  const store = new MemoryStore();
  await store.insertLeads(Array.from({ length: n }, (_, i) => lead(`owner${i}@realty${i}.com`, `Realty ${i}`)));
  return store;
}

const LINK = WEB_LEADS.columns.findIndex((c) => c.key === "link");
const KEY = WEB_LEADS.columns.findIndex((c) => c.kind === "key");
/** The address each Web Leads row's link writes to. */
const webLeadEmails = () => (fake.rows.get(WEB_LEADS.name) ?? []).map((r) => /mailto:([^?"]+)/.exec(String(r[LINK]))?.[1] ?? "");

beforeEach(() => {
  vi.stubEnv("GOOGLE_SHEETS_SA_JSON", "{}");
  vi.stubEnv("CREW_SHEET_ID", "test-sheet");
  vi.stubEnv("CREW_SHEET_ID_TEST", "");
  vi.stubEnv("CREW_SHARED_DRIVE_ID", "");
  vi.stubEnv("CREW_SHEET_SHARE_EMAILS", "");
  Object.assign(fake, { sheets: [{ sheetId: 0, title: "Sheet1" }], rows: new Map(), failProtection: false, failValueWrites: false, batches: [], writes: [] });
});
afterEach(() => vi.unstubAllEnvs());

describe("the workbook's formatting requests", () => {
  const sheets = ALL_TABS.map((t, i) => ({ sheetId: i + 1, title: t.name }));
  const { headers, looks, protection } = workbookRequests(sheets);

  it("only ever puts unprotectedRanges on a protection that covers a whole sheet", () => {
    const withHoles = protection.map((r) => (r.addProtectedRange as { protectedRange: { range: Record<string, unknown>; unprotectedRanges?: unknown[] } }).protectedRange).filter((p) => p.unprotectedRanges?.length);
    for (const p of withHoles) expect(Object.keys(p.range)).toEqual(["sheetId"]);
    for (const r of [...headers, ...looks, ...protection]) expect(refusal(r)).toBeNull();
  });

  it("hides the Key column on every agent tab, so each shows Name, Message, Link", () => {
    const hidden = looks.filter((r) => (r.updateDimensionProperties as { properties?: { hiddenByUser?: boolean } } | undefined)?.properties?.hiddenByUser === true);
    expect(hidden.length).toBe(ALL_TABS.filter((t) => t.layout === "rows").length);
  });

  it("keeps protections out of the batch that writes the header rows", () => {
    expect([...headers, ...looks].some((r) => "addProtectedRange" in r)).toBe(false);
    expect(headers.filter((r) => "updateCells" in r).length).toBeGreaterThan(0);
  });
});

describe("syncSheet", () => {
  it("puts every saved lead on the Web Leads tab", async () => {
    const store = await storeWithLeads(3);
    const r = await syncSheet(store, new Date());
    expect(r.errors).toEqual([]);
    expect(r.appended).toBeGreaterThanOrEqual(3);
    expect(webLeadEmails().sort()).toEqual(["owner0@realty0.com", "owner1@realty1.com", "owner2@realty2.com"]);
    expect((await store.listSheetRows(WEB_LEADS.id)).length).toBe(3);
  });

  it("still writes the leads when Google refuses the protections, and the run says so", async () => {
    fake.failProtection = true;
    const store = await storeWithLeads(2);
    const r = await syncSheet(store, new Date());
    expect(webLeadEmails()).toHaveLength(2);
    expect(r.errors.some((e) => e.startsWith("protection:"))).toBe(true);
    // The looks went through and are not redone; the protections are retried next sync.
    expect(await store.kvGet("sheet:spec-hash:test-sheet")).toBeTruthy();
    expect(await store.kvGet("sheet:protect-hash:test-sheet")).toBeNull();
    fake.failProtection = false;
    const again = await syncSheet(store, new Date());
    expect(again.errors).toEqual([]);
    expect(await store.kvGet("sheet:protect-hash:test-sheet")).toBeTruthy();
    expect(webLeadEmails()).toHaveLength(2); // no duplicates
  });

  it("the sheet-sync agent's run fails, not succeeds, when part of the sync failed", async () => {
    fake.failProtection = true;
    const store = await storeWithLeads(1);
    const { ctx } = await setup({ def: sheetSync });
    Object.assign(ctx, { store });
    await expect(sheetSync.run(ctx)).rejects.toThrow(/protection:/);
  });

  it("does not mark a row as written when the cell write failed, so the next sync retries it", async () => {
    const store = await storeWithLeads(1);
    await syncSheet(store, new Date());
    const [row] = await store.listSheetRows(WEB_LEADS.id);
    // The lead's data changes after it was placed, and the next write is refused.
    const l = (store as unknown as { leads: (Lead & { id: string })[] }).leads[0];
    l.company = "Realty Renamed";
    fake.failValueWrites = true;
    const r = await syncSheet(store, new Date());
    expect(r.updated).toBe(0);
    expect(r.errors.some((e) => e.startsWith("write:"))).toBe(true);
    expect((await store.getSheetRow(row.row_key))?.agent_hash).toBe(row.agent_hash);
    fake.failValueWrites = false;
    const ok = await syncSheet(store, new Date());
    expect(ok.updated).toBe(1);
    expect((await store.getSheetRow(row.row_key))?.agent_hash).not.toBe(row.agent_hash);
  });

  it("a lead's message is never read as a change you made, so it's never put back as an empty cell (2026-10-29)", async () => {
    const store = await storeWithLeads(2);
    await syncSheet(store, new Date());
    const before = (fake.rows.get(WEB_LEADS.name) ?? []).map((r) => r[1]);
    const r = await syncSheet(store, new Date());
    expect(r.changes).toBe(0);
    expect(r.refused).toBe(0);
    expect(fake.writes.some((w) => w.values.some((row) => row.some((v) => v === "")))).toBe(false);
    expect((fake.rows.get(WEB_LEADS.name) ?? []).map((row) => row[1])).toEqual(before);
  });

  it("a message the Sheet shows empty is written again on the next sync", async () => {
    const store = await storeWithLeads(1);
    await syncSheet(store, new Date());
    const rows = fake.rows.get(WEB_LEADS.name)!;
    const message = String(rows[0][1]);
    rows[0][1] = ""; // what the 18:00 sync left behind
    fake.writes = [];
    await syncSheet(store, new Date());
    expect(fake.writes.some((w) => w.range.startsWith("'Web Leads'!A2") && w.values[0].includes(message))).toBe(true);
  });

  it("a row the owner deleted is put back as it was, and nothing is recorded as sent, contacted or suppressed", async () => {
    const store = await storeWithLeads(2);
    await syncSheet(store, new Date());
    const rows = fake.rows.get(WEB_LEADS.name)!;
    const deletedKey = String(rows[0][KEY]);
    const before = await store.getSheetRow(deletedKey);
    fake.rows.set(WEB_LEADS.name, rows.slice(1)); // deleted by hand
    const r = await syncSheet(store, new Date());
    expect(r.restored).toBe(1);
    expect(r.errors).toEqual([]);
    expect((await store.getSheetRow(deletedKey))?.status).toBe("New");
    expect((await store.getSheetRow(deletedKey))?.owner_cols).toEqual(before?.owner_cols);
    expect(store.touches).toEqual([]);
    expect(store.suppression.size).toBe(0);
    expect(webLeadEmails().sort()).toEqual(["owner0@realty0.com", "owner1@realty1.com"]);
    // Once: the next sync finds it and adds nothing.
    const again = await syncSheet(store, new Date());
    expect([again.appended, again.restored]).toEqual([0, 0]);
    expect(webLeadEmails()).toHaveLength(2);
  });

  it("a draft that stopped waiting (sent from the admin page) comes off its tab, and isn't counted as sent again", async () => {
    const store = new MemoryStore();
    const { ctx } = await setup({ def: { ...(await import("./crew-helpers")).fakeAgent({ id: "replies-reddit" }) } });
    Object.assign(ctx, { store });
    const { propose } = await import("@/lib/crew/approvals");
    const made = await propose(ctx, { kind: "reply", title: "Reddit: cards", summary: "s", body: "I built SwiftCard for this, free to start.", platform: "reddit", targetUrl: "https://www.reddit.com/r/realtors/comments/abc123/x/", meta: { author: "jane" } });
    if (!made.ok) throw new Error(made.reason);
    await syncSheet(store, new Date());
    expect(fake.rows.get(REDDIT_REPLY.name)).toHaveLength(1);
    const { decide } = await import("@/lib/crew/decide");
    await decide(store, made.id, { action: "done_by_hand", by: "admin" });
    const r = await syncSheet(store, new Date());
    expect(r.removed).toBe(1);
    expect(r.restored).toBe(0);
    expect(fake.rows.get(REDDIT_REPLY.name)).toHaveLength(0);
  });

  it("the new layout replaces the old tabs once, and nothing that was on them counts as sent", async () => {
    // An older workbook: the old Dashboard and Controls, and a Web Leads tab in the old columns.
    fake.sheets = [{ sheetId: 1, title: "Dashboard" }, { sheetId: 2, title: "Controls" }, { sheetId: 3, title: WEB_LEADS.name }];
    const store = await storeWithLeads(2);
    for (const l of (store as unknown as { leads: (Lead & { id: string })[] }).leads) {
      await store.upsertSheetRow({ tab: WEB_LEADS.id, row_key: `L-${l.id.replace(/-/g, "").slice(0, 10)}`, entity_kind: "lead", entity_id: l.id, status: "New", owner_cols: {}, shown_status: "New", agent_hash: "old", synced_at: null, owner_edited_at: null });
    }
    fake.rows.set(WEB_LEADS.name, [["99", "old layout", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "L-whatever"]]);
    const r = await syncSheet(store, new Date());
    expect(r.errors).toEqual([]);
    expect(fake.sheets.map((x) => x.title)).not.toContain("Dashboard");
    expect(fake.sheets.map((x) => x.title)).not.toContain("Controls");
    expect(r.restored).toBe(0);
    expect(store.touches).toEqual([]);
    expect((await store.listSheetRows()).every((x) => x.status === "New")).toBe(true);
    expect(webLeadEmails().sort()).toEqual(["owner0@realty0.com", "owner1@realty1.com"]);
    expect(await store.kvGet("sheet:layout:test-sheet")).toBe(LAYOUT_VERSION);
    // Once only.
    const again = await syncSheet(store, new Date());
    expect(again.notes.some((n) => n.startsWith("Rebuilt"))).toBe(false);
  });

  it("stops before writing when the header rows can't be set up, and reports it", async () => {
    const store = await storeWithLeads(1);
    // The first structural batch (the tabs) is refused.
    vi.spyOn(fake.batches, "push").mockImplementationOnce(() => {
      throw new GoogleHttpError(400, "bad header", "spreadsheets.batchUpdate");
    });
    const r = await syncSheet(store, new Date());
    expect(r.errors[0]).toMatch(/^setup:/);
    expect(r.appended).toBe(0);
    expect(webLeadEmails()).toHaveLength(0);
  });
});

// ── Deleting is not sending; no lead drops off (owner, 2026-10-29) ──────────
describe("a Sheet row changes outreach only when the owner says so", () => {
  const MESSAGE = WEB_LEADS.columns.findIndex((c) => c.key === "message");
  const leadsOf = (store: MemoryStore) => (store as unknown as { leads: (Lead & { id: string })[] }).leads;
  /** Everything that says what happened with a person: statuses, touches, suppressions, approvals. */
  const outreach = async (store: MemoryStore) => ({
    statuses: (await store.listSheetRows()).map((r) => [r.row_key, r.status, JSON.stringify(r.owner_cols), r.owner_edited_at]).sort(),
    touches: store.touches.map((t) => [t.person_id, t.kind]),
    suppressed: [...store.suppression.keys()].sort(),
  });

  async function draft(store: MemoryStore) {
    const { ctx } = await setup({ def: (await import("./crew-helpers")).fakeAgent({ id: "replies-reddit" }) });
    Object.assign(ctx, { store });
    const { propose } = await import("@/lib/crew/approvals");
    const made = await propose(ctx, { kind: "reply", title: "Reddit: cards", summary: "s", body: "I built SwiftCard for this, free to start.", platform: "reddit", targetUrl: "https://www.reddit.com/r/realtors/comments/abc123/x/", meta: { author: "jane" } });
    if (!made.ok) throw new Error(made.reason);
    return made.id;
  }

  it("every row deleted at once comes back, leads and drafts, and nothing about anyone changes", async () => {
    const store = await storeWithLeads(3);
    const id = await draft(store);
    await syncSheet(store, new Date());
    const before = await outreach(store);
    fake.rows.set(WEB_LEADS.name, []);
    fake.rows.set(REDDIT_REPLY.name, []);
    const r = await syncSheet(store, new Date());
    expect(r.restored).toBe(4);
    expect(r.errors).toEqual([]);
    expect(await outreach(store)).toEqual(before);
    expect((await store.getApproval(id))?.status).toBe("pending");
    expect(webLeadEmails()).toHaveLength(3);
    expect(fake.rows.get(REDDIT_REPLY.name)).toHaveLength(1);
  });

  it("a row put back keeps the owner's own wording and when they changed it", async () => {
    const store = new MemoryStore();
    const id = await draft(store);
    await syncSheet(store, new Date());
    fake.rows.get(REDDIT_REPLY.name)![0][MESSAGE] = "My own words. I built SwiftCard, free to start.";
    await syncSheet(store, new Date());
    const [row] = await store.listSheetRows(REDDIT_REPLY.id);
    expect(row.owner_cols.message).toBe("My own words. I built SwiftCard, free to start.");
    fake.rows.set(REDDIT_REPLY.name, []);
    await syncSheet(store, new Date());
    expect(fake.rows.get(REDDIT_REPLY.name)![0][MESSAGE]).toBe("My own words. I built SwiftCard, free to start.");
    const [after] = await store.listSheetRows(REDDIT_REPLY.id);
    expect(after.owner_edited_at).toBe(row.owner_edited_at);
    expect((await store.getApproval(id))?.body).toBe("My own words. I built SwiftCard, free to start.");
  });

  it("never puts back a duplicate: not when the row only lost its Key, not when it sits on another tab", async () => {
    const store = await storeWithLeads(2);
    await syncSheet(store, new Date());
    const rows = fake.rows.get(WEB_LEADS.name)!;
    rows[0][KEY] = ""; // someone cleared the hidden Key
    const r = await syncSheet(store, new Date());
    expect(r.restored).toBe(0);
    expect(r.notRestored).toBe(1);
    expect(fake.rows.get(WEB_LEADS.name)).toHaveLength(2);
    // A row cut from Web Leads and pasted onto another tab, Key and all.
    const moved = fake.rows.get(WEB_LEADS.name)![1];
    fake.rows.set(WEB_LEADS.name, [fake.rows.get(WEB_LEADS.name)![0]]);
    fake.rows.set(REDDIT_REPLY.name, [moved]);
    const again = await syncSheet(store, new Date());
    expect(again.restored).toBe(0);
    expect(webLeadEmails()).toHaveLength(1);
    expect(store.touches).toEqual([]);
  });

  it('"sent" typed over a lead\'s message: Contacted, one emailed touch, the row comes off and stays off', async () => {
    const store = await storeWithLeads(2);
    await syncSheet(store, new Date());
    const rows = fake.rows.get(WEB_LEADS.name)!;
    const key = String(rows[0][KEY]);
    rows[0][MESSAGE] = "sent";
    const r = await syncSheet(store, new Date());
    expect(r.changes).toBe(1);
    expect((await store.getSheetRow(key))?.status).toBe("Contacted");
    expect(store.touches.filter((t) => t.kind === "emailed")).toHaveLength(1);
    expect(r.removed).toBe(1);
    expect(webLeadEmails()).toHaveLength(1);
    const again = await syncSheet(store, new Date());
    expect([again.appended, again.restored]).toEqual([0, 0]);
    expect(store.touches.filter((t) => t.kind === "emailed")).toHaveLength(1);
  });

  it('"sent" over a draft is done by hand; "skip" over a lead suppresses no one; "not interested" does', async () => {
    const store = await storeWithLeads(2);
    const id = await draft(store);
    await syncSheet(store, new Date());
    fake.rows.get(REDDIT_REPLY.name)![0][MESSAGE] = "Sent ✅";
    const web = fake.rows.get(WEB_LEADS.name)!;
    const [skipKey, noKey] = [String(web[0][KEY]), String(web[1][KEY])];
    const notInterested = webLeadEmails()[1];
    web[0][MESSAGE] = "skip";
    web[1][MESSAGE] = "Not interested";
    await syncSheet(store, new Date());
    expect((await store.getApproval(id))?.status).toBe("done");
    expect((await store.getSheetRow(skipKey))?.status).toBe("Skipped");
    expect((await store.getSheetRow(noKey))?.status).toBe("Not Interested");
    expect([...store.suppression.keys()]).toEqual([notInterested]);
    expect(store.touches.filter((t) => t.kind === "emailed")).toEqual([]);
    expect(fake.rows.get(REDDIT_REPLY.name)).toHaveLength(0);
    expect(fake.rows.get(WEB_LEADS.name)).toHaveLength(0);
  });

  it("a reworded draft that merely mentions sending is a rewrite, never a status", async () => {
    const store = new MemoryStore();
    const id = await draft(store);
    await syncSheet(store, new Date());
    fake.rows.get(REDDIT_REPLY.name)![0][MESSAGE] = "Sent you the link earlier. I built SwiftCard, free to start.";
    await syncSheet(store, new Date());
    expect((await store.getApproval(id))?.status).toBe("pending");
    expect((await store.getApproval(id))?.body).toContain("Sent you the link earlier");
  });

  it("a status set before keeps its word: a contacted lead stays off, the rest are listed", async () => {
    const store = await storeWithLeads(3);
    const [done] = leadsOf(store);
    const key = leadKey(done.id);
    await store.upsertSheetRow({ tab: `closed:${WEB_LEADS.id}`, row_key: key, entity_kind: "lead", entity_id: done.id, status: "Contacted", owner_cols: {}, shown_status: "Contacted", agent_hash: "h", synced_at: null, owner_edited_at: "2026-10-20T10:00:00Z" });
    const r = await syncSheet(store, new Date());
    expect((await store.getSheetRow(key))).toMatchObject({ status: "Contacted", owner_edited_at: "2026-10-20T10:00:00Z" });
    expect(webLeadEmails()).toHaveLength(2);
    expect(r.leads).toMatchObject({ listed: 2, unlisted: { finished: 1 } });
  });

  it("no lead drops off without a reason on record: leads with no message are listed, the rest counted by reason", async () => {
    const store = new MemoryStore();
    await store.insertLeads([
      { ...lead("a@one.com", "One"), message: null },
      lead("b@two.com", "Two"),
      { ...lead("c@three.co.uk", "Three"), region_restricted: true },
      { list: "office", name: "Maria Lopez", title: "Broker", email: null, phone: "7045550100", company: "Lopez Team", source_platform: "web", source_url: "paste:x" },
      { list: "office", name: "Sam Lee", title: "Owner", email: "sam@nomail.test", email_status: "No MX Record", phone: "2125550100", company: "Lee Group", source_platform: "web", source_url: "https://leegroup.test/team" },
    ]);
    const { ctx } = await setup({ def: sheetSync });
    Object.assign(ctx, { store });
    const out = await sheetSync.run(ctx);
    expect(ctx.stats).toMatchObject({ sheet_leads_listed: 3, sheet_leads_ready: 1, sheet_leads_need_message: 2, sheet_leads_not_listed_region_restricted: 1, sheet_leads_not_listed_no_link: 1, sheet_leads_not_listed_finished: 0 });
    expect(out.summary).toContain("leads on the Sheet: 3 (1 ready, 2 need a message); not listed: 1 kept off by the privacy rules, 1 with no email or website");
    const office = fake.rows.get("Office Prospects")!;
    expect(office.map((row) => row[0])).toEqual(["Sam Lee, Owner, Lee Group · 212 555 0100"]);
    expect(String(office[0][2])).toContain("https://leegroup.test/team"); // the domain takes no mail: the website
    const missing = ctx.notes.filter((l) => l.includes("not on the Sheet"));
    expect(missing).toHaveLength(2);
    for (const l of missing) expect(l).not.toMatch(/@|555/); // ids and reasons only
  });
});
