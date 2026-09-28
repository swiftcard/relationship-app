import { defineDocs } from "../types";

// Building and editing a card.
//
// The old assistant had the wizard's steps 2 and 3 swapped, claimed the editor
// had two tabs when it has four, and named a "Design" tab that is actually
// called "Card design" — so its most-asked-for answer sent people to a tab
// that doesn't exist. Every label below is the one in the JSX.

export const cardDocs = defineDocs([
  {
    id: "create-a-card",
    title: "Creating a card",
    audience: ["user"],
    triggers: [
      "create a card", "make a card", "new card", "add card", "add a card", "create my card",
      "first card", "set up a card", "build a card", "another card",
    ],
    answer:
      "From the dashboard's \"My Cards\" box, press \"Add card\" (or \"Create your card →\" if you don't have one yet). It's a four-step builder: 1 Card information, 2 Card design, 3 Socials, 4 Social design — then you're done and the card is live.",
    detail:
      "Step by step, with the real headings: step 1 \"New card\" — name, title, phone numbers, email, website and address, ending in \"Next: Card design →\". Step 2 \"Card design\" — \"Add your logo and headshot, then pick a design.\" — logo, headshot, template and colours, ending in \"Next: Socials →\". Step 3 \"Socials\" — the \"Swift Links bio\" (required: it has a red asterisk, and \"Next: Social design →\" won't move on until it has something in it), social profiles and additional link buttons, ending in \"Next: Social design →\". Step 4 \"Social design\" — the look of your Swift Links page: pick a Look from the three groups (Solid, Gradient, Glass), choose the \"Page header\" (full cover photo, short banner, compact circle, or no header) and what it shows (headshot, logo, initials, or \"+ Upload photo or video\" for your own header photo or short video), set the page background (a colour, or a photo or video behind the whole page, with any header), and style your social icons and link buttons. A guest building their first card then picks a plan and creates an account; an existing user's card just goes live. A photo or video behind the card, a header photo, a page background and Featured/Grid tile media can all be added while building, before an account exists (the same goes for the homepage \"See how your card would look\" builders); videos play muted on a loop.",
  },
  {
    id: "edit-a-card",
    title: "Editing a card",
    audience: ["user"],
    triggers: [
      "edit a card", "edit card", "edit my card", "update my card", "change my info",
      "change my name", "change my phone", "change my email", "change my number",
      "change my title", "fix my card", "where do i edit",
    ],
    answer:
      "Settings → Cards and sharing → \"Edit\" next to the card. That's the only place a card can be edited — the dashboard shows and shares cards but has no Edit link. The editor has four tabs: \"Card info\", \"Card design\", \"Socials\" and \"Social design\".",
    detail:
      "What lives on each tab, from their own hints: Card info — \"Name & contact details\" (plus your website, address, and the card's URL). Card design — \"Photos, template, colors & fonts\" (laid out as Logo & headshot, Template, then numbered design steps from Look to Finish). Socials — \"Bio, socials & additional links\". Social design — \"Style your Swift Links page\". Social design also has a \"Show the 'View SwiftCard' button\" switch — on by default; turning it off removes the small link at the bottom of the Swift Links page that opens the card. On a phone, the Social design tab keeps a small, scrollable preview of your Swift Links page pinned at the top while you scroll the controls. It follows the step you are on (Social icons scrolls it to your icons, Link buttons to your links), the \"Top\", \"Socials\", \"Connect\" and \"Links\" buttons beside it jump straight to that part, you can drag inside it to look anywhere, and \"Full size\" (or tapping the preview) shows the whole page (\"Close\" goes back). The homepage \"See how your SwiftLink would look\" builder uses the same preview. The Social design tab is one numbered list, like Card design: 1 \"Page header\", 2 \"Look\", 3 \"Background & text\" (Page background and Text color), 4 \"Font\", 5 \"Social icons\", 6 \"Connect button\", 7 \"Link buttons\" — the shape of the page first, then its colours, then its parts in the order visitors see them. It also offers a \"Page header\" choice — \"Cover photo\" (the classic full photo), \"Short banner\" (a third of the screen), \"Compact circle\" (a small round photo) or \"No header\" (one flat page) — plus a \"Header shows\" pick: \"Auto\" (headshot, else logo, else initials), \"Headshot\", \"Logo\", \"Initials\", and below them a \"+ Upload photo or video\" button (your own header photo or a short video that plays muted on a loop; once uploaded it shows with \"Replace\" and \"Remove\", and \"Use it\" switches back to it if you picked another option — all of this on any plan) — and, with Pro, a \"Link buttons\" section that lists every additional link so each one can be styled on its own: pick \"Featured\" (full-width tile), \"Grid\" (half-width pairs) or \"Compact\" (slim row) per link. For Featured and Grid, the tile shows the link's own preview image, or \"Upload photo or video\" swaps in your own photo or a short video (up to 25 MB, plays muted); \"Use link preview\" goes back. For Compact, a \"Row style\" of \"Standard\" (the stock translucent row), \"Solid\" (solid color) or \"Outline\" (bordered) appears, plus one shared button color picker for Solid/Outline rows, which defaults to your Connect button color. A \"Connect button\" section sets that action color: it changes the Connect button and any social icons set to Accent, and Solid/Outline rows follow it unless given their own. Leave it on Default to use the Look\u2019s own color. Pro. Below that, \"Page background\" sets the surface behind everything: a colour swatch, and a \"+ Add photo or video\" button (\"Replace\" and \"Remove\" once one is set) that fills the whole page with a photo or a short video (it loops, muted) — with any Page header. With a cover photo or short banner, the header photo fades into the background. With one set, a \"Darken\" slider controls how much it is dimmed for readability (Pro). Each link under \"Link buttons\" has its own \"Blur\" switch: frosted glass for a Compact row, a frosted band behind the title for a Featured or Grid tile.  One page can mix all three — for example one Featured video, two Grid tiles and a Compact row. The links themselves are added and removed on the Socials tab, which has no style controls. Note the second tab is labelled \"Card design\", not \"Design\". On a team account the company-managed fields show a \"Managed by your organization\" tag and can't be changed from here: the company name, logo, website, office phone, fax and address; the Swift Links bio and Instagram when the company sets them; the company's pinned links, which sit first on the page and have no remove button (your own links follow them); and, when the company keeps every card matching, the whole Card design and Social design (the tabs then say your organization sets the look — your headshot stays yours). Everything else is the member's own: name, title, email, headshot, other socials, their own links and the card's URL. Phone numbers a team member adds are their mobile; the office number is added automatically. A team member has one card, their company card — there is no \"+ Add card\" or Delete for them. If the team admin takes the card offline, Settings → Cards and sharing says \"Your team admin took this card offline — ask them to turn it back on\"; only the admin can. On the Free plan every one of these controls WORKS — pick any Look, any colour, any icon or button style and the live preview shows it, so you can see the page you would have. The parts that need Pro carry a small PRO tag, and pressing \"Save Changes\" is where it stops: a panel lists exactly what you used that needs Pro and offers to save the free version of the page instead. Nothing is silently thrown away, and nothing is locked before you have seen it — the same way Card design works.",
  },
  {
    id: "templates-and-design",
    title: "Templates, colours and fonts",
    audience: ["user"],
    triggers: [
      "design", "template", "templates", "change design", "change template",
      "change my design", "theme", "fonts", "colors", "colours", "card look", "restyle",
      "undo", "undo a change", "go back", "revert", "undo design",
    ],
    answer:
      "Settings → Cards and sharing → Edit → the \"Card design\" tab. There are {product.templateCount} templates — Classic Pro, Modern Bold, Photo First, Local Business, Luxury Minimal and Logo First — and every one of them is available on every plan. The tab runs top to bottom: \"Logo & headshot\" (a row that opens by itself while either is missing, and folds to a one-line summary once both are added — tap it to change them), then \"Template\", a gallery where every template is drawn with your own name and details so you can see each one before you pick it (\"Custom design\" is the slim row under them). Below that is one numbered list of design steps, all open, in the order a card is built — the base first, then the details. On Classic Pro it reads: 1 \"Look\" (one tap sets the whole card; the first tile, \"Original\", puts the template back exactly as it ships), 2 \"Branding panel\", 3 \"Photo or video\" (optional, behind the branding panel), 4 \"Info panel\", 5 \"Name color\", 6 \"Accent / icons\" (colours the icons on your card AND the buttons on your card page), 7 \"Details color\", 8 \"Font\", 9 \"Finish\". Each template uses its own names for the colour steps (for example \"Card background\" instead of \"Branding panel\"), and templates with only one surface have no second-panel step, so their list is one step shorter. There are no tabs or \"More\" rows to open — just work down the numbers. On a phone the card preview sits at the very top of the tab and stays pinned to the top of the screen while you scroll through everything below it, so you can watch every change as you make it; tap the card to see it full size (the same in the card builder, on Edit card and in the app). \"Finish\" is the material laid over your colour: Flat (the standard look), Sheen (a band of light), Halo (a glow behind your logo), Frosted (a milky sheet), Brushed metal, Carbon, Linen and Gilt edge (a foil rule). Flat, Sheen and Halo are on every plan; the other five come with Pro. A finish reads strongest on deeper colours, and Frosted lightens the panel, so the editor warns that a white name may need a darker colour. \"Photo or video\" (Pro) puts a photo or a short video behind that same surface, with a \"Darken\" slider so your name stays readable. A video plays on your live card page; everywhere a video cannot play — the card image you download or share, link previews, and your email signature — its first frame is shown instead, so the card never looks empty. Finishes work on all six templates and change nothing on a card that has not picked one.",
    detail:
      "UNDO: while editing or building a card, the \"Card design\" and \"Social design\" tabs each have an Undo that steps back one change at a time, newest first, and leaves every other change you made alone — press it again to go back one more. It appears as soon as there is something to undo, next to the preview: on a phone it is the round arrow button on the top-left corner of the pinned card (Card design) or the \"Undo\" pill under \"Full size\" beside the Swift Links preview (Social design); on a computer it is \"Undo\" at the top right of the preview, and Ctrl+Z / Cmd+Z works too. With the Custom design open, it is the \"Undo\" at the top of the designer's \"Fine-tune\" panel — the same one Undo, covering every move, resize, font and colour change on the card too. Dragging a colour or a slider counts as one step. It only reaches back to your last save — after \"Save changes\" (or creating the card) there is nothing to undo, and edits on the other tabs (your details, socials, links) are not part of it. Free accounts can restyle a template using the same curated swatches Pro sees; what Pro adds is the free-form colour picker and the Custom design path. On the Free plan every control on the \"Card design\" tab still works and shows on the preview, Pro ones included — and on Edit card each Pro choice carries a small light-blue PRO tag, so you can tell which ones they are: \"any color\" in each colour step, \"Photo or video\", the Frosted, Brushed, Carbon, Linen and Gilt edge finishes (and the Looks built on them, tagged on the tile), and the \"Custom design\" row. Flat, Sheen, Halo, the colour swatches, the fonts and the other Looks carry no tag because they are free. Pressing \"Save Changes\" with a tagged choice in use opens a panel that names each one and offers to keep them with Pro, \"Save without them\", or \"Keep editing\". The marketing site calls the first template \"Classic Professional\" while the editor calls it \"Classic Pro\" — same design. Changing a template never changes your card's URL or content.",
  },
  {
    id: "custom-designer",
    title: "Custom design (Pro)",
    audience: ["user"],
    triggers: [
      "custom design", "custom designer", "design my own", "drag and drop", "move things",
      "rebuild my card", "copy my printed card", "scan my card design", "my existing card design",
      "ai design", "design my card with ai", "generate a card", "try another design", "resize", "make it bigger",
      "change the font", "where did the looks go",
    ],
    answer:
      "In the \"Card design\" tab, directly under the template gallery, there's a \"Custom design\" row with two ways in. \"Copy a card or template you like\" rebuilds a card design you upload with your own details. \"AI design\" asks three things — your colours (pick one or two, or none and it chooses), a theme (Modern, Classic, Bold, Minimal, Luxury, Creative, Tech or Natural), and whether your headshot and logo go on the card — then press \"Generate my design\" and it designs the card for you; \"Try another\" makes a different one from the same choices and \"Change choices\" reopens the questions. Then you fine-tune it right on the card: tap anything to select it, drag it to move it, drag the round corner dot (or press − / +) to make it smaller or bigger, and use the \"Fine-tune\" panel beside it to change that item's font, bold, italic, capitals, alignment and colour, a photo's frame (circle, rounded, square), a shape's colour and see-through, or what sits in front (\"Bring forward\" / \"Send back\"); with nothing selected the panel changes the whole card's background and font. \"Add to card\" puts back anything you have (a detail, your photo or logo, the QR code, a social) or adds text, a line, a box or a circle, and \"Remove from card\" takes the selected item off. It opens only for accounts on Pro or Office, from Edit card or \"+ Add card\" in the dashboard (a team member, who has one card and no \"+ Add card\", opens it from Edit card — unless the team keeps every card matching, in which case the design is the company's). Everywhere else — Get Started (building your first card, in the app or on the website), the homepage card builders, and a Free account — the same row is shown with a small PRO tag, marked \"Locked\", and tapping it does nothing.",
    detail:
      "Inside the designer the button for the photo route reads \"Copy a card or template you like\" — upload a picture of a card and it is measured and rebuilt with your own details on it. Its \"Make it editable blocks instead\" option copies just the layout — colours, font and panel — as a design you then fine-tune on the card like an AI design. The headshot and logo switches in AI design are greyed out until a photo or logo has been added in your card details. The eight preset \"Looks\", the Style box and the \"What's on your card\" list that used to be in Custom design were replaced by AI design in September 2026; a card already saved with one of them still shows exactly as it was. Like the rest of the custom designer it is Pro; a Free account gets a clear refusal rather than a silent failure. This is the one genuinely Pro-only design path — the templates themselves are not gated. It cannot be opened while building a card in Get Started, even on the way to choosing Pro: pick a template there, and switch to Custom design from Edit card once the account is on Pro or Office. A custom card made with the earliest version of the designer (before August 2026) opens straight into the fine-tune editor exactly as it was saved — nothing about it changes until you move or restyle something, and Undo reverses that before saving. If an account drops to Free, a custom-designed card falls back to the nearest standard template; the layout is not deleted, and it returns when the account is paid again.",
  },
  {
    id: "photos",
    title: "Logo and headshot",
    audience: ["user"],
    triggers: [
      "logo", "headshot", "photo", "profile picture", "upload image", "upload photo",
      "company logo", "picture", "avatar", "crop", "change my photo",
    ],
    answer:
      "Both are on the \"Card design\" tab (step 2 of the builder): \"Upload your company logo\" and \"Upload your headshot\". No photo handy? \"Suggest my profile picture\" pulls one from your connected accounts for you to preview, and there's a matching suggestion for your company logo. If it offers \"Connect LinkedIn\", connecting brings you straight back and applies your LinkedIn photo automatically — you'll see \"Headshot added\", and you can still upload your own to replace it. On a computer a small LinkedIn window opens on top and closes itself when you're done — including when LinkedIn first asks you to sign in (on a phone's browser it opens as a new tab; if it can't close itself it says \"LinkedIn is connected\" — just switch back to your SwiftCard tab and the photo is added there); in the app it opens as a sheet over your card. If LinkedIn doesn't finish, or your profile has no photo, the suggester says so instead of silently doing nothing. Either way the card you were editing stays open behind it and keeps everything you had typed — you do not have to save first. The three homepage builders (\"See how your card / Swift Signature / SwiftLink would look\") work the same way: Connect LinkedIn briefly leaves the page, then brings you back with that builder reopened on its first step, your name and business still filled in, and your LinkedIn photo in place.",
    detail:
      "The headshot note says it plainly: \"Recommended. This will also be used for your SwiftLink.\" Each card has its OWN headshot — a card without one will not borrow another card's. The logo adapts to its own shape (square, wide, or banner), and a \"Logo shape\" toggle under the upload adds a Circle option — your full logo inside a clean circular badge, nothing cropped. On a team account the company logo is set by the admin on the Branding tab and can't be uploaded by a member.",
  },
  {
    id: "socials",
    title: "Social profiles and extra links",
    audience: ["user"],
    triggers: [
      "social", "socials", "instagram", "linkedin", "tiktok", "facebook", "youtube",
      "twitter", "snapchat", "add socials", "add a link", "extra links", "buttons", "bio",
      "bio required", "why is the bio required", "can't skip bio", "asterisk",
    ],
    answer:
      "The \"Socials\" tab (step 3 of the builder) — your bio, your social profiles, and additional link buttons. Every social box asks for the same thing: just your username. Under each one it says what that becomes — \"Just your username — becomes linkedin.com/in/alexmorgan\", and the same for instagram.com/, tiktok.com/@, facebook.com/, x.com/, snapchat.com/add/ and youtube.com/@. Pasting a full profile URL still works; once a box is filled it shows the exact address it opens, so a wrong handle is visible before anyone taps it.",
    detail:
      "The \"Swift Links bio\" is the one required field on this tab (the red asterisk). A new card can't go past the Socials step without one, and in the editor \"Save Changes\" with an empty bio jumps to the Socials tab and outlines the box in red (\"Add a bio to save your card.\"). It is required because the AI follow-ups read it: it tells them what you do, so the messages they write to your contacts are about your actual work. The homepage \"See how your SwiftLink would look\" builder asks for it too. On a team account where the company sets one bio for everyone, the box is read-only and you don't have to write your own. These all appear on your Swift Links page, and the socials also show on your card page. Additional links take a name and a URL — Free shows the first {limit.links} of them publicly and keeps any extras stored but hidden, so they reappear if the account becomes paid.",
  },
  {
    id: "page-background",
    title: "A photo or video behind your Swift Links page",
    audience: ["user"],
    triggers: [
      "background", "page background", "background photo", "background video",
      "video background", "photo behind my links", "wallpaper", "background image",
      "blurry buttons", "blurred buttons", "frosted", "glass buttons", "see through buttons", "blur a link", "blur",
    ],
    answer:
      "Card editor → Social design → \"Background & text\" → under \"Page background\" press \"+ Add photo or video\" to upload a photo or a short video. It works with any Page header. It fills the whole page behind your links. Photos up to 5 MB, videos up to 25 MB — the video plays muted and loops on its own.",
    detail:
      "With \"Cover photo\" or \"Short banner\" the header photo fades into the background. Once a background is set, \"Darken\" dims it so your name and links stay readable; nudge it up if a bright photo is washing out the text. Blur is chosen per link: under \"Link buttons\" every link has a \"Blur\" switch — a Compact row turns into frosted glass your background shows softly through (on by default for plain rows when you first add a background), and a Featured or Grid tile gets a frosted band behind its title. All of this is Pro, along with the background itself. Over a background your name and link labels are shown in white automatically, unless you picked a text colour yourself. Portrait shots fit best — the picture is cropped to fill the page, so a wide landscape photo shows only its middle on a phone.",
  },
  {
    id: "card-url",
    title: "Changing your card's link",
    audience: ["user"],
    triggers: [
      "card url", "change my url", "change my link", "username", "handle", "custom url",
      "vanity url", "my link", "rename my link",
    ],
    answer:
      "On the \"Card info\" tab of the card editor — your card lives at swiftcard.me/<your-url>. The URL is YourName-YourCompany (for example swiftcard.me/AaronLavi-MalveCapital, any capitalization works) and it updates ITSELF when you change the card's name or company \u2014 links and QR codes you already shared keep working, they redirect to the new URL. The editor on the Card info tab is only needed if you want a fully custom ending; a custom URL never changes on its own.",
    detail:
      "Changing it breaks anything already pointing at the old address: printed QR codes, NFC cards already written, and links you've shared. The QR and the NFC tag store the link, so they need re-writing or reprinting after a change. Your Swift Links page uses the same ending, so both move together.",
  },
  {
    id: "delete-a-card",
    title: "Deleting a card",
    audience: ["user"],
    triggers: ["delete a card", "delete card", "remove a card", "get rid of a card", "delete my card"],
    answer:
      "Settings → Cards and sharing → \"Delete\" on the card, then confirm in the red panel that appears. Be careful: deleting a card also permanently deletes every contact that card captured, along with their message history.",
    detail:
      "Export the contacts first if there's any chance they're wanted — there is no undo. If the goal is just to take the card out of circulation rather than lose the data, there isn't a self-serve \"hide\" switch on a personal account; on a team account an admin can take a card offline instead.",
  },
]);
