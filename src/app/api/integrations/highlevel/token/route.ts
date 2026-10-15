import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { getAdminSupabase } from "@/lib/supabase-admin";
import { isPaidProfile, PLAN_COLUMNS } from "@/lib/effective-plan";
import { encryptToken } from "@/lib/token-crypto";
import { sanitizeCardScope } from "@/lib/crm-scope";
import { scopeIsOwned } from "@/lib/crm-scope-server";
import { checkHighLevelConnection } from "@/lib/sync-highlevel";

// HighLevel connects with a Private Integration token the user creates in their
// own account (Settings → Private Integrations), scoped to contacts.write.
//
// TWO values, unlike the other paste-a-token integrations: a Private
// Integration token is NOT implicitly scoped to a sub-account, and HighLevel
// requires locationId on every request. They're validated TOGETHER — a valid
// token paired with the wrong location id would otherwise save cleanly here and
// then fail on every single lead.
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const admin = getAdminSupabase();

  // Pro/Office feature, same as the other CRM integrations.
  const { data: planRow } = await admin.from("profiles").select(PLAN_COLUMNS).eq("id", user.id).single();
  if (!isPaidProfile(planRow)) {
    return NextResponse.json({ code: "INTEGRATION_PRO_ONLY", error: "upgrade", message: "HighLevel is a Pro feature.", upgrade: "/upgrade" }, { status: 402 });
  }

  const { token, extra, card_ids } = await request.json() as { token?: string; extra?: string; card_ids?: unknown };
  const trimmed = token?.trim();
  const locationId = extra?.trim();
  if (!trimmed || !locationId) {
    return NextResponse.json(
      { error: "missing_fields", message: "Paste both your Private Integration token and your Location ID." },
      { status: 400 },
    );
  }

  const check = await checkHighLevelConnection(trimmed, locationId);
  if (check === "missing_scope") {
    return NextResponse.json(
      { error: "missing_scope", message: "HighLevel accepted the token but won't let it read that sub-account. Edit the Private Integration, tick locations.readonly as well as contacts.write, and save it again." },
      { status: 400 },
    );
  }
  if (check !== "ok") {
    return NextResponse.json(
      { error: "invalid_token", message: "HighLevel didn't accept that pair. Check the token was copied in full, and that the Location ID is the sub-account you want leads to land in." },
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
    provider: "highlevel",
    access_token: encryptToken(trimmed),
    refresh_token: null,
    // Private Integration tokens are static — null keeps the refresh branch dormant.
    expires_at: null,
    metadata: { location_id: locationId },
    updated_at: new Date().toISOString(),
    ...scopeUpdate,
    sync_error: null, // upsert only touches listed columns — clear explicitly on reconnect
  }, { onConflict: "user_id,provider" });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // Checked: the Settings card only shows "disconnected" when this really
  // removed the connection, never on a failure it couldn't see.
  const { error } = await getAdminSupabase()
    .from("integrations")
    .delete()
    .eq("user_id", user.id)
    .eq("provider", "highlevel");
  if (error) return NextResponse.json({ error: "disconnect_failed", message: "Couldn't disconnect — try again." }, { status: 500 });

  return NextResponse.json({ ok: true });
}
