import { describe, it, expect, afterEach } from "vitest";
import { GET } from "@/app/.well-known/apple-app-site-association/route";

// Item 8 — Apple App Site Association file. Purely additive: a brand-new route
// with no existing behavior to change.

describe("Item 8 — /.well-known/apple-app-site-association", () => {
  it("serves valid AASA JSON with a JSON content-type", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
    const body = await res.json();
    expect(body).toHaveProperty("applinks");
    expect(body.applinks.apps).toEqual([]);
    expect(Array.isArray(body.applinks.details)).toBe(true);
  });

  // No link opens the app — every path is excluded (owner, 2026-09-29;
  // tests/aasa-card-links.test.ts).
  it("declares the bundle id and excludes every path", async () => {
    const body = await (await GET()).json();
    const detail = body.applinks.details[0];
    expect(detail.appID).toContain("me.swiftcard.app");
    expect(detail.paths).toEqual(["NOT /*"]);
  });

  // The Team ID now comes from APPLE_TEAM_ID (the same variable Wallet and
  // Apple-revocation already use), so going live is an env change rather than a
  // code edit. These three cases pin the whole contract: dormant until set,
  // live once set, and never half-configured.
  describe("Team ID resolution", () => {
    const prev = process.env.APPLE_TEAM_ID;
    const setTeamId = (v: string | undefined) => {
      if (v === undefined) delete process.env.APPLE_TEAM_ID;
      else process.env.APPLE_TEAM_ID = v;
    };
    afterEach(() => setTeamId(prev));

    it("falls back to the marked placeholder while APPLE_TEAM_ID is unset", async () => {
      setTeamId(undefined);
      const body = await (await GET()).json();
      expect(body.applinks.details[0].appID).toBe("TEAMID_PLACEHOLDER.me.swiftcard.app");
    });

    it("uses APPLE_TEAM_ID once it is set, with no code change", async () => {
      setTeamId("ABCDE12345");
      const body = await (await GET()).json();
      expect(body.applinks.details[0].appID).toBe("ABCDE12345.me.swiftcard.app");
    });

    // A malformed value would produce an AASA Apple silently rejects — harder to
    // diagnose than simply having no Universal Links yet. Falling back keeps the
    // served file honestly readable as "not configured".
    it.each(["nope", "  ", "ABCDE12345.me.swiftcard.app", "ABCDE1234", "ABCDE123456"])(
      "ignores a malformed APPLE_TEAM_ID (%j) rather than serving a broken appID",
      async (bad) => {
        setTeamId(bad);
        const body = await (await GET()).json();
        expect(body.applinks.details[0].appID).toBe("TEAMID_PLACEHOLDER.me.swiftcard.app");
      },
    );

    it("trims surrounding whitespace off an otherwise valid value", async () => {
      setTeamId("  ABCDE12345  ");
      const body = await (await GET()).json();
      expect(body.applinks.details[0].appID).toBe("ABCDE12345.me.swiftcard.app");
    });
  });
});
