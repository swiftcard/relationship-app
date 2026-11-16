import { describe, it, expect, vi } from "vitest";

// ── Card Builder: the owner's own networks never count as a prospect's view ──
// Reviewed 2026-11-16: a network the owner merely opened the admin on (a phone
// on a carrier that shares addresses, a café, a prospect's own office) must not
// hide a real prospect's views for long. The Mac's home network is kept longer.

vi.mock("@/lib/supabase-admin", () => ({ getAdminSupabase: () => ({}) }));
const { readNetworks, ADMIN_NETWORK_HOURS, OWNER_NETWORK_DAYS } = await import("@/lib/prospect-preview/outbox");
const { networkKey } = await import("@/lib/prospect-preview/network-key");

const NOW = Date.parse("2026-11-16T12:00:00Z");
const ago = (h: number) => new Date(NOW - h * 3_600_000).toISOString();

describe("how long a network stays the owner's", () => {
  it("one seen from an admin page lasts 12 hours", () => {
    expect(readNetworks([{ key: "a", at: ago(ADMIN_NETWORK_HOURS - 1), from: "admin" }], NOW)).toHaveLength(1);
    expect(readNetworks([{ key: "a", at: ago(ADMIN_NETWORK_HOURS + 1), from: "admin" }], NOW)).toHaveLength(0);
  });
  it("the Mac's lasts up to 30 days", () => {
    expect(readNetworks([{ key: "m", at: ago(24 * (OWNER_NETWORK_DAYS - 1)), from: "mac" }], NOW)).toHaveLength(1);
    expect(readNetworks([{ key: "m", at: ago(24 * (OWNER_NETWORK_DAYS + 1)), from: "mac" }], NOW)).toHaveLength(0);
  });
  it("garbage is ignored", () => {
    expect(readNetworks(null, NOW)).toEqual([]);
    expect(readNetworks([{ key: 1 }, "x"], NOW)).toEqual([]);
  });
});

describe("a network as a key that names no address", () => {
  it("IPv4 exactly; IPv6 by its /64; never the address itself", () => {
    expect(networkKey("198.51.100.7")).toBe(networkKey("198.51.100.7"));
    expect(networkKey("198.51.100.7")).not.toBe(networkKey("198.51.100.8"));
    expect(networkKey("2601:1c0:4a00:1234::1")).toBe(networkKey("2601:1c0:4a00:1234:9f2e:11ff:fe22:abcd"));
    expect(networkKey("2601:1c0:4a00:1235::1")).not.toBe(networkKey("2601:1c0:4a00:1234::1"));
    expect(networkKey("::ffff:198.51.100.7")).toBe(networkKey("198.51.100.7"));
    expect(networkKey("unknown")).toBeNull();
    expect(networkKey("198.51.100.7")).not.toContain("198");
  });
  it("a local, private or shared address is nobody's network (a local build sees everyone as 127.0.0.1)", () => {
    for (const ip of ["127.0.0.1", "::ffff:127.0.0.1", "::1", "10.1.2.3", "172.16.0.9", "172.31.255.1", "192.168.1.20", "100.64.0.1", "169.254.1.1", "fd12:3456::1", "fe80::1", "0.0.0.0"]) {
      expect(networkKey(ip), ip).toBeNull();
    }
    for (const ip of ["172.32.0.1", "100.128.0.1", "8.8.8.8", "2601:1c0::1"]) expect(networkKey(ip), ip).not.toBeNull();
  });
});
