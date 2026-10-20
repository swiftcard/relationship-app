import type { CrewStore } from "../store";
import type { Approval, ApprovalKind } from "../types";
import { publishBlogPost } from "./blog-post";

// ── The outward actions, behind the Approve button ──────────────────────────
// Imported ONLY by src/lib/crew/decide.ts (pinned by tests/crew-approval-gate).
// No agent run can reach these: an agent proposes, a person approves, and only
// then does one of these run. Everything else an agent drafts (replies, DMs,
// comments) is posted by a person by hand, so it has no executor at all.

export type ExecResult = { ok: boolean; message: string; result?: Record<string, unknown> };

export const EXECUTED_KINDS: ApprovalKind[] = ["blog_post"];

export async function executeApproval(store: CrewStore, a: Approval): Promise<ExecResult> {
  if (a.status !== "approved") return { ok: false, message: "Not approved." };
  switch (a.kind) {
    case "blog_post":
      return publishBlogPost(a);
    default:
      return { ok: false, message: `Nothing runs automatically for ${a.kind}.` };
  }
}
