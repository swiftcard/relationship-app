import { createHash } from "node:crypto";
import { inboxFull, propose } from "../approvals";
import type { AgentContext } from "../context";
import { reportHtml } from "../reports";
import type { Finding } from "../types";
import { sendOwnerDigest } from "@/lib/owner-digest";

// ── Watchdog findings: notice once, explain plainly, propose a fix ──────────
// Every Watchdog agent turns raw signals (crashes, failed checks, broken
// screens) into findings keyed by a stable fingerprint, so 40 copies of one
// bug are one card. Only NEW or RETURNING problems reach a model, all of one
// run's in a single call. Each becomes a "Fix" card; approving it opens a pull
// request (never a merge). A critical one also emails right away.

export type RawFinding = {
  fingerprint: string;
  kind: Finding["kind"];
  source: string;
  /** Short technical label, shown when the model is unavailable. */
  title: string;
  detail: Record<string, unknown>;
  count?: number;
};

type Triage = { key: string; title: string; summary: string; severity: "low" | "medium" | "high" | "critical"; fix_brief: string };

const TRIAGE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["items"],
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["key", "title", "summary", "severity", "fix_brief"],
        properties: {
          key: { type: "string" },
          title: { type: "string" },
          summary: { type: "string" },
          severity: { type: "string", enum: ["low", "medium", "high", "critical"] },
          fix_brief: { type: "string" },
        },
      },
    },
  },
} as const;

const TRIAGE_SYSTEM = `You are the bug triage lead for SwiftCard, a Next.js (App Router) + Supabase web app with iOS and Android shells: digital business cards, link-in-bio pages, lead capture, Stripe billing.
For each problem you get, return:
- title: what is broken, in 12 words or fewer, plain words a 10-year-old understands (no code words).
- summary: 1 or 2 short sentences: who it hurts and how much. Plain words.
- severity: critical = people cannot sign up, pay, log in or open cards, or data is exposed; high = a main feature is broken for many; medium = broken for some or degraded; low = cosmetic or rare.
- fix_brief: for the engineer (an AI coding agent working in the repo): the likely cause, which files or routes to look at, how to reproduce, and how to prove the fix (a test that fails before and passes after). Never guess file paths as fact; say "probably". Never include personal data.
Use the key you were given for each item.`;

/** The card's sentence when no model explains it (economy mode). */
export function plainFallback(raw: RawFinding): string {
  const what: Record<RawFinding["kind"], string> = {
    bug: "The site hit an error.",
    speed: "A page was slower than our speed limit.",
    security: "A security check failed.",
    ui: "A screen check found a problem.",
    flow: "A test run of the site found a problem.",
    payment: "A payment check found a problem.",
    app: "A check of the app found a problem.",
  };
  return `${what[raw.kind]} Details are below.`;
}

export function fingerprintOf(...parts: string[]): string {
  return createHash("sha256").update(parts.join("\u0000")).digest("hex").slice(0, 24);
}

/** Strip the things that vary between two copies of the same failure. */
export function normalizeFailure(s: string): string {
  return s
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<id>")
    .replace(/\b\d{4}-\d{2}-\d{2}T[\d:.]+Z?\b/g, "<time>")
    .replace(/\b\d+(\.\d+)?\s?(ms|s)\b/g, "<dur>")
    .replace(/\b\d+(\.\d+)?(px|kb|mb|%)/gi, "<n>$2")
    // Widths like "@390" name the screen size, so they stay.
    .replace(/(?<!@)\b\d{3,}\b/g, "<n>")
    .replace(/qa[-_][a-z0-9-]+@[a-z0-9.-]+/gi, "<qa-email>")
    .trim()
    .slice(0, 400);
}

/** No personal data leaves for a model, an email or a GitHub workflow input. */
export function redact(s: string): string {
  return s
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "<email>")
    .replace(/\b(sk|pk|rk|whsec|sb|eyJ)[A-Za-z0-9_-]{16,}\b/g, "<secret>")
    .replace(/\+?\d[\d\s().-]{8,}\d/g, "<phone>");
}

/**
 * Record findings; triage and propose the new or returning ones.
 * `seenFingerprints` are the ones present in this run's source, used to close
 * findings that went away (see closeMissing).
 */
export async function reportFindings(
  ctx: AgentContext,
  raws: RawFinding[],
  opts?: { maxTriage?: number; approvalKind?: "code_fix" | "ask"; tail?: string },
): Promise<{ fresh: number; proposed: number }> {
  const now = ctx.now().toISOString();
  const fresh: { raw: RawFinding; row: Finding }[] = [];
  for (const raw of raws) {
    const prev = await ctx.store.getFinding(raw.fingerprint);
    const returning = prev?.status === "fixed" || prev?.status === "ignored";
    const row = await ctx.store.upsertFinding({
      fingerprint: raw.fingerprint,
      agent_id: ctx.def.id,
      kind: raw.kind,
      source: raw.source,
      title: prev?.title && !returning ? prev.title : raw.title,
      detail: raw.detail,
      count: (prev?.count ?? 0) + (raw.count ?? 1),
      last_seen: now,
      status: prev && !returning ? prev.status : "open",
      approval_id: prev && !returning ? prev.approval_id : null,
    });
    if (!prev || returning || (row.status === "open" && !row.approval_id)) fresh.push({ raw, row });
  }
  ctx.stat("findings_seen", raws.length);
  if (!fresh.length) {
    ctx.stat("no_llm_needed");
    return { fresh: 0, proposed: 0 };
  }
  if (await inboxFull(ctx)) {
    // Don't pay to explain problems nobody has room to look at yet; they stay
    // open and are explained once the inbox has space.
    ctx.stat("skipped_inbox_full");
    return { fresh: fresh.length, proposed: 0 };
  }

  const batch = fresh.slice(0, opts?.maxTriage ?? 8);
  let triage: Triage[] = [];
  // Economy mode (and no Claude key) is the free Watchdog: every problem still
  // becomes a card with the raw details; only the plain-words explanation is
  // skipped. The fix engineer reads the raw details either way.
  const useModel = !ctx.settings.economy && ctx.llm.hasClaude;
  if (!useModel) ctx.stat("no_llm_needed");
  if (useModel) try {
    const out = await ctx.llm.askJson<{ items: Triage[] }>("triage", {
      effort: "low",
      maxTokens: 4000,
      schema: TRIAGE_SCHEMA as unknown as Record<string, unknown>,
      system: TRIAGE_SYSTEM,
      prompt: batch.map((f, i) => `KEY: f${i}\nSOURCE: ${f.raw.source}\nWHAT: ${redact(f.raw.title)}\nDETAIL: ${redact(JSON.stringify(f.raw.detail)).slice(0, 2500)}\nTIMES SEEN: ${f.row.count}`).join("\n\n---\n\n"),
    });
    triage = out?.items ?? [];
  } catch (e) {
    // Out of budget or no model: still put the problem in front of a person.
    ctx.log(`triage skipped: ${e instanceof Error ? e.message : String(e)}`);
  }

  let proposed = 0;
  const critical: string[] = [];
  for (const [i, f] of batch.entries()) {
    const t = triage.find((x) => x.key === `f${i}`);
    const title = t?.title || f.raw.title;
    const asking = opts?.approvalKind === "ask";
    const tail = opts?.tail ?? (asking ? "Tap Approve when you have looked at it." : "Tap Approve and an AI engineer opens a fix for you to review. Nothing changes until you merge it.");
    const summary = `${t?.summary || plainFallback(f.raw)} Seen ${f.row.count} time${f.row.count === 1 ? "" : "s"}. ${tail}`;
    const brief = [
      `Finding: ${redact(f.raw.title)}`,
      `Source: ${f.raw.source}`,
      `Seen: ${f.row.count} time(s), first ${f.row.first_seen}, last ${f.row.last_seen}`,
      `Detail: ${redact(JSON.stringify(f.raw.detail)).slice(0, 3000)}`,
      "",
      t?.fix_brief ? `Triage notes:\n${redact(t.fix_brief)}` : "Triage notes: none (model unavailable). Reproduce first.",
    ].join("\n");
    const r = await propose(ctx, {
      kind: asking ? "ask" : "code_fix",
      title: asking ? title : `Fix: ${title}`,
      summary,
      body: brief,
      platform: "site",
      meta: { finding_id: f.row.id, fingerprint: f.raw.fingerprint, severity: t?.severity ?? "medium" },
    });
    if (r.ok) {
      proposed++;
      await ctx.store.patchFinding(f.row.id, { status: "proposed", approval_id: r.id, title });
      if (t?.severity === "critical") critical.push(`${title}\n${t.summary}`);
    }
  }
  ctx.stat("findings_new", fresh.length);
  ctx.stat("fixes_proposed", proposed);
  if (critical.length) {
    await sendOwnerDigest(`Urgent: ${critical.length} serious problem${critical.length > 1 ? "s" : ""} on the site`, reportHtml(["What happened", ...critical.map((c) => `- ${c.replace(/\n/g, " ")}`), "", "What I need from you", "- Open the Watchdog room and look at the Fix card."].join("\n"), "watchdog"));
  }
  return { fresh: fresh.length, proposed };
}

/** Findings this agent raised that are no longer seen: mark them fixed. */
export async function closeMissing(ctx: AgentContext, source: string, present: Set<string>): Promise<number> {
  let n = 0;
  for (const f of await ctx.store.listFindings(["open", "proposed"], 500)) {
    if (f.agent_id === ctx.def.id && f.source === source && !present.has(f.fingerprint)) {
      await ctx.store.patchFinding(f.id, { status: "fixed" });
      n++;
    }
  }
  if (n) ctx.stat("findings_cleared", n);
  return n;
}
