import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { scrubEvent } from "@/lib/sentry-scrub";

const root = process.cwd();
const code = (p: string) =>
  readFileSync(join(root, p), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("the Gemini key never rides in a URL", () => {
  it("every call site sends it as a header", () => {
    const c = code("src/lib/ai.ts");
    expect(c, "the key is back in the query string").not.toMatch(/key=\$\{process\.env\.GEMINI_API_KEY\}/);
    // aiComplete + aiVision + aiImageEdit (design transfer, added 2026-08-11).
    // If this count changes, verify the new call site uses the header too.
    expect((c.match(/x-goog-api-key/g) ?? []).length, "a call site was missed").toBe(3);
  });
});

describe("the Sentry scrubber walks spans", () => {
  it("strips the query string off span URLs", () => {
    // This is the container that carries outbound-fetch metadata, and it was
    // the only one the scrubber never walked — while "url" is deliberately not
    // a dropped key, so a credential in a URL passed straight through.
    const ev = scrubEvent({
      spans: [
        { url: "https://generativelanguage.googleapis.com/v1beta/models/x:generateContent?key=SECRET123" },
        { data: { "http.url": "https://api.example.com/v1/thing?token=SECRET456" } },
      ],
    } as Parameters<typeof scrubEvent>[0]);

    const dumped = JSON.stringify(ev);
    expect(dumped, "a credential survived in a span URL").not.toContain("SECRET123");
    expect(dumped).not.toContain("SECRET456");
    // The PATH is the useful part of a trace and must survive.
    expect(dumped).toContain("generateContent");
  });

  it("still scrubs span keys the same way as every other container", () => {
    const ev = scrubEvent({
      spans: [{ data: { email: "sam@example.com", phone: "+15551234567" } }],
    } as Parameters<typeof scrubEvent>[0]);
    const dumped = JSON.stringify(ev);
    expect(dumped).not.toContain("sam@example.com");
    expect(dumped).not.toContain("5551234567");
  });

  it("an event with no spans is unaffected", () => {
    const ev = scrubEvent({ message: "hello" } as Parameters<typeof scrubEvent>[0]);
    expect(ev).not.toBeNull();
    expect(ev?.message).toBe("hello");
  });
});

describe("outbound-spend endpoints are capped", () => {
  const SPEND = [
    "src/app/api/leads/[id]/message/route.ts",
    "src/app/api/leads/share-card/route.ts",
    "src/app/api/scanner/route.ts",
    // Image GENERATION — an order of magnitude dearer per call than a vision
    // read, which is why its own limit is the tightest of the four.
    "src/app/api/design-transfer/route.ts",
  ];

  it.each(SPEND)("%s rate-limits per user", (f) => {
    const c = code(f);
    expect(c, "no ceiling on a route that spends real money per call").toMatch(/isRateLimited\(`/);
    expect(c).toMatch(/\$\{user\.id\}/);
    expect(c).toMatch(/status: 429/);
  });

  it("the message body is bounded — SMS bills per segment", () => {
    expect(code("src/app/api/leads/[id]/message/route.ts")).toMatch(/body\.length > 5000/);
  });

  it("the scanner image is bounded", () => {
    expect(code("src/app/api/scanner/route.ts")).toMatch(/imageBase64\.length > 10_000_000/);
  });
});

describe("session cookies survive on every authenticated route", () => {
  it("the proxy matcher covers the previously-missing prefixes", () => {
    const c = code("src/proxy.ts");
    for (const p of ["/admin", "/grow", "/welcome", "/upgrade", "/checkout", "/join", "/share"]) {
      expect(c, `${p} is still outside the matcher — token rotation is lost there`).toContain(`"${p}/:path*"`);
    }
  });

  it("does NOT include /account-deleted, which the proxy redirects to", () => {
    expect(code("src/proxy.ts")).not.toContain('"/account-deleted/:path*"');
  });

  it("the login wall is unchanged — the matcher gates nothing", () => {
    // protectedPaths is what redirects to /login. Adding /join to the matcher
    // must not start bouncing signed-out invitees.
    const c = code("src/proxy.ts");
    const m = c.match(/const protectedPaths = \[([^\]]*)\]/);
    expect(m).toBeTruthy();
    expect(m![1]).not.toMatch(/"\/join"/);
    expect(m![1]).not.toMatch(/"\/welcome"/);
    expect(m![1]).not.toMatch(/"\/checkout"/);
  });
});

describe("the profiles privileged-column guard is checked in", () => {
  const SQL = "supabase/profiles-privileged-column-guard.sql";
  const sql = () => readFileSync(join(root, SQL), "utf8");

  it("states the revoke rather than relying on it being absent", () => {
    expect(sql()).toMatch(/revoke update, insert on public\.profiles from authenticated, anon/);
  });

  it("guards the plan, office and billing columns", () => {
    const s = sql();
    for (const col of ["plan", "office_id", "stripe_customer_id", "stripe_subscription_id"]) {
      expect(s).toContain(`new.${col}`);
    }
  });

  it("is SECURITY INVOKER — as DEFINER the role check is meaningless", () => {
    const s = sql();
    expect(s).toMatch(/security invoker/);
    expect(s).not.toMatch(/security definer/);
  });

  it("lets service_role through", () => {
    expect(sql()).toMatch(/current_user not in \('authenticated', 'anon'\)/);
  });
});
