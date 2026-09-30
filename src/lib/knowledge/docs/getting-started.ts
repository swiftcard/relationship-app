import { defineDocs } from "../types";

// Signing in, signing up, and the first few minutes of an account.

export const gettingStartedDocs = defineDocs([
  {
    id: "signing-in",
    title: "Signing in",
    audience: ["user"],
    triggers: [
      "sign in", "log in", "login", "cant log in", "can't log in", "cant sign in",
      "locked out", "google sign in", "apple sign in", "magic link", "login link",
    ],
    answer:
      "/login has two tabs, \"Sign in\" and \"Get Started\" (which opens the card builder: you build the card first and create the account when you save it), plus Google and Apple buttons. If a password isn't working, use \"Forgot password?\" on the Sign in tab — type your email in the box first, then tap the link.",
    detail:
      "Some traps worth knowing. There is no passwordless \"email me a login link\" on the normal login page — that exists only for team invitations, so if someone asks for a login link, the honest answer is that everyone else signs in with a password or with Google/Apple. Tapping Google or Apple while the \"Sign in\" tab is selected, with no account on that address, bounces back with \"You don't have an account yet\" and switches to Create account — it does not silently create one. And the sign-in error message is deliberately vague about whether an email exists at all, so \"it says wrong password\" doesn't prove the account exists.",
  },
  {
    id: "creating-an-account",
    title: "Creating an account",
    audience: ["user"],
    triggers: [
      "create an account", "new account", "sign up", "register", "password requirements",
      "make an account", "confirm password", "password strength", "did you mean", "already exists",
      "passwords don't match",
    ],
    answer:
      "Either build a card first at /cards/new and create the account when you save it, or tap \"Get Started\" on the sign-in screen, which opens the same builder. Passwords need at least 8 characters and can't be your email address or a very common password — a meter under the box shows Weak, OK or Strong as you type, and you type the password twice (\"Confirm password\"). There are no other rules. If you mistype a common email domain, the form asks \"Did you mean you@gmail.com?\" before creating the account — tap the address to use it, or \"Keep what I typed\" — because there is no confirmation email to catch it. Google and Apple sign-up work from the same screen, on the website and in the app — so an account made in the app with Apple can sign in on swiftcard.me with the same \"Continue with Apple\" button.",
    detail:
      "If the address already has an account, the form says \"An account with this email already exists.\" with a \"Sign in instead →\" button that switches to the Sign in tab and keeps the email typed. \"Passwords don't match.\" appears under the Confirm password box and means the two boxes differ — retype the second one. A password that is too short, too common, or contains the email address is refused under the Password box before anything is sent. New accounts start on Free — there is no automatic trial for signing up. After the first card is saved there is a plan step, shown once: \"Continue with Free →\", or Pro, which starts a {trial.days}-day free trial with a card taken at checkout (billing starts when the trial ends unless it is cancelled). Someone who closes that step without choosing is shown it again the next time they open the dashboard. If the card was designed with Pro choices (a Pro finish, a photo or video background, a Pro Swift Links look, and so on) and Free is picked, a \"Before you go Free\" panel lists exactly what changes on Free and offers two ways on — \"Keep my card exactly like this\" (the Pro trial) or \"Continue with Free and redesign using free features only\". There is no Back button on that panel. Continuing with Free makes the card live with its design switched to the closest free options; only the Pro design choices change. The logo, the headshot, everything typed, the link and the QR code are all Free and are kept (a custom-designer layout becomes the Classic Pro template), and the card can be redesigned with free features any time under Edit card. A new account has zero cards and shows \"Let's create your first card\".",
    commerce: true,
    nativeAnswer:
      "Either build a card first and create the account when you save it, or tap \"Get Started\" on the sign-in screen, which opens the same builder. Passwords need at least 8 characters, typed twice, and can't be your email address or a very common password; a Weak/OK/Strong meter shows as you type. If you mistype a common email domain the form asks \"Did you mean …?\" first. Google and Apple sign-up work from the same screen.",
  },
  {
    id: "guest-draft",
    title: "Building a card before you have an account",
    audience: ["visitor", "user"],
    triggers: [
      "without an account", "guest", "draft", "lost my card", "lost my work",
      "card disappeared", "didnt save", "didn't save", "my work is ready",
      "unfinished card", "continue your card", "start a new card", "start over", "old card came back",
    ],
    answer:
      "You can build a whole card at swiftcard.me/cards/new with no account — the draft lives in your browser until you press \"Save & create account\" on the last step, where a \"Save your card\" prompt asks you to create an account or log in and the card is saved to it. The card is not live yet at that point: you choose a plan next (Pro, Office or Free), and choosing is what puts it live and sends the \"Your SwiftCard is live\" email.",
    detail:
      "Leaving the builder does not delete the draft — not the Home link, not the homepage. The next time you open the builder from any button (\"Get started free\", \"Start for free\", \"Create your free card\" and the rest), a screen headed \"You have an unfinished card\" asks: \"Continue your card\" picks up at the step you stopped on, \"Start a new card\" deletes the draft and opens a blank card at step 1. Reloading the builder or pressing the browser's Back button resumes without asking. Two ways a draft is really lost, both worth checking before assuming a fault. It is browser-local, so it doesn't follow you to another device or survive clearing site data, and choosing \"Start a new card\" deletes it for good. And the save has to happen within an hour of the account prompt: sign in much later and you land on the dashboard without the card. The prompt appears even if you're already signed in, on purpose, so a card is never quietly saved into whichever account happened to be open.",
  },
  {
    id: "first-card-and-welcome",
    title: "What happens right after your first card",
    audience: ["user"],
    triggers: ["welcome", "first card", "just signed up", "card is live", "what now", "next steps"],
    answer:
      "You land on a \"Your account is ready\" screen (/welcome) with your card URL. Your card is not live yet: choose a plan there (Pro, Office or Free — or, if you already picked Pro or Office on the pricing page, \"Complete your subscription\"). Choosing is what puts the card live and sends the \"Your SwiftCard is live\" email. Then a \"Your card is live!\" step shows your link with a Copy button, a blue \"Show QR\" button (a full-size QR code for the person in front of you to scan) and \"Share link\" (your phone's share sheet), then offers to turn on notifications (and, on the website, a \"Get SwiftCard on iPhone\" box), with a \"Go to my dashboard →\" button — Office too: a new Office owner lands on their own dashboard first, and the team console is the purple Admin link there. After paying on Stripe you come back to that same step; a \"Setting up your plan…\" screen can show for a few seconds first. If you leave Stripe without paying, you come back with the same plan, billing and team size still picked — to \"Complete your Office subscription\" on /welcome, or to the order summary on /checkout — ready to try again. After that the dashboard opens with a short guided tour. Creating a further card later ends on the same screen inside the builder, with the same notifications switch and app download.",
    detail:
      "If the card was designed with Pro-only colours but Free was chosen, a note explains the content is saved and the design falls back to a Free-safe version; nothing is lost. The plan screen looks the same on the website and in the iPhone app, and the same as the pricing page: a Monthly / Annual switch at the top, and on a phone three tabs — Free, Pro, Office — that open on Pro, so tap Free or Office to see those plans (on a computer or iPad all three sit side by side and there are no tabs). The switch is hidden while the Free tab is open because it changes nothing there. In the app, Pro's button opens Apple's purchase sheet already set to the period the switch shows. Office is for teams and is set up on the website, not inside the app: its button, \"Get Office on swiftcard.me\", opens swiftcard.me in your phone's browser — sign in there with the same account and the plan step opens on Office, where you pick your team size. Your card is already saved, and when you switch back to the app it picks up the new plan by itself. The app asks for permission to use AI features only later, on the dashboard once the card is live — never during these steps.",
  },
  {
    id: "team-invite",
    title: "Joining a team you were invited to",
    audience: ["user"],
    triggers: [
      "invite", "invited", "join a team", "invitation", "invite link", "join link",
      "accept invite", "my company invited me", "expired invite",
    ],
    answer:
      "Open the invitation link you were emailed (it looks like swiftcard.me/join/…) and create your account with the invited address — \"Continue with Google\", or \"Email me a link to create my account\", which is the one place SwiftCard does passwordless sign-in. There's no separate log-in button: the invite is for that one address. If it already has a SwiftCard account, the page tells you and signs you in with it instead (\"Email me a sign-in link\"). In the SwiftCard app the page has one button, \"Create my account\" (or \"Sign in to accept\"), and the form after it has your invited email filled in and locked. Then press \"Accept invitation →\". Your card comes pre-branded with the company look, you fill in your own details, and your team covers the plan — you're never asked to choose a plan or pay. When the card is live, \"Go to my dashboard →\" opens a short guided tour.",
    detail:
      "Invitations expire after 14 days; an admin can resend from the Team tab of the admin console. You must sign in as the address that was invited — a different account won't accept it. If the browser is already signed in to another account, the invite page says \"This invite is for a different email\" and its button, \"Continue as <invited address>\", signs you out and back to the invite. The emailed link comes from SwiftCard with the company's name on it (\"Your sign-in link to join <Company> on SwiftCard\") and its link works once, on any device or browser; if it has expired or was already used, you land back on the invite with a note and can send a new one. There is no special short team form any more: team members go through the same four-step card builder as everyone else, with the company-managed fields shown as \"Managed by your organization\" — company name, logo, website, office phone, fax and address, plus the bio, Instagram and pinned links when the company sets them, and the design when the company locks it. If you'd already built a card before accepting, that card becomes your company card and opens to finish; saving it takes you to the tour.",
  },
  {
    id: "which-pages-need-an-account",
    title: "Pages that need you to be signed in",
    audience: ["visitor", "user"],
    triggers: ["do i need to log in", "requires login", "signed out", "why am i on the login page"],
    answer:
      "The dashboard, contacts, settings, the Links page and the admin console all need an account. The card builder at swiftcard.me/cards/new is deliberately open, and so are the marketing pages, the templates gallery and the live demo.",
    detail:
      "swiftcard.me/share and swiftcard.me/grow are commonly mistaken for public marketing pages; they aren't, and a signed-out visitor opening them lands on the login screen.",
  },
]);
