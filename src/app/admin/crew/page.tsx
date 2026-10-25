import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/admin";
import { loadDashboard } from "@/lib/crew/dashboard";
import { resolveTab, roomTeam } from "@/lib/crew/office-tabs";
import { SupabaseStore } from "@/lib/crew/store-supabase";
import CrewView from "./CrewView";

export const metadata = { title: "Agents — SwiftCard Admin" };
export const dynamic = "force-dynamic";

// ── The Agents tab (Crew): the control panel ────────────────────────────────
// What's running, what got done, what needs you, and every agent's controls.
// Plan: docs/plans/agent-system.md. The markup lives in CrewView.tsx.

export default async function CrewPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  // The admin layout is NOT a security boundary; every data page checks.
  if (!(await requireAdmin())) notFound();
  const sp = await searchParams;
  const data = await loadDashboard(new SupabaseStore(), new Date(), { room: roomTeam(resolveTab(sp.tab)) });
  return <CrewView data={data} tab={sp.tab} msg={sp.msg} tone={sp.tone} filter={sp.filter} edit={sp.edit} />;
}
