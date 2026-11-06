import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildRecentVisits, type VisitEventRow } from "@/lib/recent-visits";
import { isCloudHostingOrg } from "@/lib/request-geo";

// ── The 2026-10-23 analytics precision review ───────────────────────────────
// Owner: "It'll say 'My email signature was viewed' when really I shared it on
// my card link." Every visit, tap and save must say exactly what happened —
// these pin each fix from that review so none can come back.

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const T = (min: number) => new Date(Date.UTC(2026, 9, 20, 15, 0) + min * 60_000).toISOString();
const ev = (id: string, at: number, type: string, extra: Partial<VisitEventRow> = {}): VisitEventRow =>
  ({ id, created_at: T(at), event_type: type, surface: "card", visitor_id: "visitor-aaaa", ...extra });

describe("a copied link is the plain card link, never how one visit came", () => {
  const clean = read("src/components/CleanShareUrl.tsx");

  it("?source=, ?save= and ?shared= leave the address bar once the page has read them", () => {
    // + vv, the desktop Scan to save QR's visit (2026-11-05).
    expect(clean).toContain('const ONE_VISIT_PARAMS = ["source", "save", "shared", "vv"] as const;');
    expect(clean).toContain("window.history.replaceState(");
  });

  it("on the card page AND the Swift Links page, for the owner too (their copy is what gets passed on)", () => {
    for (const p of ["src/app/[username]/page.tsx", "src/app/links/[username]/page.tsx"]) {
      const page = read(p);
      expect(page, p).toContain('import CleanShareUrl from "@/components/CleanShareUrl";');
      // Unconditional: not behind the owner-view or embed checks the tracker sits behind.
      expect(page, p).toMatch(/\n\s*<CleanShareUrl \/>\n/);
    }
  });

  it("the signature's plain-text copy (what a text or DM pastes) carries the plain link", () => {
    const box = read("src/components/EmailSignatureBox.tsx");
    expect(box).toContain("new Blob([`${name}\\n${cardUrl.split(\"?\")[0]}`], { type: \"text/plain\" })");
    // The HTML — the signature that goes into mail — keeps its tag.
    expect(box).toContain("buildSignatureHtml(name, company, cardUrl, img)");
  });
});

describe("a visit keeps the way it arrived", () => {
  it("a later tagged link never relabels it (only a missing source is filled in)", () => {
    const rv = read("src/lib/record-view.ts");
    expect(rv).toContain("if (source && !recent.source) {");
    expect(rv).not.toContain('s === "direct_link"');
  });
});

describe("Recent visits names only who it can stand behind", () => {
  it("a contact's event that lost its lead ('Wrong person?' or deleted) is 'Someone', not their old name", () => {
    const [v] = buildRecentVisits({
      events: [ev("v", 0, "viewed_card", { lead_id: null, lead_confidence: "form", visitor_name: "Priya Shah" })],
      history: [], leads: [], paid: true, limit: 5,
    });
    expect(v.who).toBe("Someone");
  });

  it("a signed-in SwiftCard member (never a contact) is still named from their session", () => {
    const [v] = buildRecentVisits({
      events: [ev("v", 0, "viewed_card", { lead_id: null, lead_confidence: null, visitor_name: "Dana Lee" })],
      history: [], leads: [], paid: true, limit: 5,
    });
    expect(v.who).toBe("Dana Lee");
  });

  it("'Wrong person?' and deleting a contact both take the name off its events", () => {
    expect(read("src/app/api/leads/[id]/wrong-person/route.ts"))
      .toContain("update({ lead_id: null, lead_confidence: null, visitor_name: null, visitor_email: null, visitor_phone: null })");
    const del = read("src/app/api/leads/[id]/route.ts");
    const fn = del.slice(del.indexOf("export async function DELETE"));
    const scrub = fn.indexOf('.update({ visitor_name: null, visitor_email: null, visitor_phone: null })');
    expect(scrub).toBeGreaterThan(-1);
    // Before the lead goes: afterwards the FK has already nulled lead_id.
    expect(scrub).toBeLessThan(fn.indexOf('.from("leads")'));
  });
});

describe("Recent visits never states a visit number it can't back", () => {
  const events = [ev("v", 120, "viewed_card")];

  it("an unreadable history leaves the number off instead of '1st visit'", () => {
    const [v] = buildRecentVisits({ events, history: [], leads: [], paid: true, limit: 5, historyComplete: false });
    expect(v.visitNumber).toBeNull();
  });

  it("pre-dedupe rows minutes apart (July-August) are one visit, not several", () => {
    const history = [0, 4, 9, 120].map((m) => ({ visitor_id: "visitor-aaaa", surface: "card", created_at: T(m), event_type: "viewed_card" }));
    const [v] = buildRecentVisits({ events, history, leads: [], paid: true, limit: 5 });
    expect(v.visitNumber).toBe(2);
  });

  it("the history read is ordered and its completeness is checked", () => {
    const src = read("src/lib/recent-visits.ts");
    expect(src).toContain("historyComplete: !historyRes.error && (historyRes.data?.length ?? 0) < HISTORY_READ_CAP,");
  });
});

describe("a visit from the card's own other page says so", () => {
  it("Swift Links from the card's button, the card from Swift Links — by referrer for older rows", () => {
    const [links] = buildRecentVisits({
      events: [ev("l", 0, "viewed_card", { surface: "links", source: "swift_links", referrer_url: "https://swiftcard.me/dana-acme" })],
      history: [], leads: [], paid: true, limit: 5, slug: "dana-acme",
    });
    expect(links.from).toBe("from your SwiftCard");
    const [card] = buildRecentVisits({
      events: [ev("c", 0, "viewed_card", { referrer_url: "https://swiftcard.me/links/dana-acme" })],
      history: [], leads: [], paid: true, limit: 5, slug: "dana-acme",
    });
    expect(card.from).toBe("from your Swift Links");
    // Someone else's page is not "yours".
    const [other] = buildRecentVisits({
      events: [ev("o", 0, "viewed_card", { surface: "links", referrer_url: "https://swiftcard.me/someone-else" })],
      history: [], leads: [], paid: true, limit: 5, slug: "dana-acme",
    });
    expect(other.from).toBeNull();
  });
});

describe("the list says where it stops", () => {
  it("past the cap it says 'Showing the latest N visits' instead of passing for every visit", () => {
    const c = read("src/components/dashboard/RecentVisits.tsx");
    expect(c).toContain("const cut = visits.length > RECENT_VISITS_SHOWN;");
    expect(c).toContain("Showing the latest {RECENT_VISITS_SHOWN} visits.");
    expect(read("src/lib/recent-visits.ts")).toContain("const limit = (opts.limit ?? RECENT_VISITS_SHOWN) + 1;");
  });
});

describe("the Traffic box claims no number it didn't read", () => {
  const dash = read("src/app/dashboard/page.tsx");
  it("a failed head count shows '—', not 0", () => {
    expect(dash).toContain('{m.value == null ? "—" : m.value.toLocaleString("en-US")}');
    expect(dash).not.toContain("value: swiftCardViews ?? 0");
  });
  it("Link taps (the window's count) is not shown under the all-time Locations tab", () => {
    expect(dash).toContain('{linkTaps > 0 && viewsRange !== "locations" && (');
  });
});

describe("Facebook's link checker is not a visitor", () => {
  it("its network counts as crawler egress, like Google's and Microsoft's", () => {
    expect(isCloudHostingOrg("Facebook, Inc.")).toBe(true);
    expect(isCloudHostingOrg("Meta Platforms, Inc.")).toBe(true);
    // A real organisation's own network is still a person.
    expect(isCloudHostingOrg("Columbia University")).toBe(false);
  });
});

describe("a contact's history holds only what that person did", () => {
  it("on a SHARED browser an unstamped event after the binding is never read; a browser only they used stays theirs", () => {
    const member = read("src/app/api/card-events/route.ts");
    const office = read("src/lib/office-contact-detail.ts");
    for (const [name, src] of [["member", member], ["office", office]] as const) {
      // The cap applies only when someone else was also bound to the browser —
      // a saved contact's return visit days later stays in their history
      // (owner, 2026-11-05: every open and tap of a saved contact).
      expect(src, name).toContain("const others = (sharedDevice ?? []).filter((o) => o.visitor_id === bd.visitor_id);");
      expect(src, name).toContain('if (others.length && boundAt) q = q.lte("created_at", new Date(new Date(boundAt).getTime() + VIEW_VISIT_WINDOW_MS).toISOString());');
      expect(src, name).not.toMatch(/\n\s*if \(boundAt\) q = q\.lte\("created_at"/);
      // The legacy browser fallback: never a browser bound to another contact,
      // never the owner's own details.
      expect(src, name).toContain(".eq(\"visitor_id\", visitorId).limit(1)).data ?? []).length > 0");
      expect(src, name).toMatch(/isOwnersOwnDetails\((leadContact|contact), await ownerContactKeys\(admin, /);
    }
  });

  it("a one-tap re-share from the same browser keeps bound_at (the capture visit stays in the history)", () => {
    const kc = read("src/lib/known-contact.ts");
    expect(kc).toContain('if (existing && existing.bound_via === "form" && existing.bound_at) {');
    expect(kc).toContain(".update({ superseded_at: null, wrong_at: null })");
  });
});

// ── Second pass, same review ────────────────────────────────────────────────

import { storedSource, sourcePhrase, getSourceLabel } from "@/lib/source-labels";
import { ownLiveHref } from "@/lib/self-pass";
import { personalRecapCopy, rankRecapPlaces } from "@/lib/weekly-recap";
import { stripLocationMarks } from "@/lib/location-privacy";
import { contactReturnNotice, metContext } from "@/lib/contact-return-notify";
import { heldCategory } from "@/lib/catchup-category";
import { stripNameMarks } from "@/lib/contact-privacy";

describe("a URL may only carry the tags SwiftCard itself puts on links", () => {
  it("how a contact was ADDED, old rows and unused tags are never taken from a URL", () => {
    for (const k of ["manual", "imported", "scanner", "share", "text_message", "instagram_bio", "swift_connect"]) {
      expect(storedSource(k), k).toBe("direct_link");
    }
    for (const k of ["qr_code", "nfc_card", "email_signature", "apple_wallet", "google_wallet", "contact_qr", "swift_links", "swift_card", "create_link", "widget"]) {
      expect(storedSource(k), k).toBe(k);
    }
  });
  it("every recorded source has a real label (no raw 'swift connect' in the contact list)", () => {
    for (const k of ["swift_connect", "save_contact_conversion", "share", "swift_card"]) {
      expect(getSourceLabel(k), k).not.toBe(k.replace(/_/g, " "));
    }
  });
  it("the pass and the widget are YOURS in a sentence", () => {
    expect(sourcePhrase("apple_wallet")).toBe(" from your Apple Wallet pass");
    expect(sourcePhrase("google_wallet")).toBe(" from your Google Wallet pass");
    expect(sourcePhrase("widget")).toBe(" from the QR on your home-screen widget");
    expect(sourcePhrase("swift_card")).toBe(" from your SwiftCard");
  });
  it("Swift Links links to the card tagged; the card no longer links to Swift Links (owner 2026-11-06)", () => {
    expect(read("src/components/SwiftLinkProfile.tsx")).toContain("href={`/${username}?source=swift_links`}");
    // The card page's "View my Swift Links page" button is gone. swift_card stays
    // a known source above, so older visits keep their "from your SwiftCard".
    expect(read("src/app/[username]/page.tsx")).not.toContain("?source=swift_card");
  });
  it("the desktop save QR carries the visit's source, through the offline outbox on the phone", () => {
    expect(read("src/components/ScanSaveContact.tsx")).toContain('outbox.fetch("/api/card-events", {');
  });
});

describe("the owner's own clicks are never visitors", () => {
  it("the preview fallback (unsigned) drops the source tag", () => {
    expect(ownLiveHref("not-a-uuid", "https://swiftcard.me/x?source=email_signature", "https://swiftcard.me")).toBe("https://swiftcard.me/x");
  });
  it("a SwiftCard staff session (ADMIN_EMAILS) is not counted on a customer's card", () => {
    const route = read("src/app/api/card-events/route.ts");
    const staff = route.indexOf("if (sessionViewer && isAdminEmail(sessionViewer.email)) {");
    expect(staff).toBeGreaterThan(-1);
    // Before anything is recorded.
    expect(staff).toBeLessThan(route.indexOf("await recordView({"));
    expect(route).toContain('return decided("staff", { staff: true }, { identityLevel: "confirmed", classificationReason: "site_admin" });');
  });
});

describe("one visit, recorded whole", () => {
  const route = read("src/app/api/card-events/route.ts");
  it("a tap-only sitting is a visit of its own in Recent visits, and lists the tap", () => {
    // The page left before its view counted (a link opening in the same tab).
    const [v] = buildRecentVisits({
      events: [ev("t2", 1, "clicked_link", { target_label: "Book" }), ev("t1", 0, "clicked_link", { target_label: "Listings" })],
      history: [], leads: [], paid: true, limit: 5,
    });
    expect(v.id).toBe("t1");
    expect(v.actions).toEqual(["Tapped Listings", "Tapped Book"]);
    // A tap whose view follows within the minute (new-tab link) belongs to that view.
    const rows = buildRecentVisits({
      events: [ev("view", 0.5, "viewed_card"), ev("tap", 0, "clicked_link", { target_label: "Listings" })],
      history: [], leads: [], paid: true, limit: 5,
    });
    expect(rows.map((r) => r.id)).toEqual(["view"]);
    expect(rows[0].actions).toEqual(["Tapped Listings"]);
  });

  it("a save that records the visit's view writes its viewed_card event too, without notifying", () => {
    expect(route).toContain('companionView = outcome === "recorded";');
    expect(route).toMatch(/if \(companionView\) \{[\s\S]{0,400}event_type: "viewed_card",/);
  });
  it("time on page adds up across reloads in the same visit (this tab only)", () => {
    const t = read("src/components/CardEventTracker.tsx");
    expect(t).toContain("const totalMs = carryMs + visibleMs;");
    expect(t).toContain("sessionStorage.setItem(carryKey,");
    expect(t).toContain("Date.now() - prev.viewAt < VIEW_VISIT_WINDOW_MS - 60_000");
  });
  it("an offline share is filed at its real time, with no place, and binds at that time", () => {
    const leads = read("src/app/api/leads/route.ts");
    expect(leads).toContain('const queuedAt = Number(req.headers.get("x-sc-queued-at"));');
    expect(leads).toContain("const location = replayAt ? null : geo.label;");
    expect(leads).toContain("...(replayAt ? { created_at: new Date(replayAt).toISOString() } : {}),");
  });
  it("a repeat share's new message is its own dated line in the conversation", () => {
    const leads = read("src/app/api/leads/route.ts");
    expect(leads).toMatch(/from\("lead_messages"\)\.insert\(\{\s*lead_id: known\.id,\s*card_owner,\s*direction: "in",\s*channel: "form",/);
  });
});

describe("notifications say only what happened", () => {
  const priya = {
    kind: "known" as const, leadId: "l1", name: "Priya Shah", cardOwner: "dana", confidence: "link" as const,
    capturedAt: "2026-10-21T00:30:00Z", status: null, tags: [], whereMet: null,
  };
  it("'opened', not 're-opened', on a first open; 'again' only after a download", () => {
    expect(stripNameMarks(contactReturnNotice({ contact: priya, eventType: "viewed_card", surface: "card", visitsThisWeek: 1, paid: true, openedBefore: false })!.title))
      .toBe("Priya opened your card");
    expect(stripNameMarks(contactReturnNotice({ contact: priya, eventType: "viewed_card", surface: "card", visitsThisWeek: 1, paid: true, openedBefore: true })!.title))
      .toBe("Priya re-opened your card");
    expect(contactReturnNotice({ contact: priya, eventType: "downloaded_vcard", surface: "card", visitsThisWeek: 1, paid: true, downloadedBefore: false })!.body)
      .not.toContain("again");
  });
  it("'met Oct 20' is the owner's day, not UTC's", () => {
    // 8:30 PM Oct 20 in New York is 00:30 Oct 21 UTC.
    expect(metContext(priya, "America/New_York")).toBe("met Oct 20");
    expect(metContext(priya)).toBe("met Oct 21");
  });
  it("the route passes what it knows", () => {
    const route = read("src/app/api/card-events/route.ts");
    expect(route).toContain("openedBefore: sharedOnThisPage || (viewsBefore ?? 0) > 0,");
    expect(route).toContain('downloadedBefore: leadSource === "save_contact_conversion" || (savesBefore ?? 0) > 0,');
    expect(route).toContain("timeZone: readPushPrefs(owner.customization).timezone ?? DEFAULT_TIMEZONE,");
  });
  it("the Monday recap names a region as a region, and the morning catch-up can announce it", () => {
    const places = rankRecapPlaces([
      { location: "New York, US", geo_accuracy: "region" },
      { location: "New York, US", geo_accuracy: "region" },
      { location: "Austin, TX", geo_accuracy: "city" },
    ]);
    const c = personalRecapCopy({ views: 3, contacts: 0, places })!;
    expect(stripLocationMarks(c.body)).toBe("Top spot in the New York area · 2 places in all.");
    expect(heldCategory({ type: "weekly_recap" })).toBe("weekly_recap");
  });
  it("contacts the owner added are never 'shared their details'", () => {
    expect(personalRecapCopy({ views: 0, contacts: 2, sharedContacts: 0, places: [] })!.body).toBe("2 new contacts this week.");
    expect(personalRecapCopy({ views: 0, contacts: 2, sharedContacts: 1, places: [] })!.body).toBe("1 person shared their details with you.");
  });
});
