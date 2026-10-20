import type { AgentContext } from "./context";
import { applyDisclosure, hasRequiredDisclosure } from "./disclosure";
import { everContacted, personFor } from "./ledger";
import type { ApprovalKind, DebateRecord, Platform } from "./types";
import { stripEmDashes } from "./voice";

// ── Putting something in the owner's inbox ──────────────────────────────────
// The ONLY way an agent's work leaves the agent. propose() never posts, sends
// or merges anything: it writes a pending crew_approvals row. Before it does:
//   • backpressure: an agent with a full inbox stops drafting
//   • disclosure: anything that mentions SwiftCard carries the disclosure line
//   • the DM rule: a DM to anyone already replied to or contacted, by any
//     team on any platform, is refused (crew_claim_dm, atomic)
//   • one reply per thread (unique index on platform + url)

export const TEXT_KINDS: ApprovalKind[] = ["reply", "comment", "dm", "connect_note", "post"];
/** Drafts written as "a person who uses SwiftCard" carry the disclosure; posts
 *  from SwiftCard's own accounts are plainly from SwiftCard already. */
export const DISCLOSE_KINDS: ApprovalKind[] = ["reply", "comment", "dm", "connect_note"];
export const DM_KINDS: ApprovalKind[] = ["dm", "connect_note"];

export type Proposal = {
  kind: ApprovalKind;
  /** One line, plain: "Reddit: someone in r/realtors finds Linktree too pricey". */
  title: string;
  /** Fifth-grade words: what happened and what we need from you. */
  summary: string;
  body: string;
  platform?: Platform | null;
  targetUrl?: string | null;
  person?: { platform: Platform; handle: string; name?: string | null } | null;
  debate?: DebateRecord | null;
  meta?: Record<string, unknown>;
};

export type ProposeResult = { ok: true; id: string } | { ok: false; reason: string };

export async function inboxFull(ctx: AgentContext): Promise<boolean> {
  return (await ctx.store.countPending(ctx.def.id)) >= ctx.def.maxPending;
}

export async function propose(ctx: AgentContext, p: Proposal): Promise<ProposeResult> {
  if (await inboxFull(ctx)) {
    ctx.stat("skipped_inbox_full");
    return { ok: false, reason: "inbox full" };
  }

  let body = p.body;
  if (TEXT_KINDS.includes(p.kind)) body = stripEmDashes(body);
  if (DISCLOSE_KINDS.includes(p.kind)) {
    body = applyDisclosure(body, { on: ctx.settings.disclosure_on, disclosure: ctx.settings.disclosure });
    if (!hasRequiredDisclosure(body, { on: ctx.settings.disclosure_on, disclosure: ctx.settings.disclosure })) {
      return { ok: false, reason: "missing disclosure" };
    }
  }

  let personId: string | null = null;
  if (p.person) personId = await personFor(ctx.store, p.person.platform, p.person.handle, p.person.name);

  if (DM_KINDS.includes(p.kind)) {
    if (!personId) return { ok: false, reason: "a DM needs a person" };
    if (await everContacted(ctx.store, personId)) {
      ctx.stat("skipped_already_contacted");
      return { ok: false, reason: "already contacted" };
    }
  }

  const ins = await ctx.store.insertApproval({
    agent_id: ctx.def.id,
    team: ctx.def.team,
    kind: p.kind,
    title: p.title,
    summary: p.summary,
    body,
    platform: p.platform ?? p.person?.platform ?? null,
    target_url: p.targetUrl ?? null,
    person_id: personId,
    debate: p.debate ?? null,
    model_used: ctx.tier,
    meta: { ...(p.meta ?? {}), ...(ctx.tierWhy ? { tier_why: ctx.tierWhy } : {}) },
  });
  if ("conflict" in ins) {
    ctx.stat("skipped_thread_answered");
    return { ok: false, reason: "already answered that thread" };
  }

  if (DM_KINDS.includes(p.kind) && personId) {
    const won = await ctx.store.claimDm(personId, ins.id);
    if (!won) {
      await ctx.store.updateApproval(ins.id, { status: "expired", reject_reason: "already contacted (ledger)" });
      ctx.stat("skipped_already_contacted");
      return { ok: false, reason: "already contacted" };
    }
  }

  ctx.stat("proposed");
  return { ok: true, id: ins.id };
}
