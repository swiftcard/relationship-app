import { DELETION_GRACE_DAYS } from "@/lib/deletion-grace";
import { reasonText } from "@/app/admin/_ui/reasons";
import { loadAccounts, hasLegacyProfileCard, type Account } from "./accounts";
import { totalsFor } from "./customer-stats";

// ── The Users directory: one row per account, every number counted right ────
// Shared by the Users page (api/admin/users) and its CSV export, so the two
// can never disagree. Customers, our own and QA's accounts, and closed
// accounts each come back as their own list.

export type DirectoryRow = {
  id: string;
  kind: Account["kind"];
  username: string | null;
  /** The slug whose public pages actually exist, or null (no page yet). */
  primary_username: string | null;
  name: string | null;
  email: string | null;
  /** The plan as stored (what the plan control changes). */
  plan: string;
  /** The plan right now (an expired gift month reads Free). */
  effective_plan: string;
  plan_expires_at: string | null;
  signup_source: string | null;
  referral_code: string | null;
  company: string | null;
  title: string | null;
  created_at: string;
  card_count: number;
  lead_count: number;
  locked_lead_count: number;
  view_count: number;
  link_view_count: number;
  office_role: Account["officeRole"];
  billing: Account["billing"];
};

export type ClosedRow = {
  id: string; name: string | null; email: string | null; plan: string | null;
  closed_at: string | null; reason: string | null; reason_text: string; comment: string | null; purge_at: string | null;
};

export async function buildDirectory(): Promise<{ users: DirectoryRow[]; internal: DirectoryRow[]; closed: ClosedRow[] }> {
  const accounts = await loadAccounts();
  const live = accounts.filter((a) => !a.deleted);
  const totals = await totalsFor(live);

  const row = (a: Account): DirectoryRow => {
    const t = totals.get(a.id);
    const legacy = hasLegacyProfileCard({ username: a.username, profileName: a.profileName, customization: a.customization, cardSlugs: a.cards.map((c) => c.username) });
    return {
      id: a.id,
      kind: a.kind,
      username: a.username,
      primary_username: a.cards[0]?.username ?? (legacy ? a.username : null),
      name: a.name,
      email: a.email,
      plan: a.plan,
      effective_plan: a.effectivePlan,
      plan_expires_at: a.planExpiresAt,
      signup_source: a.signupSource,
      referral_code: a.referralCode,
      company: a.company,
      title: a.title,
      created_at: a.createdAt,
      card_count: a.cards.length,
      lead_count: t?.leads ?? 0,
      locked_lead_count: t?.lockedLeads ?? 0,
      view_count: t?.views ?? 0,
      link_view_count: t?.swiftlinkViews ?? 0,
      office_role: a.officeRole,
      billing: a.billing,
    };
  };

  // Closed accounts: soft-deleted, held DELETION_GRACE_DAYS for reopening,
  // then purged with their answers. QA's throwaways are not customers.
  const closed: ClosedRow[] = accounts
    .filter((a) => a.deleted && a.kind !== "test")
    .map((a) => {
      const del = (a.customization._deletion ?? {}) as { reason?: string; comment?: string; plan?: string; at?: string };
      const plan = del.plan ?? a.plan ?? null;
      const at = del.at ?? null;
      return {
        id: a.id,
        name: a.name,
        email: a.email,
        // The plan they were on when they closed (the delete sets plan to free).
        plan,
        closed_at: at,
        reason: del.reason ?? null,
        reason_text: reasonText(del.reason, plan),
        comment: del.comment || null,
        purge_at: at ? new Date(Date.parse(at) + DELETION_GRACE_DAYS * 86_400_000).toISOString() : null,
      };
    });

  return {
    users: live.filter((a) => a.kind === "customer").map(row),
    internal: live.filter((a) => a.kind !== "customer").map(row),
    closed,
  };
}
