import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sheetSync } from "@/lib/crew/agents/sheet-sync";
import { GoogleHttpError } from "@/lib/crew/google/auth";
import { workbookRequests } from "@/lib/crew/sheets/bootstrap";
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
// 2026-10-29 (owner): every tab is Name, Message, Link; a row the owner
// deletes was sent (recorded, never added back); a row that is no longer
// waiting comes off; the old tabs go once, and nothing on them counts as sent.

type Fake = { sheets: { sheetId: number; title: string }[]; rows: Map<string, unknown[][]>; failProtection: boolean; failValueWrites: boolean; batches: Record<string, unknown>[][] };
const fake: Fake = { sheets: [], rows: new Map(), failProtection: false, failValueWrites: false, batches: [] };

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
  Object.assign(fake, { sheets: [{ sheetId: 0, title: "Sheet1" }], rows: new Map(), failProtection: false, failValueWrites: false, batches: [] });
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

  it("a row the owner deleted is recorded as sent and never comes back", async () => {
    const store = await storeWithLeads(2);
    await syncSheet(store, new Date());
    const rows = fake.rows.get(WEB_LEADS.name)!;
    const deletedKey = String(rows[0][KEY]);
    fake.rows.set(WEB_LEADS.name, rows.slice(1)); // the owner sent it and deleted the row
    const r = await syncSheet(store, new Date());
    expect(r.sent).toBe(1);
    expect((await store.getSheetRow(deletedKey))?.status).toBe("Contacted");
    expect(store.touches.some((t) => t.kind === "emailed")).toBe(true);
    expect(webLeadEmails()).toHaveLength(1);
    await syncSheet(store, new Date());
    expect(webLeadEmails()).toHaveLength(1); // not added back
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
    expect(r.sent).toBe(0);
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
    expect(r.sent).toBe(0);
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
