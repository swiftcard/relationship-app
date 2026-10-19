import type { NextRequest } from "next/server";
import { appUrl } from "@/lib/app-url";
import { isShellRequest } from "@/lib/shell-request";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { getStripe } from "@/lib/stripe";
import { officeSubUserBlockMessage } from "@/lib/office-roles";
import { getAccountEmail } from "@/lib/account-email";

// This deployment's own address — never production from a preview (lib/app-url, audit E-02).
const APP_URL = appUrl();

// Opens the Stripe customer portal on the account's DEFAULT configuration —
// i.e. whatever is set at Settings → Billing → Customer portal in the Stripe
// Dashboard. Deliberately no `configuration` override.
//
// This used to pass a custom API-built configuration that scoped the portal to
// payment method + invoices. Two problems with that:
//   • it suppressed Stripe's own cancellation-reason survey (on by default), and
//   • retention coupons CANNOT be set on an API-built configuration at all —
//     Stripe only supports them on the Dashboard-managed default config.
// So the questions and the save-offer both live in the Dashboard now, where
// they can be tuned without a deploy. Nothing here needs to change to add,
// remove or re-price a retention coupon.
export async function POST(req: NextRequest) {
  // Apple-billed subs are managed in the App Store sheet; the Stripe portal
  // is never opened from the shell (3.1.1).
  if (isShellRequest(req)) return NextResponse.json({ error: "Not available in the app" }, { status: 403 });
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Office sub-users have no personal subscription to manage — billing is
  // the organization's. A delegated billing_admin passes through.
  const subBlocked = await officeSubUserBlockMessage(user.id, {
    unless: "manage_billing",
    allowIfOwnSubscription: true,
    message: "Billing for your account is managed by your organization.",
  });
  if (subBlocked) return NextResponse.json({ error: subBlocked }, { status: 403 });

  const { data: profile } = await supabase
    .from("profiles")
    .select("stripe_customer_id, email")
    .eq("id", user.id)
    .single();

  if (!profile?.stripe_customer_id) {
    return NextResponse.json({ error: "No billing account found for this user." }, { status: 400 });
  }

  try {
    const stripe = getStripe();
    // Heal the customer's email to the account's AUTH signup email before
    // opening the portal. The Stripe customer email is only set at creation and
    // was never re-synced, so a customer created while profiles.email held one
    // of the owner's CARD contact emails showed the wrong address on Stripe's
    // portal + invoice PDFs forever ("recognized by the wrong email"). This
    // reconciles it every time billing is opened. Best-effort — never block the
    // portal on it.
    const authEmail = await getAccountEmail(user.id, profile.email as string | null);
    if (authEmail) {
      try { await stripe.customers.update(profile.stripe_customer_id, { email: authEmail }); }
      catch { /* portal still opens even if the email sync hiccups */ }
    }
    const session = await stripe.billingPortal.sessions.create({
      customer: profile.stripe_customer_id,
      return_url: `${APP_URL}/settings/flows`,
    });
    return NextResponse.json({ url: session.url });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
