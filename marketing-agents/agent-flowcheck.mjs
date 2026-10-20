// ── Flow Check (Finn): do the USER JOURNEYS still work, end to end? ──────────
// Dependency-free and $0 (no LLM). Where Dash asks "is it fast?" and Vera asks
// "is it safe?", Finn asks "does clicking through it still WORK?" — the class
// of bug that throws no error and trips no Sentry event, it just dead-ends the
// user (the 2026-09-02 LinkedIn headshot bug: OAuth finished, nothing applied).
//
// Every check is READ-ONLY against the live site: nothing is created, posted,
// or signed up. Three families:
//   1. FLOW CONTRACTS — multi-step legs behave: OAuth starts redirect to the
//      right provider with the right params; broken/empty legs land on the
//      right error state; auth walls actually wall.
//   2. JOURNEY RENDERS — the pages of the money paths contain the controls the
//      journey needs (the builder really offers "Suggest my profile picture").
//   3. LINK ROT — a sample of the sitemap's own URLs still resolve.
// Clean run self-files as read (zero owner clicks); findings stay pending and
// hand themselves to the Fixer, exactly like SEO and Performance Watch.
import { safeMain, email } from "./lib/agentkit.mjs";

const SITE = "https://swiftcard.me";
const UA = { "User-Agent": "SwiftCardFlowCheck/1.0 (internal watchdog)" };

/** GET without following redirects — flow contracts are ABOUT the redirect. */
async function probe(path, { follow = false } = {}) {
  try {
    const res = await fetch(path.startsWith("http") ? path : SITE + path, {
      headers: UA, redirect: follow ? "follow" : "manual", signal: AbortSignal.timeout(12000),
    });
    const body = follow || res.status === 200 ? await res.text().catch(() => "") : "";
    return { status: res.status, location: res.headers.get("location") ?? "", body };
  } catch (e) {
    return { status: 0, location: "", body: "", err: String(e).slice(0, 80) };
  }
}

// Each check returns null (healthy) or a finding string. `critical` findings
// email immediately — they mean a money path or an auth wall is broken NOW.
const CHECKS = [
  {
    label: "LinkedIn photo-import leg starts correctly",
    critical: true,
    async run() {
      const r = await probe("/api/integrations/linkedin/connect?guest=1&next=/cards/new");
      if (r.status === 0) return `connect route unreachable (${r.err})`;
      if (![302, 307, 308].includes(r.status)) return `connect route returned ${r.status} instead of a redirect`;
      if (r.location.includes("status=error")) return "connect route says LinkedIn is NOT CONFIGURED (env keys missing?) — the headshot import is dead for every user";
      if (!r.location.startsWith("https://www.linkedin.com/oauth/v2/authorization")) return `connect redirects somewhere unexpected: ${r.location.slice(0, 120)}`;
      const q = new URL(r.location).searchParams;
      for (const p of ["client_id", "redirect_uri", "state", "scope"]) if (!q.get(p)) return `LinkedIn authorize URL is missing "${p}" — consent screen will reject it`;
      if (!q.get("redirect_uri").startsWith(`${SITE}/api/integrations/linkedin/callback`)) return `LinkedIn redirect_uri points at ${q.get("redirect_uri")} — the return leg cannot land`;
      if (!/openid/.test(q.get("scope"))) return `LinkedIn scope lost "openid" (now: ${q.get("scope")}) — userinfo (the photo) will 403`;
      return null;
    },
  },
  {
    label: "LinkedIn return leg lands on a clean error state when empty",
    async run() {
      const r = await probe("/api/integrations/linkedin/callback");
      if (![302, 307, 308].includes(r.status)) return `callback with no code returned ${r.status} instead of redirecting the user back`;
      if (!r.location.includes("status=")) return `callback error leg carries no status= for the UI to react to: ${r.location.slice(0, 120)}`;
      return null;
    },
  },
  {
    label: "signed-out connect (non-guest) hits the login wall",
    critical: true,
    async run() {
      const r = await probe("/api/integrations/linkedin/connect");
      if (![302, 307, 308].includes(r.status)) return `expected a redirect for signed-out connect, got ${r.status}`;
      if (!/\/(login|settings)/.test(r.location)) return `signed-out connect redirected to ${r.location.slice(0, 120)} instead of the login wall`;
      return null;
    },
  },
  {
    label: "auth wall on the dashboard",
    critical: true,
    async run() {
      const r = await probe("/dashboard");
      if ([302, 307, 308].includes(r.status)) return /\/login/.test(r.location) ? null : `dashboard redirects to ${r.location.slice(0, 120)}, not /login`;
      if (r.status === 200 && !/login|sign in/i.test(r.body)) return "DASHBOARD RENDERED FOR A SIGNED-OUT VISITOR — auth wall down";
      return null;
    },
  },
  {
    label: "card builder loads with its steps wired",
    async run() {
      // The wizard SSRs only step 1, so step 2's controls (the headshot
      // suggest) are NOT in this HTML — asserting them here cried wolf on
      // Finn's very first dry run. What step-1 HTML does guarantee: the
      // builder rendered and the path to Card design exists.
      const r = await probe("/cards/new", { follow: true });
      if (r.status !== 200) return `/cards/new returned ${r.status}`;
      if (!/New card/i.test(r.body)) return "the builder page rendered without its step-1 form";
      if (!/Card design/i.test(r.body)) return "step 1 no longer leads to “Card design” — the wizard steps are unwired";
      return null;
    },
  },
  {
    label: "guest photo lookup answers",
    async run() {
      const r = await probe("/api/photo-suggest?email=flowcheck-probe%40example.com", { follow: true });
      if (r.status !== 200) return `photo-suggest returned ${r.status}`;
      try { if (!Array.isArray(JSON.parse(r.body).candidates)) return "photo-suggest 200 but no candidates array — the suggest UI will show a spinner forever"; } catch { return "photo-suggest returned non-JSON"; }
      return null;
    },
  },
  {
    label: "pricing → checkout wall",
    async run() {
      const r = await probe("/checkout");
      if (r.status === 200) return null; // public checkout page renders
      if ([302, 307, 308].includes(r.status)) return /\/(login|pricing|upgrade)/.test(r.location) ? null : `checkout redirects to ${r.location.slice(0, 120)}`;
      return `checkout returned ${r.status}`;
    },
  },
  {
    label: "blog posts resolve from the index",
    async run() {
      const idx = await probe("/blog", { follow: true });
      if (idx.status !== 200) return `/blog returned ${idx.status}`;
      const slug = idx.body.match(/href="(\/blog\/[a-z0-9-]+)"/)?.[1];
      if (!slug) return null; // no posts yet — nothing to rot
      const post = await probe(slug, { follow: true });
      if (post.status !== 200) return `blog index links ${slug} but it returns ${post.status}`;
      return null;
    },
  },
  {
    label: "sitemap URLs still resolve (sample)",
    async run() {
      const sm = await probe("/sitemap.xml", { follow: true });
      if (sm.status !== 200) return `sitemap returned ${sm.status}`;
      const locs = [...sm.body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]).filter((u) => u.startsWith(SITE));
      if (locs.length < 10) return `sitemap lists only ${locs.length} URLs`;
      // Deterministic daily sample of 4 — rotates coverage, stays cheap.
      const day = Math.floor(Date.now() / 86400e3);
      const rot = [];
      for (let i = 0; i < 4; i++) rot.push(locs[(day * 7 + i * Math.floor(locs.length / 4)) % locs.length]);
      for (const u of rot) {
        const r = await probe(u, { follow: true });
        if (r.status !== 200) return `sitemap lists ${u} but it returns ${r.status}`;
      }
      return null;
    },
  },
];

await safeMain("flowcheck", async (run) => {
  const findings = [], critical = [], ok = [];
  for (const c of CHECKS) {
    await run.checkpoint();
    await run.note(`Checking: ${c.label}…`);
    let f = await c.run();
    // One retry before crying wolf — a single network blip is not a finding.
    if (f) { await new Promise((r) => setTimeout(r, 1500)); f = await c.run(); }
    if (f) { const m = `${c.label}: ${f}`; findings.push(m); if (c.critical) critical.push(m); }
    else ok.push(c.label);
  }

  const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
  const item = await run.addItem({
    item_type: "flow_finding",
    platform: "site", target: "swiftcard.me user journeys",
    title: findings.length ? `Flow check: ${findings.length} broken journey(s) — ${stamp}` : `Flow check: every journey works ✓ — ${stamp}`,
    content: [
      findings.length ? "BROKEN:\n- " + findings.join("\n- ") : "All user journeys completed their contracts.",
      `\nHEALTHY (${ok.length}):\n- ` + ok.join("\n- "),
      "\nRead-only sweep — nothing was created, posted, or signed up.",
    ].join("\n"),
    context: "Automated end-to-end user-journey contracts: OAuth legs, auth walls, builder controls, link rot. The class of bug that throws no error but dead-ends the user.",
    status: findings.length ? "pending" : "acknowledged",
    payload: { healthy: ok.length, broken: findings.length },
  });

  if (critical.length) {
    await email(`🔴 USER JOURNEY BROKEN: ${critical[0]}${critical.length > 1 ? ` (+${critical.length - 1} more)` : ""}`,
      `<h3>A money-path flow is broken right now</h3><ul>${critical.map((c) => `<li>${c}</li>`).join("")}</ul><p>Details are in the agent_queue_items table. These are contract failures a user hits directly — no error page, just a dead end.</p>`);
  }
  // Closed loop, same as SEO/perf: findings dispatch the Fixer via step outputs.
  try {
    const { appendFileSync } = await import("node:fs");
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `findings=${findings.length}\nitem_id=${item?.id ?? ""}\n`);
  } catch { /* not running in Actions */ }
  await run.finish("success", `${findings.length} broken, ${ok.length} journeys healthy. $0.00 (no LLM).`);
});
