import type { AgentContext } from "../context";
import { textOf } from "./fetch-page";

// ── Reading a business's own site, once, for everything the row needs ───────
// One cheap call (the "extract" step, Haiku) for a whole run's sites (Office
// Prospects: one per 6 sites, so the answer fits the output limit): who the
// site names as decision-makers, how well SwiftCard fits, why, one specific
// detail to open with, and a short opener. The model only reads; every name,
// email and phone it reports is checked against the page text before it is
// saved (leads.ts, office.ts), so it cannot add a person or an address.

export type SitePerson = { name: string; title: string; email: string; phone: string };
export type SiteAssessment = {
  i: number;
  people: SitePerson[];
  /** 0 to 40: how well SwiftCard fits this business, from what the site shows. 0 = not a fit (a directory, a law firm, closed, not a business). */
  fit: number;
  why: string;
  hook: string;
  /** Web Leads: the first line of an email. Office: what to say when they pick up. */
  opener: string;
  /** Office only: the point to make on the call. */
  talking_point: string;
};

export const ASSESS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["sites"],
  properties: {
    sites: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["i", "people", "fit", "why", "hook", "opener", "talking_point"],
        properties: {
          i: { type: "integer" },
          fit: { type: "integer" },
          why: { type: "string" },
          hook: { type: "string" },
          opener: { type: "string" },
          talking_point: { type: "string" },
          people: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["name", "title", "email", "phone"],
              properties: { name: { type: "string" }, title: { type: "string" }, email: { type: "string" }, phone: { type: "string" } },
            },
          },
        },
      },
    },
  },
} as const;

const SWIFTCARD = "SwiftCard makes digital business cards with a built-in link page and QR code: one tap or scan saves the owner's contact, and the people they meet can leave their details, which land in a lead inbox. The Office Plan gives a whole team matching cards, one shared lead inbox, and an admin who manages everyone's card.";

export type SiteForAssess = { name: string; website: string; type: string; area: string; pages: { url: string; html: string }[] };

export function assessPrompt(sites: SiteForAssess[], o: { office: boolean }): { system: string; prompt: string } {
  const opener = o.office
    ? "opener: what the caller says when someone picks up, under 45 words, spoken and plain: greet the decision-maker by first name if the site names one (otherwise ask for whoever runs the team or office), say \"this is [your name] from SwiftCard\" (keep that placeholder exactly; whoever calls fills it in), mention the one specific detail, then ask one easy question about how their team shares contact details or follows up with leads. No pitch list, no prices."
    : "opener: the first line of a short email to them, under 30 words, built on the specific detail. No greeting, no pitch, no prices.";
  return {
    system: `You read small-business websites for SwiftCard's two founders, who will contact these businesses by hand. ${SWIFTCARD}\nRules: copy names, titles, emails and phones EXACTLY as the site shows them, and use an empty string when the site doesn't show one. Never guess or build an email from a name. List only people with a role on the site. Write only what the site supports; when there is nothing specific, leave hook empty rather than inventing one.`,
    prompt: [
      "For each site, return:",
      "- people: the decision-makers the site names (owner, founder, broker, principal, managing director, team lead, head of sales, office manager), at most 4.",
      "- fit: 0 to 40, how much SwiftCard would help this business: higher for teams of agents or staff who meet clients, hand out cards, or chase leads; 0 for a directory, a franchise's national page, a law firm, a closed business, or anything that isn't a business.",
      "- why: one sentence, the concrete reason they fit (team size, how they get clients, what they sell), from the site.",
      "- hook: one specific, checkable detail from their site to open with (a new office, an award, a niche, a number of agents, a recent listing or project). Empty if none.",
      `- ${opener}`,
      o.office ? "- talking_point: one sentence, the point to make on the call about matching cards and a shared lead inbox for their team." : "- talking_point: empty string.",
      "",
      sites.map((s, i) => `SITE #${i} ${s.name} (${s.website}), ${s.type}${s.area ? ` in ${s.area}` : ""}:\n${s.pages.map((p) => textOf(p.html).slice(0, 2500)).join("\n")}`).join("\n\n====\n\n"),
    ].join("\n"),
  };
}

/**
 * One extract call for the run's readable sites, or one per `perCall` sites
 * so a long run's answer can't outgrow the call's output limit. Null when no
 * call gave an answer (the model is unavailable, refuses, or the budget says
 * no): the agents then save only what the pages themselves show. When a later
 * call is refused, the sites already read keep their answers and no further
 * call is made.
 */
export async function assessSites(ctx: AgentContext, sites: SiteForAssess[], o: { office: boolean; perCall?: number }): Promise<SiteAssessment[] | null> {
  if (!sites.length) return [];
  const per = Math.max(1, o.perCall ?? sites.length);
  const all: SiteAssessment[] = [];
  let answered = false;
  for (let start = 0; start < sites.length; start += per) {
    const part = sites.slice(start, start + per);
    const { system, prompt } = assessPrompt(part, o);
    let out: { sites: SiteAssessment[] } | null;
    try {
      out = await ctx.llm.askJson<{ sites: SiteAssessment[] }>("extract", { effort: "low", maxTokens: 6000, schema: ASSESS_SCHEMA as unknown as Record<string, unknown>, system, prompt });
    } catch (e) {
      // The first call's error is the caller's to handle, as before; after that, keep what was answered.
      if (!answered) throw e;
      break;
    }
    if (!out?.sites) continue;
    answered = true;
    for (const a of out.sites) if (Number.isInteger(a.i) && a.i >= 0 && a.i < part.length) all.push({ ...a, i: a.i + start });
  }
  return answered ? all : null;
}
