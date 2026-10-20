# SwiftCard monitoring agents

On 2026-10-19 the admin **Agent Flow** tab and the marketing team behind it
(Atlas, Maya's eight, Sasha's, Nina's and Theo's agents, the Chat, Radar and
LinkedIn desk) were retired. What is left in this folder is the always-on
monitoring side, plus plumbing a future agent system can reuse.

## Still running

| Piece | Workflow | What it does |
|---|---|---|
| Watchdog loop | `agent-watchdog.yml` | Probes every minute (code only, no tokens) and wakes a monitor's workflow only on a real finding. Re-arms itself; stands down when `agent_system` is paused or `auto_pause_at` has passed. |
| Detectors | `lib/detectors*.mjs` | Finn (flow check), Bo (bugs), Vera (security), Dash (performance), plus the servicing bench: cards, links, payments, deliverability, renewals, deps, data, appstore, layout. |
| Fixer | `agent-fixer.yml` | Drafts a fix on an `agent-fix/*` branch for eligible findings. Never touches `main`. |
| Policy watch (Cody) | `agent-compliance.yml` | Hashes the policy pages SwiftCard depends on; an LLM reads only when one changes. |
| Scheduler | `agent-scheduler.yml` | Backstop clock; shares `lib/schedule.mjs` with the watchdog. |
| Weekly scorecard | `weekly-scorecard.yml` | `scorecard.mjs` emails the funnel, week over week. |
| Bug triage | `sentry-triage.yml` | New production errors become draft PRs. |

`uptime.yml`, `deploy-watchdog.yml`, `nightly-qa.yml` and `paint-check.yml` are
the other always-on guards (pinned by `tests/monitoring-wiring.test.ts`).

## Reusable plumbing

- `lib/agentkit.mjs`: Supabase REST helper, the email relay (`/api/agent-email`), run bookkeeping.
- `lib/brain.mjs`: playbooks, two-option queueing, the AI-tell filter.
- `lib/schedule.mjs`, `lib/probe.mjs`, `lib/insights.mjs`, `lib/media-pool.mjs`, `lib/radar.mjs`, `lib/chat.mjs`.
- `org.json`, `config.json`: who exists and which workflow runs them.
- `src/lib/agent-connections.ts` and `src/lib/agent-connect-oauth.ts`, with `/api/admin/connect/<provider>`: owner-only OAuth for Meta, X, YouTube, LinkedIn and Pinterest.
- `/api/agent-email`: the email relay (needs `AGENT_RELAY_SECRET`).

## Voice rules

`BRAND_VOICE.md` and `HUMAN_VOICE.md` are the writing rules for anything an
agent drafts for a person.

## Boundaries

Agents here write only to `agent_*` tables and send email through the relay.
No monitor posts, merges, or deploys. The Fixer opens draft PRs; a human merges.
