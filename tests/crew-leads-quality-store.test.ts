import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Lead } from "@/lib/crew/types";

// ── Saving leads before and after supabase/crew-leads-quality.sql runs ──────
// The new columns (company_key, email_status, score, why, hook, message) only
// exist once the owner applies the SQL. Until then every lead must still be
// saved, without them, and company duplicates still found from the site and
// the name of what's already saved. A fake database that lacks the columns
// stands in for production as it is today.

type Row = Record<string, unknown>;
const db = { rows: [] as Row[], hasColumns: false, inserts: [] as Row[] };
const NEW = ["company_key", "email_status", "score", "why", "hook", "message"];

function select(cols: string) {
  const filters: ((r: Row) => boolean)[] = [];
  let missing = false;
  const q = {
    in(col: string, vals: string[]) {
      if (NEW.includes(col) && !db.hasColumns) missing = true;
      filters.push((r) => vals.includes(String(r[col])));
      return q;
    },
    is(col: string, v: null) {
      if (NEW.includes(col) && !db.hasColumns) missing = true;
      filters.push((r) => (r[col] ?? null) === v);
      return q;
    },
    order: () => q,
    range: (from: number, to: number) => q.result(from, to),
    result(from = 0, to = 9999) {
      if (missing || (cols.split(",").some((c) => NEW.includes(c.trim())) && !db.hasColumns)) return Promise.resolve({ data: null, error: { code: "42703", message: "column crew_leads.company_key does not exist" } });
      return Promise.resolve({ data: db.rows.filter((r) => filters.every((f) => f(r))).slice(from, to + 1), error: null });
    },
    then(ok: (v: unknown) => unknown, no?: (e: unknown) => unknown) {
      return q.result().then(ok, no);
    },
  };
  return q;
}

vi.mock("@/lib/supabase-admin", () => ({
  getAdminSupabase: () => ({
    from: () => ({
      insert: async (row: Row) => {
        if (!db.hasColumns && Object.keys(row).some((k) => NEW.includes(k))) return { error: { code: "PGRST204", message: "Could not find the 'company_key' column of 'crew_leads' in the schema cache" } };
        if (db.rows.some((r) => r.list === row.list && r.email && r.email === row.email)) return { error: { code: "23505", message: "duplicate" } };
        db.inserts.push(row);
        db.rows.push({ id: `id-${db.rows.length}`, ...row });
        return { error: null };
      },
      select,
    }),
  }),
}));

const lead = (o: Partial<Lead>): Lead => ({ list: "cold", email: "jane@acme.com", source_platform: "web", source_url: "https://acme.com/team", company: "Acme", company_key: "acme.com", score: 80, why: "w", hook: "h", message: "m", email_status: "Domain OK", ...o });

beforeEach(() => Object.assign(db, { rows: [{ id: "old-1", list: "cold", email: "info@oldco.com", company: "Old Co", source_url: "https://www.oldco.com/contact" }], hasColumns: false, inserts: [] }));

describe("SupabaseStore leads without the new columns", () => {
  it("still saves the lead, without the new fields", async () => {
    const { SupabaseStore } = await import("@/lib/crew/store-supabase");
    const store = new SupabaseStore();
    expect(await store.insertLeads([lead({})])).toBe(1);
    expect(db.inserts[0]).toMatchObject({ email: "jane@acme.com", company: "Acme" });
    expect(Object.keys(db.inserts[0]).some((k) => NEW.includes(k))).toBe(false);
  });
  it("finds a company already saved from its site, with no company_key column", async () => {
    const { SupabaseStore } = await import("@/lib/crew/store-supabase");
    const store = new SupabaseStore();
    expect([...(await store.companyKeysTaken(["oldco.com", "acme.com"]))]).toEqual(["oldco.com"]);
  });
});

describe("SupabaseStore leads with the new columns", () => {
  it("saves every field and matches companies by key and by legacy site", async () => {
    db.hasColumns = true;
    const { SupabaseStore } = await import("@/lib/crew/store-supabase");
    const store = new SupabaseStore();
    expect(await store.insertLeads([lead({})])).toBe(1);
    expect(db.inserts[0]).toMatchObject({ company_key: "acme.com", score: 80, email_status: "Domain OK" });
    expect([...(await store.companyKeysTaken(["oldco.com", "acme.com", "new.com"]))].sort()).toEqual(["acme.com", "oldco.com"]);
  });
});
