# AUDIT — the agent system before and after the Google Sheets headquarters

_Written 2026-10-26 for the rebuild (PR 1 of 4: `agents/sheets-hq`). Updated as each later PR lands._

## 1. What exists

The agent system ("Crew") lives in `src/lib/crew/` and was built 2026-10-20 to 10-24 (plan and build log: `docs/plans/agent-system.md`). It is a working runtime, not a prototype:

| Piece | Where | Keep? |
|---|---|---|
| Registry of agents (`AgentDef`: id, team, schedule, budget, `run()`) | `registry.ts`, `agents/*.ts` | **Keep.** Every agent below is listed there. |
| The clock: GitHub Actions every 15 min → `POST /api/crew/tick` (Bearer `CREW_TICK_SECRET`), New York time schedules | `.github/workflows/crew-tick.yml`, `tick.ts`, `schedule.ts` | **Keep.** Vercel's cron on this plan is daily-only (two crons in `vercel.json`); no pg_cron or Edge Functions are in use. |
| Budgets: per agent / team / global $ per day, economy mode (Haiku for sorting, no AI for reports) | `budget.ts`, `context.ts`, `crew_usage` | **Keep.** Global cap $3/day. |
| Approvals: `propose()` is the only way work leaves an agent; one live reply per thread; the DM rule (`crew_claim_dm`) | `approvals.ts`, `decide.ts`, `crew_approvals` | **Keep, reuse as the task store.** Every Sheet row that is a draft is one `crew_approvals` row. |
| People ledger: one person across platforms, normalized handles, touches | `ledger.ts`, `crew_people/identities/touches` | **Keep.** The Pipeline tab and the opt-out logic are built on it. |
| Leads: public business emails, source + date per row, GDPR-style regions flagged, suppression checked on insert | `leads/*.ts`, `crew_leads`, `crew_suppression` | **Keep, improve.** Suppression had **no write path** (nothing ever added to it); PR 1 adds the Sheet, the opt-out words and a write path. |
| Findings (Watchdog): fingerprinted problems → Fix cards → `crew-fix.yml` opens a PR | `watch/*.ts`, `crew_findings` | **Keep untouched.** This is the admin page now. |
| Old Google Sheets mirror: append-only copy of leads to two plain sheets via a hand-signed service-account JWT | `sources/sheets.ts` | **Replaced** by the workbook; the old mirror stays quiet once `CREW_SHEET_ID` is set. The JWT code moved to `google/auth.ts`. |
| Admin page `/admin/crew` (Home, Tasks, one page per group, Settings, chat with each manager) | `src/app/admin/crew/*` | **Trimmed** to the Watchdog. Everything else is run from the Sheet. |
| Owner email (Resend → `agent_system.digest_email`), push (`src/lib/push.ts`) | `src/lib/owner-digest.ts` | **Keep.** The morning brief (PR 4) uses both. |
| Leftover from the retired "Agent Flow": `/api/agents/pinterest/pin` (posts a pin by itself when called; its workflow has no schedule since 2026-10-19), 18 `agent_*` tables | `src/app/api/agents/*`, `supabase/agent-*.sql` | **Leave alone, documented.** Nothing calls the pin route on a schedule. The Content Creator's own-content publishing (PR 2/4) will reuse the stored Pinterest/LinkedIn/YouTube connections from `agent_connections`, read-only, behind Approve and dry run. |
| Product opt-outs `message_opt_outs` (Resend bounces/complaints, unsubscribe routes) | `src/lib/messaging.ts` | **Keep separate.** PR 3 feeds it one way into `crew_suppression` (a customer who unsubscribed from product mail is never cold-emailed). Crew never writes to the product list. |

Secrets live in Vercel and GitHub Secrets only. Crew reads its own key names (`CREW_*`), never the product's AI keys (pinned by `tests/crew-guards`).

## 2. Every agent

Columns: what it does · data source · sends anything? · what you do · where it shows now · decision.

### Watchdog (stays on `/admin/crew`)

| Agent | Does | Source | Sends? | You | Decision |
|---|---|---|---|---|---|
| watch-bugs | New production errors → Fix cards | `error_events` table | No (a Fix opens a PR when approved) | Approve the Fix | Keep |
| watch-speed | Speed budget and uptime breaches | `uptime.yml` → `/api/crew/ingest` | No | Approve | Keep |
| watch-ui / watch-flows / watch-probe / watch-app | Nightly QA failures (screens, flows, analytics, phone shells) | `nightly-qa.yml` → ingest | No | Approve | Keep |
| watch-security | TLS, headers, DNS, sign-up and error spikes | own checks | No (asks) | Answer | Keep |
| watch-payments / watch-revenue | Failed payments, trials ending, plan drift | Stripe read-only key (not set yet) | No (asks) | Answer | Keep |
| watch-scan-cost | — | — | — | — | Locked placeholder (deferred) |
| watchdog-manager | Daily report | counts | Emails you | Read | Keep |

### Replies (Google Sheet: one tab each)

| Agent | Does | Source | Sends? | You | Tab |
|---|---|---|---|---|---|
| replies-reddit | Finds threads where an answer helps; drafts a reply; ≤⅓ mention SwiftCard, with "I built this" | Reddit API when keys exist (not yet; Reddit blocks AI web search), else pasted posts | No | Copy, open the exact thread/comment, post, set Sent / Posted | **Reddit Reply** |
| replies-threads / quora / indiehackers | Same, via Claude web search limited to that site | web search | No | Copy & open | Threads Replies / Quora Replies / Indie Hackers |
| replies-bluesky | Same, via Bluesky's public search | `api.bsky.app` | **Can**, only when you set Controls → "Bluesky: Approval posts it", connect the account and turn Dry run off; otherwise Copy & open | Approve or Copy & open | **Bluesky Engagement** |
| replies-facebook | Replies to group posts you paste (no API) | Paste a Post tab | No | Copy & open | Facebook Groups |
| replies-instagram | Comments on pros' posts you paste; weekly follow list | Paste a Post | No | Copy & open | Instagram Comments |
| replies-linkedin | Comments on specific posts | web search + paste | No (LinkedIn's API can't comment on others' posts) | Copy & open | LinkedIn Engagement |

### Contact (DMs)

| Agent | Does | Source | Sends? | You | Tab |
|---|---|---|---|---|---|
| contact-reddit | DMs to people asking for a card / link tool | Reddit API or paste | No | Copy, Open chat (`reddit.com/message/compose/?to=`), send | Reddit DMs |
| contact-instagram | DMs about a specific post | web search + paste | No (no API for cold DMs) | Copy, Open DM (`ig.me/m/<user>`, opens the app on a phone; profile link always works), send | Instagram DMs |
| contact-instagram-linkinbio | Pros whose bio links out (LinkedIn, Linktree, Link.me, Hoobe) | web search + paste | No | Same | **Instagram LinkedIn Bio** |
| contact-linkedin | Connection note + follow-up | web search + paste | No (invites are manual; the Messages API is partner-only) | Copy & open | LinkedIn Engagement |
| contact-alignable | Neighborly hellos to pasted profiles (no API) | Paste a Post | No | Copy & open | Alignable |

### Leads

| Agent | Does | Source | Sends? | Tab |
|---|---|---|---|---|
| leads-web | Business sites by type × US city → published emails, robots.txt obeyed | web search + polite fetch | Never | **All Leads** |
| leads-reddit | Emails people post publicly | Reddit API (keys pending) | Never | All Leads |
| leads-quora | Same on Quora | web search | Never | All Leads |
| leads-facebook / leads-alignable | Emails in pasted text, no AI | Paste a Post | Never | All Leads |
| leads-linkedin | **Locked** (scraping breaks LinkedIn's terms) | — | — | — |

### Office, Marketing

| Agent | Does | Source | Sends? | You | Tab |
|---|---|---|---|---|---|
| office-outreach | NYC teams: decision-makers with the phone/email their own site shows, a talking point, 2 email drafts a run, weekly partnership ideas | web search + site read | No | Call / email, set Contacted | **Office Prospects**, **Partnerships** |
| marketing-blog | One SEO post a week | — | **Publishes on Approve** (blocked by dry run) | Approve | Content Creator |
| marketing-seo | Title/description/h1/canonical/JSON-LD/alt checks on our pages, one Fix a day | sitemap | No (Fix → PR) | Approve | **SEO Opportunities** |
| marketing-geo | Asks buyer questions with web search, tracks whether SwiftCard is named; proposes llms.txt / schema | web search | No | Approve | **GEO Opportunities** |
| marketing-social | One idea a day, 3 options, then every size + captions (rendered by `crew-render.yml`) | — | No (you post) | Pick, download, post | Content Creator |
| competitor-watch | Wed + Sun: competitors' own pricing pages → dated facts; price change → compare-page Fix | web search | No; emails a report | Approve | **Competitor Intel** |
| *-manager ×5, head | Daily reports / tomorrow's plan | counts | Email you | Read | **Retired 2026-10-27** (§6): the Sheet's Dashboard and Agent Performance replaced the rooms they reported into. Only watchdog-manager remains. |
| system-test | A practice draft | — | No | — | **Removed 2026-10-27**: now a test fixture (`tests/crew-practice-agent.ts`) |
| **sheet-sync**, **sheet-daily** (new) | The Sheet: read your edits, write rows, rebuild computed tabs; daily snapshot | — | No | — | Infrastructure: always on, runs through Pause all |

**Does any agent send anything by itself?** No. Before this PR nothing could reach the public except an approved blog post (and a Fix PR). After it, the only additions are approval-triggered and dry-run-gated: a Bluesky reply when you turn its tier up. Cold email does not exist yet (PR 3), and nothing will send until `Dry run` is No in Controls.

## 3. Platform rules (checked 2026-10-26)

Tiers: **1 Auto** (official API, no human step) · **2 Approval** (prepared; a Status of Approved makes the backend post it) · **3 Copy & open** (prepared message + exact link; you paste).

| Platform | Reading / finding | Posting / messaging | Tier | Notes and links |
|---|---|---|---|---|
| Reddit | Data API with app approval (Responsible Builder Policy, Nov 2025; commercial use needs a separate agreement). Keys not set, so pasted posts only today. Reddit blocks Anthropic's web search. | The API can post (`submit` scope) under the owner's own OAuth; unverified for our app, and commercial posting bots are what the policy screens. | **3** | [Responsible Builder Policy announcement](https://www.reddit.com/r/redditdev/comments/1oug31u/introducing_the_responsible_builder_policy_new/) · Data API Terms (revised 2026-07-20). Row link = the exact thread or comment permalink. |
| X | Free tier gone for new apps; pay per use (~$0.005 per read, ~$0.015 per write, higher with links). | Posting via API is allowed on paid tiers; our X connection exists (`agent_connections`). | **Placeholder** (Controls → Paid services) | [X API pricing overview](https://www.postproxy.dev/blog/x-api-pricing-2026/) (third-party; verify on developer.x.com). |
| LinkedIn | Public posts via Claude web search; profiles may not be stored (User Agreement). | Commenting on others' posts needs Community Management `w_member_social`, not self-serve; `r_member_social` closed. | **3** | [Comments API](https://learn.microsoft.com/en-us/linkedin/marketing/integrations/community-management/shares/comments-api) · [Social actions](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/network-update-social-actions). |
| Instagram | No profile/bio search in the Graph API. Business Discovery needs a known username; hashtag search needs Public Content Access review (30 hashtags / 7 days, can't comment). | Cold DMs: no API. ig.me links open a thread in the app. | **3** | [Business Discovery](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-facebook-login/business-discovery) · [Hashtag search](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-facebook-login/hashtag-search) · [ig.me links](https://developers.facebook.com/docs/messenger-platform/instagram/features/ig-me-links). Licensed-data alternative listed under Controls → Paid services. |
| Facebook | Groups have no API since 2024. | — | **3** (paste) | — |
| Threads | Keyword search needs `threads_keyword_search` app review; until then only own posts. | Replying to others' posts: not available self-serve. | **3** | [Keyword search](https://developers.facebook.com/documentation/threads/keyword-search). |
| Bluesky | Public search, no key (`app.bsky.feed.searchPosts`). | Open protocol: app password + `com.atproto.repo.createRecord` reply. | **2** | [AT Protocol docs](https://docs.bsky.app/). Posting is behind Controls → "Bluesky: Approval posts it", the connection, and Dry run = No. |
| Hacker News | Algolia HN search, free (~10k req/h). | No posting API. | **3** (PR 2) | [hn.algolia.com/api](https://hn.algolia.com/api). |
| Quora, Indie Hackers, Alignable | Web search / paste; no APIs. | None. | **3** | — |
| Pinterest, YouTube, LinkedIn (own posts) | — | Publishing our own content through the stored connections. | **2** (Content Creator, PR 2/4) | Existing `agent_connections` modules. |
| TikTok | — | Content Posting API needs an audit; download + caption meanwhile. | **3** | — |
| Google Sheets / Drive / Calendar | Service account; 300 reads + 300 writes a minute per project (batched; ~40 requests a sync). Service accounts own no Drive storage, so the workbook lives in a Workspace Shared Drive. | — | 1 | [Sheets limits](https://developers.google.com/sheets/api/limits) · storageQuotaExceeded on My Drive is why a Shared Drive is required. |
| Gmail (cold email, PR 3) | — | Workspace inbox on a secondary domain, SPF/DKIM/DMARC, List-Unsubscribe + visible link, 25/inbox/day. | 1, after setup + warm-up + Dry run off | [Gmail sender guidelines](https://support.google.com/a/answer/14229414). |
| Google Places (PR 2) | Text Search Pro: 5,000 free calls a month, then $32/1,000. | — | 1 (capped at 4,500/month unless approved in Controls) | Third-party price pages; verify on Google's pricing page. |

**Never built:** scraping of LinkedIn, Facebook, Alignable or Instagram; browser automation; fake accounts; unofficial posting.

## 4. What PR 1 changed

- **One workbook, "SwiftCard Leads"**, created by the backend in the Shared Drive (or pinned by `CREW_SHEET_ID`), shared with `CREW_SHEET_SHARE_EMAILS`. 13 operating tabs (the spec's 12 + Paste a Post) and 21 agent tabs, each with its own columns (`src/lib/crew/sheets/tabs.ts`). Frozen bold headers, filters, widths, wrapping, dropdowns, colours, protected Controls.
- **Two-way sync** (`sheets/sync.ts`): every 15 minutes the backend reads every tab the owner can type in (one request), applies Status / Notes / message edits through the same `decide()` the admin buttons use, then writes new and changed rows by Key and rebuilds the Dashboard, Action Queue, Intent Leads, Top 50, Source Stats, Agent Performance, Activity Log, Controls and Suppression List. An Apps Script hook (`apps-script/SwiftCardLeads.gs` → `/api/crew/sheet-hook`) applies an edit within seconds; the poll is the fallback. **Delay: seconds with the script, up to 15 minutes without.**
- **Statuses**: Sent / Posted and Completed record what you did and never send. Approved runs an executor only for kinds that have one (blog post, Fix PR, and a Bluesky reply when its tier allows), and only when Dry run is off. Not Interested / Unsubscribed suppress every identity of the person and add an `opted_out` touch, so no agent on any platform drafts to them again.
- **Controls tab** backed by `crew_controls`: pause all, dry run (starts Yes), spending caps, economy, per-platform tier, paid-service approvals, per-agent on/off, schedule and cap. Validated in the backend; a bad value is written back.
- **Writing check** (`writing-check.ts`): the owner's banned list, em dashes, stacked exclamation points, pitch bullets, hashtags; one rewrite, then Needs Review. Owner edits to messages are stored (`crew_edits`) and the last 30 are shown to the model as examples.
- **Admin page**: Watchdog only, with a link to the Sheet. Marketing agents keep running; their on/off moved to Controls.

## 5. What PR 2 changed (owner's model, 2026-10-27: "press Start and it just keeps going")

- **Start / Stop on the admin Agents tab** (`SheetAgents.tsx`, `sheet-agents.ts`): one row per marketing agent, named after its tab, with what it does, its state (Running, Working now, Done for today, Stopped, Paused, Failed, Needs setup), rows added today, and one button. Start = on, any pause cleared, and a run right away; Stop = off at its next step. The Sheet's Controls tab flips the same switch ("Start / Stop"). The admin page keeps the Watchdog group as before; the old paste form, lead lists and their routes (`/api/admin/crew/paste`, `/api/admin/crew/leads`) are gone (Paste a Post and the lead tabs are in the Sheet).
- **One tab per agent, named after it** (28 agent tabs): Instagram LinkedIn Bio, Instagram DMs, Instagram Comments, Reddit Reply, Reddit DMs, LinkedIn Comments, LinkedIn Connections, Quora Answers, Threads Replies, Bluesky Replies, Facebook Groups, Indie Hackers, Alignable, Hacker News, Office Prospects, Partnerships, Events, Web Leads, Reddit Leads, Quora Leads, Facebook Group Leads, Alignable Leads, Social Media, Blog Writer, SEO Opportunities, GEO Opportunities, Competitor Intel, X Replies (placeholder). All Leads is now the combined view of the lead tabs, rebuilt every sync.
- **Continuous** (`AgentDef.continuous`): the finders run every tick (15 minutes) while on, each run searching somewhere new (a rotation of profession × problem or profession × city, `search-plan.ts`), up to the Safe daily ceilings with the five-week warm-up. A run with nothing new rests an hour; at the ceiling it rests until just after New York midnight (`RunResult.restMinutes`), so an agent left on costs nothing while it waits. Content agents (blog, social, SEO, GEO, competitor watch) keep their day schedule; paste agents still wait for a paste. The old team "doors" no longer gate the marketing agents (nobody can see them now); they still gate the Watchdog.
- **Exact links** (`exact-links.ts`): a found item becomes a row only if its link is the exact Reddit thread or comment, Threads post, Quora question, LinkedIn post, Indie Hackers post, Bluesky post, Hacker News item, Instagram post, or (for people) the exact Instagram or LinkedIn profile. Instagram rows open the chat in the app (`ig.me/m/<user>`); Reddit DMs open Reddit's message screen addressed to the person; LinkedIn connections open the profile where the Connect button is.
- **New and rebuilt agents**: Instagram LinkedIn Bio now finds professionals whose bio links to their LinkedIn (name, occupation, company, location, LinkedIn) and writes from the bio; LinkedIn Connections finds profiles, not posts; Hacker News (free Algolia search, checked live 2026-10-27); Partnerships (its own agent, was a weekly line inside Office outreach); Events.
- **Voice**: Menash's voice; no dashes of any kind (em, en, or a spaced hyphen; caught by the check and stripped); SwiftCard comes up only with a reason that fits that person, in one sentence, never a feature list; "I built…" inside the sentence counts as the disclosure, so the tacked-on line only appears when a draft forgot.
- Still next: the 1,000-lead engine with scoring (PR 3 now), cold email + replies + meetings, the 8:00 brief and cleanup.

## 6. The audit after PR 2 (2026-10-27)

An independent review of PRs 1 and 2 found twelve problems. All twelve were
real; all are fixed and each is pinned by a test (`tests/crew-sheet-audit.test.ts`
unless noted).

| # | Problem | Fix |
|---|---|---|
| 1 | The Sheet keepers (`sheet-sync`, `sheet-daily`) started off and nothing turned them on, so the Sheet never synced. Pause all also stopped them, so a Pause set in the Sheet could not be lifted there. | `AgentDef.infrastructure`: they run whatever their switch says and through Pause all, first in every tick. Only `CREW_DISABLED` stops them. |
| 2 | The Controls tab undid an admin Start / Stop: the old "Running" still in the cell was read back as the owner's choice. A real change in the Sheet was stamped in Last Changed only when the typed word differed from the shown one. | The sync remembers what it last wrote into each Controls cell (`sheet:controls-shown`); only a different value counts. Every real change is stamped and logged once, from the hook or the sync. |
| 3 | The Blog tab's caption cell looked editable but was overwritten. | Read-only. |
| 4 | Sent / Posted or Completed on a row went through Approve, so Completed on an unapproved blog post would publish it and a Fix would open a pull request. | New decision `done_by_hand`: records it as done (and the contact), never runs anything. |
| 5 | A stale copy of a Status (the Action Queue still showing the old word) was read as a decision and could undo one made on the agent's tab or the admin page. | `crew_sheet_rows.shown_status`: a cell counts only when it differs from what the sync last wrote everywhere. Changed in two copies at once, the agent's own tab wins. Notes are applied before the Status. The computed tabs' other columns are read-only copies. |
| 6 | Reads stopped silently at 1,000 rows (PostgREST's limit): spend, leads and Sheet rows were undercounted past that. | `paged()` (`src/lib/crew/paged.ts`) on every read that can pass it. |
| 7 | A row the owner deleted came back every 15 minutes, and a long tab was only read up to row 2,000. | A row placed before and now gone stays gone; tabs are read to the end; rows are matched per tab. |
| 8 | Leads from restricted regions (EU, UK, Switzerland, Canada, Brazil) reached the Sheet. | Left out, as in every export. |
| 9 | Not Interested / Unsubscribed on someone known only by a display name (Quora, Facebook, LinkedIn comments) blocked nothing; a handle typed into the Suppression List was stored in a form the agents never check. | The name is suppressed on that platform and the reply engine skips it; typed entries are normalized (`instagram:Jane` → `instagram:@jane`), and an unknown platform or empty handle is refused. |
| 10 | Drafts made before the exact-link rule showed search-result links; Office Prospects opened a website even when an email was known. | Social drafts without an exact link are not shown; pasted ones say "(pasted without a link)"; Office rows open an email when there is one. |
| 11 | Leftovers from the old admin rooms: five marketing managers and the head agent still ran and emailed daily reports nobody could reply to; the chat and group routes accepted any team; saving Settings could wipe a hidden team's limit; the practice agent was registered. | Removed (see below). The chat and group routes answer only for the Watchdog; Settings keeps limits it has no field for. |
| 12 | Smaller: the reply cap was checked after paying for a search; two different daily lead limits; a model call could start after Pause all; a schedule written the way the Controls tab shows it didn't read back; the hook accepted edits to any Controls column. | All fixed; schedules round-trip; the hook takes only the Value column and refuses everything else before touching the database. |

Found while fixing these: `supabase/crew-sheets.sql` lacked the
`shown_status` column the code writes (every Sheet row write would have
failed). Added, with an `alter table` for a database that ran the earlier
copy; the sync reports "not ready" until it exists, and a test now compares
the table with the code's row type.

**Removed cleanly:** the marketing teams' managers (`replies-manager`,
`contact-manager`, `leads-manager`, `office-manager`, `marketing-manager`)
and their daily emails; the head agent (`agents/head.ts`) and its plan;
the practice agent (moved to `tests/crew-practice-agent.ts`); the "head"
role; their staff names; unused exports (`StatusPill`, `DoorPill`,
`DoorIcon`, `ROOM_JOB`, `describeSchedule`, `ZERO_USAGE`, `totalTokens`,
`PageCheck`, `checkWriting`, `getFile`, `tabForAgent`, `instagramSwitchers`).
Nothing in the database is deleted: old reports and chat rows stay as
history.
