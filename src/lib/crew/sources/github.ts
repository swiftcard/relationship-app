import { env } from "../env";

// Starts one of this repo's own workflows (workflow_dispatch). Used for the
// social manager's image renders, which publish nothing: they draw PNGs and
// store them for the owner to look at.
export const REPO = "swiftcard/relationship-app";

export function githubConfigured(): boolean {
  return !!env("CREW_GITHUB_TOKEN");
}

export async function dispatchWorkflow(file: string, inputs: Record<string, string>): Promise<boolean> {
  const token = env("CREW_GITHUB_TOKEN");
  if (!token) return false;
  const res = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/${file}/dispatches`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "Content-Type": "application/json" },
    body: JSON.stringify({ ref: "main", inputs }),
    signal: AbortSignal.timeout(15_000),
  });
  return res.status === 204;
}
