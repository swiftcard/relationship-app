import { NextRequest, NextResponse } from "next/server";
import { resolveDownloadUserId } from "@/lib/download-auth";
import { isRateLimited } from "@/lib/rate-limit";
import { getAdminSupabase } from "@/lib/supabase-admin";

import { isPaidProfile } from "@/lib/effective-plan";

export async function GET(req: NextRequest) {
  // Session OR a signed ?dl= token — the iOS shell opens this in the system
  // browser, which does not carry the webview's session cookie.
  const userId = await resolveDownloadUserId(req, "/api/leads/export");
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // Per-user throttle: authenticated but previously uncapped (cost/abuse guard).
  if (await isRateLimited(`leads-export:${userId}`, 10, 10 * 60 * 1000)) {
    return NextResponse.json({ error: "Too many requests — please wait a moment and try again." }, { status: 429 });
  }


  const admin = getAdminSupabase();
  const [{ data: profile }, { data: cards }] = await Promise.all([
    admin.from("profiles").select("username, plan, plan_expires_at, stripe_subscription_id, customization").eq("id", userId).single(),
    admin.from("cards").select("username").eq("user_id", userId),
  ]);
  if (!profile) return NextResponse.json({ error: "No profile" }, { status: 404 });

  // CSV export is a Pro/Office feature.
  if (!isPaidProfile(profile)) {
    return NextResponse.json(
      { code: "EXPORT_PRO_ONLY", error: "upgrade", message: "CSV export is a Pro feature. Upgrade to export your contacts.", upgrade: "/upgrade" },
      { status: 402 }
    );
  }

  // Every username this user owns (legacy profile + each card).
  const ownedUsernames = [profile.username, ...(cards ?? []).map((c) => c.username)].filter(Boolean) as string[];

  // If a specific card was requested and the user owns it, export just that card;
  // otherwise export across all of the user's cards.
  const requested = req.nextUrl.searchParams.get("username");
  const filterUsernames = requested && ownedUsernames.includes(requested) ? [requested] : ownedUsernames;

  const { data: leads } = await admin
    .from("leads")
    .select("name, email, phone, company, status, notes, follow_up_date, created_at")
    .in("card_owner", filterUsernames)
    .order("created_at", { ascending: false });

  // Prefixes a leading =, +, -, @, tab, or CR with a single quote before
  // quoting — otherwise a lead field (name/email/notes etc., all set by
  // whoever submitted the public lead form) can be interpreted as a formula
  // by Excel/Sheets when this CSV is opened (CSV/formula injection —
  // security review).
  function esc(v: string | null | undefined) {
    const s = v ?? "";
    const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
    return `"${safe.replace(/"/g, '""')}"`;
  }

  const rows = (leads ?? []).map((l) => [
    esc(l.name),
    esc(l.email),
    esc(l.phone),
    esc(l.company),
    esc(l.status || "new_contact"),
    esc(l.notes),
    esc(l.follow_up_date ? l.follow_up_date.slice(0, 10) : null),
    esc(new Date(l.created_at).toLocaleDateString()),
  ].join(","));

  const csv = ["Name,Email,Phone,Company,Status,Notes,Follow-up date,Date added", ...rows].join("\n");

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="swiftcard-leads.csv"`,
    },
  });
}
