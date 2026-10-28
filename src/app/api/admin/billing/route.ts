import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { loadAccounts } from "@/lib/admin-data/accounts";
import { stripeConnection } from "@/lib/admin-data/billing";

// GET /api/admin/billing — "is Stripe properly connected?", answered by Stripe
// itself: the key's mode, the webhook endpoint and its events, every price the
// site charges, when the last webhook arrived, and whether every subscription
// matches its account (Company Analytics › Revenue). Read-only.
export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const accounts = await loadAccounts();
  return NextResponse.json(await stripeConnection(accounts));
}
