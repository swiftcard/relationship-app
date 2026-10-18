import { NextResponse } from "next/server";
import { getAdminSupabase } from "@/lib/supabase-admin";

/**
 * A 403 for an account in its 30-day deletion window, or null for a live one.
 *
 * Signing in stays open to a deleted account (that is how it is offered
 * "Reopen"), and the proxy's _deleted guard covers PAGES only. So a deleted
 * account — or anyone with its password — could still make cards, upload,
 * add contacts, connect a CRM and start a new paid subscription through the
 * API, all while being told the account was deleted (audit SEC-12). Every
 * route that creates something calls this first; reopen and delete do not.
 * A failed lookup reads as live: the route's own checks still apply.
 */
export async function deletedAccountResponse(userId: string): Promise<NextResponse | null> {
  try {
    const { data } = await getAdminSupabase()
      .from("profiles")
      .select("customization")
      .eq("id", userId)
      .maybeSingle();
    if ((data?.customization as Record<string, unknown> | null)?._deleted === true) {
      return NextResponse.json({ error: "This account has been deleted. Reopen it to make changes." }, { status: 403 });
    }
  } catch { /* unknown → live */ }
  return null;
}
