import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { getAdminSupabase } from "@/lib/supabase-admin";
import { isPaidProfile, PLAN_COLUMNS } from "@/lib/effective-plan";
import { mutateCustomization } from "@/lib/profile-customization";

// PATCH — save which events to forward to the connected CRM (Zapier).
export async function PATCH(req: NextRequest) {
  const userSupabase = await createClient();
  const { data: { user } } = await userSupabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { notifications, views } = (await req.json().catch(() => ({}))) as { notifications?: boolean; views?: boolean };

  // Turning events ON is Pro. Turning them OFF never is: a lapsed account must
  // always be able to stop data leaving.
  const turningOn = !!notifications || !!views;
  const admin = getAdminSupabase();
  const { data: prof } = await admin.from("profiles").select(PLAN_COLUMNS).eq("id", user.id).single();
  if (turningOn && !isPaidProfile(prof)) {
    return NextResponse.json({ code: "INTEGRATION_PRO_ONLY", error: "upgrade", message: "Forwarding events to your CRM is a Pro feature.", upgrade: "/upgrade" }, { status: 402 });
  }

  // ONE key of the shared customization column, read back and retried
  // (lib/profile-customization). This used to rewrite the whole column from a
  // snapshot read a moment earlier, which could erase whatever another writer
  // stored in between — the monthly free-contact meter included.
  const write = await mutateCustomization(user.id, "crm", () => ({ notifications: !!notifications, views: !!views }), admin);
  if (!write.ok) return NextResponse.json({ error: "save_failed", message: "Couldn't save. Try again." }, { status: 500 });
  return NextResponse.json({ ok: true });
}
