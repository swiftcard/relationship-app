import { NextRequest, NextResponse } from "next/server";
import { getAdminSupabase } from "@/lib/supabase-admin";

// One-click unsubscribe (RFC 8058) for ACCOUNT-HOLDER marketing mail.
//
// This must stay a route handler. A page route cannot serve one-click: in Next 16
// a urlencoded POST is classified as a possible Server Action, skips the 405
// branch, and is answered by the static prerender without running any code — so
// the provider sees 200 and the opt-out silently never happens. See unsubUrl()
// in src/lib/email-templates.ts.
//
// Both verbs .select() the affected rows: a PostgREST UPDATE matching ZERO rows
// is NOT an error, so branching on `error` alone reported success for every
// bogus, rotated or purged token — to the human AND to the mail provider, which
// then records the unsubscribe as honored while the mail keeps coming.
async function suppress(token: string): Promise<boolean> {
  const { data, error } = await getAdminSupabase()
    .from("email_preferences")
    .update({ marketing_emails: false })
    .eq("unsubscribe_token", token)
    .select("user_id");

  return !error && !!data?.length;
}

// A GET only ASKS (audit SEC-20). Mail security scanners open every link in a
// message before the person sees it, and a GET that unsubscribed them did so
// without their consent. The link in the email lands on a page with one
// button; the button POSTs here. The one-click header (below) is untouched:
// that POST is the mail provider acting on the person's own click.
export async function GET(req: NextRequest) {
  const token = (req.nextUrl.searchParams.get("token") || "").trim();
  if (!token) return NextResponse.redirect(new URL("/unsubscribe?error=missing", req.url));
  return NextResponse.redirect(new URL(`/unsubscribe?confirm=1&token=${encodeURIComponent(token)}`, req.url));
}

// Handles the List-Unsubscribe-Post header sent by Gmail, Yahoo and Outlook,
// and (with ?ui=1) the confirm page's button, which is sent back to a page.
export async function POST(req: NextRequest) {
  const token = (req.nextUrl.searchParams.get("token") || "").trim();
  const fromPage = req.nextUrl.searchParams.get("ui") === "1";
  if (!token) {
    return fromPage
      ? NextResponse.redirect(new URL("/unsubscribe?error=missing", req.url), 303)
      : NextResponse.json({ error: "Missing token" }, { status: 400 });
  }

  const ok = await suppress(token);
  if (fromPage) return NextResponse.redirect(new URL(ok ? "/unsubscribe?success=1" : "/unsubscribe?error=invalid", req.url), 303);
  if (!ok) return NextResponse.json({ error: "Invalid token" }, { status: 404 });
  return NextResponse.json({ success: true });
}
