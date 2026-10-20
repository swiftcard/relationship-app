import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { getAdminSupabase } from "@/lib/supabase-admin";

// The new-card Wallet prompt (components/WalletPrompt) was pressed or closed:
// stamp the card so the prompt never comes back for it, on any device. Its own
// column (supabase/wallet-prompt.sql), not a customization key — card
// customization is rewritten whole by every save, and a flag slipped in
// between an editor's read and write would be lost.
//
// Admin client scoped to the caller's own card: the user_id filter is the
// ownership check, so someone else's card id simply matches no row.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { error } = await getAdminSupabase()
    .from("cards")
    .update({ wallet_prompt_done_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", user.id)
    .is("wallet_prompt_done_at", null);
  // Never an error the browser has to handle: at worst the prompt shows once
  // more on the next load.
  if (error) console.error("[wallet-prompt] mark done failed:", error.message);
  return NextResponse.json({ ok: true });
}
