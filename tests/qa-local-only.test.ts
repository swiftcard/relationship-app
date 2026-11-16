import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";

// ── QA, verification and agents run on a local build. Never on production. ──
//
// November 2026: Vercel switched swiftcard.me off for going over its limits,
// and the traffic was ours. The QA workflow drove the live site nightly and
// after every production deploy (about 150 runs in 30 days), and each run made
// and deleted about 13 accounts (about 1,950 in a billing cycle, for a few
// dozen real people). The owner's rule since then (CLAUDE.md): never run tests,
// verification or agents against production or a Vercel preview, and never
// create real auth users for testing.
//
// A rule in a document is forgotten the first time a script is copied. These
// pin the three walls: the base-URL guard, the seeded accounts, and the
// workflows' triggers.

const read = (p: string) => readFileSync(p, "utf8");
// @ts-expect-error plain .mjs, no types
const local = await import("../scripts/lib/qa-local.mjs");
// @ts-expect-error plain .mjs, no types
const hook = await import("../scripts/claude-no-production.mjs");

describe("the base URL guard", () => {
  it("refuses the live site, its other domain, and every Vercel deployment", () => {
    for (const url of [
      "https://swiftcard.me", "https://www.swiftcard.me/dashboard", "http://swiftcard.me", "https://swiftcard.app",
      "https://www.swiftcard.app", "https://relationship-app.vercel.app", "https://relationship-app-git-fix-x-swiftcard.vercel.app/login",
      "https://SwiftCard.me",
    ]) {
      expect(local.baseUrlProblem(url), url).toMatch(/live site or a Vercel deployment/);
    }
  });

  it("refuses anything else that is not this machine", () => {
    for (const url of ["https://example.com", "https://staging.swiftcard.dev", "http://192.168.1.20:3000", "not a url", ""]) {
      expect(local.baseUrlProblem(url), url).toBeTruthy();
    }
    // A lookalike must not pass as local, and a real local host must not be refused.
    expect(local.baseUrlProblem("https://localhost.swiftcard.me")).toBeTruthy();
    expect(local.baseUrlProblem("https://swiftcard.me.localhost.evil.com")).toBeTruthy();
  });

  it("allows a local build", () => {
    for (const url of ["http://localhost:3222", "http://127.0.0.1:3111", "http://localhost", "http://[::1]:3000", "http://10.0.2.2:3222"]) {
      expect(local.baseUrlProblem(url), url).toBeNull();
    }
    expect(local.DEFAULT_LOCAL_BASE).toBe("http://localhost:3222");
  });

  it("every browser a script opens passes through it", () => {
    // tests/qa-internal-marker.test.ts already proves every context goes
    // through markInternal; this proves markInternal enforces the rule.
    const helper = read("scripts/qa-internal.mjs");
    expect(helper).toContain("assertLocalBase(b)");
    expect(helper).toContain("stubUploads(ctx");
    expect(helper).not.toContain("https://swiftcard.me");
  });
});

describe("no script can be pointed at production", () => {
  const scripts = readdirSync("scripts").filter((f) => /\.(mjs|js)$/.test(f));
  // The uptime probe and the deploy tooling read production on purpose: plain
  // GETs of public pages and /api/health. They drive nothing and create nothing.
  // pinterest-pins is the marketing job that photographs up to 3 public pin
  // pages and posts them; it is the product working, not a test of it.
  const MONITORS = new Set(["health-check.mjs", "wait-for-live.mjs", "deploy-watchdog.mjs", "pinterest-pins.mjs"]);
  const usesBase = scripts.filter((f) => !MONITORS.has(f) && /\b(const|let) (BASE|APP|ADMIN_BASE) = /.test(read(`scripts/${f}`)));

  it("finds the scripts it is meant to guard", () => {
    expect(usesBase.length).toBeGreaterThanOrEqual(18);
    for (const f of ["qa-flows.mjs", "qa-sweep.mjs", "qa-prod-probe.mjs", "qa-card-builder.mjs", "site-invisible-sweep.mjs", "perf-probe.mjs"]) {
      expect(usesBase, f).toContain(f);
    }
  });

  for (const f of usesBase) {
    it(`${f} takes its base URL through localBase()`, () => {
      const src = read(`scripts/${f}`);
      expect(src).toContain('from "./lib/qa-local.mjs"');
      for (const m of src.matchAll(/\b(?:const|let) (BASE|APP|ADMIN_BASE) = ([^\n]+)/g)) {
        expect(m[2], `${f}: ${m[0]}`).toMatch(/^localBase\(/);
      }
      // No production default hiding behind an `||`.
      expect(src).not.toMatch(/\|\|\s*["'`]https?:\/\/[^"'`]*(swiftcard\.(me|app)|vercel\.app)/);
    });
  }

  it("localBase ends the process instead of returning a production URL", () => {
    const src = read("scripts/lib/qa-local.mjs");
    expect(src).toMatch(/export function localBase[\s\S]*?if \(problem\) \{[\s\S]*?process\.exit\(2\);/);
  });
});

describe("no script makes or deletes accounts per run", () => {
  const scripts = readdirSync("scripts").filter((f) => /\.(mjs|js)$/.test(f));
  // The Apple review account is one real, permanent account the App Store
  // reviewer signs in with. It is not a test account.
  const ALLOWED = new Set(["create-apple-review-account.js"]);

  it("every script that asks for an auth user gets a seeded one", () => {
    const asking = scripts.filter((f) => /\/auth\/v1\/admin\/users["`]|auth\.admin\.createUser\(/.test(read(`scripts/${f}`)) && !ALLOWED.has(f));
    expect(asking.length).toBeGreaterThanOrEqual(12);
    for (const f of asking) {
      const src = read(`scripts/${f}`);
      expect(src, f).toMatch(/^const adm = seededAdmin\(/m);
      expect(src, f).not.toContain("auth.admin.createUser(");
      // Nothing reaches Supabase's admin API around the wrapper.
      expect(src.match(/fetch\(SB \+ p\b/g)?.length ?? 0, f).toBeLessThanOrEqual(1);
    }
  });

  it("the seeded set is small, fixed, and never deleted", async () => {
    expect(local.QA_POOL_SIZE).toBeLessThanOrEqual(16);
    expect(local.seedId(1)).toBe("5eed0000-0000-4000-8000-000000000001");
    expect(local.isSeedId(local.seedId(local.QA_POOL_SIZE))).toBe(true);
    expect(local.isSeedId(local.seedId(local.QA_POOL_SIZE + 1))).toBe(false);

    // A fake Supabase: every slot already exists and is parked.
    const calls: { method: string; path: string; body?: Record<string, unknown> }[] = [];
    const users = new Map<string, { id: string; email: string; app_metadata: Record<string, unknown> }>();
    for (let n = 1; n <= local.QA_POOL_SIZE; n++) users.set(local.seedId(n), { id: local.seedId(n), email: local.seedEmail(n), app_metadata: { qa_seed: true } });
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
    const fake = async (path: string, init?: { method?: string; body?: string }) => {
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(init.body) : undefined;
      calls.push({ method, path, body });
      const m = path.match(/^\/auth\/v1\/admin\/users\/([0-9a-f-]{36})$/);
      if (m && method === "GET") return users.has(m[1]) ? json(users.get(m[1])) : json({}, 404);
      if (m && method === "PUT") { const u = { ...users.get(m[1])!, ...body }; users.set(m[1], u); return json(u); }
      return json([]);
    };
    const adm = local.seededAdmin(fake);

    const a = await (await adm("/auth/v1/admin/users", { method: "POST", body: JSON.stringify({ email: "qa-a@swiftcard-test.invalid", password: "pw", email_confirm: true }) })).json();
    const b = await (await adm("/auth/v1/admin/users", { method: "POST", body: JSON.stringify({ email: "qa-b@swiftcard-test.invalid", password: "pw", email_confirm: true }) })).json();
    expect(a.id).toBe(local.seedId(1));
    expect(a.email).toBe("qa-a@swiftcard-test.invalid");
    expect(b.id).toBe(local.seedId(2));
    await adm(`/auth/v1/admin/users/${a.id}`, { method: "DELETE" });

    // Not one account was created or deleted in Supabase.
    expect(calls.filter((c) => c.method === "POST" && c.path.startsWith("/auth/v1/admin/users"))).toEqual([]);
    expect(calls.filter((c) => c.method === "DELETE" && c.path.startsWith("/auth/v1/"))).toEqual([]);
    // The account was emptied before it was handed out and again when returned.
    expect(calls.filter((c) => c.method === "DELETE" && c.path === `/rest/v1/profiles?id=eq.${a.id}`).length).toBe(2);
    // Returned accounts are parked under their fixed address, still marked.
    expect(users.get(a.id)!.email).toBe(local.seedEmail(1));
    expect(users.get(a.id)!.app_metadata.qa_seed).toBe(true);
    // A real account's delete still passes straight through, untouched.
    await adm("/auth/v1/admin/users/11111111-2222-4333-8444-555555555555", { method: "DELETE" });
    expect(calls.at(-1)).toMatchObject({ method: "DELETE", path: "/auth/v1/admin/users/11111111-2222-4333-8444-555555555555" });
  });

  it("the app's own sweep of leftover QA accounts leaves the seeded ones alone", async () => {
    const { isLeftoverQaAccount } = await import("@/lib/qa-account-sweep");
    const old = new Date(Date.UTC(2026, 0, 1)).toISOString();
    const now = Date.UTC(2026, 10, 15);
    expect(isLeftoverQaAccount({ email: "qa-flows-1@swiftcard-test.invalid", created_at: old }, now)).toBe(true);
    expect(isLeftoverQaAccount({ email: "qa-flows-1@swiftcard-test.invalid", created_at: old, app_metadata: { qa_seed: true } }, now)).toBe(false);
  });

  it("the signup form only makes a real account when asked", () => {
    expect(read("scripts/qa-flows.mjs")).toMatch(/if \(process\.env\.QA_SIGNUP !== "1"\) \{\s*pass\("signup-ui"/);
  });
});

describe("the workflows", () => {
  const dir = ".github/workflows";
  const files = readdirSync(dir).filter((f) => f.endsWith(".yml"));

  it("QA runs on a local build, on relevant changes, and a new push cancels the old run", () => {
    const wf = read(`${dir}/nightly-qa.yml`);
    expect(wf).toContain("BASE: http://localhost:3222");
    expect(wf).toContain("npx next build");
    expect(wf).toContain("npx next start -p 3222");
    // The trigger that multiplied the load: one full run per production deploy.
    expect(wf).not.toMatch(/^\s*deployment_status:/m);
    expect(wf).toMatch(/pull_request:\n\s+paths:\n\s+- "src\/\*\*"/);
    expect(wf).toMatch(/push:\n\s+branches: \[main\]\n\s+paths:\n\s+- "src\/\*\*"/);
    expect(wf).toMatch(/concurrency:\n\s+group: qa-\$\{\{ github\.ref \}\}\n\s+cancel-in-progress: true/);
    // No QA script in it is given a production address.
    expect(wf).not.toMatch(/(BASE|HEALTH_BASE_URL|SWEEP_BASE|ADMIN_BASE): https?:\/\/(?!localhost)/);
  });

  it("the paint check no longer sweeps production after every deploy", () => {
    expect(existsSync(`${dir}/paint-check.yml`)).toBe(false);
    expect(read(`${dir}/nightly-qa.yml`)).toContain("node scripts/site-invisible-sweep.mjs");
  });

  it("no workflow runs a browser or a QA script against production or a preview", () => {
    for (const f of files) {
      const wf = read(`${dir}/${f}`);
      expect(wf, f).not.toMatch(/(BASE|SWEEP_BASE|ADMIN_BASE): ["']?https?:\/\/[^\s"']*(swiftcard\.(me|app)|vercel\.app)/);
      // Only the deploy watchdog (Sentry + Vercel's API, no browser) still
      // listens for deploys. A browser run per deploy is what broke the limits.
      if (f !== "deploy-watchdog.yml") expect(wf, f).not.toMatch(/^\s*deployment_status:/m);
    }
  });

  it("production is only ever called by the uptime probe and the scheduled jobs", () => {
    const ALLOWED: Record<string, RegExp> = {
      "uptime.yml": /crew\/ingest\?source=health|api\/card\//,
      "nightly-qa.yml": /crew\/ingest\?source=nightly/,
      "crew-fix.yml": /crew\/ingest\?source=fix/,
      "crew-tick.yml": /^\s*SITE: https:\/\/swiftcard\.me$/,
      "push-catchup.yml": /api\/(push\/(catchup|recap|activation|prospect-follow-ups)|demo\/tick|account\/purge-due)/,
      "trial-notice.yml": /api\/billing\/trial-notice/,
      "sentry-triage.yml": /triage@swiftcard\.me/,
    };
    for (const f of files) {
      for (const line of read(`${dir}/${f}`).split("\n")) {
        if (!/swiftcard\.(me|app)|vercel\.app/.test(line) || /^\s*#/.test(line)) continue;
        expect(ALLOWED[f]?.test(line), `${f}: ${line.trim()}`).toBe(true);
      }
    }
  });
});

describe("agents are stopped too", () => {
  it("the Claude Code hook is installed for shell, fetch and browser tools", () => {
    const settings = JSON.parse(read(".claude/settings.json"));
    const pre = settings.hooks.PreToolUse[0];
    expect(pre.hooks[0].command).toContain("scripts/claude-no-production.mjs");
    for (const tool of ["Bash", "WebFetch", "mcp__plugin_playwright_playwright__browser_navigate", "mcp__claude-in-chrome__navigate", "mcp__claude-in-chrome__tabs_create_mcp"]) {
      expect(new RegExp(`^(${pre.matcher})$`).test(tool), tool).toBe(true);
    }
  });

  it("refuses a browser, a fetch or a script aimed at production or a preview", () => {
    expect(hook.refusal("mcp__plugin_playwright_playwright__browser_navigate", { url: "https://swiftcard.me/dashboard" })).toBeTruthy();
    expect(hook.refusal("mcp__claude-in-chrome__navigate", { url: "https://relationship-app-git-x.vercel.app/" })).toBeTruthy();
    expect(hook.refusal("WebFetch", { url: "https://swiftcard.app/pricing" })).toBeTruthy();
    expect(hook.refusal("Bash", { command: "BASE=https://swiftcard.me node scripts/qa-sweep.mjs" })).toBeTruthy();
    expect(hook.refusal("Bash", { command: "cd x && curl -s https://swiftcard.me/aaronlavi | head" })).toBeTruthy();
    expect(hook.refusal("Bash", { command: "npx playwright open https://swiftcard.me" })).toBeTruthy();
  });

  it("lets local work, writing about the site, and the one health read through", () => {
    expect(hook.refusal("mcp__plugin_playwright_playwright__browser_navigate", { url: "http://localhost:3222/dashboard" })).toBeNull();
    expect(hook.refusal("Bash", { command: "BASE=http://localhost:3222 node scripts/qa-sweep.mjs" })).toBeNull();
    expect(hook.refusal("Bash", { command: "curl -s https://swiftcard.me/api/health" })).toBeNull();
    expect(hook.refusal("Bash", { command: 'git commit -m "QA no longer runs on https://swiftcard.me"' })).toBeNull();
    expect(hook.refusal("Bash", { command: 'grep -rn "swiftcard.me" src' })).toBeNull();
    expect(hook.refusal("WebFetch", { url: "https://vercel.com/docs" })).toBeNull();
  });
});

describe("the rule is written down where every session reads it", () => {
  it("CLAUDE.md carries it", () => {
    const md = read("CLAUDE.md");
    expect(md).toContain("Never test on production");
    expect(md).toMatch(/Never run tests, verification, QA scripts or agents against production/);
    expect(md).toMatch(/Never create real auth users for testing/);
  });
});
