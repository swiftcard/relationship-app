import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { buildDirectory } from "@/lib/admin-data/directory";

// Full user directory for the admin Users page (lib/admin-data/directory):
// `users` = real customers, `internal` = our own and QA's accounts
// (Users › Internal & test), `closed` = accounts closed in the last 30 days,
// with why, in the person's own words (Users › Closed accounts). Every count
// is paged or aggregated in the database and matches what the customer sees.
export async function GET() {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { users, internal, closed } = await buildDirectory();
  return NextResponse.json({ users, internal, closed });
}
