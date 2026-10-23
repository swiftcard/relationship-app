import { after, NextResponse, type NextRequest } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { backToTab, field } from "@/lib/crew/admin-form";
import { blockedBy, doorState } from "@/lib/crew/doors";
import { crewHardDisabled, missingEnv } from "@/lib/crew/env";
import { tabForTeam } from "@/lib/crew/office-tabs";
import { liveProviders } from "@/lib/crew/providers";
import { agentById } from "@/lib/crew/registry";
import { staffFor } from "@/lib/crew/staff";
import { SupabaseStore } from "@/lib/crew/store-supabase";
import { LEASE_MS, runAgent } from "@/lib/crew/tick";
import type { Tier } from "@/lib/crew/types";

// One member of staff: put them on the team or take them off, start a shift
// now, end a pause, change their daily $ or their model.
export const maxDuration = 300;

const TIERS: Tier[] = ["haiku", "sonnet", "opus", "fable"];

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await ctx.params;
  const def = agentById(id);
  const form = await req.formData();
  const fallbackTab = def ? tabForTeam(def.team) : "lobby";
  const tab = field(form, "tab") || fallbackTab;
  if (!def) return backToTab(req, tab, "No such agent.");
  const store = new SupabaseStore();
  const action = field(form, "action");
  const who = `${staffFor(def).first} (${staffFor(def).title})`;
  const back = (msg: string) => backToTab(req, tab, msg, undefined, `s-${id}`);

  if (action === "enable") {
    if (def.locked) return back(`${who} can't be hired: ${def.locked}`);
    const missing = missingEnv(def.needs);
    if (missing.length) return back(`${who} needs ${missing.join(", ")} first.`);
    await store.patchAgentState(id, { enabled: true, status_note: null });
    return back(`${who} is on the team.`);
  }
  if (action === "disable") {
    await store.patchAgentState(id, { enabled: false });
    return back(`${who} is off the team.`);
  }
  if (action === "resume") {
    await store.patchAgentState(id, { paused_until: null, pause_note: null });
    return back(`${who} is back from the pause.`);
  }
  if (action === "cap") {
    const v = field(form, "usd");
    const n = v === "" ? null : Number(v);
    if (n !== null && (!Number.isFinite(n) || n < 0 || n > 100)) return back("That limit doesn't look right.");
    await store.patchAgentState(id, { daily_usd_cap: n === null ? null : Math.round(n * 100) / 100 });
    return back(`${who}'s daily limit saved.`);
  }
  if (action === "model") {
    const v = field(form, "tier") as Tier | "";
    await store.patchAgentState(id, { model_override: TIERS.includes(v as Tier) ? (v as Tier) : null });
    return back(`${who}'s model saved.`);
  }
  if (action === "run") {
    const st = await store.getAgentState(id);
    if (!st.enabled) return back(`Put ${who} on the team first.`);
    const now = new Date();
    const settings = await store.getSettings();
    const door = doorState((await store.listTeams()).find((t) => t.team === def.team), { team: def.team, settings, hardDisabled: crewHardDisabled() }, now);
    const blocked = blockedBy(def, st, door, now);
    if (blocked) return back(`${who} can't start: ${blocked}.`);
    if (!(await store.claimLease(id, new Date(now.getTime() + LEASE_MS), now))) return back(`${who} is already working.`);
    // The shift runs after the page comes back, so the button never hangs.
    after(async () => {
      try {
        await runAgent({ def, store, providers: liveProviders() });
      } catch {
        await store.patchAgentState(id, { lease_until: null }).catch(() => undefined);
      }
    });
    return back(`${who} started a shift. Refresh in a minute to see what they did.`);
  }
  return back("Unknown button.");
}
