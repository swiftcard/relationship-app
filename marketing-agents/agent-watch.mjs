// ── Generic full pass for a servicing watchdog ──────────────────────────────
// Usage: node marketing-agents/agent-watch.mjs <agent_id>
//
// The watchdog loop (watchdog.mjs) is the thing that actually watches, minute
// by minute, and it wakes this workflow on a NEW finding. This run is the
// agent's written report: the full detector pass, one status item in the
// queue (pending when something is wrong, acknowledged when all is clear), an
// email on anything critical, and — for code-fixable benches — the item id in
// GITHUB_OUTPUT so the workflow can hand it to Fixer for a DRAFT pull request.
//
// Code-only: no LLM anywhere in this file. $0.00 per run.
import { appendFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { safeMain, email } from "./lib/agentkit.mjs";
import { DETECTORS, blindnessFindings } from "./lib/detectors.mjs";
import { FINDING_ITEM_TYPE } from "./lib/detectors-servicing.mjs";

const agentId = process.argv[2];
if (!agentId || !DETECTORS[agentId]) { console.error(`usage: agent-watch.mjs <${Object.keys(DETECTORS).join("|")}>`); process.exit(2); }

const LABEL = {
  cards: ["Card health", "card pages, vCards, logos and /links pages for a rotating sample of every live card"],
  links: ["Link check", "every link on the marketing site, the sitemap, robots.txt, indexability and referral redirects"],
  payments: ["Payments watch", "failed payments, chargebacks, cancellation spikes, webhook silence and Pro-plan drift"],
  deliverability: ["Deliverability", "email and push delivery failure rates, the welcome email, the unsubscribe page"],
  renewals: ["Renewals", "the domain, the HTTPS certificate and every dated secret in renewals.json"],
  deps: ["Dependency audit", "high and critical vulnerabilities in the runtime dependencies"],
  data: ["Data integrity", "view and signup silence against baseline, orphaned cards, row-level security"],
  appstore: ["App Store watch", "listing presence, rating, and new 1–2★ reviews"],
  layout: ["Layout check", "the stylesheet the whole site depends on"],
  flowcheck: ["Flow check", "user journeys"], perf: ["Performance", "page speed"], security: ["Security", "headers and refusals"], bugwatch: ["Bug watch", "production errors"],
};

await safeMain(agentId, async (run) => {
  const [name, scope] = LABEL[agentId] ?? [agentId, "its watch"];
  await run.note(`Full pass: ${scope}…`);
  await run.checkpoint();
  const findings = [...(await blindnessFindings(agentId)), ...(await DETECTORS[agentId]({ openKeys: [] }))];
  const critical = findings.filter((f) => f.severity === "critical");
  const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
  const line = (f) => `${f.severity === "critical" ? "🔴" : "🟠"} ${f.title}\n   ${f.detail}`;

  // Belt and braces against a double-filed report. The loop now wakes an agent
  // once per cycle rather than once per finding, but a retry, a backstop cron
  // and the loop can still overlap. Keying the report on WHAT IS WRONG (not on
  // the minute it ran) means a repeat pass over the same problems collapses
  // into the one item, while a genuinely different problem set files a new one.
  // Clean reports key by day, so an all-quiet watch files one tick, not dozens.
  const signature = findings.length
    ? createHash("sha1").update(findings.map((f) => f.key).sort().join("|")).digest("hex").slice(0, 16)
    : `clear:${stamp.slice(0, 10)}`;

  const item = await run.addItem({
    item_type: FINDING_ITEM_TYPE[agentId] ?? "generic",
    dedupe_key: `watchdog:report:${agentId}:${signature}`,
    platform: "site", target: `swiftcard.me ${name.toLowerCase()}`,
    title: findings.length ? `${name}: ${findings.length} problem(s) — ${stamp}` : `${name}: all clear ✓ — ${stamp}`,
    content: [
      findings.length ? "FOUND:\n" + findings.map(line).join("\n") : `Nothing wrong with ${scope}.`,
      "\nRead-only sweep — nothing was created, changed, posted, or paid for.",
    ].join("\n"),
    context: `Full pass over ${scope}. The minute-by-minute loop files each problem the moment it appears; this is the written report and, where code can fix it, the hand-off to Fixer.`,
    status: findings.length ? "pending" : "acknowledged",
    payload: { findings: findings.map((f) => ({ key: f.key, severity: f.severity, title: f.title })) },
  });

  if (critical.length) {
    await email(`🔴 ${name}: ${critical[0].title}${critical.length > 1 ? ` (+${critical.length - 1} more)` : ""}`,
      `<h3>${name} found something critical</h3><ul>${critical.map((c) => `<li><b>${c.title}</b><br>${c.detail}</li>`).join("")}</ul><p>Details are in the agent_queue_items table.</p>`);
  }
  try {
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `findings=${findings.length}\nitem_id=${item?.id ?? ""}\n`);
  } catch { /* not running in Actions */ }
  await run.finish("success", `${findings.length} problem(s), ${critical.length} critical. $0.00 (no LLM).`);
});
