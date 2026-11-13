import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

// The /find-offices and /build-card project commands and the tool they run
// (scripts/card-builder.mjs → tests/tools/card-builder.tool.ts). The tool
// writes to the real database from a laptop, so what it can never do is pinned.

const tool = readFileSync("tests/tools/card-builder.tool.ts", "utf8");
const find = readFileSync(".claude/commands/find-offices.md", "utf8");
const build = readFileSync(".claude/commands/build-card.md", "utf8");
const batch = readFileSync(".claude/commands/build-batch.md", "utf8");

describe("the Card Builder tool", () => {
  it("only ever makes drafts, and only ever changes drafts", () => {
    expect(tool.match(/status: "[a-z]+"/g)).toEqual(['status: "draft"']);
    expect(tool).toMatch(/\.update\(\{ \.\.\.fields, updated_at: [^}]+\}\)\.eq\("id", id\)\.eq\("status", "draft"\)/);
    expect(tool).not.toMatch(/publishPreview|markSent|"live"/);
  });

  it("checks a preview with the same parser as the admin's edit screen (buyer role, headshot source, https)", () => {
    expect(tool).toContain("const parsed = parsePreviewFields((k) => flat[k]);");
    expect(tool).toContain("if (!parsed.ok) throw new Error(parsed.error);");
  });

  it("saves leads through the agents' own recorder, refuses non-buyers and unsourced people, and skips anyone already contacted", () => {
    expect(tool).toContain("await recordLeads(ctx, rows)");
    expect(tool).toMatch(/BUYER_ROLES as readonly string\[\]\)\.includes\(str\(l\.buyer_role\)\)\) \{ refuse\(/);
    expect(tool).toMatch(/if \(!source\) \{ refuse\(/);
    expect(tool).toMatch(/if \(s\.skip \|\| s\.lead_id\) \{ refuse\(/);
    expect(tool).toContain('.neq("kind", "lead_listed")');
    expect(tool).toContain('from("crew_suppression")');
  });

  it("saves the written messages only on a draft, only when they pass every rule, and never sets the owner's marks by itself", () => {
    expect(tool).toContain('const problems = checkOutreach(outreach, { link, specifics: p.specifics, complete: true });');
    expect(tool).toMatch(/if \(problems\.length\) throw new Error\(`Not saved\./);
    expect(tool).toMatch(/\.update\(\{ outreach, updated_at: [^}]+\}\)\.eq\("id", id\)\.eq\("status", "draft"\)/);
    // "Confirmed by the owner" must carry the owner's own words.
    expect(tool).toMatch(/sources\[k\]\?\.owner === true && !str\(sources\[k\]\?\.note\)\) throw new Error/);
    expect(tool).not.toMatch(/setSkipped|skipped_at|nudge_\w+_at/);
  });

  it("deletes nothing, sends nothing, and never runs as part of the test suites", () => {
    expect(tool).not.toMatch(/\.delete\(\)|sendPushToUser|sendEmail|resend|twilio/i);
    expect(readFileSync("vitest.config.ts", "utf8")).toContain('include: ["tests/**/*.test.ts"]');
    expect(readFileSync("vitest.render.config.ts", "utf8")).toContain('include: ["tests/render/**/*.test.ts"]');
    expect(readFileSync("vitest.card-tool.config.ts", "utf8")).toContain('include: ["tests/tools/card-builder.tool.ts"]');
  });
});

describe("the commands", () => {
  it("/find-offices starts with existing leads, names the four buyer roles, and builds nothing", () => {
    expect(find).toContain("$ARGUMENTS");
    expect(find.indexOf("card-builder.mjs leads")).toBeLessThan(find.indexOf("card-builder.mjs check"));
    for (const role of ["broker_owner", "managing_broker", "team_lead", "branch_manager"]) expect(find).toContain(role);
    expect(find).toMatch(/Do not build cards/);
    expect(find).not.toContain("create-draft");
  });

  it("/build-card makes a draft, looks at it at both widths, and neither publishes nor sends", () => {
    expect(build).toContain("$ARGUMENTS");
    for (const step of ["card-builder.mjs check", "card-builder.mjs colors", "card-builder.mjs create-draft", "card-builder.mjs shots", "card-builder.mjs update-draft"]) expect(build).toContain(step);
    expect(build).toMatch(/Do not publish it and do not send/);
    expect(build).toMatch(/Never guess/);
    expect(build).toMatch(/headshot only from their own business website or their brokerage\s+profile/);
  });

  it("/build-card takes a name and city, a link or the owner's notes, writes the outreach itself and replies with all of it", () => {
    for (const input of ["An office or a person, plus a city", "A link", "Pasted notes or details from the owner"]) expect(build).toContain(input);
    expect(build).toMatch(/confirmed by the owner/i);
    expect(build).toContain('"owner": true');
    expect(build).toMatch(/Only for what they actually wrote/);
    expect(build).toContain("card-builder.mjs set-outreach");
    for (const m of ["first_text", "link_text", "email_body", "call_opener", "voicemail", "nudge_no_view", "nudge_viewed"]) expect(build).toContain(m);
    expect(build).toMatch(/160 characters at most/);
    expect(build).toMatch(/No emojis\. Never the word "free"/);
    expect(build).toMatch(/never\s+calls a paid API/);
    expect(build).toMatch(/the full outreach, word for word/);
    // The rules that stay.
    expect(build).toMatch(/Verify the decision-maker against a second source/);
    expect(build).toMatch(/Public business information only/);
  });

  it("/build-batch finds, then builds drafts one after another, skips the contacted, and ends with one table; it publishes and sends nothing", () => {
    expect(batch).toContain("$ARGUMENTS");
    expect(batch.indexOf("find-offices.md")).toBeLessThan(batch.indexOf("build-card.md"));
    expect(batch).toMatch(/One at a time/);
    expect(batch).toMatch(/already contacted, on the do-not-contact\s+list, or already has a preview/);
    expect(batch).toContain("| Office | Decision-maker | Score | Hook | Draft link | Couldn't confirm |");
    expect(batch).toMatch(/Do not publish\s+anything and do not send anything to anyone/);
    expect(batch).toMatch(/don't lower the bar/);
  });
});
