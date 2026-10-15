import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { getAdminSupabase } from "@/lib/supabase-admin";
import { isPaidProfile, PLAN_COLUMNS } from "@/lib/effective-plan";
import { isZapierWebhookUrl } from "@/lib/safe-fetch";
import { sanitizeCardScope } from "@/lib/crm-scope";
import { scopeIsOwned } from "@/lib/crm-scope-server";
import { zapierLeadPayload, zapierStatusMessage, CRM_WEBHOOK_TIMEOUT_MS } from "@/lib/crm-sync";

// PATCH — save webhook URL
export async function PATCH(request: NextRequest) {
  const userSupabase = await createClient();
  const { data: { user } } = await userSupabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const admin = getAdminSupabase();

  const { zapier_webhook_url, zapier_card_ids } = await request.json() as { zapier_webhook_url?: string; zapier_card_ids?: unknown };

  // CONNECTING Zapier is a Pro/Office feature. Disconnecting is not: a lapsed
  // account must always be able to stop its contacts going somewhere — the
  // privacy policy promises "disconnect anytime", and the padlock used to
  // make that impossible after a downgrade.
  const clearing = !zapier_webhook_url;
  const { data: planRow } = await admin.from("profiles").select(PLAN_COLUMNS).eq("id", user.id).single();
  if (!clearing && !isPaidProfile(planRow)) {
    return NextResponse.json({ code: "INTEGRATION_PRO_ONLY", error: "upgrade", message: "Zapier is a Pro feature.", upgrade: "/upgrade" }, { status: 402 });
  }

  // Only accept a real Zapier catch-hook URL (or clearing it). This stops an
  // arbitrary internal URL from being stored and later POSTed lead PII (SSRF).
  if (zapier_webhook_url && !isZapierWebhookUrl(zapier_webhook_url)) {
    return NextResponse.json(
      { error: "invalid_url", message: "Enter a Zapier webhook URL (https://hooks.zapier.com/…)." },
      { status: 400 },
    );
  }

  // Optional pre-connect card scope, same vocabulary as the CRM rows: absent =
  // don't touch, null = all cards, list = only these. Empty would be a webhook
  // that looks connected and never fires — reject it like the scope API does.
  let scopeUpdate: { zapier_card_ids?: string[] | null } = {};
  if (zapier_card_ids !== undefined) {
    const scope = zapier_card_ids === null ? null : sanitizeCardScope(zapier_card_ids);
    if (scope !== null && scope.length === 0) {
      return NextResponse.json({ error: "empty_scope", message: "Pick at least one card, or choose All cards." }, { status: 400 });
    }
    if (!(await scopeIsOwned(admin, user.id, scope))) {
      return NextResponse.json({ error: "unknown_card", message: "One of those cards isn't yours." }, { status: 400 });
    }
    scopeUpdate = { zapier_card_ids: scope };
  }

  const { error } = await admin
    .from("profiles")
    // A new (or removed) webhook starts with a clean slate: the last one's
    // failure line says nothing about this one.
    .update({ zapier_webhook_url: zapier_webhook_url || null, ...scopeUpdate, zapier_error: null })
    .eq("id", user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

// POST — test webhook with sample payload
export async function POST(request: NextRequest) {
  const userSupabase = await createClient();
  const { data: { user } } = await userSupabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // Test send is Pro-only too, and the URL must be a real Zapier hook — without
  // this, res.ok/res.status leaked back is a blind internal port-scan oracle.
  const admin2 = getAdminSupabase();
  const { data: planRow2 } = await admin2.from("profiles").select(PLAN_COLUMNS).eq("id", user.id).single();
  if (!isPaidProfile(planRow2)) {
    return NextResponse.json({ code: "INTEGRATION_PRO_ONLY", error: "upgrade", message: "Zapier is a Pro feature.", upgrade: "/upgrade" }, { status: 402 });
  }

  const { webhookUrl } = await request.json() as { webhookUrl?: string };
  if (!webhookUrl) return NextResponse.json({ error: "no_url" }, { status: 400 });
  if (!isZapierWebhookUrl(webhookUrl)) {
    return NextResponse.json({ error: "invalid_url", message: "Enter a Zapier webhook URL (https://hooks.zapier.com/…)." }, { status: 400 });
  }

  // Every field filled in, never null: Zapier only offers a field for mapping
  // once the sample it was built from had a VALUE there, so a null notes or
  // where_met in the test meant the Zap could never use them.
  const body = JSON.stringify(zapierLeadPayload({
    leadId: "00000000-0000-4000-8000-000000000000",
    capturedByCardId: "00000000-0000-4000-8000-000000000001",
    name: "Jane Smith",
    email: "jane@example.com",
    phone: "555-0100",
    company: "Acme Inc",
    message: "Loved meeting you at the conference!",
    notes: "Interested in a demo next week.",
    whereMet: "Austin Founders Mixer",
    location: "New York, US",
    source: "QR code",
    capturedByCard: "your-card",
    capturedByName: "Your Name",
    tags: ["scanned"],
    test: true,
  }));

  let status: number | null = null;
  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      // Same bound as a real send — a hook that never answers must not hang
      // the button (it used to have no timeout at all).
      signal: AbortSignal.timeout(CRM_WEBHOOK_TIMEOUT_MS),
    });
    status = res.status;
  } catch { /* no answer */ }

  // ok reflects ZAPIER's answer, and the reply is always 200 so the button
  // reads the body: it used to check this route's own status, which was 200
  // whether Zapier took the test or refused it, so a switched-off Zap showed
  // "Sent ✓".
  const outcome = zapierStatusMessage(status);
  return NextResponse.json({
    ok: outcome.ok,
    status,
    message: outcome.ok
      ? "Test sent — open your Zap in Zapier to see it arrive."
      : outcome.retryable
        ? "Zapier didn't answer — wait a moment and press Test again."
        : outcome.message,
  });
}
