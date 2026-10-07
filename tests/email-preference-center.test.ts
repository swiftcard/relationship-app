import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  allowsMarketing,
  isPaused,
  DEFAULT_PREFERENCES,
  MARKETING_CATEGORIES,
  type EmailPreferences,
} from "@/lib/marketing-consent";
import { signEmailToken, verifyEmailToken, EMAIL_TOKEN_TTL_DAYS } from "@/lib/email-token";

// ── The preference centre, and the compliance rules it exists to keep ────────
//
// These are not style pins. Each one stands for a legal or deliverability
// requirement that someone will eventually be tempted to "simplify":
//
//   • CAN-SPAM: an opt-out must be honoured, and honoured everywhere.
//   • Gmail/Yahoo bulk-sender rules (Feb 2024): one-click unsubscribe must be a
//     POST that works, and must take effect immediately.
//   • The opt-out path must not be buried, gated, or slowed down.
//
// See docs/EMAIL-PREFERENCE-CENTER.md before weakening anything here.

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8");

const prefs = (over: Partial<EmailPreferences> = {}): EmailPreferences => ({
  user_id: "u1",
  ...DEFAULT_PREFERENCES,
  ...over,
});

const NOW = Date.parse("2026-09-06T12:00:00Z");

describe("canSendMarketing: a suppressed user is never sent a marketing email", () => {
  it("a full opt-out blocks every category", () => {
    const p = prefs({ marketing_opt_out: true });
    for (const c of MARKETING_CATEGORIES) expect(allowsMarketing(p, c, NOW), c).toBe(false);
  });

  it("the LEGACY flag alone still blocks every category", () => {
    // Older senders wrote only marketing_emails. An opt-out recorded before the
    // preference centre existed must keep working, or we resume mailing people
    // who already unsubscribed — the worst possible regression here.
    const p = prefs({ marketing_emails: false });
    for (const c of MARKETING_CATEGORIES) expect(allowsMarketing(p, c, NOW), c).toBe(false);
  });

  it("a live pause blocks every category, and an expired one blocks nothing", () => {
    const paused = prefs({ paused_until: new Date(NOW + 86400000).toISOString() });
    for (const c of MARKETING_CATEGORIES) expect(allowsMarketing(paused, c, NOW), c).toBe(false);
    expect(isPaused(paused, NOW)).toBe(true);

    const over = prefs({ paused_until: new Date(NOW - 1000).toISOString() });
    for (const c of MARKETING_CATEGORIES) expect(allowsMarketing(over, c, NOW), c).toBe(true);
    expect(isPaused(over, NOW)).toBe(false);
  });

  it("a category switch blocks ONLY its own category", () => {
    for (const off of MARKETING_CATEGORIES) {
      const p = prefs({ [off]: false } as Partial<EmailPreferences>);
      for (const c of MARKETING_CATEGORIES) {
        expect(allowsMarketing(p, c, NOW), `${off} off → ${c}`).toBe(c !== off);
      }
    }
  });

  it("an unreadable row sends nothing — fail closed", () => {
    for (const c of MARKETING_CATEGORIES) expect(allowsMarketing(null, c, NOW), c).toBe(false);
  });

  it("a fresh account with everything on receives everything", () => {
    for (const c of MARKETING_CATEGORIES) expect(allowsMarketing(prefs(), c, NOW), c).toBe(true);
  });
});

describe("transactional sends still go through", () => {
  // The proof is structural: the transactional templates never take an
  // unsubscribe or preference URL, their senders never call the gate, and the
  // receipt path reads its OWN switch (receipt_emails), not the marketing ones.
  it("billing templates carry no unsubscribe or preference link", () => {
    const tpl = read("src/lib/email-templates.ts");
    for (const fn of ["receiptEmail", "trialStartedEmail", "paymentFailedEmail"]) {
      const at = tpl.indexOf(`export function ${fn}`);
      expect(at, fn).toBeGreaterThan(-1);
      const body = tpl.slice(at, tpl.indexOf("\n}", at));
      expect(body, `${fn} must not offer an unsubscribe`).not.toMatch(/unsubscribeUrl|prefsUrl/);
      expect(body, `${fn} must not carry marketing headers`).not.toMatch(/marketingHeaders/);
    }
  });

  it("no transactional sender calls the marketing gate", () => {
    for (const p of [
      "src/app/api/stripe/webhook/route.ts",   // receipts, trial started, payment failed
      "src/app/api/leads/route.ts",            // lead notifications
      "src/app/api/leads/share-card/route.ts", // a user sharing their own card
      "src/app/api/welcome/route.ts",          // account provisioning
    ]) {
      expect(read(p), p).not.toMatch(/canSendMarketing|marketingAudience/);
    }
  });

  it("receipts are gated by receipt_emails only, never by a marketing preference", () => {
    const hook = read("src/app/api/stripe/webhook/route.ts");
    expect(hook).toMatch(/receipt_emails/);
    expect(hook).not.toMatch(/marketing_opt_out|paused_until/);
  });
});

describe("every marketing sender goes through the gate", () => {
  const senders: [string, RegExp][] = [
    ["src/app/api/admin/broadcast/route.ts", /marketingAudience\(/],
    ["src/app/api/admin/promo-codes/send/route.ts", /canSendMarketing\(/],
    ["src/app/api/reminders/route.ts", /canSendMarketing\(/],
  ];
  for (const [file, re] of senders) {
    it(`${file} checks preferences before sending`, () => {
      expect(read(file)).toMatch(re);
    });
  }

  it("and each one carries the preference link in its footer", () => {
    for (const [file] of senders) expect(read(file), file).toMatch(/prefsUrl: preferenceCenterUrl\(/);
  });
});

describe("the signed link", () => {
  const prev = process.env.OAUTH_SECRET;
  beforeEach(() => { process.env.OAUTH_SECRET = "test-secret-for-email-tokens"; });
  afterEach(() => { if (prev === undefined) delete process.env.OAUTH_SECRET; else process.env.OAUTH_SECRET = prev; });

  it("round-trips the user id", () => {
    const t = signEmailToken("user-abc", NOW);
    expect(verifyEmailToken(t, NOW)).toEqual({ ok: true, userId: "user-abc" });
  });

  it("expires after 90 days, not before", () => {
    const t = signEmailToken("user-abc", NOW);
    const almost = NOW + (EMAIL_TOKEN_TTL_DAYS * 86400 - 60) * 1000;
    expect(verifyEmailToken(t, almost).ok).toBe(true);
    const after = NOW + (EMAIL_TOKEN_TTL_DAYS * 86400 + 60) * 1000;
    expect(verifyEmailToken(t, after)).toEqual({ ok: false, reason: "expired" });
  });

  it("a tampered id or expiry is rejected", () => {
    const t = signEmailToken("user-abc", NOW);
    const [id, exp, sig] = t.split(".");
    const other = Buffer.from("user-xyz").toString("base64url");
    expect(verifyEmailToken(`${other}.${exp}.${sig}`, NOW).ok).toBe(false);
    const far = Buffer.from(String(Math.floor(NOW / 1000) + 999999)).toString("base64url");
    expect(verifyEmailToken(`${id}.${far}.${sig}`, NOW).ok).toBe(false);
  });

  it("junk is rejected without throwing", () => {
    for (const t of ["", "a", "a.b", "a.b.c.d", null, undefined]) {
      expect(() => verifyEmailToken(t as string, NOW)).not.toThrow();
      expect(verifyEmailToken(t as string, NOW).ok).toBe(false);
    }
  });

  it("refuses to SIGN without a server secret, rather than signing with a constant", () => {
    delete process.env.OAUTH_SECRET;
    const prevCron = process.env.CRON_SECRET;
    delete process.env.CRON_SECRET;
    expect(() => signEmailToken("user-abc", NOW)).toThrow();
    // …but verification degrades instead of 500ing the one-click endpoint.
    expect(verifyEmailToken("a.b.c", NOW)).toEqual({ ok: false, reason: "unconfigured" });
    if (prevCron !== undefined) process.env.CRON_SECRET = prevCron;
  });
});

describe("one-click unsubscribe (RFC 8058)", () => {
  const src = read("src/app/api/email/one-click-unsubscribe/route.ts");

  it("is a POST route handler, never a page", () => {
    expect(src).toMatch(/export async function POST/);
  });

  it("NEVER redirects — a provider follows a 3xx and records a false success", () => {
    expect(src).not.toMatch(/NextResponse\.redirect/);
    expect(src).not.toMatch(/\/email\/preferences/);
  });

  it("takes effect through the shared writer, so both flags and the audit row land", () => {
    expect(src).toMatch(/recordOptOut\(\{ userId: check\.userId, source: "one_click_header" \}\)/);
  });

  it("does nothing on GET — a link scanner must not unsubscribe anyone", () => {
    const get = src.slice(src.indexOf("export async function GET"));
    expect(get).not.toMatch(/recordOptOut/);
  });

  it("returns 503 when the write fails, so the provider retries", () => {
    expect(src).toMatch(/status: 503/);
  });
});

describe("the page keeps the opt-out two clicks away and visible", () => {
  const ui = read("src/components/email/PreferenceCenter.tsx");

  it("the link is body-size, full-contrast ink, and not hidden behind a disclosure", () => {
    const at = ui.indexOf("Unsubscribe from all marketing emails");
    expect(at).toBeGreaterThan(-1);
    const block = ui.slice(ui.lastIndexOf("<button", at), at);
    // text-sm is the body size used by every other control on this page, and
    // INK is the same colour as the headings — not a muted grey.
    expect(block).toMatch(/className="text-sm underline"/);
    expect(block).toMatch(/color: INK/);
    expect(block).not.toMatch(/text-xs|opacity|MUTED/);
  });

  it("opening the panel and confirming is exactly two clicks, on this page", () => {
    // Click 1 opens the inline panel…
    expect(ui).toMatch(/onClick=\{\(\) => setPanelOpen\(true\)\}/);
    // …click 2 completes it. No confirm(), no second screen, no navigation.
    expect(ui).toMatch(/No thanks, unsubscribe me/);
    expect(ui).toMatch(/post\("unsubscribe"\)/);
    expect(ui).not.toMatch(/window\.confirm|router\.push|<Link/);
  });

  it("the survey is optional and gates nothing", () => {
    // Just the done branch, and just its MARKUP — comments in here talk about
    // "required" fields, which is what a naive regex over the whole tail hits.
    const done = ui
      .slice(ui.indexOf("if (done)"), ui.indexOf("Choose what you want"))
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    expect(done).toMatch(/You&apos;re unsubscribed\./);
    expect(done).toMatch(/You&apos;ll still receive account and lead notifications\./);
    // The reasons are buttons — no field to fill in, nothing to submit, and
    // they render only AFTER the opt-out has already been recorded.
    expect(done).not.toMatch(/<input|<form|required=/);
    expect(done).toMatch(/REASONS\.map/);
  });

  it("offers a pause before the exit, but never instead of it", () => {
    expect(ui).toMatch(/Before you go, would a break work instead\?/);
    expect(ui).toMatch(/Pause 30 days/);
  });

  // 2026-10-06 notification audit: no switch, and no "digest only" offer, for
  // an email nothing in the product sends.
  it("offers no switch for an email that is never sent", () => {
    expect(ui).not.toMatch(/Weekly analytics digest/);
    expect(ui).not.toMatch(/Lead alerts and follow-up tips/);
    expect(ui).not.toMatch(/Monthly digest only/);
  });

  it("emits the four analytics events, with the source on the opt-out", () => {
    for (const e of [
      "email_preferences_saved",
      "email_paused_30d",
      "email_full_unsubscribe",
      "email_unsubscribe_reason_given",
    ]) {
      expect(ui, e).toContain(e);
    }
    expect(ui).toMatch(/track\("email_full_unsubscribe", \{ variant: "footer" \}\)/);
    const events = read("src/lib/events.ts");
    for (const e of ["email_preferences_saved", "email_full_unsubscribe"]) expect(events).toContain(e);
  });
});

describe("the footer link", () => {
  const tpl = read("src/lib/email-templates.ts");

  it('says "Manage email preferences" and points at the preference centre', () => {
    expect(tpl).toMatch(/Manage email preferences/);
    expect(read("src/lib/email-token.ts")).toMatch(/\/email\/preferences\?t=/);
  });

  it("is offered ALONGSIDE Unsubscribe, never instead of it", () => {
    const at = tpl.indexOf("Manage email preferences");
    const block = tpl.slice(at - 400, at + 400);
    expect(block, "the plain Unsubscribe link disappeared from the footer").toMatch(/>Unsubscribe</);
  });
});

describe("the send-time rules survive a refactor", () => {
  it("one-click headers are still both present", () => {
    const tpl = read("src/lib/email-templates.ts");
    expect(tpl).toMatch(/"List-Unsubscribe":/);
    expect(tpl).toMatch(/"List-Unsubscribe-Post": "List-Unsubscribe=One-Click"/);
  });

  it("an opt-out writes BOTH the new flag and the legacy one", () => {
    const src = read("src/lib/marketing-consent.ts");
    const fn = src.slice(src.indexOf("export async function recordOptOut"));
    expect(fn).toMatch(/marketing_opt_out: true/);
    expect(fn).toMatch(/marketing_emails: false/);
  });

  it("the migration backfills existing opt-outs into the new flag", () => {
    const sql = read("supabase/email-preference-center.sql");
    expect(sql).toMatch(/update public\.email_preferences[\s\S]*set marketing_opt_out = true[\s\S]*where marketing_emails = false/);
    expect(sql).toMatch(/create table if not exists public\.unsubscribe_events/);
    expect(sql).toMatch(/enable row level security/);
  });
});

// A stray import of the gate into a transactional path is the one mistake that
// would silently withhold a receipt, so it gets its own guard.
describe("nothing suppresses a receipt", () => {
  it("the receipt sender never imports the marketing gate", () => {
    vi.resetModules();
    expect(read("src/app/api/stripe/webhook/route.ts")).not.toMatch(/marketing-consent/);
  });
});
