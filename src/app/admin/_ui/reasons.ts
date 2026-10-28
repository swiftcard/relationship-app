import { isPaidPlan } from "@/lib/plan";
import { reasonById, RETENTION_DISCOUNT_MONTHS, RETENTION_DISCOUNT_PERCENT, RETENTION_GRANT_DAYS } from "@/lib/retention";

// ── Why someone left, in the words they picked ─────────────────────────────
// The delete and cancel flows store the reason's id ("not-using"), and the old
// Retention page printed that id as-is. The owner reads "I'm not really using
// it" instead — the same label the person tapped (lib/retention). The same id
// can carry a different label on Free and on Pro, so the plan they were on
// picks the list; anything that isn't a known id (free text from an older
// flow) is shown as written.

export function reasonText(reason: string | null | undefined, plan?: string | null): string {
  const r = (reason ?? "").trim();
  if (!r) return "No reason given";
  const first = isPaidPlan(plan) ? "pro" : "free";
  const known = reasonById(first, r) ?? reasonById(first === "pro" ? "free" : "pro", r);
  if (known) return known.label;
  if (/\s/.test(r)) return r;
  const words = r.replace(/[-_]+/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** What the person took instead of leaving (customization._retention.savedBy). */
export const SAVED_BY: Record<string, string> = {
  grant: `Took ${RETENTION_GRANT_DAYS} free days of Pro`,
  discount: `Took ${RETENTION_DISCOUNT_PERCENT}% off for ${RETENTION_DISCOUNT_MONTHS} months`,
  downgrade: "Switched to Free instead",
  quiet: "Turned emails off, kept the account",
  extend: "Stretched their trial to a full month",
};

export function savedByText(savedBy: string | null | undefined): string | null {
  if (!savedBy) return null;
  return SAVED_BY[savedBy] ?? savedBy;
}
