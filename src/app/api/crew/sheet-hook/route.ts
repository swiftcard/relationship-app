import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/crew/env";
import { applyChange } from "@/lib/crew/sheets/apply";
import { ownerEditable } from "@/lib/crew/sheets/spec";
import { tabByName } from "@/lib/crew/sheets/tabs";
import { SupabaseStore } from "@/lib/crew/store-supabase";

// ── The Sheet's edit hook ───────────────────────────────────────────────────
// apps-script/SwiftCardLeads.gs posts here on every edit the owners make in
// the workbook (an installable onEdit trigger), so a reworded message takes
// effect within seconds instead of at the next 15-minute sync. Deleting a
// row (which means it was sent) is seen by the sync.
// Bearer CREW_SHEET_HOOK_SECRET, constant-time; a 404 until it exists. The
// body names the tab, the row's Key and the column header; the change goes
// through exactly the same code the sync uses (sheets/apply.ts), so the hook
// can do nothing the sync couldn't. The poll remains the fallback when the
// script isn't installed or a post is lost.

export const maxDuration = 60;
export const dynamic = "force-dynamic";

function authorized(header: string | null): boolean {
  const secret = env("CREW_SHEET_HOOK_SECRET");
  if (!secret) return false;
  const a = Buffer.from(header ?? "");
  const b = Buffer.from(`Bearer ${secret}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

type Body = { tab?: string; key?: string; header?: string; value?: string; editor?: string };

export async function POST(req: NextRequest) {
  if (!process.env.CREW_SHEET_HOOK_SECRET) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!authorized(req.headers.get("authorization"))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  const tab = tabByName(String(body.tab ?? ""));
  if (!tab) return NextResponse.json({ ok: false, message: "unknown tab" });
  const by = /^[^@\s]+@[^@\s]+$/.test(String(body.editor ?? "")) ? String(body.editor).toLowerCase() : "sheet";
  // Every refusal is decided before the database is touched.

  const col = tab.columns.find((c) => c.header === String(body.header ?? ""));
  if (!col) return NextResponse.json({ ok: false, message: "unknown column" });
  // The same rule as the sync: on the computed tabs only Status counts; notes and messages are edited on the agent's own tab.
  if (!ownerEditable(tab, col)) return NextResponse.json({ ok: false, message: col.kind === "status" || tab.layout === "rows" ? `${col.header} is written by the agent` : `Edit ${col.header} on the agent's own tab` });
  const key = String(body.key ?? "").trim();
  if (!/^[A-Z]-[a-f0-9]{8,12}$/.test(key)) return NextResponse.json({ ok: false, message: "no key on that row yet; the sync will pick it up" });
  const store = new SupabaseStore();
  if (!(await store.sheetsReady())) return NextResponse.json({ ok: false, message: "Run supabase/crew-sheets.sql first." });
  const r = await applyChange(store, { rowKey: key, column: col.key, value: String(body.value ?? ""), by }, new Date());
  return NextResponse.json({ ok: r.ok, message: r.message, ...(r.status ? { status: r.status } : {}) });
}
