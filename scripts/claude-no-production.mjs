#!/usr/bin/env node
// A Claude Code hook (.claude/settings.json, PreToolUse). It stops an agent
// from opening the live site or a Vercel deployment in a browser, fetching it,
// or pointing a QA script at it.
//
// WHY: agent sessions "verifying in a real browser" and the QA workflows drove
// swiftcard.me hard enough that Vercel switched the site off for going over
// its limits (November 2026). CLAUDE.md now says tests, verification and
// agents run against a local build only; this makes that a wall, not a note.
//
// One read is allowed: /api/health, which is how a session confirms which
// commit is live after a deploy (AGENTS.md). Nothing here stops the owner:
// a command typed with `!` in the prompt does not pass through this hook.
import { readFileSync } from "node:fs";

const FORBIDDEN = /https?:\/\/(?:[a-z0-9-]+\.)*(?:swiftcard\.(?:me|app)|vercel\.app)(?![a-z0-9.-])[^\s"'`)]*/gi;
const HEALTH_ONLY = /^https?:\/\/(?:www\.)?swiftcard\.me\/api\/health(?:\?[^\s]*)?$/i;

/** The reason a tool call is refused, or null. Exported for the unit test. */
export function refusal(toolName, input) {
  const name = String(toolName || "");
  const urls = (text) => (String(text || "").match(FORBIDDEN) || []).filter((u) => !HEALTH_ONLY.test(u));

  if (name === "Bash") {
    const cmd = String(input?.command || "");
    // Writing about the site is fine (commit messages, PR bodies, greps).
    if (/^\s*(git|gh|grep|rg|echo|cat|sed|awk|ls|printf)\b/.test(cmd) && !/[|;&]\s*(curl|wget|node|npx|npm|BASE=)/.test(cmd)) return null;
    const pointed = cmd.match(/\b(?:BASE|ADMIN_BASE|SWEEP_BASE|HEALTH_BASE_URL)=["']?([^\s"']+)/g) || [];
    for (const p of pointed) if (urls(p).length) return `it points a script at ${urls(p)[0]}`;
    for (const part of cmd.split(/&&|\|\||;|\n/)) {
      if (/\b(curl|wget|playwright|lighthouse|autocannon|k6|hey|ab)\b/.test(part) && urls(part).length) {
        return `it sends requests to ${urls(part)[0]}`;
      }
    }
    return null;
  }
  // Browser navigation and page fetches (Playwright, Chrome, WebFetch).
  if (/navigate|tabs_create|WebFetch|web_fetch/i.test(name)) {
    const hit = urls(input?.url);
    if (hit.length) return `it opens ${hit[0]}`;
  }
  return null;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  let event = {};
  try { event = JSON.parse(readFileSync(0, "utf8") || "{}"); } catch { /* no input: allow */ }
  const why = refusal(event.tool_name, event.tool_input);
  if (why) {
    console.error(
      `Blocked: ${why}. Tests, verification and agents never run against the live site or a Vercel preview (CLAUDE.md). ` +
      `Use a local build: npx next build && npx next start -p 3222, then http://localhost:3222. ` +
      `If the owner really wants this run on production, they run it themselves.`,
    );
    process.exit(2);
  }
  process.exit(0);
}
