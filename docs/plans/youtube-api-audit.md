# YouTube Data API — compliance audit answers (prepared 2026-10-04)

Form: https://support.google.com/youtube/contact/yt_api_form
Why: videos uploaded through the API from an unaudited project are forced
PRIVATE. The audit lifts that and lets Agent Flow publish public videos.

## Section 1 — Request type
Complete a compliance audit to request for additional quota.
(Our need is the audit itself; keep the quota request modest — see Section 5.)

## Section 2 — Organization and contact
- Organization: SWIFT CARD INC
- Address: 371 E Shore Road, Great Neck, NY 11023, United States
- Website: https://swiftcard.me
- Contact: hello@swiftcard.me (the Google Workspace account that owns the
  YouTube channel and the Cloud project)
- Role: owner/operator of the application and the YouTube channel

## Section 3 — Business model
- What SwiftCard is: a digital business card product (web + iOS app) for
  real estate agents, loan officers, insurance agents and trades. Revenue
  comes from Pro subscriptions ($4.99/month or $53.99/year) and the Office
  plan; nothing is charged for or earned from YouTube.
- Monetisation of API usage: none. The API is used only to publish our own
  marketing videos to our own channel.
- Google contacts: none.

## Section 4 — API client
- Google Cloud project: swiftcard-agents (project number: see Cloud console →
  IAM & Admin → Settings)
- API client name: "SwiftCard Agent Flow" (OAuth web client)
- Which API services: YouTube Data API v3 — videos.insert (resumable upload),
  channels.list (mine=true, to show which channel is connected)
- Scopes: youtube.upload, youtube.readonly
- Who uses it: ONE user — the SwiftCard team, signing in with the Google
  account that owns the @swiftcard-businesscard channel. There are no
  third-party users; the client is an internal admin tool.
- Where it runs: https://swiftcard.me/admin/agent-flow (staff-only, behind
  login); server code at swiftcard.me (Next.js on Vercel).
- Privacy policy: https://swiftcard.me/privacy — Terms: https://swiftcard.me/terms
- Data handling: no YouTube user data is stored except the channel id and
  title of our own connected channel and encrypted OAuth tokens; nothing is
  shared, sold or used for advertising; tokens can be revoked from the
  admin page (Disconnect) and are deleted on disconnect.

## Section 5 — Use case and quota
- Use case: our marketing team reviews a drafted video (title, description,
  tags, a rendered MP4) and clicks Approve; the client uploads it to our own
  channel with videos.insert. That is the entire use of the API.
- Volume: at most ~5 uploads a week; ~2,000 units each → ~10,000 units/week.
  The default 10,000 units/day quota is sufficient. We are NOT asking for
  more quota; we are asking for the audit so uploads can be public.
- No reading of other channels, no comments, no search, no analytics.

## Section 6 — Evidence
- Screenshot 1: Agent Flow → Settings → Connections showing "YouTube —
  @swiftcard-businesscard ✓" (the connected channel).
- Screenshot 2: a queue item for platform "youtube" with the "✓ Approve &
  Upload to YouTube" button.
- Screenshot 3: the OAuth consent screen (Internal, Workspace) for the
  SwiftCard Agent Flow client.
- Demo video (if requested): screen recording of one Approve → the video
  appearing in YouTube Studio as private.

## Section 7 — Attestations
Affirm compliance with the YouTube API Services Terms of Service and
Developer Policies; the Required Minimum Functionality rules do not apply
(the client does not display YouTube data to users).
