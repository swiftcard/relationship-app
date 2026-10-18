import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ── "Your SwiftCard is live" may not go out before the card is ───────────────
//
// Owner, 2026-09-11: "That email should only be sent once they create their
// first card, not when they create the account… it should be like this for
// every plan and account type."
//
// It was sent from onboarding, at signup. The subject says the card is live and
// the body links to it, so it promised something that did not exist yet and
// linked to a URL that 404'd until the builder was finished — and for anyone
// who abandoned the builder, forever.
//
// The rule is now one function, sendWelcomeWhenCardLive: it refuses when the
// account has no card, and the email_logs claim keeps it to one per account no
// matter how many creation paths reach it.

type Row = Record<string, unknown>;

// ── Since 2026-09-15 the email also waits for the PLAN ──────────────────────
//
// "Your SwiftCard is live" is only true once the plan behind it is decided, so
// sendWelcomeWhenCardLive refuses until profiles.customization carries the
// settled marker (or the account is already on a paid plan). A guest now picks
// their plan AFTER signing up, on /welcome, so there is a real window where the
// card exists and the plan does not.
//
// Every fixture below therefore reads as settled. Without it these tests would
// all pass through the gate and assert nothing about the email it guards —
// which is exactly what happened when the gate landed: six of them started
// reading .subject off an email that was never sent. The gate itself is pinned
// separately, in "waits for the plan, not just the card".
const settled = (p: Row): Row => ({ ...p, customization: { [PLAN_CHOSEN_KEY]: "free" } });

let cardCount = 0;
let cards: Row[] = [];
let profile: Row | null = settled({ name: "Dana Ellis", username: "dana-legacy" });
let alreadySent: Row | null = null;
const inserted: Row[] = [];
const sentEmails: Row[] = [];
let authEmail: string | null = "signup@example.com";
let ownedOffice: Row | null = null;

vi.mock("@/lib/supabase-admin", () => ({
  getAdminSupabase: () => ({
    auth: { admin: { getUserById: async () => ({ data: { user: authEmail ? { email: authEmail } : null } }) } },
    from: (table: string) => {
      if (table === "cards") {
        const q = {
          select: (_c?: string, opts?: { head?: boolean }) =>
            opts?.head
              ? { eq: async () => ({ count: cardCount }) }
              : {
                  eq: () => ({
                    order: () => ({ limit: () => ({ maybeSingle: async () => ({ data: cards[0] ?? null }) }) }),
                  }),
                },
        };
        return q;
      }
      if (table === "profiles") {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: profile }) }) }) };
      }
      if (table === "email_logs") {
        return {
          select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: alreadySent }) }) }) }),
          insert: async (row: Row) => { inserted.push(row); return { error: null }; },
          update: () => ({ eq: () => ({ eq: async () => ({}) }) }),
          delete: () => ({ eq: () => ({ eq: async () => ({}) }) }),
        };
      }
      if (table === "email_preferences") {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { unsubscribe_token: "tok" } }) }) }) };
      }
      if (table === "offices") {
        return { select: () => ({ eq: () => ({ limit: () => ({ maybeSingle: async () => ({ data: ownedOffice }) }) }) }) };
      }
      throw new Error("unexpected table " + table);
    },
  }),
}));

vi.mock("@/lib/email-prefs", () => ({ ensureEmailPreferences: async () => {} }));

// The bounce/complaint list (message_opt_outs, audit N-09): empty unless a test fills it.
const suppressed = new Set<string>();
vi.mock("@/lib/messaging", () => ({ isOptedOut: async (_c: string, to: string) => suppressed.has(to) }));

vi.mock("resend", () => ({
  Resend: class {
    emails = {
      send: async (msg: Row) => { sentEmails.push(msg); return { data: { id: "re_1" }, error: null }; },
    };
  },
}));

import { PLAN_CHOSEN_KEY, sendWelcomeWhenCardLive } from "@/lib/welcome-email";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

beforeEach(() => {
  cardCount = 0;
  cards = [];
  profile = settled({ name: "Dana Ellis", username: "dana-legacy" });
  alreadySent = null;
  authEmail = "signup@example.com";
  ownedOffice = null;
  inserted.length = 0;
  sentEmails.length = 0;
});

describe("an account with no card", () => {
  it("is not welcomed, and nothing is written", async () => {
    expect(await sendWelcomeWhenCardLive("u1", "signup@example.com")).toBe("skipped");
    expect(sentEmails).toHaveLength(0);
    expect(inserted).toHaveLength(0);
  });

  it("stays un-welcomed however many times the path is reached", async () => {
    for (let i = 0; i < 3; i++) expect(await sendWelcomeWhenCardLive("u1")).toBe("skipped");
    expect(sentEmails).toHaveLength(0);
  });
});

describe("waits for the plan, not just the card", () => {
  // The window this closes is real: a guest signs up, the card is saved, and
  // the plan is still unchosen until they answer on /welcome. Greeting them
  // mid-decision would announce a plan nobody had picked — and the greeting is
  // one-per-account, so it would be spent on the wrong moment forever.
  beforeEach(() => {
    cardCount = 1;
    cards = [{ username: "dana-ellis-northbeam", name: "Dana Ellis" }];
  });

  it("holds the email while the plan is unsettled, even with a live card", async () => {
    profile = { name: "Dana Ellis", username: "dana-legacy" }; // no settled marker
    expect(await sendWelcomeWhenCardLive("u1", "signup@example.com")).toBe("skipped");
    expect(sentEmails).toHaveLength(0);
    // Nothing is claimed either — the one-per-account claim must still be
    // available for the real send once the plan is decided.
    expect(inserted).toHaveLength(0);
  });

  it("releases it the moment Free is confirmed", async () => {
    profile = { name: "Dana Ellis", username: "dana-legacy" };
    expect(await sendWelcomeWhenCardLive("u1", "signup@example.com")).toBe("skipped");
    profile = settled({ name: "Dana Ellis", username: "dana-legacy" });
    expect(await sendWelcomeWhenCardLive("u1", "signup@example.com")).toBe("sent");
    expect(sentEmails).toHaveLength(1);
  });

  it("a paid plan settles it without any marker — Stripe never writes one", async () => {
    // isPaidPlan(profile.plan) is the other half of the gate: a paid account is
    // settled by definition, and the webhook has no reason to set a flag.
    profile = { name: "Dana Ellis", username: "dana-legacy", plan: "pro" };
    expect(await sendWelcomeWhenCardLive("u1", "signup@example.com")).toBe("sent");
    expect(sentEmails).toHaveLength(1);
  });
});

describe("the moment the first card exists", () => {
  beforeEach(() => {
    cardCount = 1;
    cards = [{ username: "dana-ellis-northbeam", name: "Dana Ellis" }];
  });

  it("sends, once", async () => {
    expect(await sendWelcomeWhenCardLive("u1", "signup@example.com")).toBe("sent");
    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0].subject).toMatch(/Your SwiftCard is live/);
    expect(String(sentEmails[0].html)).not.toContain("Set up your team");
  });

  // A new Office admin got the single-user email with nothing about the team
  // they had just paid for (2026-09-22 office sign-up review).
  it("tells an Office OWNER how to set up the team", async () => {
    ownedOffice = { id: "office-1" };
    expect(await sendWelcomeWhenCardLive("u1", "signup@example.com")).toBe("sent");
    const html = String(sentEmails[0].html);
    expect(html).toContain("Set up your team");
    expect(html).toContain("/office/admin");
    expect(html).toContain("/office/admin/branding");
  });

  it("greets with the name on the CARD, not the empty profile name", async () => {
    // profiles.name is blank for every account created through normal signup —
    // the name is typed into the card builder. Greeting from the profile made
    // this read "Your SwiftCard is live, there!" for exactly its recipients.
    profile = settled({ name: "", username: "dana-legacy" });
    cards = [{ username: "dana-ellis-northbeam", name: "Dana Ellis" }];
    await sendWelcomeWhenCardLive("u1", "signup@example.com");
    expect(sentEmails[0].subject).toBe("Your SwiftCard is live, Dana!");
  });

  it("still falls back to the profile name, then to a neutral greeting", async () => {
    profile = settled({ name: "Priya Nair", username: "p" });
    cards = [{ username: "p-card", name: "" }];
    await sendWelcomeWhenCardLive("u1", "signup@example.com");
    expect(sentEmails[0].subject).toBe("Your SwiftCard is live, Priya!");

    sentEmails.length = 0;
    alreadySent = null;
    profile = settled({ name: "", username: "p" });
    cards = [{ username: "p-card", name: "" }];
    await sendWelcomeWhenCardLive("u1", "signup@example.com");
    expect(sentEmails[0].subject).toBe("Your SwiftCard is live, there!");
  });

  it("links to the CARD's slug, not the legacy profile handle", async () => {
    await sendWelcomeWhenCardLive("u1", "signup@example.com");
    const html = String((sentEmails[0] as { html?: string }).html ?? "");
    expect(html).toContain("dana-ellis-northbeam");
    expect(html).not.toContain("dana-legacy");
  });

  it("goes to the ACCOUNT email, never to whatever the card shows publicly", async () => {
    // profiles.email drifts to the card's public contact address the moment one
    // is set (lib/account-email.ts) — owner mail must not follow it.
    authEmail = "login@example.com";
    await sendWelcomeWhenCardLive("u1", "something-else@example.com");
    expect(sentEmails[0].to).toBe("login@example.com");
  });

  it("falls back to the caller's address if auth cannot be read", async () => {
    authEmail = null;
    await sendWelcomeWhenCardLive("u1", "fallback@example.com");
    expect(sentEmails[0].to).toBe("fallback@example.com");
  });

  it("never goes to an address that bounced or reported spam (audit N-09)", async () => {
    authEmail = "bounced@example.com";
    suppressed.add("bounced@example.com");
    try {
      await sendWelcomeWhenCardLive("u1", null);
      expect(sentEmails).toHaveLength(0);
    } finally {
      suppressed.clear();
    }
  });

  it("does not send a second time for the same account", async () => {
    alreadySent = { id: "log-1" };
    expect(await sendWelcomeWhenCardLive("u1", "signup@example.com")).toBe("already_sent");
    expect(sentEmails).toHaveLength(0);
  });

  it("never throws, whatever goes wrong", async () => {
    profile = null;
    await expect(sendWelcomeWhenCardLive("u1", "signup@example.com")).resolves.toBe("skipped");
  });
});

describe("every path that can create a card sends it, and signup does not", () => {
  it("signup no longer sends anything", () => {
    // Comments stripped: the file explains, at the old call site, why it moved.
    const onboarding = read("src/app/onboarding/page.tsx")
      .replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
    expect(onboarding).not.toMatch(/sendWelcomeEmail|sendWelcomeWhenCardLive/);
  });

  for (const [label, file] of [
    ["the card builder / Add card", "src/app/api/cards/route.ts"],
    ["a claimed guest draft", "src/app/api/drafts/claim/route.ts"],
    ["the legacy profile→card migration", "src/lib/ensure-cards.ts"],
    ["the manual resend endpoint", "src/app/api/welcome/route.ts"],
  ] as const) {
    it(`${label} goes through the card-gated sender`, () => {
      expect(read(file)).toMatch(/sendWelcomeWhenCardLive\(/);
    });
  }

  it("nothing anywhere calls the ungated sender", () => {
    // One rule, one entry point: no back door can promise a card that is not
    // there. (The gated function is the only caller of the inner one.)
    const callers = ["src/app/api/cards/route.ts", "src/app/api/drafts/claim/route.ts",
      "src/lib/ensure-cards.ts", "src/app/api/welcome/route.ts", "src/app/onboarding/page.tsx"];
    for (const f of callers) {
      const code = read(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
      expect(code, `${f} calls the ungated sendWelcomeEmail`).not.toMatch(/sendWelcomeEmail\b/);
    }
  });

  it("card creation is never blocked by the email", () => {
    // after() on the request paths, and a swallowed failure everywhere.
    for (const f of ["src/app/api/cards/route.ts", "src/app/api/drafts/claim/route.ts"]) {
      expect(read(f)).toMatch(/after\(\(\) => sendWelcomeWhenCardLive\(/);
    }
    expect(read("src/lib/welcome-email.ts")).toMatch(/\} catch \{[\s\S]{0,120}return "failed";/);
  });
});
