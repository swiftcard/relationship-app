import type { SitePerson } from "./assess";
import { mailtos, phonesIn, textOf } from "./fetch-page";
import { DECISION_ROLE, namedOnSite } from "./quality";
import { cleanEmails } from "./record";
import type { AgentContext } from "../context";
import type { Lead } from "../types";
import { isRestrictedRegion } from "./region";

type Page = { url: string; html: string };
export type PublicPerson = SitePerson & { source: string };

/** A name and a decision role must be evidenced together, not just occur on
 * unrelated pages. An uncorroborated personal route is cleared, never guessed.
 */
export function verifiedPeople(people: SitePerson[], pages: Page[]): SitePerson[] {
  return people.flatMap((person) => {
    if (typeof person.name !== "string" || typeof person.title !== "string" || !DECISION_ROLE.test(person.title)) return [];
    for (const p of pages) {
      const text = textOf(p.html).toLowerCase();
      if (!namedOnSite(person.name, text)) continue;
      const start = text.indexOf(person.name.toLowerCase());
      const nearby = text.slice(Math.max(0, start - 120), start + person.name.length + 240);
      if (!nearby.includes(person.title.toLowerCase())) continue;
      const email = typeof person.email === "string" ? person.email.toLowerCase() : "";
      return [{ ...person, email: email && nearby.includes(email) ? email : "", phone: typeof person.phone === "string" ? person.phone : "" }];
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
  const confidence = !lead.name ? "Company contact only; decision-maker unverified." : "";
  return { ...lead, notes: [notes, confidence, ...routes.slice(0, 8)].filter(Boolean).join("\n") || null };
}
