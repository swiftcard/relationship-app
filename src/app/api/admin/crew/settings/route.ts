import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { ERR, backToTab, field } from "@/lib/crew/admin-form";
import { SupabaseStore } from "@/lib/crew/store-supabase";
import { AGENTS, TEAMS } from "@/lib/crew/registry";
import type { Settings } from "@/lib/crew/types";

// Lock / unlock the whole office, and Settings: every $ limit (office, team,
// person) in one form, economy mode, the second opinion, the disclosure line.
export async function POST(req: NextRequest) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const form = await req.formData();
  const store = new SupabaseStore();
  const action = field(form, "action");
  if (action === "kill") {
    await store.updateSettings({ kill_all: true });
    return backToTab(req, field(form, "tab") || "lobby", "All agents are paused. Anything mid-task finishes the step it's on. Nothing new starts until you tap Resume all.");
  }
  if (action === "unkill") {
    await store.updateSettings({ kill_all: false });
    return backToTab(req, field(form, "tab") || "lobby", "All agents are back on their schedules (except groups or agents you paused yourself).");
  }
  const patch: Partial<Settings> = {};
  const skipped: string[] = [];
  const cap = Number(field(form, "daily_usd_cap"));
  if (field(form, "daily_usd_cap") !== "" && Number.isFinite(cap) && cap >= 0 && cap <= 500) patch.daily_usd_cap = Math.round(cap * 100) / 100;
  else if (field(form, "daily_usd_cap") !== "") skipped.push("the daily limit (use $0 to $500)");
  patch.disclosure_on = field(form, "disclosure_on") === "on";
  patch.economy = field(form, "economy") === "on";
  patch.second_opinion = field(form, "second_opinion") === "on";
  const disclosure = field(form, "disclosure");
  if (disclosure) patch.disclosure = disclosure.slice(0, 200);
  const caps: Settings["team_caps"] = {};
  for (const t of TEAMS) {
    const v = field(form, `team_cap_${t}`);
    if (v !== "" && Number.isFinite(Number(v)) && Number(v) >= 0) caps[t] = { usd: Math.round(Number(v) * 100) / 100 };
    else if (v !== "") skipped.push(`a group limit`);
  }
  patch.team_caps = caps;
  await store.updateSettings(patch);

  // Each person's limit; only the ones that changed are written.
  const states = new Map((await store.listAgentStates()).map((s) => [s.id, s]));
  for (const def of AGENTS) {
    const key = `agent_cap_${def.id}`;
    if (!form.has(key)) continue;
    const v = field(form, key);
    const n = v === "" ? null : Number(v);
    if (n !== null && (!Number.isFinite(n) || n < 0 || n > 100)) {
      skipped.push("an agent limit (use $0 to $100)");
      continue;
    }
    const next = n === null ? null : Math.round(n * 100) / 100;
    if ((states.get(def.id)?.daily_usd_cap ?? null) !== next) await store.patchAgentState(def.id, { daily_usd_cap: next });
  }
  if (skipped.length) return backToTab(req, "settings", `Saved, except ${[...new Set(skipped)].join(", ")}: that number didn't look right.`, ERR);
  return backToTab(req, "settings", "Settings saved.");
}
