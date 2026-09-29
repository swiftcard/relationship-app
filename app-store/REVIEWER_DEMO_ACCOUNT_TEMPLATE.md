# Reviewer Demo Account — Template

_NO real passwords in this repo. This file is the template; the owner fills
the password into App Store Connect only._

## Creating the account

```bash
node scripts/create-apple-review-account.js          # both tiers
node scripts/create-apple-review-account.js free     # just the Free one
```

**TWO accounts, and the Free one leads.** Giving App Review only a Pro account
is part of how 1.0.0 (3) was rejected under Guideline 3.1.1: the reviewer saw
Pro-only features working with no way to buy them, while our notes claimed
nothing was unlocked in-app. The Free account shows the app in its default
state — plan gates visible, each carrying the "Subscribe on swiftcard.me"
button that opens the default browser.

- **Free** — `applereview-free@swiftcard.me`, fictional persona **Sam Okafor,
  Real Estate Agent at Harbor & Oak Realty**, 2 seeded demo contacts and ~24
  card views. This is the account to put in the App Store Connect
  username/password fields.
- **Pro** — `applereview@swiftcard.me`, fictional persona **Alex Chen, Founder
  & Principal at Northbeam Studio**, 3 seeded demo contacts and ~24 card views,
  so every feature can be exercised without payment. Give these credentials in
  the notes text.

Neither uses real customer data.
- The password prints ONCE. Store it in your password manager, paste it into
  App Store Connect → App Review Information, and nowhere else.
- Re-running the script does NOT reset the password — it is idempotent and
  bails if the account exists. To rotate: Supabase Studio → Authentication →
  Users → applereview@swiftcard.me → Reset password.

### Status: created 2026-08-09

`applereview@swiftcard.me` exists in production, Pro tier, with the card
provisioned (`/card/apple-review-bd38b805` returns 200), 3 demo contacts and
24 card views seeded. The generated password is at
`~/.swiftcard/apple-review-account.txt` (mode 600) — move it into your
password manager and App Store Connect, then delete that file.

⚠️ The first run seeded **0** card views: the script picked view dates at
random, `(username, visitor_id, day)` is UNIQUE, and one collision in a single
batch insert rejects all 24 rows — leaving the reviewer an Analytics screen of
zeros, which is the opposite of the point. Fixed to derive the day from the
index so the pairs are unique by construction, and the 24 views were
backfilled.

## What the reviewer account must demonstrate (verify before every submission)

- [ ] Signs in with email + password on a clean install.
- [ ] Dashboard shows a populated business card with a working QR.
- [ ] Public card link opens in Safari (never inside the app) and shows the share-back form
      and the "Report this card" link at the bottom.
- [ ] Contacts list contains 2–3 FICTIONAL demo leads with tags/statuses.
- [ ] Analytics shows non-zero demo views.
- [ ] Swift Links page is populated.
- [ ] Apple Wallet add works (configured 2026-08-10; endpoint verified serving a signed pass for this very account).
- [ ] Settings → Advanced account settings → Delete account is reachable
      (reviewer may test deletion — if they do, RE-RUN the script before the
      next submission; deletion is real).
- [ ] On the FREE account, a locked feature (Contacts → Add contact → "Scan a
      business card") shows the plan gate WITH the "Subscribe on swiftcard.me"
      button, and tapping it leaves the app for the default browser. ⚠️ Test
      this on a device every time — the whole 3.1.1 remedy is that the tap
      genuinely exits to Safari rather than opening an in-app sheet.
- [ ] The AI notice appears before the first AI feature, names Google, lists
      what is sent, and "Don't allow" actually blocks the scanner.
- [ ] No in-app checkout, price, or embedded payment surface exists — the only
      purchase path is the external link above.

## App Store Connect fields

| Field | Value |
|---|---|
| Username | `applereview-free@swiftcard.me` (the Free account — default state) |
| Password | `<from the script run — DO NOT write it here>` |

The Pro credentials go in the notes text, not these fields. App Store Connect
accepts one pair, and the reviewer should start where a new customer starts.

## Notes

- The account is on Pro WITHOUT a Stripe subscription (plan set directly),
  so no real billing exists behind it and nothing can auto-renew or charge.
- Demo leads/analytics are fictional; the card belongs to a fictional persona
  (Alex Chen / Northbeam Studio) — keep it that way. All seeded contacts use
  `example.com` emails and `555-01xx` phone numbers.
