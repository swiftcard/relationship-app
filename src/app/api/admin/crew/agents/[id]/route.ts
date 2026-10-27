import { after, NextResponse, type NextRequest } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { ERR, backToTab, field } from "@/lib/crew/admin-form";
import { agentName, plainNeeds } from "@/lib/crew/agent-status";
import { PAUSE_FOREVER, blockedBy, doorState } from "@/lib/crew/doors";
import { crewHardDisabled, missingEnv } from "@/lib/crew/env";
import { tabForTeam } from "@/lib/crew/office-tabs";
import { liveProviders } from "@/lib/crew/providers";
import { agentById } from "@/lib/crew/registry";
import { SCHEDULE_OVERRIDES_KEY, canReschedule, effectiveSchedule, nextRun, parseScheduleForm, plainSchedule } from "@/lib/crew/schedule";
import { SupabaseStore } from "@/lib/crew/store-supabase";
import { LEASE_MS, runAgent, scheduleOverrides } from "@/lib/crew/tick";
import type { Tier } from "@/lib/crew/types";

// One agent: turn it on or off, run it now, pause / resume / stop it, change
// its schedule, its daily $ or its model. Pause and Stop take effect at the
// agent's next step (blockedBy is checked before every model call); a step
// already under way finishes.
export const maxDuration = 300;

const TIERS: Tier[] = ["haiku", "sonnet", "opus", "fable"];
const STOP_NOTE = "Stopped by you.";
const PAUSE_NOTE = "Paused by you.";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await ctx.params;
  const def = agentById(id);
  const form = await req.formData();
  const fallbackTab = def ? tabForTeam(def.team) : "lobby";
  const tab = field(form, "tab") || fallbackTab;
  if (!def) return backToTab(req, tab, "No such agent.", ERR);
  const store = new SupabaseStore();
  const action = field(form, "action");
  const who = agentName(def);
  const back = (msg: string, bad = false) => backToTab(req, tab, msg, bad ? ERR : undefined, tab.startsWith("agent:") || tab.startsWith("tasks") ? undefined : `s-${id}`);

  if (action === "enable") {
    if (def.locked) return back(`${who} can't be turned on: ${def.locked}`, true);
    const missing = missingEnv(def.needs);
    if (missing.length) return back(`${who} needs ${plainNeeds(missing)} first.`, true);
    await store.patchAgentState(id, { enabled: true, status_note: null, paused_until: null, pause_note: null });
    return back(`${who} is on.`);
  }
  if (action === "disable") {
    await store.patchAgentState(id, { enabled: false });
    return back(`${who} is off.`);
  }
  if (action === "pause") {
    await store.patchAgentState(id, { paused_until: PAUSE_FOREVER, pause_note: PAUSE_NOTE });
    return back(`${who} is paused. If it's working right now, it finishes the step it's on, then waits.`);
  }
  if (action === "stop") {
    // Off, and paused too: a run under way stops at its next step (the pause
    // is what a run re-checks), and nothing starts it again until you turn it on.
    await store.patchAgentState(id, { enabled: false, paused_until: PAUSE_FOREVER, pause_note: STOP_NOTE });
    return back(`${who} is stopped and turned off. If it was working, it finishes the step it's on, then stops.`);
  }
  if (action === "resume") {
    await store.patchAgentState(id, { paused_until: null, pause_note: null });
    return back(`${who} is back on its schedule.`);
  }
  if (action === "schedule" || action === "reset_schedule") {
    if (!canReschedule(def)) return back(`${who}'s schedule can't be changed.`, true);
    const overrides = { ...(await scheduleOverrides(store)) };
    if (action === "reset_schedule") delete overrides[id];
    else {
      const s = parseScheduleForm((k) => field(form, k));
      if (typeof s === "string") return back(s, true);
      overrides[id] = s;
    }
    await store.kvSet(SCHEDULE_OVERRIDES_KEY, overrides);
    const rule = effectiveSchedule(def, overrides);
    await store.patchAgentState(id, { next_run_at: nextRun(rule, new Date()).toISOString() });
    return back(`${who} now runs: ${plainSchedule(rule).toLowerCase()}.`);
  }
  if (action === "cap") {
    const v = field(form, "usd");
    const n = v === "" ? null : Number(v);
    if (n !== null && (!Number.isFinite(n) || n < 0 || n > 100)) return back("That limit doesn't look right.", true);
    await store.patchAgentState(id, { daily_usd_cap: n === null ? null : Math.round(n * 100) / 100 });
    return back(`${who}'s daily limit saved.`);
  }
  if (action === "model") {
    const v = field(form, "tier") as Tier | "";
    await store.patchAgentState(id, { model_override: TIERS.includes(v as Tier) ? (v as Tier) : null });
    return back(`${who}'s setting saved.`);
  }
  if (action === "run") {
    const st = await store.getAgentState(id);
    if (!st.enabled) return back(`Turn ${who} on first.`, true);
    const now = new Date();
    const settings = await store.getSettings();
    const door = doorState((await store.listTeams()).find((t) => t.team === def.team), { team: def.team, settings, hardDisabled: crewHardDisabled() }, now);
    const blocked = blockedBy(def, st, door, now);
    if (blocked) return back(`${who} can't run right now: it's ${blocked.replace("door locked", "in a paused group").replace("the whole office is locked", "paused with all agents")}.`, true);
    if (!(await store.claimLease(id, new Date(now.getTime() + LEASE_MS), now))) return back(`${who} is already running.`);
    const schedule = effectiveSchedule(def, await scheduleOverrides(store));
    // The run happens after the page comes back, so the button never hangs.
    after(async () => {
      try {
        await runAgent({ def, store, providers: liveProviders(), schedule });
      } catch {
        await store.patchAgentState(id, { lease_until: null }).catch(() => undefined);
      }
    });
    return back(`${who} started. This page updates by itself while it runs.`);
  }
  if (action === "start") {
    // Start (the Sheet agents' button): on, unpaused, and working right now.
    // While it is on it keeps going every 15 minutes until today's ceiling,
    // then picks up again tomorrow, until Stop.
    if (def.locked) return back(`${who} can't be started: ${def.locked}`, true);
    const missing = missingEnv(def.needs);
    if (missing.length) return back(`${who} needs ${plainNeeds(missing)} first.`, true);
    const now = new Date();
    await store.patchAgentState(id, { enabled: true, status_note: null, paused_until: null, pause_note: null, next_run_at: now.toISOString() });
    const settings = await store.getSettings();
    if (settings.kill_all || crewHardDisabled()) return back(`${who} is on, but all agents are paused. Tap Resume all agents to let it work.`, true);
    if (await store.claimLease(id, new Date(now.getTime() + LEASE_MS), now)) {
      const schedule = effectiveSchedule(def, await scheduleOverrides(store));
      after(async () => {
        try {
          await runAgent({ def, store, providers: liveProviders(), schedule });
        } catch {
          await store.patchAgentState(id, { lease_until: null }).catch(() => undefined);
        }
      });
    }
    return back(`${who} started. It keeps adding rows to its tab in the Sheet until you press Stop.`);
  }
  return back("Unknown button.", true);
}
