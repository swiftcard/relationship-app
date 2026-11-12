#!/usr/bin/env node
// ── Card Builder from the command line ───────────────────────────────────────
// What the /find-offices and /build-card project commands run. It writes to
// the REAL database (the one in .env.local), with the same checks the admin
// screens apply, and it can only ever make DRAFTS: nothing here publishes a
// preview or sends a message.
//
//   node scripts/card-builder.mjs leads [--area "<regex>"] [--limit 20]
//       Office leads already in crew_leads that have no preview and haven't
//       been contacted, best fit first.
//   node scripts/card-builder.mjs check <candidates.json>
//       For each candidate office: already a lead? already has a preview?
//       already contacted or on the do-not-contact list?
//   node scripts/card-builder.mjs save-leads <leads.json>
//       Save decision-makers to crew_leads (the Office list), ranked by fit.
//   node scripts/card-builder.mjs colors <logo https url> [website https url]
//       Brand colours read from the logo (or the site's theme colour).
//   node scripts/card-builder.mjs create-draft <preview.json>
//   node scripts/card-builder.mjs update-draft <preview id> <preview.json>
//       Make or change a DRAFT preview. A published one is never touched.
//   node scripts/card-builder.mjs shots <preview id> [out dir]
//       The preview page as a phone (390px) and a computer (1280px) see it,
//       as PNG files, plus anything that looks wrong (broken pictures, text
//       pushed off the screen).
//
// The JSON shapes are in tests/tools/card-builder.tool.ts. Every command
// prints JSON. Secrets: the environment first, .env.local second.

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const env = { ...process.env };
if (existsSync(join(ROOT, ".env.local"))) {
  for (const line of readFileSync(join(ROOT, ".env.local"), "utf8").split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && env[m[1]] === undefined) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
}

const args = process.argv.slice(2);
if (!args.length) {
  console.error(readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").filter((l) => l.startsWith("//")).map((l) => l.slice(3)).join("\n"));
  process.exit(2);
}
// File arguments are resolved here, where the caller's working directory is known.
const FILE_ARG = { check: [1], "save-leads": [1], "create-draft": [1], "update-draft": [2], shots: [2] };
for (const i of FILE_ARG[args[0]] ?? []) if (args[i]) args[i] = resolve(process.cwd(), args[i]);

const out = join(mkdtempSync(join(tmpdir(), "card-builder-")), "result.json");
const run = spawnSync("npx", ["vitest", "run", "--config", "vitest.card-tool.config.ts"], {
  cwd: ROOT,
  env: { ...env, CARD_TOOL_ARGS: JSON.stringify(args), CARD_TOOL_OUT: out },
  encoding: "utf8",
});
if (!existsSync(out)) {
  console.error(run.stdout, run.stderr);
  console.error("card-builder: the tool did not finish (see above).");
  process.exit(1);
}
const result = readFileSync(out, "utf8");
console.log(result);
process.exit(JSON.parse(result).ok === false ? 1 : 0);
