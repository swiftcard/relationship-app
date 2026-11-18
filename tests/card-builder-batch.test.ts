import { describe, it, expect } from "vitest";
import { batchRunAfter, csvToProspects, MAX_BATCH, parseBatchForm, parseCsv } from "@/lib/prospect-preview/batch-input";
import { kindOfLineType, nanp } from "@/lib/prospect-preview/phone-type";

// ── Card Builder: New batch (owner, 2026-11-16) ─────────────────────────────

describe("a CSV of prospects", () => {
  it("reads quoted fields, commas and newlines inside quotes", () => {
    expect(parseCsv('a,"b, c","d ""e"""\r\n1,2,3\n')).toEqual([["a", "b, c", 'd "e"'], ["1", "2", "3"]]);
  });
  it("with a header row, by what each column is called", () => {
    const rows = csvToProspects("First Name,Last Name,Brokerage,City,Cell,Email,Zillow\nDana,Whitfield,Harbor Realty,Great Neck,516-555-0101,dana@harbor.com,https://www.zillow.com/profile/dana\n");
    expect(rows).toEqual(["Dana Whitfield, Harbor Realty, Great Neck · mobile 516-555-0101 · dana@harbor.com · https://www.zillow.com/profile/dana"]);
  });
  it("with no header, as name, company, city, phone, email, link", () => {
    expect(csvToProspects("Mike Chen,Chen Team,Manhasset,516-555-0123")).toEqual(["Mike Chen, Chen Team, Manhasset · phone 516-555-0123"]);
  });
  it(`never more than ${MAX_BATCH}`, () => {
    const many = Array.from({ length: 150 }, (_, i) => `Agent ${i},Office ${i},Great Neck`).join("\n");
    expect(csvToProspects(many)).toHaveLength(MAX_BATCH);
  });
});

describe("the New batch form", () => {
  const form = (v: Record<string, string>) => (k: string) => v[k] ?? null;
  it("a target and a count, now or tonight", () => {
    expect(parseBatchForm(form({ target: "realtors in Great Neck", count: "40", when: "tonight" }), null)).toEqual({ ok: true, value: { label: "realtors in Great Neck", wanted: 40, kind: "tonight", rows: [], sendWith: "imessage" } });
  });
  it(`caps the count at ${MAX_BATCH}`, () => {
    const r = parseBatchForm(form({ target: "mortgage teams in Manhattan", count: "500" }), null);
    expect(r.ok && r.value.wanted).toBe(MAX_BATCH);
  });
  it("with a CSV, the count is its rows", () => {
    const r = parseBatchForm(form({ count: "50" }), "Dana Whitfield,Harbor Realty,Great Neck\nMike Chen,Chen Team,Manhasset\n");
    expect(r.ok && r.value).toMatchObject({ wanted: 2, label: "CSV: 2 prospects" });
  });
  it("refuses an empty ask", () => {
    expect(parseBatchForm(form({}), null).ok).toBe(false);
    expect(parseBatchForm(form({ target: "realtors" }), null).ok).toBe(false);
  });
});

describe("run overnight", () => {
  it("starts at 11pm New York time", () => {
    const at = batchRunAfter("tonight", new Date("2026-11-16T15:00:00Z")); // 10am NY
    expect(at.toISOString()).toBe("2026-11-17T04:00:00.000Z");
  });
  it("now, if it is already the middle of the night", () => {
    const now = new Date("2026-11-17T06:00:00Z"); // 1am NY
    expect(batchRunAfter("tonight", now)).toEqual(now);
  });
});

describe("is the number a mobile", () => {
  it("only a mobile can get an iMessage", () => {
    expect(kindOfLineType("mobile")).toBe("mobile");
    expect(kindOfLineType("landline")).toBe("office");
    expect(kindOfLineType("fixedVoip")).toBe("office");
    expect(kindOfLineType("nonFixedVoip")).toBe("unknown");
    expect(nanp("(516) 555-0101")).toBe("+15165550101");
    expect(nanp("+44 20 7946 0958")).toBeNull();
  });
});
