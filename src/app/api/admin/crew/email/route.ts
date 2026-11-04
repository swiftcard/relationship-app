import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { ERR, backToTab, field, sameSite } from "@/lib/crew/admin-form";
import { scrub } from "@/lib/crew/agent-status";
import { LiveGmail } from "@/lib/crew/email/gmail";
import { checkReplies, draftFromLead, emailConfig, optOutAddress } from "@/lib/crew/email/outbox";
import { SupabaseEmailSends } from "@/lib/crew/email/sends-supabase";
import { SupabaseStore } from "@/lib/crew/store-supabase";

// ── The Email page's buttons that never send ────────────────────────────────
// Review as email (a Web Lead → a draft to read), Check replies (headers only),
// Not interested (suppress an address after reading their reply). Sending is
// the Send button on a draft, which posts to /api/admin/crew/approvals/<id>.
// Plain form posts, admin-gated, refused from another site; every answer is a
// 303 back to the Email page with a message.
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const origin = req.headers.get("origin");
  if (origin && !sameSite(origin, req.nextUrl.host)) return NextResponse.json({ error: "cross-site" }, { status: 403 });
  const form = await req.formData().catch(() => new FormData());
  const action = field(form, "action");
  const by = admin.email ?? admin.id;
  const store = new SupabaseStore();

  if (action === "draft_lead") {
    const r = await draftFromLead(store, field(form, "lead"), by);
    return r.ok ? backToTab(req, "email", r.existed ? "That lead already has a draft below." : "Draft ready below. Read it, edit if you like, then Send.", undefined, `a-${r.id}`) : backToTab(req, "email", scrub(r.message), ERR);
  }
  if (action === "check_replies") {
    const sends = new SupabaseEmailSends();
    if (!(await sends.ready())) return backToTab(req, "email", "Run supabase/crew-email.sql first.", ERR);
    const r = await checkReplies(store, sends, new LiveGmail(), emailConfig().mailbox);
    return backToTab(req, "email", `Checked ${r.checked} thread${r.checked === 1 ? "" : "s"}: ${r.replied} replied, ${r.bounced} bounced, ${r.unsubscribed} asked to stop.`);
  }
  if (action === "opt_out") {
    const ok = await optOutAddress(store, field(form, "email"), by);
    return ok ? backToTab(req, "email", "Done. Nobody will contact them again, on any channel.") : backToTab(req, "email", "That isn't an email address.", ERR);
  }
  return backToTab(req, "email", "Unknown button.", ERR);
}
