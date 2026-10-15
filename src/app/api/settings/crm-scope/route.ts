import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { getAdminSupabase } from "@/lib/supabase-admin";
import { isPaidProfile, PLAN_COLUMNS } from "@/lib/effective-plan";
import { sanitizeCardScope } from "@/lib/crm-scope";
import { SCOPE_EMPTIED_MARK } from "@/lib/crm-scope-server";

// Which of your cards feed a given destination.
//
// `null` means all cards — the default every connection starts on, and what
// they all behaved like before this existed. A list means only those cards.
//
// The CRMs store it on their own integrations row; Zapier stores it on the
// profile, because the webhook is a profile column rather than an integration.
// Same vocabulary either way so the client doesn't have to care.
const CRM_TARGETS = ["google", "hubspot", "pipedrive", "highlevel", "salesforce"] as const;
type CrmTarget = (typeof CRM_TARGETS)[number];
type Target = CrmTarget | "zapier";

function isTarget(v: unknown): v is Target {
  return v === "zapier" || (typeof v === "string" && (CRM_TARGETS as readonly string[]).includes(v));
}

export async function PATCH(request: NextRequest) {
  const userSupabase = await createClient();
  const { data: { user } } = await userSupabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const admin = getAdminSupabase();

  // Same gate as connecting an integration in the first place — scoping one you
  // shouldn't have shouldn't be reachable either.
  const { data: planRow } = await admin.from("profiles").select(PLAN_COLUMNS).eq("id", user.id).single();
  if (!isPaidProfile(planRow)) {
    return NextResponse.json(
      { code: "INTEGRATION_PRO_ONLY", error: "upgrade", message: "Integrations are a Pro feature.", upgrade: "/upgrade" },
      { status: 402 },
    );
  }

  const body = (await request.json().catch(() => ({}))) as { target?: unknown; card_ids?: unknown };
  if (!isTarget(body.target)) {
    return NextResponse.json({ error: "bad_target" }, { status: 400 });
  }
  const target: Target = body.target;

  // null = all cards. Anything else is sanitized down to real uuids.
  const scope = body.card_ids === null || body.card_ids === undefined ? null : sanitizeCardScope(body.card_ids);

  if (scope !== null) {
    // An empty list would silently mean "send nothing" — a destination that
    // looks connected and quietly never fires. Make the user say "all cards"
    // (null) or disconnect, rather than leaving that trap in the data.
    if (scope.length === 0) {
      return NextResponse.json(
        { error: "empty_scope", message: "Pick at least one card, or choose All cards." },
        { status: 400 },
      );
    }
    // Every id must be one of THIS user's cards. Without this an id from
    // another account could be stored — it would never match anything at send
    // time, so it isn't a leak, but it would be a scope the owner can't see or
    // reason about in their own UI.
    const { data: owned } = await admin.from("cards").select("id").eq("user_id", user.id).in("id", scope);
    const ownedIds = new Set((owned ?? []).map((c) => c.id as string));
    if (scope.some((id) => !ownedIds.has(id))) {
      return NextResponse.json({ error: "unknown_card", message: "One of those cards isn't yours." }, { status: 400 });
    }
  }

  // Choosing cards again answers the "the cards you chose were deleted" line
  // (lib/crm-scope-server dropCardFromScopes), so it goes — and ONLY that line:
  // any other problem on the connection is still true and stays.
  if (target === "zapier") {
    const { error } = await admin.from("profiles").update({ zapier_card_ids: scope }).eq("id", user.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await admin.from("profiles").update({ zapier_error: null }).eq("id", user.id).like("zapier_error", `%${SCOPE_EMPTIED_MARK}%`).then(() => {}, () => {});
    return NextResponse.json({ ok: true, card_ids: scope });
  }

  // Scope belongs to a connection, so there has to be one. This is also what
  // stops an Office SUB-USER from editing the scope of the office owner's CRM
  // they inherit: they have no integrations row of their own, so there is
  // nothing here to update and they get told to connect their own first.
  const { data: updated, error } = await admin
    .from("integrations")
    .update({ card_ids: scope })
    .eq("user_id", user.id)
    .eq("provider", target)
    .select("id");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!updated || updated.length === 0) {
    return NextResponse.json({ error: "not_connected", message: "Connect this integration first." }, { status: 404 });
  }
  await admin
    .from("integrations")
    .update({ sync_error: null })
    .eq("user_id", user.id)
    .eq("provider", target)
    .like("sync_error", `%${SCOPE_EMPTIED_MARK}%`)
    .then(() => {}, () => {});

  return NextResponse.json({ ok: true, card_ids: scope });
}
