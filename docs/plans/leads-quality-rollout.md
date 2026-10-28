# Rolling out better leads (PR #116)

Prepared 2026-10-28. **Nothing on this page has been run against production.**
Every step that changes production is marked **[APPROVAL]** and waits for the
owner. Stop at the first check that doesn't match.

State at preparation (read-only):

- Pause all is ON (`crew_settings.kill_all = true`). Every agent is still
  switched on individually behind it, so lifting Pause all starts all of them.
- `crew_leads`: 192 rows (110 cold, 82 office), no `company_key` column yet.
- `crew_sheet_rows`: 300 rows; 22 carry something the owner set (a Status
  other than New, or a note / next step).
- Sheet daily snapshot (`sheet-daily`, 7:30am New York) last saved a dated
  copy on 2026-10-28 at 11:30 UTC.

## 1. Agents stay paused

```sql
select kill_all from crew_settings;                       -- must be true
select count(*) from crew_runs where status = 'running';  -- must be 0
```

Sheet sync and the daily snapshot keep running through Pause all. That's
expected: they never contact anyone.

## 2. Supabase backup

1. Supabase → Database → Backups: confirm a backup from the last 24 hours
   exists, and note its time. Use point-in-time recovery if the plan has it.
2. Take a logical copy of the two tables this touches, from a machine with the
   database URL (it never goes in the repo):
   ```bash
   pg_dump "$SUPABASE_DB_URL" --data-only --table=public.crew_leads --table=public.crew_sheet_rows \
     --file="crew-leads-backup-$(date -u +%Y%m%dT%H%MZ).sql"
   ```
   **Verify it:** the file contains `COPY public.crew_leads` with 192 data
   lines, and `COPY public.crew_sheet_rows` with 300.
3. Record the fingerprints that must not change:
   ```sql
   select list, count(*) from crew_leads group by list order by list;           -- cold 110, office 82
   select md5(string_agg(concat_ws('|', id, list, name, email, phone, company, title, business_type,
                                   city, region, country, region_restricted, source_platform,
                                   source_url, created_at, found_at, notes), ',' order by id))
     from crew_leads;                                                           -- note this value: LEADS_MD5
   select md5(string_agg(concat_ws('|', row_key, tab, status, owner_cols::text, shown_status),
                         ',' order by row_key)) from crew_sheet_rows;         -- note this value: ROWS_MD5
   ```

## 3. Apply the SQL **[APPROVAL]**

Apply `supabase/crew-leads-quality.sql` exactly as reviewed. It adds six
nullable columns and one partial unique index, and doesn't change any rows.
It's safe to run twice. It was tested on a local Postgres with
production's `crew_leads` shape: it applied, a re-run was a no-op, and the
legacy rows stayed byte-for-byte the same.

Apply it before the code is merged. Code merged without it still saves
leads, but without the new fields, and only the in-code company check is
active.

## 4. Verify the database

```sql
select count(*) from crew_leads;                                               -- 192
-- the LEADS_MD5 query from step 2                                             -- unchanged
select column_name, data_type from information_schema.columns
 where table_name = 'crew_leads'
   and column_name in ('company_key','email_status','score','why','hook','message');   -- 6 rows
select indexdef from pg_indexes where indexname = 'crew_leads_company_key_unique';
  -- CREATE UNIQUE INDEX … (company_key) WHERE (company_key IS NOT NULL)
select count(*) from crew_leads where company_key is not null;                 -- 0
```

## 5. Google Sheet backup

The owner's Statuses, Notes and Next Steps are also stored in
`crew_sheet_rows`, which is covered by the step 2 backup and fingerprint. Copy
the workbook itself as well:

1. Confirm today's dated copy exists in the Shared Drive under
   SwiftCard Leads/Daily (it's made by the daily snapshot).
2. Also make a manual copy in Google Sheets: File → Make a copy, named
   "SwiftCard Leads backup before PR 116 <date>", in the same Shared Drive.
   This is a new file; the workbook itself isn't changed.
3. In the copy, check that Web Leads has 109 data rows and Office Prospects 87,
   and that a few rows you set by hand show your Status.

## 6. The one-time formatting pass (what it changes, and what it doesn't)

PR #116 rewrites one header note (Email Status). That changes the workbook's
spec hash, so the first Sheet sync after the merge runs `ensureWorkbook` once.

**It doesn't change:** any cell value below the header row, any Status, Notes
or Next Step, which rows exist, or the column order. No column is added,
removed or moved: every tab's column list is the same as on `main`, and only
one note's text differs.

**It does rewrite, to the values the code already uses:**

- the header row text and notes;
- column widths;
- text wrapping and alignment;
- Status dropdowns;
- the tint on owner columns;
- frozen header rows;
- tab order and tab colours;
- the Controls and Key-column warning protections (deleted and added back).

If the owner has dragged a tab, resized a column or left a filter set on a
tab, that resets: `setBasicFilter` replaces the tab's filter, which clears its
active filter criteria, but no data. It also adds one more copy of each
conditional-colour rule. That's the known cosmetic issue, and it's left alone
for now.

**Check after the first sync following the merge:** re-run ROWS_MD5 from step
2 and confirm it's unchanged. Then open Web Leads and Office Prospects: the
same row count as in step 5, the same Statuses, and the new Email Status note.

## 7. Merge PR #116 **[APPROVAL]**

Merge only once steps 1–6 pass, CI on the PR is green (`verify`, `render`),
and the deploy gate has promoted it (`/api/health` names the merge commit).
Then let one Sheet sync run, and repeat the checks in step 4 and step 6.

## 8. The agents stay paused

Merging doesn't start any agent. Don't lift Pause all yet: every agent is
still switched on behind it.

## 9. One supervised run of each agent **[APPROVAL, separately]**

The admin page's Run button refuses while Pause all is on, so a single run
takes three steps:

1. Agents tab: Stop every agent except Web Leads and Office Prospects (Sheet
   sync and the daily snapshot can't be stopped and don't need to be).
   Confirm with:
   `select id from crew_agents where enabled and id not in ('leads-web','office-outreach');`
   It must return nothing.
2. Resume all agents, then tap Run on Web Leads, and once it finishes, Run on
   Office Prospects. Pause all again straight after.
3. Measure each run (`<RUN_ID>` from `crew_runs`):
   ```sql
   select agent_id, status, summary, stats from crew_runs where id = '<RUN_ID>';
   select purpose, model, sum(cost_usd) usd, sum(input_tokens) tin, sum(output_tokens) tout, sum(web_searches) searches
     from crew_usage where run_id = '<RUN_ID>' group by 1, 2;                    -- exact provider cost
   select name, title, email, email_status, phone, company, company_key, score, why, hook, message
     from crew_leads where created_at > '<RUN_START>' order by score desc;        -- quality
   select company_key, count(*) from crew_leads where company_key is not null
     group by 1 having count(*) > 1;                                              -- must be empty
   ```

   Judge each new row by hand:
   - Is the name and title on the business's own site?
   - Is the email on the site?
   - Is the hook true?
   - Would you actually say the opener?

   Expected cost:
   - Web Leads: about $0.08 for finding businesses, plus about $0.003 for the site read.
   - Office Prospects: about $0.10, plus about $0.003, plus email drafts if any.

   Expected stats: `leads_added`, `usable_leads`, `duplicates_rejected`,
   `contacts_suppressed` and `skipped_not_a_fit` all present.

Keeping the agents running after that is a separate decision.

## Rollback

- **Code:** revert the merge. Leads saved with the new fields stay; the old
  code ignores the columns.
- **Database:** see the ROLLBACK lines in `supabase/crew-leads-quality.sql`.
  Revert the code first. Dropping the columns removes only the scores, hooks
  and openers of leads saved after the merge.
- **Sheet:** the manual copy from step 5; Statuses and notes are restored from
  `crew_sheet_rows`.
