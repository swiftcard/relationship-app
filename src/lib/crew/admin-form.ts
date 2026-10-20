import { NextResponse, type NextRequest } from "next/server";

// The Agents tab's buttons are plain <form method="post"> posts to route
// handlers, so every one works before (and without) JavaScript. Each answers
// with a 303 back to the tab, carrying a short message to show.
export function backToTab(req: NextRequest, tab: string, msg: string, extra?: Record<string, string>): NextResponse {
  const u = new URL("/admin/crew", req.url);
  u.searchParams.set("tab", tab);
  if (msg) u.searchParams.set("msg", msg.slice(0, 160));
  for (const [k, v] of Object.entries(extra ?? {})) u.searchParams.set(k, v);
  return NextResponse.redirect(u, 303);
}

export function field(form: FormData, key: string): string {
  const v = form.get(key);
  return typeof v === "string" ? v.trim() : "";
}
