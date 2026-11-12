import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { pickBrandColors, themeColorIn } from "@/lib/prospect-preview/colors";
import { formatTeam, headshotSourceAllowed, parsePreviewFields, parsePreviewForm, parseTeam, readSources, readTeam } from "@/lib/prospect-preview/input";
import { previewState } from "@/lib/prospect-preview/real-view";

// Card Builder, part 2 (2026-11-11): richer previews, drafts and sources.

const form = (over: Record<string, unknown> = {}) => {
  const base: Record<string, unknown> = { office_name: "Harbor Realty Group", owner_name: "Dana Whitfield", phone: "(212) 555-0199", buyer_role: "broker_owner", ...over };
  return (k: string) => base[k];
};

describe("a draft is not public", () => {
  it("a new preview is always a draft", () => {
    const made = parsePreviewForm(form());
    expect(made.ok && made.value.status).toBe("draft");
  });

  it("the public page, its picture and the view beacon all treat a draft as missing", () => {
    const later = new Date(Date.now() + 86400_000).toISOString();
    expect(previewState({ status: "draft", expires_at: later })).toBe("missing");
    expect(previewState({ status: "live", expires_at: later })).toBe("live");
    for (const file of ["src/app/p/[slug]/page.tsx", "src/app/p/[slug]/opengraph-image.tsx"]) {
      expect(readFileSync(file, "utf8")).toMatch(/previewState\(preview\) (===|!==) "live"/);
    }
  });

  it("staff look at a draft behind the admin check, and that look sends no view", () => {
    const page = readFileSync("src/app/admin/card-builder/preview/[id]/page.tsx", "utf8");
    expect(page).toMatch(/if \(!\(await requireAdmin\(\)\)\) notFound\(\)/);
    expect(page).not.toContain("PreviewBeacon");
    expect(readFileSync("src/app/admin/card-builder/edit/[id]/page.tsx", "utf8")).toMatch(/if \(!\(await requireAdmin\(\)\)\) notFound\(\)/);
  });

  it("publishing starts the link's 14 days, and a refused save publishes nothing", () => {
    const store = readFileSync("src/lib/prospect-preview/store.ts", "utf8");
    expect(store).toMatch(/status: "live", expires_at: expiryFrom\(DEFAULT_EXPIRY_DAYS, now\)/);
    const route = readFileSync("src/app/api/admin/card-builder/[id]/route.ts", "utf8");
    expect(route.indexOf("if (!parsed.ok) return reply")).toBeLessThan(route.indexOf("await publishPreview(id)"));
  });

  it("the SQL only adds: new columns and one more status", () => {
    const sql = readFileSync("supabase/prospect-previews-drafts.sql", "utf8").replace(/--.*$/gm, "");
    expect(sql).not.toMatch(/\b(drop table|drop column|delete from|update |truncate)\b/i);
    expect(sql).toMatch(/check \(status in \('draft', 'live', 'paused'\)\)/);
    for (const c of ["headshot_url", "address", "website", "social_links", "specialty", "sources"]) expect(sql).toContain(`add column if not exists ${c}`);
  });
});

describe("the new fields", () => {
  it("reads them, and keeps only https addresses", () => {
    const got = parsePreviewFields(form({
      address: "12 Front St, Brooklyn, NY 11201", website: "https://harborrealty.com", specialty: "  Brownstones in   Brooklyn Heights ",
      social_instagram: "https://instagram.com/harborrealty", social_linkedin: "",
    }));
    expect(got.ok).toBe(true);
    if (!got.ok) return;
    expect(got.value).toMatchObject({ address: "12 Front St, Brooklyn, NY 11201", website: "https://harborrealty.com/", specialty: "Brownstones in Brooklyn Heights", social_links: { instagram: "https://instagram.com/harborrealty" } });
    expect(parsePreviewFields(form({ website: "http://harborrealty.com" }))).toMatchObject({ ok: false });
    expect(parsePreviewFields(form({ social_zillow: "javascript:alert(1)" }))).toMatchObject({ ok: false });
  });

  it("team members carry a title and an optional headshot, and survive the edit form's round trip", () => {
    const team = parseTeam("Marcus Lee, Office Manager, https://harborrealty.com/marcus.jpg\nJo Park\nAna Souza, Agent, Brooklyn\nSam Roe, , https://harborrealty.com/sam.jpg");
    expect(team).toEqual([
      { name: "Marcus Lee", title: "Office Manager", headshot: "https://harborrealty.com/marcus.jpg" },
      { name: "Jo Park", title: "" },
      { name: "Ana Souza", title: "Agent, Brooklyn" },
      { name: "Sam Roe", title: "", headshot: "https://harborrealty.com/sam.jpg" },
    ]);
    expect(parseTeam(formatTeam(team))).toEqual(team);
    expect(readTeam([{ name: "X Y", title: "Z", headshot: "http://not-https.example/a.jpg" }])).toEqual([{ name: "X Y", title: "Z" }]);
  });
});

describe("a headshot only from their own site or brokerage profile", () => {
  it("is refused without a source, or with a social network or image search as the source", () => {
    const shot = { headshot_url: "https://harborrealty.com/dana.jpg" };
    expect(parsePreviewFields(form(shot))).toMatchObject({ ok: false, error: expect.stringMatching(/headshot needs its source/i) });
    for (const bad of ["https://www.linkedin.com/in/dana", "https://www.instagram.com/dana", "https://www.facebook.com/dana", "https://www.google.com/search?q=dana"]) {
      expect(parsePreviewFields(form({ ...shot, src_headshot_url: bad })).ok).toBe(false);
    }
    expect(parsePreviewFields(form({ ...shot, src_headshot_url: "https://harborrealty.com/about" })).ok).toBe(true);
    expect(parsePreviewFields(form({ ...shot, src_headshot_url: "https://www.compass.com/agents/dana-whitfield/" })).ok).toBe(true);
  });

  it("the same for team headshots", () => {
    const team = { team_members: "Marcus Lee, Manager, https://harborrealty.com/m.jpg" };
    expect(parsePreviewFields(form(team)).ok).toBe(false);
    expect(parsePreviewFields(form({ ...team, src_team_members: "https://harborrealty.com/team" })).ok).toBe(true);
    expect(headshotSourceAllowed(null)).toBe(false);
  });
});

describe("every researched fact keeps its source", () => {
  it("stores the page, a note and the uncertain flag per fact, and drops empty ones", () => {
    const got = parsePreviewFields(form({ src_phone: "https://harborrealty.com/contact", unc_phone: "on", note_phone: "office line", src_email: "not a url", unc_address: "on" }));
    expect(got.ok && got.value.sources).toEqual({
      phone: { url: "https://harborrealty.com/contact", uncertain: true, note: "office line" },
      address: { url: "", uncertain: true, note: "" },
    });
    expect(readSources({ phone: { url: "javascript:x", uncertain: "yes" }, nonsense: { url: "https://a.example" } })).toEqual({});
  });

  it("the edit screen shows each source and flags the uncertain ones", () => {
    const view = readFileSync("src/app/admin/card-builder/edit/[id]/EditView.tsx", "utf8");
    expect(view).toContain("SOURCE_FIELDS.map");
    expect(view).toContain("data-uncertain");
    expect(view).toMatch(/name=\{`src_\$\{k\}`\}/);
    expect(view).toMatch(/name=\{`unc_\$\{k\}`\}/);
    expect(view).toContain('<form method="post"');
  });
});

describe("brand colours from the logo or the site", () => {
  const px = (list: [number, number, number, number, number][]) => new Uint8Array(list.flatMap(([r, g, b, a, n]) => Array.from({ length: n }, () => [r, g, b, a]).flat()));

  it("takes the colourful mark over the grey lettering, and ignores the white paper", () => {
    const got = pickBrandColors(px([[255, 255, 255, 255, 500], [60, 60, 64, 255, 200], [200, 20, 30, 255, 120], [0, 0, 0, 0, 300]]));
    expect(got).toEqual({ primary: "#C8141E", secondary: "#3C3C40" });
  });

  it("a one-colour logo gets white as its accent; an empty one gets nothing", () => {
    expect(pickBrandColors(px([[11, 61, 46, 255, 400], [255, 255, 255, 255, 400]]))).toEqual({ primary: "#0B3D2E", secondary: "#FFFFFF" });
    expect(pickBrandColors(px([[255, 255, 255, 255, 50], [0, 0, 0, 0, 50]]))).toBeNull();
  });

  it("reads a site's theme colour, in either attribute order, and never plain white", () => {
    expect(themeColorIn('<head><meta name="theme-color" content="#0b3d2e"></head>')).toBe("#0B3D2E");
    expect(themeColorIn("<meta content='#abc' name='theme-color'>")).toBe("#AABBCC");
    expect(themeColorIn('<meta name="theme-color" content="#ffffff"><meta name="viewport" content="#123456">')).toBeNull();
  });

  it("both fetches go through the SSRF-safe fetcher", () => {
    const src = readFileSync("src/lib/prospect-preview/colors-server.ts", "utf8");
    expect(src).toContain("fetchVCardPhoto(");
    expect(src).toContain("safeFetch(");
    expect(src.replace(/safeFetch\(/g, "")).not.toMatch(/\bfetch\(/);
  });
});
