// Capture real app screens for the App Store listing.
//
// The old screenshot set could not show Swift Links, the Signature, or the
// contacts CRM because every one of those needs a signed-in session, and the
// earlier attempt to reach them headlessly failed. This does what the native
// flow harness already does: creates a throwaway Supabase account, seeds it
// with realistic content, drives a real browser through a real login, captures
// the screens, and deletes everything in a finally block.
//
//   node capture.mjs
//
// ⚠️ It writes to whatever project .env.local points at. Every row it creates
// is removed at the end, including on failure.
import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "node:fs";
import { markInternal } from "./qa-internal.mjs";

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const OUT = process.env.OUT || "app-store/screenshots/_raw";
const BASE = process.env.BASE || "https://swiftcard.me";
mkdirSync(OUT, { recursive: true });

const env = readFileSync(`${ROOT}/.env.local`, "utf8");
const g = (k) => (env.match(new RegExp("^" + k + "=(.*)$", "m")) || [])[1]?.trim().replace(/^["']|["']$/g, "");
const SB = g("NEXT_PUBLIC_SUPABASE_URL"), SVC = g("SUPABASE_SERVICE_ROLE_KEY");

const adm = (p, i) => fetch(SB + p, {
  ...i,
  headers: { apikey: SVC, Authorization: "Bearer " + SVC, "Content-Type": "application/json", ...(i?.headers ?? {}) },
});

const stamp = Date.now().toString().slice(-8);
// A real-looking slug: it shows on the Share options frame twice, and
// "alex-rivera-21416935" read as a test account. Cleaned up in the finally.
const uname = process.env.UNAME || "lenabrooks-photography";
const email = `shots-${stamp}@swiftcard-test.invalid`;
const password = `Shot!aA1${Math.random().toString(36).slice(2)}`;
let userId = null, cardId = null, browser;

// Realistic content. A screenshot with "Test User / Lorem Ipsum" in it reads as
// unfinished software; every value here is the kind a real user would have.
// Lena Brooks — the persona the marketing site's own hero showcase already
// uses, so the App Store set, the website and the demo card all tell one
// story. Her headshot ships in this repo (public/showcase/lena.jpg), which is
// why the screenshots can show a real face without licensing a stock photo.
const SITE = "https://swiftcard.me";
const PHOTO = `${SITE}/showcase/lena.jpg`;
// Warm brown, the accent of the "Linen" Look the links page now wears, so the
// card and the links page read as one set rather than two designs. The old
// near-black accent left the QR, the icons and every action reading as grey
// furniture.
const ACCENT = "#6B5B45";

const CARD = {
  name: "Lena Brooks", title: "Photographer", company: "Lena Brooks Photography",
  phone: "(503) 555-0143", email: "hello@lenabrooks.photo", website: "lenabrooks.photo",
  linkedin: "lenabrooks", instagram: "lenabrooks.photo", tiktok: "lenabrooks",
  // photo-first puts a full-height photo beside the details panel — the most
  // designed of the templates, and the only one that treats a headshot as the
  // subject rather than a small avatar. Chosen by rendering all six against
  // each other (scripts/appstore-explore.mjs) rather than from the preset list.
  template: "photo-first",
};

const BIO = "Weddings, portraits and brand shoots — natural light, real moments. Portland, OR.";

// Card design — "Warm editorial", chosen by the owner from three rendered
// candidates on 2026-09-22 (the card and the links page were too dark and
// didn't look designed). The details panel goes from near black to ivory,
// warm brown carries the QR and the icons, and the headshot becomes the only
// dark mass on the card. The Onyx panel this replaces read as a black
// rectangle on the frames' blue background.
//
// VERIFIED BY RENDERING, not by reading the preset list — PhotoFirst uses
// these keys in ways the picker's names do not imply:
//   • bgColor is the DETAILS panel on this template, not the card.
//   • surfaceColor is the backdrop behind the photo, so it only ever shows on
//     a card with NO headshot. Kept as the fallback, but it paints nothing here.
//   • finish composes OVER bgColor. Frosted is a white sheen, so on a white
//     panel it is invisible; it is why the panel carries a tint at all.
const CARD_DESIGN = {
  photoUrl: PHOTO,
  accentColor: ACCENT,
  // Ivory, not white: it gives the frosted sheen something to sit on, so the
  // panel reads as a designed surface instead of a blank one. Same ivory the
  // Linen Look puts behind the links page.
  bgColor: "#FBF7F0",                 // the DETAILS panel
  textColor: "#ffffff",               // her name, over the photo
  infoColor: "#2B241A",               // phone/email/site on that panel
  finish: "frosted",                  // milky sheet + bright top edge over it
  // Only visible on a card with no photo; harmless, and warmer than the
  // template's default indigo if that ever happens.
  surfaceColor: "linear-gradient(145deg, #6B5B45 0%, #8A7355 60%, #A68A66 100%)",
  bio: BIO,
};

// A links page with something to look at. Owner, 2026-09-22: "really show how
// additional links look in SwiftLinks and make them very nice and very cool."
//
// The previous set said in a comment that it used all three tile sizes and
// then made every single link `compact` — six identical slim rows, which is
// the one shape that shows none of what the page can do. This uses the range
// for real:
//
//   header   a section title — chapters down a long page (Pro)
//   featured a full-width tile with its own image
//   grid     a half-width pair, side by side, each with an image
//   compact  the slim rows, for the links that are just links
//
// The images are her work: a portrait photographer's page showing portraits
// is the tile system doing the thing it exists for. They come off production
// (the capture runs against it) so nothing here needs a local file server.
const LINKS = [
  { label: "My work", url: "", kind: "header" },
  // Featured — the one tile that gets the full width. Landscape, and a
  // sparkler send-off is the one image in the library that reads as a wedding.
  { label: "Watch the 2026 wedding reel", url: "https://lenabrooks.photo/reel",
    size: "featured", media: { url: `${SITE}/marketing/ll-blog.jpg`, type: "image" } },
  // A grid PAIR — two is deliberate: layoutTiles promotes a lone grid tile to
  // featured rather than leave a half-width tile beside empty space, so an odd
  // count would silently lose the side-by-side shape this frame is meant to show.
  //
  // The labels follow the images, not the other way round: both are portraits,
  // and her bio already says "weddings, portraits and brand shoots". A tile
  // captioned "Weddings" over an office headshot is the kind of mismatch a
  // reviewer notices before anything else on the screen.
  { label: "Portraits", url: "https://lenabrooks.photo/portraits",
    size: "grid", media: { url: `${SITE}/showcase/zoe.jpg`, type: "image" } },
  { label: "Brand shoots", url: "https://lenabrooks.photo/brand",
    size: "grid", media: { url: `${SITE}/showcase/maya.jpg`, type: "image" } },
  { label: "Book me", url: "", kind: "header" },
  { label: "Check my 2026 availability", url: "https://lenabrooks.photo/book", size: "compact" },
  { label: "Wedding packages", url: "https://lenabrooks.photo/packages", size: "compact" },
  { label: "Join the newsletter", url: "https://lenabrooks.photo/news", size: "compact" },
];

// Every field a contact can show is filled. "No notes" / "Not set" / "no flow"
// in a listing screenshot reads as an empty product. Jordan is the lead the
// story follows: shared their info back from the public card (frame 02),
// appears in Contacts (03), and has a running follow-up automation (08).
const D = (daysAgo, h = 10, m = 0) => {
  const t = new Date(); t.setDate(t.getDate() - daysAgo); t.setHours(h, m, 0, 0); return t.toISOString();
};
const SEQ = (anchor, sent, first) => [
  { day: 0, time: "10:00", channel: "email", subject: "Great meeting you", message: `Hi ${first}, lovely to meet you today. Here's my portfolio and the 2026 packages we talked about — shout if you have questions.`, anchor, sent_at: sent ? anchor : null },
  { day: 3, time: "09:30", channel: "email", subject: "Quick follow-up", message: `Hi ${first}, just checking in — happy to hold a date for you while you decide.`, anchor, sent_at: null },
  { day: 7, time: "11:00", channel: "email", subject: "Dates are filling up", message: `Hi ${first}, spring weekends are going fast. Want me to pencil one in?`, anchor, sent_at: null },
  { day: 1, time: "12:00", channel: "sms", message: `Hi ${first}, Lena here — great meeting you. My portfolio: lenabrooks.photo/portfolio`, anchor, sent_at: sent ? anchor : null },
  { day: 5, time: "12:00", channel: "sms", message: `Hi ${first}, still happy to hold a date for you. Just reply here.`, anchor, sent_at: null },
];
const LEADS = [
  { name: "Jordan Rivera", company: "Rivera Design Co.", email: "jordan.rivera@example.com", phone: "(415) 555-0110",
    location: "Portland, OR", tags: ["qr", "sms-ok"], source: "qr_code", visitor_id: "shot-visitor-jordan", created_at: D(0, 9, 12),
    where_met: "Rivera Design Co. studio opening, Pearl District",
    notes: "Wants a brand shoot for the new studio in March. Budget approved. Send the 2026 packages and two dates.",
    message: "Loved meeting you at the opening! Send me the brand shoot packages when you get a chance.",
    status: "hot", follow_up_sequence: SEQ(D(0, 9, 12), true, "Jordan") },
  { name: "Marcus Webb", company: "Webb & Co.", email: "marcus.webb@example.com", phone: "(415) 555-0121",
    location: "Seattle, WA", tags: ["sms-ok"], source: "direct_link", visitor_id: "shot-visitor-marcus", created_at: D(1, 16, 40),
    where_met: "Referred by Priya Nair", notes: "Headshots for a team of 12, wants them done on-site in one afternoon.",
    message: "Priya passed along your card — we need team headshots before the rebrand launches.",
    status: "warm", follow_up_sequence: SEQ(D(1, 16, 40), true, "Marcus") },
  { name: "Priya Nair", company: "Lumen Health", email: "priya.nair@example.com", phone: "(415) 555-0132",
    location: "Portland, OR", tags: ["nfc", "sms-ok"], source: "nfc_tap", visitor_id: "shot-visitor-priya", created_at: D(2, 11, 5),
    where_met: "Portland Creative Mornings, NFC tap", notes: "Booked: wedding, 14 June, Sauvie Island. Second shooter confirmed.",
    message: "So glad we met at Creative Mornings. June 14 is the date!", status: "booked", follow_up_sequence: SEQ(D(2, 11, 5), true, "Priya") },
  { name: "Sofia Delgado", company: "Delgado Partners", email: "sofia@example.com", phone: "(415) 555-0143",
    location: "Bend, OR", tags: ["sms-ok"], source: "swift_links", visitor_id: "shot-visitor-sofia", created_at: D(3, 19, 22),
    where_met: "Came through the Swift Links page from Instagram", notes: "Engagement session in the fall, golden hour at Smith Rock.",
    message: "Found you on Instagram — your Smith Rock photos are exactly what we want.", status: "warm", follow_up_sequence: SEQ(D(3, 19, 22), true, "Sofia") },
  { name: "Tom Bergeron", company: "Harbor Financial", email: "tom.b@example.com", phone: "(415) 555-0154",
    location: "Lake Oswego, OR", tags: ["qr", "sms-ok"], source: "qr_code", visitor_id: "shot-visitor-tom", created_at: D(5, 13, 50),
    where_met: "Harbor Financial client dinner", notes: "Annual report portraits for 6 partners, needs them by end of quarter.",
    message: "Great chatting at dinner. Let\u2019s get the partner portraits on the calendar.", status: "warm", follow_up_sequence: SEQ(D(5, 13, 50), true, "Tom") },
  { name: "Amara Okafor", company: "Bloom & Vine Events", email: "amara@example.com", phone: "(503) 555-0166",
    location: "Portland, OR", tags: ["sms-ok"], source: "email_signature", visitor_id: "shot-visitor-amara", created_at: D(8, 8, 15),
    where_met: "Replied to my email signature", notes: "Wedding planner. Wants a preferred-vendor arrangement for 2026 weddings.",
    message: "Saw your card in your email — we should talk about working together next season.", status: "hot", follow_up_sequence: SEQ(D(8, 8, 15), true, "Amara") },
];

// Full-page captures stitch the page in viewport-sized bands, so anything
// position:fixed — the bottom tab bar, the help bubble — is painted ONCE at
// the first viewport's bottom edge and then sits in the middle of the tall
// image. The v2 dashboard frame shipped with the tab bar floating above the
// traffic chart for exactly that reason. Hide fixed chrome for full-page
// shots; viewport shots keep it, since there it sits where it belongs.
const HIDE_FIXED = ".sc-tabbar, .sc-help-bubble { display: none !important; }";
// noDim: clear a modal's dark scrim before the shot. A sheet dims the app
// behind it in the product, which is right there and wrong here — frames 09 and
// 10 are the only two shot with a sheet open, so they came back with a grey
// #474850 app behind the sheet while frames 01-08 show the cream one, and the
// set read as two different designs (owner, 2026-09-22: "images 9 and 10 do not
// have the same colors"). The sheet itself is untouched; only the scrim goes.
const shot = async (page, name, { full = false, wait = 1200, noDim = false } = {}) => {
  await page.waitForTimeout(wait);
  if (noDim) {
    await page.evaluate(() => {
      for (const el of document.querySelectorAll("div.fixed.inset-0")) {
        el.style.background = "transparent";
        el.style.backdropFilter = "none";
        el.style.webkitBackdropFilter = "none";
      }
    }).catch(() => {});
    await page.waitForTimeout(250);
  }
  if (full) await page.addStyleTag({ content: HIDE_FIXED });
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: full });
  if (full) await page.evaluate(() => document.querySelectorAll("style").forEach((s) => { if (s.textContent.includes("sc-tabbar, .sc-help-bubble")) s.remove(); })).catch(() => {});
  console.log("  captured", name);
};

try {
  console.log("seeding…");
  const u = await (await adm("/auth/v1/admin/users", {
    method: "POST", body: JSON.stringify({ email, password, email_confirm: true }),
  })).json();
  userId = u.id;
  if (!userId) throw new Error("no user id: " + JSON.stringify(u).slice(0, 200));

  await adm("/rest/v1/profiles", {
    method: "POST", headers: { Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify({
      id: userId, username: uname, name: CARD.name, email, plan: "pro",
      template: CARD.template,
      photo_url: PHOTO,
      customization: { bio: BIO, photoUrl: PHOTO, _aiConsent: "accepted" },
    }),
  });

  const card = await (await adm("/rest/v1/cards", {
    method: "POST", headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      user_id: userId, username: uname, ...CARD,
      customization: {
        ...CARD_DESIGN,
        links: LINKS,
        // A cover photo over "Linen" — ivory settling into taupe, with a warm
        // brown accent (owner's pick, 2026-09-22). The page reads light and
        // editorial, the headshot stays the brightest thing on it, and the
        // accent is the same brown the card's QR and icons carry. "aura",
        // which this replaces, was near-black: in the App Store frames it
        // showed as a dark slab with a face at the top.
        linkLook: "linen",
        linkHeroStyle: "cover",
        linkHeroContent: "photo",
        linkIconShape: "circle",
        // Mono, not accent: on a cream sheet a row of brown chips reads as one
        // brown smear. Quiet neutral chips let the tiles below carry the colour.
        linkIconFill: "mono",
        youtube: "lenabrooks",
        facebook: "lenabrooks.photo",
      },
    }),
  })).json();
  cardId = card?.[0]?.id;

  // Analytics with zeros in it sells nothing. Seed a full month on BOTH
  // surfaces (the card, and Swift Links under "<username>__links") so the
  // Month tab shows thousands of views, a 30-bar chart, a best day, and the
  // Locations tab has a spread of towns. Weekends dip, one launch day spikes.
  // Towns are WEIGHTED, not round-robin: a real photographer's traffic is her
  // home city by a mile, a couple of nearby metros, then a long tail. The
  // first pass dealt towns out evenly and every row read "657 views" — a list
  // of identical numbers is the one thing that screams fake data. Swift Links
  // traffic skews differently (Instagram audiences in Bend and LA) so the
  // per-town split varies too.
  const TOWN_WEIGHTS = {
    card:  [["Portland, OR", 46], ["Seattle, WA", 17], ["Vancouver, WA", 10], ["Bend, OR", 8], ["San Francisco, CA", 7], ["Los Angeles, CA", 5], ["Eugene, OR", 4], ["Boise, ID", 3]],
    links: [["Portland, OR", 33], ["Bend, OR", 17], ["Seattle, WA", 14], ["Los Angeles, CA", 12], ["San Francisco, CA", 9], ["Vancouver, WA", 7], ["Eugene, OR", 5], ["Boise, ID", 3]],
  };
  // Deterministic pseudo-random so the set regenerates identically.
  const hash = (a, b, c) => { let h = 2166136261 ^ a; h = Math.imul(h ^ b, 16777619); h = Math.imul(h ^ c, 16777619); return (h >>> 0) / 4294967296; };
  const pickTown = (surface, d, i) => {
    const w = TOWN_WEIGHTS[surface]; const total = w.reduce((t, [, n]) => t + n, 0);
    let r = hash(surface === "card" ? 1 : 2, d, i) * total;
    for (const [town, n] of w) { if ((r -= n) < 0) return town; }
    return w[0][0];
  };
  const SOURCES = ["qr_code", "direct_link", "nfc_tap", "email_signature", "swift_links"];
  const views = [];
  let cardTotal = 0, linkTotal = 0;
  for (let d = 0; d < 30; d++) {
    const at0 = new Date(); at0.setDate(at0.getDate() - d);
    const weekend = [0, 6].includes(at0.getDay());
    const base = weekend ? 88 : 132 + ((d * 37) % 41);
    const nCard = d === 6 ? 412 : d === 0 ? 176 : base;
    const nLink = Math.round(nCard * (d === 6 ? 0.7 : 0.44));
    for (const [key, n] of [[uname, nCard], [`${uname}__links`, nLink]]) {
      for (let i = 0; i < n; i++) {
        const at = new Date(at0);
        at.setHours(7 + ((i * 7 + d) % 15), (i * 13) % 60, (i * 29) % 60, 0);
        // Today's not-yet-happened views are pulled back to the current hour,
        // which puts them all in one 30-minute bucket — a repeat visitor id
        // there trips uq_card_views_visitor_bucket (it did, 2026-09-09
        // morning). Clamped views are always unique visitors.
        const clamped = d === 0 && at > new Date();
        if (clamped) at.setHours(new Date().getHours(), 0, 0, 0);
        views.push({
          username: key, viewed_at: at.toISOString(),
          location: pickTown(key === uname ? "card" : "links", d, i),
          source: SOURCES[(d * 3 + i) % SOURCES.length],
          // Some visitors come back: a repeat id every 6th view.
          visitor_id: i % 6 === 0 && !clamped ? `shot-repeat-${d % 9}-${i % 11}` : `shot-${key.length}-${d}-${i}`,
        });
      }
      if (key === uname) cardTotal += n; else linkTotal += n;
    }
  }
  // Checked, and retried once. The v3 dashboard frame shipped with its newest
  // four days flat: the FIRST 1000-row batch (today back to day 4) failed and
  // nothing noticed, because adm() is a bare fetch. A chart that dies off in
  // its last week says the opposite of what the frame is for.
  for (let i = 0; i < views.length; i += 1000) {
    const batch = JSON.stringify(views.slice(i, i + 1000));
    let res = await adm("/rest/v1/card_views", { method: "POST", body: batch });
    if (!res.ok) res = await adm("/rest/v1/card_views", { method: "POST", body: batch });
    if (!res.ok) throw new Error(`card_views batch ${i / 1000 + 1} failed: ${res.status} ${await res.text()}`);
  }
  console.log("  seeded", views.length, "views —", cardTotal, "card,", linkTotal, "links");

  const leadRows = await (await adm("/rest/v1/leads", {
    method: "POST", headers: { Prefer: "return=representation" },
    body: JSON.stringify(LEADS.map((l) => ({ ...l, card_owner: uname }))),
  })).json();
  const jordan = Array.isArray(leadRows) ? leadRows.find((l) => l.name === "Jordan Rivera") : null;

  // What the contact's Conversation tab shows: the activity log (card_events)
  // and the message thread (lead_messages). Jordan viewed the card, tapped
  // Save Contact, shared their info, got the day-0 email, and replied.
  const ev = (l, event_type, minsAgo) => ({
    card_owner_username: uname, visitor_id: l.visitor_id, event_type, source: l.source,
    visitor_name: l.name, visitor_email: l.email, visitor_phone: l.phone, location: l.location,
    created_at: new Date(Date.now() - minsAgo * 60000).toISOString(),
  });
  await adm("/rest/v1/card_events", { method: "POST", body: JSON.stringify([
    ev(LEADS[0], "viewed_card", 214), ev(LEADS[0], "clicked_save_contact", 213), ev(LEADS[0], "shared_info", 211),
    ev(LEADS[1], "viewed_card", 1600), ev(LEADS[1], "shared_info", 1598),
    ev(LEADS[2], "viewed_card", 3000), ev(LEADS[2], "downloaded_vcard", 2999), ev(LEADS[2], "shared_info", 2997),
  ]) });
  if (jordan?.id) {
    await adm("/rest/v1/lead_messages", { method: "POST", body: JSON.stringify([
      { lead_id: jordan.id, card_owner: uname, direction: "out", channel: "email", status: "sent",
        body: "Hi Jordan, lovely to meet you today. Here's my portfolio and the 2026 packages we talked about \u2014 shout if you have questions.",
        created_at: new Date(Date.now() - 190 * 60000).toISOString() },
      { lead_id: jordan.id, card_owner: uname, direction: "in", channel: "email", status: "received",
        body: "Thanks Lena! The Studio package looks perfect. Could we do the second week of March?",
        created_at: new Date(Date.now() - 95 * 60000).toISOString() },
    ]) });
  }
  // The notification bell (the dashboard has no notifications list since
  // Quick Contacts left it, 2026-09-29).
  const note = (type, title, body, minsAgo) => ({
    user_id: userId, card_owner: uname, type, title, body, read: false,
    created_at: new Date(Date.now() - minsAgo * 60000).toISOString(),
  });
  await adm("/rest/v1/notifications", { method: "POST", body: JSON.stringify([
    note("new_lead", "Jordan Rivera shared their info", "Rivera Design Co. \u00b7 via QR code \u00b7 \u201cSend me the brand shoot packages\u201d", 211),
    note("new_lead", "Marcus Webb saved your contact", "Webb & Co. \u00b7 via your link", 1598),
    note("card_view", "Card viewed 176 times today", "Top source: QR code \u00b7 Portland, OR", 30),
  ]) });
  console.log("  seeded", uname, "with", LEADS.length, "contacts");

  browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 440, height: 956 },
    deviceScaleFactor: 3,
    colorScheme: "dark",
    isMobile: true,
    hasTouch: true,
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  });
  await markInternal(ctx, BASE);
  // Render as the native iOS shell, not mobile Safari. Without this the app
  // shows its web presentation: no "Add to Apple Wallet" (that button is
  // native-only), and the marketing chrome rules differ. The shim must be in
  // place BEFORE first paint, and it must fake window.webkit too — Capacitor
  // derives the platform from the message-handler bridge, so faking
  // isNativePlatform alone fools the boot script but not the components.
  await ctx.addInitScript(() => {
    window.webkit = { messageHandlers: { bridge: { postMessage() {} } } };
    window.Capacitor = {
      isNativePlatform: () => true, isNative: true, platform: "ios",
      getPlatform: () => "ios", isPluginAvailable: () => false, Plugins: {},
    };
  });

  const page = await ctx.newPage();

  // Public screens first — no session needed, and they are the ones a brand
  // new user actually sees.
  console.log("public screens…");
  const pubCtx = await browser.newContext({
    viewport: { width: 440, height: 956 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  });
  await markInternal(pubCtx, BASE);
  const pub = await pubCtx.newPage();
  await pub.goto(`${BASE}/${uname}`, { waitUntil: "networkidle" });
  await shot(pub, "public-card", { full: true });
  // The same page with the share-back form filled in, as Jordan is about to
  // send it — frame 02 shows a lead coming back, not four empty inputs.
  try {
    await pub.fill('input[placeholder="Your name *"]', "Jordan Rivera");
    await pub.fill('input[placeholder="Your phone number *"]', "(415) 555-0110");
    await pub.fill('input[placeholder="Your email (optional)"]', "jordan.rivera@example.com");
    await pub.fill('textarea[placeholder="Quick message (optional)"], input[placeholder="Quick message (optional)"]',
      "Loved meeting you at the opening! Send me the brand shoot packages when you get a chance.");
    await shot(pub, "public-card-shared", { full: true, wait: 600 });
  } catch (e) { console.log("  ! share-back form not filled:", e.message.split("\n")[0]); }
  await pub.goto(`${BASE}/links/${uname}`, { waitUntil: "networkidle" });
  await shot(pub, "swift-links", { full: true });
  await pubCtx.close();

  // Signed-in screens.
  console.log("logging in…");
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  // NOT :has-text("Sign in") — that matches the Sign in / Create account TAB
  // above the form, so the first run clicked a tab and captured six copies of
  // the login screen. The submit button is the one carrying the arrow.
  await page.click('button:has-text("Sign in \u2192")');
  await page.waitForURL(/dashboard|onboarding|welcome/, { timeout: 45000 }).catch(() => {});
  await page.waitForTimeout(3500);
  console.log("  landed on", page.url());
  if (/\/login/.test(page.url())) throw new Error("login did not complete");

  // A first-run tour or splash can sit over every screen; dismiss whatever is
  // there rather than screenshotting a modal.
  for (const label of ["Allow", "Skip", "Skip tour", "Got it", "Maybe later", "Close", "Done"]) {
    const b = page.locator(`button:has-text("${label}")`).first();
    if (await b.count().catch(() => 0)) { await b.click().catch(() => {}); await page.waitForTimeout(400); }
  }
  await page.keyboard.press("Escape").catch(() => {});

  for (const [name, path, full] of [
    ["contacts", "/contacts", true],
    ["share", "/share", true],
  ]) {
    await page.goto(BASE + path, { waitUntil: "networkidle" }).catch(() => {});
    await shot(page, name, { full });
  }

  // Dashboard twice: as it lands, and with Traffic switched to Month so the
  // analytics frame shows a fortnight of bars instead of today's handful.
  await page.goto(`${BASE}/dashboard?vrange=month`, { waitUntil: "networkidle" }).catch(() => {});
  // The shell paints a splash over the first viewport. A full-page shot taken
  // too early bakes that overlay across the top third of the image, which is
  // where the card and the traffic counters live.
  await page.waitForTimeout(7000);
  await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
  await shot(page, "dashboard", { full: true, wait: 2500 });
  await shot(page, "dashboard-top", { full: false, wait: 300 });
  console.log("  wallet button present:", await page.locator('text=Add to Apple Wallet').count().catch(() => 0));
  // "Add to Apple Wallet" is inside the share panel, not on the dashboard root.
  const more = page.locator('button:has-text("Other ways to share")').first();
  if (await more.count().catch(() => 0)) {
    await more.click().catch(() => {});
    await page.waitForTimeout(2200);
    console.log("  wallet in share panel:", await page.locator('text=Add to Apple Wallet').count().catch(() => 0));
    await shot(page, "ways-to-share", { full: false, noDim: true });
    await page.keyboard.press("Escape").catch(() => {});
    await page.waitForTimeout(600);
  } else {
    console.log("  ! 'Other ways to share' not found");
  }

  await page.goto(`${BASE}/dashboard?vrange=locations`, { waitUntil: "networkidle" }).catch(() => {});
  await page.waitForTimeout(4000);
  await shot(page, "dashboard-locations", { full: true, wait: 1500 });

  // The Links page shows one side at a time and opens on Swift Links; #signature
  // opens the Swift Signature side, where the card-in-an-email is shown in place.
  await page.goto(`${BASE}/share#signature`, { waitUntil: "networkidle" }).catch(() => {});
  const sig = page.locator('button:has-text("Copy signature")').first();
  if (await sig.waitFor({ state: "visible", timeout: 8000 }).then(() => true, () => false)) {
    await page.waitForTimeout(2500);
    await shot(page, "signature", { full: false, noDim: true });
  } else {
    console.log("  ! signature side not found");
  }

  // A contact opened up, showing the follow-up automations.
  await page.goto(`${BASE}/contacts`, { waitUntil: "networkidle" }).catch(() => {});
  const lead = page.locator('text=Jordan Rivera').first();
  if (await lead.count().catch(() => 0)) {
    await lead.click().catch(() => {});
    await page.waitForTimeout(2500);
    // The follow-up automations live behind the second tab. Without this the
    // frame promises AI follow-up and shows an empty activity list.
    const tab = page.locator('button:has-text("Contact info")').first();
    if (await tab.count().catch(() => 0)) { await tab.click().catch(() => {}); await page.waitForTimeout(1800); }
    await shot(page, "contact-detail", { full: true });
    // The detail panel scrolls INSIDE a fixed-height container, so a full-page
    // shot ends at the first automation card. Scroll the panel itself until
    // "Notes & context" sits at the top and take a viewport shot: notes, where
    // you met, and both automation switches in one screen.
    await page.evaluate(() => {
      const el = [...document.querySelectorAll("p, h2, h3, span")].find((n) => /^notes & context$/i.test(n.textContent?.trim() ?? ""));
      if (!el) return;
      el.scrollIntoView({ block: "start" });
      // The panel has a sticky header; back off so the section label clears it.
      let sc = el.parentElement;
      while (sc && sc !== document.body && getComputedStyle(sc).overflowY !== "auto" && getComputedStyle(sc).overflowY !== "scroll") sc = sc.parentElement;
      if (sc && sc !== document.body) sc.scrollTop -= 84; else window.scrollBy(0, -84);
    }).catch(() => {});
    await shot(page, "contact-detail-automations", { full: false, wait: 900 });
  } else {
    console.log("  ! contact row not found");
  }
  console.log("done");
} catch (e) {
  console.error("FAILED:", e.message);
} finally {
  if (browser) await browser.close().catch(() => {});
  console.log("cleaning up…");
  try {
    await adm(`/rest/v1/card_views?username=in.(${uname},${uname}__links)`, { method: "DELETE" });
    await adm(`/rest/v1/card_events?card_owner_username=eq.${uname}`, { method: "DELETE" });
    await adm(`/rest/v1/lead_messages?card_owner=eq.${uname}`, { method: "DELETE" });
    if (userId) await adm(`/rest/v1/notifications?user_id=eq.${userId}`, { method: "DELETE" });
    await adm(`/rest/v1/leads?card_owner=eq.${uname}`, { method: "DELETE" });
    if (cardId) await adm(`/rest/v1/cards?id=eq.${cardId}`, { method: "DELETE" });
    if (userId) {
      await adm(`/rest/v1/profiles?id=eq.${userId}`, { method: "DELETE" });
      await adm(`/auth/v1/admin/users/${userId}`, { method: "DELETE" });
    }
    console.log("  removed throwaway account", uname);
  } catch (e) {
    console.error("  CLEANUP FAILED — remove manually:", uname, userId, e.message);
  }
}
