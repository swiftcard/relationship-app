import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";

// ── Audit round 30 (2026-10-18): disconnect means disconnected, and a preview
//    never calls itself production ─────────────────────────────────────────
//
// I-07  Disconnecting Google, Salesforce or HubSpot deleted only SwiftCard's
//       row; the grant stayed live at the provider.
// E-02  NEXT_PUBLIC_APP_URL is Production-only, so the 85 inline
//       `|| "https://swiftcard.me"` fallbacks made every preview send Stripe
//       returns and OAuth callbacks to production.

vi.mock("@/lib/token-crypto", () => ({ decryptToken: (s: string) => `plain:${s}` }));
vi.mock("@/lib/supabase-admin", () => ({ getAdminSupabase: () => ({}) }));

import { revokeProviderGrant } from "@/lib/oauth-revoke";
import { appUrl } from "@/lib/app-url";

const read = (p: string) => readFileSync(p, "utf8");
const env = { ...process.env };
afterEach(() => { process.env = { ...env }; vi.unstubAllGlobals(); });

describe("I-07: a disconnect revokes at the provider", () => {
  it("Google: the refresh token is posted to Google's revoke endpoint", async () => {
    const fetchMock = vi.fn(async () => new Response("", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await revokeProviderGrant("google", { refresh_token: "r1", access_token: "a1" })).toBe(true);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://oauth2.googleapis.com/revoke");
    expect(String(init.body)).toBe("token=plain%3Ar1");
  });

  it("Salesforce: the customer's own instance, never an arbitrary host", async () => {
    const fetchMock = vi.fn(async () => new Response("", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await revokeProviderGrant("salesforce", { refresh_token: "r1", metadata: { instance_url: "https://acme.my.salesforce.com" } });
    await revokeProviderGrant("salesforce", { refresh_token: "r1", metadata: { instance_url: "https://evil.example.com" } });
    expect((fetchMock.mock.calls as unknown as [string][]).map((c) => c[0])).toEqual([
      "https://acme.my.salesforce.com/services/oauth2/revoke",
      "https://login.salesforce.com/services/oauth2/revoke",
    ]);
  });

  it("HubSpot: the refresh token is deleted at HubSpot", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await revokeProviderGrant("hubspot", { refresh_token: "r1" })).toBe(true);
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe("https://api.hubapi.com/oauth/v1/refresh-tokens/plain%3Ar1");
  });

  it("a provider that is down never stops the disconnect", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    expect(await revokeProviderGrant("google", { refresh_token: "r1" })).toBe(false);
  });

  it.each(["google", "salesforce", "hubspot"])("the %s disconnect route revokes before it deletes", (p) => {
    const route = read(`src/app/api/integrations/${p}/route.ts`);
    expect(route).toContain(`const { error } = await disconnectOAuthCrm(user.id, "${p}");`);
    const lib = read("src/lib/oauth-revoke.ts");
    expect(lib.indexOf("await revokeProviderGrant(provider, row)")).toBeLessThan(lib.indexOf('.from("integrations").delete()'));
  });
});

describe("E-02: a deployment's own address", () => {
  it("production keeps its explicit URL; a preview uses its own; dev uses localhost", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://swiftcard.me/";
    expect(appUrl()).toBe("https://swiftcard.me");
    delete process.env.NEXT_PUBLIC_APP_URL;
    process.env.VERCEL_ENV = "preview";
    process.env.VERCEL_BRANCH_URL = "relationship-app-git-x.vercel.app";
    expect(appUrl()).toBe("https://relationship-app-git-x.vercel.app");
    delete process.env.VERCEL_ENV;
    (process.env as Record<string, string>).NODE_ENV = "development";
    expect(appUrl()).toMatch(/^http:\/\/localhost:\d+$/);
  });

  it.each([
    "src/app/api/stripe/checkout/route.ts",
    "src/app/api/stripe/portal/route.ts",
    "src/app/api/integrations/google/connect/route.ts",
    "src/app/api/integrations/google/callback/route.ts",
    "src/app/api/integrations/salesforce/connect/route.ts",
    "src/app/api/integrations/salesforce/callback/route.ts",
    "src/app/api/integrations/linkedin/connect/route.ts",
    "src/app/api/integrations/linkedin/callback/route.ts",
    "src/lib/crm-sync.ts",
  ])("%s builds its URLs from appUrl()", (f) => {
    const src = read(f);
    expect(src).toContain("const APP_URL = appUrl();");
    expect(src).not.toContain('NEXT_PUBLIC_APP_URL || "https://swiftcard.me"');
  });
});
