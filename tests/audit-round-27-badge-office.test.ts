import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// ── Audit round 27 (2026-10-18): the icon's number, dead card links, and
//    exports that answer in words ───────────────────────────────────────────
//
// N-03        The app set the iPhone icon from the 20 rows the bell holds: 67
//             became 20 on opening the app, then 67 again on the next push.
// F-OFFICE-09 The Team drawer offered View card / Copy link / QR for a card
//             that was offline — a QR to a page that opens nothing.
// F-OFFICE-10 An export over its rate limit showed raw JSON as the page.

const read = (p: string) => readFileSync(p, "utf8");

describe("N-03: the icon shows the true unread count", () => {
  it("the bell route sends the count every push uses, as a header", () => {
    const route = read("src/app/api/notifications/route.ts");
    expect(route).toContain("const total = await unreadBadgeCount(db, user.id, paid).catch(() => undefined);");
    expect(route).toContain('res.headers.set("X-Unread-Total", String(total));');
    expect(read("src/lib/push.ts")).toContain("export async function unreadBadgeCount(");
  });

  it("the bell sets the icon from it, still taking reads done here off one for one", () => {
    const bell = read("src/components/NotificationBell.tsx");
    expect(bell).toContain('const total = Number(res.headers.get("X-Unread-Total"));');
    expect(bell).toContain("const badge = serverUnread ? Math.max(unread, serverUnread.total - (serverUnread.windowUnread - unread)) : unread;");
    expect(bell).toContain("if (isNative) setAppBadge(badge);");
    expect(bell).not.toMatch(/setAppBadge\(unread\)/);
  });

  it("the arithmetic: 67 unread, 20 loaded (all unread), 3 read here → 64", () => {
    const badge = (total: number, windowUnread: number, unread: number) => Math.max(unread, total - (windowUnread - unread));
    expect(badge(67, 20, 20)).toBe(67);
    expect(badge(67, 20, 17)).toBe(64);
    expect(badge(5, 5, 0)).toBe(0);
  });
});

describe("F-OFFICE-09: no card actions for an offline card", () => {
  it("View, Copy link and the QR need a live card", () => {
    expect(read("src/components/office/TeamList.tsx")).toContain("const cardUrl = person.username && person.liveCards > 0 ? `${appUrl}/${person.username}` : null;");
  });
});

describe("F-OFFICE-10: an export refusal is words, not JSON", () => {
  it.each(["src/app/api/office/analytics/export/route.ts", "src/app/api/office/leads/export/route.ts"])("%s", (f) => {
    const src = read(f);
    expect(src).toContain('return downloadRefusal("Too many exports in a few minutes. Please wait a few minutes, then try the export again.", 429);');
  });

  it("is plain text and never cached", () => {
    const lib = read("src/lib/download-refusal.ts");
    expect(lib).toContain('"Content-Type": "text/plain; charset=utf-8"');
    expect(lib).toContain('"Cache-Control": "no-store"');
  });
});
