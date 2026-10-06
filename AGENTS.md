<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Ship a user-facing change → update the knowledge base

`src/lib/knowledge/` is what the support assistants know. Both the in-app helper
and the marketing sales chat answer **only** from it, so a feature that isn't in
there is a feature the product cannot explain to the person using it.

**Whenever you change what a user sees or does, update `src/lib/knowledge/docs/`
in the same commit.** That means: a new page or tab, a renamed button, a moved
menu item, a flow that gains or loses a step, a feature that changes plan, a
capability added or removed.

You do **not** need to touch it for prices, plan limits, card templates, or CRM
providers — `src/lib/knowledge/derived.ts` reads those from `plan.ts`,
`plan-content.ts`, `template-style-presets.ts` and `crm-connection.ts` at
request time, so they update themselves.

Guardrails that will catch you:

- `tests/knowledge-truth.test.ts` fails if a new page route has no coverage, if a
  doc points at a page that doesn't exist, or if a doc hardcodes a price or limit
  that belongs in `plan.ts`.
- `npm run kb:check` lists every user-facing file changed since the knowledge
  base was last touched — run it when the assistant starts sounding out of date.
- Anything marked `commerce: true` must carry a `nativeAnswer` with no pricing,
  upgrade, billing, or website language. The iOS shell is forbidden from selling,
  and the type system enforces the pairing.

Write docs the way a support agent talks: the exact label on the button, the real
path through the menus, and the thing users get wrong.

# Before you change something that already works

Four checks exist, and they see different things. Knowing which one covers your
change is the difference between shipping a fix and shipping a regression.

| Check | Command | Sees |
|---|---|---|
| Types + lint + logic | `npx tsc --noEmit`, `npx eslint`, `npm test` | ~2700 source-invariant and logic tests. Runs in CI on every push. |
| Real layout | `npm run test:render` | Renders in headless Chromium with the app's real Tailwind and **measures**. Runs in CI (`render` job). |
| Every screen, both widths | `npm run qa:sweep` | Loads every page logged-out / Free / Pro at 390px and 1280px: JS errors, 4xx/5xx, overflow, covered controls, broken images, dead links. |
| The app actually used | `npm run qa:flows` | Drives it: save → reload persistence, double-submit, validation, sign-out, back/forward, empty account, mobile tabs. |

The last two seed their own throwaway accounts against the real Supabase project
and delete them in a `finally` block. They need `.env.local`, so they are
developer/pre-release tools, not CI steps. Point them at a production build
(`npx next build && npx next start -p 3222`, then `BASE=http://localhost:3222`) —
`next dev`'s indicator sits on top of the bottom-left tab and the dev overlay
covers footer links, and both look exactly like product defects.

**A source scan cannot see layout, and neither can a type.** If your change moves
a pixel, run `test:render`. If it changes what a button does, run `qa:flows`.

## The rules that came from real bugs

- **A credential must never be able to reach a URL.** Any `<form>` holding a
  password carries `method="post"`. `onSubmit` + `preventDefault` is not enough:
  before React hydrates there is no handler, so a submit takes the HTML default,
  and without a method that default is GET — which put a real password in the
  query string, the browser history and the access log. Pinned by
  `tests/credentials-never-in-url.test.ts`.

- **Everything is interactive before it is hydrated.** A form, a tab, a toggle
  all accept input between first paint and hydration, when no handler is
  attached. When that gap can lose data or leak it, close it in the markup —
  something that works with no JavaScript at all — not in an effect.

- **Only warm what you can actually reach.** `warmSharePreview` is same-origin
  only: a cross-origin fetch can never read the og:image through CORS, so the
  request is guaranteed useless. It also had dev boxes and preview deploys
  fetching real production card pages on every marketing page load. Local work
  must not generate production traffic.

- **Before editing a shared component, list its consumers and check them after.**
  `ShareButton`, `CardScaler`, `PlanGate`, `SettingsShell` and the card templates
  each have many; a change that looks local is not.

- **Several sessions edit this worktree at once.** Stage explicit paths. Never
  `git add -A` or `git commit -a` — you will commit someone else's half-finished
  feature. `git status` before and after.

# The guards that are always on (do not switch one off)

The owner has had the same things fixed more than once — a bug that came back,
the site getting slow, analytics or notifications glitching. Four things now
watch production continuously; `tests/monitoring-wiring.test.ts` fails if any
of them is removed or quietly weakened.

| Guard | Runs | What it catches |
|---|---|---|
| `.github/workflows/uptime.yml` → `scripts/health-check.mjs` | every 15 min | outage, blank card, expired Apple secret, **speed budget** (median full-response time per key route, DB latency) |
| `.github/workflows/nightly-qa.yml` | nightly 05:00 NY + after every production deploy | real Chromium against production: flows, every screen at both widths for Free/Pro/Office, Office admin + member, **analytics and notifications end to end** (`scripts/qa-prod-probe.mjs`), **real cards' link previews: name, logo and photo actually in the picture** (`scripts/qa-share-preview.mjs`) |
| `.github/workflows/deploy-watchdog.yml` | on every deploy | error-rate spike → automatic rollback (needs the Sentry secrets) |
| `ci.yml` + the tripwire tests (`one-notification-per-visit`, `view-visit-window`, `analytics-*`, `trial-eligibility`, `proxy-auth-hop`) | every push | the recurring bugs, pinned at source |
| `.githooks/pre-push` (installed by `npm install` via `scripts/install-hooks.mjs`) | before every push leaves the machine | a type or lint error reaching `main`. CI was red for 26 pushes in Sept 2026 over one lint error nobody saw, and while red its Test job never ran. Pinned by `tests/push-guard.test.ts`. |
| `.gitattributes` (`* text=auto eol=lf`) | every checkout | CRLF working copies. ~600 tests read source as strings; with `core.autocrlf=true` they failed locally and passed in CI, so red stopped meaning anything. Pinned by `tests/line-endings.test.ts`. |

**A red CI run is a page, not a colour.** Read the failing step before pushing
anything else — a red Lint step hides the Test step behind it.

Both workflows keep ONE issue open while something is wrong (labels `uptime`,
`nightly-qa`) and close it when it passes; GitHub emails the owner on open.
`paint-check.yml` does the same for invisible content (one 🫥 issue, closed
the first deploy the sweep passes).
Every QA script reads secrets from the environment first and `.env.local`
second, which is what lets CI run them — keep it that way.
