import type { AgentDef } from "../agent-def";
import type { AgentContext } from "../context";
import type { Finding } from "../types";
import { closeMissing, reportFindings } from "../watch/findings";
import { healthFindings, latestIngest, nightlyFindings, type HealthJson, type NightlySummary } from "../watch/ingested";

// ── Watchdog agents that read the monitors already running in GitHub ───────
// No new browser runs: nightly-qa.yml already signs up throwaway accounts,
// clicks through every flow and screen at both widths, and deletes the
// accounts; uptime.yml checks speed every 15 minutes. These agents read those
// results, keep one finding per distinct problem, and explain only new ones.

async function fromNightly(ctx: AgentContext, sections: RegExp[], kind: Finding["kind"], source: string) {
  const ing = await latestIngest<NightlySummary>(ctx.store, "nightly");
  if (!ing) return { summary: "No nightly results yet (the nightly QA run posts them here).", status: "skipped" as const };
  if (ctx.config<string | null>("last_at", null) === ing.at) {
    ctx.stat("no_llm_needed");
    return { summary: "No new nightly results since last look." };
  }
  const raws = nightlyFindings(ing.data, sections, kind, source);
  const r = await reportFindings(ctx, raws);
  await closeMissing(ctx, source, new Set(raws.map((x) => x.fingerprint)));
  await ctx.saveConfig({ last_at: ing.at });
  ctx.stat("problems_in_run", raws.length);
  return { summary: raws.length ? `${raws.length} problems in the last nightly run; ${r.fresh} new, ${r.proposed} fix cards.` : "The last nightly run was clean." };
}

const base = { team: "watchdog" as const, role: "worker" as const, tier: "sonnet" as const, needs: ["CREW_ANTHROPIC_API_KEY" as const], maxPending: 5, approvalKind: "code_fix" as const };

export const watchUi: AgentDef = {
  ...base,
  id: "watch-ui",
  name: "UI watcher",
  schedule: { kind: "every", minutes: 120 },
  dailyUsd: 0.5,
  purpose: "Reads the nightly check of every screen at phone and desktop size and says exactly which button or layout broke.",
  run: (ctx) => fromNightly(ctx, [/^Every screen/i], "ui", "nightly-sweep"),
};

export const watchFlows: AgentDef = {
  ...base,
  id: "watch-flows",
  name: "Daily tester: flows",
  schedule: { kind: "every", minutes: 120 },
  dailyUsd: 0.5,
  purpose: "First of the tester pair: reads the nightly run that signs up a test account, clicks through every flow and deletes it.",
  run: (ctx) => fromNightly(ctx, [/^Flows/i, /^Cards open with no signal/i], "flow", "nightly-flows"),
};

export const watchProbe: AgentDef = {
  ...base,
  id: "watch-probe",
  name: "Daily tester: analytics and alerts",
  schedule: { kind: "every", minutes: 120 },
  dailyUsd: 0.5,
  purpose: "Second of the tester pair: checks that views, notifications and link previews really work end to end.",
  run: (ctx) => fromNightly(ctx, [/^Analytics \+ notifications/i, /^Notifications for every plan/i, /^Link previews/i], "flow", "nightly-probe"),
};

export const watchApp: AgentDef = {
  ...base,
  id: "watch-app",
  name: "App watcher",
  schedule: { kind: "every", minutes: 120 },
  dailyUsd: 0.5,
  purpose: "Reads the nightly check of the iPhone and Android apps and reports app bugs in plain words.",
  run: (ctx) => fromNightly(ctx, [/iPhone shell/i, /^Android app/i, /^Office Swift Links/i], "app", "nightly-app"),
};

export const watchSpeed: AgentDef = {
  ...base,
  id: "watch-speed",
  name: "Speed and uptime",
  schedule: { kind: "every", minutes: 15 },
  dailyUsd: 0.5,
  purpose: "Every 15 minutes, reads the site's speed and uptime check. Only speaks up when something is slow or down.",
  async run(ctx) {
    const ing = await latestIngest<HealthJson>(ctx.store, "health");
    if (!ing) return { summary: "No health results yet (the 15-minute uptime check posts them here).", status: "skipped" };
    if (ctx.config<string | null>("last_at", null) === ing.at) {
      ctx.stat("no_llm_needed");
      return { summary: "No new check since last look." };
    }
    const raws = healthFindings(ing.data);
    const r = await reportFindings(ctx, raws);
    await closeMissing(ctx, "health", new Set(raws.map((x) => x.fingerprint)));
    await ctx.saveConfig({ last_at: ing.at });
    ctx.stat("checks_failing", raws.length);
    return { summary: raws.length ? `${raws.length} checks failing; ${r.fresh} new.` : `All ${ing.data.results?.length ?? 0} checks passing.` };
  },
};
