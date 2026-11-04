import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { getAdminSupabase } from "@/lib/supabase-admin";

export async function PATCH(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const admin = getAdminSupabase();
  const marketing = body.marketing_emails ?? true;

  // BOTH opt-out flags, every time (supabase/email-preference-center.sql).
  // canSendMarketing treats either one as "off", so writing only
  // marketing_emails left anyone who had gone quiet in the delete flow or
  // unsubscribed from an email still opted out after switching marketing back
  // on here — the switch read "on" and nothing arrived.
  const { error } = await admin
    .from("email_preferences")
    .upsert(
      {
        user_id: user.id,
        marketing_emails: marketing,
        marketing_opt_out: !marketing,
        receipt_emails: body.receipt_emails ?? true,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" }
    );

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = getAdminSupabase();
  const { data } = await admin
    .from("email_preferences")
    .select("marketing_emails, receipt_emails")
    .eq("user_id", user.id)
    .single();

  return NextResponse.json({
    marketing_emails: data?.marketing_emails ?? true,
    receipt_emails: data?.receipt_emails ?? true,
  });
}
