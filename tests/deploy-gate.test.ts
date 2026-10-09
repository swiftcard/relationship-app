import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

// ── Nothing reaches swiftcard.me until the checks pass ───────────────────────
//
// Owner, 2026-10-09: "How do we make sure that code and other things on our app
// don't just change out of nowhere? Once we set it in place it's set." Until
// then Vercel put every push live at once and CI reported ~11 minutes later:
// of the 100 pushes to main since 2026-10-02, 9 failed their tests and went
// live anyway. Vercel Deployment Checks now hold each production build until
// CI's `verify` and `render` jobs pass.
//
// Two things make that gate quietly stop working, and this pins both:
//   • Vercel finds the checks by JOB NAME. Rename `verify` or `render` and the
//     required check never reports, so every deploy waits forever.
//   • GitHub hears "deployment success" when a build is READY, before the hold.
//     The post-deploy guards test https://swiftcard.me, so without waiting for
//     the build to be live they would test the previous build and pass it.

const read = (p: string) => readFileSync(p, "utf8");

describe("the deploy gate", () => {
  it("CI keeps the two job names Vercel's Deployment Checks require", () => {
    const ci = read(".github/workflows/ci.yml");
    expect(ci).toMatch(/^ {2}verify:$/m);
    expect(ci).toMatch(/^ {2}render:$/m);
    // A push to main must start CI, or the build it deploys is never released.
    expect(ci).toMatch(/push:\s*\n\s*branches: \[main\]/);
  });

  it("production says which commit it is serving", () => {
    const health = read("src/app/api/health/route.ts");
    expect(health).toMatch(/const sha = process\.env\.VERCEL_GIT_COMMIT_SHA \|\| null;/);
    expect(health).toMatch(/\{ ok: db, db, dbMs: Date\.now\(\) - t0, push, sha \}/);
  });

  it("the nightly QA and the paint check test only a build that is live", () => {
    for (const [file, job] of [["nightly-qa", "qa"], ["paint-check", "paint"]] as const) {
      const wf = read(`.github/workflows/${file}.yml`);
      expect(wf, file).toContain("run: node scripts/wait-for-live.mjs");
      expect(wf, file).toContain("DEPLOY_SHA: ${{ github.event.deployment.sha }}");
      expect(wf, file).toContain("live: ${{ steps.wait.outputs.live }}");
      expect(wf, file).toMatch(new RegExp(`\\n  ${job}:\\n    needs: live\\n    if: needs\\.live\\.outputs\\.live == 'true'\\n`));
    }
  });

  it("the watchdog soaks a release only once it is live", () => {
    const wf = read(".github/workflows/deploy-watchdog.yml");
    const wait = wf.indexOf("run: node scripts/wait-for-live.mjs");
    const watch = wf.indexOf("RESULT=\"$(node scripts/deploy-watchdog.mjs)\"");
    expect(wait).toBeGreaterThan(0);
    expect(watch).toBeGreaterThan(wait);
    expect(wf).toContain("if: steps.gate.outputs.proceed == 'true' && steps.live.outputs.live != 'false'");
    // 45 minutes of waiting plus the soak must fit inside the job.
    expect(Number(wf.match(/timeout-minutes: (\d+)/)![1])).toBeGreaterThanOrEqual(60);
  });
});

// ── scripts/wait-for-live.mjs, run for real against a stand-in production ───

const run = promisify(execFile);
let server: Server;
let base = "";
let answer: Record<string, unknown> = {};
let dir = "";

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "wait-for-live-"));
  server = createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(req.url?.startsWith("/api/health") ? answer : {}));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
});
afterAll(() => { server?.close(); rmSync(dir, { recursive: true, force: true }); });

async function waitFor(deploySha: string) {
  const out = join(dir, `out-${Math.random().toString(36).slice(2)}`);
  const { stdout } = await run(process.execPath, ["scripts/wait-for-live.mjs"], {
    env: {
      ...process.env, BASE: base, DEPLOY_SHA: deploySha, GITHUB_OUTPUT: out,
      // No GitHub in a unit test: the "superseded" lookup is skipped.
      GITHUB_REPOSITORY: "", WAIT_MINUTES: "0.02", POLL_SECONDS: "0.2",
    },
  });
  return { stdout, output: readFileSync(out, "utf8") };
}

const A = "a".repeat(40);
const B = "b".repeat(40);

describe("wait-for-live", () => {
  it("goes on once production serves the deploy's commit", async () => {
    answer = { ok: true, sha: A };
    expect((await waitFor(A)).output).toBe("live=true\n");
  });

  it("stands down, without failing, when the deploy never goes live (a check held it)", async () => {
    answer = { ok: true, sha: B };
    const { stdout, output } = await waitFor(A);
    expect(output).toBe("live=false\n");
    expect(stdout).toContain("held");
  });

  it("does not mistake an older build that reports no commit for this one", async () => {
    answer = { ok: true };
    expect((await waitFor(A)).output).toBe("live=false\n");
  });

  it("a scheduled or manual run has no commit to wait for and goes straight on", async () => {
    answer = { ok: true, sha: B };
    expect((await waitFor("")).output).toBe("live=true\n");
  });
});
