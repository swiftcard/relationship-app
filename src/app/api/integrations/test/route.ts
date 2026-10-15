import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { getAdminSupabase } from "@/lib/supabase-admin";
import { isPaidProfile, PLAN_COLUMNS } from "@/lib/effective-plan";
import { isRateLimited } from "@/lib/rate-limit";
import { CRM_PROVIDERS } from "@/lib/crm-sync";
import { runCrmSync } from "@/lib/crm-run";
import type { CrmLead, CrmProviderKey } from "@/lib/crm-connection";
import { TEST_CONTACT_EMAIL } from "@/lib/crm-lead";

// Each attempt is bounded (lib/crm-http), but a slow CRM with a refresh and a
// retry can still take a while — the button waits for the real answer.
export const maxDuration = 60;

/**
 * POST { provider } — send one clearly-labelled test contact to the caller's
 * OWN connection, through exactly the code a real contact uses, and report
 * exactly what the CRM said. Card scope doesn't apply (there's no card) and a
 * failure is never queued: the person pressing it wants the answer now.
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { provider } = (await req.json().catch(() => ({}))) as { provider?: string };
  const p = typeof provider === "string" ? CRM_PROVIDERS[provider as CrmProviderKey] : undefined;
  if (!p) return NextResponse.json({ error: "bad_provider" }, { status: 400 });

  const admin = getAdminSupabase();
  const { data: profile } = await admin.from("profiles").select(PLAN_COLUMNS).eq("id", user.id).maybeSingle();
  if (!isPaidProfile(profile)) {
    return NextResponse.json({ code: "INTEGRATION_PRO_ONLY", error: "upgrade", message: "Integrations are a Pro feature.", upgrade: "/upgrade" }, { status: 402 });
  }

  // Every press is a real write to someone's CRM. Generous for a person
  // checking their setup; useless as a way to spam it.
  if (await isRateLimited(`crm-test:${user.id}`, 10, 10 * 60 * 1000)) {
    return NextResponse.json({ ok: false, message: "That's a lot of tests — wait a few minutes and try again." }, { status: 429 });
  }

  const { data: connected } = await admin.from("integrations").select("id").eq("user_id", user.id).eq("provider", p.key).maybeSingle();
  if (!connected) return NextResponse.json({ ok: false, message: `Connect ${p.label} first.` }, { status: 404 });

  // The test arrives "from" the caller's first card, so the note's card link
  // and rep name look exactly like a real contact's.
  const { data: card } = await admin.from("cards").select("id, username, name").eq("user_id", user.id).order("created_at", { ascending: true }).limit(1).maybeSingle();

  const lead: CrmLead = {
    name: "SwiftCard Test",
    email: TEST_CONTACT_EMAIL,
    phone: "+1 555 010 0199",
    company: "SwiftCard",
    message: "This is a test contact sent from SwiftCard Settings — safe to delete.",
    source: "Settings test",
    capturedByCard: (card?.username as string | undefined) ?? null,
    capturedByName: (card?.name as string | undefined) ?? null,
    capturedByCardId: (card?.id as string | undefined) ?? null,
    tags: ["swiftcard-test"],
  };

  const out = await runCrmSync(p, lead, user.id, { mode: "capture", test: true });
  if (out.status === "sent") {
    const verb = out.action === "created" ? "Added" : out.action === "logged" ? "Logged" : "Updated";
    return NextResponse.json({
      ok: true,
      message: `${verb} "SwiftCard Test" in ${p.label}.`,
      recordUrl: out.recordUrl ?? null,
    });
  }
  if (out.status === "skipped") {
    // Connected but unusable without a banner: a preview build with no app
    // secret, or a token we couldn't decrypt. Say so rather than "sent".
    return NextResponse.json({ ok: false, message: `${p.label} couldn't be reached from here. Try reconnecting it.` });
  }
  // A test is never queued, so "will try again" would be untrue here.
  return NextResponse.json({
    ok: false,
    message: out.retryable ? `${p.label} didn't answer — wait a moment and send the test again.` : out.message,
  });
}
