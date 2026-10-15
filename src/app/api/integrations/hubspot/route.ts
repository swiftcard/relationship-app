import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { getAdminSupabase } from "@/lib/supabase-admin";

export async function DELETE() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // Checked: the Settings card only shows "disconnected" when this really
  // removed the connection, never on a failure it couldn't see. No plan
  // check — disconnecting is always allowed.
  const { error } = await getAdminSupabase().from("integrations").delete().eq("user_id", user.id).eq("provider", "hubspot");
  if (error) return NextResponse.json({ error: "disconnect_failed", message: "Couldn't disconnect — try again." }, { status: 500 });

  return NextResponse.json({ ok: true });
}
