import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8");

// Comments describe the failures being guarded against, so strip them before
// scanning or the prose trips the assertions.
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

// Balance braces from a function's opening `{`; a regex stopping at the first
// `}` truncates at the first nested block and lets violations below it through.
function functionBody(src: string, name: string): string {
  const at = src.indexOf(`function ${name}(`);
  if (at === -1) throw new Error(`${name}() not found`);
  const open = src.indexOf("{", at);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(open, i + 1);
  }
  throw new Error(`unbalanced braces in ${name}()`);
}

// A connected CRM that silently stops working is the worst failure mode here:
// Settings keeps showing "Connected", no contacts arrive, and nobody finds out.
// Token-REFRESH failures were always reported via sync_error (which Settings
// renders as an amber reconnect prompt). The actual create/update calls were
// only console.warn'd — so a Google project without the People API enabled, or
// a HubSpot grant missing crm.objects.contacts.write, failed on every single
// lead forever while looking perfectly healthy.
//
// This is the same shape as the Twilio "said Sent, never arrived" bug.

describe("CRM sync failures are visible, not silent", () => {
  // Recording an outcome used to be repeated in every provider file, which is
  // how a fix landed in one and not another. Every provider now returns a
  // PushResult and does no database work; lib/crm-run records the outcome, once,
  // for all five — so these pins check the runner, and that every provider
  // goes through it. (Behaviour: tests/crm-provider-contract.test.ts.)
  // Sliced by declaration rather than functionBody: runCrmSync's `opts = {}`
  // default is the first brace pair after its name.
  const runSrc = stripComments(read("src/lib/crm-run.ts"));
  const run = runSrc.slice(runSrc.indexOf("function runCrmSync("), runSrc.indexOf("async function queueIfPossible("));

  it("a contact the CRM refuses for good writes sync_error", () => {
    // Must match the FAILURE call specifically. A bare "setSyncError(" check
    // is worthless — the success path also calls it, to clear the banner, so
    // deleting the failure report would still leave a match.
    expect(run).toMatch(/await setSyncError\(key, ownerId, result\.message\)/);
  });

  it("a busy or unreachable CRM queues the contact instead of nagging — and still reports it if it can't be queued", () => {
    expect(run).toMatch(/if \(result\.retryable\)[\s\S]*?queueIfPossible\(/);
    const queue = runSrc.slice(runSrc.indexOf("async function queueIfPossible("));
    expect(queue).toMatch(/enqueueCrmRetry\(/);
    expect(queue).toMatch(/await setSyncError\(key, ownerId, result\.message\)/);
  });

  it("a later success clears the banner, and only when one is showing", () => {
    // The guard matters: clearing unconditionally would write to the database
    // on every captured lead just to set null to null.
    expect(run).toMatch(/conn\.syncError \? setSyncError\(key, ownerId, null\) : null/);
  });

  for (const [provider, file] of [
    ["Google Contacts", "src/lib/sync-google.ts"],
    ["HubSpot", "src/lib/sync-hubspot.ts"],
    ["Pipedrive", "src/lib/sync-pipedrive.ts"],
    ["HighLevel", "src/lib/sync-highlevel.ts"],
    ["Salesforce", "src/lib/sync-salesforce.ts"],
  ] as const) {
    it(`${provider} reports every failure through the shared classifier`, () => {
      const src = stripComments(read(file));
      expect(src).toMatch(/return runCrmSync\(/);
      expect(src).toMatch(/pushFailure\(LABEL, res\.status/);
      // No answer at all is a failure too, not a crash.
      expect(src).toMatch(/CrmNoAnswerError\) return pushFailure\(LABEL, null\)/);
    });
  }

  it("auth failures tell the user to reconnect; busy ones promise a retry that now exists; data ones don't blame the connection", () => {
    // The distinction matters: a 403 means a scope was never granted or an API
    // isn't enabled, and no amount of retrying fixes it, so the copy has to say
    // "reconnect". A 5xx is transient — it is queued (lib/crm-outbox), so "will
    // try again" is true. A 400 is one contact's details, and "reconnect"
    // would send someone round in circles with a working connection.
    const helper = stripComments(read("src/lib/crm-connection.ts"));
    const body = functionBody(helper, "connectionErrorMessage");
    expect(body).toMatch(/status === 401 \|\| status === 403/);
    expect(body.toLowerCase()).toContain("reconnect");
    expect(body.toLowerCase()).toContain("will try again");
    expect(body.toLowerCase()).toContain("your connection is fine");
  });
});

describe("every Settings card points at a route that can serve it", () => {
  // Caught a real regression. HubSpot serves POST from /hubspot/token and
  // DELETE from /hubspot — two different routes, each exporting only its own
  // verb. Generalising the card collapsed them into one prop, so Disconnect
  // sent DELETE to a route with no DELETE handler. The 405 was swallowed by the
  // disconnect catch, so the card flipped to "disconnected" while the row
  // stayed in the database and leads kept syncing. Invisible, and exactly the
  // kind of thing a mismatched URL causes.
  const src = read("src/components/IntegrationsSettings.tsx");

  function routeFileFor(apiPath: string): string {
    return `src/app${apiPath}/route.ts`;
  }

  const saves = [...src.matchAll(/saveEndpoint="([^"]+)"/g)].map((m) => m[1]);
  const disconnects = [...src.matchAll(/disconnectEndpoint="([^"]+)"/g)].map((m) => m[1]);

  it("finds a card for each provider", () => {
    expect(saves.length).toBeGreaterThanOrEqual(3);
    expect(disconnects.length).toBe(saves.length);
  });

  for (const p of saves) {
    it(`POST ${p} has a POST handler`, () => {
      expect(read(routeFileFor(p))).toMatch(/export async function POST/);
    });
  }

  for (const p of disconnects) {
    it(`DELETE ${p} has a DELETE handler`, () => {
      expect(read(routeFileFor(p))).toMatch(/export async function DELETE/);
    });
  }
});

describe("Office: a sub-user's leads reach the agency's CRM", () => {
  const helper = stripComments(read("src/lib/crm-connection.ts"));
  const body = functionBody(helper, "resolveCrmOwnerId");

  it("every provider routes through the resolver, so no CRM misses the office case", () => {
    // A provider that calls getCrmConnection with the capturing user directly
    // would work for solo accounts and silently do nothing for a 12-agent
    // agency — the failure would only show up for the customers paying most.
    // Every provider is driven by runCrmSync, which resolves the destination
    // before it fetches a token — only the Settings test (the presser's own
    // connection, by definition) skips it.
    const run = stripComments(read("src/lib/crm-run.ts"));
    expect(run).toMatch(/opts\.test \? capturedBy : await resolveCrmOwnerId\(key, capturedBy\)/);
    for (const f of ["src/lib/sync-google.ts", "src/lib/sync-hubspot.ts", "src/lib/sync-pipedrive.ts", "src/lib/sync-highlevel.ts", "src/lib/sync-salesforce.ts"]) {
      expect(read(f), `${f} must sync through the runner`).toContain("runCrmSync(");
    }
  });

  it("a personal connection wins over the office one", () => {
    // Order is what keeps this additive. Anyone connected today — including a
    // sub-user who connected before their office existed — keeps their own
    // destination. Reversing it would silently reroute live customers' contacts.
    const ownCheck = body.indexOf("capturedByUserId");
    const officeCheck = body.indexOf("resolveOfficeContext");
    expect(ownCheck).toBeGreaterThan(-1);
    expect(officeCheck).toBeGreaterThan(-1);
    expect(ownCheck).toBeLessThan(officeCheck);
  });

  it("only a SUB-USER inherits, never the owner or a solo account", () => {
    expect(body).toMatch(/!ctx\.isOwner/);
  });

  it("presence is checked, not health — a broken connection must not reroute", () => {
    // getCrmConnection returns null both for "no connection" and "connection
    // broken". Falling back on the broken case would silently redirect a
    // sub-user's contacts into the agency CRM instead of reporting the fault.
    // Selecting just the id keeps this a presence test.
    expect(body).toMatch(/\.select\("id"\)/);
  });
});

describe("Office: a sub-user is told where their leads already go", () => {
  // The routing was already correct — a sub-user inherits the office owner's
  // CRM. What was missing was SAYING so. Settings read as "nothing is set up",
  // so a sub-user could connect their own and quietly divert leads away from
  // the agency's CRM, which for an agency is usually company property.
  const page = stripComments(read("src/app/settings/flows/page.tsx"));
  const card = stripComments(read("src/components/IntegrationsSettings.tsx"));

  it("only looks up the owner's CRMs for an actual SUB-USER", () => {
    // Guarded so an office OWNER and a solo Pro account never pay for the extra
    // query, and never see a notice about inheriting from themselves.
    expect(page).toMatch(/officeCtx && !officeCtx\.isOwner && officeCtx\.ownerId/);
  });

  it("reads the OWNER's integrations, not the caller's", () => {
    // The bug this prevents is subtle: querying the caller here would show a
    // sub-user their own connections and claim the team set them up.
    const at = page.indexOf("teamCrmNames = ownerLive");
    expect(at).toBeGreaterThan(-1);
    const block = page.slice(Math.max(0, at - 2000), at);
    expect(block).toMatch(/\.eq\("user_id", officeCtx\.ownerId\)/);
  });

  it("names only what is REALLY flowing: owner still paid, no problem on it, not overridden", () => {
    // It used to name every row the owner had — so a member could read "your
    // contacts go there automatically" while nothing was going anywhere.
    expect(page).toMatch(/const ownerLive = isPaidProfile\(/);
    expect(page).toMatch(/\.filter\(\(i\) => !i\.sync_error && !ownOverrides\.has\(/);
  });

  it("shows nothing at all when there is no team CRM", () => {
    // Empty array for everyone who isn't an office sub-user, so no stray box.
    expect(card).toMatch(/teamCrmNames\.length > 0 &&/);
    expect(card).toMatch(/teamCrmNames = \[\]/);
  });

  it("explains that the override is per-CRM, not all-or-nothing", () => {
    // resolveCrmOwnerId resolves per provider, so connecting a DIFFERENT tool
    // adds a destination rather than replacing the team's. Saying otherwise
    // would be a lie that costs someone their agency's leads.
    expect(card).toContain("connecting the same CRM sends to yours instead of the team");
  });
});

describe("integrations are re-checked against the plan at send time", () => {
  // A stored token or webhook URL survives a downgrade. dispatchCrmEvent
  // already re-checked isPaidPlan before firing view/notification events; the
  // lead path did not — so one lapsed account could still be syncing leads to
  // HubSpot while its other events had already stopped.
  const src = stripComments(read("src/app/api/leads/route.ts"));

  it("every CRM sync happens only for a paid owner", () => {
    // The gate that can't be skipped is INSIDE syncLeadToAllCrms (expiry-
    // aware), so a returning visitor's fill-in and any future caller are
    // covered. The new-capture call is additionally inside the route's own
    // paid branch, found by walking back to the ENCLOSING `if` rather than a
    // fixed character window (which broke the moment a comment was added).
    const lib = stripComments(read("src/lib/crm-sync.ts"));
    expect(functionBody(lib, "syncLeadToAllCrms")).toMatch(/if \(!isPaidProfile\(data\)\) return \[\];/);
    const at = src.indexOf("syncLeadToAllCrms(leadData");
    expect(at).toBeGreaterThan(-1);
    const openIf = src.lastIndexOf("if (", at);
    expect(openIf).toBeGreaterThan(-1);
    expect(src.slice(openIf, at)).toMatch(/isPaidPlan\(ownerProfile\.plan\)/);
  });

  it("the CRM syncs survive the response — they aren't floating promises", () => {
    // Unawaited fetches can be killed when a serverless function freezes after
    // responding, so the sync would never run and (before sync_error) would
    // have looked like silence. after() keeps the invocation alive without
    // making the visitor wait. allSettled so one dead provider can't cancel
    // the rest.
    expect(src).toMatch(/after\(\s*Promise\.allSettled\(/);
    expect(src).toContain('from "next/server"');
  });

  it("the Zapier lead webhook only fires for a paid owner", () => {
    // Anchored on the CALL and walked back to its enclosing `if`, the same way
    // the Google assertion above does it. This used to match the literal
    // "zapier_webhook_url && " on one line, so adding a third clause to the
    // condition (the per-card scope check) broke it while the plan gate it
    // actually tests was untouched — a failure that said nothing about the gate.
    const at = src.indexOf("sendLeadToZapier(");
    expect(at).toBeGreaterThan(-1);
    const openIf = src.lastIndexOf("if (", at);
    expect(openIf).toBeGreaterThan(-1);
    expect(src.slice(openIf, at)).toMatch(/isPaidPlan\(ownerProfile\.plan\)/);
    // And again inside the resolver, for the manual-add path and for an
    // inherited office webhook (whose OWNER must be paid too).
    // Expiry-aware (isPaidProfile) — the raw plan column kept firing Zaps for
    // a day after a timed grant ran out, while the native CRMs had stopped.
    const zap = stripComments(read("src/lib/crm-sync.ts"));
    expect(zap).toMatch(/if \(!own \|\| !isPaidProfile\(own\)\) return null;/);
    expect(zap).toMatch(/!isPaidProfile\(owner\)/);
  });

  it("the Zapier URL is still allowlisted before any PII leaves", () => {
    // A refactor that drops it turns this into an open SSRF/exfiltration hole
    // — for the user's own webhook AND an inherited office one.
    const zap = stripComments(read("src/lib/crm-sync.ts"));
    expect(zap).toContain("isZapierWebhookUrl(own.zapier_webhook_url)");
    expect(zap).toContain("isZapierWebhookUrl(owner.zapier_webhook_url)");
  });

  it("manual adds and scanned business cards reach the CRMs too, paid-gated", () => {
    // "Add contact" is where a scanned paper card lands — the most CRM-bound
    // contact there is. It used to be saved in SwiftCard only.
    const manual = stripComments(read("src/app/api/leads/manual/route.ts"));
    const at = manual.indexOf("syncLeadToAllCrms(");
    expect(at).toBeGreaterThan(-1);
    expect(manual).toContain("sendLeadToZapier(");
    const openIf = manual.lastIndexOf("if (", at);
    expect(manual.slice(openIf, at)).toMatch(/if \(paid\)/);
    expect(manual).toMatch(/after\(\s*Promise\.allSettled\(/);
  });

  it("edits sync in UPDATE mode, so a CRM record is updated rather than re-noted", () => {
    const edit = stripComments(read("src/app/api/leads/[id]/route.ts"));
    expect(edit).toMatch(/syncLeadToAllCrms\(loaded\.lead, loaded\.capturedBy, \{\s*mode: "update"/);
    // Only a real change syncs, and only the changed fields may overwrite.
    expect(edit).toMatch(/crmChanges\(before, loaded\.row\)/);
    expect(edit).toMatch(/changedFields: change\.fields/);
    expect(edit).toMatch(/previousEmail:/);
  });
});
