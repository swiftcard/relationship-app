// ── "On the Columbia University network" ─────────────────────────────────────
//
// Owner, 2026-10-18: when someone opens a card from a work, school or
// hospital network, say whose network it is — "Someone on the Northwell Health
// network viewed your card". The IP lookup SwiftCard already makes for the
// location (lib/request-geo.ts, ipwho.is / ipinfo) names the organisation that
// owns the address block. Most of the time that is an internet provider
// ("Comcast Cable Communications"), which says nothing about the visitor and
// must never be shown as if it did. Sometimes it is the organisation itself:
// a company, university, hospital or agency that runs its own network
// ("Columbia University", "Apple Inc."), or a business an ISP has assigned a
// block to ("Acme Dental LLC" on a Comcast Business line).
//
// THE RULE, AS EVERYWHERE IN ANALYTICS: NEVER INVENT PRECISION. A name is shown
// only when it is plainly NOT a provider of internet to the public. Anything
// that reads like an ISP, a phone carrier, a cloud or a VPN — or a generic
// WHOIS placeholder — is silence. A real company whose name happens to contain
// "Communications" is missed; that is the safe direction. Saying "on the
// Optimum network" about someone's living room is the unsafe one.
//
// And the words are "on the … network", never "at …" or "from …": a guest on
// the hospital Wi-Fi is on its network without working there.

export type NetworkOwner = {
  /** The organisation the address block is registered to. */
  org: string | null;
  /** The network operator, when the lookup reports it separately. */
  isp: string | null;
  /** The operator's domain ("columbia.edu"), when reported. */
  domain: string | null;
};

// Consumer and business internet providers, transit carriers and satellite
// services by NAME — the ones whose names carry none of the generic words
// below. US first (where the product's traffic is), then the large foreign
// incumbents that do appear.
const PROVIDER_NAMES =
  /\b(comcast|xfinity|charter|spectrum|time warner|verizon|at&t|att\b|cox|optimum|altice|cablevision|suddenlink|frontier|centurylink|lumen|qwest|level 3|windstream|mediacom|starlink|space exploration|spacex|t-mobile|tmobile|sprint|google fiber|webpass|sonic|ziply|hargray|astound|rcn|grande|wave|wow!?|wideopenwest|breezeline|atlantic broadband|consolidated|tds|brightspeed|metronet|earthlink|hughes|viasat|cincinnati bell|altafiber|armstrong|blue ridge|buckeye|midco|sparklight|cable one|gci|shentel|allo|lightpath|zayo|cogent|hurricane electric|gtt|ntt|telia|tata|pccw|rogers|bell canada|bell aliant|telus|shaw|videotron|cogeco|eastlink|british telecom|\bbt\b|sky uk|virgin media|talktalk|vodafone|orange|deutsche telekom|telekom|telefonica|movistar|swisscom|kpn|proximus|free sas|bouygues|iliad|telstra|optus|reliance jio|airtel|bharti|singtel|starhub|softbank|kddi|ntt docomo|china telecom|china unicom|china mobile|chunghwa|telmex|claro|tim\b|wind tre|fastweb)\b/i;

// Words that, in a network owner's name, mean "sells connectivity". Broad on
// purpose — every regional ISP and cooperative is named like this.
const PROVIDER_WORDS =
  /\b(communications?|telecom\w*|telco|telephone|tel\b|broadband|internet|isp|cable|cablevision|wireless|mobile|mobility|cellular|fib(er|re)|networks?|net\b|online|dsl|satellite|wifi|wi-fi|hotspot|cooperative|co-?op|electric|utilit(y|ies)|power|energy|media|tv\b|television|transit|backbone|carrier|data ?cent(er|re)|hosting|colo(cation)?|cloud|vps|server|vpn|proxy|relay|cdn)\b/i;

// WHOIS placeholders for an ISP's own customers — not an organisation's name.
const PLACEHOLDERS =
  /\b(private customer|private|residential|customer|subscriber|dynamic|static|pool|dhcp|reserved|unassigned|not allocated|infrastructure|ip block|assigned|allocation|nat|cgnat|end ?user|home)\b/i;

/** "AS14 Columbia University" → "Columbia University". */
function stripAsn(s: string | null | undefined): string {
  return (s ?? "").replace(/^AS\d+\s+/i, "").replace(/\s+/g, " ").trim();
}

function isProvider(name: string): boolean {
  return PROVIDER_NAMES.test(name) || PROVIDER_WORDS.test(name) || PLACEHOLDERS.test(name);
}

/** "Columbia University" / "Apple Inc." → the name a person reads. */
function tidy(name: string): string {
  return name
    // Legal suffixes read as noise in a sentence: "Apple Inc." → "Apple".
    .replace(/,?\s+(inc\.?|incorporated|llc|l\.l\.c\.|ltd\.?|limited|corp\.?|corporation|co\.|company|plc|gmbh|s\.?a\.?|ag|lp|llp|pllc|pc|p\.c\.)$/i, "")
    .replace(/[,.\s]+$/, "")
    .trim()
    .slice(0, 60);
}

/**
 * The organisation whose network this visit came from, or null.
 *
 * `isRelay` / `isHosting` / `isCellular` are request-geo's own verdicts about
 * the same lookup: a relay, a cloud or a phone carrier's gateway is never an
 * organisation's office, whatever its name says.
 */
export function workNetworkName(
  net: NetworkOwner | null | undefined,
  flags: { isRelay?: boolean; isHosting?: boolean; isCellular?: boolean } = {},
): string | null {
  if (!net || flags.isRelay || flags.isHosting || flags.isCellular) return null;
  const org = stripAsn(net.org);
  const isp = stripAsn(net.isp);
  if (!org || org.length < 3) return null;
  // The registered organisation is itself a provider: nothing to say.
  if (isProvider(org)) return null;
  // The organisation runs its OWN network (org = operator, or no separate
  // operator reported) — a company or school with its own address space — or
  // a provider has assigned it a block (operator IS a provider, org is not).
  // An org on a DIFFERENT non-provider operator is ambiguous (a building, a
  // managed office, a reseller): silence.
  const ownNetwork = !isp || isp.toLowerCase() === org.toLowerCase();
  const assignedByProvider = !!isp && isProvider(isp);
  if (!ownNetwork && !assignedByProvider) return null;
  const name = tidy(org);
  return name.length >= 3 ? name : null;
}

/** " on the Columbia University network" — the fragment a sentence carries. */
export function workNetworkPhrase(name: string | null | undefined): string {
  const n = (name ?? "").trim();
  return n ? ` on the ${n} network` : "";
}
