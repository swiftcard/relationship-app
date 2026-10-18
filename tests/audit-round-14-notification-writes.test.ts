import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";

// ── Audit round 14 (2026-10-18): a notification is written, a duplicate, or a
//    failure — and the difference matters ─────────────────────────────────────
//
// N-04  insertNotification returned false for EVERY error and callers read
//       false as "duplicate": a database blip when a payment failed meant no
//       bell row, no push and no trace.
// N-06  The ten-minute identical-words check dropped distinct events that
//       happened to share a sentence — two different contacts included.
// N-02  Two visit-ledger fallbacks wrote rows with no visit key, silently, so
//       the visitor's next action opened a second row and a second buzz.

type Row = Record<string, unknown>;
const rows: Row[] = [];
const reported: string[] = [];
let insertError: { code: string } | null = null;

function makeQuery() {
  const filters: ((r: Row) => boolean)[] = [];
  let insertRow: Row | null = null;
  const run = async () => {
    if (insertRow) {
      if (insertError) return { data: null, error: insertError };
      rows.push(insertRow);
      return { data: null, error: null };
    }
    return { data: rows.filter((r) => filters.every((f) => f(r))), error: null };
  };
  const chain: Record<string, unknown> = {
    select: () => chain,
    eq: (k: string, v: unknown) => { filters.push((r) => r[k] === v); return chain; },
    is: (k: string, v: unknown) => { filters.push((r) => (r[k] ?? null) === v); return chain; },
    gte: () => chain, limit: () => chain,
    insert: (v: Row) => { insertRow = { ...v }; return chain; },
    then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => run().then(res, rej),
  };
  return chain;
}
vi.mock("@/lib/supabase-admin", () => ({ getAdminSupabase: () => ({ from: () => makeQuery() }) }));
vi.mock("@/lib/report-error", () => ({ reportError: async (ctx: string) => { reported.push(ctx); } }));

import { insertNotification, writeNotification } from "@/lib/notify";

const read = (p: string) => readFileSync(p, "utf8");
const row = (over: Row = {}) => ({ user_id: "u1", card_owner: "dana", type: "contact_saved", title: "Contact saved", body: "Someone saved your card.", ...over }) as never;

beforeEach(() => {
  rows.length = 0;
  reported.length = 0;
  insertError = null;
});

describe("N-04: written, duplicate or failed — never the same answer", () => {
  it("a write that lands is created", async () => {
    expect(await writeNotification(row())).toBe("created");
    expect(rows).toHaveLength(1);
  });

  it("a unique index refusing it is a duplicate, and nothing is reported", async () => {
    insertError = { code: "23505" };
    expect(await writeNotification(row())).toBe("duplicate");
    expect(reported).toEqual([]);
  });

  it("anything else — a timeout, a 5xx — is a failure, and it is reported", async () => {
    insertError = { code: "57014" };
    expect(await writeNotification(row())).toBe("failed");
    expect(reported).toContain("notify.insert_failed");
  });

  it("insertNotification keeps its contract: true only when this call wrote it", async () => {
    expect(await insertNotification(row())).toBe(true);
    expect(await insertNotification(row())).toBe(false); // identical words, ten minutes
  });

  it("a failed payment still reaches the phone when its bell row can't be written; only a duplicate holds it", () => {
    const hook = read("src/app/api/stripe/webhook/route.ts");
    expect(hook).toMatch(/const wrote = await writeNotification\(\{\s*user_id: profile\.id as string,\s*type: "payment_failed",/);
    expect(hook).toContain('if (wrote === "duplicate") return;');
  });

  it("so does a contact's reply (already deduped on MessageSid)", () => {
    const inbound = read("src/app/api/twilio/inbound/route.ts");
    expect(inbound).toContain('if (wrote !== "duplicate") await sendPushToUser(owner.id as string, {');
    expect(inbound).not.toMatch(/insertNotification\(/);
  });
});

describe("N-06: identical words about different contacts are different news", () => {
  it("the same sentence for two contacts writes two rows; the same contact twice is a retry", async () => {
    expect(await writeNotification(row({ lead_id: "lead-a" }))).toBe("created");
    expect(await writeNotification(row({ lead_id: "lead-b" }))).toBe("created");
    expect(await writeNotification(row({ lead_id: "lead-a" }))).toBe("duplicate");
    expect(rows).toHaveLength(2);
  });
});

describe("N-02: no visit row is written outside the visit ledger, and no fallback is silent", () => {
  const visit = read("src/lib/visit-notify.ts");

  it("an address that changed hands gets this owner's own key, which the next lookup still finds", () => {
    expect(visit).toContain("export function ownVisitKey(key: string, userId: string): string {");
    expect(visit).toContain('.in("visit_key", [keys.current, keys.previous, ownVisitKey(keys.current, userId), ownVisitKey(keys.previous, userId)])');
    expect(visit).toContain('await admin.from("notifications").insert({ ...row, visit_key: ownVisitKey(key, opts.userId) });');
    expect(visit).not.toMatch(/\.\.\.unkeyed/);
  });

  it("the column fallback is reported", () => {
    expect(visit).toContain('await reportError("visit-notify.column-fallback", error, { code, type: notice.type })');
  });
});
