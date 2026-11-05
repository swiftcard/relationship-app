import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { authoritativeEventIdentity, type SessionViewer } from "@/lib/viewer-identity";
import { cardEventNotice } from "@/lib/card-event-notify";

// ─────────────────────────────────────────────────────────────────────────────
// WHO VIEWED A CARD MUST BE WHO ACTUALLY VIEWED IT.
//
// The reported bug: Mina opened a card and the owner was told "Pyramid viewed
// your card". The event's identity fields came from a device-global
// localStorage blob written the last time ANYONE shared their details in that
// browser — it survives logout/login, so on any shared or multi-account device
// the previous person's identity was stamped onto the next person's views.
//
// The rule now pinned here: when the request carries an authenticated session,
// THE SERVER derives the viewer's identity from that session and the
// client-supplied identity is ignored. Anonymous viewers keep the shared-info
// attribution (that recognition is a feature). Scenario numbers refer to the
// isolation-audit checklist: (5) different logged-in users viewing one card,
// (6) Mina never recorded as Pyramid, (7) anonymous vs authenticated,
// (11)(12) server-side enforcement over client-supplied identity.
// ─────────────────────────────────────────────────────────────────────────────

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8");

// The stale blob a shared browser would send: the PREVIOUS person's identity.
const cachedPyramid = {
  visitor_name: "Pyramid",
  visitor_email: "pyramid@example.com",
  visitor_phone: "+15550001111",
};

const mina: SessionViewer = {
  userId: "mina-uid",
  name: "Mina R",
  email: "mina@example.com",
};

describe("authoritativeEventIdentity — the session always outranks the cached blob", () => {
  it("(6) Mina's authenticated view is recorded as Mina, never as the cached Pyramid", () => {
    const id = authoritativeEventIdentity(mina, cachedPyramid);
    expect(id.visitor_name).toBe("Mina R");
    // The session's AUTH EMAIL is never recorded — merely opening a card must
    // not disclose the viewer's account email to the owner (or their Zapier).
    expect(id.visitor_email).toBeNull();
    // Nothing of the cached identity survives.
    expect(JSON.stringify(id)).not.toContain("Pyramid");
    expect(JSON.stringify(id)).not.toContain("pyramid@example.com");
  });

  it("(6) the owner's notification then names Mina, never Pyramid", () => {
    const id = authoritativeEventIdentity(mina, cachedPyramid);
    const n = cardEventNotice({ eventType: "viewed_card", visitorName: id.visitor_name, nameConfirmed: true });
    expect(n!.body).toBe("Mina R viewed your card.");
  });

  it("the cached phone is dropped for an authenticated viewer — a session has no phone, and the cached one may be another person's", () => {
    // Keeping Pyramid's phone on Mina's event would cross-link the two people
    // in the owner's conversation matching (events are matched by phone too).
    expect(authoritativeEventIdentity(mina, cachedPyramid).visitor_phone).toBeNull();
  });

  it("an authenticated viewer with NO resolvable name still overrides — honest 'Someone' beats a confident wrong name", () => {
    const anonymousMina: SessionViewer = { userId: "mina-uid", name: null, email: "mina@example.com" };
    const id = authoritativeEventIdentity(anonymousMina, cachedPyramid);
    expect(id.visitor_name).toBeNull();
    expect(id.visitor_email).toBeNull();
    const n = cardEventNotice({ eventType: "viewed_card", visitorName: id.visitor_name, nameConfirmed: true });
    expect(n!.body).toBe("Someone viewed your card.");
  });

  it("(7) an anonymous request keeps the client-supplied identity — shared-info recognition is a feature", () => {
    expect(authoritativeEventIdentity(null, cachedPyramid)).toEqual(cachedPyramid);
  });

  it("(5) two different signed-in users viewing the SAME card from the SAME device each get their own identity", () => {
    const pyramid: SessionViewer = { userId: "pyramid-uid", name: "Pyramid", email: "pyramid@example.com" };
    // Same stale device blob both times — the session decides, so each view
    // lands under the person who actually made it.
    expect(authoritativeEventIdentity(pyramid, cachedPyramid).visitor_name).toBe("Pyramid");
    expect(authoritativeEventIdentity(mina, cachedPyramid).visitor_name).toBe("Mina R");
  });
});

describe("wiring — the ingest route actually enforces this server-side", () => {
  const route = read("src/app/api/card-events/route.ts");

  it("(12) resolves the session viewer on the server and derives identity from it", () => {
    expect(route).toMatch(/resolveSessionViewer\(admin\)/);
    expect(route).toMatch(/authoritativeEventIdentity\(sessionViewer/);
  });

  it("the insert records the DERIVED identity, never the raw client fields", () => {
    // The insert takes a prebuilt `row` object now — assert on its literal.
    const insert = route.slice(route.indexOf("const row = {"));
    expect(insert).toMatch(/visitor_name: identity\.visitor_name/);
    expect(insert).toMatch(/visitor_email: identity\.visitor_email/);
    expect(insert).toMatch(/visitor_phone: identity\.visitor_phone/);
    expect(insert).not.toMatch(/visitor_name: visitor_name/);
  });

  it("the notification uses the derived identity, and the CRM demands more than that", () => {
    // The bell still renders the derived identity: for an anonymous visitor
    // that is an ASSOCIATION from their own earlier share, which the route
    // records honestly as `identityLevel` and never presents as certain.
    expect(route).toMatch(/visitorName: identity\.visitor_name/);
    // No surface may reach back to the raw client blob for a display name.
    expect(route).not.toMatch(/visitorName: visitor_name/);

    // The CRM is held to a HIGHER bar than the bell, and used to be held to
    // the same one. This endpoint is public and card slugs are public, so a
    // stranger could POST any slug with any name and email and have a
    // fabricated contact written into a customer's Salesforce or HubSpot.
    // Contact details forwarded there are now re-derived server-side from the
    // lead the visitor actually submitted to THIS owner — see
    // corroboratedContact and tests/crm-contact-corroboration.test.ts.
    // noticeEvent: a tap that opened the visit is announced as its view (2026-11-05).
    expect(route).toMatch(/const crmContact = noticeEvent === "clicked_link" \? null : await corroboratedContact\(/);
    expect(
      /contact:\s*\{\s*name:\s*identity\./.test(route),
      "the CRM is being handed the client-supplied identity again",
    ).toBe(false);
  });

  it("owner self-views are still excluded by SERVER identity (never client-supplied, never IP)", () => {
    // TWO server signals now, because one was never enough: production's
    // analytics_ingest_log held zero "self" decisions over its whole life while
    // the owner's own views were being counted and pushed to his own phone.
    // The session is still authoritative when present; the httpOnly sc_device
    // cookie covers the public routes the proxy does not refresh a session on.
    // Both are identity/ownership-based — see lib/self-traffic.ts.
    expect(route).toMatch(/await isOwnerActivity\(admin, ownerId, sessionViewer\?\.userId\)/);
    expect(route).toMatch(/const ownerId = await resolveOwnerId\(admin, card_owner_username\)/);
    const selfTraffic = read("src/lib/self-traffic.ts");
    expect(selfTraffic).toMatch(/isSelfTraffic\(ownerId, sessionUserId\)/);
    // The device signal is now a SET of recent claimants, not "the most recent
    // one": one browser is routinely signed into two of the same person's
    // accounts, and taking only the freshest row named the wrong account and
    // counted the owner as a stranger (owner report, 2026-09-18).
    // (Joined 2026-09-24 by the owner's "View live" pass — lib/self-pass,
    // pinned in tests/self-pass.test.ts.)
    expect(selfTraffic).toMatch(/claimsOwner\(\[\.\.\.\(await selfPassClaimants\(\)\), \.\.\.\(await deviceClaimants\(admin\)\)\], ownerId\)/);
    // Still never an IP.
    expect(selfTraffic).not.toMatch(/\bip\b\s*[:=]/);
  });

  it("(11) the events GET stays scoped to the caller's own cards and refuses foreign lead ids", () => {
    expect(route).toMatch(/getOwnerUsernames\(user\.id\)/);
    expect(route).toMatch(/!usernames\.includes\(lead\.card_owner as string\)/);
    expect(route).toMatch(/in\("card_owner_username", usernames\)/);
  });

  it("the viewer's display name comes from THEIR oldest card, and email from the AUTH user — never profiles.email", () => {
    const resolver = read("src/lib/viewer-identity.ts");
    expect(resolver).toMatch(/\.eq\("user_id", user\.id\)[\s\S]{0,120}order\("created_at", \{ ascending: true \}\)/);
    expect(resolver).toMatch(/user\.email \?\? null/);
    // No query touches the profiles table at all — its email column drifts to
    // a card's public contact address (see account-email.ts).
    expect(resolver).not.toMatch(/from\("profiles"\)/);
  });
});
