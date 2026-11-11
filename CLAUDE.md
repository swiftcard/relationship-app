@AGENTS.md

# Auto-deploy every change to production

Every change requested in this project should go live automatically. After
making any change:

1. **Build check.** Run a production build (`npx next build`) and fix any errors
   it reports.
2. **If the build fails and I cannot fix it, stop and tell the user.** Do not
   commit or push a broken build.
3. **Commit and push to `main`.** Pull the latest code first with
   `node scripts/sync-main.mjs --apply` (it drops stale copies that are identical
   to origin, then fast-forwards; a bare `git pull --ff-only` fails or hides the
   problem when this folder holds stale copies, and a commit made while behind can
   silently undo live fixes). Then commit the change and push to `main` so Vercel
   deploys it to the live website. Stage explicit paths — never `git add -A` or
   `git commit -a` (see the multi-session rule in AGENTS.md). If the commit hook
   says a file would go back to an older version, your copy was stale: sync,
   re-apply only your own change, and commit again.
4. **Never commit `.env` files or secrets.** Do not stage `.env*` files, keys,
   tokens, or credentials under any circumstances.
5. **Skip pushing only when the user says "localhost" or "don't push."** In that
   case, make the change locally and stop before committing/pushing.
