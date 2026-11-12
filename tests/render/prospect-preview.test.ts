import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { readFileSync } from "node:fs";
import type { Browser, Page } from "playwright";
import { launchBrowser, appCss } from "./harness";
import type { PreviewListRow, ProspectPreview } from "@/lib/prospect-preview/types";

// ── Card Builder, measured ──────────────────────────────────────────────────
//
// Two screens, rendered from their real components with the app's real CSS at
// a phone and a computer width:
//
//   /p/<slug>            what the prospect opens from a text message. The
//                        owner's card must actually be drawn (the scaler shows
//                        a card at opacity 0 until it has a width), the team
//                        strip must scroll INSIDE itself and never drag the
//                        page sideways, and the one button must be on screen.
//   /admin/card-builder  the form and the list, inside the real admin shell,
//                        with the long names that break layouts.

vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/card-builder",
  useRouter: () => ({ push() {}, replace() {}, refresh() {}, back() {}, prefetch() {} }),
  useSearchParams: () => new URLSearchParams(),
}));

let browser: Browser;
let css = "";
let adminCss = "";

beforeAll(async () => {
  css = await appCss();
  adminCss = readFileSync("src/app/admin/admin.css", "utf8");
  browser = await launchBrowser();
}, 240_000);

afterAll(async () => { await browser?.close(); });

const PREVIEW: ProspectPreview = {
  id: "11111111-2222-4333-8444-555555555555",
  created_at: "2026-11-10T15:00:00Z",
  updated_at: "2026-11-10T15:00:00Z",
  expires_at: "2026-11-24T15:00:00Z",
  status: "live",
  slug: "harbor-realty-group-k3x9qa",
  office_name: "Harbor Realty Group",
  owner_name: "Dana Whitfield",
  owner_title: "Broker / Owner",
  phone: "(212) 555-0199",
  email: "dana@harborrealtygroup.com",
  logo_url: null,
  headshot_url: null,
  address: null,
  website: null,
  social_links: {},
  specialty: null,
  sources: {},
  brand_primary: "#0B3D2E",
  brand_secondary: "#E7C873",
  team_members: [
    { name: "Marcus Lee", title: "Office Manager" },
    { name: "Priyanka Venkataraman-Fitzgerald", title: "Senior Residential Sales Associate" },
    { name: "Jo Park", title: "" },
    { name: "Ana Souza", title: "Agent" },
  ],
  called: false,
  called_at: null,
  notes: null,
  crew_lead_id: null,
};

async function open(width: number, markup: string, extraCss = ""): Promise<Page> {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  await page.setContent(
    `<!doctype html><html data-sc-theme="light"><head><meta charset="utf-8">
     <meta name="viewport" content="width=device-width, initial-scale=1">
     <style>${css}${extraCss}</style><style>body{margin:0}</style></head><body>${markup}</body></html>`,
    { waitUntil: "load" },
  );
  await page.waitForTimeout(150);
  return page;
}

async function previewMarkup(preview: ProspectPreview, calendarUrl = "https://cal.example.com/swiftcard/setup"): Promise<string> {
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { createElement } = await import("react");
  const { default: PreviewView } = await import("@/app/p/[slug]/PreviewView");
  return renderToStaticMarkup(createElement(PreviewView, { preview, calendarUrl }));
}

describe.each([390, 1280])("/p/<slug> at %ipx", (width) => {
  it("draws the owner's card, with their name on it", async () => {
    const page = await open(width, await previewMarkup(PREVIEW));
    const card = await page.evaluate(() => {
      const el = document.querySelector("[data-owner-card]")!;
      const r = el.getBoundingClientRect();
      const inner = el.querySelector("[inert] > div > div") as HTMLElement | null;
      return { width: r.width, height: r.height, text: el.textContent ?? "", opacity: inner ? getComputedStyle(inner).opacity : "?" };
    });
    expect(card.width).toBeGreaterThan(280);
    expect(card.height).toBeGreaterThan(140);
    expect(card.opacity).toBe("1");
    expect(card.text).toContain("Dana Whitfield");
    expect(card.text).toContain("Harbor Realty Group");
    await page.close();
  });

  it("never scrolls the page sideways; the team strip scrolls inside itself", async () => {
    const page = await open(width, await previewMarkup(PREVIEW));
    const m = await page.evaluate(() => {
      const strip = document.querySelector("[data-team-strip]") as HTMLElement;
      return {
        sideways: document.documentElement.scrollWidth > window.innerWidth,
        stripScrolls: strip.scrollWidth > strip.clientWidth + 1,
        cards: strip.children.length,
        firstCardHeight: strip.children[0].getBoundingClientRect().height,
        names: strip.textContent ?? "",
      };
    });
    expect(m.sideways).toBe(false);
    expect(m.cards).toBe(4);
    expect(m.stripScrolls).toBe(true);
    expect(m.firstCardHeight).toBeGreaterThan(100);
    expect(m.names).toContain("Marcus Lee");
    await page.close();
  });

  it("the one button is fully on screen, big enough to tap, and goes to the calendar", async () => {
    const page = await open(width, await previewMarkup(PREVIEW));
    const b = await page.evaluate(() => {
      // The cards are real templates, so they contain phone and email links;
      // they sit inside `inert`, where nothing can be tapped or tabbed to.
      const links = [...document.querySelectorAll("a")].filter((a) => !a.closest("[inert]"));
      const a = document.querySelector("[data-claim]") as HTMLAnchorElement;
      const r = a.getBoundingClientRect();
      return { links: links.length, href: a.getAttribute("href"), text: a.textContent, left: r.left, right: r.right, height: r.height, vw: window.innerWidth, oneLine: r.height < 70 };
    });
    expect(b.links).toBe(1);
    expect(b.href).toBe("https://cal.example.com/swiftcard/setup");
    expect(b.text).toBe("Claim your team's cards, 15-min setup call");
    expect(b.left).toBeGreaterThanOrEqual(0);
    expect(b.right).toBeLessThanOrEqual(b.vw);
    expect(b.height).toBeGreaterThanOrEqual(44);
    await page.close();
  });

  it("says who made it, and shows the notification they would get", async () => {
    const page = await open(width, await previewMarkup(PREVIEW));
    const text = await page.evaluate(() => document.body.innerText);
    expect(text).toContain("Preview made by SwiftCard.");
    expect(text).toContain("Card viewed");
    expect(text).toContain("Someone viewed your card on iPhone.");
    await page.close();
  });
});

describe("/p/<slug> with nothing optional filled in", () => {
  it("a preview with no team, title, email or logo still lays out, without an empty team section", async () => {
    const bare: ProspectPreview = { ...PREVIEW, team_members: [], owner_title: null, email: null, logo_url: null };
    const page = await open(390, await previewMarkup(bare, "/demo"));
    const m = await page.evaluate(() => ({
      sideways: document.documentElement.scrollWidth > window.innerWidth,
      strip: !!document.querySelector("[data-team-strip]"),
      text: document.body.innerText,
      target: document.querySelector("[data-claim]")!.getAttribute("target"),
    }));
    expect(m.sideways).toBe(false);
    expect(m.strip).toBe(false);
    expect(m.text).not.toContain("Your team");
    // Our own booking page opens in the same tab; an outside calendar in a new one.
    expect(m.target).toBeNull();
    await page.close();
  });
});

// A 1x1 picture, so a headshot loads without the network.
const PIXEL = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
const RICH: ProspectPreview = {
  ...PREVIEW,
  headshot_url: PIXEL,
  address: "1200 Atlantic Avenue, Suite 400, Brooklyn Heights, Brooklyn, NY 11201",
  website: "https://www.harborrealtygroup-brooklynheights.com/",
  specialty: "Brownstones and pre-war co-ops in Brooklyn Heights, Cobble Hill and Carroll Gardens since 1987",
  social_links: { instagram: "https://instagram.com/harbor", linkedin: "https://linkedin.com/company/harbor", zillow: "https://zillow.com/profile/harbor" },
  team_members: [{ name: "Marcus Lee", title: "Office Manager", headshot: PIXEL }, { name: "Priyanka Venkataraman-Fitzgerald", title: "Senior Residential Sales Associate" }],
  sources: { phone: { url: "https://harbor.example/contact", uncertain: true, note: "Office line, not her mobile" }, owner_name: { url: "https://harbor.example/about", uncertain: false, note: "" } },
};

describe.each([390, 1280])("/p/<slug> with everything filled in, at %ipx", (width) => {
  it("shows the headshot, the specialty, the address and website on the card, and names the social links without linking them", async () => {
    const page = await open(width, await previewMarkup(RICH));
    const m = await page.evaluate(() => {
      const face = document.querySelector("[data-owner-face] img")!.getBoundingClientRect();
      const special = document.querySelector("[data-specialty]")!.getBoundingClientRect();
      return {
        sideways: document.documentElement.scrollWidth > window.innerWidth,
        face: [Math.round(face.width), Math.round(face.height)],
        specialRight: special.right, vw: window.innerWidth,
        card: document.querySelector("[data-owner-card]")!.textContent ?? "",
        socials: (document.querySelector("[data-socials]") as HTMLElement).innerText,
        links: [...document.querySelectorAll("a")].filter((a) => !a.closest("[inert]")).length,
        memberFaces: document.querySelectorAll("[data-member-face]").length,
        memberPics: document.querySelectorAll("[data-member-face] img").length,
      };
    });
    expect(m.sideways).toBe(false);
    expect(m.face).toEqual([72, 72]);
    expect(m.specialRight).toBeLessThanOrEqual(m.vw);
    expect(m.card).toContain("harborrealtygroup-brooklynheights.com");
    expect(m.card).toContain("1200 Atlantic Avenue");
    expect(m.socials).toBe("Your card links to your LinkedIn, Instagram and Zillow.");
    // Still one thing to tap.
    expect(m.links).toBe(1);
    // One teammate has a picture, so every teammate gets a face row (initials for the other).
    expect(m.memberFaces).toBe(2);
    expect(m.memberPics).toBe(1);
    await page.close();
  });
});

// ── The edit screen ─────────────────────────────────────────────────────────

async function editMarkup(p: ProspectPreview, props: Record<string, unknown> = {}): Promise<string> {
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { createElement } = await import("react");
  const { default: AdminShell } = await import("@/app/admin/AdminShell");
  const { default: EditView } = await import("@/app/admin/card-builder/edit/[id]/EditView");
  const view = createElement(EditView, { p, appUrl: "https://swiftcard.me", now: Date.parse("2026-11-11T15:00:00Z"), done: null, error: null, ...props } as React.ComponentProps<typeof EditView>);
  return renderToStaticMarkup(createElement(AdminShell, { email: "hello@swiftcard.me", unread: 0 }, view));
}

describe.each([390, 1280])("/admin/card-builder/edit/<id> at %ipx", (width) => {
  it("a draft: every field is editable, nothing spills, and it says the link doesn't open yet", async () => {
    const page = await open(width, await editMarkup({ ...RICH, status: "draft" }, { error: "The website needs a full https:// address." }), adminCss);
    const m = await page.evaluate(() => {
      const vw = window.innerWidth;
      const spill: string[] = [];
      document.querySelectorAll(".adm-card, form, input, textarea, h1, h2, .sc-btn, [data-source-row], [role=alert]").forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && (r.right > vw + 0.5 || r.left < -0.5)) spill.push(`${el.tagName}.${String(el.className).slice(0, 50)} → ${Math.round(r.left)}..${Math.round(r.right)}`);
      });
      const names = [...document.querySelectorAll("#pp-edit [name]")].map((el) => el.getAttribute("name"));
      return {
        sideways: document.documentElement.scrollWidth > vw, spill, names,
        text: document.body.innerText,
        publish: !!document.querySelector("[data-publish]"),
        copy: [...document.querySelectorAll("button")].some((b) => b.textContent === "Copy link"),
        team: (document.querySelector('textarea[name="team_members"]') as HTMLTextAreaElement).value,
      };
    });
    expect(m.spill).toEqual([]);
    expect(m.sideways).toBe(false);
    for (const n of ["owner_name", "owner_title", "phone", "email", "headshot_url", "office_name", "website", "address", "specialty", "logo_url", "brand_primary", "brand_secondary", "team_members", "social_linkedin", "social_zillow", "src_phone", "unc_phone", "note_phone", "src_team_members"]) {
      expect(m.names).toContain(n);
    }
    expect(m.text).toContain("This is a draft.");
    expect(m.text).toContain("Check before you publish: Phone.");
    expect(m.text).toContain("The website needs a full https:// address. Nothing was saved.");
    expect(m.publish).toBe(true);
    // No link to copy for a page that would 404.
    expect(m.copy).toBe(false);
    expect(m.team).toContain("Marcus Lee, Office Manager, data:");
    await page.close();
  });

  it("a published one: the link to copy, Save, and a way back to draft", async () => {
    const page = await open(width, await editMarkup(RICH), adminCss);
    const m = await page.evaluate(() => ({
      text: document.body.innerText,
      publish: !!document.querySelector("[data-publish]"),
      unpublish: !!document.querySelector('input[name="action"][value="unpublish"]'),
      copy: [...document.querySelectorAll("button")].some((b) => b.textContent === "Copy link"),
    }));
    expect(m.text).toContain("Link opens until");
    expect(m).toMatchObject({ publish: false, unpublish: true, copy: true });
    await page.close();
  });
});

// ── The admin page ──────────────────────────────────────────────────────────

const NOW = Date.parse("2026-11-11T15:00:00Z");
const row = (over: Partial<PreviewListRow>): PreviewListRow => ({ ...PREVIEW, views: 0, last_viewed_at: null, team_strip_scrolled: false, devices: 0, ...over });
const ROWS: PreviewListRow[] = [
  row({ views: 3, devices: 2, last_viewed_at: "2026-11-11T14:58:00Z", team_strip_scrolled: true }),
  row({
    id: "22222222-2222-4333-8444-555555555555", slug: "the-featherstonehaugh-montgomery-internat-p7w2mn",
    owner_name: "Bartholomew Featherstonehaugh-Montgomery", owner_title: "Founding Managing Partner and Principal Broker",
    office_name: "The Featherstonehaugh-Montgomery International Property Partnership",
    email: "bartholomew.featherstonehaugh-montgomery@featherstonehaughmontgomeryinternational.com",
    phone: "+1 (212) 555-0199 ext. 4410", called: true, called_at: "2026-11-10T18:00:00Z",
    notes: "Wants cards for all 14 agents. Call back Thursday after their sales meeting.", views: 1, devices: 1, last_viewed_at: "2026-11-10T17:40:00Z",
  }),
  row({ id: "33333333-2222-4333-8444-555555555555", slug: "old-one-abc234", expires_at: "2026-11-01T00:00:00Z" }),
  row({ id: "44444444-2222-4333-8444-555555555555", slug: "draft-one-abc234", status: "draft" }),
];

async function adminMarkup(props: Record<string, unknown>): Promise<string> {
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { createElement } = await import("react");
  const { default: AdminShell } = await import("@/app/admin/AdminShell");
  const { default: CardBuilderView } = await import("@/app/admin/card-builder/CardBuilderView");
  const view = createElement(CardBuilderView, {
    list: { ready: true, rows: ROWS }, appUrl: "https://swiftcard.me", now: NOW, made: null, error: null, done: null, calendarSet: true, ...props,
  } as React.ComponentProps<typeof CardBuilderView>);
  return renderToStaticMarkup(createElement(AdminShell, { email: "hello@swiftcard.me", unread: 2 }, view));
}

describe.each([390, 1280])("/admin/card-builder at %ipx", (width) => {
  it("nothing spills past the screen, even with very long names, emails and notes", async () => {
    const page = await open(width, await adminMarkup({ made: "harbor-realty-group-k3x9qa" }), adminCss);
    const m = await page.evaluate(() => {
      const vw = window.innerWidth;
      const spill: string[] = [];
      document.querySelectorAll(".adm-card, [data-preview-row], form, input, textarea, h1, h2, .sc-btn, [role=status]").forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && (r.right > vw + 0.5 || r.left < -0.5)) spill.push(`${el.tagName}.${String(el.className).slice(0, 50)} → ${Math.round(r.left)}..${Math.round(r.right)}`);
      });
      return { sideways: document.documentElement.scrollWidth > vw, spill };
    });
    expect(m.spill).toEqual([]);
    expect(m.sideways).toBe(false);
    await page.close();
  });

  it("lists each preview with its status, real views, last viewed, Called and notes, copy and delete", async () => {
    const page = await open(width, await adminMarkup({}), adminCss);
    const rows = await page.evaluate(() => [...document.querySelectorAll("[data-preview-row]")].map((li) => ({
      text: (li as HTMLElement).innerText,
      called: (li.querySelector('input[name="called"]') as HTMLInputElement).checked,
      notes: (li.querySelector('input[name="notes"]') as HTMLInputElement).value,
      copy: [...li.querySelectorAll("button")].some((b) => b.textContent === "Copy link"),
      del: !!li.querySelector('input[name="action"][value="delete"]'),
    })));
    expect(rows).toHaveLength(4);
    // A draft says so, has no link to copy, and its way forward is the edit screen.
    expect(rows[3].text).toContain("Draft");
    expect(rows[3].text).toContain("not published yet");
    expect(rows[3].text).toContain("Edit and publish");
    expect(rows[3]).toMatchObject({ copy: false, del: true });
    expect(rows[0].text).toContain("3 real views");
    expect(rows[0].text).toContain("last viewed 2m ago");
    expect(rows[0].text).toContain("2 devices");
    expect(rows[0].text).toContain("looked through the team");
    expect(rows[0].text).toContain("Viewed");
    expect(rows[0]).toMatchObject({ called: false, copy: true, del: true });
    expect(rows[1].text).toContain("1 real view");
    expect(rows[1]).toMatchObject({ called: true, notes: "Wants cards for all 14 agents. Call back Thursday after their sales meeting.", copy: true, del: true });
    // An expired preview says so, and offers no link to copy (it would 404).
    expect(rows[2].text).toContain("Expired");
    expect(rows[2].text).toContain("never opened");
    expect(rows[2]).toMatchObject({ copy: false, del: true });
    await page.close();
  });

  it("Card Builder is in the navigation", async () => {
    const page = await open(width, await adminMarkup({}), adminCss);
    expect(await page.locator('a[href="/admin/card-builder"]').count()).toBeGreaterThan(0);
    await page.close();
  });
});

describe("/admin/card-builder before its storage exists", () => {
  it("says what to run instead of showing a form that can't save", async () => {
    const page = await open(390, await adminMarkup({ list: { ready: false, reason: "not_set_up" } }), adminCss);
    const text = await page.evaluate(() => document.body.innerText);
    expect(text).toContain("supabase/prospect-previews.sql");
    expect(await page.locator('form[action="/api/admin/card-builder"]').count()).toBe(0);
    await page.close();
  });
});
