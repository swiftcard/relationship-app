import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// ── The site admin's structure, pinned (owner, 2026-10-27) ──────────────────
//
// "I don't like how it's dark. I want it to be light." and "everything is all
// over the place … I really just want everything to be very organized and also
// visually organized." The layout facts are measured in
// tests/render/admin-console.test.ts; this pins the decisions that a quiet
// edit could undo without any layout changing first: the console is light on
// every device, every section lives in one grouped nav, and the pieces every
// page is built from don't grow raw colours.

const read = (p: string) => readFileSync(p, "utf8");

describe("the site admin is always light", () => {
  it("the shell joins the app's theme system and holds the light theme while open", () => {
    const shell = read("src/app/admin/AdminShell.tsx");
    expect(shell).toMatch(/className="sc-app sc-admin /);
    expect(shell).toContain("<ForceLightTheme />");
    expect(read("src/app/admin/layout.tsx")).toContain('import "./admin.css";');
  });

  it("the boot script forces light before first paint on /admin, and only there", () => {
    const boot = read("src/app/layout.tsx");
    expect(boot).toContain("location.pathname.indexOf('/admin')===0");
    // "Starts with" — /office/admin keeps the person's own theme.
    expect(boot).not.toContain("indexOf('/office/admin')");
  });
});

describe("one grouped navigation", () => {
  const nav = read("src/app/admin/AdminNav.tsx");

  it("groups the sections into Business and Tools", () => {
    expect(nav).toContain('title: "Business"');
    expect(nav).toContain('title: "Tools"');
    for (const label of ["Overview", "Notifications", "Users", "Company Analytics", "Website", "Marketing", "Agents", "Sandbox"]) {
      expect(nav, label).toContain(`label: "${label}"`);
    }
  });

  it("the phone menu works before hydration (a <details>, not a JS toggle)", () => {
    expect(nav).toMatch(/<details ref=\{menu\} className="adm-menu">/);
    // The native shell keeps the bar below the status bar with the Office fix.
    expect(nav).toContain("sc-office-header");
  });
});

describe("Referrals and Retention are tabs of Company Analytics, not pages", () => {
  // Owner, 2026-10-27: "Why is there one page for referrals and one page for
  // retention? That doesn't make sense."
  const nav = read("src/app/admin/AdminNav.tsx");
  const tabs = read("src/app/admin/analytics/tabs.ts");

  it("the nav has no top-level Referrals or Retention", () => {
    expect(nav).not.toContain('href: "/admin/referrals"');
    expect(nav).not.toContain('href: "/admin/retention"');
  });

  it("Company Analytics has its seven tabs, in reading order", () => {
    const keys = [...tabs.matchAll(/key: "([a-z]+)"/g)].map((m) => m[1]);
    expect(keys).toEqual(["growth", "revenue", "funnel", "engagement", "retention", "referrals", "data"]);
  });

  it("the old addresses redirect into the tabs, behind the admin check", () => {
    for (const [file, tab] of [["src/app/admin/retention/page.tsx", "retention"], ["src/app/admin/referrals/page.tsx", "referrals"]] as const) {
      const src = read(file);
      expect(src).toContain("if (!(await requireAdmin())) notFound();");
      expect(src).toContain(`redirect("/admin/analytics?tab=${tab}")`);
      expect(src.indexOf("requireAdmin()")).toBeLessThan(src.indexOf("redirect("));
    }
  });

  it("the Company Analytics page checks the admin itself before reading retention", () => {
    const page = read("src/app/admin/analytics/page.tsx");
    expect(page.indexOf("if (!(await requireAdmin())) notFound();")).toBeGreaterThan(-1);
    expect(page.indexOf("requireAdmin()")).toBeLessThan(page.indexOf("retentionFunnel("));
  });

  it("reasons are shown in the words the person picked, not as ids", () => {
    const tab = read("src/app/admin/analytics/RetentionTab.tsx");
    expect(tab).toContain("reasonText(r.reason, r.plan)");
    expect(tab).toContain("reasonText(r.reason)");
  });
});

describe("Users › Closed accounts: who left, and why in their words", () => {
  // Owner, 2026-10-27: "we should also have Closed Accounts so we know which
  // users close their accounts. When we click on that user, it'll tell us why
  // they closed the account: all the description they put in."
  const users = read("src/app/admin/users/UsersClient.tsx");
  const list = read("src/app/api/admin/users/route.ts");
  const directory = read("src/lib/admin-data/directory.ts");
  const one = read("src/app/api/admin/users/[id]/route.ts");
  const detail = read("src/app/admin/users/[id]/UserDetailClient.tsx");

  it("the Users page has All, Free, Pro, Office, Closed accounts and Internal & test", () => {
    // Tab entries carry a count; the Create card form's fields don't.
    const keys = [...users.matchAll(/\{ key: "([a-z]+)", label: "([^"]+)", count:/g)].map((m) => `${m[1]}:${m[2]}`);
    expect(keys).toEqual(["all:All", "free:Free", "pro:Pro", "office:Office", "closed:Closed accounts", "internal:Internal & test"]);
  });

  it("the list API returns closed accounts with the reason in words and the plan they had", () => {
    expect(directory).toContain("reason_text: reasonText(del.reason, plan)");
    expect(directory).toContain("const plan = del.plan ??");
    expect(list).toContain("return NextResponse.json({ users, internal, closed });");
    // QA's throwaway accounts are not customers, so never "closed accounts".
    expect(directory).toContain('.filter((a) => a.deleted && a.kind !== "test")');
  });

  it("a user's page says why they left, or nearly did", () => {
    expect(one).toContain("saved_by_text: savedByText(ret.savedBy)");
    // Every earlier answer, each in words, not only the last one.
    expect(one).toContain("reason_text: reasonText(s.reason, s.plan)");
    expect(detail).toContain("{leaving && <LeavingCallout leaving={leaving} />}");
  });

  it("one list per page: a single plan dropdown per person, at every width", () => {
    expect(users.split("aria-label={`Change ${who}'s plan`}").length - 1).toBe(1);
  });
});

describe("Website reads as one page per question", () => {
  // Owner, 2026-10-27: "That whole page just looks like a mishmash."
  it("has Traffic, Pages, Sources, Audience and Settings, in that order", () => {
    const keys = [...read("src/app/admin/website/tabs.ts").matchAll(/key: "([a-z]+)"/g)].map((m) => m[1]);
    expect(keys).toEqual(["traffic", "pages", "sources", "audience", "settings"]);
  });

  it("names pages, sources and countries the way people say them", () => {
    const client = read("src/app/admin/website/WebsiteAnalyticsClient.tsx");
    for (const fn of ["pageName", "countryName"]) expect(client).toContain(fn);
    // Sources are grouped by name where they're counted, once per visit.
    expect(read("src/lib/admin-data/website.ts")).toContain("referrerName(host)");
  });

  it("still talks to the same endpoints (the data pass changes the numbers, not this page)", () => {
    const client = read("src/app/admin/website/WebsiteAnalyticsClient.tsx");
    expect(client).toContain("fetch(`/api/admin/website?internal=${includeInternal ? \"1\" : \"0\"}`)");
    expect(client).toContain('fetch("/api/admin/website/internal"');
  });
});

describe("Website counts every visit, once, and only people (2026-10-28)", () => {
  // Owner: "website analytics is fake — make it accurate", and "make sure
  // 'include my team's visits' really works".
  const route = read("src/app/api/admin/website/route.ts");
  const ingest = read("src/app/api/site-view/route.ts");
  const tracker = read("src/components/SiteAnalytics.tsx");

  it("reads every row of the 30 days, team rows too, and never a capped sample", () => {
    expect(route).toContain("rows = await paged<PageviewRow>(");
    expect(route).not.toMatch(/\.limit\(/);
    // The switch is applied in the counting, after the read, so it changes
    // the totals by exactly the team's rows.
    expect(route).not.toContain('.eq("is_internal", false)');
    expect(route).toContain("summarizeWebsite(rows, { includeInternal, now })");
  });

  it("the header says what the switch did", () => {
    expect(read("src/app/admin/website/WebsiteAnalyticsClient.tsx")).toContain("{data && <TeamLine d={data} />}");
  });

  it("the tracker counts the pages a visit goes on to, skips app pages, and waits for a person", () => {
    for (const p of ['"/about"', '"/faq"', '"/press"', '"/download"', '"/for"', '"/login"', '"/cards/new"']) expect(tracker, p).toContain(p);
    for (const p of ['"/upgrade"', '"/account-deleted"', '"/unsubscribe"']) expect(tracker, p).not.toContain(p);
    expect(tracker).toContain("waitForHuman(() => cancelled, { dwellMs: SITE_DWELL_MS })");
    expect(tracker).toContain('classList.contains("native-app")');
    // A storage-blocked browser is its own visit, never the shared "nostore".
    expect(tracker).not.toContain('return "nostore"');
    // Only the page the browser loaded carries the referrer.
    expect(tracker).toContain("const referrer = atLoad ? document.referrer || null : null;");
  });

  it("the ingest keeps one id per person, refuses server racks, and knows our accounts signed out", () => {
    expect(ingest).toContain("resolveVisitIdentity(req,");
    expect(ingest).toContain("attachVisitIdentity(NextResponse.json({ ok: true, id }), identity)");
    expect(ingest).toContain('if (geo.isHosting) return NextResponse.json({ ok: true, skipped: "hosting" });');
    expect(ingest).toContain("await browserAccountIds(admin)");
    // Visible time only ever grows.
    expect(ingest).toContain(".or(`duration_ms.is.null,duration_ms.lt.${ms}`)");
  });
});

describe("Overview leads with what matters", () => {
  // Owner, 2026-10-27: "It does not show me the really important stuff."
  const page = read("src/app/admin/page.tsx");
  const client = read("src/app/admin/OverviewClient.tsx");

  it("checks the admin itself before reading who left and why", () => {
    expect(page).toContain("if (!(await requireAdmin())) notFound();");
    expect(page.indexOf("requireAdmin()")).toBeLessThan(page.indexOf("retentionFunnel("));
  });

  it("money and growth, then what needs a person, then the people", () => {
    const order = ["label=\"Monthly revenue\"", "Needs your attention", "Signups · last 30 days", "The journey · last 30 days", "Newest signups", "Recently closed"];
    const at = order.map((s) => client.indexOf(s));
    for (const [i, n] of at.entries()) expect(n, order[i]).toBeGreaterThan(-1);
    expect([...at].sort((x, y) => x - y)).toEqual(at);
  });

  it("each source loads on its own, so one failing never blanks the rest", () => {
    expect(client).toContain("Promise.all([");
    expect(client).toMatch(/async function getJson<T>[\s\S]*?catch \{\s*return null;/);
  });
});

describe("Company Analytics counts real customers and real money (2026-10-28)", () => {
  // Owner: "make sure that all the analytics are actually real and that
  // there's nothing fake".
  const route = read("src/app/api/admin/analytics/route.ts");

  it("customers only, and every number from a full read", () => {
    expect(route).toContain("const customers = customersOf(all);");
    expect(route).not.toMatch(/\.limit\(1000\)|\.limit\(5000\)/);
  });

  it("revenue comes from Stripe, never a hardcoded price × a count", () => {
    expect(route).toContain("const rev = await revenue(all);");
    // Code only — the header comment describes the old bug in words.
    const code = route.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toMatch(/PRO_PRICE|OFFICE_PRICE|4\.99|3\.99/);
  });

  it("the journey starts at the website's own visits and ends at money in from Stripe", () => {
    expect(route).toContain("d30.page_viewed = visits.d30;");
    expect(route).toContain("d30.checkout_completed = [...payingSince.values()]");
  });

  it("it checks itself: the headline numbers are recounted a second way", () => {
    expect(route).toContain("const numberCheck = await checkNumbers(admin, {");
  });

  it("Stripe's connection is checked against Stripe, and the site's health says whether Stripe answers", () => {
    const billing = read("src/lib/admin-data/billing.ts");
    for (const s of ["stripe.webhookEndpoints.list", "stripe.prices.retrieve", "REQUIRED_WEBHOOK_EVENTS", "Stripe and accounts agree"]) expect(billing).toContain(s);
    expect(read("src/app/api/health/route.ts")).toContain("stripe = await stripeHealth();");
  });
});

describe("Notifications: money, customers leaving, the agents (2026-10-28)", () => {
  // Owner: "a notification center in our admin page … for really important
  // things". Admin only: no email, no push.
  it("All, Money, Customers leaving, Agents, in that order", () => {
    const keys = [...read("src/app/admin/notifications/tabs.ts").matchAll(/key: "([a-z]+)"/g)].map((m) => m[1]);
    expect(keys).toEqual(["all", "money", "leaving", "agents"]);
  });

  it("the page checks the admin itself before reading anything", () => {
    const page = read("src/app/admin/notifications/page.tsx");
    expect(page.indexOf("if (!(await requireAdmin())) notFound();")).toBeGreaterThan(-1);
    expect(page.indexOf("requireAdmin()")).toBeLessThan(page.indexOf('from("admin_notifications")'));
  });

  it("the bell's count is read by the layout, on every admin page", () => {
    expect(read("src/app/admin/layout.tsx")).toContain("unread={await unreadNotifications()}");
    expect(read("src/app/admin/AdminNav.tsx")).toContain('{it.href === "/admin/notifications" && <UnreadCount n={unread} className="ml-auto" />}');
  });

  it("nothing in it emails or pushes", () => {
    for (const f of ["src/lib/admin-notify.ts", "src/lib/admin-notify-stripe.ts"]) {
      expect(read(f)).not.toMatch(/resend|sendPush|api.resend.com|web-push/i);
    }
  });

  it("a subscription is never called 'Paying' just for existing (it can be a trial or 100% off)", () => {
    const badges = read("src/app/admin/_ui/badges.tsx");
    expect(badges).toContain('label: "Billed · Stripe"');
    expect(badges).not.toMatch(/label: "Paying ·/);
  });

  it("Overview's attention list links to it", () => {
    expect(read("src/app/admin/OverviewClient.tsx")).toContain('action={<SeeAll href="/admin/notifications">Notifications</SeeAll>}');
  });
});

describe("the building blocks stay on the semantic palette", () => {
  it("no raw hex colour in any _ui component (they live in admin.css)", () => {
    const dir = "src/app/admin/_ui";
    for (const f of readdirSync(dir).filter((n) => n.endsWith(".tsx") || n.endsWith(".ts"))) {
      expect(read(join(dir, f)), `${f} carries a raw hex colour`).not.toMatch(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/);
    }
  });

  it("the chart palette is defined once, in admin.css", () => {
    const css = read("src/app/admin/admin.css");
    for (const token of ["--adm-series-1", "--adm-series-2", "--adm-plan-free", "--adm-plan-pro", "--adm-plan-office"]) {
      expect(css).toContain(`${token}:`);
    }
  });
});
