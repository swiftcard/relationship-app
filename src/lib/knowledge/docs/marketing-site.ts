import { PLAY_STORE_URL } from "@/lib/app-store";
import { defineDocs } from "../types";

// The public site: what a visitor can reach without an account, and the honest
// answers to the questions visitors actually ask before signing up.

// The Android answer flips with the same switch that lights the Google Play
// badges (NEXT_PUBLIC_PLAY_STORE_URL), so the assistant can never promise an
// app nobody can download, nor deny one that is live.
const ANDROID_ANSWER = PLAY_STORE_URL
  ? " The Android app is live on Google Play too (search \"SwiftCard: Business Card\"), and nobody needs an app to receive your card either way."
  : " There's no Android app yet — Android users just use the browser, and nobody needs an app to receive your card either way.";
const ANDROID_DETAIL = PLAY_STORE_URL
  ? ` The Android app is on Google Play at ${PLAY_STORE_URL}, published by Swift Card Inc.; the site shows a Get it on Google Play badge beside the App Store one.`
  : " If an Android user asks: no Play Store app and no date to promise — the browser is the answer there.";

export const marketingDocs = defineDocs([
  {
    id: "site-map",
    title: "What's on the website",
    audience: ["visitor"],
    triggers: ["what pages", "site map", "where do i find", "menu", "navigation", "more info"],
    answer:
      "The homepage hero (desktop) rotates six example professionals — realtor, electrician, insurance agent, banker, lawyer, car salesperson — each shown three ways at once: their SwiftCard in a phone in the center, their Swift Links page on the left, and their Swift Signature on the right. Further down, the homepage's Swift Cards section shows the six templates and an AI Card Designer block headed \"Or let AI design it.\" (Create with AI, and \"Copy any card, exactly\" — snap or screenshot the business card you already have, or one you found and want, and AI rebuilds that exact design with your details) with a \"Create your free card\" button. The site covers: pricing at swiftcard.me/pricing, a live demo at swiftcard.me/preview, the card designs at swiftcard.me/templates (it opens with the AI Card Designer — \"Create with AI\" from your headshot, logo, colors and a style, and \"Copy any card, exactly\" from a photo or screenshot of a card you have or want, then a \"Get Started\" button; below that, \"Or start from a template.\" shows the six templates side by side — tap one to select it, then \"Apply this design →\" in the bar at the bottom opens the card builder on it; the designer itself is a Pro feature used from Edit card → Card design → Custom design, and its AI design also opens in the card builder while you make your first card), use cases at swiftcard.me/testimonials, and product pages under swiftcard.me/products/ (digital cards, SwiftLinks, Swift Signature, lead capture, analytics, teams, ways to share, Apple Watch, integrations), plus industry pages under swiftcard.me/for/ (real estate agents, contractors, insurance agents, loan officers, lawyers, photographers, barbers & stylists, car salespeople) \u2014 each opens with that profession's own example SwiftCard shown three ways: the card page in a phone, the Swift Links page, and the Swift Signature. The footer carries Product, Solutions and \"Who it's for\" link columns, Preview, Templates, Why SwiftCard, Contact Us, and swiftcard.me/about (a short page: what SwiftCard is and who it is for, plus the company block — Swift Card Inc., New York, NY, hello@swiftcard.me), swiftcard.me/company, swiftcard.me/press, swiftcard.me/privacy, swiftcard.me/terms and swiftcard.me/sms-terms.",
    detail:
      "Nav layout: Home, a Products menu (Digital Cards, SwiftLinks, Swift Signature, Lead Capture), a Solutions menu (Dashboard & Analytics, Teams & Offices, Ways to share, Apple Watch, Integrations), a Resources menu (Preview, Templates, Why SwiftCard, Contact Us, Privacy), then Pricing, Log in, and Get started free. /testimonials is labelled \"Why SwiftCard\" in the menus. There is also a comparison page at swiftcard.me/compare that is not linked from the nav. Two standalone landing pages exist for search: swiftcard.me/business-card-view-tracking (how view tracking works) and swiftcard.me/link-in-bio-with-analytics (Swift Links as an analytics-first link-in-bio); each is reachable from the \"More comparisons\" chips on the /compare pages. The blog lives at swiftcard.me/blog with individual posts at swiftcard.me/blog/<slug> — guides and honest comparisons; posts appear as they are published. Note that swiftcard.me/share, swiftcard.me/grow and swiftcard.me/upgrade are NOT public marketing pages — they need an account and will send a signed-out visitor to the login screen.",
  },
  {
    id: "press-kit",
    title: "Press and media kit",
    audience: ["visitor"],
    triggers: [
      "press", "press kit", "media kit", "journalist", "reporter", "write about", "article about",
      "logo download", "brand assets", "screenshots", "founder", "who made swiftcard", "interview",
    ],
    answer:
      "swiftcard.me/press is the press and media kit: a quotable one-liner, fast facts (company, founding, launch dates, platforms, integrations), the founding story, a logo download, the current App Store screenshots, a boilerplate paragraph and a .zip with everything. Press contact is hello@swiftcard.me, and founder interviews, a founder photo and product demos are available on request. SwiftCard is operated by Swift Card Inc in New York and was started by a college student.",
    detail:
      "The page deliberately publishes no user counts, revenue or funding details — we only state what we can verify. Do not invent statistics for a journalist; point them at the page and the email address.",
  },

  {
    id: "try-before-signup",
    title: "Trying it without an account",
    audience: ["visitor"],
    triggers: [
      "try it", "demo", "see it", "test it", "without signing up", "before i sign up",
      "do i need an account", "live demo", "preview",
    ],
    answer:
      "Two ways, both free and account-free. swiftcard.me/preview is the real app loaded with sample data — click around the dashboard, contacts and links. And swiftcard.me/cards/new lets you build your actual card first; you only make an account at the end, when you save it.",
    detail:
      "Everything on /preview is demo data — the view counts and contacts there belong to nobody, and it cannot be logged into. In the builder, a card built as a guest lives in your browser as a draft and is not stored on our servers until you pick a plan and create the account. Going back to the homepage clears that draft. The homepage's \"See how your card looks\" builder (and the Swift Signature one) has the same design steps, including \"Custom design\" with \"AI design\" — \"Copy a card or template you like\" stays Pro — and whatever you make there carries into the card builder when you press \"Make it live →\".",
  },
  {
    id: "getting-started-visitor",
    title: "Getting started",
    audience: ["visitor"],
    triggers: ["get started", "sign up", "signup", "create a card", "start", "how do i begin", "make a card"],
    answer:
      "Go to swiftcard.me/cards/new and build your card — there's no login wall. Quickest start: on the homepage, type your name into the SwiftCard.me/\"full name\" box and press \"Start for free\" — the builder opens with your name already filled in. It's four steps: Card information, Card design, Socials, then Social design. At the end you create your account, then choose a plan, and your card goes live.",
    detail:
      "The steps in order: 1 \"New card\" (name, title, phones, email, website, address) → \"Next: Card design →\"; 2 Card design (logo, headshot, template, colours) → \"Next: Socials →\"; 3 Socials (bio, social profiles, extra link buttons) → \"Next: Social design →\"; 4 Social design (style the Swift Links page) → \"Continue to plans →\", which opens \"Choose your plan\". Picking Free (\"Continue with Free →\") creates the account and publishes the card. The Pro card's button beside it names the trial and its length (\"Try Pro free for … days →\", the number read from the plan config) — that button starts the trial, which takes a card and renews, so it is never described as simply free. The builder is unlocked while you design, so you can try the Pro-only looks (any colour, the material finishes, a background photo or video). That includes the \"Custom design\" row under the templates, for \"AI design\" — pick your colours, a theme and whether your headshot and logo go on it, and AI designs the card, which you then fine-tune by tapping anything on it. Its other half, \"Copy a card or template you like\", carries a small PRO tag and stays locked here; it opens only for an account on Pro or Office, from Edit card (the \"Card design\" tab) or \"+ Add card\" in the dashboard. If you used any of those looks and then pick Free, a screen headed \"Your card uses Pro design\" lists exactly what changes on Free and offers to keep the card as built on a Pro trial — \"Continue with Free\" keeps everything you typed and applies the closest free look.",
    commerce: true,
    nativeAnswer:
      "Build a card from the dashboard: \"+ Add card\" opens a four-step builder — Card information, Card design, Socials, then Social design.",
  },
  {
    id: "trial-and-refunds",
    title: "Free trial, cancelling, refunds",
    audience: ["visitor", "user"],
    triggers: [
      "free trial", "trial", "cancel", "refund", "lock in", "commitment", "contract",
      "money back", "cancel anytime", "auto renew",
    ],
    answer:
      "Subscribing to Pro starts with a {trial.days}-day free trial: a card is collected at checkout, and billing starts automatically when the trial ends unless you cancel first. No contracts — cancel anytime and you keep access to the end of the period you've paid for. Payments run through Stripe.",
    detail:
      "Two limits worth stating plainly rather than letting someone discover them: the trial is Pro ONLY (the Office plan has no trial), and it is for new customers only — someone who has subscribed before, or already had a Pro trial on any account, is charged immediately on the next subscription. The Free plan is free forever and needs no card at all. There's a \"Have a promo code?\" field on the pricing page; a code is checked before checkout, so an invalid one is rejected there rather than silently ignored. You don't need an account to enter one: apply it, press the plan's button, and the code stays with you through building your card and creating your account — it comes off at checkout. Already signed in and upgrading from inside the app? The order page (\"Review your order\") has the same \"Have a promo code?\" box just above \"Continue to secure payment\", and it takes every kind of code — free time, money off, and a code that switches a plan on. A brand-new account choosing Pro or Office right after creating its card has the box too: under the plan cards on the \"Choose your plan\" step, and on the \"Complete your Pro subscription\" panel when the plan was picked on the pricing page — so every checkout for Pro or Office has somewhere to enter a code before any payment. The iPhone app's plan step has the box as well: it checks the code, then \"Use it on swiftcard.me →\" opens the website in the phone's browser with the code filled in, because a code can't be applied to a purchase made through Apple. Stripe's own payment page has no code field, so a code can't be typed there. The one exception is a code that switches Pro on by itself with no payment: that kind needs an account, so create yours first and then enter it on the pricing page. A code can be made for one plan or one billing period — when it is, the box says so (for example \"Pro only, annual only\") and only that plan's button shows the discount; picking the other plan simply charges the normal price. Signed in, the pricing page shows YOUR account, not the new-customer offer: if the account has already had its free Pro period, the Pro card shows the plain price and \"Get Pro →\"; already on Pro, the Pro button reads \"Your current plan · Manage →\"; on Office, the Pro button reads \"Included in your Office plan · Manage →\" (Office includes everything in Pro, so there is no Pro to buy), and a paid Office's own button reads \"Your current plan · Manage seats →\" — each opens Settings → Plan and billing. On the order page, \"← Change plan, billing, or seats\" goes back to the pricing page (or to the in-app Upgrade page when that's where the plan was picked). The website remembers a sign-in on that browser until you sign out, so a shared or public computer should be signed out when you're done.",
    commerce: true,
    nativeAnswer:
      "The Free plan is free forever. Paid plans can be stopped at any time, and access continues to the end of the period already covered.",
  },
  {
    id: "reviews-and-trust",
    title: "Reviews, ratings, and whether it's legit",
    audience: ["visitor"],
    triggers: [
      "review", "reviews", "testimonial", "testimonials", "rating", "legit", "trust", "scam",
      "who uses", "how many users", "customers", "case study",
    ],
    answer:
      "swiftcard.me/testimonials (\"Why SwiftCard\" in the menus) has two parts. Most of it is what SwiftCard does for different professions — real estate, sales, recruiting, creators, consultants — written as use cases, not customer quotes. Below that is a \"What people say on the App Store\" section carrying real reviews pulled live from the iOS App Store, next to Apple's own average rating and total rating count. It also has a \"Used SwiftCard? Leave a review\" panel with a Write a review button that opens the App Store review form. We don't publish user counts or statistics we don't have. The best way to judge it is the free plan, which takes about a minute to set up at swiftcard.me/cards/new.",
    detail:
      "The review section is fed by Apple's public customer-reviews RSS feed at request time — nothing is written by hand, and the section renders nothing at all if the feed is empty or unreachable. Only reviews rated 4.5 stars and up are shown, which the page discloses in a line under them; the score beside the heading is Apple's own lifetime average across EVERY rating, never an average of the selection. This is deliberate and legally required (FTC 16 CFR Part 465 on fake reviews). Never invent a statistic, a customer count, a rating, an award, a testimonial, or a named customer, and never imply one exists. Reviews can only be left on the App Store, so someone without the iPhone app has no way to leave one; point them at the free plan or swiftcard.me/contact.",
  },
  {
    id: "ios-app-availability",
    title: "Is there an iOS/Android app?",
    audience: ["visitor", "user"],
    triggers: [
      "ios app", "iphone app", "android app", "app store", "google play", "download the app",
      "is there an app", "mobile app", "play store",
    ],
    answer:
      "Yes — the iPhone app is live on the App Store. There's a Download on the App Store button in the site footer on every page, with a \"Rate us on the App Store\" link beside it, and on a computer there's a download button in the header next to Log in. The short link swiftcard.me/review also goes straight to the App Store review screen (best opened on an iPhone, iPad or Mac; on other computers it opens the App Store web page). It's free to download, and everything also still works in the browser on any phone." + ANDROID_ANSWER,
    detail:
      "The listing is https://apps.apple.com/app/id6798875872, published by Swift Card Inc. Point people at a badge rather than reading the URL aloud: the site header carries one on a computer (just left of Log in — it isn't in the phone header, where there's no room), the footer has one on every page (that's the one to point a phone user at), and you're offered the app again on the \"Your card is live!\" screen right after you create a card. On a phone the homepage also shows one right beside \"See how it works\" (on a computer that spot has none — the header badge covers it). Signed in on the web, there's one more in Settings → \"Help and referrals\" (just \"Help\" on an Office account), in the \"Get the iPhone app\" row. Every one of these is the same dark button with white \"Download on the App Store\" lettering. The app needs iOS 15 or later." + ANDROID_DETAIL,
  },
  {
    id: "privacy-and-data",
    title: "Privacy, security, and your data",
    audience: ["visitor", "user"],
    triggers: [
      "privacy", "data", "secure", "security", "gdpr", "sell my data", "encrypted",
      "who can see", "delete my data", "ccpa",
    ],
    answer:
      "Your card shows only what you choose to make public, data is encrypted in transit and at rest, and SwiftCard does not sell your data or your contacts' data. The full policy is at swiftcard.me/privacy, and deleting your account is covered there too.",
    detail:
      "Card pages are public by design — anyone with the link can see what you put on the card. Contacts, analytics and account details are private to you (and, on an Office plan, to your office admins). Deleting an account keeps a one-month window in which logging back in reopens it; after that it is permanent.",
  },
  {
    id: "sms-consent-public",
    title: "Text messages and consent",
    audience: ["visitor", "user"],
    triggers: [
      "sms", "text messages", "texting", "opt in", "opt out", "stop texts", "consent",
      "tcpa", "unsubscribe from texts", "a2p",
    ],
    answer:
      "Sharing your details on a card is not signing up for texts, and there is no consent box on that form: it sends your name, phone and email to the person whose card it is, nothing more. A text is only ever sent when that SwiftCard user sets up a follow-up for you personally and confirms to us that you gave them permission — no automated text goes to anyone else. Replying STOP to any message opts that number out; START opts back in. The details are at swiftcard.me/sms-consent and swiftcard.me/sms-terms.",
    detail:
      "There is no SMS consent checkbox anywhere any more (removed 2026-09-20) — never describe one, and never suggest a way to text someone who did not give the SwiftCard user permission. Permission is confirmed by the user, in Contacts, when they switch a text automation on for that contact; that confirmation is the only thing that allows a text, and switching it off withdraws it. All SwiftCard texts come from one shared number, so a STOP from a recipient stops SwiftCard texts to that number from every sender on the platform, not just the one they were talking to.",
  },
  {
    id: "contact-support",
    title: "Reaching a human",
    audience: ["visitor", "user", "office-admin"],
    triggers: [
      "contact", "contact support", "email you", "talk to someone", "talk to a human",
      "support", "contact you", "get help from a person", "phone number", "call you",
    ],
    answer:
      "Use the contact form at swiftcard.me/contact — pick what it's about, and a real person replies by email, usually within one business day. There's no support phone line.",
    detail:
      "The form asks for your name, email, a topic (General question, Help with my account, Teams & Offices, and so on) and your message. It replies to the email address entered, so a typo there means a lost reply. The team is in New York and answers on weekdays, US Eastern.",
  },
  {
    id: "teams-and-offices-visitor",
    title: "Teams and offices",
    audience: ["visitor"],
    triggers: [
      "team", "teams", "office", "company", "employees", "org", "business account",
      "multiple people", "my staff", "enterprise",
    ],
    answer:
      "The Office plan puts a whole team on matching, brand-synced cards: an admin sets the company logo, contact details and design once and it applies to everyone's card, invites new people with a passwordless link, and sees per-person analytics and every teammate's leads in one place. It's priced per seat with a minimum of {limit.seats} seats — see swiftcard.me/pricing.",
    detail:
      "Each seat includes everything in Pro. Leads stay with the office when someone leaves, and removing a person frees their seat and strips the company branding from the card they keep. There's a Teams page at swiftcard.me/products/teams with a \"Get Office for your team →\" button, and /pricing has \"Get Office\" with a team-size picker. Both open the card builder with Office already chosen: build your card, create the account, then \"Complete your Office subscription\" and pay. (swiftcard.me/office is the admin console for people who already have Office — not a sign-up page.)",
    commerce: true,
    nativeAnswer:
      "The Office plan puts a whole team on matching, brand-synced cards: an admin sets the company logo, contact details and design once and it applies to everyone's card, invites people with a passwordless link, and sees per-person analytics plus every teammate's leads in one place. It needs at least {limit.seats} seats, and each seat includes everything in Pro.",
  },
]);
