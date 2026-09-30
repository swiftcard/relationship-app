// Compose the Google Play phone screenshot set: 1080 x 2160.
//
// A sibling of scripts/appstore-compose-v5.mjs (the iOS set, 6.9-inch-v7).
// Same real captures from app-store/screenshots/_raw, same kickers, headlines,
// sub-heads, background and pop-outs, same frame numbers and file names, same
// ONLY= filter. Three things differ, and only these:
//
//   1. SIZE. 1080 x 2160, exactly 1:2. Google Play rejects any screenshot
//      whose long side is more than twice the short side, so 1:2 is the
//      tallest frame it accepts. The layout is drawn on a 1320 x 2640 design
//      canvas (so every font and pop-out size from v5 carries over untouched)
//      and rendered at a device scale factor of 1080/1320.
//
//   2. THE DEVICE IS A GENERIC ANDROID PHONE. Play policy discourages another
//      platform's device frames, which is the whole reason this set exists:
//      a thin, uniform black bezel, rounded corners, a small centred
//      punch-hole camera, a gesture handle. No Dynamic Island, no titanium
//      rail, no iPhone side buttons. The status bar follows Android: time on
//      the left, wifi / signal / battery (Material shapes) on the right.
//
//   3. FRAMES THAT CANNOT SHIP ON PLAY ARE LEFT OUT (see DROPPED below):
//      anything naming iPhone, Apple Wallet, Apple Watch or the App Store, and
//      anything showing pricing, Pro, an upgrade or a purchase — the Android
//      app sells nothing.
//
// Every screen is a real capture of the running app (scripts/appstore-capture.mjs);
// this script never captures, logs in or uploads anything.
import { writeFileSync, mkdirSync, readFileSync, unlinkSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { inflateSync } from "node:zlib";

const RAW = process.env.RAW || "app-store/screenshots/_raw";
const OUT = process.env.OUT || "app-store/screenshots/play-phone-v1";
const ONLY = process.env.ONLY ? process.env.ONLY.split(",") : null;
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
mkdirSync(OUT, { recursive: true });

// Design canvas is 1320 wide (v5's width, so its CSS carries over as-is) and
// exactly 1:2; the PNG is written at OUT_W x OUT_H by scaling the render.
const W = 1320, H = 2640;
const OUT_W = 1080, OUT_H = 2160;
const DSF = OUT_W / W;                        // 0.8181… → 1080 x 2160

// ── The device: a generic Android phone ──────────────────────────────────────
// The glass keeps the capture's own aspect (1320 x 2868, 2.17:1 — squarely a
// modern 20:9-class Android screen), so a frame still shows exactly one
// viewport of the app and `y` is how far the page is scrolled.
const SRC_W = 1320, SRC_H = 2868;            // the capture
const GLASS_W = 880;                          // the one number that sets the scale
const scale = GLASS_W / SRC_W;                // source px → frame px
const GLASS_H = Math.round(GLASS_W * (SRC_H / SRC_W));
const BEZEL = Math.round(GLASS_W * 0.021);    // thin, uniform black border
const EDGE_RING = 3;                          // dark frame edge, so black reads against navy
const INSET = BEZEL + EDGE_RING;
const BODY_W = GLASS_W + INSET * 2;
const BODY_H = GLASS_H + INSET * 2;
const R_GLASS = Math.round(GLASS_W * 0.1);
const R_BODY = R_GLASS + INSET;

// Vertical placement: caption above, whole phone below, a little air under it.
const TOP = 620;
const BOTTOM_GAP = H - TOP - BODY_H;

// Android metrics in dp, at this glass width (a 412dp-wide phone).
const DP = GLASS_W / 412;
const BAR = Math.round(40 * DP);              // status bar with a punch-hole
const HOLE = Math.round(11 * DP);             // punch-hole camera diameter
const HOME_W = Math.round(108 * DP);          // gesture handle
const HOME_H = Math.round(4 * DP);
const HOME_BOTTOM = Math.round(8 * DP);
// How much of the capture the glass can show, under the status bar.
const SRC_VISIBLE = Math.round((GLASS_H - BAR) / scale);
const pngHeight = (p) => readFileSync(p).readUInt32BE(20);

// ── The status bar's colour, read from the capture itself ────────────────────
//
// The captures have no status bar (they are page screenshots), so one is drawn
// over the top of the glass. Its background has to be the colour the page
// actually is at that scroll position or there is a visible seam across the
// top of the phone — and in v4 that colour was typed in by hand per frame, so
// the moment a `y` offset changed the bar stopped matching. Four of the ten had
// already drifted by the time v5 re-scrolled them.
//
// So it is measured instead: decode the capture up to the first row under the
// status bar and sample it. Re-tuning a scroll offset can no longer leave a
// mismatched bar behind, and there is one less number in this file that has to
// be kept true by remembering to.
function topColour(path, y) {
  const buf = readFileSync(path);
  let w = 0, h = 0, depth = 0, type = 0, idat = [];
  for (let i = 8; i < buf.length; ) {
    const len = buf.readUInt32BE(i), tag = buf.toString("ascii", i + 4, i + 8);
    if (tag === "IHDR") {
      w = buf.readUInt32BE(i + 8); h = buf.readUInt32BE(i + 12);
      depth = buf[i + 16]; type = buf[i + 17];
    } else if (tag === "IDAT") idat.push(buf.subarray(i + 8, i + 8 + len));
    else if (tag === "IEND") break;
    i += 12 + len;
  }
  // Only the shape Chrome writes. Anything else falls back to the caller's colour.
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[type];
  if (depth !== 8 || !channels) return null;
  const row = Math.min(Math.max(0, y), h - 1);
  const stride = w * channels;
  const raw = zlibSync(Buffer.concat(idat), (row + 1) * (stride + 1));
  // PNG rows are filtered against the row above, so every row up to `row` has
  // to be reconstructed — there is no shortcut to a single line.
  let prev = Buffer.alloc(stride), cur = Buffer.alloc(stride);
  for (let r = 0; r <= row; r++) {
    const f = raw[r * (stride + 1)];
    const src = raw.subarray(r * (stride + 1) + 1, (r + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? cur[x - channels] : 0, b = prev[x];
      const c = x >= channels ? prev[x - channels] : 0;
      let v = src[x];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[x] = v & 0xff;
    }
    [prev, cur] = [cur, prev];
  }
  const x = Math.floor(w / 2) * channels;   // mid-width: never a rounded corner
  const hex = (n) => n.toString(16).padStart(2, "0");
  return channels >= 3 ? `#${hex(prev[x])}${hex(prev[x + 1])}${hex(prev[x + 2])}`
                       : `#${hex(prev[x]).repeat(3)}`;
}
function zlibSync(buf, atLeast) {
  const out = inflateSync(buf);
  return out.length >= atLeast ? out : Buffer.concat([out, Buffer.alloc(atLeast - out.length)]);
}

// ── Pop-out components. Styled to the app: cream/white surfaces, 1px hairline,
//    Geist, blue #2563EB, ink #111. Sized for the device scale.
const dot = `<i class="dot"></i>`;
const readBtn = `<span class="read">Read</span>`;
const notif = (title, sub, ago) => `
<div class="pop card notif">
  ${dot}<div class="body"><b>${title}</b><span>${sub}</span><small>${ago}</small></div>${readBtn}
</div>`;
const stat = (label, value, hint) => `
<div class="pop card stat"><span class="lbl">${label}</span><b>${value}</b>${hint ? `<small>${hint}</small>` : ""}</div>`;
const chip = (html) => `<div class="pop chip">${html}</div>`;
const badge = (t, cls = "") => `<span class="badge ${cls}">${t}</span>`;
const loc = (town, total, card, links) => `
<div class="pop card loc"><div class="row"><b>${town}</b><span><b>${total}</b> views</span></div>
<div class="split">SwiftCard <b>${card}</b> &nbsp;&nbsp; Swift Links <b>${links}</b></div></div>`;
const check = `<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#15803d" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>`;
const pin = `<svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12z"/><circle cx="12" cy="10" r="2.6"/></svg>`;
const arrow = `<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>`;

// The seed's day-0 email is sent at 9:12 on capture day; the raw's mtime is
// that day, so the pop-out date matches the screen on every re-run.
const SENT = statSync(`${RAW}/dashboard.png`).mtime.toLocaleDateString("en-US", { month: "short", day: "numeric" });

// ── Where the pop-outs sit ───────────────────────────────────────────────────
// As in v5: off a SIDE edge at shoulder height, overhanging the phone but never
// the canvas (EDGE is the inset from the frame edge — a card flush to it loses
// its rounded corner and reads as cut off). UPPER sits just under the status
// bar; LOWER is measured from the bottom of the body, so both track GLASS_W.
const EDGE = 34;
const UPPER = TOP + Math.round(BODY_H * 0.135);
const LOWER = TOP + BODY_H - Math.round(BODY_H * 0.30);

// Each frame: the screen crop (src, y), the caption, the status bar, and the
// pop-outs with their position (top/left/right in frame px) and tilt.
const FRAMES = [
  { n: "01", src: "public-card", y: 0, kicker: "Digital business card",
    title: "Your card.\n<em>One link.</em>",
    sub: "Text it, show the QR, or tap an NFC card. Opens anywhere, no app needed.",
    bar: { bg: "#e2e0dd", fg: "#111" },
    pops: [
      { html: notif("Marcus Webb saved your contact", "Webb &amp; Co. · via your link", "1d ago"), at: `top:${LOWER}px; left:${EDGE}px`, rot: -3 },
    ] },
  { n: "02", src: "public-card-shared", y: 850, kicker: "Share back",
    title: "Tap to save.\n<em>They share back.</em>",
    sub: "One tap adds you to their phone. Their details come straight to you.",
    bar: { bg: "#e2e0dd", fg: "#111" },
    pops: [
      { html: notif("Jordan Rivera shared their info", "Rivera Design Co. · via QR code", "3h ago"), at: `top:${UPPER}px; right:${EDGE}px`, rot: 3 },
    ] },
  { n: "03", src: "contacts", y: 0, kicker: "Contacts",
    title: "Every lead,\n<em>in your pocket</em>",
    sub: "Who they are, how they found you, and what to do next.",
    bar: { bg: "#fbf7f1", fg: "#111" },
    pops: [
      { html: chip(`${badge("QR code scan")}${badge("NFC tap")}${badge("Swift Links")}${badge("Swift Signature")}`), at: `top:${UPPER}px; left:50%; transform:translateX(-50%) rotate(-2deg)`, rot: null },
    ] },
  { n: "04", src: "contact-detail", y: 90, kicker: "Contact",
    title: "Who they are,\n<em>where you met</em>",
    sub: "Notes, context and the next step, all in one place.",
    bar: { bg: "#faf7f2", fg: "#111" },
    pops: [
      { html: `<div class="pop card note"><span class="lbl">${pin} Where did you meet?</span><b>Rivera Design Co. studio opening, Pearl District</b></div>`, at: `top:${UPPER}px; right:${EDGE}px`, rot: 2.5 },
    ] },
  { n: "05", src: "contact-detail-automations", y: 0, kicker: "Follow-ups",
    title: "Follow-ups\n<em>write themselves</em>",
    sub: "An email and text sequence written from your notes, sent on schedule.",
    bar: { bg: "#faf7f2", fg: "#111" },
    pops: [
      { html: `<div class="pop card mail"><div class="row"><span>Sent ${SENT}, 9:12 AM</span>${check}</div><b>Subject: Great meeting you</b><span class="txt">Hi Jordan, lovely to meet you today. Here’s my portfolio and the 2026 packages we talked about…</span></div>`, at: `top:${UPPER}px; left:${EDGE}px`, rot: -2.5 },
      { html: chip(`<i class="on"></i><span>On · Medium · 3 emails</span>`), at: `top:${LOWER}px; right:30px`, rot: 3, blue: true },
    ] },
  // Play only: playBarBg. At y 2150 the sampled row is the grey ink of the
  // "At an event? Tag today's contacts" line, which painted a grey status bar
  // (the iOS v7 frame carries the same grey). Use the page's cream instead.
  { n: "06", src: "dashboard", y: 2150, playBarBg: "#fbf7f1", kicker: "Analytics",
    title: "Know who’s\n<em>looking</em>",
    sub: "Views by day, by source, by town. Who came back, and when.",
    bar: { bg: "#fbf7f1", fg: "#111" },
    pops: [
      // Typed from the raw capture of 2026-09-24 (the seed draws fresh numbers
      // every run) — re-read _raw/dashboard.png after each re-capture.
      { html: stat("SwiftCard views · Month", "4,336", "Best day <b>Sep 18</b> · 700"), at: `top:${UPPER}px; left:${EDGE}px`, rot: -3 },
      { html: chip(`${pin}<span>Portland, OR · <b>3,175</b> views</span>`), at: `top:${LOWER}px; right:34px`, rot: 2.5 },
    ] },
  { n: "07", src: "dashboard-locations", y: 2270, kicker: "Locations",
    title: "Which towns\n<em>find you</em>",
    sub: "Every view placed on the map, split between your card and Swift Links.",
    bar: { bg: "#fbf7f1", fg: "#111" },
    pops: [
      { html: loc("Portland, OR", "3,175", "2,531", "644"), at: `top:${UPPER}px; right:${EDGE}px`, rot: 2.5 },
    ] },
  // y=1284, not 0: at the top of the page this frame was her photo and a bio,
  // and the links — the thing it is captioned for — were below the fold, with
  // only the first tile's edge showing. Owner, 2026-09-22: "really show how
  // additional links look in SwiftLinks."
  //
  // 1284 is 22px above the big "Lena Brooks" heading, measured off a render of
  // this page at the capture's own 440x956@3x rather than guessed. From there
  // the 2706px window holds the name, subtitle, bio, socials, Connect, both
  // section headers, the featured tile, the grid PAIR and the compact rows —
  // every shape the page can make, in one screen, with the last row running
  // off the bottom edge the way a scrollable page should.
  // Re-measure if the page's content changes; SRC_VISIBLE is 2706.
  // y re-measured 2026-09-22: the linen links page is 30px shorter than the
  // aura one it replaced, so 1284 ran off the end of the capture (3960) and
  // the last 30px of the frame were blank canvas.
  // Play only: playY 1150. The Play glass shows 35px more capture than iOS, so
  // 1254 runs off the end of the page, and pulling it back to 1219 lands the
  // status bar on the "Lena Brooks" heading (rows ~1175-1235 of the capture),
  // cutting the name in half and sampling the bar colour off its ink. 1150 is
  // 25px above the heading, and the page still ends past the glass (3891/3960).
  { n: "08", src: "swift-links", y: 1254, playY: 1150, kicker: "Swift Links",
    title: "All your links,\n<em>one page</em>",
    sub: "Photo, bio, socials, portfolio and booking at your own link.",
    // The crop now starts on the cream sheet, not the photo, so a white
    // overlay bar would be invisible. Linen's sheet colour, dark glyphs.
    bar: { bg: "#FBF7F0", fg: "#111" },
    pops: [
      { html: `<div class="pop card link"><span class="emoji">🎬</span><b>Watch the 2026 wedding reel</b>${arrow}</div>`, at: `top:${LOWER}px; left:${EDGE}px`, rot: -2.5 },
    ] },
  // y=0 on both of these: the captures are exactly one viewport tall (2868), so
  // now that the glass shows a whole viewport there is nothing to scroll past.
  // v4 offset them by 200 / 610 to fill a shorter window.
  { n: "09", src: "signature", y: 0, kicker: "Swift Signature",
    title: "Your card in\n<em>every email</em>",
    sub: "A live card under every message you send. Paste it once.",
    // Dark glyphs since 2026-09-22: the sheet no longer dims the app behind it,
    // so this bar sits on the cream header like frames 01-08, and white glyphs
    // vanished into it.
    bar: { bg: "#fbf7f1", fg: "#111" },
    pops: [
      { html: chip(`${check}<span>Signature copied</span>`), at: `top:${UPPER}px; right:${EDGE}px`, rot: 3, big: true },
    ] },
];

// Frames of the iOS set that are NOT in the Play set, and why. Printed on every
// run so the gap is never silent.
const DROPPED = [
  { n: "10", src: "ways-to-share", why: 'headline "QR, NFC and Apple Wallet" and an "Add to Apple Wallet" pop-out — iOS-only' },
];

// Android status bar: time on the left; wifi, cell signal and a vertical
// battery (Material shapes) on the right. Nothing iOS-shaped.
const statusBar = (bar, bg) => `
<div class="bar" style="color:${bar.fg}; ${bar.overlay ? "" : `background:${bg};`}">
  <span class="time">9:30</span>
  <span class="right">
    <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 20.5 1.2 8.1C4.2 5.5 8 4 12 4s7.8 1.5 10.8 4.1z"/></svg>
    <svg viewBox="0 0 24 24" fill="currentColor"><path d="M2 21.5h19.5V2z"/></svg>
    <svg viewBox="0 0 24 24" fill="currentColor"><path d="M15.7 4H14V2h-4v2H8.3C7.6 4 7 4.6 7 5.3v15.4c0 .7.6 1.3 1.3 1.3h7.4c.7 0 1.3-.6 1.3-1.3V5.3C17 4.6 16.4 4 15.7 4z"/></svg>
  </span>
</div>`;

const NOISE = `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='300' height='300'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 .55 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>")`;

const popStyle = (p) => {
  const rot = p.rot == null ? "" : `transform: rotate(${p.rot}deg);`;
  return `${p.at}; ${rot}`;
};

// The charset is declared, not sniffed: a frame with only a curly apostrophe
// and a middot in it (06) got guessed as windows-1252 and rendered "whoâ€™s".
const page = (f, srcH) => `<!doctype html><meta charset="utf-8"><style>
  @import url('https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700;800;900&family=Roboto:wght@500&display=swap');
  * { margin: 0; box-sizing: border-box; }
  body {
    width: ${W}px; height: ${H}px; overflow: hidden; position: relative;
    background:
      linear-gradient(118deg, rgba(255,255,255,.10) 0%, rgba(255,255,255,0) 38%),
      radial-gradient(58% 26% at 50% 40%, rgba(77,168,245,.55) 0%, rgba(77,168,245,0) 100%),
      radial-gradient(140% 80% at 50% -20%, #2563EB 0%, #1740B5 34%, #0E2470 62%, #050B24 100%);
    font-family: Geist, -apple-system, system-ui, sans-serif;
    display: flex; flex-direction: column; align-items: center; padding: 80px 70px 0;
  }
  body::before { content: ""; position: absolute; inset: 0; background: ${NOISE};
    opacity: .085; mix-blend-mode: overlay; pointer-events: none; z-index: 1; }
  .kicker {
    color: #fff; font-size: 27px; font-weight: 700; letter-spacing: .16em;
    text-transform: uppercase; padding: 14px 28px; border-radius: 999px;
    background: rgba(255,255,255,.12); border: 2px solid rgba(255,255,255,.26);
    margin-bottom: 32px; position: relative; z-index: 2;
  }
  h1 { color: #fff; font-size: 122px; line-height: .98; font-weight: 800;
       letter-spacing: -.045em; text-align: center; white-space: pre-line; position: relative; z-index: 2;
       text-shadow: 0 6px 40px rgba(0,0,0,.25); }
  h1 em { font-style: normal; color: #9DD0FF; }
  p  { color: rgba(255,255,255,.80); font-size: 39px; line-height: 1.3; font-weight: 500;
       text-align: center; margin-top: 26px; max-width: 940px; letter-spacing: -.012em; position: relative; z-index: 2; }

  /* ── The phone: a generic Android slab ─────────────────────────────────
     A dark frame edge, then a thin uniform black bezel, then the glass. No
     metal rail, no side buttons, no island. */
  .phone { position: absolute; top: ${TOP}px; left: ${(W - BODY_W) / 2}px;
       width: ${BODY_W}px; height: ${BODY_H}px; border-radius: ${R_BODY}px;
       padding: ${EDGE_RING}px; z-index: 3;
       background: linear-gradient(180deg, #3a3c42, #1c1d21 50%, #2c2e33);
       box-shadow:
         0 -20px 120px -20px rgba(0,0,0,.55),
         0 70px 150px -40px rgba(0,0,0,.85),
         0 24px 60px -24px rgba(0,0,0,.7),
         0 0 0 1px rgba(255,255,255,.14);
  }
  .phone::after { content: ""; position: absolute; left: 8%; right: 8%;
       bottom: -34px; height: 70px; border-radius: 50%; z-index: -1;
       background: radial-gradient(50% 50% at 50% 50%, rgba(0,0,0,.55), rgba(0,0,0,0) 70%); }
  .bezel { width: 100%; height: 100%; border-radius: ${R_BODY - EDGE_RING}px;
       padding: ${BEZEL}px; background: #050507;
       box-shadow: inset 0 0 0 1px rgba(255,255,255,.04); }
  .screen { width: 100%; height: 100%; border-radius: ${R_GLASS}px;
       overflow: hidden; position: relative; background: ${f.barBg || "#000"}; }
  .screen img { position: absolute; left: 0; top: ${(f.bar.overlay ? 0 : BAR) - f.y * scale}px;
       width: ${GLASS_W}px; height: ${srcH * scale}px; display: block; }

  /* Android status bar: 40dp with the punch-hole centred in it. */
  .bar { position: absolute; top: 0; left: 0; right: 0; height: ${BAR}px; z-index: 2;
       display: flex; align-items: center; justify-content: space-between;
       padding: 0 ${Math.round(24 * DP)}px 0 ${Math.round(26 * DP)}px;
       font-family: Roboto, system-ui, sans-serif; font-weight: 500;
       font-size: ${Math.round(14.5 * DP)}px; letter-spacing: .01em; }
  .bar .right { display: flex; align-items: center; gap: ${Math.round(4 * DP)}px; }
  .bar svg { width: ${Math.round(17 * DP)}px; height: ${Math.round(17 * DP)}px; display: block; }

  /* Punch-hole camera: small, round, centred in the status bar. */
  .hole { position: absolute; top: ${Math.round((BAR - HOLE) / 2)}px; left: 50%; transform: translateX(-50%);
       width: ${HOLE}px; height: ${HOLE}px; border-radius: 50%; z-index: 6;
       background: radial-gradient(circle at 38% 34%, #26303c, #07090c 62%);
       box-shadow: 0 0 0 ${Math.round(1.2 * DP)}px #000, inset 0 0 0 1px rgba(120,160,220,.16); }

  /* Gesture navigation handle. */
  .home { position: absolute; bottom: ${HOME_BOTTOM}px; left: 50%; transform: translateX(-50%);
       width: ${HOME_W}px; height: ${HOME_H}px; border-radius: ${HOME_H}px; z-index: 4;
       background: ${f.bar.fg === "#fff" ? "rgba(255,255,255,.62)" : "rgba(0,0,0,.38)"}; }

  .glare { position: absolute; inset: 0; z-index: 3; pointer-events: none;
       background: linear-gradient(122deg,
         rgba(255,255,255,.14) 0%, rgba(255,255,255,.06) 15%,
         rgba(255,255,255,.02) 27%, rgba(255,255,255,0) 38%); }

  /* pop-outs */
  .pop { position: absolute; z-index: 5; font-family: Geist, -apple-system, system-ui, sans-serif;
       color: #111; letter-spacing: -.01em; }
  .card { background: #fff; border: 2px solid rgba(17,24,39,.08); border-radius: 34px;
       box-shadow: 0 50px 90px -20px rgba(0,0,0,.65), 0 20px 40px -20px rgba(0,0,0,.5), 0 0 0 1px rgba(255,255,255,.35); }
  .notif { display: flex; align-items: flex-start; gap: 22px; padding: 34px 36px 34px 40px; width: 1000px; }
  .notif .dot { width: 20px; height: 20px; border-radius: 50%; background: #2563EB; margin-top: 16px; flex: none; }
  .notif .body { flex: 1; display: flex; flex-direction: column; gap: 6px; }
  .notif b { font-size: 42px; font-weight: 700; letter-spacing: -.02em; }
  .notif span { font-size: 34px; color: #4b5563; font-weight: 500; }
  .notif small { font-size: 30px; color: #9ca3af; font-weight: 500; margin-top: 4px; }
  .read { flex: none; margin-top: 6px; padding: 16px 30px; border-radius: 22px; font-size: 32px; font-weight: 600;
       color: #2563EB; background: #DBEAFE; border: 2px solid #BFDBFE; }
  .stat { padding: 40px 56px 40px; width: 720px; display: flex; flex-direction: column; gap: 4px;
       background: linear-gradient(180deg, #fff, #f3ece2); }
  .stat .lbl { font-size: 32px; color: #6b7280; font-weight: 600; }
  .stat > b { font-size: 108px; font-weight: 800; letter-spacing: -.04em; line-height: 1.02; }
  .stat small { font-size: 30px; color: #6b7280; font-weight: 500; }
  .stat small b { color: #111; font-weight: 700; }
  .chip { display: flex; align-items: center; gap: 20px; padding: 26px 40px; border-radius: 999px;
       background: #fff; font-size: 38px; font-weight: 600; color: #111;
       box-shadow: 0 40px 80px -20px rgba(0,0,0,.6), 0 0 0 2px rgba(255,255,255,.4); }
  .chip.big { font-size: 44px; padding: 32px 52px; }
  .chip.dark { background: #111; color: #fff; }
  .chip.blue { background: #2563EB; color: #fff; }
  .chip b { font-weight: 800; }
  .chip .on { width: 22px; height: 22px; border-radius: 50%; background: #4ADE80; }
  .badge { display: inline-block; padding: 16px 28px; border-radius: 999px; background: #EFF6FF;
       color: #1D4ED8; font-size: 30px; font-weight: 700; border: 2px solid #DBEAFE;
       /* Without this the four source badges wrap to three lines EACH and the
          chip becomes an unreadable block — v4 shipped that way. */
       white-space: nowrap; }
  .chip { white-space: nowrap; }
  .loc { width: 860px; padding: 38px 46px; display: flex; flex-direction: column; gap: 14px; }
  .loc .row { display: flex; justify-content: space-between; align-items: baseline; }
  .loc .row b { font-size: 46px; font-weight: 700; letter-spacing: -.02em; }
  .loc .row span { font-size: 34px; color: #4b5563; font-weight: 500; }
  .loc .row span b { font-size: 40px; color: #111; }
  .loc .split { font-size: 32px; color: #6b7280; font-weight: 500; }
  .loc .split b { color: #111; font-weight: 700; }
  .note { width: 980px; padding: 36px 44px; display: flex; flex-direction: column; gap: 14px; }
  .note .lbl { display: flex; align-items: center; gap: 12px; font-size: 32px; color: #4b5563; font-weight: 600; }
  .note > b { font-size: 40px; font-weight: 600; line-height: 1.25; letter-spacing: -.02em; }
  .mail { width: 940px; padding: 36px 44px; background: #F5EFE6; display: flex; flex-direction: column; gap: 10px; }
  .mail .row { display: flex; justify-content: space-between; align-items: center; font-size: 30px; color: #4b5563; font-weight: 600; }
  .mail > b { font-size: 38px; font-weight: 700; letter-spacing: -.02em; }
  .mail .txt { font-size: 32px; color: #374151; font-weight: 500; line-height: 1.35; }
  .link { width: 900px; padding: 30px 40px; display: flex; align-items: center; gap: 24px; color: #6b7280; }
  .link .emoji { width: 88px; height: 88px; border-radius: 24px; background: #F3F4F6; display: flex; align-items: center;
       justify-content: center; font-size: 46px; flex: none; }
  .link b { flex: 1; font-size: 40px; font-weight: 700; color: #111; letter-spacing: -.02em; }
</style>
<div class="kicker">${f.kicker}</div>
<h1>${f.title}</h1>
<p>${f.sub}</p>
<div class="phone">
  <div class="bezel"><div class="screen">
    <img src="file://${process.cwd()}/${RAW}/${f.src}.png">
    ${statusBar(f.bar, f.barBg)}
    <div class="glare"></div>
    <div class="home"></div>
    <div class="hole"></div>
  </div></div>
</div>
${f.pops.map((p) => p.html
  .replace('class="pop chip"', `class="pop chip${p.dark ? " dark" : ""}${p.blue ? " blue" : ""}${p.big ? " big" : ""}"`)
  .replace(/class="pop ([^"]*)"/, (_m, c) => `class="pop ${c}" style="${popStyle(p)}"`)).join("\n")}`;

console.log(`device: glass ${GLASS_W}x${GLASS_H}, body ${BODY_W}x${BODY_H}, bezel ${BEZEL}px, status bar ${BAR}px`);
console.log(`        top ${TOP}, bottom gap ${BOTTOM_GAP}, shows ${SRC_VISIBLE} of ${SRC_H} capture px; output ${OUT_W}x${OUT_H}`);
if (BOTTOM_GAP < 0) console.error("  ! the device runs off the canvas — reduce GLASS_W or TOP");
for (const d of DROPPED) console.log(`   dropped ${d.n}-${d.src}: ${d.why}`);

const pngSize = (p) => { const b = readFileSync(p); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };

let bad = 0;
for (const f of FRAMES) {
  if (ONLY && !ONLY.includes(f.n)) continue;
  const srcH = pngHeight(`${RAW}/${f.src}.png`);
  if (f.playY != null) f.y = f.playY;
  // The Play glass shows a few more capture px than the iOS one (a shorter
  // status bar), so a v5 scroll offset can run off the end of a capture. Pull
  // it back to the last full viewport rather than showing blank canvas.
  if (f.y + SRC_VISIBLE > srcH) {
    const y = Math.max(0, srcH - SRC_VISIBLE);
    console.log(`   ${f.n} y ${f.y} → ${y} (would run ${f.y + SRC_VISIBLE - srcH}px past ${f.src})`);
    f.y = y;
    if (f.y + SRC_VISIBLE > srcH) { console.error(`  ! ${f.n}: ${f.src} is shorter than one viewport`); bad++; }
  }
  f.barBg = f.bar.overlay ? null : f.playBarBg ?? (topColour(`${RAW}/${f.src}.png`, f.y + 8) ?? f.bar.bg);
  if (!f.bar.overlay && f.barBg !== f.bar.bg) console.log(`   ${f.n} bar ${f.bar.bg} → ${f.barBg} (measured)`);
  const file = `${f.n}-${f.src}.png`;
  const html = `${OUT}/_${file}.html`;
  writeFileSync(html, page(f, srcH));
  execFileSync(CHROME, ["--headless=new", "--disable-gpu", "--hide-scrollbars",
    `--force-device-scale-factor=${DSF}`,
    `--window-size=${W},${H}`, "--virtual-time-budget=10000",
    `--screenshot=${OUT}/${file}`, `file://${process.cwd()}/${html}`], { stdio: "ignore" });
  unlinkSync(html);
  // Chrome can land a pixel off at a fractional scale factor; force the exact size.
  const [w, h] = pngSize(`${OUT}/${file}`);
  if (w !== OUT_W || h !== OUT_H) {
    execFileSync("sips", ["-z", String(OUT_H), String(OUT_W), `${OUT}/${file}`], { stdio: "ignore" });
    console.log(`   ${file}: ${w}x${h} → ${OUT_W}x${OUT_H} (resized)`);
  }
  console.log("rendered", file);
}
console.log(bad ? `${bad} frame(s) cannot fill the glass` : "all frames fit their source");
