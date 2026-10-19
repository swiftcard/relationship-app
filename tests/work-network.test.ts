import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { workNetworkName, workNetworkPhrase } from "@/lib/work-network";
import { cardEventNotice } from "@/lib/card-event-notify";
import { redactForPlan } from "@/lib/notification-privacy";
import { DETAIL_MARK, stripLocationMarks, teaseLocation } from "@/lib/location-privacy";
import { fitBodyKeepingPlace, withDeviceIfItFits } from "@/lib/push-policy";
import { stripNameMarks, genericNames } from "@/lib/contact-privacy";
import { buildRecentVisits } from "@/lib/recent-visits";

// ── "On the Columbia University network" (owner, 2026-10-18) ─────────────────
// The organisation is named only when the network is plainly ITS OWN — never an
// internet provider, phone carrier, cloud, VPN or a WHOIS placeholder. Wrong
// silence is acceptable; naming someone's home ISP as if it were their
// employer is not.

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const own = (org: string, domain: string | null = null) => ({ org, isp: org, domain });

describe("whose network it was", () => {
  it("an organisation running its own network is named, tidily", () => {
    expect(workNetworkName(own("Columbia University", "columbia.edu"))).toBe("Columbia University");
    expect(workNetworkName(own("Apple Inc.", "apple.com"))).toBe("Apple");
    expect(workNetworkName(own("Northwell Health"))).toBe("Northwell Health");
    expect(workNetworkName({ org: "AS14 Columbia University", isp: null, domain: null })).toBe("Columbia University");
  });

  it("a business a provider assigned a block to is named; the provider is not", () => {
    expect(workNetworkName({ org: "Acme Dental LLC", isp: "Comcast Cable Communications, LLC", domain: "comcast.com" })).toBe("Acme Dental");
  });

  it("internet providers, carriers and transit are silence — every way they are named", () => {
    for (const isp of [
      "Comcast Cable Communications, LLC", "Charter Communications Inc", "Verizon Business", "AT&T Services, Inc.",
      "Cox Communications Inc.", "Optimum Online", "Frontier Communications of America", "Lumen Technologies",
      "Space Exploration Technologies Corporation", "T-Mobile USA, Inc.", "Hurricane Electric LLC", "Cogent Communications",
      "Google Fiber Inc.", "Rogers Communications Canada Inc.", "Vodafone GmbH", "Smalltown Rural Telephone Cooperative",
      "Hilltop Broadband", "Valley Fiber", "Starlink",
    ]) {
      expect(workNetworkName(own(isp)), isp).toBe(null);
    }
  });

  it("WHOIS placeholders for an ISP's own customers are not an organisation", () => {
    expect(workNetworkName({ org: "Private Customer", isp: "Comcast Cable Communications, LLC", domain: null })).toBe(null);
    expect(workNetworkName({ org: "Residential Subscriber Pool", isp: "Spectrum", domain: null })).toBe(null);
  });

  it("an organisation on a DIFFERENT non-provider operator is ambiguous: silence", () => {
    expect(workNetworkName({ org: "Acme Dental LLC", isp: "Regus Management Group", domain: null })).toBe(null);
  });

  it("a relay, a cloud or a phone carrier's gateway is never an office, whatever its name", () => {
    expect(workNetworkName(own("Columbia University"), { isRelay: true })).toBe(null);
    expect(workNetworkName(own("Columbia University"), { isHosting: true })).toBe(null);
    expect(workNetworkName(own("Columbia University"), { isCellular: true })).toBe(null);
    expect(workNetworkName(null)).toBe(null);
  });

  it("the words are 'on the … network', never 'at' or 'from'", () => {
    expect(workNetworkPhrase("Columbia University")).toBe(" on the Columbia University network");
    expect(workNetworkPhrase(null)).toBe("");
  });
});

describe("in the notification — Pro only, and the device goes first on a short lock screen", () => {
  const notice = cardEventNotice({
    eventType: "viewed_card", location: "New York, NY", geoAccuracy: "city",
    network: "Columbia University", device: " on an iPhone 16 Pro via Instagram",
  })!;
  const paidRender = (s: string) => stripNameMarks(stripLocationMarks(s));
  const freeRender = (s: string) => teaseLocation(genericNames(s));

  it("Pro's bell reads the whole sentence", () => {
    const [pro] = redactForPlan([{ type: "card_viewed", title: notice.title, body: notice.body }], true);
    expect(pro.body).toBe("Someone on the Columbia University network viewed your card near New York, NY on an iPhone 16 Pro via Instagram.");
  });

  it("Free's bell has neither the network nor the device", () => {
    const [free] = redactForPlan([{ type: "card_viewed", title: notice.title, body: notice.body }], false);
    expect(free.body).not.toMatch(/Columbia|iPhone|Instagram/);
    expect(free.body).not.toContain(DETAIL_MARK);
    expect(free.body).toMatch(/^Someone viewed your card/);
  });

  it("too long for a lock screen: the device is dropped, the network kept", () => {
    const out = fitBodyKeepingPlace(withDeviceIfItFits(notice.body, true, paidRender), paidRender);
    expect(out).toBe("Someone on the Columbia University network viewed your card near New York, NY.");
    expect(fitBodyKeepingPlace(withDeviceIfItFits(notice.body, false, freeRender), freeRender)).not.toMatch(/Columbia|iPhone/);
  });

  it("no network: the sentence is exactly what it was", () => {
    const plain = cardEventNotice({ eventType: "viewed_card", location: "New York, NY", geoAccuracy: "city" })!;
    expect(stripLocationMarks(plain.body)).toBe("Someone viewed your card near New York, NY.");
  });
});

describe("in Recent visits — Pro only", () => {
  const events = [{
    id: "v", created_at: new Date().toISOString(), event_type: "viewed_card", surface: "card",
    visitor_id: "visitor-aaaa", network_org: "Columbia University", device_info: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
  }];
  it("Pro sees whose network; Free never receives it", () => {
    expect(buildRecentVisits({ events, history: [], leads: [], paid: true, limit: 5 })[0].network).toBe("Columbia University");
    expect(buildRecentVisits({ events, history: [], leads: [], paid: false, limit: 5 })[0].network).toBe(null);
  });
});

describe("wiring", () => {
  it("the lookup the location already makes supplies it — no new service, no IP stored", () => {
    const geo = read("src/lib/request-geo.ts");
    expect(geo).toContain("network: { org: str(conn.org), isp: str(conn.isp), domain: str(conn.domain) },");
    expect(geo).toMatch(/workNetwork: workNetworkName\(second\?\.network \?\? null, \{/);
  });
  it("a replay carries no network, like it carries no place", () => {
    expect(read("src/app/api/card-events/route.ts")).toContain("label: null, accuracy: null, source: null, workNetwork: null");
  });
  it("the route stores it and the notice says it", () => {
    const route = read("src/app/api/card-events/route.ts");
    expect(route).toContain("...(geo.workNetwork ? { network_org: geo.workNetwork } : {}),");
    expect(route).toContain("network: geo.workNetwork,");
  });
});
