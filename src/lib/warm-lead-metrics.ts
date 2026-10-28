import type { getAdminSupabase } from "@/lib/supabase-admin";
import { paged } from "@/lib/crew/paged";

type Admin = ReturnType<typeof getAdminSupabase>;

// The numbers that say whether returning-contact alerts work (warm-lead plan
// §2.9), for /admin/analytics. Company-wide, last 30 days.
//
//   named        alerts that named a returning contact
//   opened       …that the owner then opened (notifications.opened_at)
//   followedUp   …where the owner messaged that contact within 24h
//   wrong        "Wrong person?" marks — THE trust number, target < 2% of named
//   bindings     how contacts are being recognised: form / link / account
//
// `available: false` until supabase/warm-lead-alerts.sql has been applied.
export type WarmLeadMetrics =
  | { available: false }
  | {
      available: true;
      named: number;
      opened: number;
      followedUp: number;
      wrong: number;
      wrongRate: number;
      pushes: number;
      bindings: [string, number][];
    };

export async function warmLeadMetrics(admin: Admin, now = Date.now()): Promise<WarmLeadMetrics> {
  const since = new Date(now - 30 * 86_400_000).toISOString();
  try {
    // Paged: one select stops at 1,000 rows whatever .limit() asks for, so
    // the scorecard quietly read only the newest 1,000 alerts.
    let alerts: { lead_id: string; created_at: string; opened_at: string | null }[];
    try {
      alerts = await paged(
        (from, to) => admin.from("notifications").select("lead_id, created_at, opened_at")
          .in("type", ["contact_returned", "contact_engaged"]).not("lead_id", "is", null)
          .gte("created_at", since).order("created_at").order("id").range(from, to),
        500_000, "warm-lead alerts");
    } catch {
      return { available: false };
    }

    const leadIds = [...new Set((alerts ?? []).map((a) => a.lead_id as string))];
    const outbound = new Map<string, number[]>();
    for (let i = 0; i < leadIds.length; i += 100) {
      const { data: msgs } = await admin
        .from("lead_messages")
        .select("lead_id, created_at")
        .in("lead_id", leadIds.slice(i, i + 100))
        .eq("direction", "out")
        .gte("created_at", since);
      for (const m of msgs ?? []) {
        const list = outbound.get(m.lead_id as string) ?? [];
        list.push(Date.parse(m.created_at as string));
        outbound.set(m.lead_id as string, list);
      }
    }
    const followedUp = (alerts ?? []).filter((a) => {
      const at = Date.parse(a.created_at as string);
      return (outbound.get(a.lead_id as string) ?? []).some((t) => t >= at && t <= at + 86_400_000);
    }).length;

    const [{ count: wrong }, devices, { count: pushes }] = await Promise.all([
      admin.from("contact_devices").select("id", { count: "exact", head: true }).gte("wrong_at", since),
      paged<{ bound_via: string }>(
        (from, to) => admin.from("contact_devices").select("bound_via").is("superseded_at", null).is("wrong_at", null).order("id").range(from, to),
        1_000_000, "warm-lead devices").catch(() => [] as { bound_via: string }[]),
      admin.from("push_log").select("id", { count: "exact", head: true })
        .eq("category", "contact_return").eq("outcome", "sent").gte("created_at", since),
    ]);
    const byVia: Record<string, number> = {};
    for (const d of devices ?? []) byVia[d.bound_via as string] = (byVia[d.bound_via as string] ?? 0) + 1;

    const named = alerts?.length ?? 0;
    return {
      available: true,
      named,
      opened: (alerts ?? []).filter((a) => a.opened_at).length,
      followedUp,
      wrong: wrong ?? 0,
      wrongRate: named ? Math.round(((wrong ?? 0) / named) * 1000) / 10 : 0,
      pushes: pushes ?? 0,
      bindings: Object.entries(byVia).sort((a, b) => b[1] - a[1]),
    };
  } catch {
    return { available: false };
  }
}
