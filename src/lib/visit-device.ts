// ── What a visit's own request says about the phone it came from ─────────────
//
// Owner, 2026-10-18: analytics "as pinpoint as possible" — every open should
// say what it was opened on and where it came from. This file turns the
// strings a browser volunteers on EVERY request (its User-Agent, the page that
// linked to it, and on Chromium the model it reports through Client Hints)
// into the words an owner reads: "iPhone 16 Pro · iOS 27", "Instagram",
// "from LinkedIn".
//
// THE RULE, SAME AS LOCATIONS: NEVER INVENT PRECISION. Each of these facts is
// only as good as the string it came from, and several of those strings lie on
// purpose:
//
//   • Safari and the in-app WebView FREEZE the iOS version. iOS 26 and 27 both
//     send "CPU iPhone OS 18_7" (production rows, 2026-10). The real major
//     rides in Safari's "Version/27.0.1", or in Instagram's / Facebook's own
//     token, and when neither is there the version is simply not said.
//   • Plain Safari never says WHICH iPhone. Instagram and Facebook's built-in
//     browsers do ("iPhone19,2"), and Apple's code is mapped to the name only
//     when it is in the table below — an unknown code is "iPhone", never a
//     guess at next year's name.
//   • Chrome on Android reduces its User-Agent to "Android 10; K": the model
//     and version are gone. They come back only from the page's Client Hints
//     (CardEventTracker sends them), and a Samsung reports a CODE ("SM-S921U"),
//     named here only when the code is known.
//   • An iPad in Safari says it is a Mac. The tracker sees the touch screen
//     and reports the model as "iPad".
//   • macOS and Windows freeze their versions too, so a computer is "Mac" or
//     "Windows PC" and nothing more.
//
// Nothing here identifies a PERSON: these are the same few words any website's
// server log holds for every visit, and the raw User-Agent was already stored
// on card_events.device_info. This only reads it properly.

export type VisitDevice = {
  /** "iPhone 16 Pro · iOS 27", "Samsung Galaxy S24 · Android 15", "Mac". */
  label: string;
  /** The device on its own, for a sentence: "iPhone 16 Pro", "Mac". */
  name: string;
  /** "a" / "an" — "on an iPhone", "on a Mac". */
  article: "a" | "an";
};

/** The optional Client Hints the tracker adds (Chromium only), already bounded. */
/** An iPad in desktop-mode Safari is reported as model "iPad" by the tracker
 *  (a Mac UA with a touch screen). */
export type DeviceHint = { model?: string | null; os?: string | null };

/** A value the client sent, kept only if it looks like a device model string. */
export function cleanModelHint(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return /^[A-Za-z0-9][A-Za-z0-9 ,._()+-]{0,39}$/.test(s) ? s : null;
}

/** An OS version hint ("15", "14.0.0"), kept only if it is one. */
export function cleanOsHint(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return /^\d{1,2}(\.\d{1,3}){0,2}$/.test(s) ? s : null;
}

// Apple's own codes → names. Only codes confirmed against Apple's hardware list
// (and, for iPhone19,x, against the screen sizes Instagram reports with them in
// production: 19,2 → 1206×2622, the Pro; 19,3 → 1320×2868, the Pro Max).
const IPHONE_MODELS: Record<string, string> = {
  "iPhone10,1": "iPhone 8", "iPhone10,4": "iPhone 8",
  "iPhone10,2": "iPhone 8 Plus", "iPhone10,5": "iPhone 8 Plus",
  "iPhone10,3": "iPhone X", "iPhone10,6": "iPhone X",
  "iPhone11,2": "iPhone XS", "iPhone11,4": "iPhone XS Max", "iPhone11,6": "iPhone XS Max", "iPhone11,8": "iPhone XR",
  "iPhone12,1": "iPhone 11", "iPhone12,3": "iPhone 11 Pro", "iPhone12,5": "iPhone 11 Pro Max", "iPhone12,8": "iPhone SE",
  "iPhone13,1": "iPhone 12 mini", "iPhone13,2": "iPhone 12", "iPhone13,3": "iPhone 12 Pro", "iPhone13,4": "iPhone 12 Pro Max",
  "iPhone14,4": "iPhone 13 mini", "iPhone14,5": "iPhone 13", "iPhone14,2": "iPhone 13 Pro", "iPhone14,3": "iPhone 13 Pro Max",
  "iPhone14,6": "iPhone SE",
  "iPhone14,7": "iPhone 14", "iPhone14,8": "iPhone 14 Plus", "iPhone15,2": "iPhone 14 Pro", "iPhone15,3": "iPhone 14 Pro Max",
  "iPhone15,4": "iPhone 15", "iPhone15,5": "iPhone 15 Plus", "iPhone16,1": "iPhone 15 Pro", "iPhone16,2": "iPhone 15 Pro Max",
  "iPhone17,3": "iPhone 16", "iPhone17,4": "iPhone 16 Plus", "iPhone17,1": "iPhone 16 Pro", "iPhone17,2": "iPhone 16 Pro Max",
  "iPhone17,5": "iPhone 16e",
  "iPhone18,3": "iPhone 17", "iPhone18,4": "iPhone Air", "iPhone18,1": "iPhone 17 Pro", "iPhone18,2": "iPhone 17 Pro Max",
  "iPhone18,5": "iPhone 17e",
  "iPhone19,2": "iPhone 18 Pro", "iPhone19,3": "iPhone 18 Pro Max", "iPhone19,7": "iPhone 18 Pro Max",
};

// Samsung reports a model CODE. The letters after the number are the region
// ("U" US, "B" global…), so only the stem is matched. Unknown stem → "Samsung
// Galaxy": the brand is certain, the model is not.
const SAMSUNG_STEMS: readonly (readonly [string, string])[] = [
  ["S931", "Galaxy S25"], ["S936", "Galaxy S25+"], ["S938", "Galaxy S25 Ultra"], ["S937", "Galaxy S25 Edge"],
  ["S921", "Galaxy S24"], ["S926", "Galaxy S24+"], ["S928", "Galaxy S24 Ultra"], ["S721", "Galaxy S24 FE"],
  ["S911", "Galaxy S23"], ["S916", "Galaxy S23+"], ["S918", "Galaxy S23 Ultra"], ["S711", "Galaxy S23 FE"],
  ["S901", "Galaxy S22"], ["S906", "Galaxy S22+"], ["S908", "Galaxy S22 Ultra"],
  ["G991", "Galaxy S21"], ["G996", "Galaxy S21+"], ["G998", "Galaxy S21 Ultra"], ["G990", "Galaxy S21 FE"],
  ["G981", "Galaxy S20"], ["G986", "Galaxy S20+"], ["G988", "Galaxy S20 Ultra"],
  ["F966", "Galaxy Z Fold7"], ["F766", "Galaxy Z Flip7"], ["F956", "Galaxy Z Fold6"], ["F741", "Galaxy Z Flip6"],
  ["F946", "Galaxy Z Fold5"], ["F731", "Galaxy Z Flip5"], ["F936", "Galaxy Z Fold4"], ["F721", "Galaxy Z Flip4"],
  ["A566", "Galaxy A56"], ["A366", "Galaxy A36"], ["A166", "Galaxy A16 5G"], ["A556", "Galaxy A55"], ["A356", "Galaxy A35"],
  ["A256", "Galaxy A25"], ["A156", "Galaxy A15 5G"], ["A155", "Galaxy A15"], ["A546", "Galaxy A54"], ["A146", "Galaxy A14 5G"],
  ["A145", "Galaxy A14"], ["A536", "Galaxy A53"],
];
const SAMSUNG_MODELS: [RegExp, string][] = SAMSUNG_STEMS.map(([stem, name]) => [new RegExp(`^SM-${stem}`, "i"), `Samsung ${name}`]);

/** Android model string → a name a person recognises, or null if it is only a code. */
function androidModelName(model: string | null): string | null {
  const m = (model ?? "").trim();
  if (!m || m === "K") return null; // "K" is Chrome's reduced-UA placeholder
  if (/^SM-/i.test(m)) {
    for (const [re, name] of SAMSUNG_MODELS) if (re.test(m)) return name;
    return "Samsung Galaxy";
  }
  if (/^Pixel\b/i.test(m)) return m.replace(/^pixel/i, "Pixel");
  // Marketing names that phones report as-is ("moto g play - 2023",
  // "OnePlus 12", "Redmi Note 13"). Bare codes ("CPH2449", "2201117TG") are
  // not names, and are not shown.
  if (/^(moto|motorola|oneplus|redmi|xiaomi|poco|nokia|nothing|galaxy|google|razr)\b/i.test(m)) return m;
  return null;
}

/** The iOS major version, only when something other than the frozen token says it. */
function iosVersion(ua: string): string | null {
  // Instagram: "(iPhone19,2; iOS 27_0; …"   Facebook: "FBSV/27.0"
  const own = /;\s*iOS (\d{2})[_.]/.exec(ua) ?? /FBSV\/(\d{2})\./.exec(ua);
  if (own) return own[1];
  const token = /(?:iPhone|CPU) OS (\d{1,2})_(\d{1,2})/.exec(ua);
  // Safari's own version tracks the OS release, and is NOT frozen.
  const safari = /\bVersion\/(\d{2})(?:\.\d+)*\b.*Safari/.exec(ua);
  if (safari && Number(safari[1]) >= 26) return safari[1];
  if (!token) return safari ? safari[1] : null;
  const [major, minor] = [Number(token[1]), Number(token[2])];
  // 18.6 / 18.7 with no other evidence is the FROZEN value newer iOS sends.
  if (major === 18 && minor >= 6) return null;
  return String(major);
}

/** The device a visit came from. Null when there is no User-Agent at all. */
export function describeDevice(userAgent: string | null | undefined, hint: DeviceHint = {}): VisitDevice | null {
  const ua = (userAgent ?? "").trim();
  if (!ua) return null;

  const make = (name: string, os: string | null, article: "a" | "an"): VisitDevice => ({
    name,
    article,
    label: os ? `${name} · ${os}` : name,
  });

  if (/iPhone/.test(ua)) {
    const code = /\b(iPhone\d{1,2},\d{1,2})\b/.exec(ua)?.[1];
    const name = (code && IPHONE_MODELS[code]) || "iPhone";
    const v = iosVersion(ua);
    return make(name, v ? `iOS ${v}` : null, "an");
  }
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && hint.model === "iPad")) {
    const v = /iPad/.test(ua) ? iosVersion(ua) : null;
    return make("iPad", v ? `iPadOS ${v}` : null, "an");
  }
  if (/Android/.test(ua)) {
    const uaModel = /Android [\d.]+;\s*(?:[a-z]{2}[-_][a-z]{2};\s*)?([^;)]+?)(?:\s+Build\/[^;)]*)?[;)]/i.exec(ua)?.[1] ?? null;
    const name = androidModelName(hint.model ?? null) ?? androidModelName(uaModel);
    // The reduced UA always says "Android 10": only a hint, or a UA that still
    // names a real model (so was not reduced), carries the real version.
    const uaVersion = uaModel && uaModel !== "K" ? /Android (\d{1,2})/.exec(ua)?.[1] ?? null : null;
    const version = hint.os ? hint.os.split(".")[0] : uaVersion;
    const os = version ? `Android ${version}` : null;
    const tablet = !/Mobile/.test(ua);
    const fallback = tablet ? "Android tablet" : "Android phone";
    const shown = name ?? fallback;
    return make(shown, os, /^[aeiou]/i.test(shown) ? "an" : "a");
  }
  if (/CrOS/.test(ua)) return make("Chromebook", null, "a");
  if (/Macintosh|Mac OS X/.test(ua)) return make("Mac", null, "a");
  if (/Windows/.test(ua)) return make("Windows PC", null, "a");
  if (/Linux/.test(ua)) return make("Linux computer", null, "a");
  return null;
}

// ── Which app or browser it was opened in ───────────────────────────────────
//
// An in-app browser names its app in the User-Agent, and that is the most
// useful thing to know about a visit: "opened in Instagram" says where the
// link was tapped. Checked first, most specific first — Messenger carries the
// Facebook tokens, so it has to be tried before Facebook.
const IN_APP: [RegExp, string][] = [
  [/\bInstagram\b/, "Instagram"],
  [/Messenger|Orca-Android/, "Messenger"],
  [/\bFBAN\b|\bFBAV\b|\bFB_IAB\b/, "Facebook"],
  [/\bBarcelona\b/, "Threads"],
  [/LinkedInApp/, "LinkedIn"],
  [/musical_ly|BytedanceWebview|\bTikTok\b|\btrill\b/, "TikTok"],
  [/\bSnapchat\b/, "Snapchat"],
  [/\bPinterest\b/, "Pinterest"],
  [/TwitterAndroid|\bTwitter for/, "X"],
  [/MicroMessenger/, "WeChat"],
  [/\bLine\//, "LINE"],
  [/KAKAOTALK/i, "KakaoTalk"],
  [/\bGSA\//, "Google app"],
];

const BROWSERS: [RegExp, string][] = [
  [/\bEdg(?:e|iOS|A)?\//, "Edge"],
  [/\bOPR\/|\bOPiOS\//, "Opera"],
  [/SamsungBrowser/, "Samsung Internet"],
  [/\bDdg\/|DuckDuckGo/, "DuckDuckGo"],
  [/\bFxiOS\/|\bFirefox\//, "Firefox"],
  [/\bCriOS\/|\bChrome\//, "Chrome"],
  [/\bVersion\/[\d.]+.*Safari\//, "Safari"],
];

export type OpenedIn = { name: string; inApp: boolean };

/** The app (if a built-in browser) or browser the visit was opened in. */
export function openedIn(userAgent: string | null | undefined): OpenedIn | null {
  const ua = (userAgent ?? "").trim();
  if (!ua) return null;
  for (const [re, name] of IN_APP) if (re.test(ua)) return { name, inApp: true };
  // An Android WebView ("; wv)") with no app we recognise: some app's own
  // browser — saying "Chrome" there would be wrong.
  if (/;\s*wv\)/.test(ua)) return { name: "an app's built-in browser", inApp: true };
  for (const [re, name] of BROWSERS) if (re.test(ua)) return { name, inApp: false };
  return null;
}

// ── Where the link was tapped ────────────────────────────────────────────────
//
// document.referrer, reduced to origin+path by the ingest route. Most taps in
// an app or a text message send none at all, which is honest silence, not
// "direct". Known link shims (l.instagram.com, lnkd.in, t.co) are named for the
// service, not the shim.
const REFERRERS: [RegExp, string][] = [
  [/(^|\.)linkedin\.com$|^lnkd\.in$/, "LinkedIn"],
  [/(^|\.)instagram\.com$/, "Instagram"],
  [/(^|\.)facebook\.com$|^fb\.me$|(^|\.)messenger\.com$/, "Facebook"],
  [/^t\.co$|(^|\.)x\.com$|(^|\.)twitter\.com$/, "X"],
  [/(^|\.)threads\.(net|com)$/, "Threads"],
  [/(^|\.)tiktok\.com$/, "TikTok"],
  [/(^|\.)youtube\.com$|^youtu\.be$/, "YouTube"],
  [/(^|\.)reddit\.com$/, "Reddit"],
  [/(^|\.)pinterest\.[a-z.]+$/, "Pinterest"],
  [/(^|\.)snapchat\.com$/, "Snapchat"],
  [/^mail\.google\.com$/, "Gmail"],
  [/^(outlook\.(live|office|office365)\.com)$/, "Outlook"],
  [/^mail\.yahoo\.com$/, "Yahoo Mail"],
  [/(^|\.)google\.[a-z.]+$/, "Google"],
  [/(^|\.)bing\.com$/, "Bing"],
  [/(^|\.)duckduckgo\.com$/, "DuckDuckGo"],
  [/(^|\.)whatsapp\.com$/, "WhatsApp"],
];

/**
 * The site the link was tapped on, or null. Our own pages are not a "from":
 * the card → Swift Links hop is the owner's own page, and saying "from
 * swiftcard.me" would read as if someone else had linked it.
 */
export function referrerName(referrerUrl: string | null | undefined, ownHosts: string[] = ["swiftcard.me"]): string | null {
  const raw = (referrerUrl ?? "").trim();
  if (!raw) return null;
  let host: string;
  try {
    host = new URL(raw).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
  if (!host || ownHosts.some((h) => host === h || host.endsWith(`.${h}`)) || host === "localhost") return null;
  for (const [re, name] of REFERRERS) if (re.test(host)) return name;
  return host.slice(0, 60);
}

/**
 * The short device phrase a notification carries: " on an iPhone 16 Pro via
 * Instagram". Leading space included, "" when nothing is known. The browser is
 * named only when it is an app's: "via Safari" is noise, "via Instagram" is
 * news.
 */
export function deviceSentence(device: VisitDevice | null, app: OpenedIn | null): string {
  const on = device ? ` on ${device.article} ${device.name}` : "";
  const via = app?.inApp && app.name !== "an app's built-in browser" ? ` via ${app.name}` : "";
  return `${on}${via}`;
}

/**
 * The same visit details as STRUCTURED fields, for the owner's Zapier events
 * (lib/crm-events — a Pro feature, gated there). A Zap can map "device" into a
 * CRM field; it cannot pull it back out of a sentence. Absent → omitted, never
 * a placeholder.
 */
export function visitDetailFields(
  userAgent: string | null | undefined,
  hint: DeviceHint = {},
  referrerUrl?: string | null,
): { device?: string; opened_in?: string; came_from?: string } {
  const device = describeDevice(userAgent, hint)?.label;
  const app = openedIn(userAgent)?.name;
  const from = referrerName(referrerUrl);
  return {
    ...(device ? { device } : {}),
    ...(app ? { opened_in: app } : {}),
    ...(from ? { came_from: from } : {}),
  };
}

/** "1m 40s", "25s", "30m+" — the time a visit stayed on screen. */
export function formatDuration(seconds: number | null | undefined): string | null {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return null;
  const s = Math.round(seconds);
  if (s >= MAX_DURATION_S) return "30m+";
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return r ? `${m}m ${r}s` : `${m}m`;
}

/** The longest stay recorded. Past this a tab left open is not a person reading. */
export const MAX_DURATION_S = 30 * 60;
