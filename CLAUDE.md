@AGENTS.md

# Auto-deploy every change to production

Every change requested in this project should go live automatically. After
making any change:

1. **Build check.** Run a production build (`npx next build`) and fix any errors
   it reports.
2. **If the build fails and I cannot fix it, stop and tell the user.** Do not
   commit or push a broken build.
3. **Commit and push to `main`.** Pull the latest code first (`git pull
   --ff-only`), then commit the change and push to `main` so Vercel deploys it
   to the live website. Stage explicit paths — never `git add -A` or `git commit
   -a` (see the multi-session rule in AGENTS.md).
4. **Never commit `.env` files or secrets.** Do not stage `.env*` files, keys,
   tokens, or credentials under any circumstances.
5. **Skip pushing only when the user says "localhost" or "don't push."** In that
   case, make the change locally and stop before committing/pushing.

# Never test on production (permanent rule, owner, 2026-11-15)

Our own automation took swiftcard.me down: Vercel switched the site off for
going over its usage limits, and the traffic was QA runs and agent sessions
driving the live site and creating and deleting accounts.

1. **Never run tests, verification, QA scripts or agents against production
   (swiftcard.me, swiftcard.app) or a Vercel preview (`*.vercel.app`).** Not
   in a browser, not with a script, not "just to check". Verify on a local
   build: `npx next build && npx next start -p 3222`, then
   `http://localhost:3222`.
2. **Never create real auth users for testing.** Use the seeded QA accounts
   (`scripts/lib/qa-local.mjs`). No signing up throwaway accounts, no
   creating and deleting users per run.
3. **Never upload test images to Supabase Storage.** Uploads are stubbed in
   QA runs; keep it that way.
4. The only read of production an agent may make is `/api/health`, to confirm
   which commit is live. "It is live" means that endpoint names the commit,
   not that a browser session clicked through it.
5. If a task seems to need production, stop and ask the owner.

This overrides any older instruction, memory or doc that says to test on the
live site. Details and the guards that enforce it are in AGENTS.md.
