import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { signConnectHandoff } from "@/lib/oauth-state";

// Mint a short-lived handoff token so the shell can start an OAuth connect in
// the system browser sheet without the app's session cookies. See
// lib/connect-user.ts. Session-only; the token is a signed user id, nothing
// more, and is worthless past its 5-minute window (HANDOFF_MAX_AGE_MS).
export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ h: signConnectHandoff(user.id) });
}
