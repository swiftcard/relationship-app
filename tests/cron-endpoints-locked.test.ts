import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { NextRequest } from "next/server";

// 2026-11-15 security pass. Every endpoint that a clock calls (Vercel cron,
// the Supabase pg_cron jobs, the GitHub schedules) does real work: sends
// pushes, texts and emails, deletes accounts that are due, runs the agents.
// Each one is a public URL, so the shared secret is the only lock.
//
// This CALLS each handler the way a stranger would and proves it is turned
// away before it touches the database: no header, a wrong secret, and the
// classic `Bearer undefined` that authorizes when an unset env var is
// compared as a string.

// Any database access from an unauthorized call is the failure this test
// exists to catch.
const dbTouched = vi.fn();
vi.mock("@/lib/supabase-admin", () => ({
  getAdminSupabase: () => { dbTouched(); throw new Error("an unauthorized request reached the database"); },
}));
vi.mock("@/lib/report-error", () => ({ reportError: vi.fn(async () => {}) }));

type Method = "GET" | "POST";
const ENDPOINTS: { path: string; methods: Method[] }[] = [
  // vercel.json crons
  { path: "/api/reminders", methods: ["GET"] },
  { path: "/api/wallet/sweep", methods: ["GET"] },
  { path: "/api/card-builder/worker", methods: ["GET"] },
  { path: "/api/card-builder/release", methods: ["GET"] },
  { path: "/api/card-builder/follow-ups", methods: ["GET"] },
  { path: "/api/db-autopilot", methods: ["GET"] },
  // the Supabase clock and the GitHub schedules
  { path: "/api/push/catchup", methods: ["GET"] },
  { path: "/api/push/recap", methods: ["GET"] },
  { path: "/api/push/activation", methods: ["GET"] },
  { path: "/api/push/prospect-follow-ups", methods: ["GET"] },
  { path: "/api/account/purge-due", methods: ["GET"] },
  { path: "/api/billing/trial-notice", methods: ["GET"] },
  { path: "/api/demo/tick", methods: ["GET", "POST"] },
  // the agents' clock and its feeders
  { path: "/api/crew/tick", methods: ["POST"] },
  { path: "/api/crew/ingest", methods: ["POST"] },
  { path: "/api/crew/sheet-hook", methods: ["POST"] },
  { path: "/api/crew/sheet-setup", methods: ["POST"] },
  { path: "/api/agents/pinterest/pin", methods: ["GET", "POST"] },
  { path: "/api/agent-email", methods: ["POST"] },
  // server-to-server webhooks with a bearer token
  { path: "/api/iap/revenuecat", methods: ["POST"] },
];

const SECRETS = [
  "CRON_SECRET", "CLOCK_SECRET", "PUSH_CATCHUP_SECRET", "TRIAL_NOTICE_SECRET", "DEMO_TICK_SECRET",
  "CREW_TICK_SECRET", "CREW_SHEET_HOOK_SECRET", "INSTAGRAM_BOT_SECRET", "AGENT_RELAY_SECRET",
  "REVENUECAT_WEBHOOK_TOKEN",
];

const routeFile = (path: string) => join(process.cwd(), "src/app", path, "route.ts");

async function call(path: string, method: Method, authorization?: string): Promise<number> {
  const mod = (await import(/* @vite-ignore */ routeFile(path))) as Record<string, (req: NextRequest) => Promise<Response>>;
  const req = new NextRequest(`http://localhost${path}`, {
    method,
    headers: { ...(authorization === undefined ? {} : { authorization }), "content-type": "application/json" },
    ...(method === "POST" ? { body: "{}" } : {}),
  });
  return (await mod[method](req)).status;
}

const REFUSED = [401, 403, 404, 503];

describe("every clock endpoint turns a stranger away before doing any work", () => {
  beforeEach(() => {
    dbTouched.mockClear();
    for (const name of SECRETS) vi.stubEnv(name, `test-${name.toLowerCase()}-0123456789abcdef`);
  });
  afterEach(() => vi.unstubAllEnvs());

  for (const { path, methods } of ENDPOINTS) {
    for (const method of methods) {
      it(`${method} ${path}: no header, a wrong secret and "Bearer undefined" are all refused`, async () => {
        for (const auth of [undefined, "", "Bearer ", "Bearer wrong-secret-0123456789abcdef", "Bearer undefined", "Bearer null", "test-cron_secret-0123456789abcdef"]) {
          expect(REFUSED, `${method} ${path} with ${JSON.stringify(auth)}`).toContain(await call(path, method, auth));
        }
        expect(dbTouched, "refused before any database access").not.toHaveBeenCalled();
      });

      it(`${method} ${path}: with NO secret configured it is still locked`, async () => {
        for (const name of SECRETS) vi.stubEnv(name, "");
        for (const auth of [undefined, "Bearer ", "Bearer undefined", "Bearer null"]) {
          expect(REFUSED, `${method} ${path} with ${JSON.stringify(auth)} and nothing configured`).toContain(await call(path, method, auth));
        }
        expect(dbTouched).not.toHaveBeenCalled();
      });
    }
  }

  it("the list above covers every clock route in the app and every URL a scheduler calls", () => {
    for (const { path } of ENDPOINTS) expect(existsSync(routeFile(path)), path).toBe(true);
    const listed = new Set(ENDPOINTS.map((e) => e.path));

    // vercel.json crons.
    const vercel = JSON.parse(readFileSync("vercel.json", "utf8")) as { crons: { path: string }[] };
    for (const c of vercel.crons) expect(listed.has(c.path), `vercel.json cron ${c.path}`).toBe(true);

    // Every swiftcard.me/api URL named by a pg_cron job file or a workflow.
    // (Health and the card page are read-only and public on purpose.)
    const callers = [
      ...readdirSync("supabase").filter((f) => f.endsWith(".sql")).map((f) => join("supabase", f)),
      ...readdirSync(".github/workflows").map((f) => join(".github/workflows", f)),
    ];
    const called = new Set<string>();
    for (const file of callers) {
      for (const m of readFileSync(file, "utf8").matchAll(/swiftcard\.me(\/api\/[a-z0-9/_-]+)/g)) called.add(m[1].replace(/\/$/, ""));
    }
    const PUBLIC_ON_PURPOSE = new Set(["/api/health", "/api/card"]);
    const unlisted = [...called].filter((p) => !listed.has(p) && !PUBLIC_ON_PURPOSE.has(p));
    expect(unlisted, "a scheduler calls an endpoint this test does not lock-check").toEqual([]);

    // Any route named like a clock (tick / sweep / purge / catchup) must be listed.
    const clockish: string[] = [];
    const walk = (dir: string, url: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        if (e.isDirectory()) walk(join(dir, e.name), `${url}/${e.name}`);
        else if (e.name === "route.ts" && /\/(tick|sweep|purge-due|catchup|recap|reminders|trial-notice|ingest)$/.test(url)) clockish.push(url);
      }
    };
    walk("src/app/api", "/api");
    // /api/leads/[id]/reminders is a signed-in user's own reminders, not a clock.
    expect(clockish.filter((p) => !listed.has(p) && p !== "/api/leads/[id]/reminders")).toEqual([]);
  });

  it("the signed webhooks refuse an unsigned request", () => {
    // Stripe, Resend and Twilio sign the body instead of sending a bearer
    // token, so they are pinned at source rather than called.
    const read = (p: string) => readFileSync(routeFile(p), "utf8");
    expect(read("/api/stripe/webhook")).toMatch(/if \(!signature\) return NextResponse\.json\(\{ error: "Missing signature" \}, \{ status: 400 \}\);/);
    expect(read("/api/stripe/webhook")).toContain("webhooks.constructEvent(body, signature, process.env.STRIPE_WEBHOOK_SECRET!)");
    expect(read("/api/resend/webhook")).toMatch(/if \(!verify\(raw, req\.headers, secret\)\) \{\s*return NextResponse\.json\(\{ error: "bad signature" \}, \{ status: 400 \}\);/);
    for (const p of ["/api/twilio/inbound", "/api/twilio/status"]) {
      const src = read(p);
      // The skip flag can never apply in production, and no token means closed.
      expect(src, p).toContain('process.env.TWILIO_SKIP_VALIDATION === "true" && process.env.NODE_ENV !== "production"');
      expect(src, p).toMatch(/if \(!sig \|\| !twilio\.validateRequest\(token, sig, url, params\)\) \{\s*return new NextResponse\("Invalid signature", \{ status: 403 \}\);/);
    }
  });
});
