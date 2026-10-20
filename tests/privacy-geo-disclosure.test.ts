import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// ── Every service a visitor's IP address is sent to is named in /privacy (I-08) ──
//
// Views and shared contacts look the visitor's IP up with a second IP-location
// service. The policy used to say location came from "our hosting provider"
// alone while the IP went to ipwho.is (production has no IPINFO_TOKEN). A new
// lookup host in request-geo.ts now fails here until the policy names it.

const geo = readFileSync("src/lib/request-geo.ts", "utf8");
const privacy = readFileSync("src/app/privacy/page.tsx", "utf8");

describe("IP-location disclosure", () => {
  const hosts = [...new Set([...geo.matchAll(/https:\/\/([a-z0-9.-]+)\//g)].map((m) => m[1]))];

  it("finds the lookup hosts", () => {
    expect(hosts).toEqual(expect.arrayContaining(["ipinfo.io", "ipwho.is"]));
  });

  it.each(hosts)("the privacy policy names %s", (host) => {
    expect(privacy).toContain(host);
  });

  it("no longer says location comes from the hosting provider alone", () => {
    expect(privacy).not.toMatch(/derived from IP address by our hosting provider\)/);
  });
});
