import { defineDocs } from "../types";

// The dashboard, its numbers, and its notifications.

export const dashboardDocs = defineDocs([
  {
    id: "dashboard-overview",
    title: "The dashboard",
    audience: ["user"],
    triggers: [
      "dashboard", "home screen", "main screen", "select a card", "pick a card",
      "dashboard is empty", "nothing on my dashboard", "blank dashboard",
    ],
    answer:
      "The dashboard at /dashboard is scoped to one card at a time. If you have more than one card you'll first see a \"Select a card\" screen — pick one and the rest of the page fills in. Top to bottom: \"My Cards\", the \"Traffic\" box, and \"Quick Contacts\" (which toggles between Notifications and Contacts).",
    detail:
      "A blank-looking dashboard on a multi-card account is almost always the \"Select a card\" screen rather than a fault. With exactly one card it opens straight into it. \"My Cards\" has \"View live\" (\"View Live Link\" on a phone) and \"Add card\" buttons, and every card in the list has its own \"Edit\" button (a pencil, on the right of the card's row) that opens that card's editor — this is the only place to edit a card; Settings → Cards and sharing no longer has one. On a phone only the selected card shows, with a chevron to reveal the others. There's also a \"Your Card\" panel showing a live render of the card (\"Exactly what people get when you share.\") with the Share controls beneath it; on a phone, tapping the card opens it full screen and sideways so someone can scan the QR code on it (the × closes it); the reminder \"Tap your card to show it full screen\" sits on the right of the \"Your Card\" heading, above the card. On a phone the views box has no \"Traffic\" heading — its Today / Week / Month / Locations bar runs across the top of the box. On a phone the dashboard is the tab labelled \"Home\", not \"Dashboard\" — the bottom bar reads Home, Contacts, Links, Settings, plus a purple Admin tab for office admins. The sun/moon button in the top bar switches theme; the app opens in light mode unless dark was chosen.",
  },
  {
    id: "analytics",
    title: "Views and analytics",
    audience: ["user"],
    triggers: [
      "analytics", "views", "card views", "link views", "stats", "who viewed",
      "how many views", "traffic", "unique visitors", "best day", "insights",
    ],
    answer:
      "The \"Traffic\" box on the dashboard. Two tiles — \"SwiftCard views\" and \"Swift Link views\" — plus a bar chart, a \"Unique viewers / Repeat views\" line, and a footer with your contact count, \"Link taps\" (how many times visitors pressed your Swift Links buttons, card links or social icons in the window — it only appears once there has been at least one), and your best day. The Today / Week / Month control above them sets the window; the \"Locations\" tab is Pro.",
    detail:
      "Details that come up: the tiles count VIEWS, not people — \"Unique viewers\" is the people number, and someone on two devices counts twice. \"Best day\" always looks at the last 30 days and ignores the Today/Week/Month choice, so it can name a date outside the window you're looking at. \"Today\" starts at your own local midnight. Top locations are all-time and approximate: they come from the viewer's internet connection, not their phone's GPS, so they name where the network is registered — often the right town, sometimes a nearby one, and on a mobile carrier it can be a hub hours away. SwiftCard checks two independent IP databases and labels each place with how sure it is: both databases naming the same town shows it plainly (\"Austin, TX\"), one database alone shows \"Near Austin, TX\", the two disagreeing shows the state (\"New York (approximate)\") rather than a wrong town, and a connection that only gives a country shows \"United States (approximate)\". Places recorded before that labelling existed still show as they always did. Visitor IPs are never stored. There is no percentage-change indicator and no conversion-rate figure on the personal dashboard, and no all-cards combined view — analytics are per card.",
  },
  {
    id: "what-counts-as-a-view",
    title: "What counts as a view",
    audience: ["user"],
    triggers: [
      "counts as a view", "why did my views", "views wrong", "view count", "refresh count",
      "do my own views count", "repeat view", "visit window",
    ],
    answer:
      "One visit is one view. The same person touching the same page again within 30 minutes doesn't add another — reloads and back-navigation are the same visit. After 30 minutes, the same person coming back genuinely is a repeat view and counts again. A repeat is the same person back on the same page: opening your card and your Swift Links in one visit is one viewer and two views, not a repeat. Your own views of your own card never count.",
    detail:
      "Older answers that said \"one view per person per day\" are wrong — the window is 30 minutes, not 24 hours. Bot traffic is filtered out, and seeded demo views are excluded from milestone counts. Your own views are recognised three ways: by being signed in, by the browser you signed in on — so opening your own card from the same browser doesn't count even if the session has since lapsed — and by your own \"open my card\" buttons. \"View live\" on the dashboard (and \"See how it looks to them ↗\"), \"Open Swift Links →\" on the Share page, the card preview in Swift Signature, and \"View live card ↗\" on your own row of the Office team list all mark whichever browser they open in as yours — including Safari when you tap them in the iPhone app — so that visit, and anything you open on that browser later, is never a SwiftCard or Swift Links view. SwiftCard links, Swift Links pages, Swift Signature links, QR codes and NFC taps always open in the phone's browser (Safari on an iPhone), never inside the SwiftCard app, even when the app is installed and signed in, so someone's card or Swift Links page you open is a normal web page you can close or leave like any other. Your own opens there still don't count once that browser is recognised as yours: tap \"View live\" in the app once, or sign in on that browser once. Opening your card from a browser you have never signed in on (another phone, or the browser built into Instagram or LinkedIn) cannot be told apart from a stranger and will count; sign in on that browser once and it is recognised from then on. Automated traffic from a cloud or datacenter connection — link scanners and preview crawlers that arrive with an ordinary-looking browser — doesn't count either; iCloud Private Relay and VPN visitors are real people and still do.",
  },
  {
    id: "notifications",
    title: "Notifications",
    audience: ["user"],
    triggers: [
      "notification", "notifications", "alerts", "bell", "dismiss", "clear read",
      "mark read", "mark as read", "unread", "badge", "blue dot",
    ],
    answer:
      "Two places. The bell in the top bar shows every card's notifications, with a red unread badge (capped at \"9+\") and \"Mark all read\" / \"Clear read\". The dashboard's \"Quick Contacts\" section has a \"Notifications\" toggle showing the selected card's activity. Each row has a Read/Unread toggle and an ✕ to dismiss. Tapping a row about a contact (a new contact, a reply, a view or download, a returning contact) opens Contacts — straight to that person when the notification names them — in the bell and in the dashboard list alike.",
    detail:
      "Opening the bell does not mark anything read — the badge only drops when you tap Read, Mark all read, or dismiss. Both the bell and the dashboard list check for new items on their own (and whenever the app comes back to the front), including a notification whose wording changed — so after upgrading to Pro, the places and names that were blurred show in full without a reload. Both show the 20 most recent. On Pro and Office, a phone notification keeps the place a view came from even when the sentence is long — the words before it are shortened instead. \"Clear read\" removes read ones permanently. You'll get notifications for new contacts, card views, contact-card downloads, and view milestones (5, 10, 25, 50, 100 and up, counted per card). A milestone row ends with one suggestion of something to do next \u2014 where to put your card so it keeps working, or which number in the dashboard is worth a look. A download notification reads \"downloaded your contact card\", not \"saved\": the Add-to-Contacts screen belongs to the phone's operating system, so SwiftCard can tell you it handed the card over but never whether they then tapped Add. \"Someone viewed your card\" simply means that viewer has never shared their details through SwiftCard — it isn't a fault or a privacy setting. One person gets you ONE notification per visit: if they view your card and then save your contact or share their info back, the same notification updates to say the latest thing they did instead of arriving again. A view that crosses a milestone updates that same notification too — you get one row reading \"50 views — on fire!\" that still names who just viewed, not a separate milestone alert alongside it. A return visit more than 30 minutes later counts as new and notifies again.",
  },
  {
    id: "event-tag",
    title: "Tagging the contacts you meet at an event",
    audience: ["user"],
    triggers: [
      "at an event", "event tag", "tag today's contacts", "where we met", "met at",
      "conference", "open house", "trade show",
    ],
    answer:
      "On the dashboard, under the Share button, tap \"At an event? Tag today's contacts\", type where you are (for example \"RE/MAX Summit\") and press Save. Every contact you gain for the rest of the day is saved with that as \"Where you met\". Tap \"Stop\" to end it early. If you tap it by accident, the × beside the box (or the Escape key) closes it and nothing is saved.",
    detail:
      "It covers every way a contact arrives while it is on: someone sharing their details through your card — however they reached it, including a QR code, a tap of your NFC card, your Apple Wallet pass or a link you sent — plus contacts you add by hand and business cards you scan. If you type something in \"Where you met\" yourself, what you typed is kept; the tag only fills it in when it is blank. The tag ends by itself at midnight on your phone or computer, and never lasts more than a day, so it can't stamp next week's contacts by accident. It labels everyone who arrives that day, wherever they actually are, so if you leave the event early tap \"Stop\" — and you can change \"Where you met\" on any contact afterwards. Nobody else ever sees the tag: it is your own note, it never appears on your card, and it is not in the contact card people download from you. When one of those contacts comes back to your card later, the alert says where you met them (\"Priya (met at RE/MAX Summit) re-opened your card\"). Without a tag it says the day you met instead.",
  },
  {
    id: "guided-tour",
    title: "The guided tour",
    audience: ["user"],
    triggers: ["tour", "walkthrough", "guided tour", "show me around", "replay tour", "take a tour"],
    answer:
      "Right after you create your first card, the dashboard shows a \"Take a quick tour\" banner (it doesn't appear on later sign-ins). To replay it later, go to Settings → Help and referrals → \"Take a Tour\". It spotlights each part of the app across the dashboard, Links, Contacts and Settings, with Back / Next and a Skip option. Its second step, right after the welcome, points at the round blue chat bubble in the bottom-right corner (on the Dashboard, Contacts and Links pages): tap it and ask the assistant anything about using SwiftCard, so anyone who skips the rest of the tour still knows where help is. The last step points back to it.",
    detail:
      "Whether the tour has been taken is remembered per browser, so it can reappear on a new device and won't come back on the same one after a Skip. If a step seems to hang for a couple of seconds it's waiting for an element it can't find, and it will skip that step by itself. The Office admin console has its own separate \"Tour\" button.",
  },
  {
    id: "help-us-grow",
    title: "The \"Help us grow\" page",
    audience: ["user"],
    triggers: ["help us grow", "grow", "heart icon", "rate us", "spread the word", "share swiftcard"],
    answer:
      "The heart icon in the top bar opens /grow — \"Help us grow\". It has Rate us, Invite friends & earn (your referral box), Spread the word, and a few other ways to help, like adding your Swift Signature to your email.",
    detail:
      "People describe this as \"the heart\" because the icon has no text label. The referral box is here and in Settings → Help and referrals — it is NOT on the dashboard, which is a common wrong answer. Office accounts have no referral rewards: team members don't have this page or its heart icon at all, and an Office owner's page has no \"Invite friends & earn\" section. \"Rate us\" is one button: in the iPhone app it opens the App Store's write-a-review page, on the web it opens the App Store listing — there are no stars to tap on the page itself and no feedback form behind it. On the web dashboard a small \"Rate us on the App Store\" banner can also appear at the top once a card has had a real contact or 5+ views; Dismiss (or tapping the button) hides it for 60 days on every device, and Settings → Help and referrals keeps a permanent \"Rate SwiftCard\" row. Separately, the iPhone app may show Apple's own \"Enjoying SwiftCard?\" rating popup at most once every 90 days, and only after something has gone well (a new contact, or sharing your card a few times); Apple decides whether it actually appears and caps it at three times a year.",
  },
]);
