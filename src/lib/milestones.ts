import { getAdminSupabase } from "@/lib/supabase-admin";
import { SEEDED_VISITOR_PREFIX } from "@/lib/seeded-views";


// View-count achievements — the one moment the owner is unambiguously pleased
// with their card, which makes it the one moment worth asking anything of them.
// Fired from the view-tracking API. Bell only; a view count never pushes.
//
// EVERY BODY ENDS IN ONE THING TO GO AND DO, and it is always something that
// makes the NEXT milestone more likely: a place to put the card that keeps
// working unattended, or a number in the dashboard that shows what is working
// already. A celebration with no next step is a vanity metric with an
// exclamation mark, and the owner's rule is explicit that we do not ship those.
//
// TWO THINGS THE COPY MAY NOT DO:
//
//   1. Turn views into people. "Fifty people have seen your card" was here for
//      months and was never true — card_views counts VISITS, and one person
//      returning after thirty minutes counts again (lib/view-window.ts). It is
//      the exact shape of dishonesty that costs a product its credibility the
//      first time someone checks.
//   2. Sell. These render inside the iPhone app, where pricing, upgrade and
//      billing language is forbidden (App Review 3.1.1) — so no plan names, no
//      referral months, no "unlock". Every action below is a feature the person
//      already has on whatever plan they are on.
//   3. Name a screen that does not exist. Five of these bodies used to send
//      people to a traffic-SOURCE breakdown ("check your top source", "which
//      source brings the most views") — TrafficChart has never rendered one;
//      sources are computed only for the Office console. A sixth put the QR
//      code on the Links tab, where there is no QR. Rule 2 above already says
//      every action must be something the reader has; these were the same
//      failure as the Locations one it was written for, so the rule now covers
//      the screen as well as the plan. Before changing a body, open the screen
//      it names (audit 2026-09-29).
const MILESTONES: Record<number, { title: string; body: string }> = {
  5:     { title: "First 5 views!", body: "Add Swift Signature to your email footer — your card keeps working without you." },
  10:    { title: "10 views — you're getting noticed!", body: "Your QR code is on your dashboard, under Other ways to share. Print it once and it keeps earning views." },
  25:    { title: "25 views and climbing!", body: "Swift Links turns one link into everything you share — it's on the Links tab." },
  // Was "Check Locations on your dashboard…" — which breaks rule 2 directly
  // above it: Locations is a Pro tab, so on a Free account this cheerful note
  // sent people to a padlock. Every milestone has to name something the reader
  // already has, whatever they pay (2026-09-11).
  50:    { title: "50 views — on fire!", body: "Add your card to Apple Wallet — it rides on your phone, ready the second you meet someone." },
  100:   { title: "100 views!", body: "Triple digits. Your best day so far is sitting in the traffic chart." },
  250:   { title: "250 views!", body: "Reach only counts once it becomes conversations — take a look at Contacts." },
  500:   { title: "500 views!", body: "Most cards never see this. Whatever you have been doing, keep doing it." },
  1000:  { title: "1,000 views!", body: "Four digits. Unique viewers tells you how many people that really is." },
  2500:  { title: "2,500 views!", body: "Your card is a channel now. Keep a QR code on everything you print." },
  5000:  { title: "5,000 views!", body: "Still climbing. Your contacts are where all this turns into work." },
  10000: { title: "10,000 views!", body: "Ten. Thousand. Views. Take a bow, then go and meet someone new." },
};

// Milestones from largest to smallest — the reached-but-unannounced scan
// below wants the highest one first.
const MILESTONE_COUNTS = Object.keys(MILESTONES).map(Number).sort((a, b) => b - a);

// Called after each recorded view. Counts the card's combined SwiftCard +
// Swift Links views and reports the highest milestone the total has REACHED
// but never announced. Reached, not "lands exactly on": two views committing
// near-simultaneously can jump the count straight over a milestone (4 → 6), and
// an exact-match check skipped it forever.
//
// DETECTION ONLY — it no longer writes anything.
//
// It used to insert its own bell row, and that produced the double
// notification the owner reported twice. Real pair, from production
// 2026-09-09:
//
//   21:47:55  milestone_50  "50 views — on fire!"
//   21:47:56  card_viewed   "Someone viewed your Swift Links."
//
// One person, one view, two rows a second apart — because this file deduped
// only against itself while /api/card-events deduped against the visit. The
// caller now folds the milestone INTO that visit's single notification
// (visit-notify.ts), so the owner gets one row carrying both facts.
//
// The once-ever ledger moved with it, onto notifications.milestone: a column
// upgrade() sets and never clears, so a visit that crosses a milestone and then
// captures a lead cannot lose the record that the milestone was announced.
export type MilestoneNotice = {
  /** notifications.type AND the ledger value, e.g. "milestone_50". */
  type: string;
  title: string;
  /** The authored celebration line, without any card-scope suffix. */
  body: string;
  /** The number reached, so the caller can state it in its own sentence. */
  reached: number;
  /** The card slug this milestone belongs to (the "__links" suffix stripped). */
  slug: string;
};

/** The milestone this view crossed, for the caller to announce, else null. */
export async function checkViewMilestone(rawUsername: string): Promise<MilestoneNotice | null> {
  try {
    const base = rawUsername.replace(/__links$/, "");
    if (!base) return null;

    const admin = getAdminSupabase();
    // Seeded demo rows (App Review account) are not real traffic and must not
    // gamify anything. The or() keeps NULL visitor_id rows counted — a bare
    // not-like filter would silently drop them (NULL LIKE is NULL).
    const { count } = await admin
      .from("card_views")
      .select("*", { count: "exact", head: true })
      .in("username", [base, `${base}__links`])
      .or(`visitor_id.is.null,visitor_id.not.like.${SEEDED_VISITOR_PREFIX}%`);

    const reached = MILESTONE_COUNTS.find((c) => (count ?? 0) >= c);
    if (!reached) return null;
    const m = MILESTONES[reached];

    // Resolve the card owner: cards table first, legacy profile slug second.
    const { data: card } = await admin.from("cards").select("user_id").eq("username", base).maybeSingle();
    let ownerId = card?.user_id as string | undefined;
    if (!ownerId) {
      const { data: prof } = await admin.from("profiles").select("id").eq("username", base).maybeSingle();
      ownerId = prof?.id as string | undefined;
    }
    if (!ownerId) return null;

    // ── Has this milestone already been announced? ─────────────────────────
    // The ledger is notifications.milestone (supabase/milestone-one-bell.sql),
    // NOT the row's type: a visit that crosses a milestone and then captures a
    // lead has its type rewritten to new_lead, so a type-based check would
    // forget and announce the same milestone again on the next view.
    //
    // `type` is still accepted as a match so the milestones announced BEFORE
    // that column existed are not all re-announced once.
    const type = `milestone_${reached}`;
    const scoped = await admin
      .from("notifications")
      .select("id")
      .eq("card_owner", base)
      .or(`milestone.eq.${type},type.eq.${type}`)
      .limit(1);
    if (scoped.error) {
      // Column not migrated yet (or no card_owner column): fall back to the
      // pre-ledger question. Announcing twice is the failure mode here, so the
      // fallback deliberately errs toward staying quiet.
      const { data: byType } = await admin
        .from("notifications")
        .select("id")
        .eq("user_id", ownerId)
        .eq("type", type)
        .limit(1);
      if (byType?.length) return null;
    } else if (scoped.data?.length) {
      return null;
    }

    // NOTHING IS WRITTEN HERE. The check above is a read; the caller announces
    // it through notifyVisit, which folds it into the visit's one row and
    // writes the ledger atomically with it. The unique index on
    // (card_owner, milestone) is what actually closes the check-then-write
    // race — whoever loses it gets a 23505 and simply doesn't announce.
    //
    // NO PUSH, ever, on any path. A view count is a statistic — the product
    // cheering, not news to act on — and push-policy.ts deliberately has no
    // category that could carry one.
    return { type, title: m.title, body: m.body, reached, slug: base };
  } catch {
    /* achievements are best-effort — never block view tracking */
    return null;
  }
}
