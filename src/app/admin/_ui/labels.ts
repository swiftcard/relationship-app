// ── Plain names for what the website records ──────────────────────────────
// site_pageviews stores a path ("/pricing"), a referrer HOST ("l.instagram.com")
// and a country CODE ("US"). The Website page shows them the way a person
// says them: "Pricing", "Instagram", "United States".

const PAGE_NAMES: Record<string, string> = {
  "/": "Home",
  "/pricing": "Pricing",
  "/teams": "Teams",
  "/office": "Office",
  "/features": "Features",
  "/download": "Download the app",
  "/faq": "FAQ",
  "/about": "About",
  "/company": "Company",
  "/contact": "Contact",
  "/blog": "Blog",
  "/compare": "Compare",
  "/preview": "Card preview",
  "/cards/new": "Card builder",
  "/login": "Sign in",
  "/signup": "Sign up",
  "/privacy": "Privacy policy",
  "/terms": "Terms",
};

/** "Pricing" for "/pricing"; a readable fallback for anything unnamed. */
export function pageName(path: string): string {
  const clean = (path || "/").split("?")[0].replace(/\/+$/, "") || "/";
  if (PAGE_NAMES[clean]) return PAGE_NAMES[clean];
  if (clean.startsWith("/blog/")) return "Blog post";
  if (clean.startsWith("/compare/")) return `Compare: ${clean.slice(9).replace(/-/g, " ")}`;
  const last = clean.split("/").filter(Boolean).pop() ?? clean;
  const words = last.replace(/[-_]+/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

// Longest-suffix match on the host, so "l.instagram.com", "m.facebook.com"
// and "www.google.co.uk" all land on the name people know.
const REFERRERS: [RegExp, string][] = [
  [/(^|\.)mail\.google\.com$/, "Gmail"],
  [/(^|\.)google\.[a-z.]+$/, "Google"],
  [/(^|\.)bing\.com$/, "Bing"],
  [/(^|\.)duckduckgo\.com$/, "DuckDuckGo"],
  [/(^|\.)yahoo\.[a-z.]+$/, "Yahoo"],
  [/(^|\.)(chatgpt\.com|openai\.com)$/, "ChatGPT"],
  [/(^|\.)perplexity\.ai$/, "Perplexity"],
  [/(^|\.)claude\.ai$/, "Claude"],
  [/(^|\.)instagram\.com$/, "Instagram"],
  [/(^|\.)(facebook\.com|fb\.com|fb\.me)$/, "Facebook"],
  [/(^|\.)(t\.co|twitter\.com|x\.com)$/, "X (Twitter)"],
  [/(^|\.)(linkedin\.com|lnkd\.in)$/, "LinkedIn"],
  [/(^|\.)tiktok\.com$/, "TikTok"],
  [/(^|\.)(youtube\.com|youtu\.be)$/, "YouTube"],
  [/(^|\.)reddit\.com$/, "Reddit"],
  [/(^|\.)pinterest\.[a-z.]+$/, "Pinterest"],
  [/(^|\.)bsky\.app$/, "Bluesky"],
  [/(^|\.)threads\.net$/, "Threads"],
  [/(^|\.)apps\.apple\.com$/, "App Store"],
  [/(^|\.)producthunt\.com$/, "Product Hunt"],
  [/(^|\.)swiftcard\.me$/, "SwiftCard (another page)"],
  // Android apps report themselves as android-app://<package>/, which the
  // ingest keeps as the package name: the Google app, Gmail, and the social apps.
  [/^com\.google\.android\.googlequicksearchbox$/, "Google"],
  [/^com\.google\.android\.gm$/, "Gmail"],
  [/^com\.instagram\.android$/, "Instagram"],
  [/^com\.facebook\.(katana|orca)$/, "Facebook"],
  [/^com\.linkedin\.android$/, "LinkedIn"],
  [/^com\.zhiliaoapp\.musically$/, "TikTok"],
  [/^com\.twitter\.android$/, "X (Twitter)"],
  [/^com\.slack$/, "Slack"],
  [/(^|\.)mail\.google\.com$/, "Gmail"],
];

export function referrerName(host: string): string {
  const h = (host || "").toLowerCase().replace(/^www\./, "");
  for (const [re, name] of REFERRERS) if (re.test(h)) return name;
  return h || "Unknown";
}

let regionNames: Intl.DisplayNames | null = null;

/** "United States" for "US" — falls back to the code if the runtime can't say. */
export function countryName(code: string): string {
  const c = (code || "").toUpperCase();
  if (!/^[A-Z]{2}$/.test(c)) return code || "Unknown";
  try {
    regionNames ??= new Intl.DisplayNames(["en"], { type: "region" });
    return regionNames.of(c) ?? c;
  } catch {
    return c;
  }
}

/** The flag emoji for a two-letter country code (regional indicator letters). */
export function countryFlag(code: string): string {
  const c = (code || "").toUpperCase();
  if (!/^[A-Z]{2}$/.test(c)) return "🌐";
  return String.fromCodePoint(...[...c].map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65));
}
