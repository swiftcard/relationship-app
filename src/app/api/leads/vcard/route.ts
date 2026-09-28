import { NextRequest, NextResponse } from "next/server";
import { resolveDownloadUserId } from "@/lib/download-auth";
import { getAdminSupabase } from "@/lib/supabase-admin";
import { buildVCard } from "@/lib/vcard";
import { fetchVCardPhoto, resolveLeadImageUrl } from "@/lib/contact-photo";
import { isPaidPlan, LOCKED_LEAD_TAG } from "@/lib/plan";

export async function GET(req: NextRequest) {
  const leadId = req.nextUrl.searchParams.get("id");
  if (!leadId) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  // Session OR a signed ?dl= token (system-browser download from the app).
  const userId = await resolveDownloadUserId(req, "/api/leads/vcard");

  const admin = getAdminSupabase();

  let lead: {
    name: string;
    phone: string | null;
    email: string | null;
    company: string | null;
    where_met?: string | null;
    notes?: string | null;
  } | null = null;

  if (userId) {
    // Independent reads — neither needs the other's answer, so one round trip.
    const [{ data: profile }, { data: extraCards }] = await Promise.all([
      admin.from("profiles").select("username, plan").eq("id", userId).single(),
      admin.from("cards").select("username").eq("user_id", userId),
    ]);
    const usernames = [profile?.username, ...(extraCards ?? []).map((c: { username: string }) => c.username)].filter(Boolean);

    const { data } = await admin.from("leads").select("name, phone, email, company, where_met, notes, tags").eq("id", leadId).in("card_owner", usernames).single();
    // Ownership was checked here; the Free-plan LOCK was not. Leads captured
    // past the monthly cap carry sc-locked — the dashboard filters them out,
    // /contacts filters them out, and CSV export is Pro-gated — but this route
    // returned a full vCard for any lead id the account owned. So an account
    // that downgraded (and knows the ids from when it was Pro) could still pull
    // the phone and email of contacts it can no longer see. Withheld as "not
    // found" below, matching how every other surface treats a locked lead.
    const locked = Array.isArray(data?.tags) && data.tags.includes(LOCKED_LEAD_TAG);
    lead = locked && !isPaidPlan(profile?.plan as string | null) ? null : data;
  }

  if (!lead) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // The contact's picture (owner order 2026-09-24): a lead has no photo field,
  // so lib/contact-photo looks one up — their own SwiftCard's headshot or logo
  // when the email they shared is on a live card, else their company's logo
  // from a business email domain. Best-effort: nothing found → no PHOTO, and
  // the contact still saves exactly as before.
  const image = await resolveLeadImageUrl(admin, lead);
  const photo = image ? await fetchVCardPhoto(image.url, image.kind) : null;

  // Shared builder handles RFC 6350 escaping — these fields are VISITOR-supplied,
  // so a name with an embedded newline or ";" could otherwise inject arbitrary
  // vCard fields into the contact saved on the owner's phone.
  const vcard = buildVCard({
    name: lead.name,
    company: lead.company,
    email: lead.email,
    phones: lead.phone ? [{ number: lead.phone, label: "mobile" }] : undefined,
    // Where you met them and your notes — the web "Save to phone" path built
    // its own vCard and included this, while this route omitted it, so the
    // same button produced a different contact on different platforms. Web now
    // uses this route too, so the note has to live here.
    note: [lead.where_met ? `Met at: ${lead.where_met}` : "", lead.notes ?? ""]
      .filter(Boolean)
      .join(" — "),
  }, photo);

  const slug = lead.name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");

  return new NextResponse(vcard, {
    headers: {
      "Content-Type": "text/vcard; charset=utf-8",
      "Content-Disposition": `attachment; filename="${slug}.vcf"`,
    },
  });
}
