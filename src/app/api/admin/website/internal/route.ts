import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";

// Sets (or clears) the sc_internal cookie on THIS device so the owner's and
// their partner's own browsing is tagged internal and excluded from Website
// analytics. Admin-gated — only a site owner can mark a device internal.
export async function POST(req: NextRequest) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const on = body?.on !== false; // default true

  const res = NextResponse.json({ ok: true, internal: on });
  if (on) {
    res.cookies.set("sc_internal", "1", {
      maxAge: 400 * 24 * 60 * 60, // ~13 months (max a browser will keep)
      path: "/",
      sameSite: "lax",
      secure: true,
    });
  } else {
    res.cookies.set("sc_internal", "", { maxAge: 0, path: "/" });
  }
  return res;
}
