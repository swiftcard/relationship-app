import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { leadRow, SHEET_HEADER } from "@/lib/crew/sources/sheets";
import { SupabaseStore } from "@/lib/crew/store-supabase";

// CSV download of a lead list (cold or office). Leads in GDPR-style regions
// are left out unless ?restricted=1. Downloading is not sending: nothing here
// contacts anyone.
export async function GET(req: NextRequest) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const list = req.nextUrl.searchParams.get("list") === "office" ? "office" : "cold";
  const withRestricted = req.nextUrl.searchParams.get("restricted") === "1";
  const rows = (await new SupabaseStore().listLeads(list, 20000)).filter((l) => withRestricted || !l.region_restricted);
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const csv = [SHEET_HEADER, ...rows.map(leadRow)].map((r) => r.map(esc).join(",")).join("\n");
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="swiftcard-${list}-leads-${new Date().toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
