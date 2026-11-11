import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { NAV_GROUPS } from "@/app/admin/AdminNav";
import { RESERVED_SLUGS } from "@/lib/slug";
import { UNDOCUMENTED_ROUTES } from "@/lib/knowledge";
import { NOTIFICATION_KINDS } from "@/app/admin/notifications/tabs";
import { ADMIN_NOTIFICATION_KINDS } from "@/lib/admin-notify";

// ── Card Builder: the decisions a quiet edit could undo ─────────────────────
// Admin-only data, an unlisted page, a view pipeline that stays out of the
// customers' one, and a page that never sells. Source-level pins, like
// tests/crew-guards.test.ts; the behaviour is in the two tests beside this.

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");

describe("admin-only", () => {
  it("both tables have RLS on, no policies, and nothing granted to the browser's keys", () => {
    const sql = read("supabase/prospect-previews.sql");
    for (const t of ["prospect_previews", "prospect_preview_views"]) {
      expect(sql).toContain(`alter table public.${t} enable row level security;`);
      expect(sql).toContain(`revoke all on public.${t} from anon, authenticated;`);
    }
    expect(sql).not.toMatch(/create policy/i);
  });

  it("the SQL is safe to run twice and survives crew_leads not existing yet", () => {
    const sql = read("supabase/prospect-previews.sql");
    expect(sql).toMatch(/create table if not exists public\.prospect_previews/);
    expect(sql).toMatch(/create table if not exists public\.prospect_preview_views/);
    expect(sql).toContain("if to_regclass('public.crew_leads') is not null");
    expect(sql).toContain("expires_at      timestamptz not null default (now() + interval '14 days')");
    // The notification center accepts the new kind (and still the old ones).
    expect(sql).toContain("check (kind in ('money', 'leaving', 'agents', 'demos', 'prospects'))");
  });

  it("every admin route for it checks the admin first", () => {
    for (const f of ["src/app/api/admin/card-builder/route.ts", "src/app/api/admin/card-builder/[id]/route.ts", "src/app/api/admin/card-builder/alerts/route.ts"]) {
      const src = code(f);
      const body = src.slice(src.search(/export async function (GET|POST)/));
      expect(body.indexOf("requireAdmin()"), f).toBeGreaterThan(-1);
      expect(body.indexOf("requireAdmin()"), f).toBeLessThan(body.search(/formData\(\)|liveAlerts\(|ctx\.params/));
    }
  });

  it("both admin pages check the admin themselves (the layout is not the boundary)", () => {
    for (const f of ["src/app/admin/card-builder/page.tsx", "src/app/admin/card-builder/call/[id]/page.tsx"]) {
      const src = code(f);
      expect(src, f).toContain("if (!(await requireAdmin())) notFound();");
      expect(src.indexOf("requireAdmin()"), f).toBeLessThan(src.search(/listPreviews\(\)|getPreviewById\(/));
    }
  });

  it("is in the admin's navigation, under Tools", () => {
    const tools = NAV_GROUPS.find((g) => g.title === "Tools")!;
    expect(tools.items).toContainEqual({ href: "/admin/card-builder", label: "Card Builder", icon: "idCard" });
  });

  it("the assistants are told never to describe any of it to a customer", () => {
    for (const route of ["/admin/card-builder", "/admin/card-builder/call/[id]", "/p/[slug]"]) {
      expect(UNDOCUMENTED_ROUTES[route], route).toMatch(/never describe/i);
    }
  });
});

describe("the preview page is unlisted", () => {
  const page = read("src/app/p/[slug]/page.tsx");

  it("is noindex whether or not the preview exists, and shows no app banner", () => {
    expect(page).toContain("const hidden = { robots: { index: false, follow: false }, itunes: null } as const;");
    expect(page).toContain('if (!p) return { title: "SwiftCard", ...hidden };');
    expect(page.split("...hidden").length - 1).toBe(2);
  });

  it("404s when the preview is missing, paused or expired", () => {
    expect(page).toContain('return preview && previewState(preview) === "live" ? preview : null;');
    expect(page).toContain("if (!preview) notFound();");
    // Dynamic: a page cached past its expiry would outlive its link.
    expect(page).toContain('export const dynamic = "force-dynamic";');
  });

  it("so does its link-preview picture", () => {
    const og = read("src/app/p/[slug]/opengraph-image.tsx");
    expect(og).toContain('if (!preview || previewState(preview) !== "live") notFound();');
    expect(read("src/lib/prospect-preview/og.tsx")).toContain('"X-Robots-Tag": "noindex"');
  });

  it("the link preview shows the owner's name and logo, under a title that matches", () => {
    const og = read("src/lib/prospect-preview/og.tsx");
    expect(og).toContain("{p.owner_name}</div>");
    expect(og).toContain("const logo = await embedLogo(p.logo_url);");
    // The logo address is typed in by staff but fetched on a public route.
    expect(og).toContain('fetchVCardPhoto(url, "logo")');
    expect(og).not.toMatch(/\bfetch\(/);
    expect(page).toContain("const title = `${p.owner_name} · ${p.office_name}`;");
    // Named explicitly: a page that sets openGraph loses the automatic image.
    expect(page).toContain("/opengraph-image?v=${previewVersion(p)}");
  });

  it("is in no sitemap, and robots.txt doesn't hide the noindex from crawlers", () => {
    expect(read("src/app/sitemap.ts")).not.toMatch(/["'`/]p\/|prospect/);
    expect(read("src/app/robots.ts")).not.toMatch(/["'`]\/p\/?["'`]/);
  });

  it("'p' can never be someone's card address", () => {
    expect(RESERVED_SLUGS.has("p")).toBe(true);
  });
});

describe("the page shows the card and one button, and never sells", () => {
  const view = read("src/app/p/[slug]/PreviewView.tsx");

  it("has the owner's card, the team strip, the notification, the button and the credit", () => {
    expect(view).toContain("<Card data={ownerCard(preview)} />");
    expect(view).toContain("data-team-strip");
    expect(view).toContain("<Card data={memberCard(preview, m)} />");
    expect(view).toContain("data-mock-notification");
    expect(view).toContain("Claim your team&apos;s cards, 15-min setup call");
    expect(view).toContain("Preview made by SwiftCard.");
  });

  it("has exactly one link, and it goes to the calendar", () => {
    expect(view.split("<a\n").length - 1 + (view.split("<a ").length - 1)).toBe(1);
    expect(view).toContain("href={calendarUrl}");
    expect(view).not.toMatch(/<Link|<form|<button/);
    expect(read("src/app/p/[slug]/page.tsx")).toContain("process.env.PROSPECT_CALENDAR_URL");
  });

  it("no pricing, plans, feature list or sign-up", () => {
    const words = view.replace(/\{\/\*[\s\S]*?\*\/\}|\/\/.*$/gm, "");
    expect(words).not.toMatch(/\$\d|pric|per month|\/mo\b|free trial|sign ?up|log ?in|upgrade|\bpro\b|\bplan\b|features?\b/i);
  });

  it("the cards are pictures: their phone and email can't be tapped", () => {
    expect(view).toContain("<div inert ");
  });

  it("mounts none of the customers' card trackers or forms", () => {
    for (const f of ["src/app/p/[slug]/page.tsx", "src/app/p/[slug]/PreviewView.tsx", "src/app/p/[slug]/PreviewBeacon.tsx"]) {
      expect(read(f), f).not.toMatch(/CardEventTracker|SaveContactButton|LeadCaptureForm|SignupNudgeHost|ShareButton|api\/card-events/);
    }
  });
});

describe("its views stay out of the customers' view pipeline", () => {
  it("the page request records nothing: only the beacon does, after the gate", () => {
    const page = code("src/app/p/[slug]/page.tsx");
    expect(page).not.toMatch(/recordView|alertAdminsOfView|prospect_preview_views/);
    const beacon = read("src/app/p/[slug]/PreviewBeacon.tsx");
    expect(beacon).toContain("startRealViewGate(browserGateEnv(), () => {");
    expect(beacon.match(/"\/api\/[^"]*"/g)).toEqual(['"/api/p/view"']);
  });

  it("the beacon's route never touches card_views, the card-view recorder or its notifier", () => {
    for (const f of ["src/app/api/p/view/route.ts", "src/lib/prospect-preview/store.ts", "src/lib/prospect-preview/alert.ts"]) {
      const src = code(f);
      expect(src, f).not.toMatch(/card_views|card_events|@\/lib\/record-view|@\/lib\/visit-notify|notifyVisit|team-alerts|alertTeam/);
    }
  });

  it("and the customers' route knows nothing about previews", () => {
    expect(code("src/app/api/card-events/route.ts")).not.toMatch(/prospect/i);
  });

  it("answers a stranger the same thing whatever happened", () => {
    const route = code("src/app/api/p/view/route.ts");
    expect(route).toContain("const done = () => NextResponse.json({ ok: true });");
    expect(route).not.toMatch(/status:\s*(4|5)\d\d/);
    expect(route).toContain("isRateLimited(`p-view:${ip}:${slug}`");
  });
});

describe("the alert is hard to miss", () => {
  it("lands in the admin's notification center as its own kind", () => {
    expect(ADMIN_NOTIFICATION_KINDS.map((k) => k.key)).toContain("prospects");
    expect(NOTIFICATION_KINDS.has("prospects")).toBe(true);
    expect(read("src/lib/prospect-preview/alert.ts")).toContain('kind: "prospects", severity: "urgent"');
  });

  it("the banner is on every admin page, with the owner's name and a Call button", () => {
    expect(read("src/app/admin/AdminShell.tsx")).toContain("<ProspectAlertBanner />");
    const banner = read("src/app/admin/ProspectAlertBanner.tsx");
    expect(banner).toContain("{a.owner_name} is viewing their card");
    expect(banner).toContain("<a href={telHref(a.phone)}");
    expect(banner).toContain("Call {a.phone}");
  });

  it("the banner only asks the server while its tab is being looked at", () => {
    const banner = read("src/app/admin/ProspectAlertBanner.tsx");
    expect(banner).toContain('const onVisibility = () => (document.visibilityState === "visible" ? start() : stop());');
    expect(banner).toContain('document.removeEventListener("visibilitychange", onVisibility);');
    expect(banner).toContain("if (timer !== null) clearInterval(timer);");
  });

  it("the Call screen is one tap from the number", () => {
    const call = read("src/app/admin/card-builder/call/[id]/page.tsx");
    expect(call).toContain("<a href={telHref(p.phone)} data-call");
  });
});

describe("the files this depends on exist", () => {
  it.each([
    "src/app/p/[slug]/twitter-image.tsx",
    "src/app/admin/card-builder/CardBuilderView.tsx",
    "src/lib/prospect-preview/gate.ts",
    "src/lib/prospect-preview/real-view.ts",
  ])("%s", (f) => {
    expect(existsSync(join(process.cwd(), f))).toBe(true);
  });
});
