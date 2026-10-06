import { defineDocs } from "../types";

// Settings, billing, and the account lifecycle.
//
// This is where the old assistant was most wrong: it recited a Settings menu
// from before the sections were regrouped, and sent people to a "Danger Zone"
// that no longer exists anywhere in the product.

export const accountDocs = defineDocs([
  {
    id: "settings-map",
    title: "Where Settings is and what's in it",
    audience: ["user", "office-admin"],
    triggers: [
      "settings", "where is settings", "account settings", "where are settings",
      "preferences", "options", "configure",
    ],
    answer:
      "Settings is the gear icon at the top right of the app (or the \"Settings\" tab in the mobile bottom bar) — it opens /settings/flows. Its sections, in order: Profile, Cards and sharing, Plan and billing, Notifications and preferences, Security, Help and referrals, and Advanced account settings. One section opens at a time.",
    detail:
      "Watch out for old names — there is NO section called Billing, Integrations, General, Account, or Danger Zone. In particular: CRM integrations live inside \"Notifications and preferences\", not in a section of their own; account deletion is under \"Advanced account settings\"; the plan lives under \"Plan and billing\". \"Cards and sharing\" is for deleting a card and seeing its status — it has no Edit button; a card is edited from \"Edit\" on it in My Cards on the dashboard. Sign out moved: it is at the BOTTOM of the Profile section now, not in Security, and it asks for confirmation before it signs you out. Section descriptions: Profile — \"Your account details at a glance.\" Cards and sharing — \"Remove a card, and share your links.\" Plan and billing — \"Your plan, seats, invoices and payment method.\" Security — the account password only. Advanced account settings — \"Account ownership and deletion. Deleting is permanent.\"",
    commerce: true,
    nativeAnswer:
      "Settings is the gear icon at the top right of the app (or the \"Settings\" tab in the bottom bar). Its sections: Profile, Cards and sharing, Plan and billing, Notifications and preferences, Security, Help and referrals, and Advanced account settings. One section opens at a time.",
  },
  {
    id: "device-limit",
    title: "Signed in on two devices at a time",
    audience: ["user", "office-admin"],
    triggers: [
      "device", "devices", "two devices", "2 devices", "device limit", "how many devices",
      "signed in on another device", "sign out other device", "log out other device",
      "you're signed in on 2 devices already", "can't sign in", "cannot sign in",
      "kicked out", "signed out", "lost my phone", "stolen phone", "another device",
      "too many devices", "share my account", "log in on my computer",
    ],
    answer:
      "You can be signed in on 2 devices at a time. Settings \u2192 Profile \u2192 Devices (/settings/devices) shows which two, when each was last used, and which one you're on now \u2014 with a Sign out button beside each. If you try to sign in on a third, SwiftCard shows you that list instead of the dashboard: sign one out and the new device takes its place straight away, with no need to sign in again.",
    detail:
      "What counts as a device: one browser, or one app install. Every tab and every window of the SAME browser is one device, so you can have SwiftCard open in as many tabs as you like. Two DIFFERENT browsers on one computer (say Chrome and Safari) count as two, because nothing can see across them. The SwiftCard app on a phone is its own device. Signing out normally (Settings \u2192 Profile \u2192 Sign out) also gives the slot back. If you clear your browser's cookies, that browser looks like a brand-new device the next time you sign in, and the old entry sits in the list until you remove it \u2014 so if the list shows a device you don't recognise or no longer have, sign it out from any device you're still on and it loses access. Signing a phone out here also stops SwiftCard's notifications on that phone's lock screen.",
  },
  {
    id: "profile-and-email",
    title: "Your account email, and changing it",
    audience: ["user"],
    triggers: [
      "change my email", "change email", "account email", "login email", "wrong email",
      "my profile", "email address",
    ],
    answer:
      "Settings → Profile shows your account email, how many cards you have, and your plan — all read-only. There's no self-serve way to change the email you sign in with; contact the team through the Contact page for that.",
    detail:
      "Don't confuse the two emails. The sign-in email is fixed and lives on the account. The email printed on a card is a separate, per-card field edited in the card editor's \"Card info\" tab, and it is completely normal for them to differ.",
  },
  {
    id: "password-and-security",
    title: "Passwords, signing out, and 2FA",
    audience: ["user"],
    triggers: [
      "password", "change password", "reset password", "forgot password", "new password",
      "sign out", "log out", "logout", "where is sign out", "sign out button gone",
      "two factor", "2fa", "security",
    ],
    answer:
      "To sign out: Settings → Profile, then the red \"Sign out\" button at the bottom of that section. It asks \"Sign out of SwiftCard?\" first — tap \"Sign out\" again to confirm, or Cancel. It is no longer in the top-right corner of the screen, and it is not in Security. Settings → Security now holds only \"Password\", with a \"Change password\" link. If you've forgotten your password, use \"Forgot password?\" on the sign-in screen — type your email in the box first, then tap the link.",
    detail:
      "Changing the password from Settings does not ask for the current one; it takes you to the set-a-new-password page with your existing session. The new password must be at least 8 characters, typed twice (\"New password\" and \"Confirm new password\"), and can't be your email address or a very common password; a Weak/OK/Strong meter shows as you type, and \"Passwords don't match.\" means the two boxes differ. Accounts created before that rule can keep signing in with their existing shorter password until they set a new one. There is no two-factor authentication, no session list, and no API keys anywhere in the product — say so plainly rather than hunting for a setting. An account created with Google or Apple has no password at first, but running a password reset will set one, which then also allows email + password sign-in.",
  },
  {
    id: "plan-and-billing",
    title: "Your plan, invoices, and payment method",
    audience: ["user"],
    triggers: [
      "billing", "invoice", "invoices", "receipt", "payment", "payment method",
      "change card", "update payment", "my plan", "what plan am i on", "charge",
    ],
    answer:
      "Settings → Plan and billing shows your current plan, what you pay, and the renewal date. \"Manage subscription & payment\" opens the subscription panel, where you can switch plan or billing interval, and from there reach the Stripe portal for your payment method and invoices.",
    detail:
      "Two buttons carry the same \"Manage subscription & payment\" label — the one on the panel opens SwiftCard's own modal, and the one inside that modal opens the Stripe billing portal. The plan switcher offers Monthly / Annual (annual saves about 10%): pick the other period and your current plan shows \"Switch to annual\" / \"Switch to monthly\". It also lets a Pro account move to Office or back. Moving an OFFICE account to Pro first shows \"Switch to Pro and end your team?\": the Office plan ends immediately, seats are released, each teammate moves to their own plan (Free, or their own Pro) keeping their first card live without the company branding, the admin console goes away, and the unused Office time is credited to the next invoice; switching back to Office restores the team and branding (as many people as the seats allow). You cannot move to Free from the plan rows — that is a cancellation. Downgrades come back as credit on the next invoice, never a cash refund. Office accounts also get a \"Team seats\" block here. WHO GETS BILLING EMAILS: only the account that pays. On Office that is the owner — every receipt, seat change, trial reminder and failed-payment email goes to the owner's sign-in email; teammates never receive any of them, because their seat is paid by the company. A teammate who still has a Pro subscription of their own gets emails about that subscription only, labelled Pro, and they say plainly that their team access is unchanged.",
    commerce: true,
    nativeAnswer:
      "Settings → Plan and billing shows your current plan. If you subscribed in the app, tap \"Manage subscription\" there — it opens your Apple account's subscription settings, where the payment method and renewal live. If you subscribed on the web, it's managed where you subscribed.",
  },
  {
    id: "upgrade",
    title: "Plan prices and getting Pro or Office",
    audience: ["user"],
    triggers: [
      "upgrade", "go pro", "buy pro", "subscribe", "get pro", "unlock", "how do i pay",
      "pricing", "price", "cost", "how much", "plans", "what is pro", "free vs pro",
      "difference between free and pro", "whats included in pro", "what do i get with pro",
    ],
    answer:
      "Pro is {price.proMonthly} a month (or {price.proAnnual} a year, about 10% off) and takes every Free limit off — unlimited cards and new contacts, the business-card scanner, the custom designer, text follow-ups and AI-written follow-ups (email follow-ups are on every plan), full analytics and the CRM integrations. Office is {price.officeMonthly} per seat per month for a team. Settings → Plan and billing → \"Upgrade →\", or the /upgrade page, shows both with a Monthly / Annual switch (on a phone as two tabs, Pro and Office, opening on Pro — the same cards as the pricing page), and you see an order summary before anything is charged.",
    detail:
      "Subscribing to Pro starts with a {trial.days}-day free trial if you've never subscribed or had a Pro trial before — a card is taken at checkout and billing starts when the trial ends. The trial is once per PERSON, not per account: an email or a card that has already had a trial (including on an older, deleted account, or through the iPhone app) is charged from day one, and checkout says \"Billing starts today\" when that applies. Changing an existing plan in a way that costs money — Pro to Office, or monthly to annual, from Settings → Plan and billing → \"Manage subscription & payment\" — opens the same order review first, showing exactly what is due today, and nothing is charged until you confirm; a change of billing period moves the billing date to that day. Office has no free trial, so moving a Pro trial up to Office ends the trial and starts Office (and its first charge) that day. Someone who pays for Pro through the App Store can't buy Pro again on the website, and before buying Office there the order page reminds them to turn off the Apple renewal — SwiftCard can't cancel an App Store subscription, and Office already includes everything in Pro. A friend's referral month counts as that one free Pro period: an account that started its free month from a friend's link gets no {trial.days}-day trial afterwards (upgrading charges from day one, on the website and in the app), and someone who already had a trial is not offered the referral month. SwiftCard emails a reminder 7 days before a trial converts, giving the date and the amount, and Settings → Plan and billing shows \"Pro trial · N days left · first charge\" for the whole trial. Office never includes a trial. If you already have a subscription, changing plan swaps the price on your existing subscription rather than creating a second one, so you are never double-charged, and the proration you're quoted is the amount you're charged.",
    commerce: true,
    nativeAnswer:
      "You can subscribe to Pro right in the app: tap \"Upgrade to Pro\" on any locked feature, or go to Settings → Plan and billing. The subscription sheet shows the plans and prices before anything is confirmed, and it starts with a {trial.days}-day free trial if you've never subscribed before. Pro takes every Free limit off — unlimited cards and new contacts, the AI business-card scanner, the custom card designer, text follow-ups and AI-written follow-ups (email follow-ups are on every plan), full analytics, and the CRM integrations.",
  },
  {
    id: "promo-code-in-app",
    title: "Using a promo code in the iPhone app",
    audience: ["user"],
    triggers: [
      "promo code in the app", "promo code iphone", "promo code didnt apply", "promo code not working",
      "code didnt work", "my code didnt apply", "offer code", "redeem code", "promo code apple",
      "where do i enter a promo code", "discount code app",
    ],
    answer:
      "In the iPhone app, the \"Choose your plan\" step has \"Have a promo code?\" under the plans. Enter the code and press \"Apply\" — the box says what it gives (for example \"Two months free\") and \"Added to the Pro plan — tap its button to use it.\" The Pro card then changes to that offer: for a free-time code it reads \"Free for your first two months, then <Apple's price> / month\" and the button becomes \"Try Pro free for two months →\". That button opens Apple's code page with the code already filled in; Apple shows the offer before you confirm and bills it on your Apple account. Come back to the app and Pro switches on by itself (if it doesn't, tap \"Continue\" under the button). A code Apple can't take — money off, an Office code, or one that isn't set up on Apple yet — is used on swiftcard.me instead, and the Pro button says so: \"Use CODE on swiftcard.me →\" opens the website in your browser with the code filled in; sign in there with the same account.",
    detail:
      "The thing people get wrong: pressing the plain \"Try Pro free for {trial.days} days →\" button before applying the code. A code only counts when the box shows it as applied and the Pro button has changed — the plain button sells the normal subscription. Removing the code (\"Remove\" in the box) puts the Pro card back. Apple decides who a code is for on its own side: a code for new customers can't be redeemed on an Apple ID that is already subscribed to Pro. A free-time code replaces the {trial.days}-day trial rather than adding to it, the same as on the website, which is why codes shorter than {trial.days} days are only offered on the website.",
    commerce: true,
    nativeAnswer:
      "On the \"Choose your plan\" step, tap \"Have a promo code?\" under the plans, enter your code and press \"Apply\". When the box says \"Added to the Pro plan\", the Pro card changes to your code's offer — tap its button and Apple's code page opens with your code already filled in. Apple shows exactly what you get before you confirm, in the app with your Apple account. Come back to SwiftCard and Pro switches on by itself; if it doesn't, tap \"Continue\" under the button. Make sure you use the Pro card's button after applying the code — the code only counts once the button has changed. If Apple can't take your code, the Pro card's button says where to use it instead.",
  },
  {
    id: "trial-days-left",
    title: "How many days are left on a free trial or free Pro",
    audience: ["user"],
    triggers: [
      "days left", "trial days", "how long is my trial", "when does my trial end", "trial end",
      "trial ending", "free pro ends", "free month ends", "trial banner", "trial bubble", "countdown",
    ],
    answer:
      "Settings → Profile → General: under \"Plan\" there is a \"Free trial\" row (or \"Free Pro\" / \"Free Office\" for free time that isn't a trial) with the days left and the date it ends. It's there for the whole free period. The bubble at the top of the dashboard only appears on the account's first day — after that it is gone on purpose, so look in Settings.",
    detail:
      "Every kind of free period shows there the same way: the {trial.days}-day Pro trial, free time from a promo code, a friend's free month, the free days offered when deleting an account, a trial stretched to a full month, and free Office. When three days or fewer are left the row turns amber. A trial that has been cancelled says \"cancelled, you won't be charged\" instead of the end date. Plan and billing shows the same end date. A subscription started in the iPhone app with Apple's free trial has no countdown in SwiftCard — Apple doesn't share its end date; it's in the iPhone's Settings → Apple ID → Subscriptions. A free period that starts after the first day (for example a promo code entered later) never shows on the dashboard at all — only in Settings.",
  },
  {
    id: "cancel-subscription",
    title: "Cancelling, and undoing a cancellation",
    audience: ["user"],
    triggers: [
      "cancel", "cancel subscription", "stop paying", "downgrade", "switch to free",
      "end subscription", "keep subscription", "reactivate", "undo cancel",
    ],
    answer:
      "Settings → Plan and billing → \"Manage subscription & payment\" → \"Switch to Free\". You'll be asked why, then it schedules the cancellation for the end of the period you've already paid for — you keep everything until then. While it's pending, a green \"Keep Subscription\" button appears if you change your mind. On the {trial.days}-day Pro trial, the cancel flow first offers to keep the trial going free until a month from the day it started (\"Keep my trial until …\") — once per person; \"No thanks, continue canceling\" carries on.",
    detail:
      "THE TRIAL STRETCH: someone cancelling during the {trial.days}-day Pro trial (a trial started on the web with a card) is offered free Pro until 30 days after the trial started — on day 7 that is 16 extra days on top of the trial, and the end date is the same whichever day they ask. Accepting moves the first charge to that new date and keeps the subscription; cancelling any time before it costs nothing. It is offered for any reason, once per PERSON, and it is the same free month as the Free plan's delete-flow gift — whoever has had one never gets the other. Not offered when the trial is already cancelled, on Office, or for a trial started in the iPhone app (Apple sets that trial's length). Nothing is deleted when a plan ends — a trial that was cancelled or whose first charge failed ends the same way. The account gets a \"Your Pro trial has ended\" (or \"Your Pro plan has ended\") notification, and the top of the dashboard shows a panel with \"Keep Pro →\" and \"Continue on Free\". Continuing on Free asks \"Which card stays live?\" (only when there is more than one card) and lists what changes about the design, then \"Confirm — continue on Free\" converts the design; Swift Links are never removed. Until they choose, the oldest card is the live one. Extra cards go offline (their public pages stop loading, so QR codes and NFC cards pointing at them stop working), follow-up sequences pause, over-cap contacts get hidden rather than removed, and Pro colours and extra Swift Links stay stored. Re-subscribing switches it all back on. For an OFFICE account, cancelling also releases the team at the end of the period: seats end, each teammate moves to their own plan (Free, or their own Pro) keeping their first card live without the company branding, and the admin console closes; re-subscribing to Office brings the team back with its branding (as many people as the seats allow). The Office owner's notification says \"Your Office plan has ended\" (or \"Your Office trial has ended\"), not Pro, and tells them their teammates keep their first card without the company branding and the team is saved. The \"Keep Subscription\" button only exists while a cancellation is actually pending — don't promise it to someone who hasn't cancelled.",
    commerce: true,
    nativeAnswer:
      "If you subscribed in the app: Settings → Plan and billing → \"Manage subscription\" opens your Apple account's subscription settings, where you cancel. You keep everything until the end of the period you've already paid for, and nothing is deleted when a plan ends — the dashboard shows a panel where you choose which card stays live (\"Which card stays live?\" under \"Continue on Free\"), other cards go offline and over-cap contacts are hidden, and re-subscribing switches it all back on. If you subscribed on the web, cancel where you subscribed.",
  },
  {
    id: "failed-payment",
    title: "A payment that didn't go through",
    audience: ["user"],
    triggers: [
      "payment failed", "card declined", "declined", "past due", "grace period",
      "payment didn't work", "lost pro",
    ],
    answer:
      "If a renewal fails, Settings → Plan and billing shows an amber \"Your last payment didn't go through.\" banner and you keep full access during a short grace period. Update the payment method from that panel and the plan continues as normal.",
    detail:
      "Only a failed RENEWAL starts the grace period; a failed one-off or proration charge doesn't. If retries are exhausted the account moves to Free — again with nothing deleted.",
    commerce: true,
    nativeAnswer:
      "If a renewal doesn't go through you keep full access for a short grace period while the card on file is sorted out. That isn't something I can help with in the app — but I can still help with cards, contacts, sharing, analytics and settings.",
  },
  {
    id: "office-seats",
    title: "Team seats",
    audience: ["user", "office-admin"],
    triggers: [
      "seats", "add seats", "add a seat", "seat count", "how many seats", "buy seats",
      "more seats", "out of seats", "no seats", "remove seat", "reduce seats",
    ],
    answer:
      "Settings → Plan and billing → \"Team seats\". The stepper shows how many you've bought versus how many are in use, and adding seats takes effect immediately. You can also add a seat on the spot when you invite someone past your current count. Office needs at least {limit.seats} seats.",
    detail:
      "Seats in use = you + active members + pending invitations, and you can't reduce below that — remove members or revoke invitations first. Reductions are scheduled for the end of the billing period rather than applied immediately; increases are invoiced right away. Expired invitations stop holding a seat.",
    commerce: true,
    nativeAnswer:
      "If you invite someone past your current seat count, the invite dialog lets you know; remove an existing team member to free up a seat. Office needs at least {limit.seats} seats, and seats in use means you, plus active members, plus pending invitations.",
  },
  {
    id: "integrations",
    title: "CRM integrations and Zapier",
    audience: ["user"],
    triggers: [
      "integration", "integrations", "zapier", "google contacts", "hubspot", "pipedrive",
      "gohighlevel", "highlevel", "ghl", "crm", "sync", "connect crm", "webhook", "api",
    ],
    answer:
      "They're in Settings → Notifications and preferences, under \"Send contacts to your CRM\" — not in a section of their own. Connect Salesforce, GoHighLevel, Pipedrive, HubSpot or Google Contacts and new leads sync automatically; a Zapier webhook below them covers everything else. Integrations are a Pro feature.",
    detail:
      "Three of the five are token-paste rather than OAuth: GoHighLevel wants a Private Integration token plus a Location ID, Pipedrive wants a personal API token, HubSpot wants a service key (Settings → Integrations → Service Keys in HubSpot, with contact read and write access; an older private-app token also works). Salesforce and Google Contacts use a Connect button and an OAuth redirect — sign in on the provider's own page, no token to copy. Tokens are checked against the provider before saving, so a bad one is rejected immediately with a message naming that provider. The GoHighLevel Private Integration needs two boxes ticked, contacts.write AND locations.readonly — the most common failed connect is a token with only contacts.write, and the error then says exactly that. What gets sent: every new contact — someone sharing their details on a card, and also a contact added with \"Add contact\" or read off a scanned paper business card — plus later edits to a contact's name, email, phone, company, notes, where-you-met or tags. Each CRM record carries a note saying where you met, how they got the card, which card (with the name on it) and what they wrote; HighLevel contacts are also tagged \"swiftcard\" and \"swiftcard-<card link>\" so workflows can trigger on them. Meeting the same person again updates their existing record (matched by email) instead of making a second one, and SwiftCard never overwrites notes someone typed into the CRM themselves or removes tags the CRM already had. In Salesforce they arrive as Leads; someone who is already a converted Lead gets a completed \"Met again\" Task on their Contact instead of a duplicate Lead. Edits only reach the CRM when the contact has an email address. If a CRM starts refusing contacts, its card in Settings turns amber with \"Reconnect needed\" and says why. Once a connection exists, a \"Sending from …\" line with a \"Change\" link lets you pick which cards feed it (that picker doesn't appear on a single-card account). The Zapier box only accepts a real hooks.zapier.com catch-hook URL; its \"Test\" button sends a sample with every field a real lead has (type, name, email, phone, company, message, notes, where_met, location, source, card_owner, card_name, card_url, tags, created_at), so all of them can be mapped in the Zap straight away. On an Office team, the owner's connected CRMs and Zapier webhook receive every team member's new contacts too, each marked with the member's name — members don't need to set anything up, and the owner's \"which cards\" choice only filters the owner's own cards, never the team's. A member who connects their own copy of the same CRM (or saves their own Zapier webhook) sends there instead. There is no public SwiftCard API and no API keys.",
  },
  {
    id: "notifications-and-emails",
    title: "Push notifications and email preferences",
    audience: ["user"],
    triggers: [
      "push", "push notification", "notifications settings", "turn on notifications",
      "marketing emails", "stop emails", "email preferences", "receipts", "unsubscribe",
      "returning contacts", "re-opened your card", "contact came back",
    ],
    answer:
      "Settings → Notifications and preferences. The push switch at the top turns on instant alerts; directly under it, \"What we notify you about\" lists exactly what SwiftCard is allowed to send you — new contacts, replies, contact downloads, card views, returning contacts, billing problems and the weekly recap (plus \"Team alerts\" for Office admins) — each with its own switch, plus a \"Quiet hours\" switch. Those save the moment you tap them. Below that are the email switches — \"Marketing emails\" for everyone, and \"Payment receipts\" for anyone who is actually billed; those two need \"Save preferences\" pressed.",
    detail:
      "What can reach your phone is a short, fixed list and nothing else: someone shares their details, a contact replies to one of your follow-ups, someone downloads your contact card, one of your cards is opened, a contact you already have comes back to your card, a failed payment, and one \"Weekly recap\" on Monday (from 9am your time) with your week in numbers — \"Your week: 14 views · 2 contacts\" and your top place (shaded out on Free). A week with nothing in it sends nothing. The recap also lands in the bell on your dashboard, so you see it even with phone notifications off. An Office admin gets their TEAM's week instead of their own, plus \"Team alerts\" (see the Office help). \"Returning contacts\" is the one that says who: \"Priya re-opened your card\", with where you met and how many times they've been back this week. It only fires for someone who shared their details with you or opened a text or email SwiftCard sent them for you, never for the visit they first shared in, at most once per contact a day and five a day in all (separate from the card-view limits), and never for a contact you've marked Not interested or Closed. On the Free plan the alert says \"A contact re-opened your card\" and the name is blurred in the app. On the Free plan the place a view came from is shaded out on the phone too — \"Someone viewed your card in ▒▒▒▒▒, ▒▒.\" — always the same shape, whatever the place; in the app it is blurred. On the website a blurred alert has a \"See who and where →\" link under it; inside the iPhone app it does not. Someone who keeps opening your card shows up as \"3rd visit this week 👀\" (every plan). No tips and no promotions \u2014 those only ever appear in the bell inside the app and in email. A view milestone cannot ring your phone on its own either; all it can do is retitle a card-view alert that was already going out. Every plan gets the same notifications, free accounts included. Card views used to notify only the very first time a card was ever opened, which meant an active card could go silent forever. Every view is now a candidate, held down by four separate limits instead: one alert per visitor per visit, at most one view alert an hour, at most six an hour from any single network, and a cap of five a day across everything except leads, replies and billing \u2014 so a printed QR code at an event still cannot set off a stream of alerts. The very first view a card ever gets is titled \"Your card's first view!\" instead of the usual \"Card viewed\". A contact download alerts on its own only when it is the first thing that visitor does; if they viewed the card first, it quietly updates that same alert rather than buzzing a second time. Views that arrive inside the same hour as an alert are not thrown away either: they update a second, silent notification that counts them (\"6 views in the last hour\") \u2014 it makes no sound and never lights the screen, so a card going round an event can be watched without being interrupted by it. If one of those views takes the card past a view milestone, the alert that was already going out is titled with the celebration (\"50 views \u2014 on fire!\") instead of \"Card viewed\"; the milestone still never causes an alert of its own. Quiet hours hold everything between 10pm and 8am your own time \u2014 nothing at all reaches your phone in that window, billing included \u2014 and from 8am you get ONE catch-up notification for whatever came in overnight, not a replay of each one (none if you have already opened SwiftCard and seen it). Nothing is caught up until the app has learned your timezone, which happens the next time you open it. You can switch quiet hours off if you'd rather be told immediately. The email switches are NOT auto-saved — a common complaint is that the toggle looked flipped but nothing changed, which means \"Save preferences\" was never pressed. Every marketing email also carries an unsubscribe link that lands on /unsubscribe and works without signing in. Payment receipts and other transactional mail keep sending regardless. On a team, only the person who pays sees the \"Payment receipts\" switch at all: an Office member's seat is paid by the office owner, so they are never billed and never receive a receipt — the switch is hidden for them rather than offering control over mail that cannot arrive. It still shows for the office owner, for a member given the billing-admin role, and for a member who kept their own personal subscription from before joining the team, because those three really are charged. The push switch is also offered on the \"Your card is live!\" screen after a card is created, and as a box at the top of the dashboard \u2014 on the web as well as in the iPhone app, wherever the switch can actually be turned on there and then. That box asks at most twice: once titled \"Know the moment someone connects\", then, only if the card has since had real views, once more titled \"Your card is getting opened\" quoting the true number of opens. After the second \"Not now\" it never comes back and Settings is the only way in. Separately, when something important arrives — a new contact, a reply to a text follow-up, or someone downloading your contact card — and notifications are not reaching your phone, that notification in the bell (and in the dashboard’s notification list) can carry a small \"Get notifications like this on your phone\" box. In the iPhone app it has the switch itself, and it keeps appearing (at most twice, at least three days apart) until the phone gets notifications — notifications on a computer do not count. On a computer it says \"…on this computer\" and offers that computer’s switch, but only while none of your devices gets notifications; once the app does, the computer stays quiet. In Safari on an iPhone, where the website cannot send notifications without Add to Home Screen, it points to the SwiftCard app instead (\"open it and allow notifications, or download it here\"). The app and the website each have their own two reminders, so a \"Not now\" on a laptop never uses up the phone’s. It appears under one notification at a time and never while the dashboard box is already asking. \"Not now\" puts it away; \"Don’t ask again\" stops it and the dashboard box on every device. Switching push off yourself in Settings counts as \"Don’t ask again\" too. Choosing \"Don’t Allow\" at the phone’s own prompt does NOT: in the iPhone app the same reminder still comes with the next important notification (same limit of two, three days apart), but it reads \"Notifications are off for SwiftCard\" and offers an \"Open iPhone Settings\" button instead of a switch, because iOS will not show its prompt a second time. Flip Allow Notifications on there and come back to the app — push turns on by itself and the reminder says \"You’re set\". Settings → Notifications and preferences always has the switch; in Safari on an iPhone it now recommends the app first and still explains Add to Home Screen. If the app says \"This version of SwiftCard can't receive notifications yet\", the fix is to update the app from the App Store — tapping the switch again won't help. If it says notifications are turned off for SwiftCard, iPhone Settings → SwiftCard → Notifications → Allow Notifications is the only way back; the app cannot ask a second time. That is how iPhones work, not a fault: iOS shows its \"Allow / Don’t Allow\" box once per install and never again, so if you allowed it before, tapping the switch simply turns notifications on with no box — and if you chose \"Don’t Allow\", the message under the switch has an \"Open iPhone Settings\" button that goes straight to the right page. If you have more than one card, every notification on your phone or computer says which card it is about on its own line (\"Card: Work\" — it uses the card nickname, so giving each card a nickname in the editor makes these clearer), and tapping it opens that exact card: a new contact or a reply opens that person in Contacts, a view or a contact download opens that card’s dashboard. An account with a single card gets no card line. A failed payment also appears in the bell inside the app, not only as an email and a notification. When a contact answers one of your follow-up TEXTS you get a notification with their words; replies to follow-up EMAILS go to your own inbox and do not notify.",
  },
  {
    id: "ai-features-consent",
    title: "AI features and your data (permission switch)",
    audience: ["user"],
    triggers: [
      "ai consent", "ai permission", "allow ai", "turn off ai", "ai features",
      "ai privacy", "what does ai see", "where does my data go", "google ai",
      "gemini", "disable ai", "ai settings",
    ],
    answer:
      "In the iPhone app, SwiftCard asks permission before any AI feature runs, and the standing switch lives at Settings \u2192 Notifications and preferences \u2192 \"AI features\". While it's off (or before you've answered), nothing is sent to the AI provider \u2014 the card scanner and AI drafts wait, and the in-app assistant answers from its built-in knowledge instead.",
    detail:
      "What gets sent when AI is allowed: the photo you take when scanning a business card, a contact's name, company, where you met and your notes when AI writes a follow-up, and messages you type to the assistant \u2014 sent to the AI provider to produce the result and to no one else. The question is asked once, inside the app, after your card is live — it does not appear while you are building your first card, creating your account or choosing your plan, so a new account first sees it on the dashboard, on every plan. The guided tour waits for it: answer (\"Allow\" or \"Don't allow\") and the tour starts right after, never underneath it; the \"Take a quick tour\" banner waits the same way. An invited Office member who finishes an existing card on its editor is asked when they tap \"Go to my dashboard →\", and an Office owner opening the admin console for the first time in the app is asked before the admin tour. On the website there is no such question and the tour starts on its own. Saying no turns AI features off without affecting anything else. A decline made in the app is honoured on the website too. The privacy details live at swiftcard.me/privacy.",
  },
  {
    id: "email-preference-center",
    title: "Choosing which SwiftCard emails you get",
    audience: ["user"],
    triggers: [
      "unsubscribe", "stop emails", "too many emails", "opt out", "email preferences",
      "manage email preferences", "pause emails", "less email", "marketing emails",
      "how do i stop", "remove me from the list",
    ],
    answer:
      "Every marketing email from SwiftCard has a \"Manage email preferences\" link in its footer. It opens /email/preferences, where you can switch individual types on or off — lead alerts and follow-up tips, product updates, the weekly analytics digest, and offers — pause everything for 30 days, or unsubscribe from all marketing email. You do not need to sign in, and the link works from any device.",
    detail:
      "The link works for 90 days after the email was sent; after that, use a more recent email or the unsubscribe control your email app shows at the top of the message. Unsubscribing takes two taps — the link, then \"No thanks, unsubscribe me\" — and takes effect immediately, with no form to fill in. Gmail and Apple Mail also draw their own unsubscribe button on our marketing mail; that works instantly too. Account and lead notifications are NOT marketing and keep arriving whatever these switches say: sign-in and password emails, alerts when someone shares their details with you, billing and payment receipts. Someone who unsubscribes from everything still gets those.",
  },
  {
    id: "delete-account",
    title: "Deleting your account, and getting it back",
    audience: ["user"],
    triggers: [
      "delete account", "close account", "delete my account", "remove account",
      "reopen", "reopen account", "undo delete", "restore account", "cancel deletion",
    ],
    answer:
      "Settings → Advanced account settings → \"Account ownership and deletion\" → \"Delete account\". It's a short sequence — two questions about why you're leaving, a way to keep the account without the part you don't want, a list of exactly what you'd lose, a one-time promotion if the account qualifies, then \"Type DELETE\" and your password. It's a soft delete: for 30 days you can sign back in and press \"Reopen my account\" with everything intact. After that it's purged permanently and cannot be restored.",
    detail:
      "The steps are numbered (\"Step 3 of 6\") and nothing traps you — every screen has a button that carries on to deletion; declining the promotion is \"No thanks, continue to delete\". The order is: why you're leaving, a follow-up question, the no-cost option (Free: switch off every SwiftCard email and keep the card, link and contacts; Pro: cancel Pro and keep the account), \"Here's what goes\", then the promotion — always the last screen before \"Type DELETE\", and skipped entirely when the account doesn't qualify (so some people see 5 steps, not 6). Each promotion is once per PERSON, ever — a deleted and re-created account, the same email or the same card never gets it twice. A free account that is at least two weeks old is offered \"Try Pro free for 30 days — on us\" with no card (a brand-new account is not): it switches on straight away and ends by itself on the date shown, then the account is back on Free with nothing lost — or 16 days if it has already had a Pro trial, so the free time adds up to 30 either way. Taking it counts as the account's free Pro period, so there is no {trial.days}-day trial afterwards; someone who subscribes while the free days are still running is not charged until the day they end (checkout says \"Your free Pro carries on — nothing is charged today\" with that date). Someone already on free Pro with no subscription isn't offered it again — the flow just tells them their free Pro ends on its own and nothing is charged. A Pro subscriber on a monthly web subscription is offered 50% off the next 3 months, applied straight to the subscription; it isn't offered during a trial, on an annual plan, on a subscription that already has a discount, or to anyone who has had it before (the same offer in the Billing cancel flow counts). Someone on the {trial.days}-day Pro trial with a card (started on the web) is offered instead \"Keep your free trial going until …\": the trial runs on free until 30 days after it started (16 extra days for a standard trial, whichever day they ask), the first charge moves to that date, and \"Keep my trial until …\" applies it at once. It is once per person and is the same free month as the Free plan's gift, so nobody gets both; it isn't offered when the trial is already cancelled, on Office, or for a trial started in the iPhone app. On a trial the no-cost option reads \"Cancel your trial instead of deleting\" (\"Cancel my trial, keep my account\") — nothing is charged and Pro stays on until the trial's end date. Cancelling Pro instead keeps the account with nothing deleted — Pro stays on until the end of the period already paid for, then the account moves to Free (they choose which card stays live), and \"Keep Subscription\" in Settings → Plan and billing undoes it until then. Office accounts and team members get no promotion (team members can't delete their own account at all — their Office admin removes them). Someone who subscribed in the app is told to turn off auto-renew in their Apple subscription settings — deleting here does not stop an Apple renewal. The \"what you lose\" screen counts their real contacts and card views and names the exact link that stops working; Pro accounts get a button to download their contacts first. Answers are saved even if the person stays. There is no \"Danger Zone\" and no section called \"Account\" — those names are gone. Deleting cancels any active subscription, and an office owner gets an extra warning because it ends the team's subscription for everyone — straight away: every team member is moved off Office and told so, and the admin console closes. Office accounts don't see the \"Refer a friend\" box (its free months are a Pro reward), so on Office that Settings section is called just \"Help\".",
    commerce: true,
    nativeAnswer:
      "Settings → Advanced account settings → \"Account ownership and deletion\" → \"Delete account\". It's a short numbered sequence: two questions about why you're leaving, a way to keep the account quietly, a list of what you'd lose, then \"Type DELETE\" and your password. A free account that's at least two weeks old is also offered free Pro time just before the last step, once per person — it switches on straight away, needs no card and ends by itself. A Pro trial that qualifies is offered instead to keep the trial going free until a month from the day it started, also once per person. Nothing traps you — every screen has a button that carries on. For 30 days you can sign back in and press \"Reopen my account\" with everything intact; after that it is permanent and cannot be restored. If you subscribed in the app, deleting here does not stop the renewal — turn off auto-renew in your Apple subscription settings.",
  },
  {
    id: "referrals",
    title: "Referring friends and earning free months",
    audience: ["user"],
    triggers: [
      "refer", "referral", "refer a friend", "invite a friend", "referral link",
      "free month", "earn free", "promo code", "discount code",
    ],
    answer:
      "Settings → Help and referrals has your \"Refer a friend\" box. Invite 3 friends who sign up and you get a month of Pro free, up to 3 months — and your friends get a free month too. There's more at /grow. The same section shows a \"Get the iPhone app\" row with an App Store download link, and a \"Rate SwiftCard\" row whose \"Rate us on the App Store\" button opens the App Store review screen (both on the web only — inside the app you already have it, and Rate us lives on /grow). On a computer the review link opens the App Store web page, so it works best from an iPhone, iPad or Mac.",
    detail:
      "Rewards never switch themselves on: when one is earned you have to press Claim. A friend who signs up through your link sees their free month on the \"Choose your plan\" screen right after creating their account (or, if they signed up before building a card, on the card builder's own plan step), as \"Start my free month of Pro →\". While it is on offer the Pro plan shows no separate {trial.days}-day trial — the friend's month is their one free Pro period. It does not start by itself: they can press it, pick Pro or Office, or continue with Free (which gives up the free month). Only a real referral link earns the month — the other \"create a free account\" prompts scattered around the product (the badge on a card, a follow-up email) are not referral links. Each free month lasts {limit.freeMonthDays} days. If your Pro is billed through the App Store, Claim says so and uses nothing up — Apple subscriptions can't take a free-month credit, so your earned months stay saved.",
    commerce: true,
    nativeAnswer:
      "Settings → Help and referrals has your \"Refer a friend\" box. Invite 3 friends who sign up and you earn a month of Pro free, up to 3 months; your friends get a free month too. Rewards are not automatic — press Claim when one is earned. A friend who signs up through your link starts their free month from the plan screen with \"Start my free month of Pro →\".",
  },
  {
    id: "plan-limits-explained",
    title: "What happens when you hit a Free limit",
    audience: ["user"],
    triggers: [
      "limit", "limits", "cap", "locked leads", "locked", "hit my limit", "blurred",
      "why cant i", "why can't i add", "maxed out", "free plan limits",
    ],
    answer:
      "Free includes {limit.cards} card, {limit.leads} new contacts a month, and {limit.links} extra Swift Links buttons. The monthly counters reset on the 1st and count per account, so deleting a card doesn't reset them. Contacts captured past the cap are still captured — they're just hidden until the account is on a paid plan.",
    detail:
      "That last point matters and people get it wrong: nothing is thrown away at the cap. Over-cap contacts appear blurred with a \"locked\" note and unlock the moment the account becomes paid. The same is true after a downgrade — extra Swift Links buttons and Pro colours stay stored and hidden rather than deleted. The AI business-card scanner has no free allowance at all; it is Pro-only from the first scan. AI-written follow-ups are the same: Pro-only, with no free monthly allowance.",
  },
]);
