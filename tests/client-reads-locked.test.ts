import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ── A Free account can't read hidden location text straight from the DB ─────
// The blanking of a place name for Free happens on the server at read time, so
// the tables themselves must not be readable with a user's own session
// (supabase/lock-client-reads.sql drops those policies). That only holds while
// NO code reads them with the session client — pinned here.

const code = (p: string) => readFileSync(join(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");

describe("notifications are read with the service role, scoped to the user", () => {
  it("api/notifications: every query goes through db (service role) and filters user_id", () => {
    const r = code("src/app/api/notifications/route.ts");
    expect(r).not.toMatch(/supabase\s*\.from\("notifications"\)/);
    const queries = r.split(/db\s*\.from\("notifications"\)/).slice(1);
    expect(queries.length).toBe(6); // the two unscoped card-panel fallbacks are gone (isolation audit 2026-09-24)
    for (const q of queries) expect(q.slice(0, 260)).toContain('.eq("user_id", user.id)');
  });

  // The bell's read (+ its fallback below). The per-card panel's read went
  // with Quick Contacts on 2026-09-29.
  it("the dashboard's bell uses the service role too", () => {
    const d = code("src/app/dashboard/page.tsx");
    expect(d).not.toMatch(/supabase\s*\.from\("notifications"\)/);
    expect(d.split('getAdminSupabase().from("notifications")').length - 1).toBe(1);
  });

  it("the migration drops every client policy on the three tables", () => {
    const sql = code("supabase/lock-client-reads.sql");
    for (const p of ['"Users see own notifications" on public.notifications', '"Users read own views" on public.card_views', '"Own leads read" on public.leads', '"Own leads update" on public.leads']) {
      expect(sql).toContain(`drop policy if exists ${p};`);
    }
  });
});
