import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { ERR, backToTab, field } from "@/lib/crew/admin-form";
import { describeHours, parseHoursForm, teamDoor, togglePatch } from "@/lib/crew/doors";
import { GROUP_NAME } from "@/lib/crew/agent-status";
import { ADMIN_TEAMS } from "@/lib/crew/registry";
import { defaultTeam } from "@/lib/crew/store";
import { SupabaseStore } from "@/lib/crew/store-supabase";
import type { TeamId } from "@/lib/crew/types";

// One team's door: open / lock it, set or clear its opening hours, clear the
// manager's standing focus. Each change is also written into the team chat.
export async function POST(req: NextRequest, ctx: { params: Promise<{ team: string }> }) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { team: raw } = await ctx.params;
  const form = await req.formData();
  const back = field(form, "tab") || raw;
  // Only the admin page's groups have a pause switch and hours; the marketing agents are started and stopped one by one.
  if (!(ADMIN_TEAMS as string[]).includes(raw)) return backToTab(req, "lobby", "No such group.", ERR);
  const team = raw as TeamId;
  const store = new SupabaseStore();
  const row = (await store.listTeams()).find((t) => t.team === team) ?? defaultTeam(team);
  const now = new Date();
  const action = field(form, "action");
  const name = GROUP_NAME[team];
  const say = (body: string) => store.addChat({ team, author: "system", body }).catch(() => undefined);

  if (action === "toggle") {
    const patch = togglePatch(row, now);
    await store.patchTeam(team, patch);
    const door = teamDoor({ ...row, ...patch }, now);
    const label = door.reason === "manual" ? "" : ` ${door.label.replace("Open", "Running").replace("Locked", "Paused")}.`;
    await say(door.open ? `You resumed the group.${label}` : `You paused the group.${label}`);
    return backToTab(req, back, door.open ? `${name} is running again.${label}` : `${name} is paused. Its agents finish the step they're on, then wait.${label}`, undefined, back.includes(":") ? undefined : "door");
  }
  if (action === "hours") {
    const hours = parseHoursForm((k) => field(form, k));
    if (typeof hours === "string") return backToTab(req, back, hours, ERR, "door");
    await store.patchTeam(team, { hours, override_open: null, override_until: null });
    await say(`You set working hours: ${describeHours(hours)} (New York).`);
    return backToTab(req, back, `${name} working hours saved: ${describeHours(hours)}.`, undefined, "door");
  }
  if (action === "clear_hours") {
    // Keep the door the way it is right now, just stop following hours.
    const open = teamDoor(row, now).open;
    await store.patchTeam(team, { hours: null, override_open: null, override_until: null, door_open: open });
    await say(`You turned off working hours. The group stays ${open ? "running" : "paused"} until you tap it.`);
    return backToTab(req, back, `${name} working hours turned off.`, undefined, "door");
  }
  if (action === "clear_focus") {
    await store.patchTeam(team, { focus: null, focus_until: null, focus_by: null });
    await say("You cleared the team's focus.");
    return backToTab(req, back, `${name} focus cleared.`, undefined, "door");
  }
  return backToTab(req, back, "Unknown button.");
}
