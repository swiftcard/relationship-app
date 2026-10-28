import { NextResponse } from "next/server";
import { getAdminSupabase } from "@/lib/supabase-admin";
import { getAccountEmailMap } from "@/lib/account-email";
import { requireAdmin } from "@/lib/admin";
import { DELETION_GRACE_DAYS } from "@/lib/deletion-grace";
import { QA_EMAIL_DOMAIN } from "@/lib/qa-account-sweep";
import { reasonText } from "@/app/admin/_ui/reasons";

// Full user directory for the admin Users page: identity, plan (+expiry),
// signup source, cards owned (count), leads, views — plus `closed`: accounts
// closed in the last 30 days (still held for reopening), with why, in the
// person's own words (the Users › Closed accounts tab).
export async function GET() {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const admin = getAdminSupabase();

  const { data: profiles } = await admin
    .from("profiles")
    .select("id, username, name, email, plan, created_at, company, title, customization, signup_source, plan_expires_at, referral_code")
    .order("created_at", { ascending: false });

  if (!profiles) return NextResponse.json({ users: [] });

  const [{ data: cardRows }, { data: leadRows }, { data: viewRows }] = await Promise.all([
    admin.from("cards").select("user_id, username"),
    admin.from("leads").select("card_owner"),
    admin.from("card_views").select("username"),
  ]);

  // Cards per account (+ their usernames, so leads/views can roll up per user).
  const cardsByUser: Record<string, string[]> = {};
  for (const c of cardRows ?? []) {
    (cardsByUser[c.user_id as string] ??= []).push(c.username as string);
  }

  const leadsByUsername: Record<string, number> = {};
  for (const l of leadRows ?? []) {
    const o = (l.card_owner as string) || "";
    if (o) leadsByUsername[o] = (leadsByUsername[o] ?? 0) + 1;
  }

  // card_views usernames: "<username>" for cards, "<username>__links" for Swift Links.
  const viewsByUsername: Record<string, number> = {};
  for (const v of viewRows ?? []) {
    const u = ((v.username as string) || "").replace(/__links$/, "");
    if (u) viewsByUsername[u] = (viewsByUsername[u] ?? 0) + 1;
  }

  // Accounts are identified by their AUTH signup email; profiles.email is only
  // the fallback for anyone the auth listing missed.
  const authEmails = await getAccountEmailMap();

  const users = profiles
    .filter((p) => !((p.customization as { _deleted?: boolean } | null)?._deleted))
    .map((p) => {
      // A user's usernames = their profile slug + all their cards' slugs.
      const usernames = new Set<string>([p.username as string, ...(cardsByUser[p.id as string] ?? [])].filter(Boolean));
      let lead_count = 0, view_count = 0;
      for (const u of usernames) {
        lead_count += leadsByUsername[u] ?? 0;
        view_count += viewsByUsername[u] ?? 0;
      }
      // The slug whose public pages actually EXIST: prefer a real card, fall
      // back to the profile slug ONLY for legacy (never-migrated) accounts —
      // migrated profiles' slugs no longer resolve publicly. Null → no page yet.
      const migrated = !!((p.customization as { _migrated?: boolean } | null)?._migrated);
      const primary_username = (cardsByUser[p.id as string] ?? [])[0] ?? (!migrated ? ((p.username as string | null) ?? null) : null);
      return {
        id: p.id,
        username: p.username,
        primary_username,
        name: p.name,
        // The ACCOUNT's email is the auth signup address — profiles.email
        // drifts to the card's public contact email (see lib/account-email).
        email: authEmails.get(p.id as string) ?? p.email,
        plan: p.plan,
        plan_expires_at: p.plan_expires_at ?? null,
        signup_source: p.signup_source ?? null,
        referral_code: p.referral_code ?? null,
        company: p.company,
        title: p.title,
        created_at: p.created_at,
        card_count: (cardsByUser[p.id as string] ?? []).length,
        lead_count,
        view_count,
      };
    });

  // Closed accounts: soft-deleted, held DELETION_GRACE_DAYS for reopening, then
  // purged with their answers (keeping the reason past that is the data pass).
  // QA's throwaway accounts (QA_EMAIL_DOMAIN) are not customers and are left out.
  const closed = profiles
    .filter((p) => (p.customization as { _deleted?: boolean } | null)?._deleted)
    .map((p) => {
      const del = ((p.customization as Record<string, unknown>)._deletion ?? {}) as { reason?: string; comment?: string; plan?: string; at?: string };
      const plan = del.plan ?? (p.plan as string | null) ?? null;
      const at = del.at ?? null;
      return {
        id: p.id as string,
        name: (p.name as string | null) ?? null,
        email: authEmails.get(p.id as string) ?? (p.email as string | null) ?? null,
        // The plan they were on when they closed (the delete sets plan to free).
        plan,
        closed_at: at,
        reason: del.reason ?? null,
        reason_text: reasonText(del.reason, plan),
        comment: del.comment || null,
        purge_at: at ? new Date(Date.parse(at) + DELETION_GRACE_DAYS * 86_400_000).toISOString() : null,
      };
    })
    .filter((c) => !(c.email ?? "").toLowerCase().endsWith(QA_EMAIL_DOMAIN));

  return NextResponse.json({ users, closed });
}
