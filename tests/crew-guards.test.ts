import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// Source-level guards for the agent system (src/lib/crew):
//  • nothing an agent runs can reach the outward executors; only decide.ts
//    (the Approve button) imports src/lib/crew/execute
//  • Crew never reads the product's AI keys (ai.ts uses those to pick the
//    provider named in the App Store consent notice)
//  • every outward kind goes through propose(); no agent writes approvals itself
//  • the tick and ingest routes fail closed

const read = (p: string) => readFileSync(p, "utf8");
function* files(dir: string): Generator<string> {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) yield* files(p);
    else if (/\.(ts|tsx)$/.test(n)) yield p;
  }
}
const crewFiles = [...files("src/lib/crew")];
const appFiles = [...files("src/app")];

describe("approval gate", () => {
  it("only decide.ts imports the executors", () => {
    const importers = [...crewFiles, ...appFiles].filter((f) => !f.startsWith("src/lib/crew/execute/") && /from\s+["'](\.\/execute|\.\.\/execute|@\/lib\/crew\/execute)/.test(read(f)));
    expect(importers).toEqual(["src/lib/crew/decide.ts"]);
  });
  it("decide.ts is reachable only from the Approve route", () => {
    const users = [...crewFiles, ...appFiles].filter((f) => f !== "src/lib/crew/decide.ts" && /from\s+["'](@\/lib\/crew\/decide|\.\/decide|\.\.\/decide)["']/.test(read(f)));
    expect(users).toEqual(["src/app/api/admin/crew/approvals/[id]/route.ts"]);
    expect(read("src/app/api/admin/crew/approvals/[id]/route.ts")).toContain("await requireAdmin()");
  });
  it("agents never write approvals directly", () => {
    const writers = crewFiles.filter((f) => f.startsWith("src/lib/crew/agents/") && /insertApproval\(/.test(read(f)));
    expect(writers).toEqual([]);
  });
  it("executors refuse anything that is not approved", () => {
    expect(read("src/lib/crew/execute/index.ts")).toMatch(/if \(a\.status !== "approved"\) return \{ ok: false/);
  });
});

describe("keys", () => {
  it("crew never reads the product's AI keys", () => {
    for (const f of crewFiles) {
      const src = read(f);
      for (const k of ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY"]) {
        expect(src.replace(/CREW_ANTHROPIC_API_KEY|CREW_OPENAI_API_KEY/g, ""), `${f} reads ${k}`).not.toMatch(new RegExp(`(process\\.env\\.|["'])${k}\\b`));
      }
    }
  });
  it("crew env reads go through env.ts", () => {
    for (const f of crewFiles.filter((x) => x !== "src/lib/crew/env.ts")) expect(read(f), f).not.toMatch(/process\.env\.CREW_/);
  });
});

describe("routes", () => {
  it("tick and ingest are 404 without the secret and compare it in constant time", () => {
    for (const p of ["src/app/api/crew/tick/route.ts", "src/app/api/crew/ingest/route.ts"]) {
      const src = read(p);
      expect(src).toMatch(/if \(!process\.env\.CREW_TICK_SECRET\) return NextResponse\.json\(\{ error: "not found" \}, \{ status: 404 \}\)/);
      expect(src).toContain("tickAuthorized(");
    }
    expect(read("src/lib/crew/auth.ts")).toContain("timingSafeEqual");
  });
  it("every admin crew route checks requireAdmin", () => {
    for (const f of appFiles.filter((x) => x.startsWith("src/app/api/admin/crew/"))) expect(read(f), f).toContain("await requireAdmin()");
    expect(read("src/app/admin/crew/page.tsx")).toContain("if (!(await requireAdmin())) notFound();");
  });
  it("every form on the Agents tab posts (works before hydration, nothing in a URL)", () => {
    const page = read("src/app/admin/crew/CrewView.tsx");
    const forms = page.match(/<form\b[^>]*>/g) ?? [];
    expect(forms.length).toBeGreaterThan(5);
    for (const f of forms) expect(f).toContain('method="post"');
  });
});

describe("the clock", () => {
  it("the tick runs every 15 minutes from Supabase pg_cron; crew-tick.yml only holds the tick secret", () => {
    expect(read("supabase/clock.sql")).toContain("cron.schedule('crew-tick', '*/15 * * * *',");
    const wf = read(".github/workflows/crew-tick.yml");
    expect(wf).toContain("secrets.CREW_TICK_SECRET");
    expect(wf).not.toMatch(/ANTHROPIC|OPENAI/);
  });
  it("the tick route finishes inside its max duration", () => {
    expect(read("src/app/api/crew/tick/route.ts")).toContain("export const maxDuration = 300;");
    expect(read("src/lib/crew/tick.ts")).toContain("export const TICK_BUDGET_MS = 240_000;");
  });
});

describe("migration", () => {
  it("the DM-ledger function stays callable by the service role after revoking PUBLIC", () => {
    const sql = readFileSync("supabase/crew.sql", "utf8");
    expect(sql).toContain("revoke all on function crew_claim_dm(uuid, uuid) from public, anon, authenticated;");
    expect(sql).toContain("grant execute on function crew_claim_dm(uuid, uuid) to service_role;");
  });
});
