# SwiftCard Agent Flow — marketing & monitoring agents

Twenty-six agents in four teams, run from GitHub Actions, controlled from
**Admin → Website → Agent Flow** (swiftcard.me/admin/agent-flow,
hello@swiftcard.me only). Nothing goes out on its own: every agent hands you
two finished options, you pick one, and that one posts.

## The brain (lib/brain.mjs) — owner order 2026-09-08

Every LLM agent works the same way:

1. **Role research → playbook.** Once a week the agent researches how its
   job is best done right now (how often to post, what works, what to avoid)
   and writes an `agent_playbooks` row. The playbook sets the agent's own
   working rhythm (`agent_settings.schedule`, `schedule_source = 'playbook'`).
   A rhythm you set by hand in Settings (`'owner'`) is never overridden.
2. **Today's research.** Each run the agent researches exactly what to make
   today — what people are asking, what changed, what competitors did (Cleo's
   intel), what other agents asked for (`agent_requests`) — and never repeats
   recent work.
3. **Two options, both finished.** Every piece of work is queued as ONE
   `choice` item carrying option A and option B, each complete and swaying
   the reader towards SwiftCard. Person-facing copy goes through the AI-tell
   filter first; a robotic option is dropped, not queued.
   **Personal, not generic** (owner order 2026-09-08): an agent that writes
   to ONE person — Zoe (Reddit), Wes (forums), Leo (Instagram bios), Ava,
   Ivy, Kai, Remy, Sam — must name the `personal_hook`, the verbatim detail
   from that person's post/bio/review the draft hinges on, and the draft must
   actually use it (`isPersonal`). No hook, or a draft that never touches it,
   is dropped like an AI tell. Nora's posts are held to the same bar: no
   generic titles, a real number / verified price / trade scene in every post.
4. **You pick, it goes.** In the Queue you press **Pick A** or **Pick B**
   (or Neither). The item becomes that option and takes the same road as
   Approve: a connected platform posts it, a blog post goes live, everything
   else lands in Approved with a Copy button.

**Hand-offs**: agents file requests to each other (`fileRequest`). Milo asks
Vince for a video; Nora asks Vince for a hero image; Sol asks Ruby for a page
fix. The receiving agent answers the request in its next run and the answer
carries the `request_id`.

Schema for all of it: `supabase/agent-brain.sql` (run once, after
`agent-flow.sql`). Until it has been run, agents skip role research (no
tokens spent, the run says so in its notes) and work from their briefs. An
agent added to `config.json` after the seed gets its `agent_settings` row
created automatically — by the tab on first load and by the runner on first
run — starting rested, so a new agent is never invisible or uncontrollable.

## The Radar (lib/radar.mjs) — owner order 2026-09-30

"All our agents and bots work for us in terms of marketing when we scan
Reddit, Telegram and all relevant websites." The Radar is the listening
layer: **code** scans public feeds every 15 minutes inside the always-on
watchdog loop (no tokens), files every relevant post as a *signal*
(`agent_radar_signals`), routes it to the agent whose thread it is, and
wakes that agent (trigger `radar`). The agent reads the actual thread and
hands the owner two finished replies, as always. **The Radar only reads —
it never posts, replies, joins or DMs anywhere.**

| Source | How | Needs |
|---|---|---|
| Reddit | the public Atom feeds — one multireddit feed for all watched subreddits, keyword searches taking turns, paced by Reddit's rate-limit headers | nothing. Reddit ended self-serve API keys in Nov 2025 (apps now need a reviewed Data Access Request); `REDDIT_CLIENT_ID/SECRET` are used only if they ever exist |
| Telegram | public channel previews (`t.me/s/<channel>`) + every group a SwiftCard bot is in (`getUpdates`) | `TELEGRAM_BOT_TOKEN` for groups (bot privacy mode OFF, bot added to the group); channels need nothing |
| Hacker News | Algolia search API | nothing |
| News / RSS | Google News + Bing News queries by default; any RSS/Atom feed | nothing |
| App Store | competitors' newest reviews (public RSS); 1–2★ = the billing/cancel complaints that are our wedge | nothing (uses `agent_competitors.app_store`) |
| YouTube | fresh videos on the topic → creators for Ivy | `YOUTUBE_API_KEY` |

Routing: brand mention → Zoe (`mentions`); question / recommendation on
Reddit → Zoe, elsewhere → Wes (`forums`); competitor + complaint word → Ava
(`outreach`); news → Piper (`pr`); YouTube → Ivy (`influencer`); neutral
competitor chatter and App Store complaints → Cleo as read-only intel
(`chatterBlock`). Each listening agent gets a `LIVE RADAR SIGNALS` block at
the top of its prompt and returns the signal's id in `signal_id`; the owner's
Pick/Neither on the reply marks the signal handled/dismissed.

Owner surface: **Agent Flow → 📡 Radar** (signals, sources, Scan now, wake
an agent on its signals) and **Settings → Radar** (keywords, subreddits,
Telegram channels, feeds, complaint words, add/remove sources). Schema:
`supabase/agent-radar.sql`. Tests: `tests/agent-radar.test.ts` (parsers,
classifier, routing, and the no-LLM / no-posting pins).

## The company (org.json)

Every agent is a named employee; `org.json` is the single org chart the tab,
the API routes, and the runners all read:

- **🧠 Atlas — Chief of Staff** (the `manager` agent) — runs the company,
  reports only to the owner.
- **📣 Maya — Marketing Lead** (what we publish): Jake (SEO pages), Nora
  (Blog), Milo (Social), Vince (Video & UGC for Higgsfield), Eli (Email &
  Newsletter), Addy (Paid Ads — never spends), Ruby (Conversion / site
  copy), Cleo (Competitor Watch — Blinq, HiHello, Popl, Linq… and finds
  new ones).
- **🚀 Sasha — Growth & Outreach Lead** (who we talk to): Ava (Outreach
  Scout), Leo (Link-in-bio Prospecting — Linktree/LinkMe/HiHello in
  Instagram bios), Remy (Industry Outreach — realtors, plumbers, brokers…),
  Zoe (Reddit Conversations), Wes (Forums & Q&A), Ivy (Influencer Scout),
  Kai (Partnerships), Quinn (Directories & Listings).
- **💛 Nina — Customer Success Lead** (who we keep): Sam (Reviews &
  Reputation), Sol (Help Content), Otto (Retention & Onboarding).
- **🛠️ Rex — Engineering Lead**: Dash (Performance), Finn (Flow Check),
  Vera (Security), Bo (Bug Watch) — the four continuous watchdogs.

Leads are message parties + chart nodes, not runnable agents — the runnable
ids live in `agent_settings`/`config.json`.

**Comms** (`agent_messages`, service-role only): the company chat log. Rows
are written only at real lifecycle moments — the owner's orders (Start/Pause/
Run/queue decisions), the dispatch (`Maya → Jake: GO`), the acknowledgment
(`Jake → Maya: On it`), the report-back (`Done — 4 item(s) queued, $0.40`),
failure escalations (`Maya → Atlas`), and cap alerts (`Atlas → owner`). A
comms write failure never fails a run (best-effort `say()`), and `say()`'s
only write surface is `agent_messages`. The **Org chart** tab renders
org.json live: blue pulse = working, red = problem, gray = benched; the
reporting line animates while a worker runs.

## The group chat (Chat tab) — owner order 2026-09-08

One thread the owner and every agent are on. The owner types
`@Jake what are you working on?`, `@Rex the login page is broken — fix it`,
`@marketing report back on this week` or `@everyone …`; each person mentioned
takes a **turn** and answers in the thread. No `@` at all → Atlas takes it.

- **Schema**: `supabase/agent-chat.sql` — `agent_chat` (message | reply |
  system lines) + `agent_chat_orders` (one row per mentioned responder:
  waiting → working → done | failed). Service-role only, like every agent table.
- **Who can be mentioned** (`src/lib/agent-chat.ts`, from org.json): any
  worker or Atlas by first name / party id / agent_id, any lead by name
  (leads take turns too — no `agent_settings` row needed), a team by handle
  (`@marketing @growth @success @engineering`) which fans out to that lead's
  workers, and `@everyone` / `@all` = every agent with an agent_id. A trailing
  `'s` is forgiven; unknown names are called out by a system line.
- **A turn is a run**: `POST /api/admin/agents/chat` writes the owner message +
  orders, then dispatches `agent-chat.yml` once per responder (needs
  `GITHUB_AGENTS_TOKEN`, same as the Run buttons). `chat-turn.mjs` starts a
  `Run` with trigger `chat` — a *direct* run: it skips the enabled/paused/
  auto-stop gates (the owner is talking to them) but still respects the
  monthly and per-run token caps, and it never counts as a scheduled run for
  the scheduler/watchdog. `@everyone` = 24 runs; the composer warns.
- **What a turn can do**: reply (always); queue items as two options like any
  run (`items`); file a help request to the colleague the closed `CAN_REQUEST`
  map allows; **delegate** (Atlas → anyone, a lead → only their own team,
  workers → nobody — the delegation is itself a chat message + order, so the
  colleague takes a turn); **fix** (only Dash, Vera, Finn, Bo, Ruby, Jake → a
  queue item + the Fixer's DRAFT PR, never merged); **run_now** (its own full
  workflow). Everything else is the usual draft-only rule: WebSearch/WebFetch
  only, the only write surface is `agent_*`.
- **Memory**: `ownerChatBlock()` in the brain puts the last two weeks of chat
  orders addressed to an agent into its scheduled runs, so "from now on, …" in
  chat sticks.
- **Stuck turns**: the watchdog's `sweepChatOrders()` re-dispatches orders
  still waiting after 3 min / working after 25 min and fails them (with a
  system line in the thread) after an hour. Comms gets a one-line
  `💬 Chat → …` record of every order; the agent's own "Saw your message" /
  "Replied to you in Chat" lines are the run's lifecycle comms.

## Autonomous vs draft-only

| Agent | Acts on | Mode |
|---|---|---|
| 1 Outreach Scout | Reddit/LinkedIn/FB/IG/X | **Draft-only** — finds + writes; you send |
| 2 Link-in-bio Prospects | Instagram (public data) | **Draft-only** — CSV you work by hand |
| 3 SEO | swiftcard.me | Autonomous checks + report (site work already ships in the app) |
| 4 Blog Writer | swiftcard.me/blog | Writes autonomously; **publishes only via your Publish button** (draft mode default; flip `blog.publish_mode` to "auto" in config.json later) |
| 5 Social Content | — | **Draft-only** — scripts/captions for Higgsfield + Buffer/Later |
| 6 Mentions Monitor | Reddit/Quora/forums | **Draft-only** — replies with disclosure; you post |
| 7 Influencer Scout | IG/TikTok/YT/X | **Draft-only** — DM drafts, commission-only pitch |
| Vince Video | Higgsfield | **Draft-only** — prompts/scripts; a picked script is submitted to Higgsfield when connected |
| Eli Email | your ESP | **Draft-only** — subject/preheader/body; you send |
| Ruby CRO | swiftcard.me | **Draft-only** — one page change at a time (never prices); Rex's Fixer or you apply it |
| Cleo Competitors | competitor sites + App Store | **Autonomous checks** (hash diff, no tokens when quiet) → two-option response per real change; Monday sweep finds new competitors |
| Remy / Wes / Kai / Quinn | email, forums, partners, directories | **Draft-only** — copy flow |
| Sam / Sol / Otto | reviews, help content, lifecycle messages | **Draft-only** — copy flow |
| 8 Bug Watch | this repo | Autonomous **draft PRs** (the existing `sentry-triage.yml`); never merges. Auto-rollback = existing `deploy-watchdog.yml`, the one fully-autonomous action |
| 9 Security Watch | repo + live site | Autonomous scans → findings queue; CRITICAL emails immediately; never patches |
| 10 Manager | agent tables (+ read-only product counts) | Compiles + emails the digest |

Draft-only is **structural**: the LLM gets only WebSearch/WebFetch (no Bash, no
git, no platform APIs), and the runner's sole write is our own `agent_*`
tables. Pinned by `tests/agent-flow.test.ts`.

## Setup — one command

```
node scripts/agent-flow-setup.mjs
```

That's it. The script applies the schema (Supabase Management API), verifies
the tables, sets the GitHub Actions secrets (`SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY`, a freshly minted `AGENT_RELAY_SECRET`), adds the
Vercel env vars the tab needs (`GITHUB_AGENTS_TOKEN` from your gh CLI,
`AGENT_RELAY_SECRET`), and triggers a redeploy. Idempotent — safe to re-run.

Emails need no key in Actions: agents relay through `/api/agent-email`, which
holds the app's own Resend key server-side and can only ever mail the digest
address (Bug Watch still uses the `SENTRY_*` secrets — MONITORING.md).

**One optional secret remains yours:** the LLM key for the research/blog
agents — `gh secret set CLAUDE_CODE_OAUTH_TOKEN` (from `claude setup-token`,
runs on your Max plan) **or** `gh secret set ANTHROPIC_API_KEY` (API billing).
SEO, Security and Manager run with no LLM at all, so the system works today
without it.

**External accounts, only when you want that agent:** Sentry (Agent 8 — steps in MONITORING.md) · Higgsfield (API key) · X / Facebook+Instagram / YouTube / LinkedIn (one-click Connect in Settings — see Approve-to-execute below) · Snyk optional (npm audit + Dependabot cover v1) · Google Search Console (already verified, sitemap submitted).

## Claude Max vs API credits

GitHub Actions can use **either**:
- `CLAUDE_CODE_OAUTH_TOKEN` — run `claude setup-token` locally, paste the token.
  Runs on your **Max subscription** (no separate bill, but shares your plan's
  limits — the caps below exist to protect your own dev headroom).
- `ANTHROPIC_API_KEY` — separate pay-per-use API billing (the repo's existing
  sentry-triage already uses this name).
Set one (or both — API key wins for triage, either works for agents).

## Approve-to-execute (Connections)

Approve is the send button. When a platform is connected (Vercel env vars),
approving a pending item executes it immediately **as the owner**:

**Connecting an account (2026-09-28):** Agent Flow → Settings → Connections →
**Connect**. The platform's own consent screen runs, and the tokens land
encrypted in `agent_connections` (run `supabase/agent-connections.sql` once).
The only env vars are the platform *apps* (client id + secret); the owner
never pastes a token again. X and Google tokens refresh themselves; Meta page
tokens don't expire; LinkedIn's 60-day member token shows its expiry date on
the panel.

| Connector | Fires on | Needs |
|---|---|---|
| X | `social_post`/`generic` with platform `x` → posts as the connected account (≤280 chars) | `X_CLIENT_ID` + `X_CLIENT_SECRET` (console.x.com app, OAuth 2.0, callback `/api/admin/connect/x/callback`), then Connect |
| Facebook | platform `facebook` → text/link post, or photo/video when the item carries a ready asset | `META_APP_ID` + `META_APP_SECRET` (Business app, Facebook Login, callback `/api/admin/connect/meta/callback`), then Connect with the Page admin login. Optional `META_PAGE_ID` picks among several Pages |
| Instagram | platform `instagram` → picture or reel from the creative pool (`payload.asset_id`); no text-only posts exist | same Meta connection; the IG Business account must be linked to the Page |
| YouTube | platform `youtube` → resumable upload of the pool video; title from `payload.title`, description = content | `YOUTUBE_CLIENT_ID/SECRET` (OAuth client in a project under the hello@swiftcard.me Workspace so the consent screen is Internal; falls back to `GOOGLE_CLIENT_ID/SECRET`) + YouTube Data API enabled + callback `/api/admin/connect/youtube/callback` in the Google Cloud client, then Connect. Unaudited API projects get every upload forced PRIVATE |
| LinkedIn | platform `linkedin` (`social_post`/`generic`/`video_script`/`blog_post`) → posts as the **SwiftCard Page** via `/rest/posts` | Connect (self-serve) stores the person; posting as the Page needs the Community Management API (`LINKEDIN_AGENT_SCOPES="openid profile w_member_social w_organization_social r_organization_admin"` once granted). Person-only connections are HELD unless `LINKEDIN_ALLOW_MEMBER_POSTS=1`. Legacy env fallback: `LINKEDIN_ACCESS_TOKEN` + `LINKEDIN_AUTHOR_URN` |
| Higgsfield | `video_script`/`image_brief` items → submits the prompt as a generation job (lands in the creative pool) | `HIGGSFIELD_API_KEY_ID` + `HIGGSFIELD_API_KEY_SECRET` (+ optional `HIGGSFIELD_ENDPOINT`) |
| Reddit | `reply_draft`/`outreach_draft` with platform `reddit` + a thread URL → posts the reply | `REDDIT_CLIENT_ID/SECRET/USERNAME/PASSWORD` (script app) — advised against, see policy note in agent-execute.ts |

Executed items get status `posted` (with the live URL on the card); a failed
execution falls back to `approved` + the classic Copy flow, never lost. The
contract (pinned in tests): the posting code lives ONLY in
`src/lib/agent-execute.ts`, is reachable ONLY from the admin items route
behind `requireAdmin`, and fires ONLY on the owner's Approve of a pending
item — agents remain structurally unable to post. TikTok (its API forbids
tools that post to your own account) and Nextdoor/Facebook groups stay
Approve & Copy.

## Using the tab

- **Start All** dispatches every enabled agent (manager excluded — run it last).
- **Pause All** sets a DB flag every agent re-reads between steps. Takes effect
  at the **next checkpoint**: instantly between items, worst case one in-flight
  LLM call (~1–3 min). Finished items stay; nothing is half-written; the run is
  marked `paused` with a summary of what it completed.
- **Queue**: every brain item shows A and B side by side — **Pick A / Pick
  B** (copies the text to your clipboard for copy-flow kinds) or **Neither**.
  Two-option items are never bulk-approved. Filter by agent/type; prospects
  export as CSV; a picked blog post goes live at once.
- **Settings**: enable/disable, per-run item + token caps, monthly system cap
  (agents refuse to start past it and email you), and each agent's rhythm.
  The rhythm line says where it came from: the agent's playbook (violet) or
  your hand (amber — never overridden). The playbook itself is readable under
  each agent in the log.
- **History**: every approve/edit/reject + outcomes (Mark sent → Got a reply →
  Converted) so you can see which agents earn their keep.

## Usage estimate (defaults)

Research agents ~$0.30–1.50/run · blog ~$1–3 · seo/security/manager ~$0 (no
LLM) · **full Start-All session ≈ $3–8**, hard-capped per-run and at
$25/month system-wide.

## 20-minute review routine

1. Digest email (2 min): criticals first, failed agents, pending count.
2. Tab → Queue → security findings → Acknowledge/act (3 min).
3. Blog post: skim, Publish or Edit (4 min).
4. Bulk-select outreach/reply drafts; Approve & Copy the good ones into the
   platforms as you go; Reject the rest (8 min).
5. Prospects: Download CSV for the VA; Mark contacted as worked (2 min).
6. Video scripts: Copy to Higgsfield the one you'll shoot (1 min).

## The always-watching stack (speed + stability)

| Watcher | Cadence | What it does | Armed? |
|---|---|---|---|
| uptime.yml | every 15 min | Site down → one GitHub issue → email; recovery closes it | ✅ always |
| deploy-watchdog | every prod deploy | Real error spike after a deploy → rolls production back to the last good build | ✅ runs; needs Sentry to detect spikes |
| **Performance Watch** | **every 4 h** | Times the critical routes vs its own rolling baseline; flags regressions; critical route down/crawling → immediate email | ✅ armed |
| **Flow Check (Finn)** | owner-set rhythm | Read-only end-to-end user-journey contracts: OAuth legs redirect correctly with the right params, auth walls hold, the builder still offers its controls, sitemap URLs resolve. Catches the no-error dead-end class (the LinkedIn headshot bug). Criticals email immediately; findings dispatch the Fixer | ✅ armed |
| Security Watch | daily 9 AM ET | npm vulns, committed secrets, live headers; criticals email immediately | ✅ armed |
| Bug Watch (sentry-triage) | daily 6:15 UTC | New production errors → one draft PR per issue | ⚠ dormant until Sentry is armed |

**The one hole only you can close — Sentry (≈5 min, then errors are watched
24/7 and bad deploys auto-roll back):** create the project at sentry.io (Next.js,
name `swiftcard`) → copy the DSN → Vercel env `NEXT_PUBLIC_SENTRY_DSN` (+
`SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN` per MONITORING.md §1) →
same three as GitHub secrets. Everything downstream is already built, scrubbed
for PII, and tested.

## When something is found, who fixes it?

The loop closes itself to the last safe inch:

1. A watcher finds an issue → its report lands in the queue.
2. The **Fixer** is dispatched automatically (SEO + Performance findings): it
   writes the minimal code fix, verifies types + the full test suite, and
   opens a **draft PR** — linked on the queue item as "View PR".
3. **Your entire job is one Merge click.** Merging deploys the fix. That click
   stays human on purpose — auto-deploying unreviewed AI code to production is
   the one line this system never crosses (your own spec's rule, and the
   right one).

Clean runs cost you nothing at all: an all-clear report **files itself as
read** — it never sits in your pending queue. Security/dependency findings
stay human-first (their fixes touch package.json and policy, exactly what the
Fixer is forbidden to edit). The Fixer runs on the same LLM key as the
research agents — until that key is set, findings still queue normally and
the Fixer stands down.

## The little things, answered

- **Usage runs out while agents are working?** They stop at the next safe
  checkpoint (finished items kept), the run says why, and you get an email —
  the monthly cap is re-checked mid-run, so parallel agents can't blow past it.
- **You press Pause All?** Nothing new starts; in-flight agents stop at their
  next checkpoint (seconds, worst-case one AI call ≈1–3 min); a session
  summary of everything done today is written to the queue at that instant.
- **Acknowledge / Reject?** Status changes, a toast says what happened, and
  the item lives forever in History — nothing is deleted, nothing is sent.
- **Refresh?** Instant re-pull, with an "updated Xs ago" stamp; the page also
  refreshes itself every 30 seconds.
- **The checkboxes?** Batch mode: tick several (or "Select all shown") and a
  bar appears to approve/reject them all at once. Approve = "good, mine to
  use"; it never sends anything.
- **Auto-stop (work hours):** the ⏰ control arms a clock-out ("at 5 PM ET" /
  "in 3 hours"). Reached, the whole system holds like Pause All until Resume.
- **Will outreach sound like AI?** Three layers say no: every person-facing
  agent writes under `HUMAN_VOICE.md` (the banned-tells doctrine), runs a
  mandatory self-check, and the runner HARD-DISCARDS any draft containing an
  AI-tell phrase before it can reach the queue — the run summary reports every
  discard.
- **Lost?** The ✦ Take a tour button walks every control, live on the page.

## Boundaries honored

No product code or user data is touched by any agent: their write surface is
the `agent_*` tables (plus draft PRs on branches for Bug Watch). The blog and
this admin tab are the only app additions, both additive. Sentry
instrumentation already existed (`src/instrumentation*.ts`, PII-scrubbed,
release-tracked) — nothing product-side was modified for this system.
