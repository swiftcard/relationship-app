import { getAdminSupabase } from "./supabase-admin";
import { insertNotification } from "./notify";
import { revalidateCardPage } from "./card-page-data";
import { PRO_ENDED_PENDING_KEY, TRIAL_ENDS_KEY, proEndedNotice } from "./billing-state";
import { mergeCustomization } from "@/lib/customization-merge";

/**
 * Pro just ended on this account and it is on Free now — for a reason OTHER
 * than a Stripe cancellation (which does the same three things inline, inside
 * its own guarded writes in api/stripe/webhook): an Apple subscription
 * expiring, or a free-month / retention grant running out.
 *
 *   1. flag the choice as open, so the dashboard shows ProEndedPanel
 *      (subscribe, or continue on Free and pick the card that stays live);
 *   2. tell them, in-app — never silently;
 *   3. revalidate their public card pages so extra cards go offline now.
 *
 * `notify: false` for callers that already send their own wording (the grant
 * expiry cron has its own title + email). Best-effort; never throws.
 */
export async function markProEnded(userId: string, opts: { wasTrial: boolean; notify?: boolean }): Promise<void> {
  const admin = getAdminSupabase();
  try {
    const { data } = await admin.from("profiles").select("plan, customization").eq("id", userId).maybeSingle();
    if (!data || data.plan !== "free") return; // re-upgraded in the meantime — nothing ended
    // Only these keys, and only while still on Free (lib/customization-merge,
    // audit B-03).
    await mergeCustomization(userId, { set: { [PRO_ENDED_PENDING_KEY]: true }, remove: [TRIAL_ENDS_KEY] }, { requirePlan: "free" });
  } catch { /* the downgrade itself already happened; the prompt is extra */ }

  if (opts.notify !== false) {
    await insertNotification({ user_id: userId, type: "pro_ended", ...proEndedNotice(opts.wasTrial) }).catch(() => {});
  }

  try {
    const { data: cards } = await admin.from("cards").select("username").eq("user_id", userId);
    for (const c of cards ?? []) revalidateCardPage(c.username as string);
  } catch { /* the page cache TTL still catches it */ }
}
