import { afterEach, describe, expect, it, vi } from "vitest";
import { authorizeUrl, describeAccount, exchangeCode } from "@/lib/agent-connect-oauth";

// The existing Meta connect step, reused for Instagram Business Discovery
// (2026-11-06). Live facts it is built on: SwiftCard's Page belongs to the
// "Swift Card" business portfolio, so /me/accounts comes back empty for the
// owner's login; reading the Page by its id works and shows @swiftcard.me.

const PAGE = "1203411429528960";
const IG = "17841443384324190";

type Route = (url: string) => unknown;
function stubGraph(route: Route) {
  const seen: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (u: string | URL | Request) => {
    const url = String(u);
    seen.push(url);
    const body = route(url);
    return new Response(JSON.stringify(body ?? { error: { code: 100, message: "unexpected" } }), { status: body ? 200 : 400 });
  }));
  return seen;
}

const live: Route = (url) => {
  if (url.includes("/me/accounts")) return { data: [] };
  if (url.includes("/debug_token")) return { data: { granular_scopes: [{ scope: "pages_show_list", target_ids: [PAGE] }, { scope: "instagram_basic", target_ids: [IG] }] } };
  if (url.includes(`/${PAGE}?fields=`)) return { id: PAGE, name: "SwiftCard", instagram_business_account: { id: IG, username: "swiftcard.me" } };
  if (url.includes(`/${IG}?fields=`)) return { business_discovery: { username: "swiftcard.me", media_count: 12 }, id: IG };
  if (url.includes("/me/permissions")) return { data: ["pages_show_list", "pages_read_engagement", "instagram_basic", "instagram_manage_insights"].map((permission) => ({ permission, status: "granted" })) };
  return null;
};

describe("Meta connect: read-only, for Business Discovery", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("asks only for the four read permissions", () => {
    vi.stubEnv("META_APP_ID", "123");
    vi.stubEnv("META_SCOPES", "");
    const scope = new URL(authorizeUrl("meta", "state")).searchParams.get("scope");
    expect(scope?.split(" ").sort()).toEqual(["instagram_basic", "instagram_manage_insights", "pages_read_engagement", "pages_show_list"]);
  });

  it("keeps the long-lived token and its 60-day expiry, and refuses a short one", async () => {
    vi.stubEnv("META_APP_ID", "123");
    vi.stubEnv("META_APP_SECRET", "s");
    stubGraph((url) => (url.includes("fb_exchange_token") ? { access_token: "LONG", expires_in: 5_183_944 } : { access_token: "SHORT" }));
    expect(await exchangeCode("meta", "code")).toMatchObject({ access_token: "LONG", expires_in: 5_183_944, refresh_token: null });
    stubGraph((url) => (url.includes("fb_exchange_token") ? {} : { access_token: "SHORT" }));
    await expect(exchangeCode("meta", "code")).rejects.toThrow(/long-lived/);
  });

  it("finds a portfolio-owned Page through the ticked Pages, proves Business Discovery works, and stores the user token", async () => {
    vi.stubEnv("META_APP_ID", "123");
    vi.stubEnv("META_APP_SECRET", "s");
    vi.stubEnv("META_PAGE_ID", "");
    const seen = stubGraph(live);
    const a = await describeAccount("meta", { access_token: "LONG", expires_in: 5_183_944 });
    expect(a).toMatchObject({ account_id: PAGE, account_label: "SwiftCard · @swiftcard.me", access_token: "LONG", meta: { page_id: PAGE, ig_user_id: IG, ig_username: "swiftcard.me" } });
    expect(a.expires_at).toBeTruthy();
    expect(seen.some((u) => decodeURIComponent(u).includes("business_discovery.username(swiftcard.me)"))).toBe(true);
    // Nothing that writes: no subscribe, no POST anywhere.
    expect(seen.some((u) => u.includes("subscribed_apps"))).toBe(false);
  });

  it("says what to do when no Page was ticked or the Page has no Instagram account", async () => {
    vi.stubEnv("META_APP_ID", "123");
    vi.stubEnv("META_APP_SECRET", "s");
    stubGraph((url) => (url.includes("/me/accounts") ? { data: [] } : url.includes("/debug_token") ? { data: { granular_scopes: [] } } : null));
    await expect(describeAccount("meta", { access_token: "LONG" })).rejects.toThrow(/tick the SwiftCard Page/);
    stubGraph((url) => (url.includes("/me/accounts") ? { data: [{ id: PAGE }] } : url.includes(`/${PAGE}?`) ? { id: PAGE, name: "SwiftCard" } : null));
    await expect(describeAccount("meta", { access_token: "LONG" })).rejects.toThrow(/no Instagram business account linked/);
  });

  it("refuses a login that can't run Business Discovery, before anything is stored", async () => {
    vi.stubEnv("META_APP_ID", "123");
    vi.stubEnv("META_APP_SECRET", "s");
    stubGraph((url) => (url.includes(`/${IG}?fields=`) ? null : live(url)));
    await expect(describeAccount("meta", { access_token: "LONG" })).rejects.toThrow(/Business Discovery refused/);
  });
});
