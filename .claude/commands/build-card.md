---
description: Build one decision-maker a preview card in Card Builder, as a draft, from a name and city, a link, or the owner's own notes, and write the outreach for them. Usage - /build-card <office or person and city | a URL | pasted notes>
argument-hint: <office or person, city | URL | pasted notes>   e.g. "Harbor Realty Group, Brooklyn"
---

Build a Card Builder preview, as a **draft**, for: **$ARGUMENTS**

## What you were given

Read the input as one or more of these. Use it as the starting point and
research the rest.

| You were given | Start by |
|---|---|
| **An office or a person, plus a city** | searching for their own site and brokerage profile |
| **A link** (their website, a LinkedIn company or public profile page, Zillow, StreetEasy, Instagram, a brokerage profile, a Google Business listing) | opening that page and reading it, then following it to their own site and the other sources |
| **Pasted notes or details from the owner** | taking every fact in them as **confirmed by the owner** (below), then researching what the notes leave out |

A mix is fine ("Dana at Harbor Realty, here's her Zillow, she told me they have
14 agents"). If the input doesn't let you tell which office or person is meant,
say what is missing and stop; don't pick one.

**Pick the sources that are best for this prospect.** Their own site first.
Then whichever of these actually has something about them: their brokerage
profile, license and NMLS records, Zillow, StreetEasy, their LinkedIn company
page and public profile page, their Google Business listing, their business
Instagram, local press (a neighborhood paper, a trade publication, a
"top producers" list). A team that lives on Instagram and Zillow is researched
there; a 30-year brokerage is researched on its site and in the press.

### What the owner pasted is confirmed by the owner

A fact the owner typed into the command is theirs: you don't need a page for
it and it must not trip the "Too generic" gate.

- Put it in the draft as given, and mark it **`"owner": true`** with the
  owner's own words as the `note`:
  - a fact with a source slot: `"sources": { "phone": { "owner": true, "note": "Owner: 'her cell is 718-555-0199'" } }`
  - who runs the office: `"sources": { "buyer_role": { "owner": true, "note": "Owner: 'Dana owns it'" } }`.
    That alone verifies the decision-maker; no second source is needed for
    what the owner told you.
  - a specific: `{ "kind": "other", "text": "…", "owner": true, "dated": "<today>" }`, no `source_url` needed
- **Only for what they actually wrote.** Something you inferred from their
  notes, or found while researching, is research: it needs its page, and the
  two-source rule for the decision-maker applies as before. The tool refuses
  an `owner` mark with no note.
- If your research **contradicts** a pasted fact (a different title, another
  phone number), keep the owner's, and say so in the reply.

The result is a draft only staff can see. **Do not publish it and do not send
anything to anyone.** The owner approves it in admin › Card Builder › Approve,
and sends every message by hand from their own phone.

The bar: the preview must look like **the card they would really use**, and
everything written from it must be about this office and nobody else. The edit
screen scores it; a draft with fewer than 3 verified specifics, an unverified
decision-maker or a generic hook is marked **Too generic** and can't be
published. Only the owner can override that, by hand. You can't, and
shouldn't try: keep researching until it passes, or report honestly that it
doesn't.

## The rules

- **Only for a buyer.** The card is for the person in charge of the team or
  office: a broker-owner, managing broker, team lead or branch manager. If the
  person named is an individual agent or loan officer, find who runs their
  office and build for them instead, and say so. If you can't establish who is
  in charge, stop and say so; build nothing.
- **Verify the decision-maker against a second source.** Their name's spelling
  and their role must be confirmed by two pages on two *different sites*: their
  own site, plus a state license lookup, their NMLS Consumer Access record,
  their brokerage profile, Zillow or StreetEasy. Two pages of the same site are
  one source. Put the first under `buyer_role` and the second under
  `buyer_second` in `sources`. If the two disagree on the spelling or the role,
  say so and mark it uncertain; don't pick one.
- **Never guess.** A field you couldn't confirm is left out, not filled with
  something plausible. Every fact you do put in carries the page it came from.
  Mark it `"uncertain": true` when the page is old, second-hand or ambiguous.
- **Spelling.** Check every name, letter by letter, against the page it came
  from, before you save and again when you look at the screenshots.
- **Public business information only**: their own website, their brokerage
  profile, license and NMLS records, Zillow, StreetEasy, their LinkedIn
  company page and the public part of their LinkedIn profile, their Google
  Business listing, their business social accounts, local press. Not personal
  accounts, not people-search or data-broker sites, nothing behind a login.
- **A headshot only from their own business website or their brokerage
  profile.** Never from LinkedIn, Instagram, Facebook or an image search. The
  tool refuses one without such a source. No headshot is fine.

## Steps

1. **Is this office already in hand?** Write `[{ "company", "website" }]` to a
   file and run `node scripts/card-builder.mjs check <file.json>`. If it says
   the office already has a preview, has been contacted or is on the
   do-not-contact list, stop and report that (to redo an existing draft, use
   `update-draft` with its id). If it gives a `lead_id`, keep it for step 5.

2. **Research the card they would really use.** Open the real pages and read
   them (don't rely on search snippets). Collect, each with its source URL:
   - **name and title exactly as they write them.** Copy the title character
     for character from their own page ("Co-Owner and Managing Broker", not
     "Broker / Owner"). `owner_title` is their words, not ours.
   - **license designation, if they show one**, exactly as shown
     (`"license": "Licensed Real Estate Broker"`, `"NMLS #123456"`). If their
     pages show none, leave it out.
   - which of the four roles they hold and one sentence on why they are the
     one who decides (`buyer_reason`), and the **second source** (above)
   - their **real headshot** (own site or brokerage profile only)
   - the **logo**: the direct `https://` address of the image file. Prefer the
     largest clean file. The preview adds an even margin around it by itself;
     don't pick a file because of its padding.
   - **colors and type feel from their site**: step 3 reads the colors.
     `"type_feel": "serif"` when their logo and headings are set in a serif,
     `"sans"` otherwise.
   - their **real tagline** for `specialty`: the line they use about
     themselves, copied from their site, not a summary you wrote. No tagline
     on their site means no `specialty`.
   - their **real links**: website and each business social profile, full
     addresses
   - phone and email: their direct line and own email when their own site or
     brokerage profile publishes them; otherwise the office line. Say which it
     is in the phone source's `note` ("Her mobile, on her profile page")
   - office address, and team size if a page shows it
   - **what they use today** to share contact details (`current_tool`: `paper`,
     `link_in_bio`, `popl`, `linq`, `blinq`, `hihello`, `dot`,
     `other_digital`), with the page you saw it on. A competitor doesn't stop
     the build; it changes the pitch.

3. **Team cards: each person's real title.** 3 to 6 team members. Use the
   title their site gives each person. **If the site gives none, use their
   license type** ("Licensed Real Estate Salesperson", "Associate Broker")
   when a page states it, **or leave the title off. Never invent one**, and
   never copy the owner's title onto someone else. A headshot only from the
   office's own team page or brokerage profile.

4. **Find at least 3 verified specifics** beyond name, logo and location, each
   with the page it is on and a date (`dated`, `YYYY-MM-DD`: the day it
   happened, or for something undated, the day you read it):
   - a current listing, **with its address** (`listing`)
   - a recent sale (`sale`)
   - an upcoming open house (`open_house`)
   - a recruiting post or careers page (`recruiting`)
   - **how many agents list a personal cell number** on the site: count them
     (`cell_numbers`)
   - years in business (`years`), an award (`award`), anything else true and
     checkable (`other`)

   A specific you couldn't date or source is marked `"uncertain": true` and
   does not count toward the 3.

   **Then pick the one that connects to what SwiftCard does, and build the
   hook around it.** SwiftCard does three things an office owner cares about:

   | `hook_angle` | SwiftCard does | A specific that leads there |
   |---|---|---|
   | `views` | tells you who viewed a card | cards and links going out with no way to know who looked: a new listing being marketed, a recruiting push |
   | `departures` | keeps the contacts with the office when an agent leaves | agents listing personal cell numbers; an agent who recently left or joined |
   | `open_house` | tracks open-house leads | an upcoming open house; a busy open-house calendar |

   The hook is three fields:
   - `detail`: the fact, written to finish the sentence **"I saw …"** and
     naming the address, the number or the event
     (`all 8 of your agents list their own cell number on your site`)
   - `hook_specific`: the position (from 0) of that specific in `specifics`
   - `hook_why`: one full sentence, said to them, on **why it matters to
     them** (`When one of them moves on, every client who saved that number
     goes with them.`)

   **"You cover Park Slope" is not a hook**, and neither is a compliment. If
   the sentence would be just as true of the brokerage next door, it isn't one.

5. **Colors, then create the draft.** Run
   `node scripts/card-builder.mjs colors <logo url> <website url>` and use what
   it returns. If it can't read them, take the colors by eye from their site
   and mark the `colors` source uncertain. Write the preview to a JSON file in
   the scratchpad and run `node scripts/card-builder.mjs create-draft <file.json>`:

   ```json
   {
     "office_name": "Harbor Realty Group",
     "owner_name": "Dana Whitfield", "owner_title": "Owner & Principal Broker",
     "license": "Licensed Real Estate Broker",
     "buyer_role": "broker_owner",
     "buyer_reason": "Named owner and Broker of Record on the About page",
     "phone": "(718) 555-0199", "email": "dana@harborrealty.com",
     "logo_url": "https://harborrealty.com/logo.png", "type_feel": "serif",
     "address": "12 Front St, Brooklyn, NY 11201", "website": "https://harborrealty.com",
     "specialty": "Brooklyn Heights brownstones since 2009",
     "team_size": 14, "current_tool": "link_in_bio",
     "brand_primary": "#0B3D2E", "brand_secondary": "#E7C873",
     "crew_lead_id": "<lead_id from step 1, if any>",
     "team_members": [{ "name": "Marcus Lee", "title": "Associate Broker" }, { "name": "Ana Ruiz" }],
     "social_links": { "instagram": "https://www.instagram.com/harborrealty" },
     "specifics": [
       { "kind": "open_house", "text": "Open house at 88 Hicks St, Sunday Nov 16, 1-3pm", "source_url": "https://harborrealty.com/open-houses", "dated": "2026-11-16" },
       { "kind": "listing", "text": "Listed 14 Garden Pl, a 4-bedroom brownstone, at $3.4M", "source_url": "https://harborrealty.com/listings/14-garden-pl", "dated": "2026-11-03" },
       { "kind": "cell_numbers", "text": "11 of 14 agents list a personal cell number on the team page", "source_url": "https://harborrealty.com/team", "dated": "2026-11-12" }
     ],
     "detail": "your open house at 88 Hicks St this Sunday",
     "hook_specific": 0, "hook_angle": "open_house",
     "hook_why": "Everyone who walks through can tap your card instead of signing a sheet, and you leave with their details.",
     "sources": {
       "owner_name": { "url": "https://harborrealty.com/about" },
       "owner_title": { "url": "https://harborrealty.com/about" },
       "buyer_role": { "url": "https://harborrealty.com/about" },
       "buyer_second": { "url": "https://appext20.dos.ny.gov/nydos/details.do?anchor=…", "note": "NY DOS license record: Dana Whitfield, Real Estate Broker, Harbor Realty Group" },
       "phone": { "url": "https://harborrealty.com/team/dana-whitfield", "note": "Her mobile, on her profile page" },
       "team_members": { "url": "https://harborrealty.com/team" },
       "specialty": { "url": "https://harborrealty.com" },
       "detail": { "url": "https://harborrealty.com/open-houses" },
       "current_tool": { "url": "https://www.instagram.com/harborrealty", "note": "Linktree in the bio" }
     }
   }
   ```

   Leave out every key you couldn't confirm. The tool applies the same checks
   as the admin's edit screen and always creates a draft. If it refuses, read
   why and fix the input; don't work around it.

6. **Score it.** Run `node scripts/card-builder.mjs quality <id>`. It returns
   the checklist the owner will see, whether the draft is too generic, and
   the three messages written from it. **Read the messages.** Each must open
   with the hook and say why it matters. If any of them could go to another
   brokerage unchanged, the hook is wrong: rewrite `detail` and `hook_why`,
   `update-draft`, and run it again. If the draft is too generic, go back and
   find what is missing rather than padding it. (At this point the messages
   are still the standard wording; you write the real ones in step 9.)

7. **Look at it, on a phone and on a computer.** Run
   `node scripts/card-builder.mjs shots <id>`. It renders the real preview page
   at 390px and 1280px and lists what it can measure. Then **open both PNG
   files and look**: the logo is the right one, has room around it and isn't
   stretched or invisible against the card; the colors and type feel like
   their brand; the title is theirs, word for word; the names are spelled
   right; the headshot is the right person; nothing is cut off.

8. **Fix anything that looks off** by editing the JSON and running
   `node scripts/card-builder.mjs update-draft <id> <file.json>`, then run
   `quality` and `shots` again.

9. **Write the outreach for this prospect, yourself, and save it.** Not the
   standard wording: seven messages written for this office and nobody else,
   in the owner's voice. You write them here, in this command; the app never
   calls a paid API to do it. Put them in a JSON file and run
   `node scripts/card-builder.mjs set-outreach <id> <file.json>`:

   ```json
   {
     "first_text": "Hi Dana, Menash from SwiftCard. Saw your open house at 88 Hicks St Sunday. I made you a card for it. Want me to send it?",
     "link_text": "Dana, here's the card. 11 of your 14 agents hand out their own cell, this keeps those contacts with Harbor: {link}",
     "email_subject": "Dana, a card for 14 Garden Pl",
     "email_body": "Hi Dana,\n\n…\n\nHere it is: {link}\n\nMenash\nFounder, SwiftCard",
     "call_opener": "Hi Dana, it's Menash, I sent you the card. …",
     "voicemail": "Hi Dana, it's Menash from SwiftCard. …",
     "nudge_no_view": "Dana, the card I made for Harbor is still up. Worth 20 seconds before Sunday's open house: {link}",
     "nudge_viewed": "Dana, saw you opened the card. Tried you just now. Is later today or tomorrow morning better for 5 minutes?",
     "uses": { "first_text": 0, "link_text": 2, "email_body": 1, "call_opener": 0, "voicemail": 2, "nudge_no_view": 0, "nudge_viewed": 1 }
   }
   ```

   The seven:
   - `first_text`: the first text, **no link**. One true thing about them and
     a question: do they want the card?
   - `link_text`: the second text, with `{link}`
   - `email_subject` and `email_body`: the email version, with `{link}`
   - `call_opener`: what the owner says when they pick up
   - `voicemail`: what the owner says after the beep, 20 seconds at most
   - `nudge_no_view`: for a link sent two days ago and never opened
   - `nudge_viewed`: for someone who looked at the card and didn't pick up

   The rules, which the tool enforces:
   - **Each message is built on a verified specific, and they use different
     ones where the draft has them.** `uses` says which (its position in
     `specifics`, from 0). With three verified specifics, all three must
     appear across the messages.
   - **A text is 160 characters at most**, counted with the real link in place
     of `{link}` (the link is about 50 characters; the tool tells you the
     count). That is `first_text`, `link_text` and both nudges.
   - **No emojis. Never the word "free".** No compliment or filler ("love
     your site", "just checking in", "hope this finds you well").
   - Write `{link}` where the link goes, never an address.

   And the ones only you can judge:
   - **It sounds like a founder texting by hand.** Short, plain words, first
     name, one thought. No "I hope", no "reaching out", no exclamation marks,
     no sales words ("solution", "streamline", "elevate"), no dashes for drama.
     Read it aloud: if it sounds like an ad, rewrite it.
   - Sign with the owner's first name only if you know it (from the pasted
     notes or an earlier message in this session); otherwise write "the
     founder of SwiftCard" and say so in the reply.
   - Nothing in a message that isn't in the draft's verified facts. A message
     may not introduce a fact.

   If the tool refuses, fix what it lists and run it again. Then run
   `quality <id>` once more: it returns every message as the screens will
   show it. Copy them from there into your reply.

## Reply with

- **the full outreach, word for word**: the first text, the text with the
  link, the email (subject and body), the call opener, the voicemail script
  and both nudges, each with which specific it is built on and, for the
  texts, its character count

- the **draft link**, the **edit link** and the **approve link** the tool
  returned (all need the owner to be signed in to the admin)
- the **personalization score**, and whether it is too generic (and if so,
  exactly which item is missing and what you tried)
- the specifics, each with its source and date (or "confirmed by you"), and **the hook**: the fact,
  why it matters, and which SwiftCard feature it leads to
- the two sources for the decision-maker (or that the owner told you who runs it)
- anything of the owner's that your research contradicted
- what they use today, and how that changes the pitch
- what you **couldn't confirm** and left blank or marked uncertain
- anything the owner should look at before publishing

The draft is not public and nothing has been sent: it is waiting in admin ›
Card Builder › Approve. Say that last.
