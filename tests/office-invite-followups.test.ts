import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildInviteEmail, buildJoinSignInEmail, emailSafeImageUrl } from "@/lib/office-invite-email";
import { shortDate, relativeTime } from "@/lib/relative-time";
import { officeTeamMemberIds } from "@/lib/office-team-members";
import { DisplayClockProvider, useDisplayClock } from "@/components/DisplayClock";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
// Source with comments stripped, so a pin can't be satisfied by a comment.
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

// ── Follow-ups from driving every office-invite path live (2026-09-22) ──────

describe("the invite's sign-in email is ours, and works on any device", () => {
  const mail = buildJoinSignInEmail({
    officeName: "Meridian Bank",
    brandLogoUrl: "https://cdn.example.com/meridian.png",
    signInUrl: "https://swiftcard.me/auth/confirm?token_hash=abc&type=magiclink&next=%2Fjoin%2Ftok",
    inviteEmail: "dana@meridianbank.com",
  });

  it("says who it's from and what it's for — not Supabase's bare template", () => {
    expect(mail.subject).toBe("Your sign-in link to join Meridian Bank on SwiftCard");
    // Plain SwiftCard: a bank-named sender with a sign-in link is the phishing
    // template filters catch (owner report 2026-09-24).
    expect(mail.fromName).toBe("");
    expect(mail.html).toContain("finish joining your <strong>Meridian Bank</strong> team on SwiftCard");
    expect(mail.html).toContain("dana@meridianbank.com");
    expect(mail.html).toContain('<img src="https://cdn.example.com/meridian.png"');
    expect(mail.html).toContain("on any device");
  });

  it("links to /auth/confirm (server-verified), not a PKCE /auth/callback link", () => {
    expect(mail.html).toContain('href="https://swiftcard.me/auth/confirm?token_hash=abc&amp;type=magiclink&amp;next=%2Fjoin%2Ftok"');
    expect(mail.html).not.toContain("supabase.co");
  });

  it("reads fine with no company name", () => {
    const m = buildJoinSignInEmail({ officeName: null, signInUrl: "https://swiftcard.me/auth/confirm?x=1", inviteEmail: "a@b.com" });
    expect(m.subject).toBe("Your SwiftCard sign-in link");
    expect(m.html).toContain("finish joining your team on SwiftCard");
    expect(m.fromName).toBe("");
  });

  it("the route only ever mails the INVITED address, and never returns the link", () => {
    const route = code("src/app/api/join/sign-in-link/route.ts");
    // The address comes from the invite row; the request body carries only the token.
    expect(route).toMatch(/const email = \(invite\?\.invite_email as string \| null\)/);
    expect(route).toContain("to: email,");
    expect(route).not.toMatch(/body\??\.email/);
    // Only the pending, unexpired invite of a still-paying office.
    expect(route).toContain('invite.status === "pending"');
    expect(route).toContain("isInviteExpired(");
    expect(route).toContain('owner?.plan === "enterprise"');
    // Rate-limited per invite and per IP.
    expect(route).toContain("join-link:${token}");
    expect(route).toContain("join-link-ip:${ip}");
    // The sign-in URL goes into the email only.
    expect(route).toMatch(/return NextResponse\.json\(\{ ok: true \}\)/);
    expect(route).toContain("${APP_URL}/auth/confirm?token_hash=");
  });

  it("the join page asks our route, not Supabase's signInWithOtp", () => {
    const s = code("src/components/JoinSignIn.tsx");
    expect(s).toContain('fetch("/api/join/sign-in-link"');
    expect(s).not.toContain("signInWithOtp");
  });
});

describe("email logos a mail client can actually show", () => {
  it("SVG, data: and non-http URLs are not email-safe", () => {
    expect(emailSafeImageUrl("https://swiftcard.me/showcase/meridian-bank.svg")).toBeNull();
    expect(emailSafeImageUrl("https://x.com/logo.SVG?v=2")).toBeNull();
    expect(emailSafeImageUrl("data:image/png;base64,AAAA")).toBeNull();
    expect(emailSafeImageUrl("javascript:alert(1)")).toBeNull();
    expect(emailSafeImageUrl("https://cdn.example.com/logo.png")).toBe("https://cdn.example.com/logo.png");
    expect(emailSafeImageUrl("https://img.logo.dev/acme.com?token=x")).toBe("https://img.logo.dev/acme.com?token=x");
  });

  it("an SVG brand logo falls back to the company-name header in the invite", () => {
    const html = buildInviteEmail({
      ownerFirst: "Alex", officeName: "Meridian Bank", inviteUrl: "https://swiftcard.me/join/t",
      brandLogoUrl: "https://swiftcard.me/showcase/meridian-bank.svg",
    }).html;
    expect(html).not.toContain(".svg");
    expect(html).toContain('<span style="font-size:20px;font-weight:800;color:#111827;">Meridian Bank</span>');
  });
});

describe("admin console times hydrate cleanly (React error 418)", () => {
  it("shortDate formats in the zone it is given", () => {
    // 00:29 UTC on Sep 23 is still Sep 22 in New York — the exact mismatch
    // the Team list threw every evening.
    expect(shortDate("2026-09-23T00:29:00Z", "UTC")).toBe("Sep 23");
    expect(shortDate("2026-09-23T00:29:00Z", "America/New_York")).toBe("Sep 22");
  });

  it("relativeTime is deterministic for a given now", () => {
    const now = Date.parse("2026-09-23T01:00:00Z");
    expect(relativeTime("2026-09-23T00:29:00Z", now)).toBe("31 minutes ago");
  });

  it("on the server (and so while hydrating) the clock is the provider's time and zone", () => {
    const at = "2026-09-23T00:29:00Z";
    function Probe() {
      const c = useDisplayClock();
      return createElement("span", null, `${shortDate(at, c.timeZone)}|${relativeTime(at, c.now)}`);
    }
    const html = renderToString(
      createElement(DisplayClockProvider, { now: Date.parse("2026-09-23T01:00:00Z"), timeZone: "America/New_York" }, createElement(Probe)),
    );
    expect(html).toContain("Sep 22|31 minutes ago");
    // No provider: a fixed, matching fallback rather than each side's own clock.
    expect(renderToString(createElement(Probe))).toContain("Sep 23|Just now");
  });

  it("the console's client tables format times from the display clock", () => {
    for (const f of [
      "src/components/office/TeamList.tsx",
      "src/app/office/admin/leads/LeadsTable.tsx",
      "src/components/office/ContactDrawer.tsx",
      "src/app/office/admin/analytics/EmployeeAnalyticsTable.tsx",
    ]) {
      const s = code(f);
      expect(s, f).toContain("useDisplayClock()");
      // Every relativeTime/shortDate call is given the clock — none reads its own.
      expect(s.match(/relativeTime\([^)]*\)/g)!.every((c) => c.includes("clock.now")), f).toBe(true);
      for (const c of s.match(/shortDate\([^)]*\)/g) ?? []) expect(c, f).toContain("clock.timeZone");
    }
  });

  it("the admin layout provides the server's time and the viewer's zone", () => {
    const s = code("src/app/office/admin/layout.tsx");
    expect(s).toContain("<DisplayClockProvider now={renderedAt} timeZone={viewerTimeZone}>");
    expect(s).toContain("const renderedAt = Date.now();");
    expect(s).toContain('const viewerTimeZone = safeTimeZone((await cookies()).get("sc_tz")?.value);');
    expect(s).toContain("<TimezoneCookie />");
    const clock = code("src/components/DisplayClock.tsx");
    // Server AND hydration read the server snapshot (0 = use the provider's values).
    expect(clock).toContain("useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)");
    expect(clock).toContain("const getServerSnapshot = () => 0;");
  });
});

describe("the tour waits for a page that is still loading", () => {
  it("doesn't spend its missing-anchor budget while the route skeleton is up", () => {
    const s = code("src/components/GuidedTour.tsx");
    expect(s).toContain(`document.querySelector('main[aria-busy="true"]')`);
    expect(s).toMatch(/if \(routeStillLoading\(\) && \+\+loadingWaits < LOADING_WAITS\)/);
  });

  it("the route skeletons still mark themselves busy", () => {
    expect(read("src/components/PortalSkeleton.tsx")).toMatch(/<main[^>]*aria-busy="true"/);
    expect(read("src/components/PickerSkeleton.tsx")).toMatch(/<main[\s\S]{0,200}aria-busy="true"/);
  });
});

describe("promo codes never go to team members", () => {
  // A minimal PostgREST stand-in: from(table).select().eq().not().range().
  function fakeAdmin(tables: Record<string, Record<string, unknown>[]>) {
    return {
      from(table: string) {
        let rows = tables[table] ?? [];
        const q = {
          select: () => q,
          eq: (col: string, v: unknown) => { rows = rows.filter((r) => r[col] === v); return q; },
          not: (col: string) => { rows = rows.filter((r) => r[col] != null); return q; },
          range: async (a: number, b: number) => ({ data: rows.slice(a, b + 1), error: null }),
        };
        return q;
      },
    } as unknown as Parameters<typeof officeTeamMemberIds>[0];
  }

  it("is every active member of an office they don't own — owners stay customers", async () => {
    const ids = await officeTeamMemberIds(fakeAdmin({
      offices: [{ owner_id: "owner-1" }],
      office_members: [
        { user_id: "m1", status: "active" },
        { user_id: "owner-1", status: "active" }, // an owner with a member row
        { user_id: "m2", status: "suspended" },   // lapsed team → free again
        { user_id: null, status: "active" },      // unaccepted invite
      ],
    }));
    expect([...ids]).toEqual(["m1"]);
  });

  it("pages past PostgREST's 1,000-row cap", async () => {
    const members = Array.from({ length: 2500 }, (_, i) => ({ user_id: `u${i}`, status: "active" }));
    const ids = await officeTeamMemberIds(fakeAdmin({ offices: [], office_members: members }));
    expect(ids.size).toBe(2500);
  });

  it("the promo sender filters them out and sends to the filtered list only", () => {
    const s = code("src/app/api/admin/promo-codes/send/route.ts");
    expect(s).toContain("await officeTeamMemberIds(admin)");
    expect(s).toContain("const notMembers = (profiles ?? []).filter((p) => !teamMembers.has(p.id as string));");
    expect(s).toContain("const targets = notMembers.filter((p) => !alreadyHasIt(p.plan as string | null));");
    expect(s).toContain("for (const profile of targets)");
    expect(s).not.toMatch(/for \(const profile of profiles/);
  });
});
