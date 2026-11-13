import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { ownerCard, paddedLogoSrc } from "@/lib/prospect-preview/card";
import { contrast, logoPlate, readableOn, TEXT_CONTRAST } from "@/lib/prospect-preview/colors";
import { queueItemsFrom } from "@/lib/prospect-preview/desk";
import { batchKindsDue } from "@/lib/prospect-preview/digest";
import { formatTeam, parsePreviewFields, parseTeam, readSpecifics } from "@/lib/prospect-preview/input";
import { batchBrief, batchPush, messageStats, readBatchItems, styleNotes, type Batch, type MessageEvent } from "@/lib/prospect-preview/learn";
import { checkOutreach, outreachEdits, readOutreach, resolveOutreach, staleNumbers } from "@/lib/prospect-preview/outreach";
import { followUps } from "@/lib/prospect-preview/pipeline";
import type { PreviewListRow, ProspectPreview, Specific } from "@/lib/prospect-preview/types";
import { companyKeyOf, connectionsAt, parseConnectionsCsv, readBackground, readWarmPath, warmPathFor } from "@/lib/prospect-preview/warm";

// Round 2 (owner, 2026-11-13): cards that read on any brand colour; a tone
// that never sounds like watching; three ways to run a build, unattended;
// two first texts to pick from; warm paths from the owner's own connections;
// LinkedIn by hand; and learning from what the owner edits, picks and sends.

const read = (p: string) => readFileSync(p, "utf8");
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");

const LINK = "https://swiftcard.me/p/harbor-realty-group-k3x9qa";
const spec = (over: Partial<Specific> = {}): Specific => ({ kind: "listing", text: "Listed 14 Garden Pl at $3.4M", source_url: "https://harborrealty.com/listings/14-garden-pl", dated: "2026-11-03", uncertain: false, ...over });
const SPECIFICS = [
  spec({ kind: "open_house", text: "Open house at 88 Hicks St, Sunday Nov 16" }),
  spec(),
  spec({ kind: "cell_numbers", text: "Most agents list a personal cell number on the team page" }),
];
const WRITTEN = {
  first_text: "Hi Dana, Menash from SwiftCard. Saw your open house at 88 Hicks St Sunday. I made you a card for it. Want me to send it?",
  first_text_b: "Hi Dana, Menash from SwiftCard. Most of your agents hand out their own cell. I made Harbor a card for that. Want to see it?",
  link_text: "Dana, here's the card for 14 Garden Pl: {link}",
  email_subject: "Dana, a card for 14 Garden Pl",
  email_body: "Hi Dana,\n\nI made a card you could send with 14 Garden Pl. You see when it's opened.\n\nHere it is: {link}\n\nMenash",
  call_opener: "Hi Dana, it's Menash. I sent you a card for Sunday's open house at 88 Hicks. Do you have two minutes?",
  voicemail: "Hi Dana, it's Menash from SwiftCard. Most of your agents give out their own cell, and I made Harbor a card for that. Text me back.",
  nudge_no_view: "Dana, the card for Sunday's open house is still up: {link}",
  nudge_viewed: "Dana, tried you just now about 14 Garden Pl. Is tomorrow morning better for 5 minutes?",
  linkedin_note: "Hi Dana, I'm in Brooklyn too and follow what Harbor does in Brooklyn Heights. I'd like to connect.",
  linkedin_dm: "Thanks for connecting, Dana. I saw the open house at 88 Hicks St on Sunday and made you something for it. Can I send it over?",
  uses: { first_text: 0, first_text_b: 2, link_text: 1, email_body: 1, call_opener: 0, voicemail: 2, nudge_no_view: 0, nudge_viewed: 1, linkedin_dm: 0 },
};
const outreach = (over: Record<string, unknown> = {}) => readOutreach({ ...WRITTEN, ...over })!;
const ctx = { link: LINK, specifics: SPECIFICS, complete: true, linkedin: true };

const preview = {
  id: "11111111-1111-4111-8111-111111111111", slug: "harbor-realty-group-k3x9qa", status: "live", office_name: "Harbor Realty Group", owner_name: "Dana Whitfield",
  owner_title: "Owner", license: null, logo_url: null, phone: "(718) 555-0199", email: null, website: null, address: null, team_members: [], type_feel: null,
  expires_at: "2026-11-27T15:00:00Z", created_at: "2026-11-10T15:00:00Z", updated_at: "2026-11-10T15:00:00Z", detail: null, hook_why: null, buyer_role: "broker_owner",
  views: 0, last_viewed_at: null, called: false, called_at: null, stage: null, sent_at: null, asked_at: null, specifics: SPECIFICS, sources: {}, outreach: null,
  brand_primary: "#91C53E", brand_secondary: "#168B93", quality_override: false, social_links: {}, linkedin_url: "https://www.linkedin.com/in/dana-whitfield",
} as unknown as PreviewListRow;

describe("a card that reads on any brand colour", () => {
  it("the title's colour is made readable by contrast ratio, keeping its hue: CMG's teal on CMG's green", () => {
    expect(contrast("#91C53E", "#168B93")).toBeLessThan(3);
    const fixed = readableOn("#91C53E", "#168B93");
    expect(contrast("#91C53E", fixed)).toBeGreaterThanOrEqual(TEXT_CONTRAST);
    // Still a teal: more blue and green than red.
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(fixed.slice(i, i + 2), 16));
    expect(g).toBeGreaterThan(r);
    expect(b).toBeGreaterThan(r);
    expect(ownerCard(preview as ProspectPreview).customization?.accentColor).toBe(fixed);
  });

  it("a colour that already reads is left exactly as it is, and any pair ends up readable", () => {
    expect(readableOn("#0B3D2E", "#E7C873")).toBe("#E7C873");
    for (const [ground, color] of [["#FFFFFF", "#FFFF00"], ["#000000", "#00008B"], ["#A5CFE5", "#A5CFE5"], ["#808080", "#808080"], ["#FF0000", "#00FF00"]]) {
      expect(contrast(ground, readableOn(ground, color)), `${color} on ${ground}`).toBeGreaterThanOrEqual(TEXT_CONTRAST);
    }
    expect(readableOn("#0B3D2E", "not a colour")).toBe("#FFFFFF");
  });

  it("a see-through logo in the card's own colour gets a plate it can be read on; one that reads doesn't", () => {
    const px = (n: number, rgba: number[]) => Array.from({ length: n }, () => rgba).flat();
    // Realty Collective: a light-blue disc with black letters, on a light-blue card.
    const rc = new Uint8Array([...px(70, [165, 207, 229, 255]), ...px(20, [1, 1, 1, 255]), ...px(10, [0, 0, 0, 0])]);
    expect(logoPlate(rc, "#A5CFE5")).toBe("#FFFFFF");
    expect(logoPlate(rc, "#0B3D2E")).toBeNull();
    // White lettering on a white card: a dark plate.
    const white = new Uint8Array([...px(60, [255, 255, 255, 255]), ...px(40, [0, 0, 0, 0])]);
    expect(logoPlate(white, "#FAFAFA")).toBe("#141B26");
    // A few pixels in the card's colour are not the whole logo.
    const mostlyDark = new Uint8Array([...px(20, [165, 207, 229, 255]), ...px(80, [20, 30, 40, 255])]);
    expect(logoPlate(mostlyDark, "#A5CFE5")).toBeNull();
  });

  it("the logo's address changes with the card's colour, so a plated logo is never served from an old cache", () => {
    const p = { id: "i", slug: "s", logo_url: "https://x.com/logo.png" };
    expect(paddedLogoSrc({ ...p, brand_primary: "#A5CFE5" }, false)).not.toBe(paddedLogoSrc({ ...p, brand_primary: "#0B3D2E" }, false));
    for (const f of ["src/app/p/[slug]/logo/route.ts", "src/app/api/admin/card-builder/[id]/logo/route.ts"]) expect(read(f)).toContain("logoResponse(preview.logo_url, preview.brand_primary)");
  });

  it("a wrapped title gets a line of its own, and one line still takes the height it always did", () => {
    const shared = read("src/components/card-templates/shared.tsx");
    expect(shared).toContain("lineHeight: `max(${box}, 1.08em)`,");
    expect(shared).toContain("marginBottom: `min(0px, calc(${box} - 1.08em))`,");
  });

  it("a headshot address with commas in it stays whole", () => {
    const url = "https://res.cloudinary.com/cmg/image/upload/w_400,h_400,c_fill/ed.jpg";
    expect(parseTeam(`Ed Groussman, Branch Production Manager, ${url}\nSal Criscuolo, Sales Manager\nJo Park, ${url}`)).toEqual([
      { name: "Ed Groussman", title: "Branch Production Manager", headshot: url },
      { name: "Sal Criscuolo", title: "Sales Manager" },
      { name: "Jo Park", title: "", headshot: url },
    ]);
    const team = [{ name: "Ed Groussman", title: "Branch Production Manager", headshot: url }];
    expect(parseTeam(formatTeam(team))).toEqual(team);
    expect(parseTeam("Ana Ruiz, VP, Sales, East")).toEqual([{ name: "Ana Ruiz", title: "VP, Sales, East" }]);
  });
});

describe("tone: never watching, never stale, never more than the product does", () => {
  it("a clean set with two first texts and both LinkedIn messages passes", () => {
    expect(checkOutreach(outreach(), ctx)).toEqual([]);
  });

  it("a follower count is refused", () => {
    expect(checkOutreach(outreach({ link_text: "Dana, 12.4K people follow @harbor. Here's the card: {link}" }), ctx).join(" ")).toMatch(/don't quote a follower count/);
    expect(checkOutreach(outreach({ email_body: "Hi Dana, with 3,200 followers you'd fill it. {link}" }), ctx).join(" ")).toMatch(/don't quote a follower count/);
  });

  it("a number flagged as possibly stale can't be used; the same message without it can", () => {
    const p = { team_size: 14, sources: { team_size: { url: "https://x.com", uncertain: true, note: "" } }, specifics: [spec({ text: "27 agents per a 2024 article", uncertain: true }), spec()] };
    expect(staleNumbers(p)).toEqual(["14", "27", "2024"]);
    expect(staleNumbers({ ...p, sources: {} })).toEqual(["27", "2024"]);
    const withIt = outreach({ first_text_b: "Hi Dana, Menash from SwiftCard. 11 of your 14 agents hand out their own cell. Want to see the card I made?" });
    expect(checkOutreach(withIt, { ...ctx, stale: ["14"] }).join(" ")).toMatch(/it uses 14, a number that was flagged as possibly out of date/);
    expect(checkOutreach(outreach(), { ...ctx, stale: ["14"] })).toEqual([]); // "14 Garden Pl" is an address they advertise… and "14" there is the stale number too
  });

  it("\"see who opens it\" is refused: the product says when, not who", () => {
    for (const claim of ["you see who opens it", "It shows you who opened the card", "Know who viewed your card", "you'll see who's looking"]) {
      expect(checkOutreach(outreach({ email_body: `Hi Dana, ${claim}. {link}` }), ctx).join(" "), claim).toMatch(/tells you when a card is opened, not who/);
    }
    expect(checkOutreach(outreach({ email_body: "Hi Dana, you see when it's opened. {link}" }), ctx)).toEqual([]);
    // And the app's own wording no longer says it.
    expect(code("src/lib/prospect-preview/call.ts")).not.toMatch(/see who|who opens|contacts stay with the office when an agent leaves/);
    expect(read("src/lib/prospect-preview/types.ts")).toContain('views: "Knowing when a card is opened",');
  });

  it("a specific marked \"don't quote\" (a former name, an old address) can't be what a message is built on, and survives a save", () => {
    const quiet = [SPECIFICS[0], SPECIFICS[1], spec({ kind: "other", text: "Her contact file still says Victoria Hagman, 223 Columbia St", quiet: true })];
    expect(checkOutreach(outreach(), { ...ctx, specifics: quiet }).join(" ")).toMatch(/built on specific 2, which is marked "don't quote"/);
    const fine = { ...WRITTEN.uses, first_text_b: 1, voicemail: 1 };
    expect(checkOutreach(outreach({ uses: fine }), { ...ctx, specifics: quiet })).toEqual([]);
    expect(readSpecifics([{ text: "Old name on file", quiet: "on" }])[0].quiet).toBe(true);
    expect("quiet" in readSpecifics([{ text: "Listed 14 Garden Pl" }])[0]).toBe(false);
    expect(read("src/app/admin/card-builder/edit/[id]/EditView.tsx")).toContain("name={`spec_quiet_${i}`}");
  });
});

describe("two first texts, and LinkedIn by hand", () => {
  it("the two first texts must take different angles", () => {
    expect(checkOutreach(outreach({ uses: { ...WRITTEN.uses, first_text_b: 0 } }), ctx).join(" ")).toMatch(/two first texts are built on the same specific/);
    expect(checkOutreach(outreach({ first_text_b: "" }), ctx).join(" ")).toMatch(/First text, second version: not written/);
  });

  it("the owner's pick decides which one every button sends; unpicked, it is the first", () => {
    const base = { ...preview, outreach: outreach() };
    const unpicked = resolveOutreach(base, { link: LINK, sender: null });
    expect(unpicked.versions).toEqual({ a: WRITTEN.first_text, b: WRITTEN.first_text_b, picked: "a" });
    expect(unpicked.ask).toBe(WRITTEN.first_text);
    const picked = resolveOutreach({ ...preview, outreach: outreach({ first_pick: "b" }) }, { link: LINK, sender: null });
    expect(picked.ask).toBe(WRITTEN.first_text_b);
    expect(picked.versions?.picked).toBe("b");
    expect(resolveOutreach({ ...preview, outreach: outreach({ first_text_b: "" }) }, { link: LINK, sender: null }).versions).toBeNull();
  });

  it("the connection note: 200 characters, no link, no pitch; only expected when their profile was found", () => {
    expect(checkOutreach(outreach({ linkedin_note: "x".repeat(201) }), ctx).join(" ")).toMatch(/201 characters\. A connection note stays at 200 or under/);
    expect(checkOutreach(outreach({ linkedin_note: "Hi Dana, see {link}" }), ctx).join(" ")).toMatch(/LinkedIn connection note: this one carries no link/);
    for (const pitch of ["Hi Dana, I run SwiftCard and", "Hi Dana, I made you a demo", "Hi Dana, here's the card I made"]) {
      expect(checkOutreach(outreach({ linkedin_note: `${pitch} would like to connect.` }), ctx).join(" "), pitch).toMatch(/no pitch/);
    }
    const none = outreach({ linkedin_note: "", linkedin_dm: "", uses: { ...WRITTEN.uses, linkedin_dm: undefined } });
    expect(checkOutreach(none, { ...ctx, linkedin: false })).toEqual([]);
    expect(checkOutreach(none, ctx).join(" ")).toMatch(/LinkedIn connection note: not written/);
  });

  it("the LinkedIn messages only show when there is a profile to open; the profile must be a person's own", () => {
    expect(resolveOutreach({ ...preview, outreach: outreach() }, { link: LINK, sender: null }).linkedin).toEqual({ note: WRITTEN.linkedin_note, dm: WRITTEN.linkedin_dm });
    expect(resolveOutreach({ ...preview, linkedin_url: null, outreach: outreach() }, { link: LINK, sender: null }).linkedin).toBeNull();
    const form = (linkedin_url: string) => parsePreviewFields((k) => ({ office_name: "Harbor", owner_name: "Dana", phone: "7185550199", buyer_role: "broker_owner", linkedin_url } as Record<string, string>)[k]);
    expect(form("https://www.linkedin.com/in/dana-whitfield")).toMatchObject({ ok: true });
    expect(form("https://www.linkedin.com/company/harbor-realty")).toMatchObject({ ok: false });
    expect(form("https://example.com/in/dana")).toMatchObject({ ok: false });
  });

  it("the button copies the words and opens their profile; nothing signs in to LinkedIn or sends there", () => {
    const btn = code("src/app/admin/card-builder/LinkedInButton.tsx");
    expect(btn).toContain("navigator.clipboard?.writeText(words)");
    expect(btn).toContain("href={profile}");
    expect(btn).toContain('target="_blank"');
    for (const f of ["src/lib/prospect-preview/warm.ts", "src/lib/prospect-preview/desk.ts", "src/app/api/admin/card-builder/connections/route.ts", "src/app/admin/card-builder/LinkedInButton.tsx", "src/app/api/admin/card-builder/[id]/route.ts"]) {
      expect(code(f), f).not.toMatch(/api\.linkedin\.com|linkedin\.com\/oauth|fetch\([^)]*linkedin|voyager/i);
    }
  });

  it("\"they accepted\" puts the message for that moment in follow-ups, once, alongside whatever else is due", () => {
    const NOW = Date.parse("2026-11-13T15:00:00Z");
    const at = (d: number) => new Date(NOW - d * 86400_000).toISOString();
    const row = { id: "p1", status: "live" as const, stage: null, called: false, called_at: null, views: 0, last_viewed_at: null, sent_at: at(0.5), asked_at: null, expires_at: at(-10), updated_at: at(0), linkedin_url: "https://www.linkedin.com/in/dana", linkedin_accepted_at: at(0.1) };
    expect(followUps([row], NOW)).toEqual([{ id: "p1", kind: "linkedin_accepted", why: "Accepted your LinkedIn request today.", next: "Send the message.", screen: "send", send: "linkedin_dm" }]);
    expect(followUps([{ ...row, linkedin_dm_at: at(0.05) }], NOW)).toEqual([]);
    expect(followUps([{ ...row, linkedin_url: null }], NOW)).toEqual([]);
    const both = followUps([{ ...row, views: 1, last_viewed_at: at(0.2) }], NOW);
    expect(both.map((f) => f.kind)).toEqual(["viewed_not_reached", "linkedin_accepted"]);
  });
});

describe("warm paths from the owner's own connections", () => {
  const CSV = [
    "Notes:",
    '"When exporting your connection data, you may notice that some of the email addresses are missing."',
    "",
    "First Name,Last Name,URL,Email Address,Company,Position,Connected On",
    'Marcus,Lee,https://www.linkedin.com/in/marcus-lee,,"Harbor Realty Group, LLC",Associate Broker,12 Nov 2026',
    'Ana,"Ruiz, Jr.",https://www.linkedin.com/in/ana-ruiz,ana@x.com,CMG Home Loans,"Loan Officer, Senior",03 Jan 2024',
    "Sam,Park,https://evil.example.com/in/sam,,Compass,Agent,01 Feb 2025",
    ",,,,,,",
    "No,Company,https://www.linkedin.com/in/no-company,,,,05 May 2025",
  ].join("\r\n");

  it("reads LinkedIn's own file: the notes above the header, quoted commas, their dates; nothing is invented", () => {
    const got = parseConnectionsCsv(CSV);
    expect(got.ok).toBe(true);
    if (!got.ok) return;
    expect(got.rows).toHaveLength(4);
    expect(got.rows[0]).toEqual({ first_name: "Marcus", last_name: "Lee", url: "https://www.linkedin.com/in/marcus-lee", company: "Harbor Realty Group, LLC", position: "Associate Broker", connected_on: "2026-11-12", company_key: "harbor realty group" });
    expect(got.rows[1]).toMatchObject({ last_name: "Ruiz, Jr.", position: "Loan Officer, Senior", connected_on: "2024-01-03" });
    expect(got.rows[2].url).toBeNull(); // not a LinkedIn address
    expect(got.rows[3]).toMatchObject({ company: null, company_key: null });
    expect(parseConnectionsCsv("Name,Company\nDana,Harbor")).toMatchObject({ ok: false });
    expect(parseConnectionsCsv("First Name,Last Name\n")).toMatchObject({ ok: false });
  });

  it("matches an office by its name, says when it may be another branch, and never matches on one common word", () => {
    const got = parseConnectionsCsv(CSV);
    if (!got.ok) throw new Error("fixture");
    expect(companyKeyOf("The Harbor Realty Group, LLC")).toBe("harbor realty group");
    expect(connectionsAt("Harbor Realty Group", got.rows)).toEqual([{ name: "Marcus Lee", position: "Associate Broker", url: "https://www.linkedin.com/in/marcus-lee", company: "Harbor Realty Group, LLC", exact: true }]);
    expect(connectionsAt("CMG Home Loans Staten Island Branch", got.rows)).toMatchObject([{ name: "Ana Ruiz, Jr.", exact: false }]);
    expect(connectionsAt("Compass Point Realty", got.rows)).toEqual([]);
    expect(connectionsAt("Compass", got.rows)).toMatchObject([{ name: "Sam Park", exact: true }]);
    expect(connectionsAt("", got.rows)).toEqual([]);
  });

  it("flags the prospect: the path saved at build time wins; otherwise a connection found in the export now", () => {
    const got = parseConnectionsCsv(CSV);
    if (!got.ok) throw new Error("fixture");
    expect(warmPathFor({ office_name: "Harbor Realty Group", owner_name: "Dana Whitfield" }, got.rows)).toEqual({ kind: "connection", name: "Marcus Lee", text: "You're connected on LinkedIn to Marcus Lee, Associate Broker there." });
    expect(warmPathFor({ office_name: "Harbor Realty Group", owner_name: "Marcus Lee" }, got.rows)?.text).toBe("Marcus Lee is already a LinkedIn connection of yours.");
    expect(warmPathFor({ office_name: "CMG Home Loans Staten Island Branch", owner_name: "Joe Curcio" }, got.rows)?.text).toMatch(/at CMG Home Loans, which may be another office of the same firm\.$/);
    expect(warmPathFor({ office_name: "Nobody Realty", owner_name: "X" }, got.rows)).toBeNull();
    const saved = { kind: "school" as const, name: "Baruch College", text: "You both went to Baruch.", source_url: "https://harborrealty.com/about" };
    expect(warmPathFor({ office_name: "Harbor Realty Group", owner_name: "Dana", warm_path: saved }, got.rows)).toBe(saved);
    expect(readWarmPath({ kind: "friend", name: "x", text: "y" })).toBeNull();
    expect(readBackground({ schools: "Baruch College\n NYU ", employers: ["Compass", ""] })).toEqual({ schools: ["Baruch College", "NYU"], employers: ["Compass"] });
  });

  it("with a warm path, the first text must lead with it", () => {
    expect(checkOutreach(outreach(), { ...ctx, warmName: "Marcus Lee" }).join(" ")).toMatch(/there is a warm path \(Marcus Lee\)\. Lead with it/);
    const led = outreach({ first_text: "Hi Dana, Marcus Lee and I are connected. I saw the open house at 88 Hicks St and made you a card. Want it?" });
    expect(checkOutreach(led, { ...ctx, warmName: "Marcus Lee" })).toEqual([]);
  });

  it("the upload is admin only, private, and the file is never kept", () => {
    const route = code("src/app/api/admin/card-builder/connections/route.ts");
    expect(route.indexOf("requireAdmin()")).toBeLessThan(route.indexOf("formData()"));
    expect(route).not.toMatch(/storage\.from|\.upload\(|writeFile/);
    const sql = read("supabase/prospect-previews-round2.sql");
    for (const t of ["prospect_queue", "prospect_batches", "linkedin_connections", "card_builder_settings", "prospect_message_events"]) {
      expect(sql).toContain(`alter table public.${t} enable row level security;`);
      expect(sql).toContain(`revoke all on public.${t} from anon, authenticated;`);
    }
    expect(sql).not.toMatch(/create policy/i);
    for (const f of ["add/page.tsx", "follow-up/page.tsx", "connections/page.tsx"]) {
      const src = code(`src/app/admin/card-builder/${f}`);
      expect(src.indexOf("requireAdmin()"), f).toBeGreaterThan(-1);
      expect(src.indexOf("requireAdmin()"), f).toBeLessThan(src.search(/listQueue\(|listPreviews\(|uploadMeta\(/));
    }
    const queue = code("src/app/api/admin/card-builder/queue/route.ts");
    expect(queue.indexOf("requireAdmin()")).toBeLessThan(queue.indexOf("formData()"));
  });
});

describe("the queue and the batch brief", () => {
  it("each line is one prospect; the notes box is one prospect however long", () => {
    expect(queueItemsFrom("Harbor Realty Group, Brooklyn\n\n  https://www.zillow.com/profile/dana  \nx", "Dana owns Harbor.\nMet her at REBNY.")).toEqual([
      { input: "Harbor Realty Group, Brooklyn", is_notes: false },
      { input: "https://www.zillow.com/profile/dana", is_notes: false },
      { input: "Dana owns Harbor.\nMet her at REBNY.", is_notes: true },
    ]);
    expect(queueItemsFrom("", " ")).toEqual([]);
    expect(queueItemsFrom(Array.from({ length: 100 }, (_, i) => `Office ${i}`).join("\n"), null)).toHaveLength(60);
  });

  const batch = (items: unknown[], over: Partial<Batch> = {}): Batch => ({ id: "b1", created_at: "2026-11-13T02:00:00Z", label: "Brooklyn, brokerages, 25", kind: "tonight", wanted: 25, status: "finished", finished_at: "2026-11-13T07:00:00Z", items: readBatchItems(items), announced_at: null, ...over });
  const draft = (id: string, office: string, over: Partial<PreviewListRow> = {}) => ({ ...preview, id, office_name: office, status: "draft", ...over }) as PreviewListRow;

  it("says how many drafts are waiting, best score first, and how many were skipped and why", () => {
    const strong = { detail: "your open house at 88 Hicks St this Sunday", hook_specific: 0, hook_angle: "open_house", hook_why: "Everyone who walks in can tap your card.", sources: { buyer_role: { url: "https://a.com/x", uncertain: false, note: "" }, buyer_second: { url: "https://b.com/y", uncertain: false, note: "" } } } as Partial<PreviewListRow>;
    const rows = [draft("p1", "Thin Realty"), draft("p2", "Harbor Realty Group", strong), draft("p3", "Approved Realty", { status: "live" }), draft("p4", "Skipped Realty", { skipped_at: "2026-11-13T09:00:00Z" })];
    const b = batchBrief(batch([
      { office: "Thin Realty", outcome: "built", preview_id: "p1" }, { office: "Harbor Realty Group", outcome: "built", preview_id: "p2" },
      { office: "Approved Realty", outcome: "built", preview_id: "p3" }, { office: "Skipped Realty", outcome: "built", preview_id: "p4" },
      { office: "A", outcome: "skipped", reason: "already contacted" }, { office: "B", outcome: "skipped", reason: "already contacted" },
      { office: "C", outcome: "failed", reason: "their site wouldn't load" }, { office: "", outcome: "built" }, { office: "D", outcome: "nonsense" },
    ]), rows);
    expect(b.built).toBe(4);
    expect(b.ready.map((r) => r.office)).toEqual(["Harbor Realty Group", "Thin Realty"]);
    expect(b.ready[0].score).toBeGreaterThan(b.ready[1].score);
    expect(b.ready[1].tooGeneric).toBe(true);
    expect(b.skippedCount).toBe(3);
    expect(b.skipped).toEqual([{ reason: "already contacted", offices: ["A", "B"] }, { reason: "their site wouldn't load", offices: ["C"] }]);
    expect(batchPush(b)).toEqual({ title: "2 drafts ready to approve", body: `Best: Harbor Realty Group, ${b.ready[0].score} of 100. 3 skipped.` });
  });

  it("one push per batch, sent by the app: now-batches from 8am to 10pm, tonight-batches from 8am and never the evening before", () => {
    const at = (hourUtc: string) => Date.parse(`2026-11-13T${hourUtc}:00Z`);
    expect(batchKindsDue(at("12:30"))).toEqual([]); // 7:30am
    expect(batchKindsDue(at("13:00"))).toEqual(["now", "tonight"]); // 8am
    expect(batchKindsDue(at("23:30"))).toEqual(["now"]); // 6:30pm
    expect(batchKindsDue(Date.parse("2026-11-14T03:30:00Z"))).toEqual([]); // 10:30pm
    const desk = code("src/lib/prospect-preview/desk.ts");
    expect(desk).toMatch(/update\(\{ announced_at: now\.toISOString\(\) \}\)\.eq\("status", "finished"\)\.is\("announced_at", null\)/);
    expect(desk).not.toMatch(/sendPushToUser|twilio|resend/i);
    const digest = code("src/lib/prospect-preview/digest.ts");
    expect(digest.indexOf("claimUnannouncedBatches(")).toBeLessThan(digest.lastIndexOf("sendPushToUser("));
    expect(read("supabase/clock-push-jobs.sql")).toContain("select cron.schedule('prospect-follow-ups', '*/5 * * * *',");
  });

  it("a rerun resumes: the same words within a day and unfinished is the same batch", () => {
    const desk = code("src/lib/prospect-preview/desk.ts");
    expect(desk).toMatch(/\.eq\("label", label\)\.eq\("status", "running"\)\.gte\("created_at", since\)/);
    expect(desk).toContain("if (open?.length) return { batch: toBatch(open[0]), resumed: true };");
    expect(desk).toContain("i.office.toLowerCase() !== clean.office.toLowerCase()");
  });
});

describe("learning from the owner", () => {
  const ev = (over: Partial<MessageEvent>): MessageEvent => ({ at: "2026-11-10T15:00:00Z", preview_id: "p1", kind: "sent", message: "ask", variant: null, before: null, after: null, ...over });

  it("an edit is what changed, message by message; untouched and newly written ones aren't edits", () => {
    const before = outreach();
    const after = outreach({ first_text: "Hi Dana, it's Menash. Want the card I made for 88 Hicks?", voicemail: WRITTEN.voicemail });
    expect(outreachEdits(before, after)).toEqual([{ message: "first_text", before: WRITTEN.first_text, after: "Hi Dana, it's Menash. Want the card I made for 88 Hicks?" }]);
    expect(outreachEdits(null, after)).toEqual([]);
    const route = code("src/app/api/admin/card-builder/[id]/route.ts");
    expect(route).toMatch(/outreachEdits\(p\.outreach \?\? null, outreach\)\.map\(\(e\) => \(\{ preview_id: id, kind: "edit" as const/);
    expect(route).toContain('kind: "pick", message: "first_text", variant: pick');
    expect(route).toContain('kind: "sent", message: kind, variant: kind === "ask" && m.versions ? m.versions.picked : null');
  });

  it("the style notes are the owner's own words: their edits, their picks, and what they reworded before sending", () => {
    const notes = styleNotes([
      ev({ kind: "edit", message: "first_text", before: "Hi Dana, I hope you're well.", after: "Hi Dana, it's Menash.", at: "2026-11-12T10:00:00Z" }),
      ev({ kind: "pick", message: "first_text", variant: "b" }), ev({ kind: "pick", message: "first_text", variant: "b", preview_id: "p2" }), ev({ kind: "pick", message: "first_text", variant: "a", preview_id: "p3" }),
      ev({ kind: "sent", message: "text", before: "Dana, here's the card: x", after: "Dana, card's here: x" }),
      ev({ kind: "sent", message: "ask", before: "same", after: "same" }),
    ]);
    expect(notes.edits).toEqual([{ message: "first_text", before: "Hi Dana, I hope you're well.", after: "Hi Dana, it's Menash." }]);
    expect(notes.picks).toEqual({ a: 1, b: 2 });
    expect(notes.sent_as).toEqual([{ message: "text", words: "Dana, card's here: x" }]);
  });

  it("per message and per version: sent, then viewed, picked up and booked, each prospect once", () => {
    const rows = [
      { ...preview, id: "p1", last_viewed_at: "2026-11-11T15:00:00Z", views: 1, called: true, called_at: "2026-11-11T16:00:00Z", stage: "meeting_booked" },
      { ...preview, id: "p2", last_viewed_at: "2026-11-11T15:00:00Z", views: 1 },
      { ...preview, id: "p3" },
      { ...preview, id: "p4", last_viewed_at: "2026-11-09T15:00:00Z", views: 1 }, // looked BEFORE the message went
    ] as PreviewListRow[];
    const stats = messageStats([
      ev({ preview_id: "p1", variant: "a" }), ev({ preview_id: "p1", variant: "a", at: "2026-11-10T16:00:00Z" }), // pressed twice: once
      ev({ preview_id: "p2", variant: "b" }), ev({ preview_id: "p3", variant: "b" }), ev({ preview_id: "p4", variant: "b" }),
      ev({ preview_id: "p1", message: "text" }), ev({ preview_id: "gone", message: "text" }),
      ev({ kind: "edit", preview_id: "p1" }),
    ], rows);
    expect(stats).toEqual([
      { message: "ask", variant: "a", sent: 1, viewed: 1, picked_up: 1, booked: 1 },
      { message: "ask", variant: "b", sent: 3, viewed: 1, picked_up: 0, booked: 0 },
      { message: "text", variant: null, sent: 1, viewed: 1, picked_up: 1, booked: 1 },
    ]);
  });
});

describe("the main page is three buttons", () => {
  const view = read("src/app/admin/card-builder/CardBuilderView.tsx");
  it("Approve, Call and follow up, Add, each with a count; the rest is under Details and More", () => {
    for (const label of ['label="Approve"', 'label="Call and follow up"', 'label="Add"']) expect(view).toContain(label);
    expect(view).toContain('<details data-section="details">');
    expect(view).toContain('<details data-section="more">');
    // The create form and the follow-up list each have a screen of their own now.
    expect(view).not.toContain('action="/api/admin/card-builder"');
    expect(view).not.toContain("data-follow-up");
    expect(read("src/app/admin/card-builder/add/AddView.tsx")).toContain('action="/api/admin/card-builder" className');
    expect(read("src/app/admin/card-builder/follow-up/FollowUpView.tsx")).toContain("data-follow-up={f.kind}");
    expect(view).not.toContain("PROSPECT_CALENDAR_URL");
  });
});
