import type { NextRequest } from "next/server";

// ── Coarse location for one request ──────────────────────────────────────────
//
// Single source of truth for how a view/lead event gets its location. Two
// inputs, both about THIS request's IP, never cached across visitors and
// never client-supplied, so one visitor's location can never be replayed onto
// another visitor's event:
//
//   1. The Vercel edge geo headers (MaxMind) on the request — always present.
//   2. A second, independent IP database (ipinfo with IPINFO_TOKEN, else the
//      keyless ipwho.is), looked up by IP with a hard timeout.
//
// WHY TWO. IP geolocation is a guess about where an ISP registered an address
// block, not where the phone is. 2026-09-03: a Long Island viewer showed as
// "Bolton Landing" — Lake George, four hours away — and the SAME IP came back
// as Trumansburg (Ithaca) from three other databases. Nobody had the town;
// every database was confidently wrong in a different direction. One source
// cannot know it is wrong. Two sources that disagree can, and the honest
// answer then is the level they DO agree on:
//
// The state in "City, ST" comes from whichever source has it — they are both
// describing the same IP, so there is no such thing as the edge "not knowing"
// a state the second database just supplied.
//
//   both name the same city   → "City, ST"        (US/CA) or "City, CC"
//   they disagree             → "State, CC"       the region they share
//   cellular carrier IP       → "State, CC"       a carrier hub is never a city
//   only one has a city       → that city         no contradiction, no downgrade
//   second source unavailable → edge headers alone, as before
//
// Honesty rules:
//   • Missing data stays missing — null, never a placeholder city.
//   • A city without a country is still a real signal and is kept, and a bare
//     country code is kept as-is; the UI labels it.
//   • The raw IP is never part of the returned value or stored anywhere.
//
// x-vercel-ip-city is percent-encoded ("S%C3%A3o%20Paulo"). A malformed value
// must degrade to "header absent", not throw — an unguarded decodeURIComponent
// here once turned a bad geo header into a 500 that killed lead capture.

export type GeoGuess = {
  city: string | null;
  /** ISO 3166-2 subdivision code without the country ("NY"), when known. */
  regionCode: string | null;
  /** Human region name ("New York"), when known. */
  regionName: string | null;
  /** Bare ISO country code. */
  country: string | null;
  /** Network owner ("AS6167 Verizon Business") — for the cellular rule only. */
  org: string | null;
};

/** What the edge said about this request. Pure, synchronous, never throws. */
export function edgeGeo(req: NextRequest): GeoGuess {
  const city = safeDecode(req.headers.get("x-vercel-ip-city"));
  const country = isoCountry(req.headers.get("x-vercel-ip-country"));
  const regionRaw = req.headers.get("x-vercel-ip-country-region");
  const regionCode = regionRaw && /^[A-Z0-9]{1,3}$/.test(regionRaw) ? regionRaw : null;
  return { city, regionCode, regionName: regionCode ? US_STATES[regionCode] ?? null : null, country, org: null };
}

/**
 * Edge headers only — the synchronous form. Kept for callers that have no IP
 * to cross-check with; everything that records an event uses resolveLocation.
 */
export function requestLocation(req: NextRequest): string | null {
  return formatLocation(edgeGeo(req));
}

/**
 * Edge headers cross-checked against a second database. Never throws, never
 * slower than the timeout, falls back to the edge answer on any failure.
 */
export async function resolveLocation(req: NextRequest, ip: string): Promise<string | null> {
  const edge = edgeGeo(req);
  const second = await secondOpinion(ip);
  return reconcile(edge, second);
}

// ── How much of the answer is actually known ─────────────────────────────────
//
// THE BUG THIS EXISTS FOR. The decision table below has always known the
// difference between "two databases named this town" and "two databases
// disagreed, so all I can honestly say is the state" — and then threw it away,
// returning a bare string for both. Those strings are shaped identically:
//
//   "Ithaca, NY"      both sources named the town
//   "Great Neck, US"  one source named the town; nothing confirmed it
//   "New York, US"    the sources DISAGREED — somewhere in New York State
//   "US"              country only
//
// Production 2026-09-03 → 09-09: 19 of 26 views stored "New York, US", and the
// owner's push read "viewed your card near New York, US", which every reader
// takes to mean New York City. It does not mean that, and the pipeline knew.
//
// So the confidence now travels WITH the label. The LABEL FORMAT IS UNCHANGED
// on purpose: it is the Locations tab's grouping key and locationAliases()'
// input, so re-shaping it would split history in two. lib/location-display.ts
// composes the pair into the words a person reads.
export type GeoAccuracy =
  /** Two independent sources named the same town. The one answer worth stating flat. */
  | "city"
  /** A town from a single unconfirmed source. Real signal, but "near", not "in". */
  | "city_approx"
  /** Region/state only: the sources disagreed on the town, or the IP is a carrier
   *  or relay gateway, where naming a town is a coin toss. */
  | "region"
  /** Country only. */
  | "country";

export type GeoResult = {
  /** Exactly what resolveLocation() has always returned — the stored label. */
  label: string | null;
  /** Null only when there is no label at all. */
  accuracy: GeoAccuracy | null;
  /** Which databases produced it, so a one-source answer is visible as one. */
  source: "edge+second" | "edge" | null;
  /** Network owner, for classification only. NEVER stored or displayed. */
  org: string | null;
  /** The network anonymises or relocates its users (Private Relay, VPN, cloud
   *  egress), so even a confident town is the relay's town, not theirs. */
  isRelay: boolean;
  /** Narrower than isRelay: a datacenter/cloud egress that is NOT a known
   *  consumer privacy relay. A person is never on the other end of one, so the
   *  view pipeline declines to count it (record-view.ts). */
  isHosting: boolean;
};

/**
 * The full geo answer for one request: the same label as resolveLocation, plus
 * how much of it is real.
 *
 * Same cost as resolveLocation — one cached second-opinion lookup — so the
 * ingest path pays nothing extra for the honesty.
 */
export async function resolveGeo(req: NextRequest, ip: string): Promise<GeoResult> {
  const edge = edgeGeo(req);
  const second = await secondOpinion(ip);
  const org = second?.org ?? null;
  const isRelay = !!org && RELAY_OR_HOSTING.test(org);
  // A relay can't support a town, so it gets the REGION rung's LABEL too, not
  // just its accuracy (2026-10-06). Downgrading only the accuracy kept
  // "Newark, NJ" as the label, which then rendered "Newark (approximate)" /
  // "in the Newark area" — a town presented as a region — and in the Locations
  // tab one relay row demoted a whole group of confirmed "Newark, NJ" views.
  const base = reconcileDetailed(edge, second, { townUnsupported: isRelay });
  return {
    label: base.label,
    // A relay or cloud egress can never support a town: Private Relay promises
    // only the right country and rough region, and a datacenter IP is a
    // building. Downgrade rather than drop — the region is still true.
    accuracy: isRelay && (base.accuracy === "city" || base.accuracy === "city_approx")
      ? "region"
      : base.accuracy,
    source: base.label === null ? null : second ? "edge+second" : "edge",
    org,
    isRelay,
    isHosting: isCloudHostingOrg(org),
  };
}

/**
 * The decision table in the header comment. Exported for tests.
 *
 * Kept returning a bare string so every existing caller and test is untouched;
 * reconcileDetailed is the same decision with the confidence attached.
 */
export function reconcile(edge: GeoGuess, second: GeoGuess | null): string | null {
  return reconcileDetailed(edge, second).label;
}

/** reconcile(), plus which rung of the confidence ladder the answer came off. */
export function reconcileDetailed(
  edge: GeoGuess,
  second: GeoGuess | null,
  opts: { townUnsupported?: boolean } = {},
): { label: string | null; accuracy: GeoAccuracy | null } {
  if (!second) {
    // A relay with no second opinion: one unconfirmed database naming the
    // RELAY's town. Only the country is worth saying.
    if (opts.townUnsupported && edge.city) {
      return edge.country ? { label: edge.country, accuracy: "country" } : { label: null, accuracy: null };
    }
    // One database, unconfirmed. A town from a single source is exactly the
    // claim the Bolton Landing incident disproved, so it is never "city".
    const label = formatLocation(edge);
    if (label === null) return { label: null, accuracy: null };
    return { label, accuracy: edge.city ? "city_approx" : "country" };
  }
  const country = edge.country ?? second.country;
  const regionName = second.regionName ?? edge.regionName ?? (edge.regionCode ? US_STATES[edge.regionCode] ?? null : null);
  // WHOEVER KNOWS THE STATE, KNOWS IT. Both sources are describing the same IP,
  // so a region either of them supplies applies to the answer either of them
  // produced. This used to be `edge.regionCode ?? second.regionCode` but was
  // only ever READ on the branch where the second source supplied the town —
  // so a request whose edge headers carried no region (and ipinfo never sends
  // a code at all, only a name) wrote "Great Neck, US" even when the second
  // database had said NY. That is the pre-2026-09-03 shape coming back: the
  // Locations tab then carries the same town twice, once per label, and
  // locationAliases cannot fold them because the specific twin never exists.
  const regionCode = edge.regionCode ?? second.regionCode ?? stateCode(regionName, country);
  // The region is only worth naming if the two sources don't contradict there
  // as well; a code and a name are compared through the same state table.
  const regionsClash =
    (!!edge.regionCode && !!second.regionCode && edge.regionCode !== second.regionCode) ||
    (!!edge.regionName && !!second.regionName && !sameCity(edge.regionName, second.regionName));
  // The region rung. Its accuracy is "region" only when a region is what the
  // label actually names — when it degrades to a bare country, or all the way
  // back to the edge answer, the confidence has to degrade with it or the
  // display would promise a state the label doesn't contain.
  const regional = (): { label: string | null; accuracy: GeoAccuracy | null } => {
    if (regionName && country && !regionsClash) return { label: `${regionName}, ${country}`, accuracy: "region" };
    if (country) return { label: country, accuracy: "country" };
    const label = formatLocation(edge);
    if (label === null) return { label: null, accuracy: null };
    return { label, accuracy: edge.city ? "city_approx" : "country" };
  };

  // A carrier gateway serves a whole region; naming its town is a coin toss.
  if (second.org && CELLULAR.test(second.org)) return regional();
  // Same for a privacy relay / cloud egress: the town is the relay's, not theirs.
  if (opts.townUnsupported) return regional();

  if (edge.city && second.city) {
    // The edge keeps its spelling of the town (accents survive), but the region
    // and country are the best either source has. TWO INDEPENDENT SOURCES
    // NAMING ONE TOWN is the only thing in this file that earns a flat "city".
    if (sameCity(edge.city, second.city)) {
      return { label: formatLocation({ city: edge.city, regionCode, country }), accuracy: "city" };
    }
    // Two databases, two towns: the only thing known is the region.
    if (edge.country && second.country && edge.country !== second.country) {
      return { label: edge.country, accuracy: "country" };
    }
    return regional();
  }
  // One of them has a city and the other doesn't: no contradiction to act on —
  // but nothing confirmed it either, so it is a "near", not an "in".
  if (edge.city) {
    return { label: formatLocation({ city: edge.city, regionCode, country }), accuracy: "city_approx" };
  }
  if (second.city) {
    return { label: formatLocation({ city: second.city, regionCode, country }), accuracy: "city_approx" };
  }
  const label = formatLocation(edge);
  return label === null ? { label: null, accuracy: null } : { label, accuracy: "country" };
}

/** "City, ST" for US/CA (the region code IS the address), "City, CC" elsewhere. */
export function formatLocation(g: Pick<GeoGuess, "city" | "regionCode" | "country">): string | null {
  const { city, regionCode, country } = g;
  if (city && country) {
    const tail = (country === "US" || country === "CA") && regionCode ? regionCode : country;
    return `${city}, ${tail}`;
  }
  return city || country || null;
}

/**
 * Old rows say "Great Neck, US"; rows written from 2026-09-03 say
 * "Great Neck, NY". They are the same place, and the Locations tab is
 * all-time — without this it would list both forever, side by side, as if
 * they were two towns. Returns label → the label it should be counted under
 * (the more specific one), for the labels that have a specific twin.
 *
 * A STATE-level label is never folded into the city of the same name:
 * "New York, US" means somewhere in New York State (the two databases
 * disagreed on the town) and must not be counted as New York City.
 */
export function locationAliases(labels: Iterable<string>): Map<string, string> {
  const all = [...labels];
  const norm = (s: string) => s.trim().toLowerCase();
  const stateNames = new Set(Object.values(US_STATES).map(norm));
  // city → the "City, ST" label seen for it
  const specific = new Map<string, string>();
  for (const label of all) {
    const m = /^(.+), ([A-Z]{2})$/.exec(label);
    if (m && (US_STATES[m[2]] || CA_REGIONS.has(m[2]))) specific.set(norm(m[1]), label);
  }
  const alias = new Map<string, string>();
  for (const label of all) {
    const m = /^(.+), (US|CA)$/.exec(label);
    if (!m || stateNames.has(norm(m[1]))) continue;
    const target = specific.get(norm(m[1]));
    if (target && target !== label) alias.set(label, target);
  }
  return alias;
}

// ── Second opinion ───────────────────────────────────────────────────────────

const LOOKUP_TIMEOUT_MS = 600;
const CACHE_TTL_MS = 15 * 60 * 1000;
const CACHE_MAX = 5000;
// Keyed by IP — the one key that cannot cross-contaminate visitors: the same
// address IS the same network, whoever is on it.
const cache = new Map<string, { guess: GeoGuess | null; expires: number }>();

async function secondOpinion(ip: string): Promise<GeoGuess | null> {
  if (!isPublicIp(ip)) return null;
  const hit = cache.get(ip);
  if (hit && hit.expires > Date.now()) return hit.guess;
  let guess: GeoGuess | null = null;
  try {
    guess = await lookup(ip);
  } catch {
    guess = null; // timeout, network, quota: the edge answer stands alone
  }
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
  cache.set(ip, { guess, expires: Date.now() + CACHE_TTL_MS });
  return guess;
}

async function lookup(ip: string): Promise<GeoGuess | null> {
  const token = process.env.IPINFO_TOKEN?.trim();
  const url = token
    ? `https://ipinfo.io/${encodeURIComponent(ip)}/json?token=${encodeURIComponent(token)}`
    : `https://ipwho.is/${encodeURIComponent(ip)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS), cache: "no-store" });
  if (!res.ok) return null;
  const j = (await res.json()) as Record<string, unknown>;
  if (token) {
    if (j.bogon) return null;
    return {
      city: str(j.city),
      regionCode: null,
      regionName: str(j.region),
      country: isoCountry(str(j.country)),
      org: str(j.org),
    };
  }
  if (j.success === false) return null;
  const conn = (j.connection ?? {}) as Record<string, unknown>;
  return {
    city: str(j.city),
    regionCode: str(j.region_code),
    regionName: str(j.region),
    country: isoCountry(str(j.country_code)),
    org: [str(conn.org), str(conn.isp)].filter(Boolean).join(" ") || null,
  };
}

// ── Networks that move their users ───────────────────────────────────────────
//
// Two families, one consequence: the IP belongs to infrastructure, not to a
// neighbourhood, so a town derived from it is the relay's town.
//
//   RELAYS/VPNs — iCloud Private Relay egresses through Cloudflare, Akamai and
//   Fastly, and Apple promises only the right country and a rough region. A
//   corporate VPN does the same. These are REAL PEOPLE and must keep counting.
//   Their location is downgraded to the region; nothing else changes.
//
//   CLOUD/HOSTING — a phone is never on AWS. This is where the 7 "Ashburn, US"
//   views on the `swiftcard` slug came from (seven views, seven different
//   visitor ids, a fresh browser each time).
//
// THE TWO FAMILIES ARE NOW SEPARATE PATTERNS, because they deserve opposite
// answers and blending them into one alternation is what forced the old
// all-or-nothing call.
//
//   PRIVACY_RELAY still COUNTS. Apple's Private Relay egresses through
//   Cloudflare, Akamai and Fastly — that is published, and it is why a blanket
//   hosting exclusion would have quietly stopped counting a slice of ordinary
//   iPhone users. Consumer VPNs are the same story. Location confidence is
//   downgraded to the region and nothing else changes.
//
//   CLOUD_HOSTING no longer counts. Apple does not relay a customer's Safari
//   through Azure or AWS, and a person does not read a business card from a
//   rack. The evidence the old comment asked to decide from is now in:
//   analytics_ingest_log shows the "Ashburn, US" pattern repeating on new
//   slugs — 2026-09-14 15:55-15:56, four counted views on a card ninety seconds
//   old, four fresh visitor ids, three different desktop User-Agents, geo
//   "Quincy, WA" (an Azure region), is_relay true, and a push to the owner's
//   phone for each. Those views are not people. They are recorded as
//   reason "hosting" / classification "datacenter" instead of being counted,
//   so the decision stays as auditable as it was before and reverting it is
//   one line.
const PRIVACY_RELAY =
  /\b(akamai|cloudflare|fastly|nordvpn|expressvpn|surfshark|mullvad|private internet access|proton|ipvanish|cyberghost|windscribe|tunnelbear)\b/i;

const CLOUD_HOSTING =
  /\b(amazon|aws|amazon technologies|google cloud|google llc|microsoft|azure|digitalocean|linode|ovh|hetzner|vultr|contabo|m247|datacamp|leaseweb|choopa|quadranet|hostinger|godaddy|namecheap|oracle cloud|alibaba|tencent cloud|scaleway|upcloud|packet|equinix|zenlayer|hosting|datacenter|data center|colocation)\b/i;

/** Either family: the IP belongs to infrastructure, so a town derived from it
 *  is the infrastructure's town. Drives the accuracy downgrade only — unchanged
 *  in meaning and in effect from the single pattern it replaced. */
const RELAY_OR_HOSTING = new RegExp(`${PRIVACY_RELAY.source}|${CLOUD_HOSTING.source}`, "i");

/** Cloud/hosting egress and NOT a known privacy relay. The relay check wins on
 *  purpose: an org string naming both ("Cloudflare, Inc. hosting") is far more
 *  likely a real person behind Private Relay than a crawler, and the direction
 *  to fail in is counting a machine, never dropping a person. */
export function isCloudHostingOrg(org: string | null | undefined): boolean {
  if (!org) return false;
  if (PRIVACY_RELAY.test(org)) return false;
  return CLOUD_HOSTING.test(org);
}

// Mobile carriers: an address here is a regional gateway, not a place.
const CELLULAR =
  /\b(verizon wireless|cellco|t-mobile|tmobile|sprint|at&t mobility|att mobility|us cellular|metropcs|cricket|boost mobile|dish wireless|vodafone|orange s\.?a|ee limited|telefonica moviles|rogers wireless|bell mobility|telus mobility|freedom mobile|wireless|mobility|mobile|cellular)\b/i;

/**
 * "New York" → "NY", for US answers only.
 *
 * ipinfo reports a region NAME and never a code, and the Vercel edge reports a
 * code and never a name — so without this the ipinfo path could never produce
 * the "City, ST" form at all, no matter how confidently both sources agreed.
 * Returns null for anything not an exact US state name (D.C. included: every
 * database calls it "District of Columbia", which is not the key we hold).
 */
function stateCode(regionName: string | null, country: string | null): string | null {
  if (!regionName || country !== "US") return null;
  return US_STATE_CODES.get(regionName.trim().toLowerCase()) ?? null;
}

function sameCity(a: string, b: string): boolean {
  const norm = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
  return norm(a) === norm(b);
}

function isPublicIp(ip: string): boolean {
  if (!ip || ip === "unknown") return false;
  if (/^(10\.|127\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip)) return false;
  if (/^(::1$|fc|fd|fe80)/i.test(ip)) return false;
  return /^[0-9a-f.:]+$/i.test(ip);
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim().slice(0, 80) : null;
}

// Country must be a bare ISO code — anything else is a spoofed/garbled value.
function isoCountry(v: string | null): string | null {
  return v && /^[A-Z]{2}$/.test(v) ? v : null;
}

function safeDecode(value: string | null): string | null {
  if (!value) return null;
  try {
    const decoded = decodeURIComponent(value).trim();
    // Cap length so a forged header can't grow rows unboundedly.
    return decoded ? decoded.slice(0, 80) : null;
  } catch {
    return null;
  }
}

const US_STATES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado",
  CT: "Connecticut", DE: "Delaware", DC: "Washington, D.C.", FL: "Florida", GA: "Georgia", HI: "Hawaii",
  ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana",
  ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi",
  MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey",
  NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma",
  OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota",
  TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington",
  WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming", PR: "Puerto Rico",
};

// Name → code, so a source that only knows "New York" still yields "NY".
// DC's entry here is "Washington, D.C.", which no IP database returns, so it
// simply never matches — deliberately, rather than guessing.
const US_STATE_CODES = new Map(
  Object.entries(US_STATES).map(([code, name]) => [name.toLowerCase(), code]),
);

// Canadian provinces/territories — codes only; used to tell a province tail
// ("Toronto, ON") from a country tail ("Toronto, CA") when merging labels.
const CA_REGIONS = new Set(["AB", "BC", "MB", "NB", "NL", "NS", "NT", "NU", "ON", "PE", "QC", "SK", "YT"]);
