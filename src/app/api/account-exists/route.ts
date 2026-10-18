import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { getAdminSupabase } from "@/lib/supabase-admin";
import { isRateLimited } from "@/lib/rate-limit";
import { clientIp } from "@/lib/client-ip";
import { VISITOR_COOKIE } from "@/lib/visit-identity";

export const runtime = "nodejs";

const EMAIL_SHAPE = /^[a-z0-9._+-]{1,64}@[a-z0-9-]+(\.[a-z0-9-]+)+$/;

// Does the visitor already have a SwiftCard account? Used to suppress the
// "create your free card" nudge for existing customers (owner request): we
// never pester someone who already has a card.
//
// Two signals, either one is enough:
//   1. The caller is SIGNED IN — they obviously have an account.
//   2. The email they just shared is tied to an existing account (matches an
//      account's auth email, a profile email, or a card's contact email).
//
// Boolean-only, rate-limited per IP, and only about an address THIS browser
// shared on a card (below), so it can't be used as an email enumeration
// oracle.
export async function POST(req: NextRequest) {
  // 1. Signed-in caller → yes, without needing any email.
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (user) return NextResponse.json({ exists: true });
  } catch { /* not signed in — fall through to the email check */ }

  if (await isRateLimited(`acct-exists:${clientIp(req)}`, 30, 10 * 60 * 1000)) {
    // Fail OPEN (exists:false) so a throttled check never suppresses a genuine
    // new-visitor signup nudge.
    return NextResponse.json({ exists: false });
  }

  let email = "";
  try {
    const body = await req.json();
    if (typeof body?.email === "string") email = body.email.trim().toLowerCase();
  } catch { /* no body */ }
  // A real address, and nothing else. ilike treats % and _ (and PostgREST also
  // treats *) as wildcards, so "a%@gmail.com" used to answer for EVERY account
  // starting with "a" and the private sign-in emails could be walked out one
  // character at a time (security audit 2026-09-24). Only plain address
  // characters get through, and the one legal wildcard, "_", is escaped.
  if (!email || email.length > 254 || !EMAIL_SHAPE.test(email)) return NextResponse.json({ exists: false });
  const pattern = email.replace(/_/g, "\\_");

  const admin = getAdminSupabase();

  // ONLY ABOUT AN ADDRESS THIS BROWSER SHARED (audit SEC-02). The nudge asks
  // about the email the visitor typed into a card's share form, and that
  // share left a contact stamped with this browser's sc_vid (httpOnly, set by
  // the server). Without the tie, anyone could POST any address and learn
  // whether it is a SwiftCard customer — 30 a time, from as many IPs as they
  // liked. Now an address this browser never shared answers "no", which only
  // means the signup nudge shows.
  const visitorId = req.cookies.get(VISITOR_COOKIE)?.value ?? "";
  if (!visitorId) return NextResponse.json({ exists: false });
  try {
    const { data: shared } = await admin
      .from("leads")
      .select("id")
      .eq("visitor_id", visitorId)
      .ilike("email", pattern)
      .limit(1)
      .maybeSingle();
    if (!shared) return NextResponse.json({ exists: false });
  } catch {
    return NextResponse.json({ exists: false });
  }

  try {
    // A profile whose contact email OR a card whose contact email matches means
    // this address already belongs to a SwiftCard account. ilike with no
    // wildcards = case-insensitive equality.
    const [{ data: prof }, { data: card }] = await Promise.all([
      admin.from("profiles").select("id").ilike("email", pattern).limit(1).maybeSingle(),
      admin.from("cards").select("id").ilike("email", pattern).limit(1).maybeSingle(),
    ]);
    return NextResponse.json({ exists: !!prof || !!card });
  } catch {
    return NextResponse.json({ exists: false });
  }
}
