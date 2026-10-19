import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { disconnectOAuthCrm } from "@/lib/oauth-revoke";

export async function DELETE() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // Checked: the Settings card only shows "disconnected" when this really
  // removed the connection, never on a failure it couldn't see. No plan
  // check — disconnecting is always allowed.
  // Revoked at HubSpot first, then removed here (lib/oauth-revoke, audit I-07).
  const { error } = await disconnectOAuthCrm(user.id, "hubspot");
  if (error) return NextResponse.json({ error: "disconnect_failed", message: "Couldn't disconnect — try again." }, { status: 500 });

  return NextResponse.json({ ok: true });
}
