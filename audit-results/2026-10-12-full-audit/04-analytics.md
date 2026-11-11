# 04 — Analytics end to end (read-only audit, 2026-10-12)

Repo: C:\Users\Malve\Desktop\SwiftCard\relationship-app @ 655a4480 (worktree dirty, other sessions editing).
Method: source read of every writer/reader of card_views, card_events, leads, notifications, analytics_events, product_events, site_pageviews, analytics_ingest_log + the SQL functions in supabase/*.sql; checked against the production aggregates supplied by the caller. No repo files touched.

## Findings (appended as confirmed)

### A-01 The "36% card_events without card_views" gap is mostly a key mismatch + pre-unification history, not live double-counting
- Severity: Medium (trust question; no live bug in the current write path)
- Platform: all
- Account type/plan affected: all
- Feature/page: card_events vs card_views reconciliation
- File/component/function: src/app/api/card-events/route.ts:278-311 (view recorded via recordView BEFORE the event row; early return on any non-"recorded" outcome); src/lib/record-view.ts:154-368; src/components/CardEventTracker.tsx:117-119 ("No second POST to /api/views")
- Problem: Since the unification a viewed_card event row is written ONLY after recordView() returned "recorded" (route.ts:301-311 returns on deduped/self/inactive/hosting/error). For current traffic the two tables cannot disagree in the events-without-views direction. The 109 orphan events come from: (a) KEY MISMATCH in the comparison — card_events.card_owner_username is always the bare slug with surface='links' (route.ts:143,279,458,479) while the matching card_views row is under "<slug>__links"; the 51 surface='links' events never join on username; (b) rows written before the unification, when card_views came from a separate /api/views POST with its own gates (Sep: 102 events vs 79 views is where the old /api/views was gated harder); (c) the 230 surface=NULL events predate analytics-accuracy.sql; (d) the 23505 race where card_views wrote and card_events lost (route.ts:523-532, logged "deduped" while a bar exists) — opposite direction.
- Expected behavior: one view = one card_views row + one card_events row, joinable.
- Actual behavior: historically divergent; current code converges. Dashboards count DIFFERENT tables: Traffic chart/counters/unique viewers/locations/milestones/office view stats = card_views; link taps, contacts saved (office_employee_contact_stats), contact timeline, "3rd visit this week" (countRecentVisits route.ts:57-76) = card_events.
- How to reproduce: appendix-C SQL Q1/Q2.
- Likely cause: two tables, two historical pipelines, one keyed by surface suffix.
- User impact: today's owner-facing numbers are internally consistent; Jul-Sep figures in Traffic vs contact timelines do not reconcile; "N visits this week" (card_events) can differ from bars (card_views) for old visitors.
- Confidence: Confirmed (code) / Suspected (exact decomposition needs Q1/Q2)

### A-02 Traffic source is whatever the URL says: ?source= is unvalidated, spoofable, and inflates "QR & NFC scans"
- Severity: Medium
- Platform: web (card page and Swift Links page)
- Account type/plan affected: all; Office admin "QR & NFC scans" column and CSV
- Feature/page: dashboard Traffic sources; office_employee_view_stats.scans; office_traffic_sources; notifications ("from a QR code")
- File/component/function: src/app/[username]/page.tsx:134-142 (source = (sourceParam ?? "direct_link").slice(0,48)); src/app/links/[username]/page.tsx:135-136; src/app/api/card-events/route.ts:88 (str(body?.source,48)); src/lib/record-view.ts:279-282 (generic to specific "upgrade in place")
- Problem: any string up to 48 chars is accepted and stored verbatim into card_views.source and card_events.source; no allowlist against SOURCE_LABELS (src/lib/source-labels.ts). The same visit can be re-labelled: a later request inside the 30-min window with a non-generic source overwrites a direct_link row's source, so a visitor who opens the plain link then re-opens with ?source=qr_code converts the row into a "scan".
- Expected behavior: only known source keys stored; unknown becomes direct_link/unknown.
- Actual behavior: production has a NULL-source row already; office CSV "QR & NFC scans" counts source IN ('qr_code','nfc_card') from client-controlled input; getSourceLabel falls back to source.replace(/_/g," ") so an arbitrary key becomes a legend label.
- How to reproduce: open https://swiftcard.me/<slug>?source=nfc_card from a laptop, dwell 3s; dashboard Traffic shows an NFC tap; office admin shows +1 scan.
- Likely cause: attribution built as a hint, never hardened.
- User impact: Scan/NFC counts and "from a QR code" notifications are unverifiable.
- Confidence: Confirmed

### A-03 Admin analytics counts rows of deleted owners (34% of card_views, 84% of leads are orphans)
- Severity: High (the owner's own traction dashboard)
- Platform: /admin/analytics
- Account type/plan affected: admin only
- Feature/page: src/app/api/admin/analytics/route.ts:105-163 (cardTotal, leadTotal, recentLeads, leadOwners/topCards/activatedCards, viewTotal, recentViews)
- Problem: every aggregate reads card_views / leads with no join to cards/profiles. Production: 101/298 card_views and 205/245 leads reference usernames that exist in neither table. supabase/analytics-cleanup-2026-09-23.sql deleted orphans once; the ongoing delete path leaves them (see A-10). "activatedCards" = distinct lead.card_owner strings including deleted cards; "Top cards by leads" lists slugs that 404.
- Expected behavior: admin KPIs count live entities or say "including deleted accounts".
- Actual behavior: viewTotal/leadTotal/activated-cards/top-cards are dominated by throwaway QA accounts and deleted users.
- How to reproduce: compare admin "Total leads" with appendix Q5.
- Likely cause: account purge deletes by user_id; analytics tables are slug-keyed.
- User impact: leads KPI ~6x too high; views ~1.5x.
- Confidence: Confirmed (code + supplied aggregates)

### A-04 rename_card_slug skips product_events/site_pageviews; legacy profile slugs have no rename path
- Severity: Low
- Platform: all
- Account type/plan affected: anyone who renames a card link
- Feature/page: card link rename
- File/component/function: supabase/analytics-final-review-2026-10-06.sql rename_card_slug (covers cards, card_views both keys, card_events, leads, analytics_events, notifications.card_owner + visit_key, analytics_ingest_log)
- Problem: product_events.props / site_pageviews.path embedding a slug are not rewritten (admin website/funnel by path fragments). The function handles only cards.username; the legacy profiles.username fallback (route.ts:555-557, self-traffic.ts resolveOwnerId) has no rename SQL.
- Expected behavior: every slug-keyed analytics table follows the rename.
- Actual behavior: partial.
- How to reproduce: rename a card, open /admin/website funnel by path.
- Likely cause: tables added after the function.
- User impact: Low for owners; admin funnels fragment.
- Confidence: Confirmed

### A-05 Office date ranges: presets are owner-local, custom ranges are UTC
- Severity: Low
- Platform: Office admin analytics
- Account type/plan affected: Office
- Feature/page: /office/admin/analytics date picker
- File/component/function: src/lib/office-analytics-dates.ts resolveDateRange (tz branch skipped when preset === "custom"); office_daily_views_tz vs office_daily_views
- Problem: "Last 7/30/90 days" bound days in the viewer's zone (sc_tz); a custom From/To uses UTC midnight. For a New York office a custom "Oct 1-7" starts 8pm Sep 30 local and ends 8pm Oct 7, so its total differs from the preset total and from the daily bars (office_daily_views_tz).
- Expected behavior: one calendar for all three.
- Actual behavior: two.
- How to reproduce: select 7d, note total; pick custom with the same dates; totals differ when a view fell between 8pm and midnight local.
- Likely cause: custom branch predates tz support.
- User impact: Office admins see numbers that do not add up.
- Confidence: Confirmed (code)

### A-06 "219 of 245 leads from QR" is the seeded sample contact, not scans: every new card inserts a lead with source='qr_code'
- Severity: High (admin KPI + "activated cards" + lead source split are fiction)
- Platform: all (writer), /admin/analytics (reader)
- Account type/plan affected: every account (seeded on first card); admin only sees the damage
- Feature/page: src/lib/demo-contact.ts:12-26 (seedDemoContact inserts name "Jordan Rivera", source: "qr_code", tags ["demo","unread"]); called from src/app/api/cards/route.ts:8, src/app/api/drafts/claim/route.ts:11, src/app/api/contacts/seed-demo/route.ts:4
- File/component/function: src/app/api/admin/analytics/route.ts:108-132 — leadTotal, recentLeads/bySource, leadOwners/topCards/activatedCards read `leads` with NO `tags` filter; the office path (office-analytics-accuracy.sql office_employee_lead_stats, lib/office-leads.ts:130, rate-us.ts:26, team-alerts.ts:167, dashboard/page.tsx:528/714, push/recap:313) all exclude 'demo' — admin analytics is the one reader that forgot
- Problem: the lead form itself does not default to qr_code (api/leads/route.ts:271 stores `source || null`; client forms forward the page's ?source=), so the only systematic writer of source='qr_code' is the seeder. 219/245 ≈ one per card ever created (cardTotal + deleted/QA cards), and 205 orphaned leads ≈ the seeded contact of every deleted/QA account (A-03). "activatedCards" (cards with ≥1 lead) therefore equals "cards that exist", and "Top cards by leads" ranks whoever happened to collect a second real lead.
- Expected behavior: admin lead KPIs exclude tags @> '{demo}' (and the bySource chart should not show "QR code" as the dominant channel).
- Actual behavior: admin "Total leads" ~245 when real leads are likely ~26; source split says QR ≈ 90%.
- How to reproduce: appendix C Q6 (`select source, count(*) filter (where 'demo' = any(tags)) ...`).
- Likely cause: seeder added for the guided tour after the admin page; the exclusion was added to every customer-facing reader but not the admin one.
- User impact: the owner's own traction and channel-mix numbers are wrong; marketing conclusions ("QR works, links don't") drawn from them are unfounded.
- Confidence: Confirmed (code) — exact split needs Q6

### A-07 The datacenter exclusion fails open: no second-opinion lookup → isHosting=false → "Ashburn, US" rows are counted
- Severity: Medium
- Platform: all public ingest (views, saves, link taps, leads location)
- Account type/plan affected: all
- Feature/page: Traffic counters, Locations tab, "viewed your card" pushes
- File/component/function: src/lib/request-geo.ts:137-161 (resolveGeo: `org = second?.org ?? null`; `isHosting: isCloudHostingOrg(org)`), :293-313 (secondOpinion: 600 ms timeout, keyless ipwho.is when IPINFO_TOKEN unset, any failure cached as null for 15 min), :382-398 (CLOUD_HOSTING regex)
- Problem: the Vercel edge headers carry city/region/country but never an org, so the hosting verdict rests entirely on the second database. When that lookup times out (600 ms is tight for a cold lambda), returns non-200 (ipwho.is keyless quota), or the IP is not public, `org` is null and the request is treated as a person — with the edge city ("Ashburn, US", "Quincy, WA", "Boardman, OR") stored as location. The null result is then cached per IP for 15 min, so a scanner's whole burst passes. The regex also misses common crawler egress (Vercel, Fly.io, Cloudflare Workers is explicitly whitelisted as a privacy relay, Fastly likewise, OVH abbreviations, "Limestone", "ColoCrossing", "Psychz", "Zenlayer" ok, "Oracle" only as "oracle cloud").
- Expected behavior: a request whose org cannot be determined but whose edge city is a known cloud region should at least not be labelled a city; ideally fall back to an ASN list or the edge's own hosting hint.
- Actual behavior: production card_views still contains "Ashburn, US" rows after the 2026-10-06 exclusion shipped (caller's observation), consistent with the fail-open path.
- How to reproduce: appendix C Q7 (count rows with location in known cloud cities, geo_source='edge'); live: POST /api/card-events from an EC2 host with ipwho.is blocked by egress rules.
- Likely cause: hosting classification was bolted onto a geo-accuracy lookup that was designed to be optional.
- User impact: phantom views/pushes from link scanners (Outlook SafeLinks, Slack/Teams unfurlers with browser UAs) on a fresh card; Locations tab lists datacenter towns.
- Confidence: Confirmed (code path) / Suspected (share of prod rows — Q7)

### A-08 Trade-show NAT: per-(IP, card) budgets drop legitimate views and silence pushes; in-memory limiter is per lambda
- Severity: Medium (exactly the product's showcase moment)
- Platform: all
- Account type/plan affected: all; Office most exposed (many cards, one venue Wi-Fi)
- Feature/page: src/app/api/card-events/route.ts:181-183 (viewed_card 60 / clicked_link 60 / downloaded_vcard 20 per IP per card per 10 min); :653 (notify-ip 6 per card per IP per hour → "suppressed"); :404 (events-anon 1 per window); src/app/api/analytics/event/route.ts:25 (40/IP/slug/10min); src/app/api/leads/route.ts:105-112 (lead-card 120/h); src/lib/rate-limit.ts:538-550 + 591-605 (Map per instance unless UPSTASH/KV env present)
- Problem: a conference hall, office Wi-Fi, a carrier CGNAT or iCloud Private Relay egress presents ONE IP for hundreds of phones. 60 views per card per 10 minutes is reachable at a booth (a QR on a banner). Over the cap the view is logged "rate_limited" and never counted — and the ingest log is the only trace. The 6/hour push cap per IP means from the 7th visitor on the same NAT the owner hears nothing, even though rows record. Conversely, without Upstash configured the limiter is per warm instance, so the caps are both too loose under spread load and too tight on one hot instance; whether Upstash is configured in prod is not visible from the repo.
- Expected behavior: limits keyed on something finer than IP when a durable visitor cookie is present (views are already deduped per visitor), or a much higher per-IP ceiling with an abuse signal.
- Actual behavior: silent drop above 60/10 min; pushes stop at 6/h per IP.
- How to reproduce: appendix C Q8 (`reason='rate_limited'` and `notified='suppressed'` in analytics_ingest_log by day); or 61 scans in 10 minutes from one Wi-Fi.
- Likely cause: anti-flood budgets sized for a single phone, not a venue.
- User impact: undercount at the event the card was printed for; owner believes the QR stopped working.
- Confidence: Confirmed (code); prod incidence Unable to Verify without the log query

### A-09 Views can be fabricated by a direct POST: the human gate is browser-side only, and a body visitor_id is adopted as the identity
- Severity: High (integrity — the exact concern the retired /api/views route was closed for)
- Platform: public API
- Account type/plan affected: any public slug (victim); any attacker
- Feature/page: /api/card-events → lib/record-view.ts
- File/component/function: src/app/api/card-events/route.ts:133 (resolveVisitIdentity adopts `body.visitor_id` when no sc_vid cookie); src/lib/visit-identity.ts:108-116 (adopted id → minted=false); src/lib/record-view.ts:147,201 (device-key dedupe and storage only when minted); :159 (`!visitorId && !deviceKey` backstop is unreachable because visitorId is never null); route.ts:181 (60 views / IP / card / 10 min); src/lib/human-gate.ts (webdriver/visibility/dwell run in the page only); scripts/qa-prod-probe.mjs:78-80 does exactly this against production every night
- Problem: a POST with a browser User-Agent, no cookie, and `{"card_owner_username":"<slug>","event_type":"viewed_card","visitor_id":"<random>"}` is recorded as a new unique visitor each time; because the id was "adopted" rather than "minted", the (ip+ua+slug) device key is neither consulted nor stored, so nothing collapses the burst. 60 per 10 min per IP per card = 8,640 views/day/IP, each with a plausible location, each a push to the owner (6/h), each advancing milestones. The same request with `event_type:"downloaded_vcard"` fabricates "saved your contact" (20/10 min) and inflates office contact-download stats; `source:"nfc_card"` (A-02) makes them "scans". The retired-route comment (api/views/[username]/route.ts:17-22) describes this attack and says it was closed; it moved, it did not close.
- Expected behavior: a server-side cost to a view (the gate's dwell as a signed token, or at minimum: an adopted body id without cookie is treated as minted for dedupe purposes, plus a per-IP daily ceiling independent of visitor id).
- Actual behavior: unlimited distinct "visitors" from one machine.
- How to reproduce: the POST above three times with three ids → three card_views rows, three pushes.
- Likely cause: adoption of the client id (to keep history) reintroduced client control over the dedupe key.
- User impact: any competitor/prankster can make any card show hundreds of views, scans, saves; owners cannot distinguish; CRM mirrors (dispatchCrmEvent) receive the fabricated events.
- Confidence: Confirmed (code; the nightly probe is the proof it works)

### A-10 Orphan rows keep being written: the QA teardown deletes card_events on a column that does not exist, and account deletion leaves analytics for 30 days
- Severity: Medium (explains the 101 orphan views / 205 orphan leads A-03 counts)
- Platform: scripts + delete path
- Account type/plan affected: admin numbers; re-registered slugs
- Feature/page: nightly QA, account delete
- File/component/function: scripts/qa-flows.mjs:1092 and scripts/qa-sweep.mjs:483 (`DELETE /rest/v1/card_events?username=in.(...)` — card_events has no `username` column, only `card_owner_username`; `adm()` is a bare fetch (qa-flows.mjs:30) so the 400 is swallowed); scripts/qa-flows.mjs:1085-1089 (extra seeded users: no card_views/card_events delete at all); scripts/qa-prod-probe.mjs:177 (deletes `card_views?username=eq.<slug>` only, not `<slug>__links`); src/lib/account-purge.ts:97-109 runs only at purge time (30 days after a normal delete); src/app/api/cards/[id]/route.ts:484-488 (card delete is clean)
- Problem: every nightly run leaves its card_events rows (the probe and flows create viewed_card/downloaded_vcard rows) behind; every deleted account's views/leads/events stay for 30 days and, until the purge, count in admin totals (A-03) and are inherited by anyone who registers the freed slug in that window (milestones are owner-scoped since 2026-10-02, but Traffic/Locations/unique viewers are slug-scoped — dashboard/page.tsx:411-430 — so a new owner of a reused slug sees the previous owner's bars).
- Expected behavior: teardown deletes by the real column; deletion scrubs slug-keyed analytics immediately (the slug is released immediately, the data is not).
- Actual behavior: orphan rows accumulate; prod shows 101 orphan card_views and the card_events-without-views gap in A-01 includes these.
- How to reproduce: appendix C Q9; or run qa-sweep and query card_events for the qa- slug afterwards.
- Likely cause: column rename never propagated to the scripts; purge window designed for account recovery, not for analytics scoping.
- User impact: admin KPIs; a re-registered slug inherits strangers' traffic for up to 30 days.
- Confidence: Confirmed

### A-11 Nothing prunes anything: the "14-day" ingest log, "90-day" product_events and site_pageviews all grow forever; the admin funnel silently caps at 20k rows
- Severity: Medium
- Platform: database / admin
- Account type/plan affected: admin
- Feature/page: /admin/analytics funnel, /admin/website
- File/component/function: supabase/analytics-accuracy.sql:239 (a one-off `delete … interval '14 days'` executed once at migration time — not a function, not scheduled); supabase/product-events.sql:53-59 and error-events.sql:38 (prune_* functions exist; no caller anywhere in src/, vercel.json crons are only /api/reminders and /api/wallet/sweep; pg_cron not visible from the repo); site_pageviews: no prune at all (7,832 rows incl. pre-allow-list typo paths such as /pricingg — SiteAnalytics.tsx:21-28 now allow-lists, old rows remain); src/app/api/admin/analytics/route.ts:238-243 (`limit(20_000)` on 30 days of product_events — 12,462 page_viewed already in the table; once a 30-day window exceeds 20k the newest rows win and `card_creation_started`/`checkout_completed` counts drop with no warning); src/app/api/admin/website/route.ts:12-14 logs its cap, the analytics route does not
- Expected behavior: scheduled prunes (pg_cron or a Vercel cron) and head counts instead of a capped row fetch.
- Actual behavior: comments promise retention that the schema does not deliver; Supabase advisor flags site_pageviews_session_idx unused because nothing queries sessions by index (the admin route scans 30 days in JS).
- How to reproduce: appendix C Q10 (oldest created_at per table).
- Likely cause: retention written as a statement rather than a job.
- User impact: cost/latency growth; the admin funnel will quietly understate the bottom of the funnel first.
- Confidence: Confirmed (no caller in repo); pg_cron Unable to Verify

### A-12 analytics_events has no reader (two tables once recorded one contact save); the "minted identity" signal that was meant to expose over-counting is not stored
- Severity: Low
- Platform: all
- Account type/plan affected: all
- File/component/function: src/components/SignupNudgeHost.tsx:80, SwiftLinksPromoBadge.tsx:23 (writers of nudge_impression / nudge_cta_click / links_badge_open); src/components/SaveContactButton.tsx:328 and ScanSaveContact.tsx:135 (comments: "a table with no reader anywhere"); the 24 contact_save rows are pre-unification history, downloaded_vcard in card_events is the only live save metric; src/lib/visit-identity.ts:93-96 says `minted` is "recorded so a spike in fresh identities is visible" but src/app/api/card-events/route.ts:144-166 never passes it to logIngest, and analytics_ingest_log has no column for it
- Problem: 101 rows of write-only data on a public endpoint with no dedupe (api/analytics/event/route.ts has rate limit + bot + self only); the one observability signal for storage-less browsers (private mode, in-app browsers → a new "unique viewer" every visit past 30 min) cannot be queried.
- Expected behavior: drop the table and its writers, or read it; log `minted`.
- Actual behavior: unique-viewer inflation from cookie-less browsers is invisible.
- How to reproduce: grep shows no `.from("analytics_events").select`.
- Likely cause: experiments left running.
- User impact: none visible; dead weight + blind spot.
- Confidence: Confirmed

### A-13 "Views" means three different things depending on who is counting: milestones sum card+links, the weekly recap milestone counts card only, dashboards split, repeat-visit copy reads card_events
- Severity: Low-Medium (copy that contradicts the screen it names)
- Platform: all
- Account type/plan affected: all
- File/component/function: src/lib/milestones.ts:454-458 (count over [slug, slug__links] → "That's N views across your card and Swift Links"); src/app/api/push/recap/route.ts:349-352 ("CARD views only" for the recap milestone); src/app/api/push/recap/route.ts:144,219-221 (recap weekly total = card + links); dashboard/page.tsx:411-412 (two tiles); office page.tsx:120-121 (two tiles) but office_daily_views_tz and the office chart (page.tsx:130 "Card and Swift Link views together") merge them; src/app/api/card-events/route.ts:57-76 (countRecentVisits: card_events, per surface, bare slug) vs :607-615 (known contact: card_views by lead_id, both surfaces, bucketed) → "3rd visit this week" is computed two different ways for strangers vs known contacts; src/lib/visitor.ts:131-136 still documents a 24h dedupe window (it is 30 min, view-window.ts)
- Problem: the same owner can receive "100 views!" (bell, card+links) while the recap push says 60 and the dashboard tile says 60 card / 40 links; a stranger's "3rd visit" counts per surface while a contact's counts per 30-min bucket across surfaces.
- Expected behavior: one definition per word, documented in knowledge/docs.
- Actual behavior: three.
- How to reproduce: a card with links views near a milestone; compare bell vs weekly recap (appendix C Q15).
- Likely cause: each surface fixed in isolation (2026-09 → 10-06).
- User impact: owner distrusts numbers that "don't add up".
- Confidence: Confirmed

### A-14 Office admins and teammates opening a colleague's card are counted as visitors (by design) — the Office console's own "View" links inflate the numbers it reports
- Severity: Low (documented decision in self-traffic.ts:178-182) / Medium for Office trust
- Platform: web
- Account type/plan affected: Office
- File/component/function: src/lib/self-traffic.ts:178-182 ("a team member or office admin viewing a colleague's card is a real visitor and is counted"); office team drawer View/QR/Copy links open the live /<slug>; src/app/[username]/page.tsx:223 (isOwnerView = exact owner only); the sc_device claim (self-traffic.ts:271-300) also only matches the exact owner id
- Problem: an admin reviewing 20 reps' cards after a branding change adds 20 views + 20 pushes + 20 "unique visitors" to the Team tab, then reads that tab. Nothing marks internal-to-office traffic.
- Expected behavior: an office member/admin session on a card owned by the same office is excluded (or tagged) — the office id is already resolvable (profiles.office_id).
- Actual behavior: counted.
- How to reproduce: as office admin open a member's card from the Team tab; the member's dashboard shows a view from the admin's town.
- Likely cause: rule written for the personal product before Office existed.
- User impact: Office numbers partly reflect the admin's own clicking; members get "someone viewed your card" when it was their manager.
- Confidence: Confirmed (code) — intended behaviour, flagged for the owner's decision

### A-15 The offline replay header is client-controlled: any request can backdate a view up to 7 days and drop its location
- Severity: Low
- Platform: public API
- File/component/function: src/app/api/card-events/route.ts:128-131 (X-SC-Queued-At trusted if 5 s–7 days in the past); src/lib/record-view.ts:65,94,119-120,173 (row filed at that time, location nulled, dedupe window centred on the claimed time); src/lib/offline-outbox.ts:119
- Problem: combined with A-09 this lets a script spread fabricated views across the last week's bars (so a spike is not visible as a spike); a legitimately replayed view carries no location (by design) but still counts, while a replay older than 30 min never notifies — so the bell and the bars legitimately disagree for offline visits (the invariant record-view.ts:17-22 claims is not held for replays).
- Expected behavior: cap backdating to the visit window unless the request also carries the sc_vid cookie, or sign the outbox timestamp.
- Actual behavior: 7-day free backdating.
- How to reproduce: POST with `X-SC-Queued-At: <now minus 3 days>` → row dated three days ago.
- Likely cause: convenience header.
- User impact: Low today; it undermines any attempt to detect A-09 by looking for bursts.
- Confidence: Confirmed

### A-16 Bot filter false positives: the bare "bot" token drops real Android phones; the filters that matter for previews are the dwell, not the UA list
- Severity: Low
- File/component/function: src/lib/bot-detection.ts:497-498 (`bot|crawl|spider|…` unanchored) — matches "CUBOT" (Cubot phones: "Android 10; CUBOT_X30"), "Botim" (in-app browser), "robot"; applied in card-events, leads (api/leads/route.ts:121 — a Cubot owner cannot share their info), analytics/event, site-view, product events
- Problem: positive match → the person's view, lead submission and funnel events are all silently dropped (reason "bot"). Preview fetchers (iMessage, WhatsApp, Slack, LinkedIn) are in practice excluded by the 2.5 s visible dwell (human-gate.ts) rather than by the list, so the list's precision matters mostly for its false positives.
- Expected behavior: word-boundary tokens (`\bbot\b`, `bot/`), or exempt known handset strings.
- Actual behavior: a visitor segment (budget Android) is uncounted and cannot submit the lead form.
- How to reproduce: appendix C Q11; or set UA to a Cubot string and submit the form → 200 with nothing stored.
- Likely cause: substring list.
- User impact: Low volume, but a lead lost is the product's main promise.
- Confidence: Confirmed (regex) / incidence Unable to Verify

### A-17 Funnel inflation: card_creation_started fires on every editor mount (and again when `guest` flips); page_viewed on every route change; no session dedupe
- Severity: Low-Medium (admin funnel conclusions)
- Platform: /admin/analytics
- File/component/function: src/app/cards/new/NewCardWizard.tsx:275-277 (`useEffect(() => track("card_creation_started"…), [guest])`); src/lib/events.ts:320-324 (page_viewed per pathname change); src/app/admin/analytics/AnalyticsClient.tsx:132 labels it "Typed the first field"; src/app/api/admin/analytics/route.ts:252-256 counts rows, not sessions (session_key is stored but unused in the funnel); upgrade_prompt_viewed 1,082 vs upgrade_started 14 is the same per-render shape
- Problem: 1,566 "started" vs 340 "completed" includes every reload, every back-navigation to /cards/new, every guest→authed flip. The hint text promises an intent signal the event does not carry.
- Expected behavior: count distinct session_key per event, fire start on first input.
- Actual behavior: an abandonment rate that cannot be acted on.
- How to reproduce: appendix C Q12 (rows vs distinct session_key per name).
- Likely cause: event wired to mount for simplicity.
- User impact: owner over-estimates wizard abandonment (Q12 will say by how much).
- Confidence: Confirmed (code) / magnitude Suspected

### A-18 Time zones: the Office console buckets in the ADMIN's zone, members' dashboards in their own; admin analytics, weekly recap and site analytics are UTC; the first dashboard paint before sc_tz exists falls back to push-prefs zone or UTC
- Severity: Low
- File/component/function: src/components/TimezoneCookie.tsx:25 (sc_tz set client-side after first render, 1-year, SameSite=Lax); src/app/dashboard/page.tsx:384 (cookie → customization._push.timezone → UTC); src/app/office/admin/analytics/page.tsx:47 and export/route.ts:35 (viewer's cookie only); src/app/api/admin/analytics/route.ts:13-15 (UTC dayKey); src/app/api/push/recap/route.ts (UTC `since`); office_daily_views_tz vs card_view_utc_day (supabase) — two bucketing primitives; office custom ranges UTC (A-05)
- Problem: a NY admin and an LA rep see different "today"/"yesterday" totals for the same card; a push-prefs zone exists only once the person touched notification settings, so a brand-new owner west of UTC gets UTC days on the first paint (the cookie fixes it on the next request). The CSV export uses whoever downloads it.
- Expected behavior: bucket by the CARD OWNER's zone everywhere a card's day is shown; label the zone on exports.
- Actual behavior: viewer-dependent.
- How to reproduce: set the browser zone to Pacific, compare a member's dashboard "today" with the admin's per-member row at 9 pm PT.
- Likely cause: zone is a viewer cookie, not an owner attribute.
- User impact: "the numbers don't match" between an admin and a rep.
- Confidence: Confirmed

### A-19 Period-over-period deltas compare a partial current period with a full previous one; "Unique viewers" is hidden at 0; uniques treat each null-id row as its own person
- Severity: Low
- File/component/function: src/lib/office-analytics-dates.ts:29-34 + previousPeriod():57-62 (current range ends at tomorrow-local, i.e. includes a partial today; previous is a full N days); src/lib/office-analytics-metrics.ts:11-14 (pctChange: null when previous=0 and current>0 — rendered as no hint, so a from-zero jump shows no delta); src/app/dashboard/page.tsx:647-652 (`uniqueViewers = windowIds.size + windowNullIdRows`; prod has 0 null visitor_id so harmless now) and :1247 (`uniqueViewers > 0 &&` hides the split entirely when 0); office-analytics-accuracy.sql:38,51 same null rule
- Problem: every delta is biased negative early in the day (at 9 am a "last 7 days" tile compares 6.4 days with 7); divide-by-zero is handled; empty ranges render "No activity".
- Expected behavior: compare like with like (previous period truncated at the same time-of-day) or label "so far".
- Actual behavior: morning admins see red arrows.
- How to reproduce: open the Office console at 8 am on a flat-traffic team.
- Likely cause: calendar ranges.
- User impact: Low; misleading arrows.
- Confidence: Confirmed

### A-20 Privacy posture is mostly right; residuals: 41 historical card_events rows still carry visitor_email/phone, locations are stored per event, PostHog is dormant
- Severity: Low
- File/component/function: src/app/api/card-events/route.ts:422-428 (since 2026-09-18 visitor_email/phone are always null; the 41 rows predate it and were never scrubbed — analytics-cleanup-2026-09-23.sql did not touch them); card_views.ip null everywhere (record-view.ts:165) but `location` + `geo_accuracy` + `lead_id` + `device_key` (minted only) are stored; src/app/api/events/route.ts:30 allow-list keeps product_events PII-free; src/lib/events.ts:218 imports posthog-js only when NEXT_PUBLIC_POSTHOG_KEY is set, so double tracking would start the day the key is added (privacy page already names PostHog); analytics_ingest_log stores visitor_id + visit_key (pseudonymous, no retention — A-11)
- Expected behavior: one-off scrub of the 41 rows; retention on the log.
- Actual behavior: as described.
- How to reproduce: appendix C Q13.
- User impact: Low; compliance tidiness.
- Confidence: Confirmed

### A-21 Supabase advisor items are noise, not bugs: the four office_* functions are not SECURITY DEFINER; site_pageviews_session_idx is unused because sessions are aggregated in JS
- Severity: Low
- File/component/function: supabase/office-analytics-accuracy.sql (LANGUAGE sql STABLE, no SECURITY DEFINER → mutable search_path is a lint, not an escalation path; rename_card_slug and prune_* do pin search_path); src/app/api/admin/website/route.ts:48-60 (30-day row fetch grouped in JS, so the session index is never used)
- Expected behavior: add `SET search_path = public` to silence the advisor; drop or use the index.
- Actual behavior: advisor warnings persist.
- Confidence: Confirmed

## Appendix A — Event matrix (event × surface × table × consumer)

| Surface | Event | Writer | Table(s) | Who reads it |
|---|---|---|---|---|
| Card page /<slug> (incl. ?source=qr_code / nfc_card / apple_wallet / email_signature / share; /<slug>/p/<id> → create_link) | viewed_card | CardEventTracker → /api/card-events → recordView | card_views (key=slug), card_events (surface=card), analytics_ingest_log, notifications (visit_key), CRM dispatch | dashboard tiles/chart/uniques/locations (card_views); office_* SQL (card_views); admin viewTotal (card_views); milestones (card_views, slug + __links); "3rd visit" (card_events); weekly recap (card_views) |
| Swift Links /links/<slug> (default source swift_links, or forwarded ?source) | viewed_card surface=links | same | card_views (key=slug__links), card_events (card_owner_username=slug, surface=links) | dashboard "Swift Link views"; office swiftlink_views; office chart + unique visitors (merged); milestones (merged); recap total (merged) / recap milestone (excluded); admin linkViews30 |
| Any page link tap (card action links, social icons, Swift Links buttons) | clicked_link (target host + target_label) | trackLinkClick (sendBeacon/outbox) → /api/card-events | card_events only (no card_views, no notification by design) | dashboard "Link taps" count; contact timeline (GET /api/card-events); CRM: none |
| Save contact (button, ?save=1 QR auto-save, system-browser handoff) | downloaded_vcard (+ a view via recordView if not yet counted) | SaveContactButton / ScanSaveContact → /api/card-events | card_events (+card_views), notifications, CRM | office_employee_contact_stats; contact timeline; push "saved your contact"; dashboard: none |
| Contact QR (vCard inside the QR, offline) | nothing | — | — | not measurable (by design); leads later opened from it carry source contact_qr |
| Lead forms (ConnectButton, LeadCaptureForm, SaveContactButton share) | lead | /api/leads | leads (source = page ?source or null; visitor_id; location), notifications, CRM | dashboard counts (excl. demo), office lead stats (excl. demo), admin leadTotal/bySource/topCards (INCLUDES demo — A-06) |
| New card / draft claim / tour seed | sample lead | seedDemoContact | leads (source=qr_code, tags demo) | admin analytics counts it (A-06) |
| Business-card scanner | lead | /api/scanner | leads (source=scanner) | same as leads |
| Signup nudge / links badge | nudge_impression, nudge_cta_click, links_badge_open | /api/analytics/event | analytics_events | nobody (A-12) |
| Marketing pages (allow-list) | pageview + duration | SiteAnalytics → /api/site-view | site_pageviews | /admin/website only |
| Funnel pages + wizard + upgrade links | page_viewed, card_creation_started/completed, upgrade_prompt_viewed, upgrade_started, checkout_completed… | lib/events → /api/events | product_events (+ PostHog if key) | /admin/analytics funnel, /go/[code], /review, admin agents |
| Dashboard self-preview, /preview, email-signature preview | none | CardScaler in-process or /<slug>?embed=card (returns before the tracker), /links?embed=1 | — | — |
| Owner's own "View live", owner session, owner device (90 d) | none (reason self) | self-traffic.ts | analytics_ingest_log only | admin ingest tally |
| Office admin / teammate opening a member's card | viewed_card | normal path | card_views etc. | counted everywhere (A-14) |
| iMessage / WhatsApp / Slack / LinkedIn preview fetch, og-image, twitter-image routes | none | server render / image route; no JS dwell | — (prefetch header → reason prefetch; else no request at all) | — |
| Apple Wallet pass open → back URL /<slug>?source=apple_wallet | viewed_card source=apple_wallet | normal path | card_views | Traffic sources (office), notification phrase |
| Offline reopen (sw.js) / no signal | viewed_card, clicked_link, lead queued | offline-outbox → replay with X-SC-Queued-At | same tables, location null, no push past 30 min | same readers (A-15) |
| Deleted / inactive / over-plan slug | refused | isCardActive | analytics_ingest_log reason inactive | admin tally |
| Datacenter egress | refused only when the second geo lookup identifies the org | request-geo | ingest log reason hosting (else counted — A-07) | — |
| Rate-limited (60/10 min/IP/card) | refused | rate-limit | ingest log reason rate_limited (A-08) | — |

## Appendix B — Verdict: can the analytics data be trusted?

For a single owner reading their own dashboard day to day: **mostly yes, with known blind spots.** The live write path is coherent — one request records the bar, the event and the bell (A-01), self-views are excluded three ways, reloads and double-fires dedupe on a durable cookie, previews and crawlers are kept out by a visible dwell, and the dashboard, office console and milestones all read the same card_views rows with the same null-id rule. The numbers an owner sees are real visits to their page, undercounted rather than inflated for bounces under 2.5 s, rate-limited venues (A-08) and the odd Cubot (A-16).

For anything that will be defended, sold or compared: **no, not yet.** (1) Views, scans and saves can be fabricated by anyone with curl and are unbounded in distinct "visitors" (A-09, A-02); nothing distinguishes such rows later, and A-15 lets them be spread across days. (2) The owner's own admin KPIs are wrong in the owner's favour: leads roughly 9x (seeded sample contacts, A-06) and views roughly 1.5x (orphans, A-03/A-10), with the "QR is our channel" conclusion resting on a seeder's default string. (3) The datacenter filter fails open whenever the second IP lookup fails (A-07), which is consistent with "Ashburn, US" still appearing in prod. (4) The same word means different things on different screens (A-13, A-18, A-05), so cross-checking numbers — the first thing a sceptical customer does — finds contradictions. (5) The retention and observability promises in the code (14-day log, 90-day events, "minted" visibility) are not implemented (A-11, A-12). Evidence: the prod aggregates supplied by the caller (0 null visitor_id, 0 same-visitor dups → dedupe works; 219/245 qr_code leads with 205 orphans → A-06/A-10; surface-null 230 → history; 101 __links rows counted as views in milestones but not in the recap).

Priority fixes, in order: A-09 (server-side cost or treat a cookie-less adopted id as minted), A-06 + A-10 (exclude demo tags in admin; fix the QA teardown column; scrub on delete), A-07 (fail closed on cloud edge cities / use an ASN list), A-02 (source allow-list), A-11 (schedule prunes, count by head), then the definition clean-up (A-13/A-18).

## Appendix C — Read-only SQL to confirm the remaining suspicions

```sql
-- Q6 (A-06): how many "leads" are the seeded sample contact, and the real source split
select coalesce(source,'(null)') as source,
       count(*) filter (where 'demo' = any(coalesce(tags,'{}'))) as demo_rows,
       count(*) filter (where not ('demo' = any(coalesce(tags,'{}')))) as real_rows
from leads group by 1 order by 2 desc;
-- orphans among the demo rows (deleted/QA accounts)
select count(*) from leads l where 'demo' = any(coalesce(l.tags,'{}'))
  and not exists (select 1 from cards c where c.username = l.card_owner)
  and not exists (select 1 from profiles p where p.username = l.card_owner);

-- Q7 (A-07): counted views whose location is a cloud region, by geo source
select location, geo_source, geo_accuracy, count(*), min(viewed_at), max(viewed_at)
from card_views
where location in ('Ashburn, VA','Ashburn, US','Boardman, OR','Boardman, US','Quincy, WA','Quincy, US','Columbus, OH','Council Bluffs, IA','The Dalles, OR','Dublin, IE','Frankfurt am Main, DE','North Charleston, SC','San Jose, CA','Hillsboro, OR')
group by 1,2,3 order by 4 desc;
-- the decision log's view of the same period
select reason, classification, count(*) from analytics_ingest_log
where created_at > now() - interval '14 days' group by 1,2 order by 3 desc;

-- Q8 (A-08): legitimate traffic dropped by budgets / pushes suppressed
select date_trunc('day', created_at) d, reason, count(*) from analytics_ingest_log
where reason = 'rate_limited' group by 1,2 order by 1;
select notified, count(*) from analytics_ingest_log where counted group by 1;

-- Q9 (A-10): orphan rows by writer family (qa- prefix = nightly QA; others = deleted customers)
select case when username like 'qa-%' then 'qa' when username like 'apple-review-%' then 'review' else 'other' end fam,
       count(*) from card_views v
where not exists (select 1 from cards c where c.username = regexp_replace(v.username,'__links$',''))
  and not exists (select 1 from profiles p where p.username = regexp_replace(v.username,'__links$',''))
group by 1;
select count(*) from card_events e
where not exists (select 1 from cards c where c.username = e.card_owner_username)
  and not exists (select 1 from profiles p where p.username = e.card_owner_username);

-- Q10 (A-11): retention actually in effect
select 'ingest_log' t, min(created_at), count(*) from analytics_ingest_log
union all select 'product_events', min(created_at), count(*) from product_events
union all select 'site_pageviews', min(created_at), count(*) from site_pageviews
union all select 'error_events', min(created_at), count(*) from error_events;
select * from cron.job;  -- errors if pg_cron is not installed, which means nothing is scheduled

-- Q11 (A-16): bot-classified requests on slugs that received a lead within 10 minutes
select l.entity_key, l.created_at, ld.created_at lead_at
from analytics_ingest_log l join leads ld on ld.card_owner = regexp_replace(l.entity_key,'__links$','')
where l.reason = 'bot' and ld.created_at between l.created_at and l.created_at + interval '10 minutes';

-- Q12 (A-17): rows vs distinct sessions per funnel event (30 days, real traffic)
select name, count(*) as rows, count(distinct session_key) as sessions
from product_events where not is_internal and created_at > now() - interval '30 days'
group by 1 order by 2 desc;

-- Q13 (A-20): residual PII on events
select count(*) from card_events where visitor_email is not null or visitor_phone is not null;
select min(created_at), max(created_at) from card_events where visitor_email is not null;

-- Q14 (A-09): bursts of distinct visitor ids per (entity, hour) in the decision log
select entity_key, date_trunc('hour', created_at) h, count(distinct visitor_id) ids, count(*) n
from analytics_ingest_log where counted and event_type = 'viewed_card'
group by 1,2 having count(distinct visitor_id) >= 10 order by 3 desc limit 50;

-- Q15 (A-13): milestone announcements vs the two totals a reader could compute
select n.card_owner, n.milestone, n.created_at,
  (select count(*) from card_views v where v.username = n.card_owner) card_only,
  (select count(*) from card_views v where v.username in (n.card_owner, n.card_owner || '__links')) card_plus_links
from notifications n where n.milestone is not null order by n.created_at desc limit 20;
```
