import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// ── Audit round 35 (2026-10-18): notices that don't depend on one email ─────
//
// NM-04  A failed payment wrote its bell row and push only after the email
//        went out, so no address or a Resend failure left no trace at all.
// NM-11  The trial-ending email was claimed before sending and the claim was
//        never given back, so one Resend error meant no notice, ever.
// E-01   ENV_KEYS_NEEDED.md had drifted: dozens of keys the code reads were
//        undocumented. Now every key read under src/ must have a row.

const read = (p: string) => readFileSync(p, "utf8");

function body(src: string, signature: string): string {
  const at = src.indexOf(signature);
  expect(at, signature).toBeGreaterThan(-1);
  let depth = 0;
  // The body's brace, not one inside the parameter types.
  for (let i = src.indexOf(") {\n", at) + 2; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(at, i + 1);
  }
  throw new Error("unbalanced " + signature);
}

describe("NM-04: a failed payment always reaches the bell and the phone", () => {
  const fn = body(read("src/app/api/stripe/webhook/route.ts"), "async function sendPaymentFailedEmail(");

  it("no early return between the profile and the bell row except a duplicate", () => {
    const bell = fn.indexOf("await writeNotification({");
    expect(bell).toBeGreaterThan(-1);
    const before = fn
      .slice(fn.indexOf("if (!profile) return;") + "if (!profile) return;".length, bell)
      .replace(/\/\/.*$/gm, "");
    expect(before).not.toMatch(/\breturn\b/);
    expect(fn).toContain("if (accountEmail) {");
    expect(fn.indexOf('reportError("billing.email.payment_failed"')).toBeLessThan(bell);
    expect(fn.slice(bell)).toContain('if (wrote === "duplicate") return;');
  });
});

describe("NM-11: a trial-ending email that fails is tried again", () => {
  it("claims one key, and gives it back when the send fails", () => {
    const src = read("src/app/api/reminders/route.ts");
    expect(src).toContain('await mergeCustomization(u.id as string, { set: { _proWarnedFor: expiresAt }, remove: [] }, { admin: supabase });');
    expect(src).not.toContain("customization: { ...cust, _proWarnedFor: expiresAt }");
    const fail = src.indexOf('reportError("reminders.trial-ending-soon.email"');
    expect(src.slice(fail, fail + 300)).toContain('await mergeCustomization(u.id as string, { set: {}, remove: ["_proWarnedFor"] }, { admin: supabase });');
  });
});

describe("E-01: every environment key the code reads is documented", () => {
  // Set by Vercel or Node, never by hand.
  const RUNTIME = new Set(["NODE_ENV", "NEXT_RUNTIME", "PORT", "VERCEL_ENV", "VERCEL_URL", "VERCEL_BRANCH_URL", "VERCEL_GIT_COMMIT_SHA", "NEXT_PUBLIC_VERCEL_ENV"]);

  function* files(dir: string): Generator<string> {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) yield* files(p);
      else if (/\.(ts|tsx|js|mjs)$/.test(name)) yield p;
    }
  }

  it("has a row in ENV_KEYS_NEEDED.md", () => {
    const keys = new Set<string>();
    for (const f of files("src")) for (const m of read(f).matchAll(/process\.env\.([A-Z0-9_]+)/g)) keys.add(m[1]);
    expect(keys.size).toBeGreaterThan(50);
    const doc = read("ENV_KEYS_NEEDED.md");
    const missing = [...keys].filter((k) => !RUNTIME.has(k) && !doc.includes("`" + k + "`")).sort();
    expect(missing).toEqual([]);
  });
});
