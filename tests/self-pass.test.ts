import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NextRequest } from "next/server";

// Every deployed environment has a signing key; without one the pass fails
// towards counting (tested below by the plain-URL fallback).
process.env.OAUTH_SECRET ||= "c".repeat(64);

// ── The owner opening their OWN card or Swift Links is never a view ──────────
//
// Owner, 2026-09-24: "when they press that button and it opens up the link, it
// should not show up as a SwiftLink view or SwiftCard view … It's a legal
// issue." In the iPhone app "View live" is a new-tab link, which Capacitor hands
// to iOS — it opens in SAFARI, with no session and no device claim, and the
// owner's own look was recorded as a stranger. The fix is lib/self-pass: the
// owner's own links go through /api/self-view, which leaves a signed pass on
// whichever browser they land in, and lib/self-traffic reads it.
//
// What must NOT regress: a visitor is still counted, a forged or foreign pass
// suppresses nobody, and the hop cannot redirect off-site.

const OWNER = "3f2a9c1e-1b2c-4d5e-8f90-a1b2c3d4e5f6";
const OTHER = "9e8d7c6b-5a49-4382-9170-f6e5d4c3b2a1";
const SLUG = "dana-lee-acme";

type Row = Record<string, unknown>;
const db: Record<string, Row[]> = { cards: [], profiles: [], user_devices: [], card_views: [] };

function table(name: string) {
  const filters: { col: string; val: unknown }[] = [];
  const rows = () => (db[name] ?? []).filter((r) => filters.every((f) => r[f.col] === f.val));
  const q = {
    select: () => q,
    eq: (col: string, val: unknown) => { filters.push({ col, val }); return q; },
    gte: () => q,
    lte: () => q,
    order: () => q,
    limit: () => q,
    update: () => q,
    maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
    insert: async (row: Row) => { (db[name] ??= []).push(row); return { error: null }; },
    then: (res: (v: { data: Row[]; error: null }) => unknown) => Promise.resolve({ data: rows(), error: null }).then(res),
  };
  return q;
}

vi.mock("@/lib/supabase-admin", () => ({ getAdminSupabase: () => ({ from: table }) }));
// Safari from the iPhone app: signed out, never signed in on this browser.
vi.mock("@/lib/supabase-server", () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: null } }) } }),
}));
let passCookie: string | null = null;
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (n: string) => (n === "sc_self" && passCookie ? { value: passCookie } : undefined) }),
}));
vi.mock("@/lib/request-geo", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/request-geo")>();
  return {
    ...real,
    resolveGeo: async () => ({ label: "Great Neck, NY", accuracy: "city" as const, source: "edge+second" as const, org: null, isRelay: false, isHosting: false }),
  };
});
vi.mock("@/lib/card-active", () => ({ isCardActive: async () => true }));
vi.mock("@/lib/crm-events", () => ({ dispatchCrmEvent: async () => {} }));
vi.mock("@/lib/milestones", () => ({ checkViewMilestone: async () => null }));
vi.mock("@/lib/rate-limit", () => ({ isRateLimited: async () => false }));

import {
  SELF_PASS_COOKIE, decodeSelfPass, encodeSelfPass, ownLiveHref, selfViewTarget, signSelfLink, verifySelfLink,
} from "@/lib/self-pass";
import { isOwnerActivity, isOwnerRequest } from "@/lib/self-traffic";
import { recordView } from "@/lib/record-view";
import { deviceKeyFor } from "@/lib/visit-identity";
import { GET as selfView } from "@/app/api/self-view/route";

const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8");
const admin = () => ({ from: table }) as never;

async function view(username = SLUG) {
  const ip = "203.0.113.7";
  const ua = "Mozilla/5.0 (iPhone; CPU iPhone OS 26_4 like Mac OS X) Safari/605.1.15";
  return recordView({
    req: { headers: new Headers({ "user-agent": ua }) } as never,
    username,
    visitorId: "visitor-alpha",
    deviceKey: deviceKeyFor({ ip, userAgent: ua, username }),
    source: "direct_link",
    ip,
    identityFromCookie: false,
  });
}

beforeEach(() => {
  for (const k of Object.keys(db)) db[k] = [];
  db.cards.push({ user_id: OWNER, username: SLUG });
  passCookie = null;
});

describe("the link token", () => {
  it("round-trips the owner it was minted for", () => {
    expect(verifySelfLink(signSelfLink(OWNER))).toBe(OWNER);
  });

  it("rejects a tampered, truncated, or foreign token", () => {
    const t = signSelfLink(OWNER)!;
    const [payload, sig] = t.split(".");
    const forged = `${Buffer.from(`${OTHER}|${Date.now()}`).toString("base64url")}.${sig}`;
    expect(verifySelfLink(forged)).toBeNull();
    expect(verifySelfLink(`${payload}.${sig.slice(0, -2)}xx`)).toBeNull();
    expect(verifySelfLink(payload)).toBeNull();
    expect(verifySelfLink("")).toBeNull();
    expect(verifySelfLink(null)).toBeNull();
  });

  it("expires after a week, and a far-future stamp is refused", () => {
    const now = Date.now();
    expect(verifySelfLink(signSelfLink(OWNER, now - 6 * 86_400_000), now)).toBe(OWNER);
    expect(verifySelfLink(signSelfLink(OWNER, now - 8 * 86_400_000), now)).toBeNull();
    expect(verifySelfLink(signSelfLink(OWNER, now + 3_600_000), now)).toBeNull();
  });

  it("a link token is not a pass, and a pass is not a link token", () => {
    const link = signSelfLink(OWNER)!;
    const pass = encodeSelfPass([OWNER])!;
    expect(decodeSelfPass(link)).toEqual([]);
    expect(verifySelfLink(pass)).toBeNull();
  });
});

describe("the pass cookie", () => {
  it("round-trips a bounded, de-duplicated list of owners", () => {
    const ids = [OWNER, OWNER, OTHER, "not-a-uuid"];
    expect(decodeSelfPass(encodeSelfPass(ids))).toEqual([OWNER, OTHER]);
  });

  it("an unsigned or edited pass vouches for nobody", () => {
    const pass = encodeSelfPass([OWNER])!;
    const [, sig] = pass.split(".");
    expect(decodeSelfPass(`${Buffer.from(OTHER).toString("base64url")}.${sig}`)).toEqual([]);
    expect(decodeSelfPass(Buffer.from(OWNER).toString("base64url"))).toEqual([]);
    expect(decodeSelfPass(undefined)).toEqual([]);
  });
});

describe("the redirect can only go to one of our card pages", () => {
  it.each(["/dana-lee-acme", "/links/dana-lee-acme", "/card/dana-lee-acme", "/dana_lee/", "/dana-lee-acme/p/1728330000000p"])("allows %s", (p) => {
    expect(selfViewTarget(p)).toBe(p);
  });
  it.each([
    "https://evil.example/x", "//evil.example", "/\\evil.example", "/links/../admin", "/a/b/c",
    "/dashboard?x=1", "", "/", "javascript:alert(1)", null,
    // Only the exact Create share-link shape, nothing near it.
    "/dana/p/1728330000000", "/dana/p/1728330000000x", "/dana/p/../admin", "/links/dana/p/1728330000000p",
    "/dana/p/1728330000000p/", "/dana/p/1728330000000p?x=1", "//evil.example/p/1728330000000p",
  ])("refuses %s", (p) => {
    expect(selfViewTarget(p as string | null)).toBeNull();
  });
});

describe("ownLiveHref", () => {
  it("routes the owner's own card and Swift Links through the hop", () => {
    for (const path of [`/${SLUG}`, `/links/${SLUG}`]) {
      const href = ownLiveHref(OWNER, `https://swiftcard.me${path}`, "https://swiftcard.me");
      const u = new URL(href);
      expect(u.origin + u.pathname).toBe("https://swiftcard.me/api/self-view");
      expect(u.searchParams.get("to")).toBe(path);
      expect(verifySelfLink(u.searchParams.get("t"))).toBe(OWNER);
    }
  });

  it("falls back to the plain URL whenever it can't sign — the button always works", () => {
    expect(ownLiveHref(null, "https://swiftcard.me/x", "https://swiftcard.me")).toBe("https://swiftcard.me/x");
    expect(ownLiveHref("not-a-uuid", "https://swiftcard.me/x", "https://swiftcard.me")).toBe("https://swiftcard.me/x");
    expect(ownLiveHref(OWNER, "https://swiftcard.me/a/b/c", "https://swiftcard.me")).toBe("https://swiftcard.me/a/b/c");
  });
});

describe("/api/self-view", () => {
  const hop = (qs: string, cookie?: string) =>
    selfView(new NextRequest(`https://swiftcard.me/api/self-view?${qs}`, cookie ? { headers: { cookie } } : undefined));

  it("marks the browser as the owner's and lands on the card at its normal address", async () => {
    const res = await hop(`to=${encodeURIComponent(`/links/${SLUG}`)}&t=${encodeURIComponent(signSelfLink(OWNER)!)}`);
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(`https://swiftcard.me/links/${SLUG}`);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    const set = res.cookies.get(SELF_PASS_COOKIE)!;
    expect(decodeSelfPass(set.value)).toEqual([OWNER]);
    expect(set.httpOnly).toBe(true);
    expect(set.sameSite).toBe("lax");
    expect(set.maxAge).toBe(90 * 24 * 60 * 60);
  });

  it("keeps an owner the browser already carries", async () => {
    const res = await hop(
      `to=/${SLUG}&t=${encodeURIComponent(signSelfLink(OWNER)!)}`,
      `${SELF_PASS_COOKIE}=${encodeSelfPass([OTHER])}`,
    );
    expect(decodeSelfPass(res.cookies.get(SELF_PASS_COOKIE)!.value)).toEqual([OWNER, OTHER]);
  });

  it("a bad token still gets the visitor to the card, and marks nothing", async () => {
    const res = await hop(`to=/${SLUG}&t=forged.token`);
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(`https://swiftcard.me/${SLUG}`);
    expect(res.cookies.get(SELF_PASS_COOKIE)).toBeUndefined();
  });

  it("is never an open redirect", async () => {
    const res = await hop(`to=${encodeURIComponent("//evil.example")}&t=${encodeURIComponent(signSelfLink(OWNER)!)}`);
    expect(res.headers.get("location")).toBe("https://swiftcard.me/");
  });
});

describe("a browser holding the owner's pass", () => {
  it("records NO card view — signed out, never signed in there", async () => {
    passCookie = encodeSelfPass([OWNER]);
    const { outcome } = await view();
    expect(outcome).toBe("self");
    expect(db.card_views).toHaveLength(0);
  });

  it("records NO Swift Links view", async () => {
    passCookie = encodeSelfPass([OWNER]);
    const { outcome } = await view(`${SLUG}__links`);
    expect(outcome).toBe("self");
    expect(db.card_views).toHaveLength(0);
  });

  it("is the owner to every ingest path that asks self-traffic", async () => {
    passCookie = encodeSelfPass([OWNER]);
    expect(await isOwnerRequest(admin(), SLUG)).toBe(true);
    expect(await isOwnerRequest(admin(), `${SLUG}__links`)).toBe(true);
    expect(await isOwnerActivity(admin(), OWNER, null)).toBe(true);
  });

  it("a DIFFERENT owner's pass does not stop this card's views", async () => {
    passCookie = encodeSelfPass([OTHER]);
    const { outcome } = await view();
    expect(outcome).not.toBe("self");
    expect(db.card_views).toHaveLength(1);
  });

  it("a forged pass does not stop views", async () => {
    passCookie = `${Buffer.from(OWNER).toString("base64url")}.forged`;
    await view();
    expect(db.card_views).toHaveLength(1);
  });

  it("a visitor with no pass is still counted", async () => {
    await view();
    expect(db.card_views).toHaveLength(1);
  });
});

describe("the owner's own links are wired through the hop", () => {
  // "See how it looks to them" lived in Quick Contacts' empty state and went
  // with it (2026-09-29); "View live" in My Cards is the dashboard's one now.
  it("dashboard 'View live'", () => {
    const src = read("src/app/dashboard/page.tsx");
    expect(src).toMatch(/const liveHref = ownLiveHref\(user\.id, cardUrl, APP_URL\)/);
    expect(src.match(/href=\{liveHref\}/g)?.length).toBeGreaterThanOrEqual(1);
  });

  it("Swift Links 'Open', the signature preview, profile and Office team list", () => {
    expect(read("src/app/share/page.tsx")).toMatch(/href=\{ownLiveHref\(user\.id, swiftUrl, APP_URL\)\}/);
    expect(read("src/app/share/page.tsx")).toMatch(/previewHref=\{ownLiveHref\(user\.id, cardUrl, APP_URL\)\}/);
    expect(read("src/app/profile/page.tsx")).toMatch(/ownLiveHref\(user\.id/);
    expect(read("src/app/profile/card/page.tsx")).toMatch(/ownLiveHref\(user\.id/);
    expect(read("src/app/office/admin/page.tsx")).toMatch(/self=\{selfLive\(people, userId\)\}/);
  });

  it("the copied email signature keeps the PLAIN card link — recipients' views count", () => {
    const src = read("src/components/EmailSignatureBox.tsx");
    expect(src).toMatch(/<a href="\$\{cardUrl\}"/);
    expect(src).not.toMatch(/previewHref[^\n]*buildSignatureHtml|buildSignatureHtml\([^)]*previewHref/);
  });

  it("self-traffic reads the pass in BOTH checks", () => {
    const src = read("src/lib/self-traffic.ts");
    expect(src.match(/await selfPassClaimants\(\)/g)?.length).toBe(2);
  });
});
