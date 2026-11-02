import { createHash } from "node:crypto";
import { inboxFull, propose } from "../approvals";
import type { AgentContext } from "../context";
import { reportHtml } from "../reports";
import type { ApprovalStatus, Finding } from "../types";
import { isAdminTeam } from "../teams";
import { sendOwnerDigest } from "@/lib/owner-digest";

// ── Watchdog findings: notice once, explain plainly, propose a fix ──────────
// Every Watchdog agent turns raw signals (crashes, failed checks, broken
// screens) into findings keyed by a stable fingerprint, so 40 copies of one
// bug are one card. Only NEW or RETURNING problems reach a model, all of one
// run's in a single call. Each becomes a "Fix" card; approving it opens a pull
// request (never a merge). A critical one also emails right away.
//
// The owner, 2026-10-29: "It gives it to me once and then I approve it and it
// gets fixed. If it gets broken again then it does it again." So a problem
// with a card, waiting or approved, never gets a second one while it is still
// there; it is fixed only once the checks stop seeing it (closeMissing, after
// a quiet spell, so one lucky run doesn't count); and only a problem that
// comes back after a fix you approved is raised again, saying so.

export type RawFinding = {
  fingerprint: string;
  kind: Finding["kind"];
  source: string;
  /** Short technical label, shown when the model is unavailable. */
  title: string;
  detail: Record<string, unknown>;
  count?: number;
  /** Keys this same problem was stored under before (one per screen, before 2026-10-29): a card raised under any of them still counts. */
  aliases?: string[];
};

/** What a problem seen again is, given what we stored and its card: never shown, already shown, or back after a fix you approved. */
export type Recurrence = "new" | "same" | "back" | "dismissed";

export function recurrence(prev: Pick<Finding, "status" | "approval_id"> | null, card: ApprovalStatus | null): Recurrence {
  if (!prev || prev.status === "ignored") return prev ? "dismissed" : "new";
  // You turned its card down: it stays quiet.
  if (card === "rejected") return "dismissed";
  // Never shown yet (its card was never made, or is gone): show it.
  if (!prev.approval_id || !card) return "new";
  if (prev.status !== "fixed") return "same"; // still there, card waiting or fix approved: one card
  // It went away. With your fix approved, seeing it again means it broke again.
  if (card === "approved" || card === "done") return "back";
  // Gone and back while its card is still waiting: still that one card.
  if (card === "pending") return "same";
  return "new"; // its card expired unanswered, then it went away and came back
}

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
  return legacyNormalize(
    s
      // A link's values (a test account's path, a one-time token) change every run.
      .replace(/([?&][\w.-]+=)[^&\s"'<>)]+/g, "$1<v>")
      .replace(/\b[A-Za-z0-9+/_=-]{24,}/g, (t) => (/[A-Z]/.test(t) && /[a-z]/.test(t) && /\d/.test(t) ? "<token>" : t))
      .replace(/\[\d+\]/g, "[<n>]"),
  );
}

/** The normalizing findings were keyed with before 2026-10-29; kept so those keys can still be found (aliases). */
function legacyNormalize(s: string): string {
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

/** The key a nightly failure line had before 2026-10-29 (one per screen). */
export function legacyNightlyKey(source: string, section: string, failure: string): string {
  return `${source}:${fingerprintOf(section, legacyNormalize(failure))}`;
}

/** "<screen>: <problem>" split, so one problem on eight screens is one finding that names all eight. */
export function splitWhere(failure: string): { where: string | null; problem: string } {
  const m = /^([^\s:]{1,80}):\s+([\s\S]+)$/.exec(failure.trim());
  return m ? { where: m[1], problem: m[2] } : { where: null, problem: failure.trim() };
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
  const fresh: { raw: RawFinding; row: Finding; backFrom: string | null }[] = [];
  for (const raw of raws) {
    const prev = (await ctx.store.getFinding(raw.fingerprint)) ?? (await carriedOver(ctx, raw.aliases ?? []));
    const card = prev?.approval_id ? await ctx.store.getApproval(prev.approval_id) : null;
    const what = recurrence(prev, card?.status ?? null);
    const keep = what === "same" || what === "dismissed";
    const row = await ctx.store.upsertFinding({
      fingerprint: raw.fingerprint,
      agent_id: ctx.def.id,
      kind: raw.kind,
      source: raw.source,
      title: prev?.title && keep ? prev.title : raw.title,
      detail: raw.detail,
      count: (prev?.count ?? 0) + (raw.count ?? 1),
      last_seen: now,
      // Seen again while its card waits (or after you approved it): "proposed" again, never fixed.
      status: what === "dismissed" ? "ignored" : what === "same" ? (prev!.status === "fixed" || prev!.status === "open" ? "proposed" : prev!.status) : "open",
      approval_id: keep ? prev!.approval_id : null,
    });
    if (what === "new" || what === "back") fresh.push({ raw, row, backFrom: what === "back" ? (card?.decided_at ?? card?.created_at ?? null) : null });
    else ctx.stat(what === "dismissed" ? "findings_dismissed" : "findings_already_shown");
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
    const title = `${f.backFrom ? "Broken again: " : ""}${t?.title || f.raw.title}`;
    const asking = opts?.approvalKind === "ask";
    const tail = opts?.tail ?? (asking ? "Tap Approve when you have looked at it." : "Tap Approve and an AI engineer opens a fix for you to review. Nothing changes until you merge it.");
    const back = f.backFrom ? ` You approved a fix for this on ${f.backFrom.slice(0, 10)}, the checks stopped seeing it, and now it is broken again.` : "";
    const summary = `${t?.summary || plainFallback(f.raw)}${back} Seen ${f.row.count} time${f.row.count === 1 ? "" : "s"}. ${tail}`;
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
    // The SEO and GEO agents use this too; their Fix rows are in the Sheet, not on the admin page.
    const where = isAdminTeam(ctx.def.team) ? "- Open the Agents tab and look at the Fix card." : "- Open its row in the SwiftCard Leads sheet and set Status to Approved to get the fix.";
    await sendOwnerDigest(`Urgent: ${critical.length} serious problem${critical.length > 1 ? "s" : ""} on the site`, reportHtml(["What happened", ...critical.map((c) => `- ${c.replace(/\n/g, " ")}`), "", "What I need from you", where].join("\n"), ctx.def.team));
  }
  return { fresh: fresh.length, proposed };
}

/** The finding this problem was stored under before (an alias), preferring one that already had a card. */
async function carriedOver(ctx: AgentContext, aliases: string[]): Promise<Finding | null> {
  let best: Finding | null = null;
  for (const fp of aliases.slice(0, 40)) {
    const f = await ctx.store.getFinding(fp);
    if (!f) continue;
    if (f.approval_id && f.status !== "fixed") return f;
    if (!best || (f.approval_id && !best.approval_id)) best = f;
  }
  return best;
}

/**
 * Findings this agent raised that are no longer seen: mark them fixed.
 * `quietMs`: how long a finding must have gone unseen first, so one run that
 * happened to pass (a flaky check) doesn't call it fixed and then raise it
 * again the next time it fails.
 */
export async function closeMissing(ctx: AgentContext, source: string, present: Set<string>, opts?: { quietMs?: number }): Promise<number> {
  let n = 0;
  const cutoff = ctx.now().getTime() - (opts?.quietMs ?? 0);
  for (const f of await ctx.store.listFindings(["open", "proposed"], 500)) {
    if (f.agent_id === ctx.def.id && f.source === source && !present.has(f.fingerprint) && new Date(f.last_seen).getTime() <= cutoff) {
      await ctx.store.patchFinding(f.id, { status: "fixed" });
      n++;
    }
  }
  if (n) ctx.stat("findings_cleared", n);
  return n;
}
