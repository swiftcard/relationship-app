import { notifyAdmin } from "@/lib/admin-notify";
import { accountKindOf } from "@/lib/admin-data/accounts";
import { reasonText } from "@/app/admin/_ui/reasons";

// ── Customers leaving, for the admin's notification center ─────────────────
// Who closed their account and why, and who an offer kept (owner, 2026-10-28).
// Called by lib/retention-alert for every outcome of the leaving flow. Plain
// text: the notification center renders it through React, never as HTML. Our
// own and QA's accounts aren't news. Never throws (notifyAdmin swallows).

/** What each offer did, in words. */
const KEPT_BY: Record<string, string> = {
  grant: "took 30 free days of Pro",
  discount: "took 50% off for 3 months",
  downgrade: "switched to Free instead of deleting",
  quiet: "turned off emails and kept the account",
  extend: "stretched their Pro trial to a full month",
};

export async function notifyLeaving(o: {
  userId: string;
  email: string | null;
  plan: string | null;
  outcome: string;
  reason?: string | null;
  comment?: string | null;
}): Promise<void> {
  if (!o.email || (await accountKindOf(o.userId, o.email)) !== "customer") return;
  const kept = o.outcome !== "deleted";
  const plan = o.plan === "enterprise" ? "Office" : o.plan === "pro" ? "Pro" : "Free";
  const what = kept ? KEPT_BY[o.outcome] ?? "stayed" : "closed their account";
  const why = o.reason ? ` Why: "${reasonText(o.reason, o.plan)}"` : "";
  const words = o.comment ? ` In their words: "${o.comment}"` : "";
  await notifyAdmin({
    kind: "leaving",
    title: kept ? "Kept by an offer" : "An account was closed",
    body: `${o.email} (${plan}) ${what}.${why}${words}`,
    href: `/admin/users/${o.userId}`,
    dedupeKey: `${kept ? "kept" : "closed"}:${o.userId}:${o.outcome}:${new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" })}`,
    meta: { outcome: o.outcome, reason: o.reason ?? null },
  });
}
