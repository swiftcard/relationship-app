# Lead discovery cost review — November 2, 2026

Base: deployed PR #143, `8584d7c1`. Review branch only; no production changes,
database migrations, manual discovery runs, outreach, or new paid services.

## Evidence and spending

The historical figures below come from recorded read-only SQL results captured
at approximately November 2, 7:45 PM America/New_York (November 3, 00:45 UTC),
in the completed “Resume Operations After Restart” Claude session. They are
snapshots, not a new production query or a live-run experiment. Its usage query
used `ORDER BY 1` (UUID), so the ten individual usage records are **samples**,
not the ten most recent calls. Do not extrapolate their distribution.

| Recorded evidence | Result |
| --- | --- |
| November 2 Web Leads usage | 2 calls, $0.0755; run saved 2 usable businesses: $0.03775 per saved usable business |
| November 2 Office usage | 5 calls over 3 runs, $0.3145; 3 usable businesses saved: $0.10483 per saved usable business |
| November 2, 22:45:35 UTC Office discovery | Sonnet, 6 searches, $0.100638; corresponding run saved 0, rejected 4 duplicates after reading 7 sites |
| October 22, 08:45:37 UTC Office discovery sample | Sonnet, 6 searches, $0.092669 |
| October 22, 04:46:54 UTC Web discovery sample | Sonnet, 1 search, $0.046086 |
| October 21, 20:15:51 UTC Office extraction sample | Haiku, $0.002138 |

“Usable” is the existing pipeline's contact-route criterion, not independent
qualification, a verified mailbox, or a confirmed named decision-maker. These
snapshots cannot establish historical cost per **verified qualified** lead or
named decision-maker. MX status verifies a domain's mail route, not a mailbox.
November 2 spending predates the final $0.20 caps; it does not show those caps
being bypassed after configuration.

Code paths responsible for spending:

* `agents/leads.ts → findBusinesses → searchItems → llm.askJson("discover")`:
  previously up to 5 server searches and 6,000 output tokens on Sonnet or the
  configured agent tier. Search-tool calls and their returned context cost money.
* `agents/office.ts → findOffices`: previously up to 6 searches with the same
  6,000-token discovery allowance. Its real-estate priority rotation and the
  PR #143 90-day history filter already existed and remain in place.
* Both agents call `assessSites → askJson("extract")`: Haiku in economy mode
  previously; potentially the agent's more expensive tier otherwise. This one
  assessment already produced people, qualification, hook and opener together;
  building another AI scoring layer would duplicate work.
* Office optionally calls `draftEmails`: a draft for each of at most two named
  email contacts, and, when second opinions are enabled, critiques, up to two
  revisions, and a tie-break. Those existing approval/review rules remain.
  Drafting follows lead persistence and is now skipped when nothing was added;
  a budget stop cannot turn a successful save into a failed run summary.
* Fetching public HTML, parsing, scoring, DNS checks, deduplication and Sheets
  synchronization do not themselves call an AI provider.

The old budget check admitted **each next call independently**, estimated half
the allowed output, and reserved nothing for subsequent enrichment. A search
could consume the remaining headroom; caught extraction failures then yielded
generic contacts with no hook or opener. Per-company duplicate checks happened
only after the site assessment, so known companies consumed fetch/AI work too.

## Focused changes

* Reuse unattempted paid-search results using existing `CrewStore` KV storage,
  scoped to each agent, for at most 90 days. No HTML or contact verdict cached.
  Filter existing companies across both lists and repeats within the result
  batch **before** fetching or assessment. Keep the database's final duplicate
  check and unique constraint. Cached runs retain the original territory/type
  and do not advance the paid-search rotation or masquerade as new searches.
* Bound these two agents' discovery to three searches and 2,500 output tokens.
  Admit the full output allowance plus $0.015 of enrichment headroom against
  the existing agent/team/shared limits before calling the provider. The
  headroom is an admission estimate, not an atomic billing reservation; search
  context, provider usage and concurrent runs still affect final spending.
* Read up to 12 relevant pages, following nested contact/about/team/staff links.
  Web Leads keeps its four-worker pool; Office remains sequential. Rate-limit
  across requests to a host, including robots requests and redirects. Use
  10-second requests, a 25-second site traversal window, and the existing run
  deadline; already-started requests may take their timeout to finish.
* Preserve SSRF/DNS-pinning checks; add an optional per-hop policy callback to
  `safeFetch` so redirected pages also require robots permission. Deny social
  profile hosts, login paths, detected challenges and explicit automated-access
  prohibitions. Robots outages deny crawling, with 404/410 or successful empty
  robots files allowed. Match wildcard/end-anchor rules and allow ties. Limit
  brokerage-hosted team traversal to the team's path to avoid mixing companies.
  This does not establish universal permission from website terms; sites with
  other applicable restrictions must remain excluded.
* Parse public mailto/tel links and corroborated schema.org Person metadata
  without AI. Named roles require nearby visible evidence. Keep extra verified
  professional contacts and public routes with exact page URLs in the existing
  new row's `notes`; no additional company rows or Sheets columns. Suppression
  and restricted-region checks also apply to retained alternate email routes.
  Generic company contacts are explicitly labeled as decision-maker unverified.
* Skip assessment of contactless records. Explicitly use Haiku in batches of
  at most six eligible sites; include bounded contact-bearing passages beyond
  the old first-2,500-character prefix. Validate/remap indices and preserve
  completed batches when a later request fails. No paid retry on an outage.
  Qualification, why/hook/openers still require AI judgment; metadata alone does
  not create a fit score or invent personalization.

The old reader fetched the homepage plus only its first two qualifying links,
without following their links. Web Leads could obtain a name only from model
assessment; without it, even public structured people became anonymous rows.
That combination missed team profiles behind about/team pages and contact
information following long navigation sections.

## Comparison and limits

Tests use fake providers, DNS and external requests. No real paid discovery or
messages were initiated. `crew-lead-costs.test.ts` uses the repository's existing
price table and preserves the exact recorded token/cache work for the forecast:

| Controlled comparison | Before | Proposed |
| --- | --- | --- |
| Six-search recorded discovery + independent recorded extraction sample | $0.102776 | $0.072776 if only 3 searches are needed |
| Cost per qualified saved lead, **assuming two in each scenario** | $0.051388 | $0.036388 |
| Cost per named decision-maker, **assuming one in each scenario** | $0.102776 | $0.072776 |
| Discovery calls to consume a 12-result Office search in 8-site batches | 2 (leftovers discarded) | 1, then cached leftovers |
| Saved companies fetched/reassessed | Yes | Excluded before those steps |
| AI-unavailable Person+mailto+tel fixture | Anonymous email; tel-only phone missed | 1 evidenced named professional and telephone retained |
| Nested team-page fixture | Homepage/about/contact only; profile contact missed | Profile contact found within 12-page cap |
| Second professional at same company | Web row retained anonymous additional address | Name, role, email and source retained on the one company row |

The cost rows are **fixed-yield forecasts**, not an observed paired experiment.
The two historical calls are from different runs. The November 2 six-search run
actually saved **zero** leads, so its real cost per saved lead is undefined.
The three-search allowance may return fewer companies; existing code comments
documented that possibility. Qualification has not been relaxed to compensate.
Cache reuse and early deduplication eliminate specific unnecessary calls, but
live savings and named-contact yield require measurement after release.

Named role checks and conservative metadata parsing can miss unusual markup;
JavaScript-only sites, restricted pages and unclear associations remain missing
instead of being guessed. AI reasons and opener paraphrases still need human
review. Extra contacts reside in existing notes and do not acquire separate
mailbox/DNS-verification statuses or new Sheet cells.

## Validation and release

* Full suite: 8,435 tests passed in 464 files (includes the new cost/crawl tests).
* Final focused suite: 103 tests passed in 12 files, including three additional
  per-redirect policy/SSRF tests introduced after the full suite started.
* Lint: zero errors; 43 existing warnings outside the changed implementation.
* Source TypeScript passed. A source-only repeat excludes generated `.next`
  output after the failed build; no compiler options or application guards
  changed. Normal clean-worktree `tsc --noEmit --incremental false` also passed
  before build-generated route validators were present.
* Production build: webpack compiled successfully, then failed generated route
  checks for existing exports `localAnswer`, `SHARE_REPEAT_WINDOW_MS`,
  `withinSmsQuietHours`, and `MAX_VIDEO_BYTES` in four unchanged API route files.
  Their source is identical to `8584d7c1`. Default Turbopack also rejects this
  worktree's dependency symlink; webpack was used as an explicit local fallback.
  Do not describe the build as green or merge before resolving the build gate.

No schedule/default-budget declarations, production configuration, enabled
states, dry-run/outreach permissions, Sheets column/status logic, saved leads,
user notes, suppression store or database schema were changed. Existing KV
storage is sufficient. Integration uses the current two agents and store API;
no new infrastructure is needed. Build gates and review still apply.

Release recommendation:

1. Leave this PR unmerged through the November 3 10:00 AM Office and 10:30 AM
   Web scheduled runs (America/New_York). Around 11:15 AM, verify run counts,
   recorded costs, duplicates, sourced named contacts, Sheets rows and zero
   outbound touches. No manual rerun is needed.
2. Review this diff and resolve the existing generated-route build errors via
   the appropriate separate change or verified build environment. Require green
   PR CI and an approved production build before release.
3. After explicit release approval, merge/deploy without changing schedules,
   caps, dry run, agent states or outreach permissions. Observe the next normal
   runs; compare saved usable and qualified named leads, spend, blocked sites,
   cache use and missing openers. Do not buy extra test runs.
4. If the three-search bound reduces qualified yield per dollar or stricter
   source checks reject genuine contacts, revise/revert this focused change
   through review. Do not raise budgets or weaken qualification to hit a target.
