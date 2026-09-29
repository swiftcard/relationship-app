import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { prevSlugsOf } from "@/lib/release-slug";

// Owner, 2026-09-24: "card information and notifications will never bleed into
// each other, or with other accounts, or within the same account … it has to be
// perfect and clean." Four audits (accounts, cards, notifications, caches); each
// block pins one path that let one card's or one person's data show up
// somewhere else.

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("notifications stay with their account and their card", () => {
  it("a text reply finds every spelling of the number, with no small cut-off", () => {
    const s = read("src/app/api/twilio/inbound/route.ts");
    expect(s).toContain('const spread = `%${digits.split("").join("%")}%`;');
    expect(s).toContain('.ilike("phone", spread)');
    expect(s).not.toMatch(/\.limit\(25\)/);
    // The wildcard pattern is only a pre-filter; exact digits decide.
    expect(s).toMatch(/normalizePhone\(l\.phone\) === digits/);
  });

  it("every visit-ledger query is scoped to the recipient", () => {
    const s = read("src/lib/visit-notify.ts");
    expect(s).toMatch(/\.eq\("user_id", userId\)\s*\n\s*\.in\("visit_key"/);
    expect(s).toMatch(/\.eq\("user_id", opts\.userId\)\s*\n\s*\.eq\("visit_key", key\)/);
    const updates = s.match(/\.from\("notifications"\)\.update\([^)]*\)\.eq\("id", id\)[^;]*;/g) ?? [];
    expect(updates.length).toBeGreaterThanOrEqual(3);
    for (const u of updates) expect(u).toContain('.eq("user_id", userId)');
  });

  // The per-card dashboard panel — the one list that could show card A's rows
  // under card B — went with Quick Contacts (2026-09-29). What is left is the
  // account-wide bell, so there is no card scope for a fallback to escape.
  it("no card-scoped notification list is left to leak across cards", () => {
    const api = read("src/app/api/notifications/route.ts");
    expect(api).not.toMatch(/searchParams\.get\("card"\)|body\.card/);
    const dash = read("src/app/dashboard/page.tsx");
    expect(dash).not.toMatch(/panelNotifications|NotificationsPanel/);
    expect(dash).not.toMatch(/card_owner\.eq\.\$\{activeUsername/);
  });

  it("a returning contact opens under the card they were captured on", () => {
    expect(read("src/app/api/card-events/route.ts")).toContain("card=${encodeURIComponent(returning.cardOwner || card_owner_username)}");
  });

  it("an office brand notice is tagged with the member's office card", () => {
    expect(read("src/app/api/office/brand/route.ts")).toContain('.eq("is_office_card", true)');
  });
});

describe("an address that changes hands carries nothing of the card that left it", () => {
  it("old addresses are read from _prevSlugs", () => {
    expect(prevSlugsOf({ _prevSlugs: ["a", "", 3, "b"] })).toEqual(["a", "b"]);
    expect(prevSlugsOf(null)).toEqual([]);
  });

  it("images and Wallet passes are released on rename, card delete (with aliases) and purge", () => {
    const rel = read("src/lib/release-slug.ts");
    expect(rel).toContain('admin.storage.from("card-shares").remove(objects)');
    expect(rel).toContain('admin.from("wallet_registrations").delete().in("serial", list)');
    expect(read("src/app/api/cards/[id]/rename/route.ts")).toContain("await releaseSlugArtifacts(admin, [oldSlug]);");
    const del = read("src/app/api/cards/[id]/route.ts");
    expect(del).toContain("releaseSlugArtifacts(admin, released)");
    // …and the page cache is dropped again after the row is gone.
    expect(del.lastIndexOf("revalidateCardPage(...released)")).toBeGreaterThan(del.search(/\.from\("cards"\)\r?\n\s*\.delete\(\)/));
    expect(read("src/lib/account-purge.ts")).toMatch(/releaseSlugArtifacts\(admin, \[\.\.\.usernames, \.\.\.\(cards \?\? \[\]\)\.flatMap\(\(c\) => prevSlugsOf\(c\.customization\)\)\]\)/);
    expect(read("src/app/api/account/delete/route.ts")).toContain("prevSlugsOf(c.customization)");
  });

  it("no card — in any account — can take another card's old address", () => {
    const alias = read("src/lib/slug-alias.ts");
    expect(alias).toContain('if (exceptCardId) q = q.neq("id", exceptCardId);');
    expect(read("src/lib/auto-rename-slug.ts")).toContain("if (await slugHeldAsAlias(admin, candidate, opts.cardId)) continue;");
    expect(read("src/app/api/cards/[id]/rename/route.ts")).toContain("slugHeldAsAlias(admin, slug, id)");
  });

  it("a stored picture is served only if it was made for the card holding the address now", () => {
    const g = read("src/lib/stored-capture.ts");
    expect(g).toContain("written >= born");
    expect(read("src/app/card/[username]/opengraph-image.tsx")).toContain('storedCaptureIsCurrent(admin, "card-shares", username)');
    expect(read("src/app/api/card-signature/[username]/route.ts")).toContain('storedCaptureIsCurrent(getAdminSupabase(), "card-signatures", slug)');
  });

  it("Links previews and the signature fallback use the content-versioned image", () => {
    expect(read("src/app/links/[username]/page.tsx")).toContain("shareImageUrl(APP_URL, username, meta)");
    expect(read("src/app/api/card-signature/[username]/route.ts")).toContain("shareImageUrl(APP_URL, slug, meta)");
  });
});

describe("one card never borrows another card's details", () => {
  it("outgoing messages speak only as the card (profile only for a legacy profile-card)", () => {
    const rem = read("src/app/api/reminders/route.ts");
    expect(rem).toMatch(/const sender = card\r?\n\s*\? \{/);
    expect(rem).toContain("email: (card.email as string) || null,");
    const share = read("src/app/api/leads/share-card/route.ts");
    expect(share).toContain("const replyTo = card ? ((card.email as string) || null)");
    const leads = read("src/app/api/leads/route.ts");
    expect(leads).toMatch(/const cardIdentity = cardRow\r?\n\s*\? \{/);
  });

  it("an upload for a card never writes the account's photo or logo", () => {
    const up = read("src/app/api/upload/route.ts");
    expect(up).toContain('if (field !== "photo" && field !== "logo") return NextResponse.json({ url: publicUrl });');
    expect(up).toContain("if (cardId) return NextResponse.json({ ok: true });");
  });

  it("a new card states its own headshot, even none", () => {
    expect(read("src/app/api/cards/route.ts")).toContain('if (!Object.prototype.hasOwnProperty.call(incomingCust, "photoUrl")) incomingCust.photoUrl = null;');
  });

  it("only a card this account owns is remembered or filtered on", () => {
    expect(read("src/app/dashboard/page.tsx")).toContain("selectedCard && activeCard?.username === selectedCard ? selectedCard : null");
    expect(read("src/app/contacts/page.tsx")).toContain("ownsCard(cardParam) ? cardParam");
  });
});

describe("a device lets go of a person completely", () => {
  it("the visitor cookie is dropped on sign-out and account switch", () => {
    expect(read("src/app/api/visit-identity/reset/route.ts")).toContain("res.cookies.set(VISITOR_COOKIE, \"\", { path: \"/\", maxAge: 0");
    expect(read("src/components/AccountIsolationGuard.tsx")).toContain('if (realSwitch) void fetch("/api/visit-identity/reset"');
  });

  it("a deleted account's push bindings go at once", () => {
    expect(read("src/app/api/account/delete/route.ts")).toContain('admin.from("push_subscriptions").delete().eq("user_id", user.id)');
  });

  it("a background tab reloads when its account changed elsewhere", () => {
    const g = read("src/components/AccountIsolationGuard.tsx");
    expect(g).toContain('if (uid !== pageUid && document.visibilityState === "hidden") reloadOnVisible = true;');
  });

  it("the rest of the tour's per-person keys are cleared, and other accounts' drafts", () => {
    const s = read("src/lib/account-state.ts");
    for (const k of ["sc_tour_ctx", "sc_admin_tour_seen", "sc_tour_running", "sc_tour_index", "sc_tour_card"]) {
      expect(s, k).toContain(`"${k}",`);
    }
    expect(s).toContain('k.startsWith("swiftcard_card_draft:") && k !== own');
  });
});
