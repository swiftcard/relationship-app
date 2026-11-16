import { createHash } from "node:crypto";

// ── Card Builder: a network, as a key that names no address ─────────────────
// See outbox.ts ("The owner's own networks"). NO "@/" IMPORTS on purpose: the
// Mac agent (scripts/card-builder-mac/agent.mjs) loads this file directly with
// Node, so the Mac and the server compute the very same key.

/**
 * One key per connection: an IPv4 address as it is, an IPv6 address by its
 * /64 (a home network's prefix; the last half changes by itself). Hashed so
 * no address is ever stored.
 */
export function networkKey(ip: string): string | null {
  const a = ip.trim().toLowerCase().replace(/^::ffff:/, "");
  if (!a || a === "unknown") return null;
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

