import type { AgentDef } from "../agent-def";
import type { AgentContext } from "../context";
import { propose } from "../approvals";
import { productFacts } from "../facts";
import { CAPTION_RULES, PLATFORM_SIZE, SIZES, SOCIAL_PLATFORMS, SOCIAL_STYLE, type SocialPlatform } from "../marketing/social-style";
import { nyDay } from "../schedule";
import { dispatchWorkflow, githubConfigured } from "../sources/github";

// ── M4 Social media manager ─────────────────────────────────────────────────
// One idea a day, the same post adapted for LinkedIn, Instagram, Threads,
// TikTok, Pinterest, YouTube, Reddit and Alignable. Image posts and
// slideshows, no video yet. Two steps, both in the inbox:
//   1. three options to pick from (rendered as pictures when the render
//      workflow is set up, otherwise described in words);
//   2. the finished set: every slide at every size, with a caption written
//      for each platform. A person posts it; nothing is published by the agent.
// It starts a new idea only when the previous one is finished and the inbox
// has room, so the queue stays as small as the budget.

export type Slide = { headline: string; accent: string; sub: string; visual: "card" | "link" | "tap" | "none" };
export type SocialOption = { name: string; format: "image" | "slideshow"; slides: Slide[] };
export type SocialSpec = {
  id: string;
  day: string;
  idea: string;
  options: SocialOption[];
  stage: "options_requested" | "options_proposed" | "final_requested" | "done" | "dropped";
  requested_at: string;
  choice?: number;
  captions?: Partial<Record<SocialPlatform, string>>;
  step1_id?: string;
  sizes: typeof SIZES;
};

export type RenderedFiles = { files: { key: string; url: string }[]; at: string };

const ACTIVE = "social:active";
const specKey = (id: string) => `social:spec:${id}`;
export const renderKey = (id: string, step: "options" | "final") => `social:render:${id}:${step}`;
const RENDER_WAIT_MS = 3 * 3600_000;

const SLIDE = {
  type: "object",
  additionalProperties: false,
  required: ["headline", "accent", "sub", "visual"],
  properties: {
    headline: { type: "string" },
    accent: { type: "string" },
    sub: { type: "string" },
    visual: { type: "string", enum: ["card", "link", "tap", "none"] },
  },
} as const;

const IDEA_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["idea", "options"],
  properties: {
    idea: { type: "string" },
    options: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "format", "slides"],
        properties: { name: { type: "string" }, format: { type: "string", enum: ["image", "slideshow"] }, slides: { type: "array", items: SLIDE } },
      },
    },
  },
} as const;

const CAPTION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: SOCIAL_PLATFORMS,
  properties: Object.fromEntries(SOCIAL_PLATFORMS.map((p) => [p, { type: "string" }])),
} as const;

/** Keep the model's slides inside the visual system: short headlines, a real accent word. */
export function cleanOptions(options: SocialOption[]): SocialOption[] {
  return options.slice(0, 3).map((o) => {
    const slides = (o.slides ?? []).slice(0, o.format === "slideshow" ? 5 : 1).map((s) => {
      const headline = s.headline.replace(/—/g, ",").split(/\s+/).slice(0, 5).join(" ");
      const words = headline.replace(/[.,!?]/g, "").split(/\s+/);
      const accent = words.find((w) => w.toLowerCase() === s.accent?.replace(/[.,!?]/g, "").toLowerCase()) ?? words[words.length - 1] ?? "";
      return { headline, accent, sub: s.sub.replace(/—/g, ",").slice(0, 90), visual: (["card", "link", "tap", "none"] as const).includes(s.visual) ? s.visual : "card" };
    });
    return { name: o.name.slice(0, 60), format: (slides.length > 1 ? "slideshow" : "image") as SocialOption["format"], slides };
  }).filter((o) => o.slides.length > 0);
}

async function load(ctx: AgentContext, id: string) {
  return ctx.store.kvGet<SocialSpec>(specKey(id));
}
async function save(ctx: AgentContext, s: SocialSpec) {
  await ctx.store.kvSet(specKey(s.id), s);
}

async function newIdea(ctx: AgentContext): Promise<SocialSpec | null> {
  const recent = ctx.config<string[]>("recent_ideas", []);
  const out = await ctx.llm.askJson<{ idea: string; options: SocialOption[] }>("idea", {
    effort: "medium",
    maxTokens: 3000,
    schema: IDEA_SCHEMA as unknown as Record<string, unknown>,
    system: `You are SwiftCard's social media manager.\n\n${SOCIAL_STYLE}\n\n${productFacts()}`,
    prompt: `Today's post. Pick ONE idea that shows a real SwiftCard feature to business professionals with a personal brand (realtors, recruiters, sales coaches, loan officers, local service businesses). Not one of these recent ideas: ${recent.slice(-10).join(" | ") || "none"}.\nGive 3 different options for it (one single image, one slideshow of 3 to 5 slides, and one more of either). Each slide: headline of 2 to 4 words, the one word in it to color (accent), a subline under 60 characters, and which real product picture to show (card, link = Swift Links page on a phone, tap = card page on a phone, none).`,
  });
  if (!out?.options?.length) return null;
  const options = cleanOptions(out.options);
  if (!options.length) return null;
  const id = `${nyDay(ctx.now())}-${Math.random().toString(36).slice(2, 7)}`;
  await ctx.saveConfig({ recent_ideas: [...recent, out.idea].slice(-20) });
  return { id, day: nyDay(ctx.now()), idea: out.idea.slice(0, 200), options, stage: "options_requested", requested_at: ctx.now().toISOString(), sizes: SIZES };
}

async function writeCaptions(ctx: AgentContext, s: SocialSpec, o: SocialOption): Promise<Partial<Record<SocialPlatform, string>>> {
  const out = await ctx.llm.askJson<Record<SocialPlatform, string>>("captions", {
    effort: "medium",
    maxTokens: 4000,
    schema: CAPTION_SCHEMA as unknown as Record<string, unknown>,
    system: `You are SwiftCard's social media manager.\n\n${SOCIAL_STYLE}\n\n${productFacts()}`,
    prompt: `Write the caption for each platform for this post.\nIdea: ${s.idea}\nSlides: ${o.slides.map((x, i) => `${i + 1}. ${x.headline} / ${x.sub}`).join(" ; ")}\n\n${SOCIAL_PLATFORMS.map((p) => `- ${CAPTION_RULES[p]}`).join("\n")}\nNo em dashes. Only claim the product facts given.`,
  });
  return out ?? {};
}

function optionsSummary(s: SocialSpec): string {
  return s.options.map((o, i) => `${i + 1}. ${o.name} (${o.format === "slideshow" ? `slideshow, ${o.slides.length} slides` : "single image"}): ${o.slides.map((x) => `"${x.headline}" / ${x.sub}`).join(" → ")}`).join("\n");
}

export function finalBody(s: SocialSpec, files: RenderedFiles | null): string {
  const o = s.options[(s.choice ?? 1) - 1];
  const lines = [`Idea: ${s.idea}`, `Chosen: ${o.name}`, ""];
  for (const p of SOCIAL_PLATFORMS) {
    const size = PLATFORM_SIZE[p];
    lines.push(`=== ${p.toUpperCase()} (${SIZES[size].w}x${SIZES[size].h}) ===`);
    const imgs = (files?.files ?? []).filter((f) => f.key.startsWith(`${size}-`)).map((f) => f.url);
    if (imgs.length) lines.push(...imgs.map((u, i) => `Slide ${i + 1}: ${u}`));
    lines.push(s.captions?.[p] ?? "(no caption)", "");
  }
  if (!files) lines.push("Pictures: the render workflow isn't set up yet (needs CREW_GITHUB_TOKEN), so make these from marketing/instagram/launch/src/pinned-v2.html.");
  return lines.join("\n");
}

async function step(ctx: AgentContext, s: SocialSpec): Promise<string | null> {
  const now = ctx.now().getTime();
  if (s.stage === "options_requested") {
    const files = await ctx.store.kvGet<RenderedFiles>(renderKey(s.id, "options"));
    const waitedTooLong = now - new Date(s.requested_at).getTime() > RENDER_WAIT_MS;
    if (!files && githubConfigured() && !waitedTooLong) return null;
    const r = await propose(ctx, {
      kind: "post",
      title: `Social: pick today's post (${s.idea.slice(0, 70)})`,
      summary: `Three ways to make today's post. Pick one in the box and tap Approve; I'll make every size and a caption for each platform. Reject to skip today.`,
      body: optionsSummary(s),
      platform: "instagram",
      meta: { social_id: s.id, step: 1, options: s.options.map((o, i) => ({ n: i + 1, name: o.name, image: files?.files.find((f) => f.key === `opt-${i + 1}`)?.url ?? null })) },
    });
    if (!r.ok) return null;
    await save(ctx, { ...s, stage: "options_proposed", step1_id: r.id });
    return `Proposed 3 options for "${s.idea}".`;
  }
  if (s.stage === "options_proposed" && s.step1_id) {
    const a = await ctx.store.getApproval(s.step1_id);
    if (!a || a.status === "pending") return null;
    if (a.status === "rejected" || a.status === "expired") {
      await save(ctx, { ...s, stage: "dropped" });
      return "Today's post was skipped.";
    }
    const choice = Math.min(s.options.length, Math.max(1, Number(a.meta?.choice ?? 1) || 1));
    const captions = await writeCaptions(ctx, s, s.options[choice - 1]);
    // Step 1 is a choice, not something to post: close it.
    await ctx.store.updateApproval(a.id, { status: "done", done_at: ctx.now().toISOString() });
    const next: SocialSpec = { ...s, choice, captions, stage: "final_requested", requested_at: ctx.now().toISOString() };
    await save(ctx, next);
    if (githubConfigured()) await dispatchWorkflow("crew-render.yml", { spec_id: s.id, step: "final" });
    return `Option ${choice} chosen; captions written${githubConfigured() ? ", pictures rendering" : ""}.`;
  }
  if (s.stage === "final_requested") {
    const files = await ctx.store.kvGet<RenderedFiles>(renderKey(s.id, "final"));
    const waitedTooLong = now - new Date(s.requested_at).getTime() > RENDER_WAIT_MS;
    if (!files && githubConfigured() && !waitedTooLong) return null;
    const r = await propose(ctx, {
      kind: "post",
      title: `Social: today's post is ready (${s.idea.slice(0, 70)})`,
      summary: "Every size and a caption for each platform. Download the pictures, post them from our accounts, then tap I posted it.",
      body: finalBody(s, files),
      platform: "instagram",
      meta: { social_id: s.id, step: 2, images: files?.files ?? [] },
    });
    if (!r.ok) return null;
    await save(ctx, { ...s, stage: "done" });
    ctx.stat("posts_ready");
    return "Today's post is ready to publish.";
  }
  return null;
}

export const socialManager: AgentDef = {
  id: "marketing-social",
  name: "Social media manager",
  team: "marketing",
  role: "worker",
  tier: "sonnet",
  schedule: { kind: "every", minutes: 60 },
  dailyUsd: 0.6,
  needs: ["CREW_ANTHROPIC_API_KEY"],
  maxPending: 2,
  approvalKind: "post",
  purpose: "One post idea a day for LinkedIn, Instagram, Threads, TikTok, Pinterest, YouTube, Reddit and Alignable: you pick from 3 picture options, then get every size with a caption for each platform.",
  async run(ctx) {
    const active = (await ctx.store.kvGet<string[]>(ACTIVE)) ?? [];
    const notes: string[] = [];
    const still: string[] = [];
    for (const id of active) {
      const s = await load(ctx, id);
      if (!s) continue;
      const msg = await step(ctx, s);
      if (msg) notes.push(msg);
      const after = await load(ctx, id);
      if (after && after.stage !== "done" && after.stage !== "dropped") still.push(id);
    }
    const today = nyDay(ctx.now());
    const startedToday = ctx.config<string | null>("last_day", null) === today;
    if (!startedToday && still.length === 0 && (await ctx.store.countPending(ctx.def.id)) < ctx.def.maxPending) {
      const s = await newIdea(ctx);
      if (s) {
        await save(ctx, s);
        still.push(s.id);
        await ctx.saveConfig({ last_day: today });
        if (githubConfigured()) await dispatchWorkflow("crew-render.yml", { spec_id: s.id, step: "options" });
        notes.push(`New idea: ${s.idea}.`);
        // With no render workflow the options can go to the inbox right away.
        const msg = await step(ctx, s);
        if (msg) notes.push(msg);
        ctx.stat("ideas", 1);
      }
    } else if (!notes.length) ctx.stat("no_llm_needed");
    await ctx.store.kvSet(ACTIVE, still);
    return { summary: notes.join(" ") || "Nothing to do this hour." };
  },
};

