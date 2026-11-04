import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";

// ── Book a demo: the rules that must hold in the source ─────────────────────
// Owner, 2026-11-03: a Book a demo button on the website's pricing page, on the
// Office plan only; no double bookings; everything automated. These pin the
// pieces a behaviour test can't see.

const read = (p: string) => readFileSync(p, "utf8");
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("double booking is impossible in the database itself", () => {
  const sql = read("supabase/demo-bookings.sql");
  it("an exclusion constraint refuses overlapping confirmed demos", () => {
    expect(sql).toMatch(/constraint demo_no_overlap exclude using gist \(tstzrange\(starts_at, ends_at, '\[\)'\) with &&\) where \(status = 'confirmed'\)/);
  });
  it("the API turns that refusal into 'slot taken'", () => {
    expect(code("src/lib/demo/store.ts")).toContain('export const SLOT_TAKEN = "23P01";');
    expect(code("src/lib/demo/service.ts")).toContain('if (saved.code === SLOT_TAKEN) return { ok: false, error: "slot_taken" };');
  });
  it("server-only tables: RLS on, no grants to the public keys", () => {
    for (const t of ["demo_bookings", "demo_messages"]) {
      expect(sql).toContain(`alter table public.${t} enable row level security;`);
      expect(sql).toContain(`revoke all on public.${t} from anon, authenticated;`);
    }
    expect(sql).not.toMatch(/create policy/i);
  });
  it("the clock runs every 5 minutes from pg_cron, with the secret in Vault (never in the file)", () => {
    expect(sql).toContain("select cron.schedule('demo-tick', '*/5 * * * *',");
    expect(sql).toContain("clock_call('demo-tick', 'https://swiftcard.me/api/demo/tick', 'demo_tick_secret', 'POST', 60000)");
    expect(sql).not.toMatch(/vault\.create_secret|Bearer [A-Za-z0-9]/);
  });
  it("'canceled', American spelling, everywhere (the copy test reads every string)", () => {
    for (const f of ["supabase/demo-bookings.sql", "src/lib/demo/store.ts", "src/lib/demo/service.ts", "src/lib/demo/emails.ts", "src/components/demo/DemoManage.tsx"]) {
      expect(read(f), f).not.toMatch(/cancelled/i);
    }
  });
});

describe("never in the shared plan cards", () => {
  it("the shared plan cards (also drawn inside the iPhone app) have no demo button", () => {
    for (const f of ["src/components/PlanTierCards.tsx", "src/components/PlanCards.tsx", "src/components/MobilePlanTabs.tsx", "src/app/upgrade/UpgradeClient.tsx"]) {
      expect(code(f), f).not.toMatch(/BookDemoButton|Book a demo|\/demo\b/);
    }
  });
  it("the button is a real link to /demo, so it works before the page hydrates", () => {
    const btn = code("src/components/demo/BookDemoButton.tsx");
    expect(btn).toMatch(/<Link\s+href="\/demo"/);
    expect(btn).toContain("e.preventDefault();");
  });
});

describe("never inside the iPhone or Android app", () => {
  it("the proxy sends the app away from /demo before any HTML, on the exact path", () => {
    const proxy = code("src/proxy.ts");
    expect(proxy).toContain('request.nextUrl.pathname === "/pricing" || request.nextUrl.pathname === "/demo"');
    expect(proxy).toMatch(/"\/demo",\n\s*"\/pricing",\n\s*\],/);
    // Not even in a comment: tests/audit-round-19-security reads every quoted
    // "/x/:path*" in the proxy as a guarded section.
    expect(read("src/proxy.ts")).not.toContain('"/demo/:path*"');
  });
  it("/demo and /demo/manage render nothing in the app shell", () => {
    for (const f of ["src/app/demo/page.tsx", "src/app/demo/manage/page.tsx"]) {
      const src = code(f);
      expect(src, f).toContain("if (detectNativeApp()) router.replace(\"/dashboard\");");
      expect(src, f).toContain("if (native) return null;");
    }
  });
  it("the knowledge base never offers it to the app", () => {
    const kb = read("src/lib/knowledge/docs/marketing-site.ts");
    const doc = kb.slice(kb.indexOf('id: "book-a-demo"'));
    expect(doc).toContain("commerce: true,");
  });
});

describe("the private reschedule link stays private", () => {
  it("the token rides after the #, so no server, log or analytics ever sees it", () => {
    expect(code("src/lib/demo/token.ts")).toContain("return `${APP_URL}/demo/manage${action ? `?a=${action}` : \"\"}#${token}`;");
    expect(existsSync("src/app/demo/manage/[token]")).toBe(false);
    const api = code("src/app/api/demo/manage/route.ts");
    expect(api).toContain("export async function POST");
    expect(api).not.toContain("export async function GET");
  });
  it("only a hash and an encrypted copy are stored", () => {
    expect(code("src/lib/demo/service.ts")).toContain("manage_token_hash: tok.hash, manage_token_enc: tok.enc");
    expect(code("src/lib/demo/service.ts")).not.toMatch(/manage_token: /);
  });
  it("site analytics counts /demo, never /demo/manage", () => {
    // read(), not code(): a "/for/*" in that file's comments looks like a block comment.
    const a = read("src/components/SiteAnalytics.tsx");
    expect(a).toContain('const TRACK_EXACT = ["/demo"];');
    const prefixes = a.slice(a.indexOf("const TRACK_PREFIXES"), a.indexOf("];", a.indexOf("const TRACK_PREFIXES")));
    expect(prefixes).not.toContain('"/demo"');
  });
  it("opening the manage page changes nothing until a person is really there", () => {
    const m = code("src/components/demo/DemoManage.tsx");
    expect(m).toContain("waitForHuman(() => gone)");
  });
});

describe("the calendar lands on the right account", () => {
  it("connect refuses any Google account but DEMO_CALENDAR_EMAIL (hello@swiftcard.me)", () => {
    const o = code("src/lib/agent-connect-oauth.ts");
    expect(o).toContain("if (!email || email !== expected) throw new Error(");
    expect(read("src/lib/demo/config.ts")).toContain('export const DEMO_CALENDAR_EMAIL_DEFAULT = "hello@swiftcard.me";');
  });
  it("the calendar stays out of the agents' connections", () => {
    const c = code("src/lib/agent-connections.ts");
    expect(c).toContain('export const AGENT_PROVIDERS: AgentProvider[] = ["x", "meta", "youtube", "linkedin", "pinterest"];');
    expect(c).toContain('export type OwnerConnectProvider = AgentProvider | "google_calendar";');
  });
  it("Google sends the real invitation, with a Meet link, and a retry can't make a second event", () => {
    const g = code("src/lib/demo/google-calendar.ts");
    expect(g).toContain("events?conferenceDataVersion=1&sendUpdates=all");
    expect(g).toContain('conferenceSolutionKey: { type: "hangoutsMeet" }');
    expect(g).toContain("return `scdemo${bookingId.replace(/-/g, \"\").toLowerCase()}`;");
  });
});

describe("the pre-hydration rule (AGENTS.md)", () => {
  it("the details form posts, so an email and phone never land in a URL", () => {
    expect(code("src/components/demo/DemoBookingFlow.tsx")).toContain('<form id="demo-details" method="post"');
  });
  it("no mount animation on the [role=dialog] element itself", () => {
    const d = code("src/components/demo/DemoBookingDialog.tsx");
    const start = d.indexOf("ref={panel}");
    const dialogTag = d.slice(start, d.indexOf(">\n", start));
    expect(dialogTag).toContain('role="dialog"');
    expect(dialogTag).not.toMatch(/transition|animate-/);
  });
});
