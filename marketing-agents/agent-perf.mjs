// ── Performance Watch: is the product FAST, right now, compared to its past? ─
// Dependency-free and $0 (no LLM). Each run:
//   1. Times the critical public routes (3 samples, median TTFB + full time).
//   2. Compares against the rolling baseline built from its own previous
//      reports — a route >60% slower than its baseline, or over the absolute
//      ceiling, is a REGRESSION finding.
//   3. Sanity-checks that pages actually render (card shows its owner's name,
//      sitemap still lists the site) — fast garbage is still garbage.
//   4. A critical route DOWN or over 3s → immediate email, not just a queue row.
// Every report carries its raw timings in payload, so the baseline sharpens
// with every run. Pair with: uptime.yml (15-min is-it-up), deploy-watchdog
// (bad-deploy rollback), sentry-triage (error drafting) — this covers SPEED.
import { safeMain, sb, email } from "./lib/agentkit.mjs";

const SITE = "https://swiftcard.me";
const ROUTES = [
  { path: "/", label: "homepage", ceilingMs: 1800, critical: true },
  { path: "/aaronlavi-malvecapital", label: "card page", ceilingMs: 1200, critical: true, mustContain: "Aaron" },
  { path: "/links/aaronlavi-malvecapital", label: "Swift Links", ceilingMs: 1200, critical: true },
  { path: "/login", label: "login", ceilingMs: 1200, critical: true },
  { path: "/pricing", label: "pricing", ceilingMs: 1500, critical: false },
  { path: "/blog", label: "blog", ceilingMs: 1500, critical: false },
  { path: "/api/health", label: "api", ceilingMs: 900, critical: true },
  { path: "/sitemap.xml", label: "sitemap", ceilingMs: 2500, critical: false, minLocs: 40 },
];
const SAMPLES = 3;
// Regression rules tuned against false alarms (a watchdog that cries wolf
// gets ignored): a verdict needs a baseline of ≥3 prior reports, +60% AND
// +300ms over it, AND an absolute reading past 600ms — deploy-warmup jitter
// on a 300ms page is not a regression. The absolute ceilings above are the
// hard guard either way.
const REGRESSION_PCT = 60;
const REGRESSION_MIN_DELTA_MS = 300;
const REGRESSION_MIN_ABS_MS = 600;
const BASELINE_MIN_REPORTS = 3;

const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];

async function timeRoute(path) {
  const times = [];
  let status = 0, body = "";
  for (let i = 0; i < SAMPLES; i++) {
    const t0 = performance.now();
    try {
      const res = await fetch(SITE + path, { headers: { "User-Agent": "SwiftCardPerfWatch/1.0" }, signal: AbortSignal.timeout(10000) });
      body = await res.text();
      status = res.status;
      times.push(performance.now() - t0);
    } catch { status = 0; times.push(10000); }
    await new Promise((r) => setTimeout(r, 400));
  }
  return { ms: Math.round(median(times)), status, body };
}

await safeMain("perf", async (run) => {
  // Baseline: median of each route's timings across the last 10 reports.
  await run.note("Loading baseline from previous reports…");
  const prev = await sb("GET", "agent_queue_items", { params: "item_type=eq.perf_report&select=payload&order=created_at.desc&limit=10" });
  const base = {};
  for (const p of prev ?? []) for (const [label, ms] of Object.entries(p.payload?.timings ?? {})) (base[label] ??= []).push(ms);

  const findings = [], ok = [], critical = [], timings = {};
  for (const r of ROUTES) {
    await run.checkpoint();
    await run.note(`Timing ${r.label}…`);
    const { ms, status, body } = await timeRoute(r.path);
    timings[r.label] = ms;
    const baseMs = (base[r.label]?.length ?? 0) >= BASELINE_MIN_REPORTS ? median(base[r.label]) : null;
    const vs = baseMs ? ` (baseline ${baseMs}ms)` : "";

    if (status !== 200) { const m = `${r.label} (${r.path}) returned ${status || "TIMEOUT"}`; findings.push(m); if (r.critical) critical.push(m); continue; }
    if (r.mustContain && !body.includes(r.mustContain)) { const m = `${r.label} loads but its content is WRONG (missing "${r.mustContain}")`; findings.push(m); if (r.critical) critical.push(m); continue; }
    if (r.minLocs && (body.match(/<loc>/g) ?? []).length < r.minLocs) { findings.push(`${r.label}: only ${(body.match(/<loc>/g) ?? []).length} URLs — the dynamic section may be failing`); continue; }
    if (ms > 3000 && r.critical) { const m = `${r.label} is critically slow: ${ms}ms${vs}`; findings.push(m); critical.push(m); }
    else if (ms > r.ceilingMs) findings.push(`${r.label} over its ceiling: ${ms}ms (limit ${r.ceilingMs}ms)${vs}`);
    else if (baseMs && ms > baseMs * (1 + REGRESSION_PCT / 100) && ms - baseMs > REGRESSION_MIN_DELTA_MS && ms > REGRESSION_MIN_ABS_MS) findings.push(`${r.label} REGRESSED: ${ms}ms vs ${baseMs}ms baseline (+${Math.round(((ms - baseMs) / baseMs) * 100)}%)`);
    else ok.push(`${r.label}: ${ms}ms${vs} ✓`);
  }

  const item = await run.addItem({
    item_type: "perf_report",
    platform: "site", target: "swiftcard.me",
    title: findings.length ? `Speed check: ${findings.length} issue(s) — ${new Date().toISOString().slice(0, 16).replace("T", " ")}` : `Speed check: all fast ✓ — ${new Date().toISOString().slice(0, 16).replace("T", " ")}`,
    content: [
      findings.length ? "ISSUES:\n- " + findings.join("\n- ") : "Every route inside its ceiling and baseline.",
      "\nMEASURED (median of 3, full response time):\n- " + Object.entries(timings).map(([l, ms]) => `${l}: ${ms}ms`).join("\n- "),
      "\nAlso watching: uptime (15-min), deploy-watchdog (bad-deploy rollback), Bug Watch (Sentry drafts, needs Sentry armed).",
    ].join("\n"),
    context: "Automated speed + render-sanity sweep of the critical routes, compared to this agent's own rolling baseline.",
    status: findings.length ? "pending" : "acknowledged",
    payload: { timings },
  });

  if (critical.length) {
    await email(`🔴 SITE HEALTH: ${critical[0]}${critical.length > 1 ? ` (+${critical.length - 1} more)` : ""}`,
      `<h3>Critical route problem</h3><ul>${critical.map((c) => `<li>${c}</li>`).join("")}</ul><p>Details are in the agent_queue_items table. uptime.yml and the deploy watchdog are the other lines of defense; if a deploy caused this, the watchdog may already be rolling back.</p>`);
  }
  // Closed loop: a clean report files itself (zero owner clicks on quiet
  // days); a report WITH findings stays pending and hands itself to the Fixer
  // workflow via GitHub step outputs.
  try {
    const { appendFileSync } = await import("node:fs");
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `findings=${findings.length}\nitem_id=${item?.id ?? ""}\n`);
  } catch { /* not running in Actions */ }
  await run.finish("success", `${findings.length} issue(s), ${ok.length} routes healthy. $0.00 (no LLM).`);
});
