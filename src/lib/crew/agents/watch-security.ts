import type { AgentDef } from "../agent-def";
import { dnsProblems, hourlyRate, isSpike, missingSecurityHeaders, tlsDaysLeft } from "../sources/site-checks";
import { closeMissing, fingerprintOf, reportFindings, type RawFinding } from "../watch/findings";

// ── W3 Website security (hourly, code only until something is wrong) ──────
// Spam-bot signups, error storms (often an attack or a scraper), the domain's
// certificate and DNS, and the security headers. It can't change anything:
// for an attack it asks you to turn on Vercel's Attack Mode yourself.

export async function securityFindings(now: Date): Promise<RawFinding[]> {
  const out: RawFinding[] = [];
  const add = (key: string, title: string, detail: Record<string, unknown>) =>
    out.push({ fingerprint: `sec:${fingerprintOf(key)}`, kind: "security", source: "security", title, detail });

  const days = await tlsDaysLeft();
  if (days === null) add("tls-unreachable", "Could not read swiftcard.me's security certificate", {});
  else if (days < 14) add("tls-expiring", `The site's security certificate runs out in ${days} days`, { days_left: days });

  const missing = await missingSecurityHeaders();
  if (missing?.length) add(`headers:${missing.join(",")}`, `The site is missing security headers: ${missing.join(", ")}`, { missing });

  const dnsIssues = await dnsProblems();
  if (dnsIssues.length) add(`dns:${dnsIssues.join(",")}`, `Domain problem: ${dnsIssues.join("; ")}`, { issues: dnsIssues });

  const signups = await hourlyRate("profiles", now);
  if (signups && isSpike(signups, 25)) add("signup-spike", `Sign-ups jumped to ${signups.lastHour} in an hour (normal is about ${Math.round(signups.avgHour)}). Could be spam bots.`, signups);

  const errors = await hourlyRate("error_events", now);
  if (errors && isSpike(errors, 60)) add("error-spike", `Errors jumped to ${errors.lastHour} in an hour (normal is about ${Math.round(errors.avgHour)}). Could be an attack or a broken release.`, errors);
  return out;
}

export const watchSecurity: AgentDef = {
  id: "watch-security",
  name: "Website security",
  team: "watchdog",
  role: "worker",
  tier: "sonnet",
  schedule: { kind: "every", minutes: 60 },
  dailyUsd: 0.5,
  needs: [],
  freeInEconomy: true,
  maxPending: 4,
  purpose: "Every hour, checks for spam-bot sign-ups, error storms, the certificate, DNS and security headers.",
  approvalKind: "ask",
  async run(ctx) {
    const raws = await securityFindings(ctx.now());
    const r = await reportFindings(ctx, raws, {
      approvalKind: "ask",
      tail: "If it looks like an attack, turn on Attack Mode in Vercel (Project, Firewall). Tap Approve once you've looked.",
    });
    await closeMissing(ctx, "security", new Set(raws.map((x) => x.fingerprint)));
    ctx.stat("security_checks", 5);
    return { summary: raws.length ? `${raws.length} security problems; ${r.fresh} new.` : "Security checks all fine." };
  },
};
