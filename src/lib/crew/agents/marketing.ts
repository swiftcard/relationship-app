import type { AgentDef } from "../agent-def";
import { propose } from "../approvals";
import { debate } from "../debate";
import { competitorFacts, productFacts } from "../facts";
import { textOf } from "../leads/fetch-page";
import { nyDay } from "../schedule";
import { closeMissing, fingerprintOf, reportFindings, type RawFinding } from "../watch/findings";
import { HUMAN_VOICE } from "../voice";
import { safeFetch } from "@/lib/safe-fetch";
import { getAdminSupabase } from "@/lib/supabase-admin";

// ── Team 5: Marketing (blog, SEO, GEO; the social manager and the competitor
// watch live in their own files) ─────────────────────────────────────────────
// Read-only on the live site; every change to the site is a Fix card that
// opens a pull request, and a blog post goes live only when approved.

const SITE = "https://swiftcard.me";

// ── M3 Blog: one post a week ────────────────────────────────────────────────

export const BLOG_TOPICS = [
  { keyword: "hihello alternative", angle: "An honest HiHello alternative for people who also want a link-in-bio page" },
  { keyword: "blinq vs swiftcard", angle: "Blinq vs SwiftCard: what each does well" },
  { keyword: "popl alternative", angle: "A Popl alternative that doesn't need an NFC product" },
  { keyword: "linktree alternative for realtors", angle: "Why realtors combine their link in bio with their business card" },
  { keyword: "link.me alternative", angle: "Link.me alternatives for business professionals" },
  { keyword: "hoobe alternative", angle: "Hoobe alternatives when you also hand out business cards" },
  { keyword: "digital business card for loan officers", angle: "Digital business cards for loan officers: what to put on yours" },
  { keyword: "digital business card for recruiters", angle: "How recruiters use a digital business card at job fairs" },
  { keyword: "qr code business card", angle: "QR code business cards that people actually save" },
  { keyword: "nfc business card", angle: "NFC business cards: how they work and what to buy" },
  { keyword: "business card for window cleaning business", angle: "Business cards for window cleaners and other local services" },
  { keyword: "email signature with business card", angle: "Adding your digital card to your email signature" },
  { keyword: "team digital business cards", angle: "Digital business cards for a whole office, with one lead inbox" },
];

const BLOG_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "slug", "description", "og_title", "markdown"],
  properties: { title: { type: "string" }, slug: { type: "string" }, description: { type: "string" }, og_title: { type: "string" }, markdown: { type: "string" } },
} as const;

async function publishedSlugs(): Promise<string[]> {
  const { data } = await getAdminSupabase().from("agent_blog_posts").select("slug, keyword").limit(500);
  return (data ?? []).flatMap((r) => [String(r.slug), String(r.keyword ?? "")]);
}

export function nextBlogTopic(used: string[], offset = 0): (typeof BLOG_TOPICS)[number] | null {
  const free = BLOG_TOPICS.filter((t) => !used.some((u) => u && (u === t.keyword || u.includes(t.keyword.replace(/ /g, "-")))));
  return free.length ? free[offset % free.length] : null;
}

export const blogWriter: AgentDef = {
  id: "marketing-blog",
  name: "Blog writer",
  team: "marketing",
  role: "worker",
  tier: "sonnet",
  schedule: { kind: "daily", hour: 9, minute: 30, days: [1] },
  dailyUsd: 1,
  needs: ["CREW_ANTHROPIC_API_KEY"],
  maxPending: 1,
  approvalKind: "blog_post",
  purpose: "Writes one SEO blog post a week (SwiftCard, competitors, new features) so searches like \"HiHello alternative\" find us. Goes live only when you approve.",
  async run(ctx) {
    const used = [...(await publishedSlugs()), ...ctx.config<string[]>("drafted", [])];
    const topic = nextBlogTopic(used);
    if (!topic) return { summary: "Every planned topic has a post. Add topics to keep going.", status: "skipped" };
    const facts = await competitorFacts(ctx.store, ctx.now());
    const system = `${HUMAN_VOICE.split("Rules:")[0]}You write SEO blog posts for SwiftCard's own blog. Plain, direct, helpful; name competitors' real strengths; never claim more than the facts. No em dashes.\n\n${productFacts()}`;
    const prompt = `Write a blog post.\nTarget search: "${topic.keyword}". Angle: ${topic.angle}.\n${facts}\n\nRules: 900 to 1400 words of markdown with ## headings, a short intro that answers the search right away, a fair comparison table if comparing, and a closing section with a link to /pricing. Links only to same-site paths like /pricing or /compare. Competitor prices only from the checked facts above; otherwise say "check their site". slug: lowercase words joined by hyphens. description: under 155 characters. og_title: under 60 characters.`;
    const post = await ctx.llm.askJson<{ title: string; slug: string; description: string; og_title: string; markdown: string }>("draft", { system, prompt, effort: "medium", maxTokens: 9000, schema: BLOG_SCHEMA as unknown as Record<string, unknown> });
    if (!post?.markdown) return { summary: "The post could not be written this time.", status: "skipped" };
    const { final, record } = await debate(ctx, {
      kind: "blog_post",
      draft: post.markdown,
      brief: `Blog post for "${topic.keyword}": ${post.title}`,
      rules: `${productFacts()}\n\n${facts}\n\nA blog post must be accurate, fair to competitors, useful, and free of invented numbers.`,
      revise: async (md, issues) => (await ctx.llm.ask("revise", { system, effort: "medium", maxTokens: 9000, prompt: `Revise this post to fix: ${issues.join("; ")}\nReturn only the markdown.\n\n${md}` })).text || md,
    });
    const slug = post.slug.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
    const r = await propose(ctx, {
      kind: "blog_post",
      title: `Blog: ${post.title}`,
      summary: `This week's post, aimed at people searching "${topic.keyword}". Read it, edit anything, then Approve to publish it at /blog/${slug}.`,
      body: final,
      platform: "site",
      debate: record,
      meta: { slug, description: post.description.slice(0, 160), keyword: topic.keyword, og_title: post.og_title.slice(0, 70) },
    });
    if (r.ok) await ctx.saveConfig({ drafted: [...ctx.config<string[]>("drafted", []), topic.keyword] });
    ctx.stat("posts_drafted", r.ok ? 1 : 0);
    return { summary: r.ok ? `Drafted "${post.title}".` : `No draft: ${r.reason}.` };
  },
};

// ── M1 SEO: one improvement a day, found by code ────────────────────────────

export type PageCheck = { url: string; problems: string[] };

export function seoProblems(url: string, html: string): string[] {
  const out: string[] = [];
  const title = html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim() ?? "";
  const desc = html.match(/<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["']/i)?.[1] ?? html.match(/<meta[^>]+content=["']([^"']*)["'][^>]*name=["']description["']/i)?.[1] ?? "";
  if (!title) out.push("no <title>");
  else if (title.length > 65) out.push(`title is ${title.length} characters (search results cut it off after about 60)`);
  else if (title.length < 20) out.push(`title is only ${title.length} characters`);
  if (!desc) out.push("no meta description");
  else if (desc.length > 165) out.push(`meta description is ${desc.length} characters (about 155 show)`);
  else if (desc.length < 70) out.push(`meta description is only ${desc.length} characters`);
  const h1s = (html.match(/<h1[\s>]/gi) ?? []).length;
  if (h1s === 0) out.push("no <h1>");
  if (h1s > 1) out.push(`${h1s} <h1> headings (use one)`);
  if (!/<link[^>]+rel=["']canonical["']/i.test(html)) out.push("no canonical link");
  if (!/application\/ld\+json/i.test(html) && /\/(compare|pricing|for)\b/.test(url)) out.push("no structured data (JSON-LD)");
  const imgs = html.match(/<img\b[^>]*>/gi) ?? [];
  const noAlt = imgs.filter((i) => !/\balt=/i.test(i)).length;
  if (noAlt) out.push(`${noAlt} images without alt text`);
  return out;
}

/** Our own marketing pages from the sitemap, without users' card pages. */
export function marketingUrls(xml: string): string[] {
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)]
    .map((m) => m[1])
    .filter((u) => u.startsWith(SITE))
    .filter((u) => {
      const path = u.slice(SITE.length) || "/";
      // Card pages are one segment like /janedoe-acmerealty; leave customers' pages alone.
      return !/^\/[a-z0-9]+-[a-z0-9]+$/i.test(path) || /^\/(for|compare|blog|pricing|features|templates|products)\b/.test(path);
    });
}

async function sitemapUrls(): Promise<string[]> {
  const r = await safeFetch(`${SITE}/sitemap.xml`, { signal: AbortSignal.timeout(15_000) });
  return marketingUrls(await r.text());
}

export const seoAgent: AgentDef = {
  id: "marketing-seo",
  name: "SEO",
  team: "marketing",
  role: "worker",
  tier: "sonnet",
  schedule: { kind: "daily", hour: 10, minute: 30 },
  dailyUsd: 0.5,
  needs: ["CREW_ANTHROPIC_API_KEY"],
  maxPending: 2,
  approvalKind: "code_fix",
  purpose: "Every day, checks our public pages for search problems (titles, descriptions, headings, structured data, alt text) and proposes one fix.",
  async run(ctx) {
    const urls = (await sitemapUrls()).slice(0, 80);
    const start = ctx.config<number>("cursor", 0) % Math.max(1, urls.length);
    const batch = [...urls.slice(start), ...urls.slice(0, start)].slice(0, 12);
    await ctx.saveConfig({ cursor: start + batch.length });
    const raws: RawFinding[] = [];
    for (const u of batch) {
      try {
        const html = await (await safeFetch(u, { signal: AbortSignal.timeout(15_000) })).text();
        const problems = seoProblems(u, html);
        if (problems.length) raws.push({ fingerprint: `seo:${fingerprintOf(u, problems.join("|"))}`, kind: "ui", source: "seo", title: `${u.replace(SITE, "") || "/"}: ${problems[0]}`, detail: { url: u, problems } });
      } catch {
        /* one slow page shouldn't stop the rest */
      }
    }
    ctx.stat("pages_checked", batch.length);
    // One proposal a day keeps the inbox small; the rest wait their turn.
    const r = await reportFindings(ctx, raws, { maxTriage: 1, tail: "Tap Approve and an AI engineer opens the change for you to review." });
    return { summary: `Checked ${batch.length} pages; ${raws.length} have search problems; ${r.proposed} fix proposed.` };
  },
};

// ── M2 GEO: how SwiftCard shows up in AI answers ────────────────────────────
// Assumption (the meeting never defined GEO): optimize how SwiftCard appears
// in AI answer engines (ChatGPT, Perplexity, Google AI Overviews). Measured by
// asking buyer questions with live web search and checking whether SwiftCard
// is named; improved through site changes such as /llms.txt, FAQ answers and
// structured data, each proposed as a Fix.

export const GEO_QUESTIONS = [
  "What is the best digital business card app for realtors?",
  "What are good HiHello alternatives?",
  "Cheapest digital business card with a link in bio page?",
  "Blinq vs Popl vs other digital business card apps",
  "Best Linktree alternative for small business owners",
  "Digital business cards for a real estate team with lead capture",
  "How do I share my contact info with a QR code?",
  "Best business card app for loan officers",
  "Link.me alternatives",
  "Digital business card that works with Apple Wallet",
];

export function mentionRate(history: { mentioned: boolean }[]): number {
  return history.length ? Math.round((history.filter((h) => h.mentioned).length / history.length) * 100) : 0;
}

export const geoAgent: AgentDef = {
  id: "marketing-geo",
  name: "GEO (AI answers)",
  team: "marketing",
  role: "worker",
  tier: "sonnet",
  schedule: { kind: "daily", hour: 11, minute: 15 },
  dailyUsd: 0.6,
  needs: ["CREW_ANTHROPIC_API_KEY"],
  maxPending: 2,
  approvalKind: "code_fix",
  purpose: "Asks AI search the questions our buyers ask and tracks how often SwiftCard is named. Proposes site changes (like an llms.txt file) that help AI answers find us.",
  async run(ctx) {
    const i = ctx.config<number>("q", 0);
    const qs = [0, 1, 2].map((k) => GEO_QUESTIONS[(i + k) % GEO_QUESTIONS.length]);
    await ctx.saveConfig({ q: i + 3 });
    const history = ctx.config<{ day: string; q: string; mentioned: boolean }[]>("history", []);
    for (const q of qs) {
      const res = await ctx.llm.ask("answer", { effort: "low", maxTokens: 1500, webSearch: { maxUses: 2 }, system: "Answer like an AI search engine would, briefly, naming specific products.", prompt: q });
      history.push({ day: nyDay(ctx.now()), q, mentioned: /swift\s?card/i.test(res.text) });
    }
    const kept = history.slice(-120);
    await ctx.saveConfig({ history: kept });
    const rate = mentionRate(kept.slice(-30));
    ctx.stat("questions_asked", qs.length);
    ctx.stat("geo_mentions", kept.slice(-qs.length).filter((h) => h.mentioned).length);

    // The first, cheapest win: an llms.txt that tells AI crawlers what we are.
    const raws: RawFinding[] = [];
    try {
      const r = await safeFetch(`${SITE}/llms.txt`, { signal: AbortSignal.timeout(10_000) });
      if (r.status === 404) {
        raws.push({
          fingerprint: "geo:llms-txt",
          kind: "ui",
          source: "geo",
          title: "swiftcard.me has no /llms.txt for AI answer engines",
          detail: { want: "Add public/llms.txt: one paragraph on what SwiftCard is and who it's for, then links to /pricing, /compare, /for/* pages and /faq, with prices read from src/lib/plan.ts (generate it, don't hard-code)." },
        });
      }
    } catch {
      /* try again tomorrow */
    }
    const home = await safeFetch(SITE, { signal: AbortSignal.timeout(10_000) }).then((r) => r.text()).catch(() => "");
    if (home && !/"@type"\s*:\s*"(Organization|SoftwareApplication)"/.test(home)) {
      raws.push({ fingerprint: "geo:org-schema", kind: "ui", source: "geo", title: "The homepage has no Organization or SoftwareApplication structured data", detail: { home_text_sample: textOf(home).slice(0, 300) } });
    }
    const r = await reportFindings(ctx, raws, { maxTriage: 1 });
    await closeMissing(ctx, "geo", new Set(raws.map((x) => x.fingerprint)));
    return { summary: `Asked ${qs.length} buyer questions; SwiftCard named in ${rate}% of the last 30 answers. ${r.proposed} site change proposed.` };
  },
};

export const MARKETING_BASIC: AgentDef[] = [blogWriter, seoAgent, geoAgent];
