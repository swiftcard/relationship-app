import { defineDocs } from "../types";

// The Office admin console.
//
// The assistant this replaces sent admins looking for a "Resend invite" button
// in the person drawer and a role picker — neither of which exists. Every
// location below is the real one.
//
// (The Leads export was in that list until it was built; the Leads doc below
// now describes the real button. A role picker still does not exist: every
// member is an "employee", and nothing in the product can change that.)

export const officeDocs = defineDocs([
  {
    id: "admin-console",
    title: "Getting into the admin console",
    audience: ["user", "office-admin"],
    triggers: [
      "admin console", "admin", "office admin", "team console", "manage my team",
      "where is admin", "open admin",
    ],
    answer:
      "The purple \"Admin\" link in the dashboard top bar (or the Admin tab in the mobile bottom bar) opens /office/admin. Its tabs are Team, Analytics (/office/admin/analytics), Leads (/office/admin/leads) and Branding (/office/admin/branding), plus a \"Billing\" tab for the owner that opens Settings → Plan and billing (seats, payment method, invoices). Branding only appears for people allowed to change it. \"← My dashboard\" in the header takes you back to your own side.",
    detail:
      "The link only appears for people who can actually open the console — the office owner, or a teammate with a role that grants it. A brand-new Office subscriber lands on their own dashboard (with the guided tour), not in the console, which surprises people; the team is created for them at payment, named after the company on their card, and they get in via the Admin link. The console runs its own short tour the first time. Only if the team was not created yet does the console ask them to \"Name your team\" first. Old bookmarks to /office, /office/admin/team, /office/admin/cards and /office/admin/invite all now land on the Team tab, because Overview, Cards and Invite were folded into it.",
  },
  {
    id: "invite-teammate",
    title: "Inviting someone to the team",
    audience: ["office-admin", "user"],
    triggers: [
      "invite", "invite a member", "invite teammate", "invite employee", "add a member",
      "add member", "add teammate", "add employee", "add someone", "onboard", "send invite",
      "new hire",
    ],
    answer:
      "Team tab → the purple \"+ Add team member\" button at the top right. Enter their email (a name is optional) and press \"Send invite\". The invitation is for that one address: the invite page asks them to create their account with it (\"Continue with Google\" or \"Email me a link to create my account\", no password), and there is no separate log-in option. If that address already has a SwiftCard account, the page says so and signs them in with it instead. Their card arrives already branded with your company look. When their card goes live they can turn on notifications, and their dashboard then opens with the same short guided tour every new account gets. The invite email has one button, \"Create my card\", and also says they can get the SwiftCard iPhone app and create their account with the invited address instead. In the app that works with email and password, Google or Apple (with Apple, choose \"Share My Email\" so the invite can be matched): signing in with the invited address — even from the Sign-in tab, or after tapping \"Get Started\" and building a card first — goes straight to the Join step, never to a plan chooser. An invite link always opens in the phone's browser, even on an iPhone with the SwiftCard app installed (no swiftcard.me link opens inside the app); there the page emails them a link to create their account (\"Email me a link to create my account\", or \"Email me a sign-in link\" if the address already has one), and afterwards they can sign in to the app with the same email. If the invite page is reached inside the app it shows one button, \"Create my account\" (or \"Sign in to accept\" if the address already has an account), and the form after it has the invited email filled in and locked. If they already built a card before joining, that card becomes their company card and opens to finish, instead of a second card being created.",
    detail:
      "Invitations expire after 14 days and a pending one holds a seat until it's accepted, retracted, or expires. If you're out of seats, the dialog says so and offers to add one: on the web it shows the price for the new seat, the prorated amount charged today and the new monthly total, and \"Pay & add seat\" charges the card on file and sends the invite in one step. In the iPhone app it offers \"Add a seat on swiftcard.me\", which opens your browser to Settings \u2192 Plan and billing \u2014 seats are bought on the web, never inside the app. Either way you can also free a seat by removing a member or retracting a pending invite. The invite only works for the exact address it was sent to.",
  },
  {
    id: "resend-or-cancel-invite",
    title: "Chasing or cancelling an invitation",
    audience: ["office-admin"],
    triggers: [
      "resend", "resend invite", "resend an invite", "resend the invite", "invite again",
      "they didnt get", "didn't get the invite", "send invite again", "pending invite",
      "not finished", "hasnt finished", "remind", "remind them", "retract", "cancel invite",
      "revoke invite", "chase an invite",
    ],
    answer:
      "On the Team tab, pending invitations sit in the same roster as your members. The row has a \"Remind\" button that re-sends the email and restarts the 14-day clock, and \"Manage\" opens an inline confirmation to retract the invite and free the seat.",
    detail:
      "The button is labelled \"Remind\", not \"Resend invite\" — sending someone hunting for \"Resend invite\" is a wasted trip, and there is no resend control inside the person drawer either. Roster status chips you'll see: Active, Card not completed, Card deactivated, Not using it yet, Pending, and Invite expired. If they can't find the invite: it arrives from \"<your first name> via SwiftCard\" (support@swiftcard.me) with the subject \"<your first name> invited you to join <company> on SwiftCard\", so tell them to search for that, and to check Spam or Junk (or the Promotions tab in Gmail). If it's there, marking it \"Not spam\" helps the next one arrive. You can also send them the link yourself: press \"Manage\" on their row, then \"Copy link\", and text it to them. It's the same invite.",
  },
  {
    id: "manage-remove-member",
    title: "Managing or removing a teammate",
    audience: ["office-admin"],
    triggers: [
      "remove", "remove member", "remove teammate", "remove employee", "delete member",
      "delete their account", "delete member account", "delete employee account", "delete teammate account",
      "someone left", "offboard", "manage member", "edit member card", "edit their card",
      "take card offline", "deactivate card",
    ],
    answer:
      "The Team tab lists everyone A to Z by name, like a directory — never ranked by leads or views. Team tab → click a person or their \"Manage\" button to open their drawer: their stats, their card, \"View live card\", \"Copy card link\", \"Show QR code\", \"Manage their cards\", and \"Remove from team\". Removing them turns their company cards off and frees the seat — their leads stay with the office.",
    detail:
      "\"Manage\" also opens a fuller page for that person at /office/admin/team/<their id>, listing their cards (the drawer's \"Manage their cards\" button opens the same page), and \"View & edit card\" from there opens the card itself at /office/admin/cards/<card id> where it can be edited or taken offline. Taking a card offline (or removing the person) stops the public page, the QR code, NFC cards and the wallet pass from working. Nothing is deleted: their contacts and history remain, and the company branding is stripped from the card they walk away with. They move to their own plan (Free, or their own Pro if they pay for it), get a \"Your Office access ended\" notice saying they were removed, and can bring the card back online themselves in Settings → Cards and sharing. The seat stays paid for your next hire unless you take the \"Remove the seat and lower my bill\" option that follows. Taking a card offline (or back online) from the admin console also sends that person a notice. The office owner's own card can only be edited by the owner, so a delegated admin doesn't see \"Manage their cards\" or \"View & edit card\" on it. DELETING A TEAMMATE'S ACCOUNT: team members can't delete their own SwiftCard account — only the office OWNER can, with \"Delete account\" next to \"Remove from team\" (in the person's drawer and on their page), confirmed by typing DELETE. It removes them from the team exactly like Remove, then deletes their account: their cards, Swift Links page, contacts and history disappear at once and are permanently removed after 30 days, any subscription they pay for themselves is stopped, and they're emailed. Signing in within those 30 days offers to reopen the account. Delegated admins don't get this button.",
  },
  {
    id: "team-analytics",
    title: "Team analytics",
    audience: ["office-admin"],
    triggers: [
      "analytics", "stats", "performance", "views", "who is performing", "per person",
      "per employee", "team performance", "conversion", "scans", "unique visitors",
      "export analytics", "team report",
    ],
    answer:
      "The Analytics tab, with a 7 / 30 / 90-day range picker. Six tiles — Total views, Unique visitors, Card/QR scans, Leads captured, Contact downloads and SwiftLink views — then a views-over-time chart, traffic sources, and a sortable \"Your team\" table with a row per person. \"Export CSV\" there is the only export in the console.",
    detail:
      "Two things to read correctly: \"Total views\" already includes Swift Links views, so the SwiftLink tile is a breakdown of it rather than a number to add on. And \"Export CSV\" always exports the full date range, not just the rows left after you've typed in the search box. The \"Your team\" table opens in alphabetical order by name — it's a view of everyone's cards, not a ranking; click any column heading to sort by it instead. Clicking an employee's name opens their own analytics page at /office/admin/analytics/<their id>, with the same tiles for just that person, their views over time, traffic sources, their most-viewed card and their recent leads. Nothing compares one teammate with another. There is no conversion-rate figure anywhere: a card is there to make it easy for the people your team meets to save and reach them, and someone saving a contact (a client saving their lawyer's number, say) isn't a lead that failed to convert.",
  },
  {
    id: "team-leads",
    title: "The team's leads",
    audience: ["office-admin"],
    triggers: [
      "leads", "our leads", "team leads", "all leads", "see leads", "where are the leads",
      "who contacted", "lead status", "pipeline", "export leads", "download leads",
    ],
    answer:
      "The Leads tab lists everyone who shared their info with anyone on the team, with a search box, a team-member filter and a status filter. Each row has a Status dropdown — New, Contacted, Closed, Not interested — and this is the only place in the product where a lead's status can be set. Above the table it says how many are on screen out of the team's exact total, with an \"Export all as CSV\" button beside it, and a \"Load more\" button under the table brings in the next page.",
    detail:
      "\"Export all as CSV\" sits at the top right of the Leads tab and downloads EVERY lead the office owns — name, email, phone, who captured it, its follow-up and the date— not just the page on screen. It is separate from the Analytics tab's CSV, which exports per-person figures rather than the leads themselves. The search and the two filters only look at the leads currently loaded, so tell an admin to press \"Load more\" or use the export when they are hunting for something older. Leads stay with the office when the person who captured them leaves, and show as captured by \"Former team member\".",
  },
  {
    id: "company-branding",
    title: "Company branding — cards and Swift Links",
    audience: ["office-admin"],
    triggers: [
      "brand swift links", "brand the links page", "links branding", "swiftlinks design for team",
      "same links page", "team links page", "company instagram", "team bio", "company links",
      "company additional links", "section header", "group links", "lost my bio", "lost my instagram",
      "my instagram is greyed out", "cant edit my bio", "where did my bio go",
      "branding", "logo", "company logo", "company name", "brand", "our look", "company look",
      "set branding", "upload logo", "change logo", "company info", "office contact",
      "company address", "company phone", "design lock", "lock design", "uniform",
      "stop employees changing",
    ],
    answer:
      "The Branding tab. Section one is company information — logo (with a \"Logo shape on the card\" choice of Original or Circle once a logo is set), company name, website and office contact details, all identical on everyone's card. Section two is the card design every teammate shares, laid out exactly like a teammate's own \"Card design\" tab: the template gallery (including the \"Custom design\" row, open here, so the team look can be a custom design — a photo there copies a card's layout as editable blocks that fill with each teammate's own details, never a picture with one person's details on it), then the numbered steps (Look, background, Photo or video, second panel, name colour, accent, details colour, Font, Finish). On a phone the example card stays pinned at the top while you scroll, and tapping it shows it full size. Saving re-applies the look to every active teammate's card automatically. The Links tab works the same way for the Swift Links page, including a \"Link buttons\" step where each company link can be Featured, Grid or Compact (with its own photo or video) — teammates see company links exactly as you styled them and can't restyle, move or remove them, but they can add and style their own links underneath. Saving one tab never changes the other tab's settings.",
    detail:
      "The control people call the \"design lock\" is a checkbox reading \"Keep every card matching\", and it is ON by default — that name appears nowhere in the UI, so describe the checkbox. While it is on, a teammate opening their own \"Card design\" tab sees a \"Managed by your organization\" note instead of the controls. Unchecking it lets each teammate choose their own template, colours, finish and panel background, while the logo, company name and contact details stay company-controlled either way. Branding governs your TEAMMATES' cards; your own personal card stays yours and is not overwritten. A NEW OFFICE STARTS ALREADY BRANDED: the card the owner designed when signing up is copied into Branding once — logo, company name, website, the number they labelled \"Office\" (a \"Mobile\" number stays personal), fax, business address, the card's template and colours, and the Swift Links page design. Their bio, their own links, their name, title, photo, mobile and email are not copied, and neither is a header photo they uploaded for their own Swift Links page (teammates' headers show each person's own photo instead; a company header can be set on the Links tab). Until Branding is saved the first time, the page shows a \"We started this from your card\" note saying exactly that. After that one copy the Branding page is the only thing that changes the team look, so nothing needs re-entering unless they want it different. THE BRANDING PAGE HAS TWO TABS at the top, \"Card\" and \"Links\": everything above is the Card tab. The Links tab brands the Swift Links page (the link-in-bio page a QR code or an email signature opens) and mirrors it exactly — 1 Links information (a bio, the company Instagram, and company link buttons), 2 Links appearance (the same design controls teammates see under Social design, with a live preview), 3 What team members can edit, with a checkbox reading \"Keep every Swift Links page matching\" and a \"Save & apply to all Swift Links\" button. The two tabs save separately, so working on one never changes the other. What the Links tab takes is narrow and worth stating plainly: a bio you write, the Instagram you set, and the company link buttons you pin. For \"Company Instagram\" type just the username (for example yourcompany) — the instagram.com link is built for you, and the line under the box shows where it opens; a pasted profile link works too. Company links are ADDITIVE — they sit at the top of every teammate's page and cannot be edited or removed by them, but each teammate can still add their own links underneath, and every other social stays theirs to fill in. \"Keep every Swift Links page matching\" covers the DESIGN only, and it is OFF by default so an office that never opens this tab keeps the pages its teammates already built. The pinned links are called \"Company Additional Links\", and you can add a SECTION HEADER among them (\"+ Add a section header\") to group them under a title, exactly as a teammate can under their own links. IMPORTANT for the bio and Instagram: a Swift Links page has one bio and one Instagram button, so yours REPLACES theirs on the page — but theirs is never deleted. It is kept and comes back automatically if you clear the company value, and it comes back if they leave the team, at which point your bio, Instagram and pinned links come off their page too.",
  },
  {
    id: "team-notifications",
    title: "Team notifications and team alerts",
    audience: ["office-admin"],
    triggers: [
      "team notifications", "team alerts", "admin notifications", "admin bell", "notify me about my team",
      "team milestone", "leads waiting", "weekly recap", "team recap", "too many notifications", "spam",
      "no follow-up", "hasn't made a card", "which notification is the team", "admin push",
    ],
    answer:
      "The purple bell at the top of the Admin console is your team's inbox — separate from the bell on your own dashboard, which is only about your own card. It shows who joined or left, who declined an invitation or let one expire, team leads that still have no follow-up set up a day after they came in (one notice naming whose they are, like \"Mia (2) and Sam (1)\"), teammates who joined two days ago and still haven't made a card, a teammate's first-ever lead, team milestones (like 1,000 card views or 50 leads) and Monday's team recap. Tap a notice to open the page it's about: the Team tab, Leads (already filtered to \"No follow-up\" for the waiting-leads notice) or Analytics. The important ones also reach your phone as \"Team alerts\", at most two a day however big the team is, and every team push has a \"Team · <your company>\" line under its title — so on a lock screen, a push WITHOUT that line is about your own card.",
    detail:
      "The waiting-leads and no-card notices go out at most once a day each; anyone new is named in the next day's notice. You never get a push for each lead or view a teammate receives — those go to that teammate's own bell and phone, so a big team can't flood yours. Your own card still sends you your normal personal alerts. On Monday (from 9am your time) you get ONE recap push with the team's week (\"Team week: 42 views · 5 leads\" and how many teammates had no views — it never ranks teammates) instead of your personal recap. Turn either off in Settings → Notifications and preferences: \"Team alerts\" and \"Weekly recap\" each have their own switch, and quiet hours (10pm–8am) apply to both. The Team alerts switch only shows for the office owner and for teammates whose role can see team analytics (admin, manager, billing admin) — they are the people who receive them.",
  },
  {
    id: "office-roles",
    title: "Roles and permissions",
    audience: ["office-admin"],
    triggers: [
      "role", "roles", "make admin", "assign role", "permission", "permissions", "manager",
      "billing admin", "give access", "make someone admin", "promote",
    ],
    answer:
      "Roles exist behind the scenes — owner, admin, manager, billing admin and employee — but there is currently no screen anywhere in the console for assigning one. If you need a teammate promoted to admin, contact the team through the Contact page; it isn't something you can do yourself yet.",
    detail:
      "Say this plainly rather than describing a picker. There is no role dropdown in the person drawer, the team page, or settings. What the roles grant when set: admin can invite and remove members, manage branding, edit member cards and view analytics; manager can view analytics only; billing admin can handle billing and seats; employee manages only their own card. The owner has everything.",
  },
  {
    id: "office-employee-experience",
    title: "What a teammate sees",
    audience: ["office-admin", "user"],
    triggers: [
      "what can employees do", "employee view", "sub user", "team member access",
      "can they see", "employee permissions", "what do my staff see",
    ],
    answer:
      "A teammate gets their own dashboard, contacts, Swift Links and card editor — but not the admin console. The company-managed fields on their card (logo, company name, website, office contact details) show as \"Managed by your organization\" and can't be edited by them.",
    detail:
      "They also lose a few things a normal account has, because the office pays for them: no plan, billing or checkout (the one exception is a Pro subscription of their own from before they joined, which keeps charging until they stop it — Settings → Plan and billing then shows just that subscription: one paid on the website has a cancel button there, and one bought in the iPhone app can only be cancelled on the iPhone in Settings → Apple ID → Subscriptions, which the joining screen and a notification also tell them), no referral programme or \"Help us grow\" heart, no account deletion, and exactly one card — their company card, which is their seat — so there is no \"+ Add card\" and no card deletion (ask the Office admin). Their \"Your SwiftCard is live\" email leaves out connecting a CRM, since their contacts belong to the team: every contact they capture — shared on their card, added by hand or scanned from a business card — goes straight to the CRMs and Zapier webhook the office owner connected, with the member's name on it, and Settings → Notifications and preferences tells them so (\"Your team already sends leads to …\"). If they connect the same CRM themselves, their contacts go to their own copy instead of the team's. Their contacts stay private to them — the office sees lead counts and the combined Leads tab, not their personal contact notes. NOTIFICATIONS FOR A TEAMMATE: the same alerts about their own card as any paid account — views, saved contacts, new contacts, replies, returning contacts and the Monday recap — with the city a view came from shown in full, never blurred. Their bell also says \"You joined <company>\" when they join; \"Your company updated your card\" when the admin's Branding changes what their card shows, or \"Your company now sets your card's design\" / \"You can style your card yourself\" when the admin locks or unlocks the look (one current line, never a stack, and never to their phone); when the admin takes their card offline or back online; and \"Your Office access ended\" if they're removed or the team's plan ends, saying the company branding came off and where to manage their card. They never get referral, upgrade, trial or plan-ended notices, or the admin's team alerts.",
  },
  {
    id: "admin-tour-and-notifications",
    title: "The console's tour and notifications",
    audience: ["office-admin"],
    triggers: ["tour", "walkthrough", "replay tour", "team notifications", "admin bell", "notifications"],
    answer:
      "The purple \"Tour\" pill at the top of the Team tab replays a short walkthrough of the console's tabs — only the ones your role can open, so a manager's tour skips Branding. The bell in the console header is the team's own inbox (see \"Team notifications\"): who joined or left, invitations declined or expired, team leads with no follow-up a day on, teammates with no card yet, a teammate's first lead, team milestones and Monday's recap. Tap any of them to open the page it's about.",
    detail:
      "Individual leads and card views stay on each person's own bell — the team bell only carries the team-level events above, and the sample contact every new card starts with never counts as a team lead. This is the console's own tour, separate from the main product one.",
  },
]);
