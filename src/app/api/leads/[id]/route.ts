import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { getAdminSupabase } from "@/lib/supabase-admin";
import { mergeClientTags } from "@/lib/lead-tags";
import { isLockedLead } from "@/lib/lead-access";
import { isPaidUser } from "@/lib/notification-privacy";
import { after } from "next/server";
import { isPaidPlan } from "@/lib/plan";
import { syncLeadToAllCrms } from "@/lib/crm-sync";
import { CRM_LEAD_COLUMNS, crmChanges, loadCrmLead } from "@/lib/crm-lead";

// Edits fan out to every connected CRM in after() — same room as capture.
export const maxDuration = 60;

async function getOwnerUsernames(userId: string): Promise<string[]> {
  const admin = getAdminSupabase();
  const [{ data: profile }, { data: cards }] = await Promise.all([
    admin.from("profiles").select("username").eq("id", userId).single(),
    admin.from("cards").select("username").eq("user_id", userId),
  ]);
  return [
    profile?.username ?? "__none__",
    ...(cards ?? []).map((c: { username: string }) => c.username),
  ];
}

const ALLOWED_PATCH_FIELDS = new Set([
  "status", "notes", "tags", "follow_up_date", "name", "email", "phone", "company", "message",
  "where_met", "convo_details", "company_description", "follow_up_sequence",
]);

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const raw = await req.json();
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Only allow updates to specific fields
  const body: Record<string, unknown> = {};
  for (const key of Object.keys(raw)) {
    if (ALLOWED_PATCH_FIELDS.has(key)) body[key] = raw[key];
  }
  if (Object.keys(body).length === 0) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
  }

  const usernames = await getOwnerUsernames(user.id);
  const admin = getAdminSupabase();

  // A contact locked behind the Free cap is hidden from this account, so it
  // cannot be edited — or given a follow-up that would email it — by id
  // (lib/lead-access isLockedLead, the same line every lead route holds).
  {
    const { data: target } = await admin
      .from("leads").select("tags").eq("id", id).in("card_owner", usernames).maybeSingle();
    if (isLockedLead(target) && !(await isPaidUser(user.id))) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
  }

  // TEXT FOLLOW-UPS ARE PRO; EMAIL ONES ARE EVERY PLAN (owner, 2026-09-11).
  //
  // The sender refuses to TEXT for a free account either — this is the half a
  // client cannot skip, so a crafted request cannot schedule texts the daily
  // cron would then decline to send, leaving a contact with a flow that looks
  // live and never fires.
  //
  // A step with no channel counts as EMAIL, which is what the cron's own
  // routing does for legacy steps unless the contact has affirmatively opted
  // in to SMS — so an untagged step can never smuggle a text past this.
  //
  // CLEARING is always allowed. A downgraded account must be able to switch
  // off, reset, or empty a sequence it already has: the rule is "no new TEXT
  // automation without Pro", not "no way out".
  if ("follow_up_sequence" in body) {
    const next = body.follow_up_sequence;
    const steps = Array.isArray(next) ? (next as { channel?: string }[]) : [];
    const addingSms = steps.some((s) => s?.channel === "sms");
    if (addingSms) {
      const { data: prof } = await admin
        .from("profiles").select("plan").eq("id", user.id).maybeSingle();
      if (!isPaidPlan(prof?.plan as string | null)) {
        return NextResponse.json(
          {
            // Machine code for the native app; web reads `message`.
            code: "PRO_REQUIRED",
            error: "pro_required",
            message: "Text follow-ups are part of Pro. Email follow-ups are included on every plan.",
          },
          { status: 402 },
        );
      }
    }
  }

  // `tags` is server-owned in part: reserved tags drive org visibility
  // (sc-office-*), the Free paywall (sc-locked), and automation state (flow-*,
  // *-paused, preset-*). Never let the client set/clear those — read the row's
  // current tags (ownership-scoped) and preserve the reserved ones, honoring
  // only the client's non-reserved tags. Without this a user could plant a lead
  // in another org or unlock a paywalled lead. See lib/lead-tags.ts.
  if ("tags" in body) {
    const { data: cur } = await admin
      .from("leads")
      .select("tags")
      .eq("id", id)
      .in("card_owner", usernames)
      .maybeSingle();
    const clientTags = (Array.isArray(body.tags) ? body.tags : []).filter(
      (t): t is string => typeof t === "string"
    );
    body.tags = mergeClientTags(body.tags, cur?.tags as string[] | null);
    // The two channel-pause tags are the dashboard's own Email/Text automation
    // toggles — owner-facing controls, unlike the rest of the reserved set
    // (sc-office-*, sc-locked, flow-*, preset-*), which stays server-owned.
    // mergeClientTags preserves reserved tags verbatim, which silently froze
    // these toggles in BOTH directions (flipping them never changed the row) —
    // and once lead capture began recording a declined SMS consent as
    // sms-paused, a frozen toggle meant no owner could ever re-enable texts at
    // a contact's request. This caller is authenticated and every read/write is
    // ownership-scoped, so honoring the client's state for exactly these two
    // tags is safe.
    const CHANNEL_PAUSE_TAGS = ["email-paused", "sms-paused"] as const;
    let reconciled = body.tags as string[];
    for (const t of CHANNEL_PAUSE_TAGS) {
      reconciled = clientTags.includes(t)
        ? Array.from(new Set([...reconciled, t]))
        : reconciled.filter((x) => x !== t);
    }
    // Affirmative SMS consent (sms-ok) is set ONLY by an EXPLICIT owner signal:
    // the Text-automation toggle sends `sms_consent` (the owner asserting they
    // have permission to text this contact). sms-ok is server-owned, so this is
    // the only post-capture way it changes — an unrelated tag edit (adding a
    // label) never fabricates or revokes consent. The cron requires sms-ok to
    // send any automated text.
    const rawSmsConsent = typeof raw.sms_consent === "boolean" ? raw.sms_consent : undefined;
    if (rawSmsConsent === true) {
      reconciled = Array.from(new Set([...reconciled.filter((x) => x !== "sms-paused"), "sms-ok"]));
    } else if (rawSmsConsent === false) {
      reconciled = Array.from(new Set([...reconciled.filter((x) => x !== "sms-ok"), "sms-paused"]));
    }
    body.tags = reconciled;
  }

  // The contact as the CRM last saw it — read BEFORE the write, so the sync
  // below can tell what this edit actually changed (and the email it had).
  const CRM_VISIBLE = ["name", "email", "phone", "company", "notes", "tags", "message", "where_met"];
  const crmRelevant = CRM_VISIBLE.some((k) => k in body);
  const { data: before } = crmRelevant
    ? await admin.from("leads").select(CRM_LEAD_COLUMNS).eq("id", id).in("card_owner", usernames).maybeSingle()
    : { data: null };

  const { error } = await admin
    .from("leads")
    .update(body)
    .eq("id", id)
    .in("card_owner", usernames);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // ── CRM stays current with EDITS, not just captures (owner order
  // 2026-08-27, the Blinq-parity work). Editing a contact's details, notes or
  // tags re-runs the same sync the capture ran, in UPDATE mode, against the
  // record that capture created (crm_links) — so it is updated in place even
  // when the edit changed the very email it was first matched on.
  //
  // Only a REAL change syncs. The dashboard PATCHes tags just to clear
  // "unread" when a contact is opened, and sends whole objects back on save;
  // comparing before and after (crmChanges) keeps those from writing to every
  // CRM, and from creating records for contacts that were never sent.
  // Only the changed contact fields may overwrite what the CRM holds; a fresh
  // timeline note only when the edit changed what a note carries.
  if (crmRelevant && before) {
    try {
      const loaded = await loadCrmLead(id);
      if (loaded) {
        const change = crmChanges(before, loaded.row);
        if (change.fields.length || change.note || change.tags) {
          after(
            syncLeadToAllCrms(loaded.lead, loaded.capturedBy, {
              mode: "update",
              attachNote: change.note,
              changedFields: change.fields,
              previousEmail: (before.email as string | null) ?? null,
              previousPhone: (before.phone as string | null) ?? null,
            }),
          );
        }
      }
    } catch (e) {
      console.error("[lead-edit] CRM update sync skipped:", e);
    }
  }

  // If dissolving, clear automation tags and follow_up_sequence. Both the read
  // and the write are scoped to the caller's own cards (`.in("card_owner", ...)`)
  // — an unscoped update returns error:null even on a zero-row match, so without
  // this filter a user could POST another user's lead id and wipe THEIR
  // automation. Ownership must be re-checked here, not assumed from the update above.
  if (body.status === "dissolved") {
    const { data: lead } = await admin
      .from("leads")
      .select("tags")
      .eq("id", id)
      .in("card_owner", usernames)
      .maybeSingle();
    if (lead?.tags) {
      const cleanTags = (lead.tags as string[]).filter(
        (t: string) => !t.startsWith("preset-") && t !== "flow-paused"
      );
      await admin
        .from("leads")
        .update({ tags: cleanTags, follow_up_sequence: [] })
        .eq("id", id)
        .in("card_owner", usernames);
    }
  }

  return NextResponse.json({ success: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const usernames = await getOwnerUsernames(user.id);
  const admin = getAdminSupabase();

  const { error } = await admin
    .from("leads")
    .delete()
    .eq("id", id)
    .in("card_owner", usernames);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
