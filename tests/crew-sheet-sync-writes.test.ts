import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sheetSync } from "@/lib/crew/agents/sheet-sync";
import { GoogleHttpError } from "@/lib/crew/google/auth";
import { SHEET_COLORS, bodyRowRequests, specHash, workbookRequests } from "@/lib/crew/sheets/bootstrap";
import { leadKey, type BuiltRow } from "@/lib/crew/sheets/rows";
import { commandFor } from "@/lib/crew/sheets/apply";
import { LAYOUT_VERSION, ambiguousKeys, syncSheet } from "@/lib/crew/sheets/sync";
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

type Fake = {
  sheets: { sheetId: number; title: string }[];
  rows: Map<string, unknown[][]>;
  failProtection: boolean;
  failValueWrites: boolean;
  failRowFormat: boolean;
  batches: Record<string, unknown>[][];
  writes: { range: string; values: unknown[][] }[];
  /** Alternating bands and conditional rules on each tab, as Google keeps them. */
  bands: Map<number, number[]>;
  rules: Map<number, { backgroundColor?: Record<string, number> }[]>;
  protections: { protectedRangeId: number; sheetId: number; description?: string; warningOnly?: boolean; editors?: { users: string[] } }[];
};
const fake: Fake = { sheets: [], rows: new Map(), failProtection: false, failValueWrites: false, failRowFormat: false, batches: [], writes: [], bands: new Map(), rules: new Map(), protections: [] };
let nextId = 1;

const tabOf = (range: string) => decodeURIComponent(range).replace(/^'/, "").replace(/'!.*$/, "").replace(/''/g, "'");
const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200 });

/** What Google says about one spreadsheets.batchUpdate request, or null when it accepts it. */
function refusal(req: Record<string, unknown>, bandsGone: Set<number> = new Set()): string | null {
  const add = req.addProtectedRange as { protectedRange: { range: Record<string, unknown>; unprotectedRanges?: unknown[] } } | undefined;
  const band = req.addBanding as { bandedRange: { range: { sheetId: number } } } | undefined;
  if (band && (fake.bands.get(band.bandedRange.range.sheetId) ?? []).some((id) => !bandsGone.has(id))) return "Cannot add alternating background colors to a range that already has alternating background colors.";
  if (fake.failRowFormat && (req.repeatCell as { range?: { endRowIndex?: number } } | undefined)?.range?.endRowIndex !== undefined) return "Internal error";
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
      if (url.includes("fields=sheets.protectedRanges")) return json({ sheets: fake.sheets.map((x) => ({ protectedRanges: fake.protections.filter((p) => p.sheetId === x.sheetId) })) });
      if (url.includes("fields=sheets(properties.sheetId,bandedRanges")) {
        // Like Google: a sheetId of 0 and empty lists are left out.
        return json({ sheets: fake.sheets.map((x) => ({ properties: x.sheetId ? { sheetId: x.sheetId } : {}, bandedRanges: (fake.bands.get(x.sheetId) ?? []).map((bandedRangeId) => ({ bandedRangeId })), conditionalFormats: (fake.rules.get(x.sheetId) ?? []).map((format) => ({ booleanRule: { format } })) })) });
      }
      if (url.includes("?fields=spreadsheetId")) return json({ spreadsheetId: "test-sheet", spreadsheetUrl: "https://example.test", properties: { title: "SwiftCard Leads" }, sheets: fake.sheets.map((s, index) => ({ properties: { ...s, index } })) });
      if (url.endsWith("/:batchUpdate")) {
        const requests = body.requests as Record<string, unknown>[];
        // Atomic like Google: one bad request and nothing in the batch applies.
        // In order, like Google: a band deleted earlier in the batch no longer counts.
        const bandsGone = new Set<number>();
        for (const [i, r] of requests.entries()) {
          const gone = r.deleteBanding as { bandedRangeId: number } | undefined;
          if (gone) bandsGone.add(gone.bandedRangeId);
          const why = refusal(r, bandsGone);
          if (why) throw new real.GoogleHttpError(400, JSON.stringify({ error: { code: 400, message: `Invalid requests[${i}]: ${why}` } }), "spreadsheets.batchUpdate");
        }
        fake.batches.push(requests);
        for (const r of requests) {
          const ab = r.addBanding as { bandedRange: { range: { sheetId: number } } } | undefined;
          if (ab) fake.bands.set(ab.bandedRange.range.sheetId, [...(fake.bands.get(ab.bandedRange.range.sheetId) ?? []), nextId++]);
          const db = r.deleteBanding as { bandedRangeId: number } | undefined;
          if (db) for (const [k, v] of fake.bands) fake.bands.set(k, v.filter((x) => x !== db.bandedRangeId));
          const ar = r.addConditionalFormatRule as { rule: { ranges: { sheetId: number }[]; booleanRule: { format: { backgroundColor?: Record<string, number> } } }; index: number } | undefined;
          if (ar) {
            const list = fake.rules.get(ar.rule.ranges[0].sheetId) ?? [];
            list.splice(ar.index, 0, { backgroundColor: ar.rule.booleanRule.format.backgroundColor });
            fake.rules.set(ar.rule.ranges[0].sheetId, list);
          }
          const dr = r.deleteConditionalFormatRule as { sheetId: number; index: number } | undefined;
          if (dr) fake.rules.get(dr.sheetId)?.splice(dr.index, 1);
          const ap = r.addProtectedRange as { protectedRange: { range: { sheetId: number }; description?: string; warningOnly?: boolean; editors?: { users: string[] } } } | undefined;
          if (ap) fake.protections.push({ protectedRangeId: nextId++, sheetId: ap.protectedRange.range.sheetId, description: ap.protectedRange.description, warningOnly: ap.protectedRange.warningOnly, editors: ap.protectedRange.editors });
          const dp = r.deleteProtectedRange as { protectedRangeId: number } | undefined;
          if (dp) fake.protections = fake.protections.filter((x) => x.protectedRangeId !== dp.protectedRangeId);
          const add = r.addSheet as { properties: { title: string } } | undefined;
          if (add) fake.sheets.push({ sheetId: 1000 + nextId++, title: add.properties.title }); // unique, like Google: never reused after a delete
          const del = r.deleteSheet as { sheetId: number } | undefined;
          if (del) {
            const gone = fake.sheets.find((x) => x.sheetId === del.sheetId);
            fake.sheets = fake.sheets.filter((x) => x.sheetId !== del.sheetId);
            if (gone) fake.rows.delete(gone.title);
            fake.bands.delete(del.sheetId);
            fake.rules.delete(del.sheetId);
            fake.protections = fake.protections.filter((x) => x.sheetId !== del.sheetId);
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
        // Like Google, the cells now say what was written.
        for (const w of body.data as { range: string; values: unknown[][] }[]) {
          const m = /!([A-Z])(\d+)(?::[A-Z]\d+)?$/.exec(w.range);
          const row = m ? fake.rows.get(tabOf(w.range))?.[Number(m[2]) - 2] : undefined;
          if (m && row) w.values[0].forEach((v, k) => (row[m[1].charCodeAt(0) - 65 + k] = v));
        }
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
  Object.assign(fake, { sheets: [{ sheetId: 0, title: "Sheet1" }], rows: new Map(), failProtection: false, failValueWrites: false, failRowFormat: false, batches: [], writes: [], bands: new Map(), rules: new Map(), protections: [] });
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

  it("a row cut from one tab and pasted on another, Key and all, isn't added again, and the sync says where it is", async () => {
    const store = await storeWithLeads(2);
    await syncSheet(store, new Date());
    const [stay, moved] = fake.rows.get(WEB_LEADS.name)!;
    fake.rows.set(WEB_LEADS.name, [stay]);
    fake.rows.set(REDDIT_REPLY.name, [moved]);
    const again = await syncSheet(store, new Date());
    expect([again.restored, again.notRestored]).toEqual([0, 1]);
    expect(again.errors).toContain("Reddit Reply row 2: belongs on Web Leads. Not added there again, so it isn't a duplicate.");
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

// ── A row counts only while it still belongs to its Key (2026-11-01) ────────
describe("a Sheet row whose visible cells and Key have come apart", () => {
  const NAME = WEB_LEADS.columns.findIndex((c) => c.key === "name");
  const MESSAGE = WEB_LEADS.columns.findIndex((c) => c.key === "message");
  const web = () => fake.rows.get(WEB_LEADS.name)!;
  const leadsOf = (store: MemoryStore) => (store as unknown as { leads: (Lead & { id: string })[] }).leads;
  /** The visible columns of two rows swapped, the Keys left where they were: sorting a selection that stops at Link. */
  const swapVisible = (a: unknown[], b: unknown[]) => {
    for (const k of [NAME, MESSAGE, LINK]) [a[k], b[k]] = [b[k], a[k]];
  };
  const nothingHappened = async (store: MemoryStore) => {
    expect(store.touches).toEqual([]);
    expect(store.suppression.size).toBe(0);
    expect((await store.listSheetRows()).every((r) => r.status === "New" && r.owner_edited_at === null)).toBe(true);
  };
  const statusOf = async (store: MemoryStore, id: string) => (await store.getSheetRow(leadKey(id)))?.status;
  const keyOfLeadWith = (store: MemoryStore, email: string) => leadKey(leadsOf(store).find((l) => l.email === email)!.id);

  it("sorted without the Key, nothing typed: each row is rewritten from the database, with no status or touch, and stays right", async () => {
    const store = await storeWithLeads(3);
    await syncSheet(store, new Date());
    const before = web().map((r) => [...r]);
    swapVisible(web()[0], web()[1]);
    const r = await syncSheet(store, new Date());
    expect(r.reconciled).toBe(2);
    expect(r.rowProblems).toEqual([{ tab: WEB_LEADS.name, rows: [2, 3], problem: "wrong_key" }]);
    expect(r.notes.join(" ")).toContain("Web Leads rows 2, 3");
    expect(r.errors).toEqual([]);
    expect(web()).toEqual(before);
    await nothingHappened(store);
    const again = await syncSheet(store, new Date());
    expect([again.reconciled, again.restored, again.appended]).toEqual([0, 0, 0]);
  });

  for (const [typed, what] of [["sent", "no touch"], ["not interested", "no suppression"], ["unsubscribed", "no suppression"], ["skip", "no status"]] as const) {
    it(`"${typed}" typed next to the wrong Key: ${what}, the typed row is left alone, and the sync fails naming the tab and row`, async () => {
      const store = await storeWithLeads(2);
      await syncSheet(store, new Date());
      swapVisible(web()[0], web()[1]);
      web()[0][MESSAGE] = typed;
      const typedRow = [...web()[0]];
      const r = await syncSheet(store, new Date());
      await nothingHappened(store);
      expect(r.changes).toBe(0);
      expect(web()[0]).toEqual(typedRow);
      expect(r.rowProblems).toContainEqual({ tab: WEB_LEADS.name, rows: [2], problem: "wrong_key" });
      expect(r.errors.join(" ")).toMatch(/^Web Leads row 2: /);
      expect(r.errors.join(" ")).not.toMatch(/@/);
      expect(r.removed).toBe(0);
    });
  }

  it("the sync's run fails rather than reporting success, and clears once the owner's row is fixed", async () => {
    const store = await storeWithLeads(2);
    await syncSheet(store, new Date());
    const message = String(web()[0][MESSAGE]);
    swapVisible(web()[0], web()[1]);
    web()[0][MESSAGE] = "sent";
    const { ctx } = await setup({ def: sheetSync });
    Object.assign(ctx, { store });
    await expect(sheetSync.run(ctx)).rejects.toThrow(/Web Leads row 2: /);
    web()[0][MESSAGE] = ""; // the owner clears the word
    const r = await syncSheet(store, new Date());
    expect(r.errors).toEqual([]);
    expect(String(web()[0][MESSAGE])).toBe(message);
    await nothingHappened(store);
  });

  it("two leads with the same Name: their Links tell them apart, so \"sent\" can't mark the other one", async () => {
    const store = new MemoryStore();
    await store.insertLeads([lead("a@acme.com", "Acme Realty"), lead("b@acme.com", "Acme Realty")]);
    await syncSheet(store, new Date());
    expect(web()[0][NAME]).toBe(web()[1][NAME]);
    swapVisible(web()[0], web()[1]);
    web()[0][MESSAGE] = "sent";
    const r = await syncSheet(store, new Date());
    await nothingHappened(store);
    expect(r.rowProblems.length).toBeGreaterThan(0);
  });

  it("a Link read back as Google shows it (its label) still matches; so does an Office Name from before the phone was added", async () => {
    const store = new MemoryStore();
    await store.insertLeads([{ list: "office", name: "Maria Lopez", title: "Broker", email: "maria@lopez.test", phone: "2125550100", company: "Lopez Team", source_platform: "web", source_url: "https://lopez.test/team", message: "Hi Maria, this is [your name] from SwiftCard." }]);
    await syncSheet(store, new Date());
    const office = fake.rows.get("Office Prospects")!;
    office[0][NAME] = "Maria Lopez, Broker, Lopez Team";
    office[0][LINK] = "Email maria@lopez.test";
    office[0][MESSAGE] = "sent";
    await syncSheet(store, new Date());
    expect(await statusOf(store, leadsOf(store)[0].id)).toBe("Contacted");
    expect(store.touches.filter((t) => t.kind === "emailed")).toHaveLength(1);
  });

  it("cut and pasted over another row without the Key: both rows are rebuilt, nothing is lost, added or marked", async () => {
    const store = await storeWithLeads(3);
    await syncSheet(store, new Date());
    const before = web().map((r) => [...r]);
    for (const k of [NAME, MESSAGE, LINK]) {
      web()[1][k] = web()[0][k];
      web()[0][k] = "";
    }
    const r = await syncSheet(store, new Date());
    expect(r.reconciled).toBe(2);
    expect(web()).toEqual(before);
    expect([r.appended, r.restored]).toEqual([0, 0]);
    await nothingHappened(store);
  });

  it("a rewording sitting next to the wrong Key changes no draft and isn't overwritten", async () => {
    const store = new MemoryStore();
    const { ctx } = await setup({ def: (await import("./crew-helpers")).fakeAgent({ id: "replies-reddit" }) });
    Object.assign(ctx, { store });
    const { propose } = await import("@/lib/crew/approvals");
    const ids: string[] = [];
    for (const n of [1, 2]) {
      const made = await propose(ctx, { kind: "reply", title: `Reddit ${n}`, summary: "s", body: `Draft ${n}. I built SwiftCard, free to start.`, platform: "reddit", targetUrl: `https://www.reddit.com/r/realtors/comments/abc${n}/x/`, meta: { author: `jane${n}` } });
      if (!made.ok) throw new Error(made.reason);
      ids.push(made.id);
    }
    await syncSheet(store, new Date());
    const rows = fake.rows.get(REDDIT_REPLY.name)!;
    swapVisible(rows[0], rows[1]);
    rows[0][MESSAGE] = "My own words for this one. SwiftCard, free to start.";
    const r = await syncSheet(store, new Date());
    expect(r.changes).toBe(0);
    expect(rows[0][MESSAGE]).toBe("My own words for this one. SwiftCard, free to start.");
    expect((await store.getApproval(ids[0]))?.body).toBe("Draft 1. I built SwiftCard, free to start.");
    expect((await store.getApproval(ids[1]))?.body).toBe("Draft 2. I built SwiftCard, free to start.");
    expect(await store.recentEdits("replies-reddit", "reply", 30)).toEqual([]);
    expect(r.errors.join(" ")).toMatch(/^Reddit Reply row 2: /);
  });

  it("the agent's own message being a status word is never an instruction, and the owner's other words still count", async () => {
    expect(commandFor("Sent.", "Sent", "lead")).toBeNull();
    expect(commandFor("sent", "Done", "lead")).toBeNull(); // the same action
    expect(commandFor("skip", "Sent", "lead")).toBe("Skipped");
    expect(commandFor("sent", "Hi Dana, I built SwiftCard.", "lead")).toBe("Contacted");
    expect(commandFor("Sent you the link", "x", "lead")).toBeNull();
    const store = new MemoryStore();
    await store.insertLeads([{ ...lead("a@one.com", "One"), message: "Sent" }]);
    await syncSheet(store, new Date());
    expect(web()[0][MESSAGE]).toBe("Sent");
    const r = await syncSheet(store, new Date());
    expect(r.changes).toBe(0);
    await nothingHappened(store);
  });

  it("\"sent\" counts once: the status and the touch don't repeat while the row is still there", async () => {
    const store = await storeWithLeads(3);
    await syncSheet(store, new Date());
    const key = String(web()[0][KEY]);
    web()[0][MESSAGE] = "sent";
    swapVisible(web()[1], web()[2]);
    web()[1][MESSAGE] = "My own words"; // stays until it's fixed, and holds the sent row on the tab
    for (let i = 0; i < 3; i++) await syncSheet(store, new Date());
    expect((await store.getSheetRow(key))?.status).toBe("Contacted");
    expect(store.touches.filter((t) => t.kind === "emailed")).toHaveLength(1);
    expect(web().some((row) => row[KEY] === key)).toBe(true);
    web()[1][MESSAGE] = ""; // fixed: the row comes off at the next sync
    await syncSheet(store, new Date());
    await syncSheet(store, new Date());
    expect(web().some((row) => row[KEY] === key)).toBe(false);
    expect(store.touches.filter((t) => t.kind === "emailed")).toHaveLength(1);
  });

  describe("a non-empty row with no valid Key", () => {
    for (const [label, bad] of [["empty", ""], ["not a Key", "oops"], ["almost a Key", "L-XYZ"]] as const) {
      it(`Key ${label}, Name changed too: no replacement row, the row untouched, tab and row number reported`, async () => {
        const store = await storeWithLeads(3);
        await syncSheet(store, new Date());
        const keyOfRow = String(web()[1][KEY]);
        web()[1][KEY] = bad;
        web()[1][NAME] = "Someone renamed this";
        const lost = [...web()[1]];
        const count = web().length;
        fake.writes = [];
        fake.batches = [];
        const r = await syncSheet(store, new Date());
        expect([r.restored, r.notRestored, r.appended]).toEqual([0, 1, 0]);
        expect(web()).toHaveLength(count);
        expect(web()[1]).toEqual(lost);
        expect(fake.writes.some((w) => w.range.includes("A3") || w.range.includes("B3"))).toBe(false);
        expect(fake.batches.flat().some((b) => "deleteDimension" in b)).toBe(false);
        expect(r.rowProblems).toEqual([{ tab: WEB_LEADS.name, rows: [3], problem: "no_key" }]);
        expect(r.errors[0]).toMatch(/^Web Leads row 3: no valid Key/);
        expect((await store.getSheetRow(keyOfRow))?.status).toBe("New");
        await nothingHappened(store);
      });
    }

    it("several rows: every one is named, a word typed in one counts for nothing, and the run fails", async () => {
      const store = await storeWithLeads(4);
      await syncSheet(store, new Date());
      web()[0][KEY] = "";
      web()[0][MESSAGE] = "sent";
      web()[3][KEY] = "";
      const r = await syncSheet(store, new Date());
      expect(r.rowProblems).toEqual([{ tab: WEB_LEADS.name, rows: [2, 5], problem: "no_key" }]);
      expect(r.errors[0]).toMatch(/^Web Leads rows 2, 5: /);
      await nothingHappened(store);
      const { ctx } = await setup({ def: sheetSync });
      Object.assign(ctx, { store });
      await expect(sheetSync.run(ctx)).rejects.toThrow(/Web Leads rows 2, 5: /);
    });

    it("nothing on that tab moves: no new row, no row back, no status, no repair, your words kept; it all lands once when fixed", async () => {
      const store = await storeWithLeads(4);
      await syncSheet(store, new Date());
      const [badEmail, sentKey] = [webLeadEmails()[0], String(web()[1][KEY])];
      const missing = web()[3];
      web()[0][KEY] = "";
      web()[0][MESSAGE] = "My own note about this one";
      web()[1][MESSAGE] = "sent"; // a word in a row that's fine, on a tab that isn't
      web().pop();
      await store.insertLeads([lead("new@fresh.com", "Fresh")]);
      const frozen = web().map((row) => [...row]);
      fake.writes = [];
      fake.batches = [];
      const r = await syncSheet(store, new Date());
      expect([r.appended, r.restored, r.changes, r.reconciled, r.removed]).toEqual([0, 0, 0, 0, 0]);
      expect([r.notAdded, r.notRestored]).toEqual([1, 2]); // the lead with no Key on its row, and the deleted row
      expect(web()).toEqual(frozen);
      expect(fake.writes.filter((w) => w.range.includes(WEB_LEADS.name))).toEqual([]);
      expect(fake.batches.flat().some((b) => "deleteDimension" in b)).toBe(false);
      expect(r.errors[0]).toMatch(/^Web Leads row 2: no valid Key/);
      await nothingHappened(store);
      // The owner deletes the row with no Key.
      fake.rows.set(WEB_LEADS.name, web().slice(1));
      const fixed = await syncSheet(store, new Date());
      expect(fixed.errors).toEqual([]);
      expect((await store.getSheetRow(sentKey))?.status).toBe("Contacted");
      expect(store.touches.filter((t) => t.kind === "emailed")).toHaveLength(1);
      expect(webLeadEmails()).toContain("new@fresh.com");
      expect(webLeadEmails()).toContain(badEmail);
      expect(web().some((row) => row[KEY] === missing[KEY])).toBe(true);
      expect(new Set(web().map((row) => row[KEY])).size).toBe(web().length);
      const again = await syncSheet(store, new Date());
      expect([again.appended, again.restored]).toEqual([0, 0]);
    });

    it("rows that came apart from their Keys, or whose lead changed, aren't rewritten while the tab is waiting; they are once it's fixed", async () => {
      const store = await storeWithLeads(4);
      await syncSheet(store, new Date());
      web()[0][KEY] = "";
      swapVisible(web()[1], web()[2]);
      const frozen = web().map((row) => [...row]);
      leadsOf(store).find((l) => leadKey(l.id) === web()[3][KEY])!.company = "Renamed";
      fake.writes = [];
      const r = await syncSheet(store, new Date());
      expect([r.reconciled, r.updated]).toEqual([0, 0]);
      expect(web()).toEqual(frozen);
      expect(fake.writes).toEqual([]);
      fake.rows.set(WEB_LEADS.name, web().slice(1));
      const fixed = await syncSheet(store, new Date());
      expect(fixed.reconciled).toBe(3); // the two that came apart, and the renamed one, whose Name no longer matches
      expect(web().some((row) => String(row[NAME]) === "Renamed")).toBe(true);
    });

    it("another tab carries on: its new rows land and its typed words count", async () => {
      const store = await storeWithLeads(2);
      const { ctx } = await setup({ def: (await import("./crew-helpers")).fakeAgent({ id: "replies-reddit" }) });
      Object.assign(ctx, { store });
      const { propose } = await import("@/lib/crew/approvals");
      const made = await propose(ctx, { kind: "reply", title: "Reddit: cards", summary: "s", body: "I built SwiftCard for this, free to start.", platform: "reddit", targetUrl: "https://www.reddit.com/r/realtors/comments/abc123/x/", meta: { author: "jane" } });
      if (!made.ok) throw new Error(made.reason);
      await syncSheet(store, new Date());
      web()[0][KEY] = "";
      const later = await propose(ctx, { kind: "reply", title: "Reddit: links", summary: "s", body: "SwiftCard does that too, free to start.", platform: "reddit", targetUrl: "https://www.reddit.com/r/realtors/comments/def456/y/", meta: { author: "sam" } });
      if (!later.ok) throw new Error(later.reason);
      fake.rows.get(REDDIT_REPLY.name)![0][MESSAGE] = "sent";
      const r = await syncSheet(store, new Date());
      expect((await store.getApproval(made.id))?.status).toBe("done");
      expect(fake.rows.get(REDDIT_REPLY.name)!.some((row) => String(row[NAME]).includes("sam"))).toBe(true);
      expect(r.rowProblems).toEqual([{ tab: WEB_LEADS.name, rows: [2], problem: "no_key" }]);
    });

    it("a whole row copied, Key and all: the copy is reported, nothing is added, and a word in the copy counts for nothing", async () => {
      const store = await storeWithLeads(2);
      await syncSheet(store, new Date());
      web().push([...web()[0]]);
      web()[2][MESSAGE] = "sent";
      web()[1][MESSAGE] = "not interested"; // a healthy row, on a tab that's waiting
      const r = await syncSheet(store, new Date());
      expect(r.rowProblems).toEqual([{ tab: WEB_LEADS.name, rows: [4], problem: "no_key" }]);
      expect(r.appended).toBe(0);
      await nothingHappened(store);
    });

    it("an entirely empty row isn't a problem", async () => {
      const store = await storeWithLeads(2);
      await syncSheet(store, new Date());
      web().splice(1, 0, ["", "", "", ""]);
      const r = await syncSheet(store, new Date());
      expect(r.errors).toEqual([]);
      expect(r.rowProblems).toEqual([]);
    });
  });

  describe("two rows with the same Name and Link", () => {
    const OFFICE = "Office Prospects";
    const office = () => fake.rows.get(OFFICE)!;
    /** Same person, title, company and phone, no email: only the (unreadable) link's address differs. */
    const twin = (path: string): Lead => ({ list: "office", name: "Sam Lee", title: "Broker", email: null, phone: "2125550100", company: "Lee Group", source_platform: "web", source_url: `https://leegroup.test/${path}`, message: `Hi Sam, this is [your name] from SwiftCard about ${path}.` });

    it("are found whatever the capitals and spaces, and only when both Name and Link match", () => {
      const row = (key: string, name: string, link: string) => ({ key, cells: { name, link, message: "m" } }) as unknown as BuiltRow;
      expect([...ambiguousKeys([row("L-1", "Sam  Lee", "Open their website"), row("L-2", "sam lee", '=HYPERLINK("https://b.test","Open their website")'), row("L-3", "Sam Lee", "Email sam@x.test"), row("L-4", "Dana", "Open their website")])].sort()).toEqual(["L-1", "L-2"]);
    });

    for (const word of ["sent", "not interested", "unsubscribed", "skip"]) {
      it(`"${word}" in one: no status, no touch, no suppression, the word stays, and the sync fails naming the row`, async () => {
        const store = new MemoryStore();
        await store.insertLeads([twin("a"), twin("b")]);
        await syncSheet(store, new Date());
        office()[0][MESSAGE] = word;
        const other = String(office()[1][MESSAGE]);
        const r = await syncSheet(store, new Date());
        await nothingHappened(store);
        expect(r.changes).toBe(0);
        expect(office()[0][MESSAGE]).toBe(word);
        expect(office()[1][MESSAGE]).toBe(other);
        expect(r.ambiguous).toBe(2);
        expect(r.rowProblems).toEqual([{ tab: OFFICE, rows: [2, 3], problem: "ambiguous" }]);
        expect(r.errors).toEqual([`${OFFICE} row 2: something was typed, but another row has the same Name and Link, so it wasn't acted on and was left as it is.`]);
      });
    }

    it("with nothing typed the run succeeds and says so; the lead records are untouched", async () => {
      const store = new MemoryStore();
      await store.insertLeads([twin("a"), twin("b")]);
      const saved = JSON.stringify(leadsOf(store));
      await syncSheet(store, new Date());
      const { ctx } = await setup({ def: sheetSync });
      Object.assign(ctx, { store });
      const out = await sheetSync.run(ctx);
      expect(out.summary).toContain(`${OFFICE} rows 2, 3: the same Name and Link as another row`);
      expect(ctx.stats.sheet_rows_ambiguous).toBe(2);
      expect(JSON.stringify(leadsOf(store))).toBe(saved);
      await nothingHappened(store);
    });

    it("the same Name with a different email isn't ambiguous: the word counts for that lead alone", async () => {
      const store = new MemoryStore();
      await store.insertLeads([{ ...twin("a"), email: "a@leegroup.test" }, { ...twin("b"), email: "b@leegroup.test" }]);
      await syncSheet(store, new Date());
      const key = String(office()[0][KEY]);
      office()[0][MESSAGE] = "sent";
      const r = await syncSheet(store, new Date());
      expect(r.ambiguous).toBe(0);
      expect((await store.getSheetRow(key))?.status).toBe("Contacted");
      expect(store.touches.filter((t) => t.kind === "emailed")).toHaveLength(1);
    });

    it("two drafts to one person: neither a status word nor a rewording lands on either", async () => {
      const store = new MemoryStore();
      const { ctx } = await setup({ def: (await import("./crew-helpers")).fakeAgent({ id: "replies-reddit" }) });
      Object.assign(ctx, { store });
      const { propose } = await import("@/lib/crew/approvals");
      const ids: string[] = [];
      for (const n of [1, 2]) {
        const made = await propose(ctx, { kind: "reply", title: `Reddit ${n}`, summary: "s", body: `Draft ${n}. I built SwiftCard, free to start.`, platform: "reddit", targetUrl: `https://www.reddit.com/r/realtors/comments/abc${n}/x/`, meta: { author: "jane" } });
        if (!made.ok) throw new Error(made.reason);
        ids.push(made.id);
      }
      await syncSheet(store, new Date());
      const rows = fake.rows.get(REDDIT_REPLY.name)!;
      rows[0][MESSAGE] = "sent";
      rows[1][MESSAGE] = "My own words. SwiftCard, free to start.";
      const r = await syncSheet(store, new Date());
      expect(r.changes).toBe(0);
      expect((await store.getApproval(ids[0]))).toMatchObject({ status: "pending", body: "Draft 1. I built SwiftCard, free to start." });
      expect((await store.getApproval(ids[1]))).toMatchObject({ status: "pending", body: "Draft 2. I built SwiftCard, free to start." });
      expect(rows[1][MESSAGE]).toBe("My own words. SwiftCard, free to start.");
      expect(r.errors[0]).toMatch(/^Reddit Reply rows 2, 3: something was typed/);
    });

    it("once only one is left open, it can be told apart again", async () => {
      const store = new MemoryStore();
      await store.insertLeads([twin("a"), twin("b")]);
      await syncSheet(store, new Date());
      const [first, second] = [String(office()[0][KEY]), String(office()[1][KEY])];
      await store.patchSheetRow(first, { status: "Not Interested" });
      await syncSheet(store, new Date());
      office()[0][MESSAGE] = "skip";
      const r = await syncSheet(store, new Date());
      expect(r.ambiguous).toBe(0);
      expect((await store.getSheetRow(second))?.status).toBe("Skipped");
    });
  });
});

// ── Readable rows, a locked header and Key (2026-11-02) ─────────────────────
// The owner: dark charcoal rows with dark text, blue links on dark, and the
// Name header could be edited. Google gives a row it inserts the format of
// the row above, and the first row on a tab sits under the dark header; the
// body formatting set the text but never the fill. The header row had no
// protection at all and the Key's was a warning anyone could click through.
describe("the workbook's colours and locks", () => {
  const SA = "sync@swiftcard.iam.gserviceaccount.com";
  const sheets = ALL_TABS.map((t, i) => ({ sheetId: i + 1, title: t.name }));
  const rowTabs = ALL_TABS.filter((t) => t.layout !== "free");
  type Range = { sheetId: number; startRowIndex?: number; endRowIndex?: number; startColumnIndex?: number; endColumnIndex?: number };
  type Prot = { range: Range; warningOnly: boolean; editors?: { users: string[] }; description: string };
  const prots = (o: { editor?: string | null } = { editor: SA }) => workbookRequests(sheets, o).protection.map((r) => (r.addProtectedRange as { protectedRange: Prot }).protectedRange);
  const covers = (r: Range, row: number, col: number) => row >= (r.startRowIndex ?? 0) && (r.endRowIndex === undefined || row < r.endRowIndex) && col >= (r.startColumnIndex ?? 0) && (r.endColumnIndex === undefined || col < r.endColumnIndex);

  it("locks every tab's header row to the service account alone, and warns on every Key", () => {
    for (const t of rowTabs) {
      const sid = sheets.find((s) => s.title === t.name)!.sheetId;
      const mine = prots().filter((p) => p.range.sheetId === sid);
      for (let col = 0; col < t.columns.length; col++) {
        const header = mine.filter((p) => covers(p.range, 0, col));
        expect(header, `${t.name} header col ${col}`).toHaveLength(1);
        expect(header[0]).toMatchObject({ warningOnly: false, editors: { users: [SA] } });
      }
      if (t.columns.at(-1)?.kind === "key") {
        for (const row of [1, 50, 5000]) {
          const key = mine.filter((p) => covers(p.range, row, t.columns.length - 1));
          expect(key).toHaveLength(1);
          // A warning, so sorting or deleting whole rows still works (SETUP.md).
          expect(key[0].warningOnly).toBe(true);
          expect(key[0].editors).toBeUndefined();
        }
      }
      // The next refresh finds each again and replaces it, so they never pile up.
      for (const p of mine) expect(p.description).toMatch(/backend|Key column/);
    }
  });

  it("leaves every Message, Name and Link cell below the header editable", () => {
    for (const t of rowTabs) {
      const sid = sheets.find((s) => s.title === t.name)!.sheetId;
      t.columns.forEach((c, col) => {
        if (c.kind === "key") return;
        for (const row of [1, 2, 999]) expect(prots().some((p) => p.range.sheetId === sid && covers(p.range, row, col)), `${t.name} ${c.header} row ${row}`).toBe(false);
      });
    }
  });

  it("falls back to a warning, never a lock nobody can lift, without the service account's address", () => {
    for (const p of prots({ editor: null })) {
      expect(p.warningOnly).toBe(true);
      expect(p.editors).toBeUndefined();
    }
  });

  // WCAG 2 contrast.
  const lum = (c: Record<string, number>) => {
    const ch = (v: number) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    return 0.2126 * ch(c.red ?? 0) + 0.7152 * ch(c.green ?? 0) + 0.0722 * ch(c.blue ?? 0);
  };
  const contrast = (a: Record<string, number>, b: Record<string, number>) => {
    const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
  };

  it("reads at WCAG AA or better: white on the dark header, dark text and dark blue links on both light bands", () => {
    const C = SHEET_COLORS;
    expect(contrast(C.headerText, C.headerBg)).toBeGreaterThanOrEqual(7);
    for (const band of [C.band1, C.band2]) {
      expect(lum(band)).toBeGreaterThan(0.85); // light, never charcoal
      expect(contrast(C.ink, band)).toBeGreaterThanOrEqual(7);
      expect(contrast(C.link, band)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(C.key, band)).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrast(C.needsText, C.needsBg)).toBeGreaterThanOrEqual(4.5);
    expect(lum(C.needsBg)).toBeGreaterThan(0.6);
  });

  it("gives every body cell its own light look: clears any fill, dark text, dark blue underlined links", () => {
    const reqs = bodyRowRequests(WEB_LEADS, 7, 1);
    expect(reqs).toHaveLength(WEB_LEADS.columns.length);
    for (const [k, r] of reqs.entries()) {
      const rc = r.repeatCell as { range: Range; cell: { userEnteredFormat: { backgroundColor?: unknown; textFormat: { foregroundColor: unknown; underline?: boolean } } }; fields: string };
      expect(rc.fields).toMatch(/backgroundColor,backgroundColorStyle/);
      expect(rc.fields).toMatch(/textFormat/);
      expect(rc.cell.userEnteredFormat.backgroundColor).toBeUndefined();
      expect(rc.range).toEqual({ sheetId: 7, startRowIndex: 1, startColumnIndex: k, endColumnIndex: k + 1 });
      const want = WEB_LEADS.columns[k].kind === "link" ? SHEET_COLORS.link : WEB_LEADS.columns[k].kind === "key" ? SHEET_COLORS.key : SHEET_COLORS.ink;
      expect(rc.cell.userEnteredFormat.textFormat.foregroundColor).toEqual(want);
      if (WEB_LEADS.columns[k].kind === "link") expect(rc.cell.userEnteredFormat.textFormat.underline).toBe(true);
    }
    // Formats only: no value, no note.
    expect(JSON.stringify(reqs)).not.toMatch(/userEnteredValue|note/);
  });

  it("keeps the column widths, the wrapping and the hidden Key; bands the rows; marks Needs a message", () => {
    const sid = sheets.find((s) => s.title === WEB_LEADS.name)!.sheetId;
    const { looks } = workbookRequests(sheets, { editor: SA });
    const mine = looks.filter((r) => JSON.stringify(r).includes(`"sheetId":${sid},`));
    const widths = mine.map((r) => r.updateDimensionProperties as { range: { dimension: string; startIndex: number }; properties: { pixelSize?: number } } | undefined).filter((d) => d?.range.dimension === "COLUMNS" && d.properties.pixelSize).map((d) => d!.properties.pixelSize);
    expect(widths).toEqual([180, 420, 200, 90]);
    expect(mine.some((r) => (r.updateDimensionProperties as { properties?: { hiddenByUser?: boolean } } | undefined)?.properties?.hiddenByUser === true)).toBe(true);
    const wrap = mine.map((r) => (r.repeatCell as { cell: { userEnteredFormat: { wrapStrategy?: string } } } | undefined)?.cell.userEnteredFormat.wrapStrategy).filter(Boolean);
    expect(wrap).toEqual(["CLIP", "WRAP", "CLIP", "CLIP"]);
    const bands = mine.filter((r) => "addBanding" in r);
    expect(bands).toHaveLength(1);
    expect(JSON.stringify(bands[0])).toContain(`"startRowIndex":1`); // never the header
    const needs = mine.filter((r) => JSON.stringify(r).includes("TEXT_STARTS_WITH"));
    expect(needs).toHaveLength(1);
    expect(JSON.stringify(needs[0])).toContain('"userEnteredValue":"Needs a message"');
    // No body cell is ever given a fill of its own any more (the old cream tint, or anything dark).
    for (const r of mine) {
      const fmt = (r.repeatCell as { cell: { userEnteredFormat: { backgroundColor?: unknown } } } | undefined)?.cell.userEnteredFormat;
      if (fmt) expect(fmt.backgroundColor).toBeUndefined();
    }
  });

  it("an existing workbook gets the new looks and locks once, keeps every cell, and later syncs leave them be", async () => {
    vi.stubEnv("GOOGLE_SHEETS_SA_JSON", JSON.stringify({ client_email: SA, private_key: "test-only" }));
    const store = await storeWithLeads(3);
    await syncSheet(store, new Date());
    // As production stands today: both hashes are the bare spec hash, one band each was never made.
    await store.kvSet("sheet:spec-hash:test-sheet", specHash());
    await store.kvSet("sheet:protect-hash:test-sheet", specHash());
    fake.bands = new Map();
    fake.rules = new Map();
    const before = JSON.stringify([...fake.rows]);
    const rowsBefore = JSON.stringify(await store.listSheetRows());
    fake.batches = [];
    fake.writes = [];

    const r = await syncSheet(store, new Date());
    expect(r.errors).toEqual([]);
    expect(r.notes.join(" ")).toMatch(/Workbook set up/);
    expect(JSON.stringify([...fake.rows])).toBe(before); // not one cell changed
    expect(fake.writes).toEqual([]);
    expect(JSON.stringify(await store.listSheetRows())).toBe(rowsBefore);
    // The only values written were the header cells, as on every setup.
    for (const r of fake.batches.flat()) {
      if (!JSON.stringify(r).includes("userEnteredValue")) continue;
      const cells = r.updateCells as { range: { startRowIndex: number; endRowIndex: number } } | undefined;
      const rule = r.addConditionalFormatRule ?? r.setDataValidation;
      expect(rule || (cells && cells.range.startRowIndex === 0 && cells.range.endRowIndex === 1)).toBeTruthy();
    }
    const tabsHere = fake.sheets.filter((s) => rowTabs.some((t) => t.name === s.title));
    for (const s of tabsHere) {
      expect(fake.bands.get(s.sheetId)).toHaveLength(1);
      expect(fake.protections.filter((p) => p.sheetId === s.sheetId).length).toBeGreaterThanOrEqual(1);
    }
    // The header locked to the sync's own account; the Key a warning.
    for (const p of fake.protections) expect(p).toMatchObject(/header/.test(p.description ?? "") ? { warningOnly: false, editors: { users: [SA] } } : { warningOnly: true });
    expect(fake.protections.filter((p) => /header/.test(p.description ?? "")).length).toBe(tabsHere.length);
    const protCount = fake.protections.length;

    // The next sync: nothing to redo.
    fake.batches = [];
    const again = await syncSheet(store, new Date());
    expect(again.errors).toEqual([]);
    expect(fake.batches.flat().some((x) => "addBanding" in x || "addProtectedRange" in x)).toBe(false);
    expect(fake.protections.length).toBe(protCount);
  });

  it("a forced refresh replaces its own bands, colours and locks instead of piling them up, and keeps the owner's own rule", async () => {
    vi.stubEnv("GOOGLE_SHEETS_SA_JSON", JSON.stringify({ client_email: SA, private_key: "test-only" }));
    const store = await storeWithLeads(2);
    await syncSheet(store, new Date());
    const web = fake.sheets.find((s) => s.title === WEB_LEADS.name)!.sheetId;
    const owners = { red: 0.2, green: 0.6, blue: 0.9 };
    fake.rules.get(web)!.push({ backgroundColor: owners });
    const counts = () => ({ bands: fake.bands.get(web)!.length, rules: fake.rules.get(web)!.length, prots: fake.protections.filter((p) => p.sheetId === web).length });
    const first = counts();
    for (let i = 0; i < 3; i++) {
      await store.kvSet("sheet:spec-hash:test-sheet", "stale");
      await store.kvSet("sheet:protect-hash:test-sheet", "stale");
      const r = await syncSheet(store, new Date());
      expect(r.errors).toEqual([]);
      expect(counts()).toEqual(first);
    }
    expect(first).toEqual({ bands: 1, rules: 2, prots: 2 });
    expect(fake.rules.get(web)!.some((x) => x.backgroundColor === owners)).toBe(true);
  });

  it("new rows on an empty tab get the body's colours, not the dark header's", async () => {
    const store = await storeWithLeads(2);
    await syncSheet(store, new Date());
    const web = fake.sheets.find((s) => s.title === WEB_LEADS.name)!.sheetId;
    const fmt = fake.batches.flat().filter((x) => (x.repeatCell as { range: Range } | undefined)?.range.endRowIndex !== undefined && (x.repeatCell as { range: Range }).range.sheetId === web);
    expect(fmt).toHaveLength(WEB_LEADS.columns.length);
    for (const x of fmt) expect((x.repeatCell as { range: Range }).range).toMatchObject({ startRowIndex: 1, endRowIndex: 3 });
  });

  it("a refused row colour never loses a row: the rows are written and recorded, and the run says so", async () => {
    fake.failRowFormat = true;
    const store = await storeWithLeads(2);
    const r = await syncSheet(store, new Date());
    expect(r.errors).toEqual([]);
    expect(webLeadEmails()).toHaveLength(2);
    expect((await store.listSheetRows(WEB_LEADS.id)).length).toBe(2);
    expect(r.notes.join(" ")).toMatch(/Web Leads: the new rows are written, but their colours were not set/);
  });
});
