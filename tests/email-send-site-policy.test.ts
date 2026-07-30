import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, sep } from "node:path";

// STRUCTURAL GUARD (labelled as such).
//
// This is the test that would have caught the office-invite bug. The invite was
// the ONLY send site calling resend.emails.send() without unsubscribe headers,
// which is how it drifted away from every other email in the app and became the
// only one landing in spam. A new header-less send site must now be justified
// here in writing rather than added silently.

const ALLOWED: Record<string, string> = {
  "src/app/api/contact/route.ts":
    "Contact form -> OUR OWN inbox. Not mail to a subscriber; no opt-out applies.",
  "src/app/api/stripe/webhook/route.ts":
    "Legal receipts to a customer who just paid. Adding one-click unsubscribe to a receipt is worse, not better.",
};

// Strip comments before scanning — prose ABOUT a send site is not a send site.
// (Without this, the comment in the invite route explaining that it no longer
// calls resend.emails.send() directly registered as a violation.)
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (entry.endsWith(".ts") || entry.endsWith(".tsx")) out.push(full);
  }
  return out;
}

describe("email send-site policy", () => {
  it("every resend.emails.send() attaches unsubscribe headers or is explicitly excused", () => {
    const root = process.cwd();
    const offenders: string[] = [];

    for (const file of walk(join(root, "src"))) {
      const src = stripComments(readFileSync(file, "utf8"));
      if (!src.includes("resend.emails.send")) continue;

      // ALLOWED keys are posix paths; walk() yields native ones (backslashes on
      // Windows), so normalise before the lookup or every excuse silently misses.
      const rel = file.slice(root.length + 1).split(sep).join("/");
      if (ALLOWED[rel]) continue;

      // Either it passes a headers key, or it goes through the shared layer.
      const attachesHeaders = /headers:\s*(unsubHeaders|marketingHeaders)/.test(src)
        || /\.\.\.\(\s*unsub\s*\?\s*\{\s*headers:/.test(src);
      if (!attachesHeaders) offenders.push(rel);
    }

    expect(offenders, `send sites with no unsubscribe headers and no written excuse: ${offenders.join(", ")}`).toEqual([]);
  });

  it("the office invite goes through the shared send layer, not its own Resend client", () => {
    const src = readFileSync(join(process.cwd(), "src/app/api/office/invite/route.ts"), "utf8");
    expect(src).not.toContain("new Resend(");
    expect(src).toContain("sendRawEmail(");
    // The suppression gate every other third-party send already had.
    expect(src).toContain('isOptedOut("email"');
  });
});
