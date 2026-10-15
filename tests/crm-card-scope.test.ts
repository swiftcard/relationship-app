import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseCardScope, isCardInScope, isScoped, sanitizeCardScope } from "@/lib/crm-scope";

// Per-card CRM scoping. Integrations are keyed (user_id, provider) and the
// Zapier webhook is one column on profiles, so before this every card on an
// account fed the same destination: connect an employer's GoHighLevel and a
// personal card's contacts were written into it too.
//
// Two things are tested here, and the second matters as much as the first:
//   1. the RULE (pure, exhaustive — including every fail-closed case), and
//   2. that every path data can leave by actually applies it. A correct rule
//      that one egress path skips is not a fix, it is a false sense of one.

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8");
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const CARD_A = "11111111-1111-4111-8111-111111111111";
const CARD_B = "22222222-2222-4222-8222-222222222222";

describe("the scope rule", () => {
  it("null means ALL cards — the pre-existing behaviour", () => {
    // This is the entire backward-compatibility story: the migration adds the
    // column with no default, so every existing row reads null and nothing
    // about anyone's live integration changed the moment it shipped.
    expect(isCardInScope(null, CARD_A)).toBe(true);
    expect(isCardInScope(null, CARD_B)).toBe(true);
    expect(isScoped(null)).toBe(false);
  });

  it("a list means only those cards", () => {
    expect(isCardInScope([CARD_A], CARD_A)).toBe(true);
    expect(isCardInScope([CARD_A], CARD_B)).toBe(false);
    expect(isCardInScope([CARD_A, CARD_B], CARD_B)).toBe(true);
    expect(isScoped([CARD_A])).toBe(true);
  });

  it("FAILS CLOSED when a scope is set but the card is unknown", () => {
    // The case that matters most. A legacy profile-card has no cards row, so
    // there is no id to check. Sending anyway would be the exact leak this
    // feature exists to stop, and a leak can't be undone — the contact is on
    // someone else's server. A missed sync can.
    expect(isCardInScope([CARD_A], null)).toBe(false);
    expect(isCardInScope([CARD_A], undefined)).toBe(false);
    expect(isCardInScope([CARD_A], "")).toBe(false);
  });

  it("an unknown card is still fine when NOTHING is scoped", () => {
    // Fail-closed must not become fail-always: an account that never touched
    // this feature has to keep syncing even for a card with no row.
    expect(isCardInScope(null, null)).toBe(true);
    expect(isCardInScope(null, undefined)).toBe(true);
  });

  it("an empty list sends nothing", () => {
    expect(isCardInScope([], CARD_A)).toBe(false);
    expect(isCardInScope([], null)).toBe(false);
  });
});

describe("reading a scope out of the database", () => {
  it("treats a MISSING column as all cards, not as a restriction", () => {
    // On a database where the migration hasn't run the field arrives as
    // undefined. Reading that as "restricted" would stop every sync for every
    // account at once — the worst possible failure for a compatibility path.
    expect(parseCardScope(undefined)).toBeNull();
    expect(parseCardScope(null)).toBeNull();
  });

  it("does not let a junk list widen back out to all cards", () => {
    // The user DID restrict this integration. If every entry is unusable the
    // answer is "nothing matches", never "everything matches".
    expect(parseCardScope([])).toEqual([]);
    expect(parseCardScope([123, null, ""])).toEqual([]);
    expect(isCardInScope(parseCardScope([123, null, ""]), CARD_A)).toBe(false);
  });

  it("keeps the usable ids out of a mixed list", () => {
    expect(parseCardScope([CARD_A, 42, null, CARD_B])).toEqual([CARD_A, CARD_B]);
  });
});

describe("sanitizing a scope on its way in", () => {
  it("null stays null (all cards)", () => {
    expect(sanitizeCardScope(null)).toBeNull();
    expect(sanitizeCardScope(undefined)).toBeNull();
  });

  it("drops anything that isn't a uuid", () => {
    // These are written into a uuid[] column — a non-uuid would make Postgres
    // reject the whole update rather than just that entry.
    expect(sanitizeCardScope([CARD_A, "not-a-uuid", "", 7, null])).toEqual([CARD_A]);
  });

  it("de-duplicates and normalizes case", () => {
    expect(sanitizeCardScope([CARD_A, CARD_A.toUpperCase()])).toEqual([CARD_A]);
  });
});

// ── The half that keeps the rule honest ──────────────────────────────────────
// There are exactly three ways contact data leaves for a CRM destination. Each
// one is pinned here; adding a fourth without a gate should fail this file.
describe("every egress path applies the rule", () => {
  it("the CRM gate lives in getCrmConnection, so no provider can skip it", () => {
    // All four syncs must come through this function for a token, which is why
    // the check sits here rather than being repeated (and eventually forgotten)
    // per provider.
    const src = stripComments(read("src/lib/crm-connection.ts"));
    expect(src, "getCrmConnection no longer reads the scope column").toMatch(/card_ids/);
    expect(src, "getCrmConnection no longer checks the scope").toMatch(/isCardInScope\(/);
    // Required, not optional: the compiler is what stops a fifth provider from
    // being added with the argument missing.
    expect(src).toMatch(/cardId:\s*string \| null \| undefined,/);
  });

  // Every provider is driven by ONE runner (lib/crm-run), and that runner is
  // what fetches the token — so the card id is passed in exactly one place,
  // and a provider file can't get a token any other way.
  it("the shared runner passes the capturing card into the gate", () => {
    const src = stripComments(read("src/lib/crm-run.ts"));
    expect(src, "runCrmSync calls getCrmConnection without the card id").toMatch(
      /getCrmConnection\([^)]*lead\.capturedByCardId/s,
    );
  });

  it.each([
    ["src/lib/sync-google.ts", "google"],
    ["src/lib/sync-hubspot.ts", "hubspot"],
    ["src/lib/sync-pipedrive.ts", "pipedrive"],
    ["src/lib/sync-highlevel.ts", "highlevel"],
    ["src/lib/sync-salesforce.ts", "salesforce"],
  ])("%s gets its token only through the gated runner", (file, key) => {
    const src = stripComments(read(file));
    expect(src, `${file} reads a token around the runner`).not.toMatch(/getCrmConnection\(|from\("integrations"\)/);
    expect(src, `${file} no longer syncs through runCrmSync`).toMatch(/return runCrmSync\(/);
    const registry = stripComments(read("src/lib/crm-sync.ts"));
    expect(registry, `${key} is missing from CRM_PROVIDERS`).toMatch(new RegExp(`\\b${key}: \\w+Provider`));
  });

  it("the lead route feeds the real card id in, and gates its Zapier webhook", () => {
    const src = stripComments(read("src/app/api/leads/route.ts"));
    // Fed from the cards row, NOT from card_owner — that one is the slug, which
    // the owner can rename out from under a scope.
    expect(src, "the lead route stopped passing the capturing card's id").toMatch(
      /capturedByCardId:\s*\(cardRow\?\.id/,
    );
    // The Zapier gate lives in the one resolver every Zapier send goes through.
    expect(src, "the lead route no longer sends through the gated Zapier sender").toMatch(/sendLeadToZapier\(leadData/);
    const zap = stripComments(read("src/lib/crm-sync.ts"));
    expect(zap, "the Zapier lead webhook is no longer scope-gated").toMatch(/isCardInScope\(parseCardScope\(own\.zapier_card_ids\)/);
    expect(zap).toMatch(/resolveZapierTarget\(capturedBy, lead\.capturedByCardId\)/);
  });

  it("card view / notification events are gated too", () => {
    // Views and notifications describe one card's activity, so a webhook
    // pointed at one card's workflow must not receive another card's traffic.
    const src = stripComments(read("src/lib/crm-events.ts"));
    expect(src, "dispatchCrmEvent no longer goes through the gated resolver").toMatch(/resolveZapierTarget\(userId, \(card\?\.id/);
    // It has to select the card id to have something to check.
    expect(src).toMatch(/from\("cards"\)\s*\.select\("id, user_id"\)/);
  });

  it("an INHERITED office connection is not filtered by the owner's own-card scope", () => {
    // The owner's picker lists only the owner's cards, so applying that scope
    // to a sub-user's lead dropped every team lead the moment the owner picked
    // "only my work card". Own connections are still scoped exactly as before.
    const src = stripComments(read("src/lib/crm-connection.ts"));
    expect(src).toMatch(/const inherited = capturedBy !== userId;/);
    // Own connection: the owner's card scope. Inherited: the member's COMPANY
    // card instead — never the owner's own-card list.
    expect(src).toMatch(/if \(inherited\) \{[\s\S]*?is_office_card[\s\S]*?\} else if \(!isCardInScope\(/);
  });
});

describe("the save API can't be used to create a silent trap", () => {
  const src = stripComments(read("src/app/api/settings/crm-scope/route.ts"));

  it("refuses an empty selection", () => {
    // An empty list means "send nothing" — a destination that still says
    // Connected and quietly never fires. Better to make the user say so.
    expect(src).toMatch(/empty_scope/);
    expect(src).toMatch(/scope\.length === 0/);
  });

  it("only accepts cards the caller actually owns", () => {
    expect(src).toMatch(/from\("cards"\)\.select\("id"\)\.eq\("user_id", user\.id\)/);
    expect(src).toMatch(/unknown_card/);
  });

  it("requires a real connection, which is what keeps a sub-user off the office CRM", () => {
    // An Office sub-user inheriting the owner's CRM has no integrations row of
    // their own, so there is nothing to update and they cannot re-scope
    // company property.
    expect(src).toMatch(/not_connected/);
    expect(src).toMatch(/\.eq\("user_id", user\.id\)\s*\.eq\("provider", target\)/);
  });

  it("is Pro-gated like the integrations themselves", () => {
    // Expiry-aware, like every send: an expired timed grant is Free now.
    expect(src).toMatch(/isPaidProfile\(planRow\)/);
  });
});

// ── The pre-connect choice (owner order 2026-08-27) ──────────────────────────
//
// Connecting must not silently default to all-cards: on a multi-card account
// the user actively chooses BEFORE the connection exists, for every CRM and
// the Zapier webhook. And the flip side: a RECONNECT (which shows no chooser)
// must leave the stored scope exactly as it was.

import { parseCardsParam } from "@/lib/crm-scope-server";

describe("parsing the pre-connect choice", () => {
  it('"all" and absence both mean all cards', () => {
    expect(parseCardsParam("all")).toBeNull();
    expect(parseCardsParam(null)).toBeNull();
    expect(parseCardsParam(undefined)).toBeNull();
    expect(parseCardsParam("")).toBeNull();
  });

  it("a csv of uuids means only those", () => {
    expect(parseCardsParam(`${CARD_A},${CARD_B}`)).toEqual([CARD_A, CARD_B]);
  });

  it("junk is refused loudly, never silently widened to all", () => {
    expect(parseCardsParam("not-a-uuid")).toBeUndefined();
    expect(parseCardsParam("x,y,z")).toBeUndefined();
  });
});

describe("every connect path carries the choice", () => {
  it("both OAuth connect legs read it, validate ownership, and refuse junk", () => {
    for (const p of ["google", "salesforce"]) {
      const src = stripComments(read(`src/app/api/integrations/${p}/connect/route.ts`));
      expect(src, `${p} connect ignores the cards param`).toMatch(/parseCardsParam/);
      expect(src, `${p} connect skips ownership`).toMatch(/scopeIsOwned/);
      expect(src, `${p} connect stores no scope cookie`).toMatch(/crm_scope/);
    }
  });

  it("both OAuth callbacks store the choice — but ONLY when one was made", () => {
    for (const p of ["google", "salesforce"]) {
      const src = stripComments(read(`src/app/api/integrations/${p}/callback/route.ts`));
      // No cookie -> empty update object -> a reconnect can't wipe a scope.
      expect(src, `${p} callback would wipe scope on reconnect`).toMatch(/scopeCookie === undefined \? \{\}/);
      expect(src, `${p} callback never stores the scope`).toMatch(/\.\.\.scopeUpdate/);
    }
  });

  it("all three token routes accept the choice and apply the same guards", () => {
    for (const p of ["hubspot", "pipedrive", "highlevel"]) {
      const src = stripComments(read(`src/app/api/integrations/${p}/token/route.ts`));
      expect(src, `${p} token route ignores card_ids`).toMatch(/card_ids/);
      expect(src, `${p} token route allows an empty scope`).toMatch(/empty_scope/);
      expect(src, `${p} token route skips ownership`).toMatch(/scopeIsOwned/);
      // Absent card_ids (older client / reconnect) must not touch stored scope.
      expect(src, `${p} token route wipes scope when card_ids absent`).toMatch(/card_ids !== undefined/);
    }
  });

  it("the Zapier save accepts the choice with the same guards", () => {
    const src = stripComments(read("src/app/api/settings/zapier/route.ts"));
    expect(src).toMatch(/zapier_card_ids/);
    expect(src).toMatch(/empty_scope/);
    expect(src).toMatch(/scopeIsOwned/);
    expect(src).toMatch(/zapier_card_ids !== undefined/);
  });

  it("the scope-save API covers every CRM, Salesforce included", () => {
    // The original bug: Salesforce shipped without joining this list, so its
    // "Sending from … Change" Save was rejected as bad_target.
    const src = stripComments(read("src/app/api/settings/crm-scope/route.ts"));
    expect(src).toMatch(/"google", "hubspot", "pipedrive", "highlevel", "salesforce"/);
  });
});

describe("the UI actually makes the user choose", () => {
  it("the chooser starts UNSET and gates the action until a real choice", () => {
    const src = read("src/components/CardScopePicker.tsx");
    expect(src).toMatch(/"unset" \| "all" \| "some"/);
    // Ready = all, or some with at least one card — never ready while unset.
    expect(src).toMatch(/v\.mode === "all" \|\| \(v\.mode === "some" && v\.ids\.length > 0\)/);
  });

  it("both integration card variants and Zapier run the pre-connect step", () => {
    const settings = read("src/components/IntegrationsSettings.tsx");
    expect(settings.match(/scopeChoiceReady/g)!.length).toBeGreaterThanOrEqual(2); // OAuth + token variants
    expect(settings).toMatch(/cards=\$\{v === null \? "all" : v\.join\(","\)\}/); // OAuth carries it in the URL
    const zapier = read("src/components/ZapierSettings.tsx");
    expect(zapier).toMatch(/scopeChoiceReady/);
    expect(zapier).toMatch(/zapier_card_ids: scopeChoiceValue\(choice\)/);
  });
});
