import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { csvCell } from "@/lib/csv-cell";
import { adoptGuestUploads, guestPathOf, purgeStaleGuestUploads, GUEST_UPLOAD_TTL_MS } from "@/lib/guest-uploads";

// ── Audit round 18 (2026-10-18): who may remove whom, files nobody owns, and
//    exports that stay where they belong ────────────────────────────────────
//
// SEC-09  An Office admin could remove a fellow admin or the billing admin.
// SEC-04  Files uploaded with no account stayed at public URLs forever, and a
//         guest file sharp couldn't read was stored raw (EXIF/GPS and all).
// SEC-18  The personal CSV could be cached, the team export had no rate limit,
//         and formula escaping missed a leading space and full-width ＝.

const read = (p: string) => readFileSync(p, "utf8");
const BASE = "https://x.supabase.co/storage/v1/object/public/card-uploads/";

describe("SEC-09: only the owner removes an admin or a billing admin", () => {
  const route = read("src/app/api/office/members/route.ts");

  it("reads the target's role and refuses an admin removing one", () => {
    expect(route).toContain('.select("user_id, status, invite_email, role")');
    expect(route).toContain('if (!ctx.isOwner && member.status !== "pending" && (member.role === "admin" || member.role === "billing_admin")) {');
  });

  it("before anything about the member is changed", () => {
    const guard = route.indexOf("if (!ctx.isOwner && member.status");
    expect(guard).toBeLessThan(route.indexOf('if (member.status === "pending") {'));
    expect(guard).toBeLessThan(route.indexOf("keepContactsWithOffice("));
  });
});

describe("SEC-04: guest files are adopted by a claimed card, and abandoned ones expire", () => {
  it("recognises only guest paths in this bucket", () => {
    expect(guestPathOf(`${BASE}guest/abc/photo-1.jpg`)).toBe("guest/abc/photo-1.jpg");
    expect(guestPathOf(`${BASE}user-1/photo-1.jpg`)).toBeNull();
    expect(guestPathOf(`${BASE}guest/../user-1/photo.jpg`)).toBeNull();
    expect(guestPathOf("https://example.com/guest/abc.jpg")).toBeNull();
  });

  it("a claimed card points at the account's own copies, however deep the URL sits", async () => {
    const copies: [string, string][] = [];
    const admin = {
      storage: {
        from: () => ({
          copy: async (from: string, to: string) => { copies.push([from, to]); return { error: null }; },
          getPublicUrl: (p: string) => ({ data: { publicUrl: `${BASE}${p}` } }),
        }),
      },
    };
    const insert = {
      logo_url: `${BASE}guest/abc/logo-1.png`,
      customization: { photoUrl: `${BASE}guest/abc/photo-1.jpg`, links: [{ image: `${BASE}guest/abc/photo-1.jpg` }], kept: `${BASE}u1/x.jpg` },
    };
    await adoptGuestUploads(admin as never, "u1", insert);
    expect(JSON.stringify(insert)).not.toContain("/guest/");
    expect(insert.customization.kept).toBe(`${BASE}u1/x.jpg`);
    expect(copies).toHaveLength(2); // the same file used twice is copied once
    expect(copies.every(([, to]) => to.startsWith("u1/adopted-"))).toBe(true);
  });

  it("the purge removes only guest files older than the limit", async () => {
    const NOW = Date.UTC(2026, 9, 18);
    const old = new Date(NOW - GUEST_UPLOAD_TTL_MS - 1000).toISOString();
    const fresh = new Date(NOW - 1000).toISOString();
    const removed: string[] = [];
    const store = {
      list: async (prefix: string) => {
        if (prefix === "guest") return { data: [{ name: "a" }, { name: "b" }], error: null };
        if (prefix === "guest/a") return { data: [{ name: "old.jpg", created_at: old }, { name: "new.jpg", created_at: fresh }], error: null };
        return { data: [{ name: "fresh.mp4", created_at: fresh }], error: null };
      },
      remove: vi.fn(async (paths: string[]) => { removed.push(...paths); return { error: null }; }),
    };
    expect(await purgeStaleGuestUploads({ storage: { from: () => store } } as never, NOW)).toBe(1);
    expect(removed).toEqual(["guest/a/old.jpg"]);
  });

  it("the claim adopts before it inserts; the cron purges; a guest file sharp can't read is refused", () => {
    const claim = read("src/app/api/drafts/claim/route.ts");
    expect(claim.indexOf("await adoptGuestUploads(admin, user.id, insert)")).toBeLessThan(claim.indexOf('await admin.from("cards").insert(insert)'));
    expect(read("src/app/api/reminders/route.ts")).toContain("guestUploadsPurged = await purgeStaleGuestUploads(supabase);");
    expect(read("src/app/api/upload/route.ts")).toContain(`if (!user) return NextResponse.json({ error: "We couldn't read that picture. Try a different photo." }, { status: 400 });`);
  });
});

describe("SEC-18: exports", () => {
  it("no cell a spreadsheet would run as a formula — leading space and full-width forms included", () => {
    for (const evil of ["=1+1", "+1", "-1", "@SUM(A1)", " =HYPERLINK(\"x\")", "\t=1", "＝1+1", "＠x"]) {
      expect(csvCell(evil).startsWith(`"'`), JSON.stringify(evil)).toBe(true);
    }
    expect(csvCell("Dana")).toBe('"Dana"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell(null)).toBe('""');
  });

  it("both exports use it; the personal one is never cached; the team one is rate limited", () => {
    const personal = read("src/app/api/leads/export/route.ts");
    const team = read("src/app/api/office/leads/export/route.ts");
    for (const src of [personal, team]) expect(src).toContain("const esc = csvCell;");
    expect(personal).toContain('"Cache-Control": "no-store",');
    expect(team).toContain("isRateLimited(`office-leads-export:${userId}`, 10, 10 * 60 * 1000)");
  });
});
