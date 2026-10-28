import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { buildDirectory } from "@/lib/admin-data/directory";
import { nyDayKey } from "@/lib/admin-data/time";

// GET /api/admin/users/export — the customer directory as a CSV download, from
// the same rows as the Users page (lib/admin-data/directory), so the file and
// the page always agree: real customers only, names as people typed them,
// contacts without the sample contact, card and Swift Links views apart.

// RFC 4180 field escaping — quote when needed, double internal quotes.
// ALSO neutralizes spreadsheet formula injection: a user-controlled name like
// `=HYPERLINK(...)` or `=cmd|...` would otherwise execute when an admin opens
// the export in Excel/Sheets. A leading ' makes Excel treat it as text.
function csv(v: unknown): string {
  let s = String(v ?? "");
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function GET() {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { users } = await buildDirectory();
  const header = ["email", "name", "company", "plan", "billed_through", "plan_expires_at", "signup_source", "referral_code", "cards", "contacts", "card_views", "swift_links_views", "signed_up"];
  const lines = [header.join(",")];
  for (const u of users) {
    lines.push([
      csv(u.email), csv(u.name), csv(u.company),
      csv(u.effective_plan === "enterprise" ? "office" : u.effective_plan), csv(u.billing.source),
      csv(u.plan_expires_at ?? ""), csv(u.signup_source ?? ""), csv(u.referral_code ?? ""),
      csv(u.card_count), csv(u.lead_count), csv(u.view_count), csv(u.link_view_count),
      csv(nyDayKey(u.created_at)),
    ].join(","));
  }

  return new NextResponse(lines.join("\r\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="swiftcard-users-${nyDayKey(Date.now())}.csv"`,
    },
  });
}
