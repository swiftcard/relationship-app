import type { CrewStore } from "../store";
import type { Approval, ApprovalKind } from "../types";
import { logActivity } from "../sheets/activity";
import { approvalKey } from "../sheets/keys";
import { publishBlogPost } from "./blog-post";
import { blueskyConfigured } from "../env";
import { postBlueskyReply } from "./bluesky-reply";
import { dispatchCodeFix } from "./code-fix";

// ── The outward actions, behind the Approve button ──────────────────────────
// Imported ONLY by src/lib/crew/decide.ts (pinned by tests/crew-guards).
// No agent run can reach these: an agent proposes, a person approves, and only
// then does one of these run. Everything else an agent drafts (replies, DMs,
// comments) is posted by a person by hand, so it has no executor at all.
//
// Dry run (Controls → "Dry run", on by default): anything that would reach
// the public (a blog post, a Bluesky reply) is simulated and logged instead.
// A code fix only opens a pull request for a person to review, so it runs
// in dry run too.

export type ExecResult = { ok: boolean; message: string; result?: Record<string, unknown>; simulated?: boolean };

export const EXECUTED_KINDS: ApprovalKind[] = ["blog_post", "code_fix"];

/** Public-facing kinds that dry run holds back. */
export const PUBLIC_KINDS: ApprovalKind[] = ["blog_post", "reply", "comment", "post"];

/** A reply the backend may post itself: Bluesky, when the owner set its tier to "Approval posts it". */
export function tier2Executable(a: Pick<Approval, "kind" | "platform">, controls: Record<string, unknown>): boolean {
  return a.kind === "reply" && a.platform === "bluesky" && controls["tier:bluesky"] === "Approval posts it" && blueskyConfigured();
}

export async function executeApproval(store: CrewStore, a: Approval, by = "owner"): Promise<ExecResult> {
  if (a.status !== "approved") return { ok: false, message: "Not approved." };
  const controls = await store.getControls().catch(() => ({ dry_run: true }) as Record<string, unknown>);
  const dry = controls.dry_run !== false;
  const log = (r: ExecResult, action: string) =>
    logActivity(store, { agent_id: a.agent_id, platform: a.platform, action, target: a.target_url ?? (a.meta?.slug ? `/blog/${a.meta.slug}` : null), message: a.body, result: r.simulated ? "simulated" : r.ok ? "ok" : "failed", error: r.ok ? null : r.message, row_key: approvalKey(a.id), approved_by: by, simulated: !!r.simulated });

  if (dry && PUBLIC_KINDS.includes(a.kind)) {
    const r: ExecResult = { ok: true, simulated: true, message: "Dry run is on (Controls tab), so this was simulated, not published. Turn Dry run off to publish on Approve." };
    await log(r, a.kind === "blog_post" ? "publish" : "post");
    return r;
  }
  let r: ExecResult;
  switch (a.kind) {
    case "blog_post":
      r = await publishBlogPost(a);
      await log(r, "publish");
      return r;
    case "code_fix":
      r = await dispatchCodeFix(a);
      await log(r, "fix");
      return r;
    case "reply":
      if (tier2Executable(a, controls)) {
        r = await postBlueskyReply(a);
        await log(r, "post");
        return r;
      }
      return { ok: false, message: `Nothing runs automatically for ${a.kind} on ${a.platform ?? "this platform"}.` };
    default:
      return { ok: false, message: `Nothing runs automatically for ${a.kind}.` };
  }
}
