import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { groupErrors } from "@/lib/crew/agents/watch-bugs";
import { paymentFindings } from "@/lib/crew/agents/watch-payments";
import { watchUi } from "@/lib/crew/agents/watch-ingested";
import { decide } from "@/lib/crew/decide";
import { closeMissing, normalizeFailure, recurrence, redact, reportFindings } from "@/lib/crew/watch/findings";
import { healthFindings, nightlyFindings, type NightlySummary } from "@/lib/crew/watch/ingested";
import { isSpike } from "@/lib/crew/sources/site-checks";
import { AGENTS } from "@/lib/crew/registry";
import { FULL, setup, fakeAgent } from "./crew-helpers";

// Phase 1, the Watchdog: one finding per distinct problem, a model only for
// new ones, a Fix card that opens a PULL REQUEST (never a merge).

afterEach(() => vi.unstubAllEnvs());

const triageScript = (req: { schema?: unknown; prompt: string }) => {
  if (!req.schema) return "x";
  const keys = [...req.prompt.matchAll(/KEY: (f\d+)/g)].map((m) => m[1]);
  return JSON.stringify({ items: keys.map((k) => ({ key: k, title: "Saving a card fails", summary: "Some people can't save their card.", severity: k === "f0" ? "critical" : "medium", fix_brief: "Probably src/app/api/cards. Add a test." })) });
};

const raw = (fp: string) => ({ fingerprint: fp, kind: "bug" as const, source: "error_events", title: `boom ${fp}`, detail: { message: "boom" } });

describe("findings", () => {
  it("only new problems reach the model, and each becomes one Fix card", async () => {
    const { ctx, claude, store } = await setup({ def: fakeAgent({ id: "watch-x", team: "watchdog", approvalKind: "code_fix" }), script: triageScript, settings: FULL });
    const first = await reportFindings(ctx, [raw("a"), raw("b")]);
    expect(first).toEqual({ fresh: 2, proposed: 2 });
    expect(claude.calls).toHaveLength(1); // one call for the whole batch
    const again = await reportFindings(ctx, [raw("a"), raw("b")]);
    expect(again).toEqual({ fresh: 0, proposed: 0 });
    expect(claude.calls).toHaveLength(1);
    expect(store.findings.find((f) => f.fingerprint === "a")!.count).toBe(2);
    const card = store.approvals[0];
    expect(card.kind).toBe("code_fix");
    expect(card.title).toBe("Fix: Saving a card fails");
    expect(card.summary).toMatch(/opens a fix for you to review/);
  });

  // The owner, 2026-10-29: "It gives it to me once and then I approve it and
  // it gets fixed. If it gets broken again then it does it again."
  const watcher = () => setup({ def: fakeAgent({ id: "watch-x", team: "watchdog", approvalKind: "code_fix", maxPending: 10 }), script: triageScript, settings: FULL });

  it("a problem that broke again after the fix you approved is raised again, and says so", async () => {
    const { ctx, claude, store } = await watcher();
    await reportFindings(ctx, [raw("a")]);
    store.approvals[0].status = "done"; // you approved the fix
    expect(await closeMissing(ctx, "error_events", new Set())).toBe(1);
    const back = await reportFindings(ctx, [raw("a")]);
    expect(back).toEqual({ fresh: 1, proposed: 1 });
    expect(claude.calls).toHaveLength(2);
    expect(store.approvals).toHaveLength(2);
    expect(store.approvals[1].title).toMatch(/^Fix: Broken again: /);
    expect(store.approvals[1].summary).toMatch(/You approved a fix for this on .*broken again/);
  });

  it("approved and still there: no second card while the fix is on its way", async () => {
    const { ctx, store } = await watcher();
    await reportFindings(ctx, [raw("a")]);
    store.approvals[0].status = "done";
    for (let i = 0; i < 3; i++) expect((await reportFindings(ctx, [raw("a")])).fresh).toBe(0);
    expect(store.approvals).toHaveLength(1);
  });

  it("gone and back while its card still waits: still the one card", async () => {
    const { ctx, store } = await watcher();
    await reportFindings(ctx, [raw("a")]);
    await closeMissing(ctx, "error_events", new Set());
    expect((await reportFindings(ctx, [raw("a")])).fresh).toBe(0);
    expect(store.approvals).toHaveLength(1);
    expect(store.findings.find((f) => f.fingerprint === "a")!.status).toBe("proposed");
  });

  it("a card you turned down never comes back", async () => {
    const { ctx, store } = await watcher();
    await reportFindings(ctx, [raw("a")]);
    store.approvals[0].status = "rejected";
    expect((await reportFindings(ctx, [raw("a")])).fresh).toBe(0);
    await closeMissing(ctx, "error_events", new Set());
    expect((await reportFindings(ctx, [raw("a")])).fresh).toBe(0);
    expect(store.approvals).toHaveLength(1);
  });

  it("one lucky passing run doesn't count as fixed", async () => {
    const { ctx, store } = await watcher();
    await reportFindings(ctx, [raw("a")]);
    store.approvals[0].status = "done";
    expect(await closeMissing(ctx, "error_events", new Set(), { quietMs: 20 * 3600_000 })).toBe(0);
    expect((await reportFindings(ctx, [raw("a")])).fresh).toBe(0);
    expect(store.approvals).toHaveLength(1);
  });

  it("a problem already raised under its old per-screen key gets no new card", async () => {
    const { ctx, store } = await watcher();
    await reportFindings(ctx, [raw("old-key")]);
    store.approvals[0].status = "done";
    const r = await reportFindings(ctx, [{ ...raw("new-key"), aliases: ["old-key"] }]);
    expect(r.fresh).toBe(0);
    expect(store.approvals).toHaveLength(1);
    expect(store.findings.find((f) => f.fingerprint === "new-key")!.approval_id).toBe(store.approvals[0].id);
  });

  it("decides new, same, back and dismissed from the stored finding and its card", () => {
    expect(recurrence(null, null)).toBe("new");
    expect(recurrence({ status: "open", approval_id: null }, null)).toBe("new");
    expect(recurrence({ status: "proposed", approval_id: "c" }, "pending")).toBe("same");
    expect(recurrence({ status: "proposed", approval_id: "c" }, "done")).toBe("same");
    expect(recurrence({ status: "proposed", approval_id: "c" }, "expired")).toBe("same");
    expect(recurrence({ status: "fixed", approval_id: "c" }, "done")).toBe("back");
    expect(recurrence({ status: "fixed", approval_id: "c" }, "approved")).toBe("back");
    expect(recurrence({ status: "fixed", approval_id: "c" }, "pending")).toBe("same");
    expect(recurrence({ status: "fixed", approval_id: "c" }, "rejected")).toBe("dismissed");
    expect(recurrence({ status: "fixed", approval_id: null }, null)).toBe("new");
    expect(recurrence({ status: "ignored", approval_id: "c" }, "done")).toBe("dismissed");
  });

  it("with the inbox full it doesn't pay to explain anything", async () => {
    const { ctx, claude } = await setup({ def: fakeAgent({ id: "watch-x", team: "watchdog", approvalKind: "code_fix", maxPending: 0 }), script: triageScript });
    expect((await reportFindings(ctx, [raw("z")])).proposed).toBe(0);
    expect(claude.calls).toHaveLength(0);
  });

  it("strips personal data before anything leaves", () => {
    expect(redact("user jane@acme.com phone +1 (917) 555-0134 key sk_live_abcdefghijklmnopqrstu")).toBe("user <email> phone <phone> key <secret>");
    expect(normalizeFailure("card 1234 failed in 532ms at 2026-10-20T05:00:00Z")).toBe("card <n> failed in <dur> at <time>");
  });
});

describe("sources", () => {
  it("groups crashes by fingerprint", () => {
    const rows = [
      { created_at: "1", context: "api:/cards", message: "boom", stack: null, fingerprint: "F1", extra: null },
      { created_at: "2", context: "api:/cards", message: "boom", stack: null, fingerprint: "F1", extra: null },
      { created_at: "3", context: "client:/dashboard", message: "x", stack: null, fingerprint: "F2", extra: null },
    ];
    const g = groupErrors(rows);
    expect(g).toHaveLength(2);
    expect(g.find((x) => x.title.startsWith("api:/cards"))!.count).toBe(2);
  });

  it("maps nightly sections to the right agent and dedupes the same failure across nights", () => {
    const s = (n: number): NightlySummary => ({
      healthy: false,
      failedCount: 2,
      at: `2026-10-2${n}T09:00:00Z`,
      sections: [
        { name: "Every screen, both widths, all plans", failures: [`/dashboard@390: overflow 12${n}px`] },
        { name: "Flows (sign in, save, sign out, back/forward)", failures: ["save then reload lost the title"] },
      ],
    });
    const ui1 = nightlyFindings(s(1), [/^Every screen/i], "ui", "nightly-sweep");
    const ui2 = nightlyFindings(s(2), [/^Every screen/i], "ui", "nightly-sweep");
    expect(ui1).toHaveLength(1);
    expect(ui1[0].fingerprint).toBe(ui2[0].fingerprint); // numbers normalized away
    expect(nightlyFindings(s(1), [/^Flows/i], "flow", "nightly-flows")[0].title).toMatch(/lost the title/);
  });

  it("the same failure on many screens is one finding naming them, and a changing link or token is the same failure", () => {
    const night = (id: string): NightlySummary => ({
      healthy: false,
      failedCount: 4,
      at: "2026-10-29T09:00:00Z",
      sections: [
        {
          name: "Android app: every screen, Free + Pro, both themes",
          failures: [
            "pixel-8-free-settings: status-bar-style-unset — the app never set the status-bar style (theme is light), so Android uses the PHONE's dark mode",
            "small-360-pro-settings: status-bar-style-unset — the app never set the status-bar style (theme is light), so Android uses the PHONE's dark mode",
            `pixel-8-free-view-live: new-tab-stays-in-app — "https://swiftcard.me/api/self-view?to=%2Fqa-and-free-${id}-0&t=MzA5Mzc5ZDQtMWIyYy00OWE1LWEyMDgtNTg4ZmJmMjBmZDg3fDE3`,
            `small-360-pro-view-live: new-tab-stays-in-app — "https://swiftcard.me/api/self-view?to=%2Fqa-and-pro-${id}-3&t=ZGYyYmQ4ZDctNTIxNy00N2QzLTkxZWEtZWUyNTJjMTY0MmRlfDE3OT`,
          ],
        },
      ],
    });
    const a = nightlyFindings(night("00509769"), [/^Android app/i], "app", "nightly-app");
    const b = nightlyFindings(night("13779583"), [/^Android app/i], "app", "nightly-app");
    expect(a).toHaveLength(2);
    expect(a.map((x) => x.fingerprint)).toEqual(b.map((x) => x.fingerprint));
    const bar = a.find((x) => /status-bar/.test(x.title))!;
    expect(bar.title).toMatch(/\(on 2 screens\)$/);
    expect(bar.detail.where).toEqual(["pixel-8-free-settings", "small-360-pro-settings"]);
    // Each screen's old key, so the cards already raised under them still count.
    expect(bar.aliases).toHaveLength(2);
  });

  it("one crash under several labels is one card", () => {
    const row = (category: string) => ({ created_at: "1", context: "push.delivery", message: `push not delivered (${category}): web 403`, stack: null, fingerprint: `push.delivery|push not delivered (${category}): web <n>`, extra: null });
    const g = groupErrors([row("card_view"), row("weekly_recap"), row("getting_started")]);
    expect(g).toHaveLength(1);
    expect(g[0].count).toBe(3);
    expect(g[0].aliases).toHaveLength(3);
  });

  it("health failures become speed or outage findings", () => {
    const h = healthFindings({ healthy: false, results: [{ name: "speed budget (median of 3, full response) /", ok: false, detail: "2900ms > 2500ms", ms: 2900 }, { name: "home page", ok: true, detail: "200", ms: 300 }] });
    expect(h).toHaveLength(1);
    expect(h[0].kind).toBe("speed");
  });

  it("a spike needs both a floor and 5x the normal rate", () => {
    expect(isSpike({ lastHour: 30, avgHour: 2 }, 25)).toBe(true);
    expect(isSpike({ lastHour: 30, avgHour: 10 }, 25)).toBe(false);
    expect(isSpike({ lastHour: 10, avgHour: 0 }, 25)).toBe(false);
  });

  it("payment issues are keyed per invoice so a retry isn't a second card", () => {
    const a = paymentFindings([{ key: "inv:in_1", kind: "failed_payment", title: "A $4.99 payment failed (try 1)", detail: {} }], "stripe-payments");
    const b = paymentFindings([{ key: "inv:in_1", kind: "failed_payment", title: "A $4.99 payment failed (try 2)", detail: {} }], "stripe-payments");
    expect(a[0].fingerprint).toBe(b[0].fingerprint);
  });
});

describe("ingested agents", () => {
  it("the UI watcher reads the latest nightly once", async () => {
    const { ctx, store, claude } = await setup({ def: watchUi, script: triageScript, settings: FULL });
    await store.kvSet("ingest:nightly", { at: "2026-10-20T09:00:00Z", run: "1", data: { healthy: false, failedCount: 1, at: "x", sections: [{ name: "Every screen, both widths, all plans", failures: ["/settings@390: button covered"] }] } });
    expect((await watchUi.run(ctx)).summary).toMatch(/1 problems/);
    expect(store.approvals).toHaveLength(1);
    expect((await watchUi.run(ctx)).summary).toMatch(/No new nightly results/);
    expect(claude.calls).toHaveLength(1);
  });
});

describe("the fix executor", () => {
  it("approving a fix with no GitHub token says so and starts nothing", async () => {
    vi.stubEnv("CREW_GITHUB_TOKEN", "");
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { ctx, store } = await setup({ def: fakeAgent({ id: "watch-x", team: "watchdog", approvalKind: "code_fix" }), script: triageScript });
    await reportFindings(ctx, [raw("a")]);
    const r = await decide(store, store.approvals[0].id, { action: "approve", by: "owner" });
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/CREW_GITHUB_TOKEN/);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("with a token it dispatches crew-fix.yml on main with the brief, once", async () => {
    vi.stubEnv("CREW_GITHUB_TOKEN", "ghp_test");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 204 }));
    const { ctx, store } = await setup({ def: fakeAgent({ id: "watch-x", team: "watchdog", approvalKind: "code_fix" }), script: triageScript });
    await reportFindings(ctx, [raw("a")]);
    const id = store.approvals[0].id;
    expect((await decide(store, id, { action: "approve", by: "owner" })).ok).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.github.com/repos/swiftcard/relationship-app/actions/workflows/crew-fix.yml/dispatches");
    expect(JSON.parse(String(init.body))).toMatchObject({ ref: "main", inputs: { approval_id: id } });
    expect((await store.getApproval(id))!.status).toBe("done");
    expect((await decide(store, id, { action: "approve", by: "owner" })).ok).toBe(false);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    fetchSpy.mockRestore();
  });
});

describe("workflows", () => {
  const fix = readFileSync(".github/workflows/crew-fix.yml", "utf8");
  it("crew-fix opens a pull request and can never merge or push to main", () => {
    expect(fix).toContain("gh pr create --base main");
    expect(fix).not.toMatch(/gh pr merge|git push[^\n]*\bmain\b|--no-verify|--admin/);
    expect(fix).toMatch(/git checkout -b "crew\/fix-/);
    // The brief reaches the model through a file, never interpolated into a shell line.
    expect(fix).toContain("BRIEF: ${{ inputs.brief }}");
    expect(fix).not.toMatch(/run: [^\n]*\$\{\{ inputs\./);
  });
  it("crew-fix never gives one job both the model and a way to write or run code with secrets", () => {
    const write = fix.slice(fix.indexOf("\n  write:\n"), fix.indexOf("\n  verify:\n"));
    const verify = fix.slice(fix.indexOf("\n  verify:\n"), fix.indexOf("\n  pr:\n"));
    const pr = fix.slice(fix.indexOf("\n  pr:\n"), fix.indexOf("\n  report:\n"));
    // write: the model, pinned, files-only, capped, no git credentials, no repo token.
    expect(write).toMatch(/@anthropic-ai\/claude-code@\d+\.\d+\.\d+/);
    expect(write).toContain("--allowedTools Read Edit Write Glob Grep");
    expect(write).not.toMatch(/Bash/);
    expect(write).toContain("--max-budget-usd");
    expect(write).toContain("persist-credentials: false");
    expect(write).not.toContain("CREW_GITHUB_TOKEN");
    // verify runs repo code, so it holds no secret at all.
    expect(verify).not.toMatch(/secrets\./);
    // ...and can't poison the npm cache the other jobs read.
    expect(verify).not.toMatch(/^\s+cache:|actions\/cache/m);
    expect(verify).toContain("persist-credentials: false");
    // pr holds the token but runs no repo code.
    expect(pr).toContain("CREW_GITHUB_TOKEN");
    expect(pr).not.toMatch(/npm |npx /);
    expect(pr).not.toContain("CREW_ANTHROPIC_API_KEY");
  });
  it("the monitors share results without being able to fail", () => {
    for (const p of [".github/workflows/uptime.yml", ".github/workflows/nightly-qa.yml"]) {
      const wf = readFileSync(p, "utf8");
      const step = wf.slice(wf.indexOf("Share the result with the Agents tab"), wf.indexOf("Share the result with the Agents tab") + 700);
      expect(step, p).toContain("continue-on-error: true");
      expect(step, p).toContain("|| true");
      expect(step, p).toContain("/api/crew/ingest?source=");
    }
  });
  it("the PR link posted back is pinned to this repo's pull requests", () => {
    expect(readFileSync("src/app/api/crew/ingest/route.ts", "utf8")).toContain("github\\.com\\/swiftcard\\/relationship-app\\/pull\\/\\d+$");
  });
});

describe("registry", () => {
  it("has every Watchdog agent from the spec, a manager, and the deferred scan watch locked", () => {
    const ids = AGENTS.filter((a) => a.team === "watchdog").map((a) => a.id);
    for (const id of ["watch-bugs", "watch-speed", "watch-security", "watch-app", "watch-ui", "watch-flows", "watch-probe", "watch-payments", "watch-revenue", "watch-scan-cost", "watchdog-manager"]) expect(ids).toContain(id);
    expect(AGENTS.find((a) => a.id === "watch-scan-cost")!.locked).toBeTruthy();
    expect(AGENTS.find((a) => a.id === "watchdog-manager")!.tier).toBe("opus");
    expect(new Set(AGENTS.map((a) => a.id)).size).toBe(AGENTS.length);
    for (const a of AGENTS.filter((x) => x.role === "worker")) expect(a.tier, a.id).toBe("sonnet");
  });
});
