import { lookup } from "node:dns/promises";
import { lookup as dnsLookupCb, type LookupAddress, type LookupOptions } from "node:dns";
import net from "node:net";
import { Agent, fetch as undiciFetch } from "undici";

// ── SSRF-safe outbound fetch ────────────────────────────────────────────────
// Two public endpoints fetch attacker-supplied URLs (img-proxy, link-preview).
// A hostname-only blocklist is NOT enough: (a) DNS can resolve a public-looking
// host to a private IP (DNS rebinding), and (b) redirect:"follow" lets a public
// URL 30x-hop to http://169.254.169.254/ or http://127.0.0.1/. This module
// resolves every hostname to its IPs, rejects private/loopback/link-local
// ranges, and re-checks on EVERY redirect hop (manual redirects).
//
// The subtle gap that the pre-check ALONE can't close: assertSafeUrl resolves
// the name, but then the actual fetch does its OWN, independent DNS lookup —
// a rebinding attacker returns a public IP to the pre-check and a private IP
// to the connection (TOCTOU). We close that by pinning the transport to a
// custom DNS lookup that re-validates every resolved address AT CONNECT TIME
// (undici Agent.connect.lookup), so the IP the socket actually dials is the
// same one that was vetted. Literal-IP URLs bypass DNS entirely, so those are
// still caught by assertSafeUrl's direct net.isIP() check below.

const PRIVATE_V4 = [
  /^0\./, /^10\./, /^127\./, /^169\.254\./, /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[0-1])\./,
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, // 100.64/10 CGNAT
  /^192\.0\.0\./, /^192\.0\.2\./, /^198\.1[89]\./, /^198\.51\.100\./, /^203\.0\.113\./,
  /^22[4-9]\./, /^23\d\./, /^24\d\./, /^25\d\./, // multicast + reserved 224-255
];

// Extract the embedded IPv4 from an IPv4-mapped/compatible IPv6 address, in
// dotted-decimal form — covering BOTH textual forms the value can take:
//   ::ffff:127.0.0.1   (dotted)  and   ::ffff:7f00:1   (hex — what the WHATWG
// URL parser normalizes the dotted form INTO). Missing the hex form was a real
// SSRF bypass: http://[::ffff:7f00:1]/ reaches 127.0.0.1. Also handles the
// deprecated IPv4-compatible ::x form.
function embeddedV4(h: string): string | null {
  const dotted = h.match(/^(?:::ffff:|::)(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) return dotted[1];
  const hex = h.match(/^(?:::ffff:|::)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hex) {
    const hi = parseInt(hex[1], 16);
    const lo = parseInt(hex[2], 16);
    return `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
  }
  return null;
}

function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) return PRIVATE_V4.some((re) => re.test(ip));
  if (net.isIPv6(ip)) {
    const h = ip.toLowerCase();
    if (h === "::1" || h === "::") return true;
    if (h.startsWith("fe80") || h.startsWith("fc") || h.startsWith("fd")) return true; // link-local + ULA
    // IPv4-mapped / -compatible — re-check the embedded v4 in either textual form.
    const v4 = embeddedV4(h);
    if (v4) return PRIVATE_V4.some((re) => re.test(v4));
    return false;
  }
  return true; // unparseable → treat as unsafe
}

function badHostname(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/\.$/, "");
  return (
    h === "localhost" || h.endsWith(".localhost") ||
    h.endsWith(".internal") || h.endsWith(".local") ||
    h === "metadata.google.internal"
  );
}

/** Throws if the URL's host is unsafe to fetch (bad scheme / name / resolved IP). */
export async function assertSafeUrl(u: URL): Promise<void> {
  if (!/^https?:$/.test(u.protocol)) throw new Error("blocked scheme");
  if (badHostname(u.hostname)) throw new Error("blocked host");
  // A literal IP in the URL never hits DNS — check it directly.
  const bare = u.hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(bare)) {
    if (isPrivateIp(bare)) throw new Error("blocked ip");
    return;
  }
  // Resolve the name and reject if ANY answer is private (rebinding defense).
  const results = await lookup(u.hostname, { all: true });
  if (!results.length) throw new Error("dns fail");
  for (const { address } of results) if (isPrivateIp(address)) throw new Error("blocked ip");
}

/** True only for a real Zapier catch-hook URL (https + hooks.zapier.com).
 * Zapier webhooks are always on this host, so allowlisting it removes the
 * SSRF / internal-port-scan surface of an arbitrary user-supplied webhook. */
export function isZapierWebhookUrl(raw: unknown): boolean {
  if (typeof raw !== "string" || !raw) return false;
  try {
    const u = new URL(raw);
    return u.protocol === "https:" && (u.hostname === "hooks.zapier.com" || u.hostname.endsWith(".hooks.zapier.com"));
  } catch { return false; }
}

// A dns.lookup-compatible function that rejects the connection if ANY resolved
// address is private. undici calls this at socket-connect time, so a name that
// rebinds to a private IP between the pre-check and the connection is blocked
// here — there is no separate re-resolution for the attacker to exploit.
// NOTE: undici only invokes lookup for HOSTNAMES; literal-IP targets skip it,
// which is why assertSafeUrl still guards the literal-IP case directly.
type LookupCb = (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void;
function validatingLookup(hostname: string, options: LookupOptions, callback: LookupCb): void {
  // Always resolve ALL addresses so a name that mixes public + private answers
  // is rejected, not just its first record.
  dnsLookupCb(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, addresses as unknown as string);
    for (const a of addresses) {
      if (isPrivateIp(a.address)) {
        return callback(new Error(`blocked private ip ${a.address}`), addresses);
      }
    }
    if (options.all) return callback(null, addresses);
    callback(null, addresses[0].address, addresses[0].family);
  });
}

// One shared agent — the validating lookup is the whole point; connect timeouts
// keep a slow/hostile host from hanging the request beyond the caller's signal.
const safeAgent = new Agent({
  connect: { lookup: validatingLookup, timeout: 8000 },
});

/**
 * fetch() that revalidates the target before the initial request and on every
 * redirect hop, AND pins the transport to a validating DNS lookup so a rebinding
 * host can't slip a private IP past the pre-check at connect time. Caps
 * redirects. Same signature surface as fetch for the fields callers use.
 */
export async function safeFetch(
  input: string,
  init: { signal?: AbortSignal; headers?: Record<string, string> } = {},
  maxRedirects = 4,
  beforeRequest?: (url: URL) => Promise<void>,
): Promise<Response> {
  let url = new URL(input);
  for (let i = 0; i <= maxRedirects; i++) {
    await assertSafeUrl(url);
    await beforeRequest?.(url);
    const res = await undiciFetch(url.toString(), {
      ...init,
      redirect: "manual",
      dispatcher: safeAgent,
    });
    // Manual mode surfaces 3xx as opaqueredirect/type — read Location ourselves.
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) return res as unknown as Response;
      url = new URL(loc, url); // resolve relative redirects
      continue;
    }
    return res as unknown as Response;
  }
  throw new Error("too many redirects");
}
