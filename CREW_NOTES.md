# Crew notes: push-catchup.yml and trial-notice.yml failing

No code changed. I found no safe code fix.

- The same two workflows failed together, and both authenticate with the GitHub secret `PUSH_CATCHUP_SECRET` (Bearer token).
- The routes check the token correctly:
  - `src/app/api/push/catchup/route.ts` accepts `PUSH_CATCHUP_SECRET` or `CRON_SECRET`.
  - `src/app/api/billing/trial-notice/route.ts` also accepts `TRIAL_NOTICE_SECRET`.
  - An unset secret never authorizes.
- The likely cause is configuration, not code. Either `PUSH_CATCHUP_SECRET` is missing or differs between GitHub Secrets and Vercel env, or production was unreachable or slow.
  - The health check measured 16s for the probe.
  - The workflows' `curl` calls have a 90s timeout.
- I could not read the failed run logs (the run URL in the brief is truncated), so I could not confirm which of these it was.
- Owner action:
  1. Open the failed runs in GitHub Actions. A 401 means the secrets are out of sync. A 5xx or timeout means a production problem.
  2. Make sure `PUSH_CATCHUP_SECRET` is identical in GitHub Secrets and Vercel (or set `CRON_SECRET`).
  3. Re-run the workflows.
