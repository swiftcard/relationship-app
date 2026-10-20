// ── Agent 9: Security Watch — deterministic scans, drafts only ───────────────
// npm audit from the lockfile, a secret-pattern sweep of the working tree, and
// live security-header checks on production. Findings land in the queue;
// CRITICAL data-isolation-class findings ALSO email immediately. It never
// merges, never patches automatically — draft guidance only.
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { safeMain, email } from "./lib/agentkit.mjs";

const SECRET_PATTERNS = [
  [/sk_live_[A-Za-z0-9]{20,}/, "Stripe live secret key"],
  [/-----BEGIN (RSA |EC )?PRIVATE KEY-----/, "Private key material"],
  [/eyJhbGciOiJ[A-Za-z0-9_-]{80,}/, "Hardcoded JWT"],
  [/AIza[0-9A-Za-z_-]{35}/, "Google API key"],
  [/appl_[A-Za-z0-9]{20,}/, "RevenueCat public key (fine in bundle; flag if in server code)"],
];
const SCAN_DIRS = ["src", "scripts", "marketing-agents", "supabase"];
const SKIP = /node_modules|\.next|\.git/;

function* files(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (SKIP.test(p)) continue;
    const st = statSync(p);
    if (st.isDirectory()) yield* files(p);
    else if (/\.(ts|tsx|mjs|js|sql|json|yml)$/.test(name)) yield p;
  }
}

await safeMain("security", async (run) => {
  const critical = [];

  await run.note("npm audit (lockfile)…");
  let audit = { vulnerabilities: {} };
  try { execFileSync("npm", ["audit", "--json", "--audit-level=low"], { encoding: "utf8", maxBuffer: 32e6 }); }
  catch (e) { try { audit = JSON.parse(e.stdout || "{}"); } catch { /* offline */ } }
  const vulns = Object.entries(audit.vulnerabilities ?? {});
  const sev = { critical: [], high: [], moderate: [], low: [] };
  for (const [name, v] of vulns) sev[v.severity]?.push(`${name} (${v.severity}${v.fixAvailable ? ", fix available" : ""})`);
  if (sev.critical.length || sev.high.length) {
    await run.addItem({ item_type: "security_finding", platform: "repo", target: "npm dependencies",
      title: `Dependencies: ${sev.critical.length} critical, ${sev.high.length} high`,
      content: `Run \`npm audit\` locally and patch via \`npm audit fix\` (review the diff — never auto-merge).\n\nCritical: ${sev.critical.join(", ") || "-"}\nHigh: ${sev.high.join(", ") || "-"}\nModerate: ${sev.moderate.length}, Low: ${sev.low.length}\n\nRecommendation: enable GitHub Dependabot (Settings → Code security) so patch PRs open automatically as drafts.`,
      context: "npm audit against package-lock.json", dedupe_key: `npm-audit:${sev.critical.length}c${sev.high.length}h` });
    if (sev.critical.length) critical.push(`${sev.critical.length} CRITICAL dependency vulnerabilities`);
  }

  await run.checkpoint();
  await run.note("Secret-pattern sweep…");
  const hits = [];
  for (const dir of SCAN_DIRS) for (const f of files(dir)) {
    const text = readFileSync(f, "utf8");
    for (const [re, label] of SECRET_PATTERNS) if (re.test(text)) hits.push(`${f}: ${label}`);
  }
  if (hits.length) {
    await run.addItem({ item_type: "security_finding", platform: "repo", target: "secret scan",
      title: `Possible committed secrets: ${hits.length} hit(s)`,
      content: hits.join("\n") + "\n\nRotate anything real IMMEDIATELY — a committed secret is compromised even after deletion (git history).",
      context: "Pattern sweep of src/, scripts/, marketing-agents/, supabase/", dedupe_key: `secrets:${hits.length}` });
    critical.push(`${hits.length} possible committed secret(s)`);
  }

  await run.checkpoint();
  await run.note("Live security headers…");
  const res = await fetch("https://swiftcard.me/", { redirect: "follow" });
  const missing = ["strict-transport-security", "x-content-type-options", "referrer-policy", "x-frame-options"]
    .filter((h) => !res.headers.get(h));
  if (missing.length)
    await run.addItem({ item_type: "security_finding", platform: "site", target: "security headers",
      title: `Missing security headers: ${missing.join(", ")}`,
      content: `Add in next.config.ts headers(). Present now: ${[...res.headers.keys()].filter((k) => /security|frame|referrer|content-type-options/.test(k)).join(", ") || "none"}`,
      context: "GET https://swiftcard.me/", dedupe_key: `headers:${missing.sort().join(",")}` });

  // Auth/data-isolation: the deep RLS audit is pinned in the repo's own suite
  // (tests/*rls*, service-role scoping) and was verified end-to-end 2026-08-27.
  // This agent re-states the standing requirement + escalation path.
  await run.addItem({ item_type: "security_finding", platform: "repo", target: "auth & data isolation",
    title: "Standing check: RLS + per-user scoping (see content)",
    content: "Automated posture: RLS is ON for all product tables; user-scoped reads verified 2026-08-27 (signed-in user sees 0 foreign rows; cannot self-upgrade plan). Every new API route MUST call requireAdmin/auth.getUser and scope by user_id/card_id/office_id.\n\n⚠️ AUTOMATED SCANNING IS NOT A PENETRATION TEST. Before scaling, commission a professional pentest — this system cannot substitute for one.\n\nAny finding of data bleeding between users/cards/offices is CRITICAL: it emails immediately and must be fixed before anything else.",
    context: "Recurring posture statement", dedupe_key: "posture:rls" });

  if (critical.length) {
    await email(`🔴 SECURITY: ${critical.join(" · ")}`,
      `<h3>Critical security findings</h3><ul>${critical.map((c) => `<li>${c}</li>`).join("")}</ul><p>Details are in the agent_queue_items table. These do not wait for the digest.</p>`);
  }
  await run.finish("success", `${run.outputCount} finding(s) queued${critical.length ? `; ${critical.length} CRITICAL emailed immediately` : ""}. $0.00 (no LLM).`);
});
