import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

// The /find-offices and /build-card project commands and the tool they run
// (scripts/card-builder.mjs → tests/tools/card-builder.tool.ts). The tool
// writes to the real database from a laptop, so what it can never do is pinned.

const tool = readFileSync("tests/tools/card-builder.tool.ts", "utf8");
const find = readFileSync(".claude/commands/find-offices.md", "utf8");
const build = readFileSync(".claude/commands/build-card.md", "utf8");

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
});
