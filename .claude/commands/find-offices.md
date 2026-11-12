---
description: Find offices whose decision-maker could buy SwiftCard's Office plan, score each on the stated criteria, and save them as leads. Usage - /find-offices <area, type, count>
argument-hint: <area, type, count>   e.g. "Brooklyn, independent brokerages, 10"
---

Find offices for Card Builder outreach: **$ARGUMENTS**

Read the three parts as *area*, *type of office* and *how many*. If the type is
missing, look for all three kinds: **independent brokerages, agent teams and
mortgage branches**. If the count is missing, find 10.

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
a lead here, however senior.

## The six criteria (the score)

Every office is scored on the same six things, and the reply shows the
breakdown for each office, not just a number. The tool adds the points up; you
supply the evidence.

| Criterion | Points | What counts as evidence |
|---|---|---|
| **5 to 50 people** | 20 | A count from their own team page. Not shown = unknown, never a guess. |
| **Independent**, or a team whose leader can buy without corporate approval | 20 | Their site says independently owned; or it is a named team that runs its own brand, site and marketing inside a larger brokerage. |
| **Decision-maker named, with a direct mobile or email** | 20 | Their own number or address, on their own site or brokerage profile. Worked out by the tool from `phone_kind` and the email. |
| **Active in the last 60 days** | 15 | A listing, a closing or a post **with its date and its page**. No date, no points. |
| **Agents meet clients in person** | 15 | Open houses on their listings or calendar, local events, a storefront office. |
| **Growing or recruiting** | 10 | A careers or "join us" page, a recruiting post, new agents announced. |

`"met": null` means you looked and couldn't tell. Say so; don't round it up.

## Disqualified (not a lead; say why)

- a **franchise or corporate branch where head office decides** what agents use
  (`"corporate_decides": true`)
- **under 5 people**
- **no named leader**
- **only a general office line and an info@ / hello@ address**: no direct
  mobile or email for the decision-maker

The tool refuses to save any of these and returns the reason. A competitor's
card already in use is **not** on this list.

## What they use today

For each office, look at how its people share contact details now and record
it as `current_tool`:

| You see | `current_tool` |
|---|---|
| Nothing digital: phone numbers and emails typed on the site, a PDF or photo of a paper card | `paper` |
| A Linktree / Beacons / "link in bio" page on their social profiles | `link_in_bio` |
| A Popl, Linq, Blinq, HiHello or Dot card or link (`popl.co/…`, `linqapp.com/…`, `blinq.me/…`, `hihello.me/…`, `dot.cards/…`) | `popl`, `linq`, `blinq`, `hihello`, `dot` |
| Some other digital business card | `other_digital` |

Give `current_tool_source`: the page you saw it on. Leave both out if you
couldn't tell. **A competitor in use isn't disqualifying, but it changes the
pitch**: say so in the reply.

## Steps

1. **Start with what we already have.** Run
   `node scripts/card-builder.mjs leads --area "<regex for the area>" --limit 40`
   (for New York City use `New York|NY|Manhattan|Brooklyn|Queens|Bronx|Staten Island`).
   It returns office leads already in `crew_leads` that have no preview and
   have not been contacted. A lead there is a *company*: the named person may
   be a guess the agents made, so confirm and score each one like any other.

2. **Then search for more, across all three kinds**: brokerages, agent teams
   and mortgage branches ("independent real estate brokerage Park Slope",
   "real estate team Astoria meet the team", "mortgage branch manager Brooklyn
   NMLS branch", a lender's branch directory, Zillow team profiles).
   **Run as many searches as it takes to return the count asked for.** An
   office that is disqualified or can't be confirmed doesn't count toward it:
   keep searching. Stop only when you have the count, or when a dozen further
   searches in a row have turned up nothing new, and then say how many you
   found and why you stopped.
   Before researching a new office in depth, run
   `node scripts/card-builder.mjs check <file.json>` with
   `[{ "company", "website", "email", "phone" }]` and **drop anything it marks
   `skip`** (do-not-contact list, already contacted, already has a preview) or
   that already has a `lead_id` (it will have come up in step 1).

3. **For each office, identify the decision-maker by name and role, with the
   source.** Open their own site's About / Team / Leadership page, or their
   brokerage or NMLS profile, and read it. The source is the page that *says*
   this person holds that role. A search snippet is not enough on its own.
   - Double-check the spelling of the name against the page, letter by letter.
   - Never guess. If two people could be the one in charge, pick the one the
     page names as owner/broker of record and say who the other is in `why`.

4. **Contact details.** Prefer their direct mobile and their own email, when
   their own site or brokerage profile publishes them. Label every number:
   `"phone_kind": "mobile"`, `"direct"`, or `"office line"` when that is all
   there is. Do not take personal numbers from people-search or data-broker
   sites, and never invent an email from a pattern.

5. **Collect the evidence** for the criteria and what they use today, then
   write every office you looked at (including the ones you expect to be
   disqualified) to a JSON file in the scratchpad:

   ```json
   [{
     "company": "Harbor Realty Group", "website": "https://harborrealty.com",
     "name": "Dana Whitfield", "title": "Broker / Owner",
     "buyer_role": "broker_owner", "buyer_source": "https://harborrealty.com/about",
     "phone": "(718) 555-0199", "phone_kind": "mobile", "email": "dana@harborrealty.com",
     "business_type": "real estate brokerage", "city": "Brooklyn", "region": "NY",
     "team_size": 14, "corporate_decides": false,
     "current_tool": "link_in_bio", "current_tool_source": "https://www.instagram.com/harborrealty",
     "evidence": {
       "independent": { "met": true, "note": "\"Independently owned since 2009\" on the About page", "source": "https://harborrealty.com/about" },
       "active": { "met": true, "note": "Listed 88 Hicks St", "date": "2026-11-03", "source": "https://harborrealty.com/listings/88-hicks-st" },
       "in_person": { "met": true, "note": "Two open houses on their calendar this weekend", "source": "https://harborrealty.com/open-houses" },
       "growing": { "met": null, "note": "No careers page; no recruiting posts found" }
     },
     "why": "Independent brokerage, 14 agents on the team page, owner named with her own mobile.",
     "hook": "Two open houses this weekend, 88 Hicks St and 14 Garden Pl."
   }]
   ```

   Run `node scripts/card-builder.mjs fit <file.json>` to see each office's
   score, its six lines and whether it is disqualified.

6. **Save the ones that qualify**:
   `node scripts/card-builder.mjs save-leads <file.json>`. It saves to the
   Office list in `crew_leads`, one lead per company, ranked by the score, and
   returns `disqualified` and `refused` with the reasons. Leads from step 1
   are already saved; they come back as refused ("already a lead"), which is
   expected.

## Reply with

One ranked list, best fit first: the offices from step 1 and the new ones
together, labelled brokerage / team / mortgage branch. For each:

- office, decision-maker and role, with the source link
- phone (with its label) and email
- **the breakdown: all six criteria, yes / no / unknown, with the evidence**,
  and the total
- what they use today, and if it is a competitor, how that changes the pitch
- whether it was already a lead or is new

Then the offices you **disqualified** and the reason for each, and any you
left out because you couldn't confirm who is in charge.

End by asking which one to `/build-card`. Build nothing yourself.
