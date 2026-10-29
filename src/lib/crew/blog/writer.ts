import type { AgentDef } from "../agent-def";
import { buildContext, type AgentContext } from "../context";
import { productFacts } from "../facts";
import type { Providers } from "../context";
import type { CrewStore } from "../store";
import { BANNED_PHRASES, stripEmDashes } from "../voice";
import { COMPETITORS, INTERNAL_LINKS, marketBrief } from "./market";
import { nextTopics, type BlogTopic } from "./topics";

// ── The Blog Writer ─────────────────────────────────────────────────────────
// The owner, 2026-10-29: "in my admin account I click on the agent, I click
// Generate, and it'll take some time ... It'll generate me two posts and show
// me those exact two blog posts and I will click the one that I want. When I
// click one, it posts it on our blog ... That agent will keep a log ... so it
// doesn't repeat that same post again ... It doesn't work on its own."
//
// So: no schedule, not in the agents' clock (registry.ts never lists it), and
// nothing reaches the site until the owner picks one. A Generate researches
// the market (when the notes are over two weeks old) and what ranks for each
// keyword, then writes two posts at once in the SwiftCard voice, no hyphens.
// The pick is inserted into agent_blog_posts, the table /blog reads.

export const BLOG_WRITER: AgentDef = {
  id: "blog-writer",
  name: "Blog Writer",
  team: "marketing",
  role: "worker",
  tier: "opus",
  schedule: { kind: "on_input", platforms: ["site"] },
  dailyUsd: 10,
  needs: ["CREW_ANTHROPIC_API_KEY"],
  maxPending: 2,
  approvalKind: "blog_post",
  purpose: "Writes two blog posts when you press Generate, built to rank on Google and to make the case for SwiftCard. You pick one and it goes live on swiftcard.me/blog.",
  async run() {
    return { summary: "Runs only when you press Generate on its page.", status: "skipped" };
  },
};

/** What a Generate may spend in a day (on its own ceiling, not the agents' shared one). */
export const BLOG_DAILY_USD = 10;
/** A batch still "writing" after this long was cut off (the function's time limit). */
export const WRITING_STALE_MS = 12 * 60_000;
/** Market notes older than this are researched again. */
export const RESEARCH_MAX_AGE_MS = 14 * 86_400_000;

export const BATCH_KEY = "blog:batch";
export const LOG_KEY = "blog:log";
export const RESEARCH_KEY = "blog:research";

export type BlogDraft = { title: string; slug: string; description: string; keyword: string; og_title: string; content_md: string; reader: string; words: number; problems: string[] };
export type BlogBatch = { id: string; status: "writing" | "ready" | "failed" | "published"; started_at: string; finished_at: string | null; step: string; drafts: BlogDraft[]; error: string | null; published: { slug: string; title: string } | null };
export type BlogLogEntry = { slug: string; title: string; keyword: string; published_at: string };
export type MarketResearch = { at: string; notes: string; sources: { title: string; url: string }[] };

/** The pictures a post may use: SwiftCard's own product screenshots. */
export const BLOG_IMAGES: { src: string; alt: string }[] = [
  { src: "/press/01-public-card.jpg", alt: "A SwiftCard digital business card open on a phone, with Save Contact and the Swift Links page under it" },
  { src: "/press/03-contacts.jpg", alt: "SwiftCard's Contacts screen: the people who shared their details from a card" },
  { src: "/press/06-dashboard.jpg", alt: "The SwiftCard dashboard: card views, Swift Links views and new contacts" },
  { src: "/press/08-swift-links.jpg", alt: "A Swift Links page: links and socials under the card" },
  { src: "/press/10-ways-to-share.jpg", alt: "Ways to share a SwiftCard: the card link, a QR code, an NFC tag and Apple Wallet" },
  { src: "/og/phone-realtor.png", alt: "A real estate agent's SwiftCard on a phone" },
  { src: "/og/phone-insurance.png", alt: "An insurance agent's SwiftCard on a phone" },
  { src: "/og/phone-attorney.png", alt: "A professional's SwiftCard on a phone" },
];

export const BLOG_VOICE = `You are Menash, 21, one of the two people who built SwiftCard, and you write SwiftCard's blog yourself. Every post has two jobs: rank on Google for its keyword, and leave the reader convinced SwiftCard is the best answer to their problem, so they create a free card.

Write like a sharp, warm person who knows this market cold, never like a content farm or an AI:
- Open with something specific and alive: a scene from the reader's real day, a surprising truth, a small story. Never a definition, never "In today's world".
- Take an angle the pages that rank now don't take. Be useful first: answer the searcher's question fully and early, with real, concrete advice they can use even if they never sign up.
- Make the case for SwiftCard the way a friend who knows would: tie each point to the reader's situation, show the cost of the old way, then show what SwiftCard changes for them. Be fair to competitors (say what they do well), then show clearly why SwiftCard fits this reader better. Say SwiftCard is yours inside a sentence now and then ("we built SwiftCard because").
- Plain words, contractions, sentences of different lengths, a little personality. First person is fine.
- No hyphens anywhere in the text: no dashes as punctuation (no em dash, no en dash, no " - ") and no hyphenated words ("follow up", "link in bio", "real estate", "email"). Use a comma or a new sentence.
- No AI tells: no "not just X but Y", no "it's not X, it's Y", no groups of three for rhythm, no "In conclusion", no "Imagine…", no rhetorical question you answer yourself, no filler like "it's important to note". Never use: ${BANNED_PHRASES.join(", ")}.

SEO craft:
- Title under 60 characters with the keyword near the front, and worth clicking.
- The keyword in the first 100 words and in one ## heading; related phrases people search used naturally.
- ## and ### headings that a skimmer can follow; short paragraphs; a comparison table where it genuinely helps.
- A "Frequently asked questions" ## section near the end with 3 to 5 real questions people ask, each a ### heading with a short direct answer.
- 1,200 to 1,800 words.
- Link to 3 to 6 of the SwiftCard pages you're given, with natural anchor text, and once in the middle and once at the end invite them to create a free card at /cards/new?src=blog.
- Meta description of 140 to 155 characters that makes the searcher want to click. A short slug of lowercase words joined by hyphens (the slug is the only place a hyphen is allowed).

Format: Markdown only. ## and ### headings (never a single #), paragraphs, "- " bullets sparingly, | tables |, at most one > quote, **bold** sparingly, [text](/path) links. Use 1 to 3 of the pictures you're given, each as ![description](src) on its own line where it shows what the paragraph says. Don't add a cover picture; one is added for you.

Facts: product claims only from SWIFTCARD FACTS. A competitor's price, plan or feature only if the RESEARCH found it, and then say where and when ("Popl's pricing page listed …, in October 2026"). Never invent a customer, a statistic or a result.`;

// ── Pure helpers (tested) ───────────────────────────────────────────────────

/**
 * No hyphens in the text (owner, 2026-10-29), done in code so none slip
 * through: the voice's cleaner on every line, while link and picture targets,
 * inline code, bullet markers, table rules and the slug keep theirs.
 */
export function cleanBlogMarkdown(md: string): string {
  const kept: string[] = [];
  const keep = (m: string) => `\u0001${kept.push(m) - 1}\u0001`;
  const masked = md.replace(/\]\([^)\s]+\)/g, keep).replace(/`[^`\n]*`/g, keep);
  const lines = masked.split("\n").map((line) => {
    if (/^\s*\|?\s*:?-{3,}/.test(line) || /^\s*-{3,}\s*$/.test(line)) return line; // a table rule or a horizontal rule
    const bullet = /^(\s*[-*]\s+)/.exec(line);
    return bullet ? bullet[1] + stripEmDashes(line.slice(bullet[1].length)) : stripEmDashes(line);
  });
  return lines.join("\n").replace(/\u0001(\d+)\u0001/g, (_, i) => kept[Number(i)]);
}

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ALLOWED_PATHS = new Set(INTERNAL_LINKS.map((l) => l.href.split("?")[0]));

export function slugify(s: string): string {
  return s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 70).replace(/-+$/, "");
}

/** What's wrong with a draft, in plain words. Empty means it's ready to show. */
export function blogProblems(d: Pick<BlogDraft, "title" | "slug" | "description" | "keyword" | "content_md">): string[] {
  const out: string[] = [];
  const text = d.content_md.replace(/\]\([^)\s]+\)/g, "]").replace(/`[^`\n]*`/g, "");
  const lower = `${d.title}\n${d.description}\n${text}`.toLowerCase();
  for (const p of BANNED_PHRASES) if (lower.includes(p)) out.push(`uses "${p}"`);
  if (/[—–]/.test(`${d.title}${d.description}${text}`)) out.push("has a dash");
  if (/[A-Za-z]-[A-Za-z]/.test(`${d.title} ${d.description} ${text.replace(/https?:\/\/\S+/g, "")}`)) out.push("has a hyphenated word");
  if (/\bnot (just|only) [^.?!]{1,60}\bbut\b/i.test(text)) out.push('uses "not just X but Y"');
  if (/(^|\n)#\s/.test(d.content_md)) out.push("uses a single # heading (the page owns the title)");
  if ((text.match(/!/g) ?? []).length - (d.content_md.match(/!\[/g) ?? []).length > 2) out.push("too many exclamation points");
  const words = text.split(/\s+/).filter(Boolean).length;
  if (words < 900) out.push(`only ${words} words`);
  if (!SLUG.test(d.slug)) out.push("the slug isn't lowercase words joined by hyphens");
  if (d.title.length > 70) out.push("the title is too long");
  if (d.description.length < 110 || d.description.length > 165) out.push(`the description is ${d.description.length} characters (140 to 155)`);
  if (!lower.slice(0, 1200).includes(d.keyword.toLowerCase().split(" ")[0])) out.push("the keyword isn't near the top");
  if (!/frequently asked questions/i.test(d.content_md)) out.push("no FAQ section");
  if (!/\/cards\/new/.test(d.content_md)) out.push("no invitation to create a free card");
  for (const m of d.content_md.matchAll(/!\[[^\]]*\]\(([^)\s]+)\)/g)) {
    if (!BLOG_IMAGES.some((i) => i.src === m[1]) && !/^\/blog\/[a-z0-9-]+\/cover$/.test(m[1])) out.push(`uses a picture we don't have (${m[1]})`);
  }
  for (const m of d.content_md.matchAll(/(?<!!)\[[^\]]*\]\((\/[^)\s]*)\)/g)) {
    const path = m[1].split("?")[0];
    if (!ALLOWED_PATHS.has(path) && !/^\/blog\/[a-z0-9-]+$/.test(path)) out.push(`links to a page that may not exist (${m[1]})`);
  }
  return [...new Set(out)];
}

/** The cover picture goes first, so every post opens with one. */
export function withCover(md: string, slug: string, title: string): string {
  const body = md.replace(/^!\[[^\]]*\]\(\/blog\/[a-z0-9-]+\/cover\)\s*\n+/, "");
  return `![${title.replace(/[[\]]/g, "")}](/blog/${slug}/cover)\n\n${body.trim()}\n`;
}

/** A batch the function was cut off in the middle of reads as failed, so Generate is never stuck. */
export function batchState(b: BlogBatch | null, now = new Date()): BlogBatch | null {
  if (b?.status === "writing" && now.getTime() - Date.parse(b.started_at) > WRITING_STALE_MS) {
    return { ...b, status: "failed", error: b.error ?? "It took too long and was cut off. Press Generate again." };
  }
  return b;
}

// ── The model steps ─────────────────────────────────────────────────────────

const DRAFT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "slug", "description", "og_title", "content_md"],
  properties: { title: { type: "string" }, slug: { type: "string" }, description: { type: "string" }, og_title: { type: "string" }, content_md: { type: "string" } },
};

async function researchMarket(ctx: AgentContext): Promise<MarketResearch> {
  const names = COMPETITORS.filter((c) => c.site).map((c) => `${c.name} (${c.site})`).join(", ");
  const r = await ctx.llm.askJson<{ notes: string; sources: { title: string; url: string }[] }>("blog-research", {
    tier: "sonnet",
    effort: "medium",
    maxTokens: 6000,
    webSearch: { maxUses: 12 },
    system: "You are a market researcher for SwiftCard, a digital business card and link in bio company. Report only what the search results show, with the date and the source URL for every number. Never invent.",
    prompt: `Research the digital business card and link in bio market as it is right now.\n1. For each of these: ${names}: their current plans and prices from their own pricing page, the features they lead with, and what users praise and complain about (G2, Capterra, Trustpilot, Reddit, App Store reviews).\n2. How professionals share contact info today (NFC, QR, Apple Wallet, email signatures, paper cards) and anything new this year.\n3. The questions people ask when they choose one.\nReturn notes: concise bullet lines grouped by heading, every price with "(source, month year)". And sources: the pages you used.`,
    schema: { type: "object", additionalProperties: false, required: ["notes", "sources"], properties: { notes: { type: "string" }, sources: { type: "array", items: { type: "object", additionalProperties: false, required: ["title", "url"], properties: { title: { type: "string" }, url: { type: "string" } } } } } },
  });
  return { at: ctx.now().toISOString(), notes: r?.notes ?? "", sources: (r?.sources ?? []).slice(0, 40) };
}

async function researchKeyword(ctx: AgentContext, t: BlogTopic): Promise<string> {
  const r = await ctx.llm.askJson<{ results: { title: string; url: string; covers: string }[]; questions: string[]; gap: string }>("blog-serp", {
    tier: "sonnet",
    effort: "medium",
    maxTokens: 3000,
    webSearch: { maxUses: 5 },
    system: "You research what ranks on Google for a search, for a writer who wants to beat it. Report only what the results show.",
    prompt: `The search: "${t.keyword}". Report the pages that rank (title, url, what each covers and what it misses), the questions people ask about it (People Also Ask, Reddit, Quora), and in one paragraph the gap a much better article would fill for ${t.reader}.`,
    schema: { type: "object", additionalProperties: false, required: ["results", "questions", "gap"], properties: { results: { type: "array", items: { type: "object", additionalProperties: false, required: ["title", "url", "covers"], properties: { title: { type: "string" }, url: { type: "string" }, covers: { type: "string" } } } }, questions: { type: "array", items: { type: "string" } }, gap: { type: "string" } } },
  });
  if (!r) return "No search research came back; write from the market brief.";
  return [`WHAT RANKS FOR "${t.keyword}" NOW:`, ...r.results.slice(0, 8).map((x) => `- ${x.title} (${x.url}): ${x.covers}`), "", "WHAT PEOPLE ASK:", ...r.questions.slice(0, 10).map((q) => `- ${q}`), "", `THE GAP TO FILL: ${r.gap}`].join("\n");
}

async function writePost(ctx: AgentContext, t: BlogTopic, o: { research: MarketResearch; serp: string; existing: { slug: string; title: string }[] }): Promise<BlogDraft> {
  const system = `${BLOG_VOICE}\n\n${productFacts()}\n\n${marketBrief()}\n\nRESEARCH (live, ${o.research.at.slice(0, 10)}):\n${o.research.notes || "none"}`;
  const prompt = [
    `Write the post for the search "${t.keyword}". The reader: ${t.reader}. The angle: ${t.angle}.`,
    o.serp,
    `SWIFTCARD PAGES YOU MAY LINK TO:\n${INTERNAL_LINKS.map((l) => `- ${l.href} (${l.label})`).join("\n")}`,
    o.existing.length ? `POSTS ALREADY ON THE BLOG (don't repeat them; link to one if it truly helps, as /blog/<slug>):\n${o.existing.map((p) => `- /blog/${p.slug}: ${p.title}`).join("\n")}` : "",
    `PICTURES YOU MAY USE (use 1 to 3, the src exactly as written):\n${BLOG_IMAGES.map((i) => `- ${i.src}: ${i.alt}`).join("\n")}`,
    "Return the title, the slug, the meta description, an og_title for social sharing, and the post as content_md.",
  ].filter(Boolean).join("\n\n");
  const first = await ctx.llm.askJson<{ title: string; slug: string; description: string; og_title: string; content_md: string }>("blog-write", { tier: "opus", effort: "medium", maxTokens: 9000, system, prompt, schema: DRAFT_SCHEMA });
  if (!first) throw new Error(`No post came back for "${t.keyword}".`);
  let draft = finish(first, t, o.existing);
  if (draft.problems.length) {
    const again = await ctx.llm.askJson<typeof first>("blog-revise", {
      tier: "opus",
      effort: "medium",
      maxTokens: 9000,
      system,
      prompt: `${prompt}\n\nYOUR DRAFT:\n${JSON.stringify(first)}\n\nFix these and return the whole post again:\n- ${draft.problems.join("\n- ")}`,
      schema: DRAFT_SCHEMA,
    });
    if (again) {
      const next = finish(again, t, o.existing);
      if (next.problems.length <= draft.problems.length) draft = next;
    }
  }
  return draft;
}

/** Cleaned, with its cover, a slug nobody has, and what's still wrong with it. */
export function finish(raw: { title: string; slug: string; description: string; og_title: string; content_md: string }, t: BlogTopic, existing: { slug: string }[]): BlogDraft {
  const title = stripEmDashes(raw.title.trim()).replace(/^#+\s*/, "");
  let slug = SLUG.test(raw.slug.trim()) ? raw.slug.trim() : slugify(raw.slug || title);
  if (existing.some((p) => p.slug === slug)) slug = `${slug}-${Date.now().toString(36).slice(-4)}`;
  const description = stripEmDashes(raw.description.trim());
  const content_md = withCover(cleanBlogMarkdown(raw.content_md), slug, title);
  const d = { title, slug, description, keyword: t.keyword, og_title: stripEmDashes((raw.og_title || title).trim()), content_md, reader: t.reader };
  return { ...d, words: content_md.split(/\s+/).filter(Boolean).length, problems: blogProblems(d) };
}

// ── Generate and publish ────────────────────────────────────────────────────

/** What has been written already: every post on the blog, and the writer's own log. */
export async function usedTopics(store: CrewStore, posts: { slug: string; title: string; keyword: string | null }[]) {
  const log = (await store.kvGet<BlogLogEntry[]>(LOG_KEY).catch(() => null)) ?? [];
  return {
    keywords: [...posts.map((p) => p.keyword ?? ""), ...log.map((l) => l.keyword)].filter(Boolean),
    titles: [...posts.map((p) => p.title), ...log.map((l) => l.title)],
    slugs: [...posts.map((p) => p.slug), ...log.map((l) => l.slug)],
  };
}

/** Pick two topics nobody has written; if the plan has run out, ask for new ones. */
async function pickTopics(ctx: AgentContext, used: Awaited<ReturnType<typeof usedTopics>>): Promise<BlogTopic[]> {
  const planned = nextTopics(used, 2);
  if (planned.length === 2) return planned;
  const more = await ctx.llm.askJson<{ topics: BlogTopic[] }>("blog-topics", {
    tier: "sonnet",
    effort: "medium",
    maxTokens: 2000,
    system: `${marketBrief()}`,
    prompt: `Suggest ${2 - planned.length} new Google searches SwiftCard's blog should rank for: things professionals type when they are about to choose a business card, a link in bio page or a way to follow up. Not any of these, already written: ${used.keywords.join("; ")}. For each: keyword, reader, angle.`,
    schema: { type: "object", additionalProperties: false, required: ["topics"], properties: { topics: { type: "array", items: { type: "object", additionalProperties: false, required: ["keyword", "reader", "angle"], properties: { keyword: { type: "string" }, reader: { type: "string" }, angle: { type: "string" } } } } } },
  });
  return [...planned, ...nextTopics(used, 2 - planned.length, more?.topics ?? [])].slice(0, 2);
}

type Posts = { slug: string; title: string; keyword: string | null }[];

/**
 * One Generate: two finished posts in the batch, or the reason there aren't.
 * Called after the Generate button has answered, so the page shows "Writing…"
 * at once; the batch says which step it's on.
 */
export async function generateBatch(store: CrewStore, providers: Providers, o: { batchId: string; posts: Posts; now?: () => Date }): Promise<BlogBatch> {
  const now = o.now ?? (() => new Date());
  const save = async (patch: Partial<BlogBatch>) => {
    const cur = (await store.kvGet<BlogBatch>(BATCH_KEY)) ?? null;
    if (cur && cur.id !== o.batchId) return cur; // a newer Generate took over
    const next = { ...(cur ?? { id: o.batchId, status: "writing", started_at: now().toISOString(), finished_at: null, step: "", drafts: [], error: null, published: null }), ...patch } as BlogBatch;
    await store.kvSet(BATCH_KEY, next);
    return next;
  };
  try {
    const ctx = await buildContext({ def: BLOG_WRITER, store, providers, runId: null, now, state: { ...(await store.getAgentState(BLOG_WRITER.id)), enabled: true }, onDemand: { capUsd: BLOG_DAILY_USD } });
    if (!providers.claude) throw new Error("The Claude key (CREW_ANTHROPIC_API_KEY) isn't set.");
    const used = await usedTopics(store, o.posts);
    await save({ step: "Choosing two topics nobody has written yet" });
    const topics = await pickTopics(ctx, used);
    if (topics.length < 2) throw new Error("Couldn't find two new topics to write about.");
    await save({ step: `Researching the market and what ranks for "${topics[0].keyword}" and "${topics[1].keyword}"` });
    const cached = await store.kvGet<MarketResearch>(RESEARCH_KEY).catch(() => null);
    const fresh = cached && now().getTime() - Date.parse(cached.at) < RESEARCH_MAX_AGE_MS ? cached : null;
    const [research, ...serps] = await Promise.all([fresh ? Promise.resolve(fresh) : researchMarket(ctx), ...topics.map((t) => researchKeyword(ctx, t))]);
    if (!fresh && research.notes) await store.kvSet(RESEARCH_KEY, research);
    await save({ step: "Writing both posts" });
    const existing = o.posts.map((p) => ({ slug: p.slug, title: p.title }));
    const drafts = await Promise.all(topics.map((t, i) => writePost(ctx, t, { research, serp: serps[i], existing })));
    if (drafts[0].slug === drafts[1].slug) drafts[1] = { ...drafts[1], slug: `${drafts[1].slug}-2`, content_md: withCover(drafts[1].content_md, `${drafts[1].slug}-2`, drafts[1].title) };
    return await save({ status: "ready", step: "", drafts, finished_at: now().toISOString() });
  } catch (e) {
    return save({ status: "failed", step: "", error: e instanceof Error ? e.message.slice(0, 300) : String(e).slice(0, 300), finished_at: now().toISOString() });
  }
}

type Insert = (row: { slug: string; title: string; description: string; keyword: string; og_title: string; content_md: string; status: "published"; published_at: string }) => Promise<{ error: { code?: string; message: string } | null }>;

/**
 * The owner picked one: it goes live on the blog, the log remembers it, and
 * the other one is let go (its topic stays free for a later Generate).
 */
export async function publishChoice(store: CrewStore, insert: Insert, o: { batchId: string; index: number; now?: Date }): Promise<{ ok: true; slug: string; title: string } | { ok: false; message: string }> {
  const now = o.now ?? new Date();
  const b = batchState(await store.kvGet<BlogBatch>(BATCH_KEY), now);
  if (!b || b.id !== o.batchId) return { ok: false, message: "Those two posts aren't the current ones any more. Press Generate for new ones." };
  if (b.status === "published") return { ok: false, message: `Already published: ${b.published?.title ?? "one of these"}.` };
  if (b.status !== "ready") return { ok: false, message: "The posts aren't ready yet." };
  const d = b.drafts[o.index];
  if (!d) return { ok: false, message: "Pick one of the two posts." };
  const { error } = await insert({ slug: d.slug, title: d.title, description: d.description, keyword: d.keyword, og_title: d.og_title, content_md: d.content_md, status: "published", published_at: now.toISOString() });
  if (error) return { ok: false, message: error.code === "23505" ? "A post with that address already exists." : `Couldn't publish: ${error.message}` };
  const log = (await store.kvGet<BlogLogEntry[]>(LOG_KEY).catch(() => null)) ?? [];
  await store.kvSet(LOG_KEY, [{ slug: d.slug, title: d.title, keyword: d.keyword, published_at: now.toISOString() }, ...log].slice(0, 500));
  await store.kvSet(BATCH_KEY, { ...b, status: "published", published: { slug: d.slug, title: d.title } });
  return { ok: true, slug: d.slug, title: d.title };
}
