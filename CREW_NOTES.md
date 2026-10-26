# Crew notes: signup-ui "landed on /cards/new but no auth user exists"

No code changed. The likely cause is in `scripts/qa-flows.mjs`, which I'm not allowed to edit.

## What I found
- The check is at `scripts/qa-flows.mjs:1107-1113`. After signup it looks the new account up with
  `GET /auth/v1/admin/users?page=1&per_page=50` and searches that single page for `u.email === e2`.
- The browser did reach `/cards/new`, so the signup worked. The "no auth user" failure only means the
  new user wasn't in the first 50 rows returned. The admin list isn't guaranteed to be newest-first,
  so once the project has more than 50 users (the real accounts plus any leftover `qa-*` accounts),
  a fresh signup can fall outside page 1.
- The failure was seen once (2026-10-20). I didn't reproduce it, because I can't run commands here.
- A side effect: when the lookup misses, the account isn't pushed to `extraUsers`, so the `finally`
  block never deletes it and the throwaway account leaks.

## Suggested fix (needs someone allowed to touch `scripts/`)
- Look the user up by email rather than scanning one page. Either page through all results until the
  email matches, or filter on the email if the admin endpoint supports it.
- Also sweep leftover `@swiftcard-test.invalid` users.

## Why no app change
Nothing in the app is wrong. The browser landed on the card builder as intended. I didn't edit app code
or add a test, because a test would only pin harness behaviour and would not fail before and pass after
an app fix.
