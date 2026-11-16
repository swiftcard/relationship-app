import { createHash } from "node:crypto";

// ── Card Builder: a network, as a key that names no address ─────────────────
// See outbox.ts ("The owner's own networks"). NO "@/" IMPORTS on purpose: the
// Mac agent (scripts/card-builder-mac/agent.mjs) loads this file directly with
// Node, so the Mac and the server compute the very same key.

/**
 * True for an address that names no one's network from the server's side:
 * this machine, a private LAN, carrier NAT, link-local, documentation ranges.
 * Thousands of homes share 192.168.1.x, and a local build sees every browser
 * as 127.0.0.1, so none of these may ever mark a network as the owner's
 * (that once made a local QA run's prospect look like the owner).
 */
export function isPrivateAddress(a: string): boolean {
  const v4 = a.match(/^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/);
  if (v4) {
    const [x, y] = [Number(v4[1]), Number(v4[2])];
    return x === 0 || x === 10 || x === 127 || (x === 100 && y >= 64 && y <= 127) || (x === 169 && y === 254)
      || (x === 172 && y >= 16 && y <= 31) || (x === 192 && y === 168) || x >= 224;
  }
  return a === "::" || a === "::1" || /^f[cd]/.test(a) || /^fe[89ab]/.test(a);
}

/**
 * One key per connection: an IPv4 address as it is, an IPv6 address by its
 * /64 (a home network's prefix; the last half changes by itself). Hashed so
 * no address is ever stored.
 */
export function networkKey(ip: string): string | null {
  const a = ip.trim().toLowerCase().replace(/^::ffff:/, "");
  if (!a || a === "unknown" || isPrivateAddress(a)) return null;
  let net: string;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(a)) net = a;
  else if (a.includes(":")) {
    const [head, tail = ""] = a.split("::");
    const left = head ? head.split(":") : [];
    const right = tail ? tail.split(":") : [];
    const full = [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill("0"), ...right].map((h) => h.replace(/^0+(?=.)/, ""));
    if (full.length !== 8) return null;
    net = `${full.slice(0, 4).join(":")}::/64`;
  } else return null;
  return createHash("sha256").update(`card-builder-network:${net}`).digest("hex").slice(0, 32);
}

