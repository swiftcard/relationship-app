import { env } from "../env";
import type { Approval } from "../types";
import type { ExecResult } from "./index";

// Approved fix → .github/workflows/crew-fix.yml (workflow_dispatch). That
// workflow has an AI engineer (Claude Code) make the change on a new branch
// and open a PULL REQUEST. It never merges and never pushes to main: the
// owner merges, and the normal CI + Vercel Deployment Checks gate applies.
// The PR link comes back through /api/crew/ingest?source=fix.

import { REPO } from "../sources/github";

export { REPO };
export const FIX_WORKFLOW = "crew-fix.yml";
const MAX_BRIEF = 6000;

export async function dispatchCodeFix(a: Approval): Promise<ExecResult> {
  const token = env("CREW_GITHUB_TOKEN");
  if (!token) return { ok: false, message: "Approved, but CREW_GITHUB_TOKEN isn't set, so no fix was started. Add it and approve a new card." };
  const res = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/${FIX_WORKFLOW}/dispatches`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "Content-Type": "application/json" },
    body: JSON.stringify({
      ref: "main",
      inputs: { approval_id: a.id, title: a.title.slice(0, 200), brief: a.body.slice(0, MAX_BRIEF) },
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (res.status !== 204) return { ok: false, message: `GitHub refused to start the fix (HTTP ${res.status}).` };
  return { ok: true, message: "A fix is being written. The pull request link will appear on this card in a few minutes.", result: { dispatched: true } };
}
