import { NextRequest, NextResponse } from "next/server";
import { resolveDownloadUserId } from "@/lib/download-auth";
import { requireOfficeCapability } from "@/lib/office-roles";
import { getAllOfficeLeads } from "@/lib/office-leads";
import { FOLLOW_UP_COPY } from "@/lib/lead-followup";

// GET /api/office/leads/export → every lead the office owns, as CSV.
//
// The Leads tab can only show a page at a time, and a fifteen-person team at
// one trade show clears a page easily. Without this the office had no way to
// get at the rest at all: there was no export anywhere in the admin console,
// and /api/leads/export is scoped to one person's own cards.
//
// EVERY lead, not a capped slice — getAllOfficeLeads pages through. An export
// that silently stops is worse than no export, because nobody can tell.
export async function GET(req: NextRequest) {
  // The session, or — in the iOS app, where the file opens in the system
  // browser with no session — a 60-second token minted for exactly this path
  // (lib/download-token), the same as the Analytics export.
  const userId = await resolveDownloadUserId(req, "/api/office/leads/export");
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // The same capability the Leads tab is gated on, which also re-checks that
  // the owner is still on a paid Office plan.
  const ctx = await requireOfficeCapability(userId, "view_org_analytics");
  if (!ctx) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const leads = await getAllOfficeLeads(ctx.officeId).catch(() => null);
  if (!leads) {
    return NextResponse.json({ error: "Couldn't build the export. Please try again." }, { status: 500 });
  }

  // Identical escaping to the personal export: prefix a leading =, +, -, @,
  // tab or CR with a quote before quoting, so a lead field — all of which are
  // typed by whoever filled in the public form — cannot be run as a formula
  // when the file is opened in Excel or Sheets.
  const esc = (v: string | null | undefined) => {
    const s = v ?? "";
    const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
    return `"${safe.replace(/"/g, '""')}"`;
  };

  const rows = leads.map((l) =>
    [
      esc(l.name),
      esc(l.email),
      esc(l.phone),
      // The PERSON who captured it, never the raw card slug — the same rule
      // the table follows, and the column an office actually wants.
      esc(l.capturedBy),
      // The label the admin sees in the UI, not a stored enum, so the file and
      // the screen agree. It is the contact's follow-up state — derived from
      // what their automations are doing — which is what replaced the old CRM
      // status nothing in the product could set (lib/lead-followup.ts).
      esc(FOLLOW_UP_COPY[l.followUp].label),
      esc(new Date(l.created_at).toISOString().slice(0, 10)),
    ].join(","),
  );

  const csv = ["Name,Email,Phone,Captured by,Follow-up,Date added", ...rows].join("\n");
  const stamp = new Date().toISOString().slice(0, 10);

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="swiftcard-team-contacts-${stamp}.csv"`,
      // Never cached: it is a snapshot of live customer data.
      "Cache-Control": "no-store",
    },
  });
}
