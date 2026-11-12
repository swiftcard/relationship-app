---
description: Find offices whose decision-maker could buy SwiftCard's Office plan, and save them as leads. Usage - /find-offices <area, type, count>
argument-hint: <area, type, count>   e.g. "Brooklyn, independent brokerages, 10"
---

Find offices for Card Builder outreach: **$ARGUMENTS**

Read the three parts as *area*, *type of office* and *how many*. If the type is
missing, look for all three kinds below. If the count is missing, find 10.

This command only finds and saves leads. **Do not build cards, do not create
previews, do not contact anyone.** `/build-card` is the next step, and the
owner chooses who gets one.

## Who counts

The buyer is always the person in charge of a team or office, because only
they can buy the Office plan for everyone:

| Role | `buyer_role` |
|---|---|
| Broker-owner, owner, founder, principal broker, broker of record who owns the firm | `broker_owner` |
| Managing broker, sales manager who runs the office | `managing_broker` |
| Team lead of a named agent team | `team_lead` |
| Branch manager of a mortgage branch | `branch_manager` |

An individual agent, loan officer, assistant or marketing coordinator is never
a lead here, however senior. If you can't name the person in charge, the
office is not a lead yet: leave it out and say so.

The offices: independent brokerages, agent teams (including teams inside a big
brand) and mortgage branches with **roughly 5 to 50 people**. Count the people
on their team page; if the page doesn't show them, say the size is unknown
rather than guessing.

## Steps

1. **Start with what we already have.** Run
   `node scripts/card-builder.mjs leads --area "<regex for the area>" --limit 40`
   (for New York City use `New York|NY|Manhattan|Brooklyn|Queens|Bronx|Staten Island`).
   It returns office leads already in `crew_leads` that have no preview and
   have not been contacted. These come first. A lead there is a *company*: the
   named person may be a guess the agents made, so confirm each one in step 3
   like any other.

2. **Then search for more that fit**, until you have the count asked for.
   Search the web for the area and type ("independent real estate brokerage
   Park Slope", "mortgage branch manager Astoria NMLS", a brand's office
   directory, Google Business listings, Zillow team profiles).
   Before researching a new office in depth, run
   `node scripts/card-builder.mjs check <file.json>` with
   `[{ "company", "website", "email", "phone" }]` and **drop anything it marks
   `skip`** (do-not-contact list, already contacted, already has a preview) or
   that already has a `lead_id` (it will have come up in step 1).

3. **For each office, identify the decision-maker by name and role, with the
   source.** Open their own site's About / Team / Leadership page, or their
   brokerage profile, and read it. The source is the page that *says* this
   person holds that role. A LinkedIn search result or a directory snippet is
   not enough on its own.
   - Double-check the spelling of the name against the page, letter by letter.
   - Never guess. If two people could be the one in charge, pick the one the
     page names as owner/broker of record and say who the other is in `why`.

4. **Contact details.** Prefer their direct mobile and their own email, when
   their own site or brokerage profile publishes them. Label every number:
   `"phone_kind": "mobile"`, `"direct"`, or `"office line"` when that is all
   there is. Do not take personal numbers from people-search or data-broker
   sites, and never invent an email from a pattern.

5. **Score the fit, 0 to 100**, and say why in one sentence. Higher for: 5 to
   50 people confirmed, a named owner with a direct line, agents who meet
   clients in person (open houses, listings, events), no digital card visible
   on their site already. Lower for: size unknown, office line only, a
   franchise office where the brand supplies cards.

6. **Save.** Write the offices to a JSON file in the scratchpad:

   ```json
   [{
     "company": "Harbor Realty Group", "website": "https://harborrealty.com",
     "name": "Dana Whitfield", "title": "Broker / Owner",
     "buyer_role": "broker_owner", "buyer_source": "https://harborrealty.com/about",
     "phone": "(718) 555-0199", "phone_kind": "office line", "email": "dana@harborrealty.com",
     "business_type": "real estate brokerage", "city": "Brooklyn", "region": "NY",
     "team_size": 14, "fit": 82,
     "why": "Independent brokerage, 14 agents on the team page, owner named with her own email.",
     "hook": "Brownstones in Brooklyn Heights and Cobble Hill."
   }]
   ```

   then run `node scripts/card-builder.mjs save-leads <file.json>`. It saves to
   the Office list in `crew_leads`, one lead per company, and refuses anyone
   who isn't a buyer, has no source, or is on the do-not-contact list. Read
   what it `refused` and why.

   Leads from step 1 are already saved; don't save them again.

## Reply with

One ranked list, best fit first: the offices from step 1 and the new ones
together. For each: office, decision-maker and role, the source link, phone
(with its label) and email, team size or "unknown", fit score and the
one-sentence why, and whether it was already a lead or is new. Then what you
left out and why (couldn't confirm who is in charge, already contacted, too
big, too small).

End by asking which one to `/build-card`. Build nothing yourself.
