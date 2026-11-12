import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { callBrief } from "@/lib/prospect-preview/call";
import { titleLine, ownerCard, paddedLogoSrc } from "@/lib/prospect-preview/card";
import { disqualifiers, hasDirectContact, isGeneralEmail, scoreFit } from "@/lib/prospect-preview/fit";
import { parsePreviewFields, parseSpecifics, readSpecifics } from "@/lib/prospect-preview/input";
import { padLogoBytes, LOGO_MARGIN } from "@/lib/prospect-preview/logo-server";
import { buildMessages } from "@/lib/prospect-preview/messages";
import { assessQuality, buyerVerified, hookProblems, isVerified } from "@/lib/prospect-preview/quality";
import type { PreviewListRow, Specific } from "@/lib/prospect-preview/types";

// The owner's bar for targeting and personalization (2026-11-12): an office is
// scored on six stated criteria; a preview carries at least three verified
// specifics, a decision-maker checked against a second site and a hook built
// on one specific; every message and the call opener lead with that hook; and
// a draft that falls short is "too generic" and cannot be published unless
// the owner overrides it by hand.

const NOW = Date.parse("2026-11-12T15:00:00Z");

const spec = (over: Partial<Specific> = {}): Specific => ({ kind: "listing", text: "Listed 412 4th St in Park Slope at $2.15M", source_url: "https://harborrealty.com/listings/412-4th-st", dated: "2026-11-03", uncertain: false, ...over });
const CELLS = spec({ kind: "cell_numbers", text: "11 of 14 agents list a personal cell number on the team page", source_url: "https://harborrealty.com/team", dated: "2026-11-12" });
const SALE = spec({ kind: "sale", text: "Sold 88 Hicks St for $3.1M", source_url: "https://harborrealty.com/sold/88-hicks-st", dated: "2026-10-20" });

const good = {
  id: "11111111-1111-4111-8111-111111111111", slug: "harbor-realty-group-k3x9qa", status: "draft",
  office_name: "Harbor Realty Group", owner_name: "Dana Whitfield", owner_title: "Owner & Principal Broker", license: "Licensed Real Estate Broker",
  phone: "(718) 555-0199", email: "dana@harborrealty.com", logo_url: "https://harborrealty.com/logo.png", headshot_url: "https://harborrealty.com/dana.jpg",
  address: "12 Front St, Brooklyn, NY 11201", website: "https://harborrealty.com/", social_links: { instagram: "https://www.instagram.com/harborrealty" },
  specialty: "Brooklyn Heights brownstones since 2009", brand_primary: "#0B3D2E", brand_secondary: "#E7C873", type_feel: "serif", current_tool: "link_in_bio",
  team_members: [{ name: "Marcus Lee", title: "Associate Broker" }, { name: "Ana Ruiz", title: "" }],
  buyer_role: "broker_owner", buyer_reason: "Named owner and Broker of Record on the About page", team_size: 14,
  specifics: [CELLS, spec(), SALE],
  detail: "11 of your 14 agents list their own cell number on your team page", hook_specific: 0, hook_angle: "departures",
  hook_why: "When one of them moves on, every client who saved that number goes with them.",
  quality_override: false, quality_override_at: null,
  sources: {
    owner_title: { url: "https://harborrealty.com/about", uncertain: false, note: "" },
    buyer_role: { url: "https://harborrealty.com/about", uncertain: false, note: "" },
    buyer_second: { url: "https://appext20.dos.ny.gov/nydos/details.do?id=1", uncertain: false, note: "" },
    specialty: { url: "https://harborrealty.com/", uncertain: false, note: "" },
    colors: { url: "https://harborrealty.com/logo.png", uncertain: false, note: "" },
    team_members: { url: "https://harborrealty.com/team", uncertain: false, note: "" },
  },
  expires_at: "2026-11-26T15:00:00Z", views: 0, team_strip_scrolled: false, sent_at: null, devices: 0, last_viewed_at: null,
} as unknown as PreviewListRow;

describe("the quality gate", () => {
  it("a preview with three verified specifics, a twice-checked decision-maker and a real hook is specific enough", () => {
    const q = assessQuality(good);
    expect(q.tooGeneric).toBe(false);
    expect(q.mayPublish).toBe(true);
    expect(q.score).toBe(100);
    expect(q.checks.filter((c) => c.required).map((c) => c.key)).toEqual(["specifics", "buyer", "hook"]);
  });

  it("fewer than three verified specifics is too generic: an unsourced, undated or uncertain one doesn't count", () => {
    expect(isVerified(spec())).toBe(true);
    for (const weak of [spec({ source_url: "" }), spec({ dated: "" }), spec({ uncertain: true })]) {
      expect(isVerified(weak)).toBe(false);
      const q = assessQuality({ ...good, specifics: [CELLS, spec(), weak] });
      expect(q.tooGeneric).toBe(true);
      expect(q.mayPublish).toBe(false);
      expect(q.checks.find((c) => c.key === "specifics")).toMatchObject({ ok: false, earned: 20, points: 30 });
      expect(q.blockers.join(" ")).toMatch(/2 of 3 so far \(1 more is missing a source or a date, or marked uncertain\)/);
    }
  });

  it("the decision-maker needs two sources on two different sites, neither uncertain", () => {
    expect(buyerVerified(good)).toBe(true);
    const sameSite = { ...good.sources, buyer_second: { url: "https://www.harborrealty.com/team/dana", uncertain: false, note: "" } };
    expect(buyerVerified({ ...good, sources: sameSite })).toBe(false);
    expect(buyerVerified({ ...good, sources: { ...good.sources, buyer_second: undefined } })).toBe(false);
    expect(buyerVerified({ ...good, sources: { ...good.sources, buyer_second: { ...good.sources.buyer_second!, uncertain: true } } })).toBe(false);
    expect(assessQuality({ ...good, sources: sameSite }).tooGeneric).toBe(true);
  });

  it("'You cover Park Slope' is not a hook, nor is a compliment, nor a fact tied to nothing", () => {
    expect(hookProblems(good)).toEqual([]);
    expect(hookProblems({ ...good, detail: "you cover Park Slope and Windsor Terrace" }).join(" ")).toMatch(/location, not a hook/);
    expect(hookProblems({ ...good, detail: "your amazing team and beautiful website" }).join(" ")).toMatch(/compliment or filler/);
    expect(hookProblems({ ...good, hook_why: "I love what your team is doing." }).join(" ")).toMatch(/compliment or filler/);
    expect(hookProblems({ ...good, detail: "your open house on Sunday" }).join(" ")).toMatch(/doesn't mention the specific it is tied to/);
    expect(hookProblems({ ...good, hook_specific: null }).join(" ")).toMatch(/isn't tied to one of the specifics/);
    expect(hookProblems({ ...good, specifics: [{ ...CELLS, uncertain: true }, spec(), SALE] }).join(" ")).toMatch(/isn't verified/);
    expect(hookProblems({ ...good, hook_angle: null }).join(" ")).toMatch(/Pick what the hook leads to/);
    expect(hookProblems({ ...good, hook_why: null }).join(" ")).toMatch(/why that fact matters/);
    expect(hookProblems({ ...good, detail: null })).toHaveLength(1);
    for (const bad of [{ detail: "you cover Park Slope" }, { hook_why: null }, { hook_specific: null }]) expect(assessQuality({ ...good, ...bad }).tooGeneric).toBe(true);
  });

  it("only the owner's override lets a too-generic preview through, and it doesn't change the verdict", () => {
    const q = assessQuality({ ...good, specifics: [], quality_override: true });
    expect(q.tooGeneric).toBe(true);
    expect(q.mayPublish).toBe(true);
  });

  it("publishing is held by the route, the override is its own action, and the tool can never set it", () => {
    const route = readFileSync("src/app/api/admin/card-builder/[id]/route.ts", "utf8");
    expect(route).toContain('if (saved.status !== "live" && !assessQuality(saved).mayPublish) return reply("held", 409);');
    expect(route.indexOf('reply("held", 409)')).toBeLessThan(route.indexOf("await publishPreview(id);"));
    expect(route).toContain('case "override": {');
    const tool = readFileSync("tests/tools/card-builder.tool.ts", "utf8");
    expect(tool).toContain('if ("quality_override" in raw) throw new Error(');
    expect(tool).not.toContain("setQualityOverride");
    // The save itself never touches the override: PreviewFields has no such key.
    const parsed = parsePreviewFields((k) => ({ office_name: "A", owner_name: "B", phone: "7185550199", buyer_role: "team_lead", quality_override: "true" } as Record<string, string>)[k]);
    expect(parsed.ok && "quality_override" in parsed.value).toBe(false);
  });

  it("the edit screen shows the checklist, the score and the override; the list marks a too-generic draft", () => {
    const edit = readFileSync("src/app/admin/card-builder/edit/[id]/EditView.tsx", "utf8");
    for (const s of ["Personalization: ${q.score} of 100", "data-too-generic", "data-quality-checks", 'name="action" value="override"', 'done === "held"', "name={`spec_text_${i}`}", 'name="hook_why"', 'name="license"']) expect(edit).toContain(s);
    expect(readFileSync("src/app/admin/card-builder/CardBuilderView.tsx", "utf8")).toContain('stage === "draft" && !assessQuality(r).mayPublish && <StatusBadge tone="bad">Too generic</StatusBadge>');
  });
});

describe("specifics from the form", () => {
  it("drops empty rows and moves the hook with its row", () => {
    const form: Record<string, string> = {
      spec_kind_1: "sale", spec_text_1: "Sold 88 Hicks St", spec_src_1: "https://x.com/a", spec_date_1: "2026-10-20",
      spec_kind_4: "award", spec_text_4: "Best of Brooklyn 2026", spec_src_4: "https://x.com/b", spec_date_4: "2026-09-01", spec_unc_4: "on",
      hook_specific: "4",
    };
    const got = parseSpecifics((k) => form[k]);
    expect(got.specifics.map((s) => s.kind)).toEqual(["sale", "award"]);
    expect(got.specifics[1].uncertain).toBe(true);
    expect(got.hook_specific).toBe(1);
    expect(parseSpecifics((k) => ({ ...form, hook_specific: "3" })[k]).hook_specific).toBeNull();
  });

  it("keeps only a real calendar day as the date, and an http(s) page as the source", () => {
    const [a] = readSpecifics([{ kind: "nonsense", text: " A  thing ", source_url: "javascript:alert(1)", dated: "last week" }]);
    expect(a).toEqual({ kind: "other", text: "A thing", source_url: "", dated: "", uncertain: false });
    expect(readSpecifics(Array.from({ length: 9 }, () => spec()))).toHaveLength(6);
    expect(readSpecifics("nope")).toEqual([]);
  });
});

describe("every message and the opener lead with the hook", () => {
  const opts = { link: "https://swiftcard.me/p/harbor-realty-group-k3x9qa", sender: "Menash Harooni" };
  const FACT = "I saw 11 of your 14 agents list their own cell number on your team page.";
  const WHY = "When one of them moves on, every client who saved that number goes with them.";

  it("the first text, the text with the link and the email each say the fact and why it matters", () => {
    const m = buildMessages(good, opts);
    expect(m.specific).toBe(true);
    for (const body of [m.ask, m.text, m.email.body]) {
      expect(body).toContain(FACT);
      expect(body).toContain(WHY);
      expect(body.indexOf(FACT)).toBeLessThan(body.indexOf("card"));
    }
    expect(m.ask).not.toContain("http");
    expect(m.text).toContain(opts.link);
  });

  it("without a hook the messages are flagged as generic, and the Send screen says so", () => {
    const m = buildMessages({ ...good, detail: null, hook_why: null }, opts);
    expect(m.specific).toBe(false);
    expect(buildMessages({ ...good, hook_why: null }, opts).specific).toBe(false);
    expect(readFileSync("src/app/admin/card-builder/send/[id]/SendView.tsx", "utf8")).toContain("{!messages.specific && (");
  });

  it("two different offices never get the same words", () => {
    const other = { ...good, office_name: "Tide Mortgage", owner_name: "Sam Ortiz", detail: "your open house at 9 Elm St this Sunday", hook_why: "Everyone who walks through can tap your card instead of signing a sheet.", team_members: [] };
    const a = buildMessages(good, opts), b = buildMessages(other, opts);
    const strip = (s: string, p: typeof good) => s.replaceAll(p.owner_name.split(" ")[0], "X").replaceAll(p.office_name, "Y");
    expect(strip(a.ask, good)).not.toBe(strip(b.ask, other));
    expect(strip(a.email.body, good)).not.toBe(strip(b.email.body, other));
  });

  it("the call opener says the fact and why before it mentions the card", () => {
    const b = callBrief(good, { sender: "Menash" });
    expect(b.specific).toBe(true);
    expect(b.opener).toBe(`Hi Dana, it's Menash, the founder of SwiftCard. ${FACT} ${WHY} So I made a digital business card for you and the team at Harbor Realty Group. Do you have two minutes?`);
    expect(b.angle).toBe("Keeping contacts when an agent leaves");
    expect(callBrief({ ...good, detail: null }, { sender: "Menash" }).specific).toBe(false);
  });

  it("what they use today changes the first objection; a competitor is answered, not skipped", () => {
    expect(callBrief(good, { sender: null }).objections[0].they).toBe("We already have a link in our bio.");
    const popl = callBrief({ ...good, current_tool: "popl" }, { sender: null });
    expect(popl.currentTool).toBe("Popl");
    expect(popl.objections[0].they).toBe("We already use Popl.");
    expect(popl.objections[0].you).toMatch(/contacts stay with the office when an agent leaves/);
    expect(callBrief({ ...good, current_tool: null }, { sender: null }).objections[0].they).toBe("We already have business cards.");
    expect(callBrief({ ...good, current_tool: "paper" }, { sender: null }).objections).toHaveLength(2);
    for (const o of popl.objections) expect(o.you).not.toMatch(/\$|per month|pricing/i);
  });
});

describe("the card they would really use", () => {
  it("prints their title as written with their license line after it, in their type feel", () => {
    expect(titleLine("Owner & Principal Broker", "Licensed Real Estate Broker")).toBe("Owner & Principal Broker · Licensed Real Estate Broker");
    expect(titleLine("Branch Manager", null)).toBe("Branch Manager");
    const card = ownerCard(good);
    expect(card.title).toBe("Owner & Principal Broker · Licensed Real Estate Broker");
    expect(card.customization?.fontFamily).toMatch(/serif/);
    expect(ownerCard({ ...good, type_feel: null }).customization?.fontFamily).toBeUndefined();
  });

  it("draws the logo through the route that pads it: public for a published preview, staff-only otherwise", () => {
    expect(paddedLogoSrc(good, false)).toMatch(/^\/p\/harbor-realty-group-k3x9qa\/logo\?v=[a-z0-9]+$/);
    expect(paddedLogoSrc(good, true)).toMatch(/^\/api\/admin\/card-builder\/11111111-1111-4111-8111-111111111111\/logo\?v=/);
    expect(paddedLogoSrc({ ...good, logo_url: null }, false)).toBeNull();
    expect(ownerCard(good, "/p/x/logo").logoUrl).toBe("/p/x/logo");
    expect(ownerCard({ ...good, logo_url: null }, "/p/x/logo").logoUrl).toBeNull();
    const pub = readFileSync("src/app/p/[slug]/logo/route.ts", "utf8");
    expect(pub).toContain('if (!preview || previewState(preview) !== "live") return new Response(null, { status: 404 });');
    const staff = readFileSync("src/app/api/admin/card-builder/[id]/logo/route.ts", "utf8");
    expect(staff.indexOf("requireAdmin()")).toBeLessThan(staff.indexOf("await getPreviewById"));
    expect(readFileSync("src/lib/prospect-preview/logo-server.ts", "utf8")).toContain("fetchVCardPhoto(url, \"logo\")");
  });

  it("a logo cut tight to its artwork comes back with an even margin in its own background", async () => {
    const sharp = (await import("sharp")).default;
    // White file, dark artwork touching the right and bottom edges, a lopsided border elsewhere.
    const art = await sharp({ create: { width: 200, height: 60, channels: 4, background: "#123456" } }).png().toBuffer();
    const tight = await sharp({ create: { width: 230, height: 70, channels: 4, background: "#FFFFFF" } }).composite([{ input: art, left: 30, top: 10 }]).png().toBuffer();
    const out = await padLogoBytes(tight);
    expect(out).not.toBeNull();
    const pad = Math.round(60 * LOGO_MARGIN);
    expect([out!.width, out!.height]).toEqual([200 + 2 * pad, 60 + 2 * pad]);
    const { data, info } = await sharp(out!.png).raw().toBuffer({ resolveWithObject: true });
    const px = (x: number, y: number) => [...data.subarray((y * info.width + x) * info.channels, (y * info.width + x) * info.channels + 3)];
    expect(px(2, 2)).toEqual([255, 255, 255]);
    expect(px(info.width - 3, info.height - 3)).toEqual([255, 255, 255]);
    expect(px(Math.round(info.width / 2), Math.round(info.height / 2))).toEqual([0x12, 0x34, 0x56]);
    // A transparent logo keeps a clear margin, so it still sits on any card colour.
    const clear = await sharp({ create: { width: 120, height: 120, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{ input: await sharp({ create: { width: 80, height: 80, channels: 4, background: "#FFFFFF" } }).png().toBuffer(), left: 20, top: 20 }]).png().toBuffer();
    const c = await padLogoBytes(clear);
    const raw = await sharp(c!.png).ensureAlpha().raw().toBuffer();
    expect(raw[3]).toBe(0);
    expect(await padLogoBytes(Buffer.from("not a picture"))).toBeNull();
  });
});

describe("scoring an office's fit", () => {
  const office = {
    name: "Dana Whitfield", team_size: 14, phone: "(718) 555-0199", phone_kind: "mobile", email: "dana@harborrealty.com", corporate_decides: false,
    evidence: {
      independent: { met: true, note: "Independently owned" },
      active: { met: true, note: "Listed 88 Hicks St", date: "2026-11-03", source: "https://harborrealty.com/listings/88-hicks-st" },
      in_person: { met: true, note: "Open houses this weekend" },
      growing: { met: null, note: "No careers page" },
    },
  };

  it("adds up the six stated criteria and shows each line", () => {
    const f = scoreFit(office, NOW);
    expect(f.lines.map((l) => [l.key, l.met, l.points])).toEqual([
      ["size", true, 20], ["independent", true, 20], ["direct_contact", true, 20], ["active", true, 15], ["in_person", true, 15], ["growing", null, 0],
    ]);
    expect(f.score).toBe(90);
    expect(f.disqualified).toEqual([]);
    expect(f.summary).toMatch(/^Fit 90\/100: 5-50 people yes \(20\/20\), .* growing unknown \(0\/10\)\.$/);
    expect(scoreFit({ ...office, evidence: { ...office.evidence, growing: { met: true, note: "Hiring" } } }, NOW).score).toBe(100);
  });

  it("works out size and direct contact from the facts, not from the researcher's say-so", () => {
    expect(scoreFit({ ...office, team_size: 80, evidence: { ...office.evidence, size: { met: true } } }, NOW).lines[0]).toMatchObject({ met: false, points: 0 });
    expect(scoreFit({ ...office, team_size: null }, NOW).lines[0]).toMatchObject({ met: null, points: 0 });
    expect(hasDirectContact({ phone: "718", phone_kind: "office line", email: "info@x.com" })).toBe(false);
    expect(hasDirectContact({ phone: "718", phone_kind: "office line", email: "dana@x.com" })).toBe(true);
    expect(hasDirectContact({ phone: "718", phone_kind: "mobile", email: "" })).toBe(true);
    for (const e of ["info@x.com", "Hello@x.com", "office@x.com", "contact@x.com", "team@x.com"]) expect(isGeneralEmail(e)).toBe(true);
    expect(isGeneralEmail("teamster@x.com")).toBe(false);
  });

  it("'active' needs a date inside 60 days and a page to check it on", () => {
    const active = (e: object) => scoreFit({ ...office, evidence: { ...office.evidence, active: e as never } }, NOW).lines[3];
    expect(active({ met: true, note: "Posted", date: "2026-08-01", source: "https://x.com" })).toMatchObject({ met: false, points: 0 });
    expect(active({ met: true, note: "Posted" })).toMatchObject({ met: null, points: 0 });
    expect(active({ met: true, note: "Posted", date: "2026-11-01" })).toMatchObject({ met: null });
    expect(active({ met: true, note: "Open house", date: "2026-11-16", source: "https://x.com" })).toMatchObject({ met: true, points: 15 });
  });

  it("disqualifies the four cases, with the reason, and never for a competitor in use", () => {
    expect(disqualifiers({ ...office, corporate_decides: true })[0]).toMatch(/head office decides/);
    expect(disqualifiers({ ...office, team_size: 3 })[0]).toMatch(/Under 5 people \(3\)/);
    expect(disqualifiers({ ...office, name: "" })).toEqual(["No named leader."]);
    expect(disqualifiers({ ...office, phone_kind: "office line", email: "info@harborrealty.com" })[0]).toMatch(/Only a general office line and a general address/);
    expect(disqualifiers(office)).toEqual([]);
    expect(disqualifiers({ ...office, team_size: null })).toEqual([]);
    expect(Object.keys(office)).not.toContain("current_tool");
  });

  it("the tool refuses to save a disqualified office and ignores a score handed to it", () => {
    const tool = readFileSync("tests/tools/card-builder.tool.ts", "utf8");
    expect(tool).toContain("if (scored.disqualified.length) { disqualified.push(");
    expect(tool).toContain("score: scored.score,");
    expect(tool).not.toMatch(/Number\(l\.fit\)/);
  });
});

describe("the commands ask for all of it", () => {
  const find = readFileSync(".claude/commands/find-offices.md", "utf8");
  const build = readFileSync(".claude/commands/build-card.md", "utf8");

  it("/find-offices: the six criteria, the disqualifiers, what they use today, all three kinds, and as many searches as it takes", () => {
    for (const s of ["5 to 50 people", "without corporate approval", "direct mobile or email", "Active in the last 60 days", "meet clients in person", "Growing or recruiting"]) expect(find).toContain(s);
    for (const s of ["head office decides", "under 5 people", "no named leader", "only a general office line"]) expect(find).toContain(s);
    for (const s of ["Popl", "Linq", "Blinq", "HiHello", "Dot", "link in bio", "it changes the\npitch"]) expect(find).toContain(s);
    expect(find).toMatch(/brokerages, agent teams\s+and mortgage branches/);
    expect(find).toContain("Run as many searches as it takes to return the count asked for.");
    expect(find).toContain("card-builder.mjs fit");
  });

  it("/build-card: the real card, three specifics, a hook tied to SwiftCard, real team titles, a second source, and the score", () => {
    for (const s of ["name and title exactly as they write them", "license designation, if they show one", "real tagline", "type feel", "Find at least 3 verified specifics", "with its address", "how many agents list a personal cell number", "“You cover Park Slope” is not a hook".replace(/[“”]/g, '"'), "Never invent one", "use their\n   license type", "Verify the decision-maker against a second source", "card-builder.mjs quality"]) expect(build).toContain(s);
    for (const angle of ["views", "departures", "open_house"]) expect(build).toContain(`\`${angle}\``);
    expect(build).toMatch(/Only the owner can override that/);
  });
});
