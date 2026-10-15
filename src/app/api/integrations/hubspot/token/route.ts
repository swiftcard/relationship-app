import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { getAdminSupabase } from "@/lib/supabase-admin";
import { isPaidProfile, PLAN_COLUMNS } from "@/lib/effective-plan";
import { encryptToken } from "@/lib/token-crypto";
import { sanitizeCardScope } from "@/lib/crm-scope";
import { scopeIsOwned } from "@/lib/crm-scope-server";
import { crmFetch } from "@/lib/crm-http";

// HubSpot's self-serve OAuth ("public app") creation is currently disabled on
// their end, so this integration connects via a Private App access token
// instead — the user pastes a token they generate in their own HubSpot
// account (Settings → Integrations → Private Apps), same shape as the
// existing Zapier webhook-URL flow. Private App tokens don't expire, so
// sync-hubspot.ts's refresh logic is simply never triggered for these rows.
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const admin = getAdminSupabase();

  // HubSpot is a Pro/Office feature, same as the other CRM integrations.
  const { data: planRow } = await admin.from("profiles").select(PLAN_COLUMNS).eq("id", user.id).single();
  if (!isPaidProfile(planRow)) {
    return NextResponse.json({ code: "INTEGRATION_PRO_ONLY", error: "upgrade", message: "HubSpot is a Pro feature.", upgrade: "/upgrade" }, { status: 402 });
  }

  const { token, card_ids } = await request.json() as { token?: string; card_ids?: unknown };
  const trimmed = token?.trim();
  if (!trimmed) {
    return NextResponse.json({ error: "no_token", message: "Paste your HubSpot access token." }, { status: 400 });
  }

  // Confirm the token is real before storing it. Two read-only probes, either
  // of which proves the key reaches a portal: account details first, then one
  // contact — the call the scopes we ask for (contacts.read) definitely allow.
  // A service key granted ONLY the contact scopes must not be refused here
  // because the account-info endpoint wants a scope the setup text never
  // mentioned; that would reject a key that syncs perfectly well.
  // The account-details answer also carries the portal id, kept so "Send test
  // contact" can link straight to the record it made. Bounded (lib/crm-http):
  // a HubSpot that never answers must not hang the Save button.
  let portalId: number | null = null;
  const details = await crmFetch("https://api.hubapi.com/account-info/v3/details", { headers: { Authorization: `Bearer ${trimmed}` } })
    .catch(() => null);
  if (details?.ok) portalId = ((await details.json().catch(() => ({}))) as { portalId?: number }).portalId ?? null;
  const accepted =
    !!details?.ok ||
    (await crmFetch("https://api.hubapi.com/crm/v3/objects/contacts?limit=1", { headers: { Authorization: `Bearer ${trimmed}` } })
      .then((r) => r.ok)
      .catch(() => false));
  if (!accepted) {
    return NextResponse.json(
      { error: "invalid_token", message: "That token wasn't accepted by HubSpot — check it and try again." },
      { status: 400 },
    );
  }


  // Pre-connect card scope. Sent by the settings form alongside the token;
  // absent means the caller made no choice (reconnect or older client), and
  // the row's existing scope must be left alone. An explicit empty list would
  // be a connection that silently sends nothing — reject like the scope API.
  let scopeUpdate: { card_ids?: string[] | null } = {};
  if (card_ids !== undefined) {
    const scope = card_ids === null ? null : sanitizeCardScope(card_ids);
    if (scope !== null && scope.length === 0) {
      return NextResponse.json({ error: "empty_scope", message: "Pick at least one card, or choose All cards." }, { status: 400 });
    }
    if (!(await scopeIsOwned(admin, user.id, scope))) {
      return NextResponse.json({ error: "unknown_card", message: "One of those cards isn't yours." }, { status: 400 });
    }
    scopeUpdate = { card_ids: scope };
  }

  const { error } = await admin.from("integrations").upsert({
    user_id: user.id,
    provider: "hubspot",
    access_token: encryptToken(trimmed),
    refresh_token: null,
    expires_at: null,
    metadata: portalId ? { portal_id: portalId } : {},
    updated_at: new Date().toISOString(),
    ...scopeUpdate,
    sync_error: null, // upsert only touches listed columns — must clear explicitly on reconnect
  }, { onConflict: "user_id,provider" });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
