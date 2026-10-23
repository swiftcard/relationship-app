<!-- Approved 2026-10-20. Source of truth for the Crew agent system; later sessions resume from here. Build log at the bottom. -->
# SwiftCard Agent System ("Crew") — Plan

## Context
The old Agent Flow system was removed from `origin/main` in `d5b04741` and `98cf051b`. The meeting spec asks for a new multi-agent system:
- teams of Sonnet 5.5 workers, each with an Opus 5.5 manager, and an optional Fable 5.1 head;
- a second opinion from ChatGPT on drafts;
- strict token budgets;
- plain-language daily reports;
- one-tap human approval on everything outward-facing.

The teams are Watchdog, Replies, Contact, Email leads, Office outreach and Marketing.

**Operating mode (owner's answer, 2026-10-20):** "build it how you recommend… make sure everything is approved because I will be asleep… fully build the system." So all phases are built back to back without stopping for review. Each phase is still verified and pushed to `main` on its own (CLAUDE.md). There are three hard limits, because they are irreversible or outward-facing and the owner can't be asked tonight:
1. **No SQL is applied to production Supabase.** Migrations are written and the owner runs them. Until then the code runs in a "not set up" state: the admin tab shows "Run `supabase/crew.sql`", and nothing else on the site changes.
2. **No external accounts or credentials are created.** Every agent that needs a missing key shows "Needs: X" and stays off.
3. **Agents themselves never post, send, DM, push code or spend.** Every outward action waits in the approval inbox.

Work stops early only if a build or test failure can't be fixed. The owner is then told exactly where it stopped.

---

## A. What exists today: reuse, replace, ignore

| Thing | Where | Decision |
|---|---|---|
| Email relay | `src/app/api/agent-email/route.ts` (Bearer `AGENT_RELAY_SECRET`, recipient always `agent_system.digest_email`, Resend) | **Reuse.** Extract its send body into `src/lib/owner-digest.ts` (`sendOwnerDigest(subject, html)`). The relay calls it with unchanged behaviour, and so do crew reports. |
| Production errors | `error_events` table (`supabase/error-events.sql`, has `fingerprint`), written by `src/lib/report-error.ts` | **Reuse.** This is the bug watch's main input. |
| Health check | `scripts/health-check.mjs` → JSON; `uptime.yml` every 15 min | **Reuse.** Add one `if: always()` step that POSTs `health.json` to `/api/crew/ingest`. No existing step changes. |
| Nightly QA | `nightly-qa.yml` → `nightly/summary.json` (`qa-nightly-summary.mjs`), covering flows, sweep, prod-probe, share-preview and the rest; test accounts are created and deleted | **Reuse.** This is the input for the "daily tester pair" and the UI watcher. Add one final `if: always()` step that POSTs `summary.json` to ingest. |
| Deploy watchdog, paint-check, CI, pre-push hook | `.github/workflows/*`, `.githooks/pre-push` | **Keep untouched.** `tests/monitoring-wiring.test.ts` must stay green. |
| Tracked links | `src/lib/referral.ts` `CAMPAIGN_PLATFORMS` (ig, fb, li, tt, yt, pin, rd, al, ar), `src/lib/campaign-links.ts` `campaignLink()`, `/go/[code]` | **Reuse.** Every draft that carries a link uses `campaignLink('rd_reply_…')` and similar, so signups trace back to the agent. No code generator exists any more; crew adds a small one. |
| Connect OAuth | `src/lib/agent-connections.ts`, `src/lib/agent-connect-oauth.ts`, `/api/admin/connect/[provider]` (x, meta, youtube, linkedin, pinterest), table `agent_connections` | **Reuse, read-only**, for LinkedIn and Pinterest *publishing of our own posts* after approval (social manager). No change to the module. |
| Blog | `/blog`, `/blog/[slug]` reading `agent_blog_posts` (4 rows), `src/lib/blog-md.ts` | **Reuse that table** as the blog's publish target. It's the public blog's store, not agent state, so writing an approved post there is the documented path. The blog agent writes a draft into `crew_approvals`; on Approve, one row is inserted with `status='published'`. |
| LLM helper | `src/lib/ai.ts` (raw fetch, picks OpenAI → Gemini → Anthropic by **which key exists**, and feeds the App Store consent notice `aiProviderName()`) | **Ignore and protect.** Crew uses its *own* env names (`CREW_ANTHROPIC_API_KEY`, `CREW_OPENAI_API_KEY`). Adding a plain `ANTHROPIC_API_KEY` could silently change the user-facing disclosure. A test pins that `src/lib/crew/**` never reads the plain names. |
| Plan facts | `src/lib/plan.ts`, `src/lib/plan-content.ts`, `src/lib/knowledge/derived.ts` `derivedFacts({commerce:true})`, `fillPlaceholders()` | **Reuse.** This is the only source of SwiftCard prices and limits in any prompt. |
| Competitor data | `src/app/compare/[slug]/page.tsx` inline `COMPETITORS` (7). The `src/lib/compare/competitors.ts` and `docs/competitor-facts.md` files are on an unmerged branch and are **not on main**. | **Seed only.** The competitor watch keeps a dated, sourced `crew_competitor_facts` table, and drafts may cite a competitor price only from a fact under 30 days old. |
| Admin shell | `src/app/admin/layout.tsx`, `AdminNav.tsx` `LINKS`, `src/lib/admin.ts` `requireAdmin()`, `getAdminSupabase()` in `src/lib/supabase-admin.ts` | **Reuse.** Add a tab "Agents" → `/admin/crew`. Every page and route calls `requireAdmin()` again. |
| Leftover tables | `agent_*` (18 kept with data) and the unapplied `supabase/retire-agent-flow-linkedin-desk.sql` | **Ignore.** Crew never reads or writes them, except `agent_blog_posts` (public blog), `agent_connections` (via the kept module) and `agent_system.digest_email` (via the relay). The decision to drop the rest stays with the owner. |
| Social post sources | `marketing/instagram/launch/` (untracked: `captions.md`, `src/slides.html`, `src/pinned-v2.html`, `render*.mjs`, capture scripts). `BRAND_VOICE.md`, `HUMAN_VOICE.md` and `agents/social.md` are only in history at `d5b04741^:marketing-agents/` | **Commit** the launch source and captions (no PNG outputs) in Phase 6. Restore the two voice files as `docs/brand/BRAND_VOICE.md` and `docs/brand/HUMAN_VOICE.md` (owner chose this). Only 3 posts exist; no 4th was found. |
| Google Sheets, Anthropic SDK, OpenAI SDK, GEO/llms.txt | not found | New. |
| Cron | `vercel.json` has 2 crons; cron auth uses `CRON_SECRET` | Not used for crew (see scheduler). |

**Namespace picked:** DB tables use `crew_*`, code lives in `src/lib/crew/`, routes are `/api/crew/*` and `/api/admin/crew/*`, the page is `/admin/crew` (tab label "Agents"), and workflows are `crew-*.yml`. "crew" appears in no table, lib or route today, only in marketing copy.

---

## B. Architecture

### B1. Agent framework (`src/lib/crew/`)
- `registry.ts` holds one typed `AgentDef` per agent:
  - identity: `id`, `team`, `role: worker|manager|head`;
  - run settings: `model`, `schedule` (NY-time rule), `budget {dailyTokens, dailyUsd}`, `approvalKind`, `needs: EnvKey[]`;
  - limits: `rateLimit`, `maxPendingApprovals`;
  - behaviour: `run(ctx)`.
  
  Every agent defaults to `enabled:false` in the DB. An agent whose `needs` are missing reports "Needs: X" and never runs.
- `context.ts`: the `ctx` given to each run.
  - `ctx.llm` is the router.
  - `ctx.debate()`, `ctx.propose(approval)`, `ctx.ledger`, `ctx.facts()`, `ctx.tools` (platform clients), `ctx.stat(k, n)` and `ctx.log`.
  - Agents cannot reach outward APIs except read-only ones. Write methods exist only in `src/lib/crew/execute/`, which runs **only** from the approve route.
- Managers are agents with `role: manager`. Daily, each one reads its team's runs, stats, usage and approvals (as structured JSON computed in code) and writes the report. Managers also set team priorities: they can tweak a worker's `config.focus` (keywords, subreddits), which shows in the report.
- The head agent (Fable 5.1, **built, off by default**) reads every manager report once a day and writes "the plan for tomorrow" plus up to 3 asks. It has its own budget of $1/day.

### B2. Model router (`router.ts`, `models.ts`)
- Model IDs and prices were verified with the claude-api skill (cached 2026-10-06):

  | Model | ID | Input $/MTok | Output $/MTok | Cache read $/MTok |
  |---|---|---|---|---|
  | Sonnet 5.5 | `claude-sonnet-5-5` | 2 | 10 | 0.20 |
  | Opus 5.5 | `claude-opus-5-5` | 4 | 20 | 0.20 |
  | Fable 5.1 | `claude-fable-5-1` | 10 | 50 | 0.25 |

  The Batch API costs 50% of these. Web search costs $10 per 1,000 searches.
- Official SDKs: `@anthropic-ai/sdk` and `openai` (both new deps).
- Request rules on these models:
  - Use `output_config.effort` (`low` for scoring, `medium` for drafts, `high` for manager and head) and adaptive thinking.
  - No `budget_tokens`, no forced `tool_choice` and no prefill; these 400 on these models. Use `strict` tools and structured outputs instead.
  - Add `fallbacks:"default"` with beta `server-side-fallback-2026-07-01` on Sonnet, Opus and Fable, and always check `stop_reason`.
- Prompt caching: a frozen system prompt and facts block with `cache_control`, kept byte-stable (no timestamps). `usage.cache_read_input_tokens` is logged.
- Batching: scoring and classifying jobs go through Message Batches. They're submitted in one tick and collected in the next (`crew_batches`).
- Escalation: if an agent gets ≥3 rejections in its last 5 decisions for an approval kind, its next drafts use Opus until 3 approvals in a row. This shows as "Upgraded to Opus because 3 of 5 were rejected". Override per agent.
- OpenAI: the model comes from `CREW_OPENAI_MODEL` (no hard-coded guess). Phase 0 checks the current model list and the Responses API in the OpenAI docs (Context7) and through `GET /v1/models`. If the key is missing, the critic falls back to a Sonnet "skeptic" call and the approval card says "ChatGPT not connected".

### B3. Debate loop (`debate.ts`)
It applies only to outward drafts and code-fix proposals. Trivial kinds skip it: reports, read-only findings, scoring, and any draft under 280 characters with score < 0.6.

1. **Round 0:** the worker (Sonnet) drafts.
2. **Critique:** ChatGPT gets the draft, the rules and the facts. It returns JSON `{verdict: agree|revise, issues[], score}`.
3. If it agrees, we're done. Otherwise the worker revises (round 1) and ChatGPT re-checks (round 2 max).
4. **Tie-break:** if they still disagree after 2 rounds, the team manager (Opus) picks or merges, and its answer is final.

Caps: a per-debate token cap (default 12k), counted against the agent budget. If the budget is short, the debate is skipped and the card is marked "single opinion".

The card shows one line, for example "Claude and ChatGPT agreed" or "ChatGPT wanted it less salesy; manager kept the softer version".

### B4. Budgets and kill switch (`budget.ts`)
- **Before** every LLM call, `assertBudget(agent, estTokens)` checks four things:
  - global `crew_settings.kill_all` and the `CREW_DISABLED=1` env (hard stop with no DB needed);
  - the team and agent `enabled` flags;
  - the agent and team daily tokens and $;
  - the global daily $ (default **$8/day**, editable).
  
  On a breach the run stops gracefully with status `budget`.
- **After** every call, `crew_usage` gets the provider, model, input/output/cache tokens, web searches and `cost_usd` (from the `models.ts` price table).
- **Backpressure:** an agent with ≥ `maxPendingApprovals` (default 5) pending items does not draft. This keeps the inbox small and the spend low (the spec's "don't flood the inbox").
- The usage meter in the admin tab shows today/7-day $ per team and agent, a bar against each cap, and cache hit %.

### B5. Scheduler: decision
| Option | Verdict |
|---|---|
| Vercel Cron | Works (300 s max duration), but its schedules live in `vercel.json` and every change is a deploy. It has no issue-based alerting, the way this repo already watches jobs. |
| Vercel Queues | Public beta, a new dependency for little gain at this volume. |
| Dedicated worker | New infrastructure to keep alive and monitor. Rejected. |
| **GitHub Actions clock + Vercel route** ✅ | Matches every existing monitor. `crew-tick.yml` runs every 15 min and POSTs `/api/crew/tick` with `Bearer CREW_TICK_SECRET`. LLM keys stay in Vercel only. A failing or stalled tick opens one issue labelled `crew` (the same edit-in-place pattern as `uptime.yml`). Browser work already runs in Actions (nightly QA). |

How a tick works:
- It runs with `maxDuration = 300` (checked against `node_modules/next/dist/docs/.../maxDuration.md`) and a 240 s internal budget.
- It reads the kill switch, collects finished batches, then claims due agents with a lease (`lease_until`) so overlapping ticks can't double-run.
- It runs agents until the time budget is used, and writes `next_run_at`.
- GitHub cron can lag, so schedules are "at or after", never exact.

### B6. Approval queue and admin UI
- Table `crew_approvals`. Kinds: `reply`, `comment`, `dm`, `connect_note`, `post`, `blog_post`, `code_fix`, `email_list_export`, `spend`, `ask`.
- Status runs `pending → approved | rejected | expired (7 d)`, then `done`.
- `/admin/crew` has these sections:
  - **Inbox** (default view): one card per item, written plain, for example "Reddit: someone in r/realtors says Linktree is too pricey. Here's a reply." The card shows the draft (editable), the source link and the debate line. Buttons: **Approve**, **Reject** (reason chips: too salesy / wrong person / wrong facts / other), and, for drafts we post by hand, **Copy & open** then **I posted it**.
  - **Teams**: status, kill switches and per-agent on/off with "Needs: X".
  - **Usage**: the meter.
  - **Reports**.
  - **People**: a ledger lookup.
  - **Leads**.
  - **Settings**: caps, the disclosure template, report hour, head on/off.
- Approving a `code_fix`, `post` or `blog_post` runs the executor; drafts we post ourselves only mark approved.
- Form rules from AGENTS.md: every mutating form uses `method="post"` and works before hydration. Each button posts to a route handler and redirects back.

### B7. De-dup ledger (`ledger.ts`)
- `crew_people` (one human) and `crew_identities (platform, handle_norm)` (unique). Normalizers per platform: reddit `u/x` lowercased; ig `@x`; linkedin `/in/slug`; email lowercased with plus-tags stripped for matching; alignable profile path; threads `@x`.
- Identities are linked automatically only on an exact email or a profile link to another handle. Fuzzy name+company matches are *flagged* for the owner, never merged automatically.
- `crew_touches (person_id, platform, kind: replied|commented|dm_drafted|dm_sent|connect_sent|emailed|called|lead_listed, approval_id, at)`.
- **Hard rule** in SQL function `crew_claim_dm(person, approval)`: it takes an advisory lock and refuses if *any* touch exists for that person on any platform, or any pending DM exists. Every DM or connect-note draft must win this claim before it is shown. A rejected draft releases its claim. Replies use a unique `(platform, target_url)` so a thread isn't answered twice.

### B8. Report writer (`reports.ts`, `readability.ts`)
- Code computes the facts (counts, $, cache %, approvals, rejections, findings). The manager writes from that JSON only, so numbers can't be invented. A validator checks that every number in the text appears in the JSON.
- Format: "What happened", "What I need from you" (each with an Approve/Reject link), "Money used today", "How I saved tokens".
- A Flesch-Kincaid grade check in code requires grade ≤ 5. One rewrite is allowed, and if it still fails, a plain template is sent.
- Delivery: a `crew_reports` row, plus a daily email at 7:00 NY via `sendOwnerDigest`. The Watchdog emails only when there's a *new* finding (its 15-minute status lives in the tab, not the inbox).

### B9. Disclosure, voice, rate limits
- `crew_settings.disclosure` is on by default with the template "(I work on SwiftCard, so I'm biased.)". The system appends it to every promotional reply, comment or DM in a natural place. A test fails if a promotional draft reaches the inbox without it. Non-promotional comments (no product mention) carry none.
- The voice prompt is built from `HUMAN_VOICE.md` and `BRAND_VOICE.md` (restored), the facts from `derivedFacts`, and dated competitor facts. Banned words come from BRAND_VOICE. There are no em dashes, matching the site rule.
- `crew_rate_limits (platform, account, action, ceiling, warmup_start)`. The effective daily cap is `ceiling × min(1, 0.2 × weeks_since_warmup + 0.2)`. Drafting stops at the cap, and "I posted it" past the cap shows a warning.

### B10. Data model (`supabase/crew.sql`, idempotent, RLS on with no policies, service role only, not applied)
- `crew_settings` (singleton)
- `crew_agents` (id, team, role, enabled, model_override, caps, config jsonb, last_run_at, next_run_at, lease_until, status_note)
- `crew_runs`
- `crew_usage` (+ index by day and agent)
- `crew_batches`
- `crew_approvals`
- `crew_people`, `crew_identities`, `crew_touches`, plus function `crew_claim_dm`
- `crew_findings` (fingerprint unique, kind, source, first/last seen, count, status, approval_id)
- `crew_reports`
- `crew_rate_limits`
- `crew_leads` (person_id, name, email, phone, company, title, city, region, country, **region_restricted**, **source_url**, **source_platform**, **found_at**, list `cold|office`, sheet_synced_at)
- `crew_suppression` (email/domain, reason, added_at); every lead insert checks it
- `crew_competitor_facts` (competitor, fact, value, source_url, seen_at)

Each file header says what it does, whether it's safe, the rollback, and "NOT APPLIED".

### B11. Env vars (all new names; listed in `ENV_KEYS_NEEDED.md` and `.env.example` without values)
| Var | Used by | Phase |
|---|---|---|
| `CREW_ANTHROPIC_API_KEY` | all Claude calls | 0 |
| `CREW_OPENAI_API_KEY`, `CREW_OPENAI_MODEL` | debate critic, GEO checks | 0 |
| `CREW_TICK_SECRET` (Vercel + GitHub secret) | tick and ingest routes | 0 |
| `CREW_DISABLED` | hard kill | 0 |
| `CREW_GITHUB_TOKEN` (fine-grained, this repo: actions:write, contents:write, pull_requests:write) + GitHub secret `CREW_ANTHROPIC_API_KEY` | open fix PRs via `crew-fix.yml` | 1 |
| `CREW_STRIPE_READ_KEY` (Stripe restricted, read-only) | payments pair | 1 |
| `VERCEL_TOKEN` (optional) | security agent traffic view | 1 |
| `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET`, `REDDIT_USER_AGENT` | Reddit read (app-only OAuth) | 2 |
| `META_*` (later, if an app gets IG Public Content Access or Threads keyword search) | IG/Threads discovery | 2–3 |
| `GOOGLE_SHEETS_SA_JSON`, `CREW_LEADS_SHEET_ID`, `CREW_OFFICE_SHEET_ID` | Sheets mirror | 4 |
| existing `AGENT_RELAY_SECRET`/`RESEND_API_KEY`, `agent_connections` LinkedIn/Pinterest | reports, own-post publishing | 0/6 |

---

## C. Agent table

Abbreviations: S = Sonnet 5.5, O = Opus 5.5, F = Fable 5.1; WS = Claude web_search; Paste = owner pastes a post or profile into the tab; Draft = agent drafts and a human posts. Ceilings are maximums, never targets, and are subject to warm-up.

| # | Agent | Purpose | Inputs and tools | Model | Schedule | Output | Approval | Limits | Success metric | Feasibility (compliant version) |
|---|---|---|---|---|---|---|---|---|---|---|
| H | Head | One combined plan | manager reports | F | daily 7:30 | plan + ≤3 asks | asks only | $1/d, off by default | asks approved | ✅ |
| W0 | Watch manager | Team report | team stats | O | daily 7:00 | report | – | $0.3/d | – | ✅ |
| W1 | Bug watch | New errors → findings → fix | `error_events` diff by fingerprint, nightly summary, health JSON | S | every 15 min (LLM only on new fingerprints) | finding + fix proposal | `code_fix` → PR | ≤20 triage/d | time to fix | ✅ |
| W2 | Speed/uptime | Speed budget, outages | ingested `health.json`, `/api/health` timing | S (report only) | 15 min, code-only | finding | `code_fix` | – | p50 within budget | ✅ |
| W3 | Web security | Bots, spam signups, weird traffic, domain/TLS, headers | profiles/signup rate, `error_events` spikes, TLS/DNS/header checks; Vercel firewall if `VERCEL_TOKEN` | S | hourly code, daily LLM | finding | `code_fix`/`ask` | – | 0 unseen incidents | ✅ (traffic detail needs token) |
| W4 | App speed/bugs | Native shells | nightly `qa-android-shell`, `qa-office-shell`, `error_events` with `client:` context | S | daily | finding | `code_fix` | – | – | ✅ partial: native crash data needs Sentry / App Store Connect (deferred) |
| W5 | UI watcher | Broken buttons, overflow | nightly `qa-sweep` issues.json | S | daily after nightly | exact finding (screen, width, element) | `code_fix` | – | sweep issues → 0 | ✅ |
| W6a/b | Daily tester pair | Sign up, click, delete | nightly `qa-flows` + `qa-prod-probe` (test accounts made and deleted by those scripts) | S | daily | failures in plain words | `code_fix` | – | flows green | ✅ reuses QA scripts |
| W7a/b | Payments pair (watch + revenue) | Failed payments, trial→paid, referrals, subs drift | Stripe read-only key: invoices, payment_intents, subscriptions vs `profiles.plan`; webhook dedup table | S | every 6 h code, daily LLM | finding + report | `ask` | – | 0 silent failures | ✅ |
| — | Scan-cost abuse | per-scan Google AI cost | – | – | – | – | – | – | – | **Deferred** (spec says later) |
| R0 | Replies manager | report, focus | | O | daily | report | – | | | ✅ |
| R1 | Reddit replies | Threads where SwiftCard helps or competitor complaints | Reddit API (app-only OAuth, owner says approved; verify scopes) for search and subreddit/new; WS fallback | S | 3×/d | reply drafts | `reply` → human posts | ≤8/d | approve rate, clicks on `rd_` links | ✅ Draft. Respect each subreddit's self-promo rule (stored per subreddit). |
| R2 | Threads | same | WS now; Threads keyword search after Meta approval | S | 2×/d | drafts | `reply` | ≤5/d | | ✅ Draft |
| R3 | Facebook groups | same | **Paste** (Groups API removed Apr 2024; no reading groups) | S | on paste | drafts | `reply` | ≤5/d | | ⚠ changed: owner joins groups and pastes posts |
| R4 | Quora | same | WS (`site:quora.com`) | S | daily | answer drafts | `reply` | ≤3/d | | ✅ Draft (no API; no scraping) |
| R5 | Indie Hackers | same | WS (`site:indiehackers.com`) | S | daily | drafts | `reply` | ≤3/d | | ✅ Draft |
| R6 | Instagram comments | 3–5 useful comments/day on pros' public posts; follow list 20–30 | watch list of handles (owner adds or approves), post text via Paste or IG Business Discovery when approved | S | daily | comment drafts + "follow these" list | `comment` | ≤5/d, follows ≤30 total | | ⚠ the API can't comment on others' posts or follow, so Draft + manual |
| R7 | LinkedIn comments | Insightful comment on a specific post | WS for public posts + Paste | S | daily | drafts | `comment` | ≤5/d | | ⚠ the API can't comment on others' posts, so Draft |
| C0 | Contact manager | | | O | daily | report | | | | ✅ |
| C1 | IG pro DMs | Tailored DM about their posts | watch list + Paste/Business Discovery | S | daily | DM drafts | `dm` (ledger claim) | ≤10/d | replies | ⚠ DMs only by hand (the API allows replies only after they message first) |
| C2 | IG link-in-bio switchers | Bio has a linktr.ee, hoo.be or link.me link | Business Discovery `website` field (when approved) or Paste/WS | S | daily | DM drafts | `dm` | ≤10/d | | ⚠ same |
| C3 | Reddit DMs | ~10/day to people asking "good link in bio?" or complaining | Reddit API search | S | daily | DM drafts | `dm` | ≤10/d | | ⚠ the human sends; unsolicited DMs risk a ban, so warm-up starts at 2/d |
| C4 | LinkedIn connect | Connect note + tailored message | WS + Paste profile | S | daily | note + message drafts | `connect_note` | ≤10/d | accepts | ⚠ invites and messages are manual (the Messages API is partner-only and needs a member action) |
| C5 | Alignable | Personable, non-pitchy | Paste | S | on paste | drafts | `dm` | ≤10/d | | ⚠ no API; Paste |
| E0 | Email-lead manager | daily counts | | O | daily | report | | | | ✅ |
| E1 | Open web | Businesses that publish an email (e.g. "real estate offices Charlotte NC") | WS for business sites → code fetches the contact/about page (robots.txt respected, 1 req/s/domain), regex emails, LLM classifies business type in a batch | S (batch) | continuous (each tick) | `crew_leads` + Sheet | none (read-only); export is `email_list_export` | ≤3,000/d ceiling | verified-format emails/d | ✅ Realistic yield is far below 3k/d at first; the manager reports the real number |
| E2 | Reddit | Users who post a business email publicly | Reddit API | S | daily | leads | – | | | ✅ thin yield |
| E3 | Quora | profiles or answers with public emails | WS | S | daily | leads | – | | | ✅ thin |
| E4 | Facebook groups | – | **Paste** only | S | on paste | leads | – | | | ⚠ changed: no scraping groups |
| E5 | Alignable | – | **Paste** only | S | on paste | leads | – | | | ⚠ changed: ToS forbids scraping |
| E6 | LinkedIn (optional) | – | – | – | – | – | – | – | – | 🚫 built as a flagged stub, **off, cannot be switched on** (scraping is against the User Agreement) |
| O1 | Office outreach | NYC real-estate teams and businesses: owners, managers, sales heads with name, phone, email; partnerships | WS + company sites (public contact pages), dedupe | S, O drafts | daily | Office sheet (~30 call-ready rows/d), call notes, outreach drafts, partnership ideas | drafts `dm`/email draft | ≤40 rows/d | calls → Office trials | ✅ public business contact data only |
| M0 | Marketing manager | | | O | daily | report | | | | ✅ |
| M1 | SEO | Daily rankability fixes | sitemap, metadata, the untracked `swiftcard-seo-audit-2026-10-14.md` as backlog (read locally; not committed unless owner OKs), WS for SERP checks | S | daily | 1 proposed change | `code_fix` (PR) | 1/d | | ✅ |
| M2 | GEO | *Assumption: optimize how SwiftCard appears in AI answer engines (ChatGPT, Perplexity, Google AI Overviews).* | asks fixed buyer questions to Claude WS + OpenAI with web search; logs whether SwiftCard is named; proposes `llms.txt`, FAQ and schema changes | S | daily (10 questions) | share-of-answer trend + 1 proposal | `code_fix` | | mention rate | ✅ |
| M3 | Blog | 1 post/week, SEO-driven (SwiftCard, competitors, features) | keyword list, competitor facts, knowledge docs | S (+debate) | weekly Mon | full post | `blog_post` → `agent_blog_posts` | 1/wk | impressions | ✅ |
| M4 | Social manager | 1 idea/day → image post or slideshow per platform (LinkedIn, IG, Threads, TikTok, Pinterest, YouTube, Reddit, Alignable) | launch-post sources (`slides.html`, `pinned-v2.html`, `captions.md`) + voice files. The agent writes slide copy into those HTML templates and `crew-render.yml` renders PNGs with Playwright at each platform size (no image model) | S | daily | step 1: 3 options to pick; step 2: finished set + per-platform captions | `post` (two steps) | queue ≤ budget; 1 idea/d | saves, clicks | ✅ Auto-publish only where an approved API exists (LinkedIn own profile/page, Pinterest via kept plumbing); else Copy & download |
| M5 | Competitor watch | HiHello, Blinq, Popl, Link.me, Linktree, Hoobe: pricing and features | WS + fetch pricing pages; diff against `crew_competitor_facts` | S | Wed + Sun 8:00 | change report + updated facts | facts auto-saved (read-only); compare-page edits are a `code_fix` | | changes caught | ✅ |

---

## D. Phased build order
One worktree for everything:
- `git worktree add ~/Projects/SWIFTCARD-crew -b crew/agent-system origin/main`, then `npm install` (installs the pre-push hook) and copy `.env.local` (never staged).
- Per phase: `npx tsc --noEmit`, `npx eslint .`, `npm test`, `npm run test:render` (UI phases) and `npx next build` → `git pull --rebase origin main` (`--ff-only` is impossible from a branch, so rebase onto it) → stage explicit paths → commit → `git push origin HEAD:main`.
- Confirm that CI `verify` and `render` are green and that `/api/health` names the commit before calling a phase live.
- **Reorder vs the requested order:** the competitor watch (M5) moves to the start of Phase 2, because Replies and Contact may cite competitor prices only from its sourced facts. The head agent lands in Phase 3, once ≥2 managers exist.

### Phase 0: Foundation (full detail)
Step one: write this plan to `docs/plans/agent-system.md` (committed with Phase 0).

Files:
- `supabase/crew.sql` (B10).
- `src/lib/crew/`:
  - `types.ts`, `models.ts` (IDs and prices), `registry.ts` (fake agent + manager only)
  - `context.ts`, `router.ts`, `llm/anthropic.ts`, `llm/openai.ts`, `llm/fake.ts` (deterministic test provider)
  - `budget.ts`, `debate.ts`, `approvals.ts`, `ledger.ts`, `rate-limit.ts`, `reports.ts`, `readability.ts`
  - `disclosure.ts`, `facts.ts` (wraps `derivedFacts` + competitor facts), `tick.ts` (lease and claim), `schedule.ts` (NY-time rules), `links.ts` (campaign codes), `env.ts` (the only reader of `CREW_*` env)
  - `agents/fake-echo.ts`: drafts a canned "reply" through router → debate → ledger claim → approval, end to end
- `src/lib/owner-digest.ts`, extracted from `/api/agent-email` (behaviour identical, test pins it).
- Routes:
  - `src/app/api/crew/tick/route.ts` (POST, Bearer `CREW_TICK_SECRET`, fails closed, `maxDuration=300`)
  - `src/app/api/crew/ingest/route.ts` (same auth; accepts `{source:'health'|'nightly', json}`)
  - `src/app/api/admin/crew/{approvals/[id]/decide,settings,agents/[id],paste}/route.ts` (all `requireAdmin`, POST + redirect, `method="post"` forms)
- UI: `src/app/admin/crew/page.tsx` (server, `force-dynamic`, `requireAdmin` → `notFound`) and `CrewClient.tsx` (Inbox, Teams, Usage, Reports, People, Settings). Add `{ href: "/admin/crew", label: "Agents" }` to `AdminNav.tsx`, and add the route to `UNDOCUMENTED_ROUTES` in `src/lib/knowledge/index.ts` ("Staff console — agent inbox"). It is staff-only, so no `docs/` text is needed.
- Workflow: `.github/workflows/crew-tick.yml` (every 15 min, single-issue alerting, label `crew`, `permissions: contents: read, issues: write`).
- Deps: `@anthropic-ai/sdk`, `openai`.
- `ENV_KEYS_NEEDED.md` and `.env.example`: crew section.

Tests (vitest, fake LLM, no network):
- `crew-budget`: caps per agent, team and global; kill switch; `CREW_DISABLED`; cost math.
- `crew-approval-gate`: source invariant that only `execute/` calls write APIs, and only `decide` imports `execute/`; agent runs can't import it.
- `crew-ledger`: normalizers; claim refused after any touch; release on reject; reply uniqueness.
- `crew-rate-limit`: warm-up curve; stops at cap.
- `crew-debate`: agree path, revise path, tie-break, skip-trivial, token cap.
- `crew-router`: escalation after 3/5 rejections and back.
- `crew-report`: readability ≤ grade 5; number validator.
- `crew-disclosure`: promotional drafts carry it, plain comments don't.
- `crew-env`: crew never reads `ANTHROPIC_API_KEY` or `OPENAI_API_KEY`; `ai.ts` untouched.
- `crew-tick`: lease prevents a double run; auth fails closed.

Render: `tests/render/admin-crew-inbox.test.ts` (390 and 1280 widths, card buttons visible, not covered).

**What the owner will see:** an "Agents" tab. Before SQL it says "Run supabase/crew.sql". After that, with keys set:
- Settings → turn on "Test agent".
- The next tick puts one inbox card with a draft, its debate line and Approve/Reject.
- Approve marks it done and adds a ledger touch.
- The usage meter shows cents.
- A 7:00 test report arrives by email.

### Phase 1: Watchdog (full detail; bug watch first)
Order:
1. **W1 bug watch**
   - `agents/watch-bugs.ts`. Each tick it reads `error_events` since the last cursor, grouped by fingerprint, and upserts `crew_findings`.
   - Only *new or regressed* fingerprints go to Sonnet. The triage gets the stack, the context and the matching source file read from the repo at build-time paths via GitHub contents API (`CREW_GITHUB_TOKEN`) when present. It returns `{plain, severity, likely_file, fix_idea}`.
   - The result is a `code_fix` approval: "Users on /dashboard hit 'X' 14 times since 3am. Fix?"
   - Severity `critical` emails at once; the rest go into the daily report.
2. **Fix executor**
   - `src/lib/crew/execute/code-fix.ts` dispatches `.github/workflows/crew-fix.yml` (`workflow_dispatch`, input finding id + plain brief).
   - The workflow checks out main and creates branch `crew/fix-<id>`. It runs Anthropic's Claude Code GitHub Action, verifying current inputs at build time, with a prompt that embeds AGENTS.md rules and requires `tsc`, `eslint` and `vitest` to pass. Then it opens a **PR** using `CREW_GITHUB_TOKEN`, so PR CI runs (PRs opened with `GITHUB_TOKEN` don't trigger workflows).
   - **It never merges.** The owner merges, and the normal Deployment Checks gate applies. The PR link appears on the card.
3. **W2 speed/uptime**: an ingest step in `uptime.yml` plus code thresholds (reusing the health-check speed budget). Findings appear only on breach.
4. **W5 UI watcher, W6 tester pair, W4 app**: an ingest step in `nightly-qa.yml`. Each section's failures become findings with screen/width/element, deduped by text hash.
5. **W3 security**:
   - hourly code checks for signup-rate anomaly (profiles per hour vs a 7-day median), error spikes, TLS expiry < 14 d, DNS records and security headers on `/`;
   - a daily LLM summary;
   - an `ask` card when action is needed (e.g. "Turn on Vercel Attack Mode?" with a link; the agent can't toggle it).
6. **W7 payments pair** (`CREW_STRIPE_READ_KEY`):
   - failed invoices, `past_due`, trials ending in < 48 h without a payment method, trial-ended-but-no-charge, a paid Stripe sub with a free `profiles.plan` (and the reverse), referral upgrades applied;
   - every 6 h in code, with a daily report from the revenue agent.
7. **W0 manager** daily report.

Files: `agents/watch-*.ts`, `execute/code-fix.ts`, `src/lib/crew/sources/{error-events,stripe-read,tls-dns,github}.ts`, `crew-fix.yml`, ingest steps in `uptime.yml` and `nightly-qa.yml` (appended steps only), plus SQL additions in `supabase/crew-watchdog.sql` if needed.

Tests:
- fingerprint diff / regression detection;
- ingest parsing of real `summary.json` and `health.json` shapes (fixtures);
- Stripe drift rules on fixture objects;
- the code-fix executor refuses unless the approval is `approved` and the kind is `code_fix`;
- the workflow file has no `merge` step and no `--no-verify`;
- `monitoring-wiring` still passes.

What the owner sees: a Watchdog team card with "Last check 3:15am, all quiet" or findings with Fix buttons. Approve → a PR link within minutes.

### Phase 2: Competitor watch, then Replies (Reddit first)
1. M5 competitor watch, seeded from `compare/[slug]` `COMPETITORS` with source "our compare page", then refreshed from live pricing pages.
2. `sources/reddit.ts`: app-only OAuth (`client_credentials`), 100 QPM cap with headroom (we use ≤10). Read the current Reddit Data API and Responsible Builder docs and record the allowed scopes in the plan doc. Configurable subreddits and keywords, plus per-subreddit `promo_allowed`.
3. R1 Reddit:
   - score candidates in a batch;
   - draft only for the top N within the cap;
   - debate;
   - card with **Copy & open**, then **I posted it** writes the touch.
4. A generic "Paste a post" box (platform, URL, text) that any paste-based agent reads (R3, R6, R7, C5, E4, E5).
5. R2 Threads, R4 Quora, R5 Indie Hackers (WS), R3 Facebook (Paste), R6 IG (watch list + Paste), R7 LinkedIn (WS + Paste), then R0 manager.

Tests: candidate scoring filter, subreddit promo rule respected, every draft has a disclosure and a tracked link, the competitor price-age rule, reply uniqueness.

### Phase 3: Contact + Head
C3 Reddit DMs → C1/C2 Instagram → C4 LinkedIn → C5 Alignable → C0 manager → H head (off).
- Every DM path goes through `crew_claim_dm`.
- Link-in-bio detection is a code regex on known domains (`linktr.ee`, `hoo.be`, `link.me`, plus subdomains).

Tests: cross-team ledger (someone replied to in Phase 2 can't be DM'd), the business-professional filter (no personal accounts or minors' signals → skip), warm-up caps.

### Phase 4: Email leads + Sheets
- E1 open web first, then E2, E3 and the paste agents E4/E5. E6 is a locked stub.
- `sources/sheets.ts`: service account JWT and `spreadsheets.values.append` in batches (a quota-safe ≤60 writes/min), mirroring from `crew_leads`.
- Every lead stores source_url and found_at, is checked against suppression, and gets the GDPR-region flag (EU/EEA/UK/CH/CA/BR by country or TLD → `region_restricted`, excluded from exports by default).
- **No send step is built.** The plan doc's Settings page lists the CAN-SPAM checklist (unsubscribe, physical address, honest headers, separate sending domain and provider) as a hard prerequisite.
- The manager reports daily counts by source.

Tests: email extraction and normalization, suppression, region flag, robots.txt respected, Sheets batching.

### Phase 5: Office outreach
- O1: NYC queries (boroughs × business types), public business contact pages only, role detection (owner, broker, team lead, sales manager), dedupe against the ledger.
- Writes the Office sheet with ~30 call-ready rows per day plus a talking point per row. Drafts emails and DMs as approvals. Lists partnership ideas weekly.

### Phase 6: Marketing
- Commit `marketing/instagram/launch/` source and captions (no outputs), and restore `docs/brand/BRAND_VOICE.md` and `docs/brand/HUMAN_VOICE.md` from `d5b04741^`.
- M3 blog → M1 SEO → M2 GEO (adds `public/llms.txt` as its first proposal, via PR) → M4 social manager with `crew-render.yml` (Playwright renders the templates at 1080×1350, 1080×1920, 1000×1500 and 1200×627; uploads to Supabase storage `crew-media`) → M0 manager.
- Knowledge docs are updated only if a public page changes (e.g. llms.txt needs no doc; new public pages do).

---

## E. Cost per team per day (ceilings; real use is lower)
Assumptions:
- Sonnet $2/$10, Opus $4/$20, Fable $10/$50, cache read $0.20, batch −50%, web search $0.01 each.
- OpenAI critic estimated at Sonnet-like rates; it gets re-priced in Phase 0 from OpenAI's current pricing page.

| Team | Main drivers | $/day |
|---|---|---|
| Watchdog | ~15 triage (6k in / 0.8k out), 6 summaries, Opus report; fixes run in Actions at ~$1–3 per *approved* fix | ~$1.00 (+ fixes) |
| Replies (7) | per agent: 8 searches, 60 batched scores, 5 drafts + critique ≈ $0.35 | ~$2.60 |
| Contact (5) | ≈ $0.40 each + manager | ~$2.20 |
| Email leads | 200 searches ($2), result tokens ~$1.2, batched classify of 3k rows ~$1.35, others $0.6 | ~$5.20 at 3k/d |
| Office outreach | 60 searches, 20 drafts + debate | ~$1.50 |
| Marketing | SEO $0.3, GEO $0.5, blog $0.2/d avg, social $0.4, competitor $0.2, manager $0.15 | ~$1.80 |
| Head (Fable) | ~40k in / 3k out | ~$0.55 (if on) |
| **Total ceiling** | | **~$15/day ≈ $450/month**; default global cap **$8/day** |

Levers already in the design:
- Code before LLM: regex, keyword prefilters, fingerprint dedupe, extracting emails with regex instead of the model.
- Batch API for all scoring and classifying.
- Byte-stable cached system and facts blocks.
- Debate only on outward drafts, and skipped when trivial.
- Opus only for managers, tie-breaks and escalation.
- Inbox backpressure.
- `effort: low` for scoring.
- Per-agent caps.

Optional lever, off by default because the spec says workers run Sonnet: a Haiku 5.5 prefilter ($0.10/$0.50) for scoring.

## F. Risks and decisions (safe default)
1. **Platform bans from promotional replies or DMs.** Drafts only, disclosure on, warm-up, per-subreddit rules, ceilings not targets.
2. **False claims about competitors.** Only sourced facts under 30 days old; otherwise the draft omits the price.
3. **Spend runaway.** A global cap of $8/day, `CREW_DISABLED`, and the kill switch in the tab, all checked before every call.
4. **Code changes from agents.** PRs only, never merged by an agent, normal CI gate.
5. **The 2–3k emails/day target isn't reachable compliantly at first.** Report real yield; don't scrape FB, Alignable or LinkedIn.
6. **Privacy / GDPR.** Region flag, suppression list, source and date per row; no send step until CAN-SPAM prerequisites exist and the owner approves.
7. **Consent-notice drift in `ai.ts`.** Separate `CREW_*` keys, pinned by a test.
8. **Unapplied migration in production.** Every crew route and page checks for the tables and shows "not set up" instead of erroring, so the QA sweep stays clean.
9. **GitHub cron lag.** Schedules are "at or after"; the tick-staleness issue alerts.
10. **Old `agent_*` tables.** Untouched; the owner decides later.
11. **Reddit approval scope unknown.** Verify against the docs during Phase 2; fall back to WS if the scopes don't cover search.
12. **Branch note:** this checkout is actually on `fix/linkedin-headshot-roundtrip` (not `seo/compare-vs-pages-and-faq`). That's irrelevant, because all work happens in the new worktree.

## G. What the owner must provide (none blocks the build)
1. Run `supabase/crew.sql` (and any later `crew-*.sql`) in the Supabase SQL editor.
2. Vercel env: `CREW_ANTHROPIC_API_KEY`, `CREW_OPENAI_API_KEY`, `CREW_OPENAI_MODEL`, `CREW_TICK_SECRET`; GitHub secret `CREW_TICK_SECRET` (+ `CREW_ANTHROPIC_API_KEY` for fix PRs).
3. `CREW_GITHUB_TOKEN` (fine-grained, this repo only).
4. Stripe restricted read-only key `CREW_STRIPE_READ_KEY`.
5. Reddit app credentials `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET`, `REDDIT_USER_AGENT`.
6. Google Cloud service account JSON `GOOGLE_SHEETS_SA_JSON`, two sheets shared with its email, and their IDs.
7. Optional:
   - Meta app review for Instagram Public Content Access and Threads keyword search;
   - LinkedIn: confirm the app has "Share on LinkedIn"/Community Management for posting our own content (connect via the existing Connect button);
   - `VERCEL_TOKEN` for the traffic view.
8. Before any cold sending exists: a separate sending domain and provider, a physical mailing address, and an unsubscribe host.
9. Accounts the humans post from (Reddit, IG, LinkedIn, Alignable, Quora, Indie Hackers, FB) stay theirs; the system never logs into them.

## Verification (each phase)
- `npx tsc --noEmit && npx eslint . && npm test && npm run test:render && npx next build` in the worktree.
- Local end to end: `npx next build && npx next start -p 3222`. Then `curl -X POST -H "Authorization: Bearer $CREW_TICK_SECRET" localhost:3222/api/crew/tick`, using the fake provider (`CREW_FAKE_LLM=1`, honoured only when `NODE_ENV!=='production'`) against a local DB only if one is configured. Otherwise rely on the unit and render tests, because no production SQL is applied.
- After a push: CI green, and `/api/health` reports the commit.
- `npm run qa:sweep` against the production build covers `/admin/crew` at 390 and 1280 widths.

---

## Build log

- 2026-10-20: Phase 0 started in worktree ~/Projects/SWIFTCARD-crew (branch crew/agent-system off origin/main 5623aa20). SDKs: @anthropic-ai/sdk 0.135.0, openai 7.39.0.
- 2026-10-20: Phase 0 built: src/lib/crew (framework, router, budgets, debate, ledger, approvals, reports, tick), /admin/crew (tab "Agents"), /api/crew/{tick,ingest}, /api/admin/crew/*, crew-tick.yml, supabase/crew.sql (NOT applied), docs/brand voice files restored (stale product facts removed). Also fixed main's red CI: tests/android-shell read a gitignored capacitor.plugins.json.
- 2026-10-20: Phase 1 (Watchdog) built: watch-bugs (error_events, 15 min), watch-speed (uptime ingest), watch-security (TLS/headers/DNS/signup + error spikes, hourly), watch-app / watch-ui / watch-flows / watch-probe (nightly-qa ingest; the two "Daily tester" agents are the pair), watch-payments + watch-revenue (read-only Stripe key), watch-scan-cost (locked, deferred), watchdog-manager. Approved Fix → crew-fix.yml (claude-code-action@v1, verified inputs: anthropic_api_key, prompt, claude_args) opens a PR, never merges; PR link posts back via /api/crew/ingest?source=fix. uptime.yml + nightly-qa.yml gained one best-effort "Share the result with the Agents tab" step each.
- 2026-10-20: Phase 2 built: competitor-watch (Wed+Sun, web_search restricted to each competitor's own domain, dated facts in crew_competitor_facts; a price change proposes a compare-page Fix), shared engagement engine (src/lib/crew/replies/engine.ts: keyword prefilter → one scoring call → drafts within the warmed cap → debate → inbox), Replies agents for Reddit (API), Threads/Quora/Indie Hackers/LinkedIn (web search, domain-restricted), Facebook groups (paste only), Instagram comments (paste + weekly follow-list suggestion, ≤30 total). Comments pitch in at most ~1 of 3.
  Reddit verified 2026-10-20: app-only OAuth (client_credentials, Basic id:secret → oauth.reddit.com) per Reddit's OAuth2 docs; new API access needs approval under the Responsible Builder Policy (Nov 2025) and commercial use needs a separate agreement — owner says the app is approved; CONFIRM its approved use case covers "read threads, a person replies by hand". Reddit's terms want stored content deleted quickly, so Crew stores only the link and a summary for Reddit (no post body). Subreddit rules are read weekly; a rule banning self-promotion means helpful-only replies there.
  Security review fixes to crew-fix.yml: split into write (model, files only, $3 cap, no git creds) / verify (no secrets, no npm cache) / pr (token, no repo code) / report jobs; CLI pinned @anthropic-ai/claude-code@2.1.302.
- 2026-10-20: Phase 3 built: Contact team (contact-reddit DMs, contact-instagram, contact-instagram-linkinbio, contact-linkedin connect note + follow-up, contact-alignable paste-only and non-pitchy) on the shared engine; every DM claims the person in the cross-team ledger first; DMs with no identifiable person are skipped before drafting. Head agent (Fable 5.1) registered, off by default, needs ≥2 manager reports.
- 2026-10-20: Phase 4 built: leads-web (every 30 min, rotates 0 business types × 50 US cities; web search for official sites → polite fetch of homepage + ≤2 contact pages, robots.txt obeyed, 1 req/s/site → regex emails, no model for extraction), leads-reddit (API, code-only), leads-quora (web search), leads-facebook / leads-alignable (from pasted text, code-only), leads-linkedin locked. Every row: source_url + found_at; suppression by address or @domain; GDPR-style regions flagged and kept out of the sheet/CSV; Google Sheets mirror via service-account JWT (values.append, ≤500 rows/request, formula-escaped). Leads tab with CSV download and the CAN-SPAM checklist. No send step exists.
- 2026-10-20: Phase 5 built: office-outreach (every 6 h until ~30 call rows/day): NYC areas × team businesses → official sites via web search → safe polite fetch → one extraction call for named decision-makers (owner/broker/team lead/sales head); an email or phone is saved only if the site itself shows it; Office sheet + CSV; up to 2 personal email drafts per run (DM kind, ledger-claimed); weekly partnership ideas card. Security review: lead page reads now use lib/safe-fetch (SSRF guard, DNS pinned, redirects re-checked).
- 2026-10-20: Phase 6 built: marketing-blog (Mondays, topic queue of competitor/feature keywords, publishes to agent_blog_posts only on Approve), marketing-seo (code checks of sitemap marketing pages, 1 Fix a day), marketing-geo (assumption: AI answer engines; asks buyer questions with web search, tracks mention rate, proposes /llms.txt and Organization schema), marketing-social (one idea a day; step 1 pick of 3 options, step 2 every slide at 4:5/9:16/2:3/1:1 + a caption per platform; nothing auto-published), crew-render.yml + scripts/crew-render-social.mjs (launch-post visual system, real Daniel Whitfield captures, pictures in Supabase storage bucket crew-media added to crew.sql). Committed marketing/instagram/launch sources + captions + the 3 dw-*.png captures used by the renderer.
- 2026-10-20: supabase/crew.sql applied to production (owner-approved). CREW_TICK_SECRET set in Vercel (production, sensitive) and as a GitHub Actions secret.
- 2026-10-20: first live tick via crew-tick.yml: {ok:true, ready:true, ran:[]} (no agents enabled yet).

## Economy mode (2026-10-20, owner request: "mindful of costs, focus on sales")

Default ON (supabase/crew-economy.sql, applied). Settings → Economy mode / Second opinion.
- Haiku 5.5 (`claude-haiku-5-5`, $0.10/$0.50 per MTok) for sorting/scoring, triage, extraction (routeTier in context.ts) and as the economy model for Instagram/LinkedIn comments (AgentDef.economyTier). Haiku has no server-side refusal fallback, so its calls go without `fallbacks`; web search always runs on Sonnet (Haiku has no dynamic-filtering search tool). Rejected Haiku drafts escalate to Sonnet (3 of 5), then back.
- Free (no AI): every Watchdog agent (raw finding + plain sentence on the card; the fix engineer reads the raw details) and every manager report (templateReport from the counts). These need no Anthropic key (AgentDef.freeInEconomy).
- Tie-breaks on Sonnet instead of Opus; GEO asks 1 question a day instead of 3.
- Second opinion (ChatGPT debate) OFF by default; the owner is the reviewer.
- Global daily cap $2 (was $8).
Recommended first agents: Office outreach, Reddit replies, LinkedIn comments, Instagram comments, plus the free Watchdog. Expected ≈ $1/day.
Turning economy off restores the original spec exactly (Sonnet workers, Opus managers/tie-breaks, AI triage).
- 2026-10-20: CREW_ANTHROPIC_API_KEY set (Vercel + GitHub). CI's macOS `render` job repeatedly got no runner (0 steps, cancelled) while `verify` passed; 3cf020eb was force-promoted with the owner's OK (`vercel promote`). Moving `render` to ubuntu was NOT done: ci.yml documents that Linux lacks the app's font and gives false layout failures. Likely cause: Actions macOS minutes/spending limit — owner to check org billing.
- 2026-10-20: switched ON (owner-approved): system-test, the free Watchdog (watch-bugs, -speed, -security, -app, -ui, -flows, -probe) and watchdog-manager. First live run: all ok, $0.008 total (the practice draft); 8 Fix cards + 1 practice draft in the inbox.
- 2026-10-20: live fixes after enabling the sales agents: (1) web-search answers are read only after the last tool block (narration was being glued on); (2) every web-search agent now uses a required JSON shape (searchItems in sources/web-discovery.ts) at medium effort with up to 6 searches (low effort answered "[]", 3 searches ran out); (3) Office outreach accepts a team's page on its brokerage's site; (4) Reddit blocks Anthropic's web search, so the Reddit agents answer pasted posts only until the Reddit API keys exist. Live-verified: LinkedIn discovery 7-9 posts, Office outreach 1-9 call rows per run at ~$0.09. Manual live checks: vitest.live.crew.ts.

### 2026-10-20 evening: everything that needs no new key is switched on
- Turned on every agent that can run with the keys we have: Threads, Quora and Indie Hackers replies; Facebook paste replies; all Contact agents; open-web, Quora and paste leads; blog, SEO, GEO, social and competitor watch; and the Contact, Leads and Marketing managers. Stripe and Reddit agents are on too, and wait with "Needs: X" until their keys exist. Head (Fable) stays off by design.
- The daily cap went from $2 to $3 (the $100/month credit allows about $3.30 a day). Open-web leads are held at $0.60 a day so they can't use up the shared cap.
- The first run of each new agent worked except Threads: Anthropic's search refuses threads.net. Discovery now uses threads.com only, and a blocked domain gives "no results" instead of a failed run.
- Created two Google Sheets (cold leads, Office prospects) and set CREW_LEADS_SHEET_ID and CREW_OFFICE_SHEET_ID in Vercel. Rows copy over once GOOGLE_SHEETS_SA_JSON exists and both sheets are shared with its client_email.

### 2026-10-21: Bluesky replies (owner request)
- `replies-bluesky` added; it starts OFF like every new agent. It reads Bluesky's public search with no login: `api.bsky.app` `app.bsky.feed.searchPosts`. (`public.api.bsky.app` answers search with a 403 page, seen live.)
- It looks at the last 7 days of English posts. It skips labeled posts, threads with 40+ replies and our own swiftcardapp account. A refused search counts as no results, not a failed run.
- Drafts only, with a ceiling of 5 a day that warms up. SwiftCard is mentioned in at most about 1 draft in 3. Pasting a Bluesky post works too.
- Links are plain swiftcard.me, because lib/referral has no Bluesky campaign prefix yet.
- Live-checked 2026-10-21: "digital business card" and "business cards networking" find real posts; competitor names find none this week.

## The office (2026-10-23, owner request: "like real employees working in my office")

The Agents tab became an office. Nothing about what the agents do changed; how
the owner runs them did.

- **Lobby** (`?tab=lobby`, the default): "Lock the whole office" (`kill_all`),
  spend today, who is working right now, what waits in which room, one door
  card per team.
- **One room per team** (`?tab=watchdog|replies|contact|leads|office|marketing`):
  the door (open / lock in one tap, optional opening hours in New York time),
  the drafts waiting for the owner, the team chat, the manager and the staff
  board, and the team's output (lead lists, open problems).
- **Your desk** (`?tab=desk`): Hannah's (head agent) plan and questions, and
  "Hand something to the team" (the paste form). No door; only the office lock.
- **Settings**: every $ limit in one form (office, team, person), economy,
  second opinion, disclosure, missing keys.
- Old tab names (`inbox`, `teams`, `reports`, `usage`, `paste`) land in the
  lobby, settings or desk (`src/lib/crew/office-tabs.ts`).

Rules (pinned in tests/crew-doors, crew-tick, crew-manager-chat, crew-staff):

- A **door** gates workers only. Managers still write the morning report behind
  a locked door; the desk only stops for the whole-office lock. A tap while
  hours are set overrides until the next scheduled change. A lock takes effect
  at the agent's next model call (`DoorLocked` in `context.ts`), not only at
  the next tick. Overdue agents run once when the door opens.
- **Staff names** are labels only (`src/lib/crew/staff.ts`). `hired: false` and
  locked agents sit in a collapsed "Not hired yet" list unless switched on.
- **Manager chat** (`src/lib/crew/manager-chat.ts`, `crew_chat`): answers from
  a brief built in code (no draft text), Opus (Sonnet in economy), metered as
  `<team>-manager` / `chat`. Orders can only narrow: pause / resume one of its
  own team's agents, set / clear a focus (≤280 chars, 1–14 days) that is added
  to the prompt (never the system text) for search, sort and draft calls. It
  cannot switch agents on, open doors, change limits, start shifts or post.
- **Start a shift now** runs after the response (`after()`), so the button
  never hangs.
- Schema: `supabase/crew-office.sql` (`crew_teams`, `crew_chat`,
  `crew_agents.paused_until/pause_note`). Doors seed open.
