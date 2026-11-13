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
  asked_at: null,
  sent_at: null,
  sent_channel: null,
  stage: null,
  buyer_role: "broker_owner",
  buyer_reason: "Listed as Broker of Record and owner on the About page",
  team_size: 14,
  detail: "your new listing on Hicks Street",
  license: null,
  type_feel: null,
  current_tool: null,
  specifics: [],
  hook_specific: null,
  hook_angle: null,
  hook_why: null,
  quality_override: false,
  quality_override_at: null,
  call_outcome: null,
  call_outcome_at: null,
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
    for (const n of ["owner_name", "owner_title", "phone", "email", "headshot_url", "office_name", "website", "address", "specialty", "logo_url", "brand_primary", "brand_secondary", "team_members", "social_linkedin", "social_zillow", "src_phone", "unc_phone", "note_phone", "src_team_members", "buyer_role", "buyer_reason", "team_size", "detail", "src_detail"]) {
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

  it("the personalization checklist: a thin draft is marked too generic with what to fix; a specific one isn't", async () => {
    const measure = (page: Page) => page.evaluate(() => {
      const vw = window.innerWidth;
      const spill: string[] = [];
      document.querySelectorAll("#pp-quality, [data-check], [data-specific-row], [data-specific-row] input, [data-specific-row] select, [data-override] button, select").forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && (r.right > vw + 0.5 || r.left < -0.5)) spill.push(`${el.tagName}.${String(el.className).slice(0, 40)} → ${Math.round(r.left)}..${Math.round(r.right)}`);
      });
      return {
        spill, sideways: document.documentElement.scrollWidth > vw,
        quality: (document.querySelector("#pp-quality") as HTMLElement).innerText,
        needed: [...document.querySelectorAll('[data-check][data-ok="no"]')].map((el) => el.getAttribute("data-check")),
        tooGeneric: !!document.querySelector("[data-too-generic]"),
        override: (document.querySelector("[data-override] button") as HTMLElement | null)?.innerText ?? null,
        names: [...document.querySelectorAll("#pp-edit [name]")].map((el) => el.getAttribute("name")),
        qualityTop: document.querySelector("#pp-quality")!.getBoundingClientRect().top, formTop: document.querySelector("#pp-edit")!.getBoundingClientRect().top,
      };
    });

    const thin = await open(width, await editMarkup({ ...RICH, status: "draft" }, { done: "held" }), adminCss);
    const t = await measure(thin);
    expect(t.spill).toEqual([]);
    expect(t.sideways).toBe(false);
    expect(t.tooGeneric).toBe(true);
    expect(t.quality).toMatch(/Personalization: \d+ of 100/);
    expect(t.quality).toContain("Too generic.");
    expect(t.quality).toContain("0 of 3 so far");
    for (const k of ["specifics", "buyer", "hook"]) expect(t.needed).toContain(k);
    expect(t.override).toBe("Override: let me publish it as it is");
    expect(t.qualityTop).toBeLessThan(t.formTop);
    expect(await thin.evaluate(() => document.body.innerText)).toContain("Saved, but not published.");
    for (const n of ["license", "type_feel", "current_tool", "spec_kind_0", "spec_text_5", "spec_src_0", "spec_date_0", "spec_unc_0", "hook_specific", "hook_angle", "hook_why", "src_buyer_second"]) expect(t.names).toContain(n);
    await thin.close();

    const sp = (text: string, i: number) => ({ kind: "listing" as const, text, source_url: `https://harbor.example/listings/${i}`, dated: "2026-11-03", uncertain: false });
    const strong = await open(width, await editMarkup({
      ...RICH, status: "draft",
      specifics: [sp("Listed 412 4th St in Park Slope at $2.15M", 1), sp("Sold 88 Hicks St for $3.1M after a bidding war that ran three weekends in a row", 2), sp("11 of 14 agents list a personal cell number", 3)],
      detail: "your new listing at 412 4th St in Park Slope", hook_specific: 0, hook_angle: "views", hook_why: "You'd know which buyers opened the card your agents hand out at the showings.",
      sources: { ...RICH.sources, buyer_role: { url: "https://harbor.example/about", uncertain: false, note: "" }, buyer_second: { url: "https://appext20.dos.ny.gov/nydos/x", uncertain: false, note: "" } },
    }), adminCss);
    const g = await measure(strong);
    expect(g.spill).toEqual([]);
    expect(g.sideways).toBe(false);
    expect(g.tooGeneric).toBe(false);
    expect(g.quality).toContain("Specific enough to send.");
    expect(g.override).toBeNull();
    for (const k of ["specifics", "buyer", "hook"]) expect(g.needed).not.toContain(k);
    await strong.close();

    const over = await open(width, await editMarkup({ ...RICH, status: "draft", quality_override: true }), adminCss);
    const o = await measure(over);
    expect(o.quality).toContain("You overrode this, so it can be published as it is.");
    expect(o.override).toBe("Remove my override");
    await over.close();
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
    expect(rows[1].text).toContain("Called");
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

describe.each([390, 1280])("/admin/card-builder pipeline at %ipx", (width) => {
  const DAY = 86400_000;
  const at = (daysAgo: number) => new Date(NOW - daysAgo * DAY).toISOString();
  const PIPE: PreviewListRow[] = [
    row({ id: "a1111111-2222-4333-8444-555555555555", owner_name: "Viewed Vera", views: 2, devices: 1, last_viewed_at: at(0.1), sent_at: at(1), sent_channel: "text" }),
    row({ id: "a2222222-2222-4333-8444-555555555555", owner_name: "Sent Sam", sent_at: at(2), sent_channel: "email" }),
    row({ id: "a3333333-2222-4333-8444-555555555555", owner_name: "Asked Ada", asked_at: at(3) }),
    row({ id: "a4444444-2222-4333-8444-555555555555", owner_name: "Won Wendy", stage: "won", called: true, called_at: at(5), views: 4 }),
    row({ id: "a5555555-2222-4333-8444-555555555555", owner_name: "Draft Dee", status: "draft" }),
  ];

  it("counts every stage at the top, and lists who to chase today, most urgent first", async () => {
    const page = await open(width, await adminMarkup({ list: { ready: true, rows: PIPE } }), adminCss);
    const m = await page.evaluate(() => {
      const vw = window.innerWidth;
      const counts = Object.fromEntries([...document.querySelectorAll("[data-stage]")].map((li) => [li.getAttribute("data-stage"), (li.querySelector("p") as HTMLElement).innerText]));
      const tiles = [...document.querySelectorAll("[data-stage]")].map((li) => li.getBoundingClientRect());
      return {
        sideways: document.documentElement.scrollWidth > vw,
        tilesInside: tiles.every((r) => r.left >= 0 && r.right <= vw + 0.5),
        counts,
        chase: [...document.querySelectorAll("[data-follow-up]")].map((li) => ({ kind: li.getAttribute("data-follow-up"), text: (li as HTMLElement).innerText, href: li.querySelector('a[href^="/admin"]')!.getAttribute("href"), tap: li.querySelector("[data-one-tap]")?.getAttribute("href") ?? null, call: li.querySelector("[data-follow-call]")?.getAttribute("href") ?? null })),
        sendLinks: document.querySelectorAll("[data-send-link]").length,
      };
    });
    expect(m.sideways).toBe(false);
    expect(m.tilesInside).toBe(true);
    expect(m.counts).toEqual({ draft: "1", ready: "1", sent: "1", viewed: "1", called: "0", meeting_booked: "0", won: "1", lost: "0" });
    expect(m.chase.map((c) => c.kind)).toEqual(["viewed_not_reached", "sent_not_viewed", "asked_no_link"]);
    expect(m.chase[0].text).toContain("Viewed Vera");
    expect(m.chase[0].href).toBe("/admin/card-builder/call/a1111111-2222-4333-8444-555555555555");
    expect(m.chase[1].text).toContain("Sent 2 days ago, not opened.");
    expect(m.chase[1].href).toBe("/admin/card-builder/send/a2222222-2222-4333-8444-555555555555");
    // A call comes with the number; a message comes with its words and one tap to the founder's own Messages.
    expect(m.chase[0].call).toBe("tel:2125550199");
    expect(m.chase[1].tap).toMatch(/^sms:2125550199\?&body=Hi%20Sent%2C/);
    expect(m.chase[2].tap).toMatch(/^sms:2125550199\?&body=/);
    expect(m.sendLinks).toBe(5);
    await page.close();
  });
});

// ── The Send screen ─────────────────────────────────────────────────────────

async function sendMarkup(p: PreviewListRow, sender: string | null = "Menash Harooni"): Promise<string> {
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { createElement } = await import("react");
  const { default: AdminShell } = await import("@/app/admin/AdminShell");
  const { default: SendView } = await import("@/app/admin/card-builder/send/[id]/SendView");
  const { buildMessages } = await import("@/lib/prospect-preview/messages");
  const messages = buildMessages(p, { link: `https://swiftcard.me/p/${p.slug}`, sender });
  const view = createElement(SendView, { p, messages, now: NOW, senderKnown: !!sender, done: null, error: null });
  return renderToStaticMarkup(createElement(AdminShell, { email: "hello@swiftcard.me", unread: 0 }, view));
}

describe.each([390, 1280])("/admin/card-builder/send/<id> at %ipx", (width) => {
  it("three messages, each opening the founder's own Messages or Mail with the words filled in", async () => {
    const page = await open(width, await sendMarkup(row({})), adminCss);
    const m = await page.evaluate(() => {
      const vw = window.innerWidth;
      const spill: string[] = [];
      document.querySelectorAll(".adm-card, form, input, textarea, h1, h2, .sc-btn").forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && (r.right > vw + 0.5 || r.left < -0.5)) spill.push(`${el.tagName}.${String(el.className).slice(0, 50)} → ${Math.round(r.left)}..${Math.round(r.right)}`);
      });
      const href = (k: string) => (document.querySelector(`[data-send="${k}"]`) as HTMLAnchorElement | null)?.getAttribute("href") ?? null;
      const words = (k: string) => (document.querySelector(`[data-message="${k}"]`) as HTMLTextAreaElement).value;
      return { spill, sideways: document.documentElement.scrollWidth > vw, ask: href("ask"), text: href("text"), email: href("email"), askWords: words("ask"), textWords: words("text") };
    });
    expect(m.spill).toEqual([]);
    expect(m.sideways).toBe(false);
    expect(m.ask).toMatch(/^sms:2125550199\?&body=Hi%20Dana/);
    expect(m.askWords).not.toContain("swiftcard.me/p/");
    expect(m.text).toMatch(/^sms:2125550199\?&body=/);
    expect(m.textWords).toContain("https://swiftcard.me/p/harbor-realty-group-k3x9qa");
    expect(m.email).toMatch(/^mailto:dana@harborrealtygroup\.com\?subject=Dana%2C%20I%20made%20your%20Harbor%20Realty%20Group%20card&body=/);
    await page.close();
  });

  it("a draft can send the first text but not the two with the link", async () => {
    const page = await open(width, await sendMarkup(row({ status: "draft", email: null }), null), adminCss);
    const m = await page.evaluate(() => ({
      sends: [...document.querySelectorAll("[data-send]")].map((a) => a.getAttribute("data-send")),
      blocked: document.querySelectorAll("[data-blocked]").length,
      text: document.body.innerText,
      disabled: [...document.querySelectorAll('form button[type="submit"]')].filter((b) => (b as HTMLButtonElement).disabled).length,
    }));
    expect(m.sends).toEqual(["ask"]);
    expect(m.blocked).toBe(4);
    expect(m.text).toContain("still a draft");
    expect(m.text).toContain("add your name before sending");
    expect(m.disabled).toBe(2);
    await page.close();
  });
});

// ── The Call screen ─────────────────────────────────────────────────────────

async function callMarkup(p: PreviewListRow): Promise<string> {
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { createElement } = await import("react");
  const { default: AdminShell } = await import("@/app/admin/AdminShell");
  const { default: CallView } = await import("@/app/admin/card-builder/call/[id]/CallView");
  const { callBrief } = await import("@/lib/prospect-preview/call");
  const view = createElement(CallView, { p, brief: callBrief(p, { sender: "Menash Harooni" }), appUrl: "https://swiftcard.me", now: NOW, done: null });
  return renderToStaticMarkup(createElement(AdminShell, { email: "hello@swiftcard.me", unread: 0 }, view));
}

describe.each([390, 1280])("/admin/card-builder/call/<id> at %ipx", (width) => {
  it("the Call button first, then why them, what they did, an opener, two objections and the outcome buttons", async () => {
    const p = row({ ...ROWS[1], views: 3, devices: 2, last_viewed_at: "2026-11-11T14:58:00Z", team_strip_scrolled: true, sources: { detail: { url: "https://harbor.example/listings/hicks", uncertain: false, note: "" }, phone: { url: "", uncertain: false, note: "Office line" } } });
    const page = await open(width, await callMarkup(p), adminCss);
    const m = await page.evaluate(() => {
      const vw = window.innerWidth;
      const spill: string[] = [];
      document.querySelectorAll(".adm-card, form, textarea, h1, h2, .sc-btn, dd, [data-opener], [data-objection]").forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && (r.right > vw + 0.5 || r.left < -0.5)) spill.push(`${el.tagName}.${String(el.className).slice(0, 50)} → ${Math.round(r.left)}..${Math.round(r.right)}`);
      });
      const call = document.querySelector("[data-call]") as HTMLAnchorElement;
      return {
        spill, sideways: document.documentElement.scrollWidth > vw,
        callHref: call.getAttribute("href"), callTop: call.getBoundingClientRect().top, briefTop: document.querySelector("#pp-brief")!.getBoundingClientRect().top,
        brief: (document.querySelector("#pp-brief") as HTMLElement).innerText,
        opener: (document.querySelector("[data-opener]") as HTMLElement).innerText,
        objections: document.querySelectorAll("[data-objection]").length,
        outcomes: [...document.querySelectorAll('[data-outcomes] input[name="outcome"]')].map((i) => (i as HTMLInputElement).value),
        text: document.body.innerText,
      };
    });
    expect(m.spill).toEqual([]);
    expect(m.sideways).toBe(false);
    expect(m.callHref).toBe("tel:+12125550199");
    expect(m.callTop).toBeLessThan(m.briefTop);
    expect(m.brief).toContain("Broker-owner: Listed as Broker of Record and owner on the About page.");
    expect(m.brief).toContain("14 people");
    expect(m.brief).toContain("your new listing on Hicks Street");
    expect(m.brief).toContain("3 from 2 devices");
    expect(m.brief).toContain("Scrolled through the team's cards");
    expect(m.opener).toContain("Hi Bartholomew, it's Menash, the founder of SwiftCard.");
    expect(m.opener).toContain("I noticed your new listing on Hicks Street.");
    expect(m.objections).toBe(2);
    expect(m.outcomes).toEqual(["no_answer", "voicemail", "reached", "meeting_booked", "won", "lost"]);
    expect(m.text).toContain("Office line");
    await page.close();
  });

  it("a preview from before the role was recorded says so instead of guessing", async () => {
    const page = await open(width, await callMarkup(row({ buyer_role: null, buyer_reason: null, team_size: null, detail: null })), adminCss);
    const brief = await page.evaluate(() => (document.querySelector("#pp-brief") as HTMLElement).innerText);
    expect(brief).toContain("Not recorded. Confirm they run the office before you pitch.");
    expect(brief).toContain("Not known");
    expect(brief).toContain("None recorded. Don't open with a compliment: find one true thing first.");
    await page.close();
  });
});

// ── The Approve queue ───────────────────────────────────────────────────────

async function approveMarkup(rows: PreviewListRow[], props: Record<string, unknown> = {}): Promise<string> {
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { createElement } = await import("react");
  const { default: AdminShell } = await import("@/app/admin/AdminShell");
  const { default: ApproveView } = await import("@/app/admin/card-builder/approve/ApproveView");
  const view = createElement(ApproveView, { list: { ready: true, rows }, appUrl: "https://swiftcard.me", now: NOW, sender: "Menash Harooni", done: null, error: null, about: null, ...props } as React.ComponentProps<typeof ApproveView>);
  return renderToStaticMarkup(createElement(AdminShell, { email: "hello@swiftcard.me", unread: 0 }, view));
}

const SOLID = {
  specifics: [
    { kind: "open_house" as const, text: "Open house at 88 Hicks St, Sunday Nov 16, 1-3pm", source_url: "https://harborrealty.com/open-houses", dated: "2026-11-16", uncertain: false },
    { kind: "listing" as const, text: "Listed 14 Garden Pl, a 4-bedroom brownstone, at $3.4M", source_url: "https://harborrealty.com/listings/14-garden-pl", dated: "2026-11-03", uncertain: false },
    { kind: "other" as const, text: "14 agents, and Dana wants them all on one card", source_url: "", dated: "", uncertain: false, owner: true },
  ],
  detail: "your open house at 88 Hicks St this Sunday", hook_specific: 0, hook_angle: "open_house" as const,
  hook_why: "Everyone who walks through can tap your card instead of signing a sheet.",
  sources: {
    buyer_role: { url: "https://harborrealty.com/about", uncertain: false, note: "" },
    buyer_second: { url: "https://appext20.dos.ny.gov/nydos/details.do?id=1", uncertain: false, note: "" },
    email: { url: "https://harborrealty.com/about", uncertain: true, note: "Office address, not hers" },
  },
  outreach: {
    first_text: "Hi Dana, Menash from SwiftCard. Saw your open house at 88 Hicks St Sunday. I made you a card for it. Want me to send it?",
    link_text: "Dana, here's the card for 14 Garden Pl: {link}",
    email_subject: "Dana, a card for 14 Garden Pl", email_body: "Hi Dana,\n\nHere it is: {link}\n\nMenash",
    call_opener: "Hi Dana, it's Menash, I sent you the card for Sunday's open house.", voicemail: "Hi Dana, it's Menash from SwiftCard. Text me back when you have two minutes.",
    nudge_no_view: "Dana, the card is still up: {link}", nudge_viewed: "Dana, tried you just now. Is tomorrow morning better?",
    uses: {}, written_at: "2026-11-11T12:00:00Z",
  },
};

describe.each([390, 1280])("/admin/card-builder/approve at %ipx", (width) => {
  const QUEUE: PreviewListRow[] = [
    row({ id: "b1111111-2222-4333-8444-555555555555", status: "draft", ...SOLID }),
    row({
      id: "b2222222-2222-4333-8444-555555555555", status: "draft", owner_name: "Bartholomew Featherstonehaugh-Montgomery",
      office_name: "The Featherstonehaugh-Montgomery International Property Partnership", owner_title: "Founding Managing Partner and Principal Broker",
    }),
    row({ id: "b3333333-2222-4333-8444-555555555555", status: "live", owner_name: "Ready Rae", ...SOLID }),
    row({ id: "b4444444-2222-4333-8444-555555555555", status: "draft", owner_name: "Skipped Sal", skipped_at: "2026-11-10T15:00:00Z" }),
    row({ id: "b5555555-2222-4333-8444-555555555555", status: "live", owner_name: "Sent Sam", sent_at: "2026-11-10T15:00:00Z", sent_channel: "text" }),
  ];

  it("one card per prospect, nothing spills, and the card they would get is really drawn", async () => {
    const page = await open(width, await approveMarkup(QUEUE), adminCss);
    await page.waitForTimeout(300);
    const m = await page.evaluate(() => {
      const vw = window.innerWidth;
      const spill: string[] = [];
      document.querySelectorAll("[data-approve-card], [data-approve-card] *:not([inert] *)").forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && (r.right > vw + 0.5 || r.left < -0.5)) spill.push(`${el.tagName}.${String(el.className).slice(0, 50)} → ${Math.round(r.left)}..${Math.round(r.right)}`);
      });
      const cards = [...document.querySelectorAll("[data-approve-card]")] as HTMLElement[];
      const thumb = document.querySelector("[data-thumb] [inert] > div > div") as HTMLElement | null;
      return {
        spill, sideways: document.documentElement.scrollWidth > vw,
        modes: cards.map((c) => c.getAttribute("data-approve-card")),
        names: cards.map((c) => c.querySelector("h2")!.textContent),
        thumbDrawn: !!thumb && getComputedStyle(thumb).opacity === "1" && thumb.getBoundingClientRect().width > 100,
        skipped: [...document.querySelectorAll("[data-skipped]")].map((li) => (li as HTMLElement).innerText),
        text: document.body.innerText,
      };
    });
    expect(m.spill).toEqual([]);
    expect(m.sideways).toBe(false);
    // Approved-and-unsent first, then the drafts; a sent one and a skipped one are not cards.
    expect(m.modes).toEqual(["send", "waiting", "waiting"]);
    expect(m.names).toEqual(["Ready Rae", "Dana Whitfield", "Bartholomew Featherstonehaugh-Montgomery"]);
    expect(m.thumbDrawn).toBe(true);
    expect(m.skipped).toHaveLength(1);
    expect(m.skipped[0]).toContain("Skipped Sal");
    expect(m.text).not.toContain("Sent Sam");
    await page.close();
  });

  it("a ready draft: score, specifics with sources, the written messages, and three buttons a thumb can hit", async () => {
    const page = await open(width, await approveMarkup(QUEUE), adminCss);
    const m = await page.evaluate(() => {
      const card = document.querySelector("#p-b1111111-2222-4333-8444-555555555555") as HTMLElement;
      const box = (sel: string) => { const r = card.querySelector(sel)!.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; };
      return {
        text: card.innerText,
        sources: [...card.querySelectorAll("[data-specifics] a")].map((a) => a.getAttribute("href")),
        approve: (card.querySelector("[data-approve]") as HTMLButtonElement).closest("form")!.querySelector('input[name="action"]')!.getAttribute("value"),
        approveBox: box("[data-approve]"), editBox: box("[data-edit]"), skipBox: box("[data-skip]"),
        edit: card.querySelector("[data-edit]")!.getAttribute("href"),
        oneTaps: card.querySelectorAll("[data-one-tap]").length,
        cardWidth: Math.round(card.getBoundingClientRect().width),
      };
    });
    expect(m.text).toContain("of 100");
    expect(m.text).not.toContain("Too generic");
    expect(m.text).toContain("I saw your open house at 88 Hicks St this Sunday.");
    expect(m.text).toContain("confirmed by you");
    expect(m.sources).toEqual(["https://harborrealty.com/open-houses", "https://harborrealty.com/listings/14-garden-pl"]);
    expect(m.text).toContain("Saw your open house at 88 Hicks St Sunday. I made you a card for it. Want me to send it?");
    expect(m.text).toContain("Dana, here's the card for 14 Garden Pl: https://swiftcard.me/p/harbor-realty-group-k3x9qa");
    expect(m.text).not.toContain("Standard wording");
    expect(m.text).toContain("Couldn't confirm or left out");
    expect(m.approve).toBe("approve");
    expect(m.edit).toBe("/admin/card-builder/edit/b1111111-2222-4333-8444-555555555555");
    // Nothing can be sent before it is approved.
    expect(m.oneTaps).toBe(0);
    for (const b of [m.approveBox, m.editBox, m.skipBox]) expect(b.h).toBeGreaterThanOrEqual(44);
    if (width === 390) expect(m.approveBox.w).toBeGreaterThan(m.cardWidth * 0.8);
    await page.close();
  });

  it("a too-generic draft can't be approved here, and says its messages are the standard wording", async () => {
    const page = await open(width, await approveMarkup(QUEUE), adminCss);
    const m = await page.evaluate(() => {
      const card = document.querySelector("#p-b2222222-2222-4333-8444-555555555555") as HTMLElement;
      return { text: card.innerText, approve: !!card.querySelector("[data-approve]"), held: !!card.querySelector("[data-held]"), edit: !!card.querySelector("[data-edit]"), skip: !!card.querySelector("[data-skip]") };
    });
    expect(m).toMatchObject({ approve: false, held: true, edit: true, skip: true });
    expect(m.text).toContain("Too generic");
    expect(m.text).toContain("Standard wording");
    await page.close();
  });

  it("once approved, the next tap opens the founder's own Messages or Mail with the words filled in", async () => {
    const page = await open(width, await approveMarkup(QUEUE, { done: "approved", about: "b3333333-2222-4333-8444-555555555555" }), adminCss);
    const m = await page.evaluate(() => {
      const card = document.querySelector("#p-b3333333-2222-4333-8444-555555555555") as HTMLElement;
      const tap = (k: string) => card.querySelector(`[data-one-tap="${k}"]`) as HTMLAnchorElement | null;
      const r = tap("ask")!.getBoundingClientRect();
      return {
        ask: tap("ask")!.getAttribute("href"), text: tap("text")!.getAttribute("href"), email: tap("email")!.getAttribute("href"),
        askH: Math.round(r.height), askTop: Math.round(r.top + window.scrollY),
        thumbTop: Math.round(card.querySelector("[data-thumb]")!.getBoundingClientRect().top + window.scrollY),
        decide: !!card.querySelector("[data-decide]"), justNow: card.hasAttribute("data-just-now"),
        banner: (document.querySelector('[role="status"]') as HTMLElement).innerText,
      };
    });
    expect(decodeURIComponent(m.ask!)).toBe("sms:2125550199?&body=Hi Dana, Menash from SwiftCard. Saw your open house at 88 Hicks St Sunday. I made you a card for it. Want me to send it?");
    expect(decodeURIComponent(m.text!)).toContain("https://swiftcard.me/p/harbor-realty-group-k3x9qa");
    expect(m.email).toMatch(/^mailto:dana@harborrealtygroup\.com\?subject=Dana%2C%20a%20card%20for%2014%20Garden%20Pl&body=/);
    expect(m.askH).toBeGreaterThanOrEqual(44);
    // The send button comes before the picture: it is the next thing to tap.
    expect(m.askTop).toBeLessThan(m.thumbTop);
    expect(m).toMatchObject({ decide: false, justNow: true });
    expect(m.banner).toContain("Nothing has been sent");
    await page.close();
  });

  it("with nothing waiting, says how to line some up", async () => {
    const page = await open(width, await approveMarkup([]), adminCss);
    expect(await page.evaluate(() => document.body.innerText)).toContain("Run /build-card or /build-batch");
    await page.close();
  });
});

describe.each([390, 1280])("written messages on the Send, Call and edit screens at %ipx", (width) => {
  it("the Send screen shows the written words and both nudges; the Call screen the written opener and a voicemail script", async () => {
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { createElement } = await import("react");
    const { default: AdminShell } = await import("@/app/admin/AdminShell");
    const { default: SendView } = await import("@/app/admin/card-builder/send/[id]/SendView");
    const { default: CallView } = await import("@/app/admin/card-builder/call/[id]/CallView");
    const { resolveOutreach } = await import("@/lib/prospect-preview/outreach");
    const { callBrief } = await import("@/lib/prospect-preview/call");
    const p = row({ ...SOLID });
    const messages = resolveOutreach(p, { link: `https://swiftcard.me/p/${p.slug}`, sender: "Menash Harooni" });
    const shell = (view: React.ReactElement) => renderToStaticMarkup(createElement(AdminShell, { email: "hello@swiftcard.me", unread: 0 }, view));

    const send = await open(width, shell(createElement(SendView, { p, messages, now: NOW, senderKnown: true, done: null, error: null })), adminCss);
    const s = await send.evaluate(() => ({
      sideways: document.documentElement.scrollWidth > window.innerWidth,
      kinds: [...document.querySelectorAll("[data-send]")].map((a) => a.getAttribute("data-send")),
      ask: (document.querySelector('[data-message="ask"]') as HTMLTextAreaElement).value,
      written: !!document.querySelector("[data-written]"), templates: !!document.querySelector("[data-templates]"),
    }));
    expect(s.sideways).toBe(false);
    expect(s.kinds).toEqual(["ask", "text", "email", "nudge_no_view", "nudge_viewed"]);
    expect(s.ask).toContain("Saw your open house at 88 Hicks St Sunday.");
    expect(s).toMatchObject({ written: true, templates: false });
    await send.close();

    const call = await open(width, shell(createElement(CallView, { p, brief: callBrief(p, { sender: "Menash Harooni" }), voicemail: messages.voicemail, appUrl: "https://swiftcard.me", now: NOW, done: null })), adminCss);
    const c = await call.evaluate(() => ({
      sideways: document.documentElement.scrollWidth > window.innerWidth,
      opener: (document.querySelector("[data-opener]") as HTMLElement).innerText,
      voicemail: (document.querySelector("[data-voicemail]") as HTMLElement).innerText,
      generic: !!document.querySelector("[data-generic-opener]"),
    }));
    expect(c.sideways).toBe(false);
    expect(c.opener).toBe("Hi Dana, it's Menash, I sent you the card for Sunday's open house.");
    expect(c.voicemail).toContain("Text me back when you have two minutes.");
    expect(c.generic).toBe(false);
    await call.close();
  });

  it("the edit screen has every message to change, and nothing spills", async () => {
    const page = await open(width, await editMarkup(row({ status: "draft", ...SOLID })), adminCss);
    const m = await page.evaluate(() => {
      const vw = window.innerWidth;
      const form = document.querySelector("[data-outreach-form]") as HTMLFormElement;
      const spill: string[] = [];
      document.querySelectorAll("[data-outreach-form] *, [data-source-row] *, [data-specific-row] *").forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && (r.right > vw + 0.5 || r.left < -0.5)) spill.push(`${el.tagName}[${el.getAttribute("name") ?? ""}] → ${Math.round(r.left)}..${Math.round(r.right)}`);
      });
      return {
        spill, sideways: document.documentElement.scrollWidth > vw,
        fields: [...form.querySelectorAll("textarea, input:not([type=hidden])")].map((f) => f.getAttribute("name")),
        first: (form.querySelector('[name="o_first_text"]') as HTMLTextAreaElement).value,
        ownSpecific: (document.querySelector('[name="spec_own_2"]') as HTMLInputElement).checked,
        ownOther: (document.querySelector('[name="spec_own_0"]') as HTMLInputElement).checked,
      };
    });
    expect(m.spill).toEqual([]);
    expect(m.sideways).toBe(false);
    expect(m.fields).toEqual(["o_first_text", "o_link_text", "o_email_subject", "o_email_body", "o_call_opener", "o_voicemail", "o_nudge_no_view", "o_nudge_viewed"]);
    expect(m.first).toContain("Saw your open house at 88 Hicks St Sunday.");
    expect(m).toMatchObject({ ownSpecific: true, ownOther: false });
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
