import { promises as dns } from "node:dns";
import type { Lead } from "../types";

// ── What makes a lead worth a call ──────────────────────────────────────────
// One row per company, across the cold list and the Office list; a named
// decision-maker only when the business's own site names them; an email
// domain checked for a mail server (which says the domain CAN receive mail,
// never that this mailbox exists); and a score the owner can sort by, made of
// facts we checked plus the model's read of how well SwiftCard fits.

/** Sites many businesses share: the company is the page on it, not the host. */
const SHARED_HOSTS = /(^|\.)(compass\.com|elliman\.com|kw\.com|kellerwilliams\.com|remax\.com|coldwellbanker(homes)?\.com|century21\.com|sothebysrealty\.com|bhhs\.com|exprealty\.com|corcoran\.com|bhgre\.com|redfin\.com|zillow\.com|realtor\.com|facebook\.com|instagram\.com|linkedin\.com|yelp\.com|linktr\.ee|wixsite\.com|squarespace\.com|godaddysites\.com|weebly\.com|wordpress\.com|business\.site|sites\.google\.com)$/i;

const slug = (s: string | null | undefined) =>
  (s ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\b(llc|inc|corp|co|ltd|pllc|the)\b\.?/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, "-");

/**
 * The company a lead belongs to: its website's host ("acmerealty.com"), or on
 * a shared host the host plus the company's name ("compass.com/ryan-ryan-team").
 * Null when there is neither a site nor a name, so nothing is merged by guess.
 */
export function companyKey(l: Pick<Lead, "source_url" | "company">): string | null {
  let host = "";
  let firstPath = "";
  try {
    const u = new URL(l.source_url);
    if (/^https?:$/.test(u.protocol)) {
      host = u.hostname.toLowerCase().replace(/^(www\d?|m)\./, "");
      firstPath = u.pathname.split("/").filter(Boolean).slice(0, 2).join("/");
    }
  } catch {
    /* a pasted source */
  }
  const name = slug(l.company);
  if (!host) return name ? `name:${name}` : null;
  if (SHARED_HOSTS.test(host)) return name ? `${host}/${name}` : firstPath ? `${host}/${firstPath.toLowerCase()}` : null;
  return host;
}

export const GENERIC_LOCAL = /^(info|contact|hello|hi|office|admin|sales|support|service|services|team|inquiries|inquiry|enquiries|mail|help|reception|frontdesk|leasing|marketing|general|booking|bookings|appointments|customerservice)@/i;
export const FREE_MAIL = /@(gmail|yahoo|outlook|hotmail|icloud|aol|me|live|msn|protonmail|proton)\.(com|me)$/i;

export function isGenericEmail(email: string): boolean {
  return GENERIC_LOCAL.test(email);
}

/** Owners, brokers, founders, heads of sales: the people who decide on a team plan. */
export const DECISION_ROLE = /\b(owner|founder|co-?founder|principal|broker|managing|manager|director|team lead(er)?|head of|sales (manager|director)|vp|vice president|president|ceo|coo|partner)\b/i;

// ── The email's domain ──────────────────────────────────────────────────────

/** Domain OK means a mail server exists for the domain. It is NOT a verified mailbox. */
export const EMAIL_STATUS = { ok: "Domain OK", noMail: "No Mail Server", unchecked: "Unchecked", none: "None" } as const;
export type EmailStatus = (typeof EMAIL_STATUS)[keyof typeof EMAIL_STATUS];

/** The DNS lookup, swappable in tests. */
export const dnsLookup = { mx: (domain: string) => dns.resolveMx(domain) };

/** Whether the email's domain has a mail server. A failed or slow lookup is "Unchecked", never a verdict. */
export async function emailDomainStatus(email: string | null | undefined, timeoutMs = 4000): Promise<EmailStatus> {
  if (!email) return EMAIL_STATUS.none;
  if (FREE_MAIL.test(email)) return EMAIL_STATUS.ok;
  const domain = email.split("@")[1]?.toLowerCase();
  if (!domain) return EMAIL_STATUS.noMail;
  try {
    const mx = await Promise.race([dnsLookup.mx(domain), new Promise<never>((_, no) => setTimeout(() => no(Object.assign(new Error("timeout"), { code: "ETIMEOUT" })), timeoutMs))]);
    // RFC 7505: a single "." exchange says the domain accepts no mail.
    return mx.some((r) => r.exchange && r.exchange !== ".") ? EMAIL_STATUS.ok : EMAIL_STATUS.noMail;
  } catch (e) {
    const code = (e as { code?: string }).code;
    return code === "ENOTFOUND" || code === "ENODATA" ? EMAIL_STATUS.noMail : EMAIL_STATUS.unchecked;
  }
}

/** Every lead's email_status, one lookup per domain. */
export async function withEmailStatus<T extends Lead>(leads: T[]): Promise<T[]> {
  const byDomain = new Map<string, Promise<EmailStatus>>();
  return Promise.all(
    leads.map(async (l) => {
      if (l.email_status) return l;
      const d = l.email?.split("@")[1]?.toLowerCase() ?? "";
      if (!byDomain.has(d)) byDomain.set(d, emailDomainStatus(l.email));
      return { ...l, email_status: await byDomain.get(d)! };
    }),
  );
}

// ── The score ───────────────────────────────────────────────────────────────

/** The trades and teams SwiftCard sells to first. */
export const CORE_INDUSTRY = /real estate|realt|brokerage|mortgage|loan|insurance|recruit|staffing|property management|title compan/i;

/**
 * 0 to 100. Up to 40 from the model's read of the fit (it sees the site);
 * the rest from what we checked: a named decision-maker, a personal email on
 * a domain with a mail server, a phone, a core industry.
 */
export function leadScore(o: { fit: number; name: string | null; title: string | null; email: string | null; emailStatus: string | null; phone: string | null; industry: string | null }): number {
  let s = Math.max(0, Math.min(40, Math.round(o.fit || 0)));
  if (o.name && o.title && DECISION_ROLE.test(o.title)) s += 20;
  else if (o.name) s += 8;
  if (o.email) s += isGenericEmail(o.email) ? 5 : 15;
  if (o.emailStatus === EMAIL_STATUS.noMail) s -= 15;
  if (o.phone) s += 10;
  if (o.industry && CORE_INDUSTRY.test(o.industry)) s += 15;
  return Math.max(0, Math.min(100, s));
}

/** The score once the email's domain is known (a domain with no mail server costs points). */
export function scoreLeads(leads: Lead[], fitOf: (l: Lead) => number | null): Lead[] {
  return leads.map((l) => {
    const fit = fitOf(l);
    return fit === null ? l : { ...l, score: leadScore({ fit, name: l.name ?? null, title: l.title ?? null, email: l.email ?? null, emailStatus: l.email_status ?? null, phone: l.phone ?? null, industry: l.business_type ?? null }) };
  });
}

/** A lead someone can act on today: a phone, or an email whose domain can receive mail. */
export function usable(l: Lead): boolean {
  if (l.region_restricted) return false;
  return !!l.phone || (!!l.email && l.email_status !== EMAIL_STATUS.noMail);
}

/**
 * The opener or hook, unless it mentions a person the model reported but the
 * site doesn't show: that text would greet someone by a made-up name.
 */
export function safeText(text: string | null | undefined, invented: { name: string }[]): string | null {
  const t = text?.trim();
  if (!t) return null;
  const words = invented.flatMap((p) => p.name.trim().split(/\s+/)).filter((w) => w.length >= 2);
  return words.some((w) => new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(t)) ? null : t;
}

/** True when the name appears on the site's own pages (a model must never add a person). */
export function namedOnSite(name: string, siteText: string): boolean {
  const n = name.toLowerCase().replace(/\s+/g, " ").trim();
  return n.length >= 3 && n.includes(" ") && siteText.toLowerCase().replace(/\s+/g, " ").includes(n);
}
