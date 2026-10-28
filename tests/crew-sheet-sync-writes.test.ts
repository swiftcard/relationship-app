import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sheetSync } from "@/lib/crew/agents/sheet-sync";
import { GoogleHttpError } from "@/lib/crew/google/auth";
import { workbookRequests } from "@/lib/crew/sheets/bootstrap";
import { syncSheet } from "@/lib/crew/sheets/sync";
import { ALL_TABS, WEB_LEADS } from "@/lib/crew/sheets/tabs";
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

const lead = (email: string, company: string): Lead => ({ list: "cold", name: null, email, phone: null, company, business_type: "real estate offices", city: "Charlotte", region: "NC", country: "US", source_platform: "web", source_url: `https://${email.split("@")[1]}/contact` });

async function storeWithLeads(n = 3) {
  const store = new MemoryStore();
  await store.insertLeads(Array.from({ length: n }, (_, i) => lead(`owner${i}@realty${i}.com`, `Realty ${i}`)));
  return store;
}

const webLeadEmails = () => (fake.rows.get(WEB_LEADS.name) ?? []).map((r) => r[WEB_LEADS.columns.findIndex((c) => c.key === "email")]);

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
    expect(withHoles.length).toBeGreaterThan(0); // the Controls tab's Value column
    for (const p of withHoles) expect(Object.keys(p.range)).toEqual(["sheetId"]);
    for (const r of [...headers, ...looks, ...protection]) expect(refusal(r)).toBeNull();
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
