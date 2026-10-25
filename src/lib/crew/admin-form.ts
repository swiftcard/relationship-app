import { NextResponse, type NextRequest } from "next/server";

// The Agents tab's buttons are plain <form method="post"> posts to route
// handlers, so every one works before (and without) JavaScript. Each answers
// with a 303 back to where the button was, carrying a short message to show
// (red when `extra` carries ERR), and an optional #anchor so the page lands
// where the button was.
//
// `tab` is a tab of /admin/crew ("lobby", "replies", "settings"…), or
// "tasks:<filter>" for the task list, or "agent:<id>" for one agent's page.
export const ERR = { tone: "err" } as const;

export function backToTab(req: NextRequest, tab: string, msg: string, extra?: Record<string, string>, hash?: string): NextResponse {
  const agent = /^agent:([a-z0-9-]+)$/.exec(tab);
  const tasks = /^tasks(?::([a-z]+))?$/.exec(tab);
  const u = new URL(agent ? `/admin/crew/agent/${agent[1]}` : "/admin/crew", req.url);
  if (tasks) {
    u.searchParams.set("tab", "tasks");
    if (tasks[1]) u.searchParams.set("filter", tasks[1]);
  } else if (!agent) u.searchParams.set("tab", tab);
  if (msg) u.searchParams.set("msg", msg.slice(0, 160));
  for (const [k, v] of Object.entries(extra ?? {})) u.searchParams.set(k, v);
  if (hash && /^[a-z0-9-]+$/i.test(hash)) u.hash = hash;
  return NextResponse.redirect(u, 303);
}

export function field(form: FormData, key: string): string {
  const v = form.get(key);
  return typeof v === "string" ? v.trim() : "";
}
