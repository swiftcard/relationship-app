import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { NextRequest } from "next/server";

// ── One way back for the LinkedIn photo: a ticket the page can always pick up ─
//
// Owner, 2026-10-20: "Connect LinkedIn" → sign in → Allow → back on the same
// page with no photo, no crop, no Apply. Production storage held the photos
// (the import worked every time); they were lost on the way back INTO the
// page, because every screen and device had its own return path and each
// leaned on something fragile: URL parameters surviving, saved progress
// existing, a popup keeping its opener, iOS following a swiftcard:// redirect.
//
// Now each Connect tap makes a ticket. The callback stores the photo (or why
// there isn't one) under it, and the page asks for it by ticket whenever it
// gets control back. These pin each half; the browser behaviour is driven in
// tests/render/linkedin-photo-return.interactive.test.ts.

const read = (f: string) => readFileSync(join(process.cwd(), f), "utf8");
const T = "3f2b8c1e-9a4d-4e7b-8c2a-1d5e6f7a8b9c";

class MemStorage {
  private m = new Map<string, string>();
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string) { this.m.set(k, String(v)); }
  removeItem(k: string) { this.m.delete(k); }
  clear() { this.m.clear(); }
}

// ── The ticket itself ────────────────────────────────────────────────────────

describe("the ticket", () => {
  it("is a v4 UUID and nothing else", async () => {
    const { isLinkedInTicket } = await import("@/lib/linkedin-ticket");
    expect(isLinkedInTicket(T)).toBe(true);
    expect(isLinkedInTicket(crypto.randomUUID())).toBe(true);
    for (const bad of ["", "abc", `${T}x`, T.toUpperCase(), "../../etc/passwd", `${T.slice(0, -1)}/`, null, 42]) {
      expect(isLinkedInTicket(bad)).toBe(false);
    }
  });

  it("names a deterministic photo and status marker, read back the same way", async () => {
    const { ticketPhotoPath, ticketStatusPath, readTicketObject } = await import("@/lib/linkedin-ticket");
    expect(ticketPhotoPath(T)).toBe(`guest-linkedin/${T}.jpg`);
    // The bucket only takes images, so the status rides in a GIF's name.
    expect(ticketStatusPath(T, "nophoto")).toBe(`guest-linkedin/${T}.status-nophoto.gif`);
    expect(readTicketObject(T, `${T}.jpg`)).toEqual({ photo: true });
    expect(readTicketObject(T, `${T}.status-error.gif`)).toEqual({ status: "error" });
    expect(readTicketObject(T, `${T}-other.jpg`)).toBeNull();
    expect(readTicketObject(T, `${T}.status-bogus.gif`)).toBeNull();
  });
});

// ── The page's half ─────────────────────────────────────────────────────────

describe("the page keeps its ticket and picks the photo up by it", () => {
  beforeEach(() => {
    (globalThis as unknown as { localStorage: MemStorage }).localStorage = new MemStorage();
    (globalThis as unknown as { sessionStorage: MemStorage }).sessionStorage = new MemStorage();
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    vi.unstubAllGlobals();
  });

  it("one ticket per tap, only for the scope that made it, and settled once handled", async () => {
    const m = await import("@/lib/linkedin-photo-return");
    const t = m.startLinkedInPhoto("wizard");
    expect(t).toMatch(/^[0-9a-f-]{36}$/);
    expect(m.pendingLinkedInPhoto("wizard")?.t).toBe(t);
    expect(m.pendingLinkedInPhoto("builder:card")).toBeNull();
    expect(m.hasPendingLinkedInPhoto()).toBe(true);
    m.settleLinkedInPhoto("builder:card");
    expect(m.pendingLinkedInPhoto("wizard")?.t).toBe(t);
    m.settleLinkedInPhoto("wizard");
    expect(m.pendingLinkedInPhoto("wizard")).toBeNull();
    expect(m.hasPendingLinkedInPhoto()).toBe(false);
  });

  it("a stale ticket is dropped", async () => {
    const m = await import("@/lib/linkedin-photo-return");
    localStorage.setItem("sc_li_ticket", JSON.stringify({ t: T, scope: "profile", at: Date.now() - 2 * 60 * 60 * 1000 }));
    expect(m.pendingLinkedInPhoto("profile")).toBeNull();
    expect(localStorage.getItem("sc_li_ticket")).toBeNull();
  });

  it("asks the endpoint by ticket: a photo settles it, pending keeps waiting, a failure settles it", async () => {
    const m = await import("@/lib/linkedin-photo-return");
    const photo = `https://example.supabase.co/storage/v1/object/public/card-uploads/guest-linkedin/${T}.jpg`;
    let answer: unknown = { pending: true };
    const asked: string[] = [];
    vi.stubGlobal("fetch", async (u: string) => { asked.push(u); return new Response(JSON.stringify(answer)); });

    localStorage.setItem("sc_li_ticket", JSON.stringify({ t: T, scope: "profile", at: Date.now() }));
    expect(await m.pickUpLinkedInPhoto("profile")).toBeNull();
    expect(asked[0]).toBe(`/api/integrations/linkedin/photo?t=${T}`);
    expect(m.pendingLinkedInPhoto("profile")).not.toBeNull();

    answer = { url: photo };
    expect(await m.pickUpLinkedInPhoto("profile")).toEqual({ url: photo });
    expect(m.pendingLinkedInPhoto("profile")).toBeNull();
    // Nothing waiting, nothing asked.
    expect(await m.pickUpLinkedInPhoto("profile")).toBeNull();
    expect(asked.length).toBe(2);

    localStorage.setItem("sc_li_ticket", JSON.stringify({ t: T, scope: "profile", at: Date.now() }));
    answer = { status: "nophoto" };
    expect(await m.pickUpLinkedInPhoto("profile")).toEqual({ status: "nophoto" });
    expect(m.pendingLinkedInPhoto("profile")).toBeNull();
  });

  it("never applies a URL off our own storage", async () => {
    const m = await import("@/lib/linkedin-photo-return");
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ url: "https://evil.example/x.jpg" })));
    localStorage.setItem("sc_li_ticket", JSON.stringify({ t: T, scope: "profile", at: Date.now() }));
    expect(await m.pickUpLinkedInPhoto("profile")).toBeNull();
    expect(m.isStoredPhotoUrl("javascript:alert(1)")).toBe(false);
  });

  it("drops the answer if the photo arrived some other way while it asked", async () => {
    const m = await import("@/lib/linkedin-photo-return");
    localStorage.setItem("sc_li_ticket", JSON.stringify({ t: T, scope: "wizard", at: Date.now() }));
    vi.stubGlobal("fetch", async () => {
      m.settleLinkedInPhoto("wizard"); // the ?li_photo= reader got there first
      return new Response(JSON.stringify({ url: `https://example.supabase.co/storage/v1/object/public/card-uploads/guest-linkedin/${T}.jpg` }));
    });
    expect(await m.pickUpLinkedInPhoto("wizard")).toBeNull();
  });

  it("a failure is handed to the suggester once; a success is not", async () => {
    const { stashGuestLinkedInStatus, takeGuestLinkedInStatus } = await import("@/lib/linkedin-photo-return");
    stashGuestLinkedInStatus("photo");
    expect(takeGuestLinkedInStatus()).toBeNull();
    stashGuestLinkedInStatus("nophoto");
    expect(takeGuestLinkedInStatus()).toBe("nophoto");
    expect(takeGuestLinkedInStatus()).toBeNull();
  });

  it("the hook asks on load, focus, return to the tab, the app's return event, and while waiting", () => {
    const src = read("src/lib/linkedin-photo-return.ts");
    const hook = src.slice(src.indexOf("export function useLinkedInPhotoPickup"));
    expect(hook).toMatch(/void check\(\);\s*const timer = setInterval\(tick, POLL_MS\);/);
    for (const ev of ['"focus"', '"pageshow"', "LINKEDIN_RETURN_EVENT"]) expect(hook).toContain(`window.addEventListener(${ev}, onReturn)`);
    expect(hook).toContain('document.addEventListener("visibilitychange", onVisible)');
  });
});

// ── The server's half ───────────────────────────────────────────────────────

const uploads: { path: string; type: string }[] = [];
let listed: { name: string }[] = [];
vi.mock("@/lib/supabase-admin", () => ({
  getAdminSupabase: () => ({
    storage: {
      from: () => ({
        upload: async (path: string, _b: unknown, o: { contentType: string }) => { uploads.push({ path, type: o.contentType }); return { error: null }; },
        getPublicUrl: (path: string) => ({ data: { publicUrl: `https://example.supabase.co/storage/v1/object/public/card-uploads/${path}` } }),
        list: async () => ({ data: listed, error: null }),
      }),
    },
  }),
}));
vi.mock("@/lib/connect-user", () => ({ resolveConnectUserId: async () => null }));
vi.mock("@/lib/linkedin-photo", () => ({ fetchLinkedInPhoto: async () => ({ body: Buffer.from("jpg"), wasSmall: false }) }));
let profilePicture: string | null = "https://media.licdn.com/p.jpg";
vi.mock("@/lib/sync-linkedin", async (orig) => ({
  ...(await orig<typeof import("@/lib/sync-linkedin")>()),
  exchangeLinkedInCode: async () => ({ access_token: "tok" }),
  fetchLinkedInProfile: async () => ({ picture: profilePicture }),
}));

const cookie = (res: Response, name: string) => res.headers.getSetCookie().find((c) => c.startsWith(`${name}=`)) ?? "";

describe("the connect leg carries the ticket to the callback", () => {
  beforeEach(() => {
    process.env.LINKEDIN_CLIENT_ID = "cid";
    process.env.LINKEDIN_CLIENT_SECRET = "secret";
    process.env.OAUTH_SECRET = "test-oauth-secret";
  });

  it("a valid ticket is kept in an httpOnly cookie; anything else clears it", async () => {
    const { GET } = await import("@/app/api/integrations/linkedin/connect/route");
    const ok = await GET(new Request(`https://swiftcard.me/api/integrations/linkedin/connect?guest=1&next=%2Fprofile&t=${T}`));
    expect(cookie(ok, "li_ticket")).toMatch(new RegExp(`^li_ticket=${T};`));
    expect(cookie(ok, "li_ticket")).toMatch(/HttpOnly/i);
    const bad = await GET(new Request("https://swiftcard.me/api/integrations/linkedin/connect?guest=1&t=..%2Fx"));
    expect(cookie(bad, "li_ticket")).toMatch(/Max-Age=0/i);
  });
});

async function callback(opts: { native?: boolean; ticket?: string | null } = {}) {
  const { signState, oauthBindCookieName, oauthBindCookieValue } = await import("@/lib/oauth-state");
  const { GUEST_STATE } = await import("@/lib/sync-linkedin");
  const state = signState(GUEST_STATE);
  const req = new NextRequest(`https://swiftcard.me/api/integrations/linkedin/callback?code=c&state=${encodeURIComponent(state)}`);
  req.cookies.set(oauthBindCookieName("linkedin"), oauthBindCookieValue(state));
  req.cookies.set("li_return_to", "/cards/new");
  if (opts.ticket !== null) req.cookies.set("li_ticket", opts.ticket ?? T);
  if (opts.native) req.cookies.set("li_native", "1");
  const { GET } = await import("@/app/api/integrations/linkedin/callback/route");
  return GET(req);
}

describe("the callback stores the photo under the ticket", () => {
  beforeEach(() => {
    process.env.LINKEDIN_CLIENT_ID = "cid";
    process.env.LINKEDIN_CLIENT_SECRET = "secret";
    process.env.OAUTH_SECRET = "test-oauth-secret";
    uploads.length = 0;
    profilePicture = "https://media.licdn.com/p.jpg";
  });

  it("at the ticket's path, still returns ?li_photo= on the web, and clears every cookie", async () => {
    const res = await callback();
    expect(uploads).toEqual([{ path: `guest-linkedin/${T}.jpg`, type: "image/jpeg" }]);
    const loc = new URL(res.headers.get("location")!);
    expect(loc.pathname).toBe("/cards/new");
    expect(loc.searchParams.get("li_photo")).toMatch(new RegExp(`guest-linkedin/${T}\\.jpg$`));
    for (const c of ["li_return_to", "li_native", "li_ticket"]) expect(cookie(res, c)).toMatch(/Max-Age=0/i);
  });

  it("without a ticket (an older page), a fresh name as before", async () => {
    await callback({ ticket: null });
    expect(uploads[0].path).toMatch(/^guest-linkedin\/[0-9a-f-]{36}\.jpg$/);
    expect(uploads[0].path).not.toContain(T);
  });

  it("no LinkedIn photo leaves a status marker the page can read", async () => {
    profilePicture = null;
    const res = await callback();
    expect(uploads).toEqual([{ path: `guest-linkedin/${T}.status-nophoto.gif`, type: "image/gif" }]);
    expect(new URL(res.headers.get("location")!).searchParams.get("status")).toBe("nophoto");
  });

  it("in the app: a page with the swiftcard:// link AND a button, never a bare 302", async () => {
    const res = await callback({ native: true });
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
    const html = await res.text();
    expect(html).toMatch(/<meta http-equiv="refresh" content="0;url=swiftcard:\/\/linkedin-callback\?status=photo&amp;next=/);
    expect(html).toMatch(/<a href="swiftcard:\/\/linkedin-callback\?status=photo&amp;next=[^"]+">Back to SwiftCard<\/a>/);
    // No script needed (and nothing for a CSP to block).
    expect(html).not.toMatch(/<script/);
    for (const c of ["li_return_to", "li_native", "li_ticket"]) expect(cookie(res, c)).toMatch(/Max-Age=0/i);
  });
});

describe("the pickup endpoint", () => {
  it("refuses anything but a ticket, then answers url / status / pending", async () => {
    const { GET } = await import("@/app/api/integrations/linkedin/photo/route");
    const ask = (t: string) => GET(new Request(`https://swiftcard.me/api/integrations/linkedin/photo?t=${encodeURIComponent(t)}`));

    expect((await ask("x")).status).toBe(400);
    expect((await ask(`${T}%`)).status).toBe(400);

    listed = [];
    let r = await ask(T);
    expect(await r.json()).toEqual({ pending: true });
    expect(r.headers.get("cache-control")).toBe("no-store");

    listed = [{ name: `${T}.status-error.gif` }];
    expect(await (await ask(T)).json()).toEqual({ status: "error" });

    // A photo wins over an earlier failure under the same ticket.
    listed = [{ name: `${T}.status-error.gif` }, { name: `${T}.jpg` }];
    r = await ask(T);
    expect(await r.json()).toEqual({ url: `https://example.supabase.co/storage/v1/object/public/card-uploads/guest-linkedin/${T}.jpg` });

    // Another ticket's objects (a prefix match) never count.
    listed = [{ name: `${T}0.jpg` }];
    expect(await (await ask(T)).json()).toEqual({ pending: true });
  });
});

// ── The wiring ──────────────────────────────────────────────────────────────

describe("every LinkedIn button takes the ticketed one-shot import", () => {
  const suggest = read("src/components/ProfilePhotoSuggest.tsx");

  it("guest=1 with the ticket, for every account and screen", () => {
    expect(suggest).toMatch(/const connectBase = "\/api\/integrations\/linkedin\/connect\?guest=1";/);
    expect(suggest).toMatch(/const t = startLinkedInPhoto\(scope\);/);
    expect(suggest).toMatch(/hopHref: `\$\{connectHref\}&t=\$\{t\}`/);
    expect(suggest).toMatch(/awayHref: `\$\{connectBase\}&next=\$\{encodeURIComponent\(relay\)\}&t=\$\{t\}`/);
    expect(suggest.match(/onClick=\{connectLinkedIn\}/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it("the old account-connect return leg is gone", () => {
    expect(suggest).not.toMatch(/finishLinkedInReturn|pendingNonce|takeLinkedInResult|LINKEDIN_MESSAGE|\/api\/integrations\/handoff/);
    expect(existsSync(join(process.cwd(), "src/lib/linkedin-popup.ts"))).toBe(false);
  });

  it("each of the six screens picks up its own scope and opens the crop tool", () => {
    const screens: [string, RegExp, RegExp][] = [
      ["src/app/cards/new/NewCardWizard.tsx", /scope=\{LI_SCOPE\}/, /useLinkedInPhotoPickup\(LI_SCOPE,/],
      ["src/app/cards/[id]/edit/CardEditForm.tsx", /scope=\{`card:\$\{card\.id\}`\}/, /useLinkedInPhotoPickup\(`card:\$\{card\.id\}`,[\s\S]*?setPhotoAdjustKey\(\(k\) => k \+ 1\);[\s\S]*?\{ fromUrl: true \}\);/],
      ["src/components/ProfileForm.tsx", /scope="profile"/, /useLinkedInPhotoPickup\("profile",[\s\S]*?setPhotoAdjustKey\(\(k\) => k \+ 1\);[\s\S]*?\{ fromUrl: true \}\);/],
    ];
    for (const [f, prop, hook] of screens) {
      const src = read(f);
      expect(src, f).toMatch(prop);
      expect(src, f).toMatch(hook);
      expect(src, f).toMatch(/adjustKey=\{photoAdjustKey\}/);
    }
    for (const p of ["card", "swiftlink", "signature"]) {
      expect(read(`src/components/site/${p === "card" ? "Card" : p === "swiftlink" ? "SwiftLink" : "Signature"}MiniBuilder.tsx`)).toContain(`scope="builder:${p}"`);
    }
    expect(read("src/components/site/useProductSketch.ts")).toMatch(/useLinkedInPhotoPickup\(`builder:\$\{product\}`/);
  });

  it("the wizard always lands on the photo, on step 2, whether or not a draft was found", () => {
    const wizard = read("src/app/cards/new/NewCardWizard.tsx");
    expect(wizard).toMatch(/setHeadshotUrl\(liPhotoRef\.current\);\s*setPhotoAdjustKey\(\(k\) => k \+ 1\);\s*setStep\(2\);/);
    expect(wizard).toMatch(/settleLinkedInPhoto\(LI_SCOPE\);/);
  });

  it("the app asks for the photo when its sheet closes, or its link arrives, without reloading", () => {
    const bridge = read("src/components/NativeAppBridge.tsx");
    expect(bridge).toMatch(/Browser\.addListener\("browserFinished", \(\) => \{\s*window\.dispatchEvent\(new Event\(LINKEDIN_RETURN_EVENT\)\);/);
    const branch = bridge.slice(bridge.indexOf("swiftcard://linkedin-callback"), bridge.indexOf("// Integration OAuth return legs."));
    expect(branch).toMatch(/window\.dispatchEvent\(new Event\(LINKEDIN_RETURN_EVENT\)\);\s*return;/);
    expect(branch).not.toMatch(/location\.(href|replace|assign)/);
  });

  it("the editors' LinkedIn window only closes; it never becomes the editor", () => {
    const relay = read("src/app/linkedin-connected/page.tsx");
    expect(relay).toMatch(/window\.close\(\)/);
    expect(relay).not.toMatch(/location\.(replace|href|assign)/);
    expect(relay).toMatch(/Your LinkedIn photo is ready/);
    expect(relay).toMatch(/Open SwiftCard here instead/);
    expect(relay).toMatch(/safeNextPath\(/);
  });
});
