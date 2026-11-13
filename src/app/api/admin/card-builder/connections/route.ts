import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { clearConnections, replaceConnections, setSetting } from "@/lib/prospect-preview/desk";
import { parseConnectionsCsv, readBackground } from "@/lib/prospect-preview/warm";

export const runtime = "nodejs";
export const maxDuration = 60;

// POST /api/admin/card-builder/connections   action = upload | background | clear
//
// The owner's own LinkedIn connections export (Connections.csv), for "warm
// path" flags on prospects. ADMIN ONLY, and private: the rows go into a table
// no browser key can read (RLS on, no policies), and the file itself is read
// here and never stored. Nothing here talks to LinkedIn.
//
//   upload      file = Connections.csv. Replaces the previous upload.
//   background  schools, employers: the owner's own, one per line
//   clear       removes every stored connection

const MAX_BYTES = 8 * 1024 * 1024;

export async function POST(req: NextRequest) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const origin = req.headers.get("origin");
  if (origin && new URL(origin).host !== req.nextUrl.host) return NextResponse.json({ error: "cross-site" }, { status: 403 });

  const form = await req.formData().catch(() => new FormData());
  const back = (params: Record<string, string>) => {
    const url = new URL("/admin/card-builder/connections", req.nextUrl.origin);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v.slice(0, 300));
    return NextResponse.redirect(url, 303);
  };

  switch (form.get("action")) {
    case "background": {
      const ok = await setSetting("owner_background", readBackground({ schools: form.get("schools"), employers: form.get("employers") }));
      return back(ok ? { done: "background" } : { error: "That didn't save. Try again in a minute." });
    }
    case "clear": {
      return back((await clearConnections()) ? { done: "cleared" } : { error: "That didn't work. Try again in a minute." });
    }
    default: {
      const file = form.get("file");
      if (!(file instanceof File) || !file.size) return back({ error: "Choose the Connections.csv file from your LinkedIn export." });
      if (file.size > MAX_BYTES) return back({ error: "That file is too big to be a connections export (8 MB at most)." });
      const parsed = parseConnectionsCsv(await file.text());
      if (!parsed.ok) return back({ error: parsed.error });
      const saved = await replaceConnections(parsed.rows);
      return saved === null ? back({ error: "The connections couldn't be saved. Try again in a minute." }) : back({ done: "uploaded", n: String(saved) });
    }
  }
}
