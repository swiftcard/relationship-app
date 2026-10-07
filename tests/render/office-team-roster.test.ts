import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Browser } from "playwright";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { launchBrowser, appCss } from "./harness";
import TeamList from "@/components/office/TeamList";
import type { TeamPerson, TeamInvite } from "@/lib/office-team";

// The Team tab's roster grew from two number columns (Views, Leads) to three —
// Card views, Link views, Contacts, all time (owner, 2026-10-06). On a phone
// the three sit in one row under the person with their own labels, and a
// pending invitation has nothing to count, so it shows no dashes there.

const person = (i: number, over: Partial<TeamPerson> = {}): TeamPerson => ({
  kind: "member",
  userId: `u${i}`,
  name: ["Priya Ramanathan-Whitfield", "Tom Beck", "Dana Lee", "Sam Okafor"][i % 4],
  username: `member-${i}`,
  isOwner: i === 0,
  cardName: "Card",
  cardCount: 1,
  views: [128_400, 3, 0, 999_999][i % 4],
  swiftlinkViews: [12_345, 0, 7, 88_888][i % 4],
  scans: 0,
  uniqueVisitors: 0,
  leads: [4_210, 1, 0, 12_000][i % 4],
  contactsSaved: 5,
  lastActivityAt: null,
  memberRowId: i === 0 ? null : `m${i}`,
  title: "Senior Client Partner, Enterprise Accounts and Strategic Relationships",
  email: `averyverylongteammateaddress${i}@subdomain.example-company.com`,
  photoUrl: null,
  lastActiveAt: i % 2 ? new Date(Date.now() - i * 36e5).toISOString() : null,
  liveCards: 1,
  totalCards: 1,
  status: (["active", "idle", "card_deactivated", "card_incomplete"] as const)[i % 4],
  ...over,
});

const invite: TeamInvite = {
  kind: "invite",
  memberRowId: "inv1",
  name: "Alexandria Montgomery-Fitzgerald",
  email: "alexandria.montgomery-fitzgerald@subdomain.example-company.com",
  inviteToken: null,
  sentAt: new Date(Date.now() - 2 * 864e5).toISOString(),
  status: "invite_sent",
};

async function render(browser: Browser, width: number) {
  const css = await appCss();
  const markup = renderToStaticMarkup(
    createElement(TeamList, {
      people: [0, 1, 2, 3].map((i) => person(i)),
      invites: [invite, { ...invite, memberRowId: "inv2", name: null, status: "invite_expired" }],
      appUrl: "https://swiftcard.me",
      // canInvite off: the invite row's actions need the app router, which a
      // static render does not have. The row itself is what is measured.
      caps: { canInvite: false, canRemove: false, canManageCards: false, canManageSeats: false, viewerIsOwner: true },
    }),
  );
  const page = await browser.newPage();
  await page.setViewportSize({ width, height: 1400 });
  await page.setContent(
    `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style>
     <style>body{margin:0;padding:16px 20px;background:#0b0f16}</style></head>
     <body class="sc-app">${markup}</body></html>`,
    { waitUntil: "load" },
  );
  await page.waitForTimeout(150);
  return page;
}

describe("the Team tab roster", () => {
  let browser: Browser;
  beforeAll(async () => { browser = await launchBrowser(); }, 120_000);
  afterAll(async () => { await browser?.close(); });

  for (const width of [390, 768, 1280]) {
    it(`fits at ${width}px with long names and big numbers`, async () => {
      const page = await render(browser, width);
      try {
        const res = await page.evaluate(() => {
          const limit = window.innerWidth + 1;
          const spills: string[] = [];
          document.querySelectorAll("body *").forEach((el) => {
            const r = el.getBoundingClientRect();
            if (r.width > 0 && (r.right > limit || r.left < -1)) spills.push(`${el.tagName}.${(el.className || "").toString().slice(0, 60)}`);
          });
          return { spills, sideways: document.documentElement.scrollWidth > window.innerWidth };
        });
        expect(res.spills, `content spills outside the viewport at ${width}px`).toEqual([]);
        expect(res.sideways, `the page scrolls sideways at ${width}px`).toBe(false);
      } finally { await page.close(); }
    });
  }

  it("on a computer: the three all-time columns, under their headings", async () => {
    const page = await render(browser, 1280);
    try {
      const text = await page.innerText("body");
      for (const h of ["CARD VIEWS", "LINK VIEWS", "CONTACTS", "LAST ACTIVE", "STATUS"]) expect(text).toContain(h);
      expect(text).not.toMatch(/\bLEADS\b/i);
      for (const n of ["128,400", "12,345", "4,210", "999,999", "88,888", "12,000"]) expect(text).toContain(n);
      // A pending invite holds the columns with dashes on a computer.
      expect(text).toContain("—");
    } finally { await page.close(); }
  });

  it("on a phone: each number carries its own label, and an invite shows no dashes", async () => {
    const page = await render(browser, 390);
    try {
      const res = await page.evaluate(() => {
        const visible = (el: Element) => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden";
        };
        const texts = [...document.querySelectorAll("p, span")].filter(visible).map((e) => (e as HTMLElement).innerText.trim());
        return {
          labels: ["Card views", "Link views", "Contacts", "Last active"].map((l) => texts.filter((t) => t === l).length),
          dashes: texts.filter((t) => t === "—").length,
          // The three number cells of the first person share one row.
          firstRowTops: [...document.querySelectorAll(".grid > p.col-span-4")].slice(0, 3).map((e) => Math.round(e.getBoundingClientRect().top)),
        };
      });
      expect(res.labels, "one label per person per number").toEqual([4, 4, 4, 4]);
      expect(res.dashes, "no dash placeholders on a phone").toBe(0);
      expect(new Set(res.firstRowTops).size, "card views, link views and contacts sit on one line").toBe(1);
    } finally { await page.close(); }
  });

  it("an expired invite says so once", async () => {
    const page = await render(browser, 1280);
    try {
      const text = await page.innerText("body");
      expect(text.match(/Invite expired/g)?.length).toBe(1);
      expect(text).not.toContain("Invitation expired");
    } finally { await page.close(); }
  });
});
