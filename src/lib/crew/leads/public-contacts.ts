import type { SitePerson } from "./assess";
import { mailtos, phonesIn, textOf } from "./fetch-page";
import { DECISION_ROLE, isGenericEmail, namedOnSite } from "./quality";
import { cleanEmails } from "./record";
import type { AgentContext } from "../context";
import type { Lead } from "../types";
import { isRestrictedRegion } from "./region";

type Page = { url: string; html: string };
export type PublicPerson = SitePerson & { source: string };

function personContext(html: string, name: string): string {
  // A neighbouring card is not evidence about this person. Prefer the
  // smallest explicit card, then a heading-delimited profile section.
  const cards = [...html.matchAll(/<(article|li|section)\b[^>]*>[\s\S]*?<\/\1>/gi)]
    .map((m) => m[0]).filter((block) => namedOnSite(name, textOf(block)))
    .sort((a, b) => a.length - b.length);
  const scoped = cards[0] ?? html;
  const headings = [...scoped.matchAll(/<h[1-6]\b[^>]*>[\s\S]*?<\/h[1-6]>/gi)];
  const at = headings.findIndex((h) => namedOnSite(name, textOf(h[0])));
  if (at >= 0) return scoped.slice(headings[at].index, headings[at + 1]?.index);
  if (cards.length) return scoped;
  // Plain profiles: another explicit name/role label ends this record.
  // Capitalized places such as "Park Slope" are not person boundaries.
  const text = textOf(html);
  const start = text.toLowerCase().indexOf(name.toLowerCase());
  const after = text.slice(start + name.length);
  const next = [...after.matchAll(/\b[A-Z][a-z]+(?: [A-Z][a-z]+){1,3},\s*(?:Licensed Agent|Sales Associate|Agent|Owner|Founder|Broker|Manager|Director|Managing Partner)\b/g)][0];
  return text.slice(start, start + name.length + (next?.index ?? Math.min(after.length, 240)));
}

export function emailOnPage(email: string, page: Page): boolean {
  return !!email && (mailtos(page.html).includes(email.toLowerCase()) || textOf(page.html).toLowerCase().includes(email.toLowerCase()));
}

/** A name and a decision role must be evidenced together, not just occur on
 * unrelated pages. An uncorroborated personal route is cleared, never guessed.
 */
export function verifiedPeople(people: SitePerson[], pages: Page[]): SitePerson[] {
  return people.flatMap((person) => {
    if (typeof person.name !== "string" || typeof person.title !== "string" || !DECISION_ROLE.test(person.title)) return [];
    for (const p of pages) {
      const text = textOf(p.html).toLowerCase();
      if (!namedOnSite(person.name, text)) continue;
      const context = personContext(p.html, person.name);
      const nearby = textOf(context).toLowerCase();
      if (!nearby.includes(person.title.toLowerCase())) continue;
      const email = typeof person.email === "string" ? person.email.toLowerCase() : "";
      const phone = typeof person.phone === "string" ? person.phone : "";
      const digits = phone.replace(/\D/g, "").slice(-10);
      const phones = [...phonesIn(nearby), ...telPhones(context)];
      const phonePresent = digits.length === 10 && phones.some((p) => p.replace(/\D/g, "").slice(-10) === digits);
      return [{ ...person, email: emailOnPage(email, { ...p, html: context }) ? email : "", phone: phonePresent ? phone : phone ? "" : phones[0] ?? "" }];
    }
    return [];
  });
}

/** Conservative fallback: explicit Person metadata corroborated by visible
 * name/role text. Never infer an address from someone's name or mailbox.
 */
export function publicPeople(pages: Page[]): PublicPerson[] {
  const out: PublicPerson[] = [];
  for (const page of pages) {
    const text = textOf(page.html);
    const walk = (v: unknown, depth = 0) => {
      if (!v || typeof v !== "object" || depth > 10) return;
      if (Array.isArray(v)) { v.forEach((x) => walk(x, depth + 1)); return; }
      const obj = v as Record<string, unknown>;
      const types = [obj["@type"]].flat();
      if (types.includes("Person") && typeof obj.name === "string" && obj.name.length <= 80 && typeof obj.jobTitle === "string" && obj.jobTitle.length <= 80 && DECISION_ROLE.test(obj.jobTitle) && namedOnSite(obj.name, text) && text.toLowerCase().includes(obj.jobTitle.toLowerCase())) {
        const email = typeof obj.email === "string" ? obj.email.replace(/^mailto:/i, "").toLowerCase() : "";
        const phone = typeof obj.telephone === "string" ? obj.telephone : "";
        out.push({ name: obj.name, title: obj.jobTitle, email: email && (text.toLowerCase().includes(email) || mailtos(page.html).includes(email)) ? email : "", phone: phone && phonesIn(text).some((p) => p.replace(/\D/g, "").slice(-10) === phone.replace(/\D/g, "").slice(-10)) ? phone : "", source: page.url });
      }
      Object.values(obj).forEach((x) => walk(x, depth + 1));
    };
    for (const script of page.html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
      try { walk(JSON.parse(script[1])); } catch { /* malformed metadata is not evidence */ }
    }
  }
  return out.filter((p, i) => out.findIndex((x) => x.name.toLowerCase() === p.name.toLowerCase()) === i).slice(0, 8);
}

/** Keep contact-bearing passages beyond the navigation/header prefix, with
 * page URLs. A bounded input lets the whole run fit in its enrichment reserve.
 */
export function siteEvidence(pages: Page[]): string {
  return pages.slice(0, 12).map((p) => {
    const text = textOf(p.html);
    const passages = [text.slice(0, 220)];
    for (const m of text.matchAll(/@|\b(?:owner|founder|broker|manager|director|team leader|agents|office|award)\b/gi)) {
      passages.push(text.slice(Math.max(0, m.index! - 90), m.index! + 180));
      if (passages.join(" ").length > 550) break;
    }
    return `${p.url}\n${[...new Set(passages)].join(" ").slice(0, 650)}\nPublished mailto/tel: ${mailtos(p.html).slice(0, 6).join(", ")} ${telPhones(p.html).join(", ")}`;
  }).join("\n").slice(0, 9000);
}

export function telPhones(html: string): string[] {
  return [...html.matchAll(/href=["']tel:([^"']+)["']/gi)].flatMap((m) => {
    const value = m[1].split(/[;?]/)[0];
    const digits = value.replace(/\D/g, "");
    return /^\d{10}$|^1\d{10}$/.test(digits) ? [value.startsWith("+") ? `+${digits}` : digits] : [];
  });
}

/** Additional public routes stay on the existing company row. Check every
 * address against suppression before retaining it; no saved/user notes edited.
 */
export async function withPublicRoutes(ctx: AgentContext, lead: Lead, pages: Page[], people: SitePerson[] = []): Promise<Lead> {
  const routes: string[] = [];
  const seen = new Set<string>();
  for (const p of pages) {
    const host = new URL(p.url).hostname;
    for (const email of cleanEmails([...mailtos(p.html), textOf(p.html)], host)) {
      if (email === lead.email || seen.has(email)) continue;
      seen.add(email);
      if (isRestrictedRegion({ country: lead.country, host, email })) continue;
      if (await ctx.store.isSuppressed([email, `@${email.split("@")[1]}`])) continue;
      routes.push(`Public business address ${email} (${p.url}); person association unverified.`);
    }
    for (const person of verifiedPeople([...people, ...publicPeople([p])], [p])) {
      if (person.name === lead.name) continue;
      const key = `person:${person.name.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (isRestrictedRegion({ country: lead.country, host, email: person.email })) continue;
      if (person.email && await ctx.store.isSuppressed([person.email, `@${person.email.split("@")[1]}`])) continue;
      routes.push(`${person.name}, ${person.title}${person.email ? `, ${person.email}` : ""} (${p.url}).`);
    }
    for (const phone of [...telPhones(p.html), ...phonesIn(textOf(p.html))]) {
      if (phone === lead.phone || seen.has(phone)) continue;
      seen.add(phone);
      routes.push(`Public business phone ${phone} (${p.url}); person association unverified.`);
    }
  }
  // Replace the old unsourced alternate-address note for this new row only.
  const notes = lead.notes?.replace(/Other addresses on the site: .*/, "").trim();
  const confidence = !lead.name ? "Company contact only; decision-maker unverified." : lead.email && isGenericEmail(lead.email) ? "Public company inbox; not a verified personal address for the named professional." : "";
  return { ...lead, notes: [notes, confidence, ...routes.slice(0, 8)].filter(Boolean).join("\n") || null };
}
