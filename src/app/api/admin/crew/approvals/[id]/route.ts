import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { backToTab, field } from "@/lib/crew/admin-form";
import { decide } from "@/lib/crew/decide";
import { SupabaseStore } from "@/lib/crew/store-supabase";

// Approve / Reject / Edit / "I posted it" on one inbox card.
export const maxDuration = 60;

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await ctx.params;
  const form = await req.formData();
  const action = field(form, "action");
  const by = admin.email ?? admin.id;
  const store = new SupabaseStore();
  let r: { ok: boolean; message: string };
  if (action === "approve") r = await decide(store, id, { action: "approve", body: form.has("body") ? field(form, "body") : undefined, by });
  else if (action === "reject") r = await decide(store, id, { action: "reject", reason: field(form, "reason") || "no reason given", by });
  else if (action === "posted") r = await decide(store, id, { action: "posted", by });
  else if (action === "edit") r = await decide(store, id, { action: "edit", body: field(form, "body"), by });
  else r = { ok: false, message: "Unknown button." };
  return backToTab(req, field(form, "tab") || "inbox", r.message);
}
