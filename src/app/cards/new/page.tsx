import type { ComponentType } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase-server";
import { getAdminSupabase } from "@/lib/supabase-admin";
import NewCardWizard, { type OrgManaged } from "./NewCardWizard";
import GuestDraftClaim from "@/components/GuestDraftClaim";
import { hasWalletConfig } from "@/lib/wallet-config";
import { getOfficeSubUserContext } from "@/lib/office-roles";
import { getOfficeBrandForUser } from "@/lib/office-brand";
import { isPaidPlan, PLAN_LIMITS } from "@/lib/plan";
import { isProTrialEligible } from "@/lib/trial-eligibility";
import { trialHistoryFor } from "@/lib/trial-ledger";
import { referralGiftPending } from "@/lib/referral-server";

// NewCardWizard gains a `guest?: boolean` prop (owned by the card-editor agent).
// Forward-declare it here so this wrapper can pass guest mode before/after that
// change lands — the real optional prop satisfies this type.
const Wizard = NewCardWizard as ComponentType<{
  isPro: boolean;
  guest?: boolean;
  isFirstCard?: boolean;
  trialEligible?: boolean;
  referralGift?: boolean;
  tourOnDone?: boolean;
  firstCardAiDesign?: boolean;
  appUrl?: string;
  walletEnabled?: boolean;
  org?: OrgManaged | null;
  linkedinEnabled?: boolean;
  draftOwner?: string | null;
}>;

// Guests may build a full card here WITHOUT an account — no login wall while
// editing. Auth is required only for protected actions (publish / save / share /
// QR / signature / analytics / leads), which the wizard gates via requireAuth.
// When a signed-in user lands here with a pending guest draft, GuestDraftClaim
// converts it into a real card and moves them into the editor.
export default async function NewCardPage({
  searchParams,
}: {
  searchParams: Promise<{ add?: string; claim?: string; plan?: string; interval?: string; seats?: string; promo?: string; postcheckout?: string; src?: string }>;
}) {
  const sp = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  // ?src= attribution is written by the PROXY (src/proxy.ts), not here: a
  // page render cannot set cookies in Next.js, so the write that used to live
  // here threw into its own catch on every request and recorded nothing
  // (2026-09-22 signup review).

  // Plan-specific entry (?plan=pro|office). PRO is a single-person upgrade of the
  // one card you already have, so a logged-in Pro buyer who already has a card
  // needs no new card — skip straight to payment. OFFICE is different: it's a
  // company/team setup and the buyer's card becomes seat 1, so an Office buyer
  // ALWAYS builds (or freshly sets up) that card first rather than being dropped
  // onto a bare "Review your order" screen — the card creation IS the first step
  // of Office onboarding. Everyone without a card falls through and builds first.
  // Fetched once (when there's a signed-in user at all) and reused below for
  // both the Pro-CTA redirect check and the first-card design-preview unlock.
  const cardCount = user
    ? ((await getAdminSupabase().from("cards").select("*", { count: "exact", head: true }).eq("user_id", user.id)).count ?? 0)
    : 0;

  if (user && sp.plan === "pro" && sp.claim !== "1") {
    if (cardCount > 0) {
      const qs = new URLSearchParams({ plan: "pro", interval: sp.interval === "annual" ? "annual" : "monthly" });
      // Carry the promo through this fast-path too. The wizard already forwards
      // it (/pricing → builder → /checkout), but a logged-in buyer with an
      // existing card skips the builder entirely via THIS redirect — and the
      // rebuilt query string was dropping their code, so the exact user most
      // likely to convert reached checkout at full price.
      if (sp.promo) qs.set("promo", sp.promo);
      redirect(`/checkout?${qs.toString()}`);
    }
  }

  // Two very different intents share this route:
  //  • `?add=1` — a SIGNED-IN user adding another card to THEIR account (linked
  //    from the dashboard). Build straight into the current account.
  //  • anything else — the marketing "Get started / Create your free card" entry.
  //    This is a NEW-account flow: even if a session happens to be in the browser
  //    (e.g. a returning user), the card must NOT silently merge into that
  //    account. The visitor builds as a guest and explicitly chooses an account
  //    (log in, or sign up with a different email) before it's saved.
  //  • plan-specific CTA (?plan=pro|office) clicked by a LOGGED-IN user — they
  //    intend to buy for THIS account, so build the (seat-1) card straight into
  //    it (authed, no guest gate), then continue to payment.
  const authedPlan = !!user && (sp.plan === "pro" || sp.plan === "office") && sp.claim !== "1";
  const authedAdd = (sp.add === "1" && !!user) || authedPlan;

  let isPro = false;
  if (user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("plan")
      .eq("id", user.id)
      .single();
    isPro = isPaidPlan(profile?.plan);
  }

  // A Free account already AT the card cap must not enter the add-a-card builder
  // at all: the dashboard hides "+ Add card" at the limit, but a stale tab or
  // bookmark still reaches this URL, and without this check they could build an
  // entire card only to have Save reject it and discard their work at /upgrade.
  // Send them there BEFORE they type anything instead.
  //   • plan CTAs (?plan=pro|office) are exempt — they're on their way to pay.
  //   • postcheckout is exempt — a just-paid buyer can land here before the
  //     Stripe webhook flips their plan, and must never be bounced away.
  if (
    user && sp.add === "1" && !authedPlan && !sp.postcheckout &&
    !isPro && cardCount >= PLAN_LIMITS.FREE_CARD_LIMIT
  ) {
    // Same as the wizard's own cap bounce: carry the reason so /upgrade can
    // explain the jump rather than opening on a bare price grid.
    redirect("/upgrade?from=card-limit");
  }

  // First-card design preview: an already-authed Free account building its
  // very first card (dashboard "Add Card" on an empty account) gets the same
  // Pro-design-then-choose-plan treatment a guest gets. A plan-specific CTA
  // (?plan=pro|office) already has a fixed target plan, so it's excluded.
  // A team member already holding their company card has no second card to make.
  if (user && cardCount >= 1 && (await getOfficeSubUserContext(user.id))) redirect("/dashboard");

  const isFirstCard = !!user && authedAdd && !authedPlan && !isPro && cardCount === 0;
  // The guided tour belongs to EVERY first card, whatever the plan. isFirstCard
  // above is the Free-plan design-preview gate and is deliberately false for a
  // paid account — which is exactly what an invited Office member is (the seat
  // grants the enterprise plan before they build), so their "Your card is
  // live!" screen sent them to a dashboard with no tour. Kept separate so the
  // design gate stays Free-only.
  const tourOnDone = !!user && authedAdd && !authedPlan && cardCount === 0;
  // Custom design → AI design opens while someone builds their FIRST card:
  // a signed-out visitor, or a signed-in account with no card yet (owner,
  // 2026-09-30). /api/design-generate applies the same rule server-side. An
  // account that already has a card — e.g. a returning Free user going through
  // Get Started — keeps the row locked.
  const firstCardAiDesign = !isPro && (!user || cardCount === 0);

  // Office SUB-USER adding a card to their account: the company half of the
  // card (nickname, company, logo, website, office phone, fax, address) is
  // already decided by their organization, so the wizard shows it as prepared
  // instead of asking for it. Only for the authed "add" path — guests and
  // account owners see the wizard unchanged.
  let org: OrgManaged | null = null;
  if (user && authedAdd) {
    const subCtx = await getOfficeSubUserContext(user.id);
    // `org` exists for EVERY sub-user, even before the admin has set any
    // branding: company-level fields are org territory regardless, and the
    // server discards them from a member's request either way — showing the
    // inputs on an unbranded office silently lost whatever the member typed.
    if (subCtx) {
      const brand = await getOfficeBrandForUser(user.id).catch(() => null);
      org = {
        company: brand?.company ?? null,
        website: brand?.website ?? null,
        logoUrl: brand?.logoUrl ?? null,
        phone: brand?.phone ?? null,
        fax: brand?.fax ?? null,
        address: brand?.address ?? null,
        // Locked only when the office has a look to lock TO. lockTemplate
        // defaults on for every brand (even one that only set links or a
        // company name), which hid the design controls behind "your
        // organization keeps every card matching" while nothing was applied.
        lockDesign: !!brand?.lockTemplate && !!(brand?.template || brand?.design),
        // ── The Swift Links half of the brand ──────────────────────────
        // Content the office set (applied and read-only for the member),
        // plus whether the office holds the page's LOOK.
        officeLinks: brand?.links ?? null,
        linkBio: brand?.linkBio ?? null,
        linkInstagram: brand?.linkInstagram ?? null,
        lockLinkDesign: brand?.lockLinkDesign ?? false,
        linkDesign: brand?.linkDesign ?? null,
        // The locked look, so the sub-user's live preview matches the office
        // template + colors/fonts while they build (not only after saving).
        template: brand?.template ?? null,
        design: brand?.design ?? null,
        customLayout: brand?.customLayout ?? null,
      };
    }
  }

  // The pending draft is claimed ONLY on `claim=1` — the post-auth return from
  // the account gate (GuestGateModal stamps it on the redirect URL), i.e. the
  // visitor just chose an account for THIS draft. GuestDraftClaim additionally
  // verifies the draft carries fresh gate consent before posting it.
  // Deliberately NOT on `add=1`: a signed-in user clicking "Add Card" expects a
  // blank wizard — a leftover guest draft from an earlier visit (possibly built
  // for a different account) must never silently merge in.
  const claimHere = !!user && sp.claim === "1";

  // The first-card plan gate offers the Pro trial by name — only to an account
  // that can still get it (one free Pro period per person: the 14-day trial or
  // a friend's referral month). Guests have no history: eligible.

  // Signed up through a friend's link FIRST, then built the card: the builder's
  // own plan gate is their plan step, so it offers the free month too.
  // The referral check and the trial check are independent — run together.
  const [referralGift, trialEligible] = await Promise.all([
    user && isFirstCard ? referralGiftPending(user.id, user.email).catch(() => false) : Promise.resolve(false),
    (async (): Promise<boolean> => {
      if (!(user && isFirstCard)) return true;
      try {
        const [{ data: billing }, history] = await Promise.all([
          getAdminSupabase().from("profiles").select("stripe_customer_id").eq("id", user.id).maybeSingle(),
          trialHistoryFor(user.id, user.email),
        ]);
        return await isProTrialEligible((billing?.stripe_customer_id as string | null) ?? null, undefined, history);
      } catch { return true; /* fail open, like /checkout */ }
    })(),
  ]);

  return (
    <>
      {claimHere && <GuestDraftClaim />}
      <Wizard
        isPro={isPro}
        guest={!authedAdd}
        isFirstCard={isFirstCard}
        trialEligible={trialEligible}
        referralGift={referralGift}
        tourOnDone={tourOnDone}
        firstCardAiDesign={firstCardAiDesign}
        appUrl={process.env.NEXT_PUBLIC_APP_URL || "https://swiftcard.me"}
        walletEnabled={hasWalletConfig()}
        org={org}
        linkedinEnabled={!!(process.env.LINKEDIN_CLIENT_ID && process.env.LINKEDIN_CLIENT_SECRET)}
        draftOwner={authedAdd && user ? user.id : null}
      />
    </>
  );
}
