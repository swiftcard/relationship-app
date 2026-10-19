import { NextResponse } from "next/server";
import { deletionGraceOver } from "@/lib/deletion-grace";
import { createClient } from "@/lib/supabase-server";
import { getAdminSupabase } from "@/lib/supabase-admin";
import { revalidateUserCards } from "@/lib/card-page-data";


export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = getAdminSupabase();
  const { data: profile } = await admin.from("profiles").select("customization").eq("id", user.id).single();
  if (!profile) return NextResponse.json({ error: "No account" }, { status: 404 });

  const customization = (profile.customization as Record<string, unknown> | null) ?? {};
  const deletion = customization._deletion as { at?: string } | undefined;

  if (!customization._deleted) {
    return NextResponse.json({ ok: true }); // not deleted — nothing to do
  }

  // Enforce the 1-month reopen window.
  const at = deletion?.at ? new Date(deletion.at).getTime() : 0;
  const expired = !at || deletionGraceOver(at);
  if (expired) {
    return NextResponse.json({ error: "expired", message: "This account can no longer be reopened." }, { status: 410 });
  }

  // Restore the account — its cards and contacts were kept, so it comes back as-is.
  const restored = { ...customization };
  delete restored._deleted;
  delete restored._deletion;
  await admin.from("profiles").update({ customization: restored }).eq("id", user.id);
  // The public card pages come back now, not a minute later.
  await revalidateUserCards(user.id);

  return NextResponse.json({ ok: true });
}
