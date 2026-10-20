import type { AgentDef } from "../agent-def";

// Listed so the plan stays visible in the Agents tab, but locked: the meeting
// said this one comes later.
export const scanCostWatch: AgentDef = {
  id: "watch-scan-cost",
  name: "Scan cost watch (later)",
  team: "watchdog",
  role: "worker",
  tier: "sonnet",
  schedule: { kind: "every", minutes: 1440 },
  dailyUsd: 0,
  needs: [],
  maxPending: 1,
  purpose: "Will watch for abuse of the business-card scanner, which costs us money per scan.",
  locked: "Deferred: the meeting said this comes later.",
  async run() {
    return { summary: "Deferred.", status: "skipped" };
  },
};
