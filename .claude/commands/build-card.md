---
description: Research one office and build its decision-maker a preview card in Card Builder, as a draft. Usage - /build-card <office or person, city>
argument-hint: <office or person, city>   e.g. "Harbor Realty Group, Brooklyn"
---

Build a Card Builder preview, as a **draft**, for: **$ARGUMENTS**

The result is a draft only staff can see. **Do not publish it and do not send
anything to anyone.** The owner reads it, fixes it and publishes it.

## The rules

- **Only for a buyer.** The card is for the person in charge of the team or
  office: a broker-owner, managing broker, team lead or branch manager. If the
  person named is an individual agent or loan officer, find who runs their
  office and build for them instead, and say so. If you can't establish who is
  in charge, stop and say so; build nothing.
- **Never guess.** A field you couldn't confirm is left out, not filled with
  something plausible. Every fact you do put in carries the page it came from.
  Mark it `"uncertain": true` when the page is old, second-hand or ambiguous.
- **Spelling.** Check every name, letter by letter, against the page it came
  from, before you save and again when you look at the screenshots.
- **Public business sources only**: their own website, their brokerage
  profile, Zillow, StreetEasy, their LinkedIn *company* page, their Google
  Business listing. Not personal social accounts, not people-search sites.
- **A headshot only from their own business website or their brokerage
  profile.** Never from LinkedIn, Instagram, Facebook or an image search. The
  tool refuses one without such a source. No headshot is fine.

## Steps

1. **Is this office already in hand?** Write `[{ "company", "website" }]` to a
   file and run `node scripts/card-builder.mjs check <file.json>`. If it says
   the office already has a preview, has been contacted or is on the
   do-not-contact list, stop and report that. If it gives a `lead_id`, keep it
   for step 4.

2. **Research.** Open the real pages and read them (don't rely on search
   snippets). Collect, each with its source URL:
   - the decision-maker: name, title, which of the four roles, and one sentence
     on why they are the one who decides (`buyer_reason`), from the page that
     says so
   - 3 to 6 team members with their titles (and a headshot address only if it
     is on the office's own team page or brokerage profile)
   - the logo: the direct `https://` address of the image file
   - phone and email: their direct line and own email when their own site or
     brokerage profile publishes them; otherwise the office line. Say which it
     is in the phone source's `note` ("Office line", "Her mobile, on her
     brokerage profile")
   - office address and website, and their social links (full addresses)
   - team size, if a page shows it
   - one line for `specialty` (what the office is known for, as they put it)
   - one **specific detail** that finishes the sentence "I noticed …": a recent
     listing, the neighborhoods they cover, a milestone. Write it so it reads
     naturally after "I noticed", e.g. `you cover Park Slope and Windsor Terrace`.

3. **Colors.** Run `node scripts/card-builder.mjs colors <logo url> <website url>`
   and use what it returns for `brand_primary` and `brand_secondary`. If it
   can't read them, take the colors by eye from their site and mark the
   `colors` source uncertain.

4. **Create the draft.** Write the preview to a JSON file in the scratchpad
   and run `node scripts/card-builder.mjs create-draft <file.json>`:

   ```json
   {
     "office_name": "Harbor Realty Group",
     "owner_name": "Dana Whitfield", "owner_title": "Broker / Owner",
     "buyer_role": "broker_owner",
     "buyer_reason": "Named owner and Broker of Record on the About page",
     "phone": "(718) 555-0199", "email": "dana@harborrealty.com",
     "logo_url": "https://harborrealty.com/logo.png",
     "address": "12 Front St, Brooklyn, NY 11201", "website": "https://harborrealty.com",
     "specialty": "Brownstones in Brooklyn Heights and Cobble Hill",
     "detail": "your new listing on Hicks Street", "team_size": 14,
     "brand_primary": "#0B3D2E", "brand_secondary": "#E7C873",
     "crew_lead_id": "<lead_id from step 1, if any>",
     "team_members": [{ "name": "Marcus Lee", "title": "Office Manager" }],
     "social_links": { "instagram": "https://www.instagram.com/harborrealty" },
     "sources": {
       "owner_name": { "url": "https://harborrealty.com/about" },
       "buyer_role": { "url": "https://harborrealty.com/about" },
       "phone": { "url": "https://harborrealty.com/contact", "note": "Office line" },
       "team_members": { "url": "https://harborrealty.com/team" },
       "detail": { "url": "https://harborrealty.com/listings/hicks-st", "uncertain": true, "note": "Listing page undated" }
     }
   }
   ```

   Leave out every key you couldn't confirm. The tool applies the same checks
   as the admin's edit screen and always creates a draft. If it refuses, read
   why and fix the input; don't work around it.

5. **Look at it, on a phone and on a computer.** Run
   `node scripts/card-builder.mjs shots <id>`. It renders the real preview page
   at 390px and 1280px and lists what it can measure (a picture that didn't
   load, text off the screen). Then **open both PNG files and look**: the logo
   is the right one and not stretched or invisible against the card, the
   colors look like their brand, the names are spelled right, the headshot is
   the right person, nothing is cut off.

6. **Fix anything that looks off** by editing the JSON and running
   `node scripts/card-builder.mjs update-draft <id> <file.json>`, then run
   `shots` again. A logo that won't load or is unreadable on the card: use a
   different file of the same logo from their site, or leave it out (the card
   then shows their initials) and say so.

## Reply with

- the **draft link** and the **edit link** the tool returned (both need the
  owner to be signed in to the admin)
- what you found, as a short list, each fact with its source
- what you **couldn't confirm** and left blank or marked uncertain
- anything the owner should look at before publishing

The draft is not public and nothing has been sent. Say that last.
