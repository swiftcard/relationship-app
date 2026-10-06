import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8");

// The "Download on the App Store" surfaces. There are four of them across the
// site and the post-signup flow, and before this they were copy-pasted markup —
// which is exactly how two badges on one page end up different sizes with
// different hover states, and how a change lands on one and not the others.
// These pin the single-source rule and the placements themselves.

const BADGE = "src/components/AppStoreBadge.tsx";

// Every consumer, and what each one is for.
const CONSUMERS: [string, string][] = [
  ["src/app/page.tsx", "homepage hero, right of See how it works — phones only"],
  ["src/components/site/SiteNav.tsx", "desktop header, left of Log in"],
  ["src/components/site/SiteFooter.tsx", "footer"],
  ["src/components/WelcomePlan.tsx", "/welcome — card is live (new signup)"],
  ["src/app/cards/new/NewCardWizard.tsx", "wizard step 5 — card is live (signed in)"],
  ["src/components/AppStorePopup.tsx", "post-signup \"Your account is ready!\" popup"],
  ["src/app/settings/flows/page.tsx", "Settings → Flows, Get the iPhone app"],
];

describe("one badge, rendered everywhere", () => {
  it.each(CONSUMERS)("%s imports the shared badge (%s)", (file) => {
    expect(read(file)).toMatch(/from "@\/components\/AppStoreBadge"/);
  });

  // The Apple glyph path is the tell: if it appears anywhere else, someone has
  // hand-rolled a second badge and the two will drift.
  it("the Apple glyph is defined in exactly one file", () => {
    const glyphStart = "M16.365 1.43c0 1.14-.417 2.2-1.11 2.98";
    const offenders = CONSUMERS.map(([f]) => f).filter((f) => read(f).includes(glyphStart));
    expect(offenders).toEqual([]);
    expect(read(BADGE)).toContain(glyphStart);
  });
});

// ── One look, the header's, with white words on every theme ──────────────
// Owner, 2026-09-18: "anywhere this Download on the App Store button pops up,
// the text within the black box is white … all of them have to look exactly
// like the one in the header of our website on the computer." The /welcome
// badge had lost its "App Store" line: the light theme remaps .text-white to
// near-black inside .sc-app, so it drew black on black.
describe("one look, the header's", () => {
  const src = read(BADGE);
  const css = read("src/app/globals.css");

  it("has no tones left to drift apart", () => {
    expect(src).not.toMatch(/tones*[=?:]/);
    expect(src).not.toMatch(/TONES/);
    for (const [f] of CONSUMERS) expect(read(f), f).not.toMatch(/<AppStoreBadge[^>]*tone=/);
  });

  it("takes its colours from one CSS rule, never a Tailwind colour class a theme can remap", () => {
    const badge = src.slice(src.indexOf("export default function AppStoreBadge"), src.indexOf("export function GetTheAppCard"));
    expect(badge).toContain("sc-appstore-badge");
    expect(badge).toContain("sc-asb-top");
    expect(badge).toContain("sc-asb-main");
    // No text-/bg-/border- colour utilities on the pill or its words.
    expect(badge).not.toMatch(/(text-white|text-slate|text-gray|bg-slate|bg-white|bg-black|border-white)/);
    // The header glass over the nav's #0A0B10, composited, and white words.
    expect(css).toMatch(/.sc-appstore-badge { background-color: #191A1E; border: 1px solid #2F3034; color: #fff; }/);
    expect(css).toMatch(/.sc-appstore-badge:hover { background-color: #232328; }/);
    expect(css).toMatch(/.sc-appstore-badge .sc-asb-main { color: #fff; }/);
    // And no light-theme rule reaches for it.
    expect(css).not.toMatch(/data-sc-theme="light"][^{]*sc-a(ppstore-badge|sb-)/);
  });

  it("the email badge (welcome email) is the header's badge too, written for email clients", () => {
    const lib = read("src/lib/app-store.ts");
    const block = lib.slice(lib.indexOf("export function appStoreEmailBlock"));
    expect(block).toContain("background:#191A1E;border:1px solid #2F3034;border-radius:12px;");
    expect(block).toMatch(/color:#BABABB;font-size:9px;[^"]*">Download on the</);
    expect(block).toMatch(/color:#FFFFFF;font-size:12\.5px;font-weight:600;[^"]*">App&nbsp;Store</);
    // The Apple mark, as a hosted PNG (no SVG in email) that actually ships.
    expect(block).toContain("/email/apple-glyph-white.png");
    expect(existsSync(join(root, "public/email/apple-glyph-white.png"))).toBe(true);
  });

  it("is the header's size everywhere but the phone hero", () => {
    expect(src).not.toMatch(/md: {/);
    for (const [f] of CONSUMERS) {
      if (f === "src/app/page.tsx") continue;
      expect(read(f), f).not.toMatch(/<AppStoreBadge[^>]*size="(md|lg)"/);
    }
  });
});

describe("the shine", () => {
  // Owner request 2026-09-03: every App Store button carries the reflection
  // sweep. All three variants, or it is not "everywhere".
  it("every badge variant renders the shine element", () => {
    const src = read(BADGE);
    // One definition, and GetTheAppCard reuses AppStoreBadge, so every rendered
    // badge on the site carries it.
    expect(src).toContain("rd-appstore-shine");
  });

  it("the sweep is defined once, with a keyframe, and clipped to the pill", () => {
    const css = read("src/app/globals.css");
    expect(css).toContain(".rd-appstore-shine");
    expect(css).toContain("@keyframes rd-appstore-shine");
    // Without relative+overflow-hidden on the anchor the band sweeps across
    // whatever sits next to the badge instead of across the badge.
    expect(read(BADGE)).toMatch(/relative overflow-hidden/);
  });

  it("respects prefers-reduced-motion", () => {
    const css = read("src/app/globals.css");
    const block = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(block).toMatch(/\.rd-appstore-shine\s*\{[^}]*animation:\s*none/);
  });
});

describe("placement", () => {
  // Owner decision 2026-09-03 (evening): no badge in the homepage hero AT ANY
  // WIDTH, reversing that morning's request — the header and footer badges
  // stay. Superseded 2026-09-10, and narrowly: the hero badge is back on
  // PHONES ONLY.
  //
  // Not a flip-flop. The 2026-09-03 reasoning was "the desktop header already
  // carries one next to Log in, and the footer another, so a third in the hero
  // was clutter", and that is still true on desktop — the badge below is
  // `lg:hidden`, so desktop is exactly as that decision left it. Below lg it
  // was never true: the header badge is inside a `hidden lg:flex` cluster, so
  // removing the hero one left a phone with no App Store link above the fold
  // at all. Measured on the live site at 390px before the change: one painted
  // badge on the whole page, in the footer, 13,071px down.
  it("hero: the badge is beside 'See how it works', and only on phones", () => {
    const src = read("src/app/page.tsx");
    const cta = src.indexOf('id="hero-cta"');
    expect(cta).toBeGreaterThan(-1);
    expect(src.slice(cta)).toContain("See how it works");
    // Order: the button, then the badge, then the claim box.
    const badge = src.indexOf("<AppStoreBadge", cta);
    expect(badge, "the badge must come after the CTA").toBeGreaterThan(cta);
    expect(src.indexOf("<HeroClaim", cta), "the claim box stays last").toBeGreaterThan(badge);
    expect(src.slice(badge, badge + 120)).toContain('className="lg:hidden"');
  });

  // Owner kept the header badge on desktop (2026-09-03) — but ONLY there. The
  // mobile bar carries the logo, Get started and the menu trigger inside 375px;
  // a badge with words needs 85px it does not have, and the icon-only version
  // that does fit was a compromise nobody asked for.
  it("nav: the badge is in the desktop cluster and nowhere else", () => {
    const nav = read("src/components/site/SiteNav.tsx");
    const uses = [...nav.matchAll(/<AppStoreBadge/g)];
    expect(uses).toHaveLength(1);

    // It must live inside the `hidden lg:flex` cluster, which is what keeps it
    // off phones. Bound the slice at the mobile cluster that follows.
    const desktopStart = nav.indexOf('className="hidden lg:flex items-center gap-2.5');
    const mobileStart = nav.indexOf('className="flex items-center gap-1.5 sm:gap-2 lg:hidden"');
    expect(desktopStart).toBeGreaterThan(-1);
    expect(mobileStart).toBeGreaterThan(desktopStart);
    const desktopCluster = nav.slice(desktopStart, mobileStart);
    expect(desktopCluster).toContain("<AppStoreBadge");
    // Ahead of Log in, behind Get started free.
    expect(desktopCluster.indexOf("<AppStoreBadge")).toBeLessThan(desktopCluster.indexOf('href="/login"'));
    expect(desktopCluster.indexOf('href="/cards/new"')).toBeGreaterThan(desktopCluster.indexOf("<AppStoreBadge"));

    // Nothing in the mobile bar or the menu sheet.
    expect(nav.slice(mobileStart)).not.toContain("<AppStoreBadge");
  });

  // Owner request: the moment a card is created is where the app gets offered.
  // BOTH "Your card is live!" screens, or the two drift apart.
  it.each([
    ["src/components/WelcomePlan.tsx"],
    ["src/app/cards/new/NewCardWizard.tsx"],
  ])("%s offers the app right after the notifications switch", (file) => {
    const src = read(file);
    const push = src.indexOf("<EnablePushButton />");
    const card = src.indexOf("<GetTheAppCard");
    expect(push).toBeGreaterThan(-1);
    expect(card).toBeGreaterThan(push);
  });

  // Inside the app itself, "download the app" is nonsense.
  it("the card-created block is hidden in the native shell", () => {
    const src = read(BADGE);
    const block = src.slice(src.indexOf("export function GetTheAppCard"));
    expect(block).toMatch(/<NativeHidden>/);
  });
});

describe("self-activating contract", () => {
  beforeEach(() => { vi.resetModules(); });
  afterEach(() => { vi.unstubAllEnvs(); });

  // Same rule as every other APP_STORE_URL consumer: nothing renders until the
  // listing exists, so a badge can be placed anywhere without shipping a dead
  // link. Every variant must honour it — a new one that forgets would render a
  // link to nowhere.
  it("renders nothing when NEXT_PUBLIC_APP_STORE_URL is unset", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_STORE_URL", "");
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { createElement: h } = await import("react");
    const mod = await import("@/components/AppStoreBadge");
    expect(renderToStaticMarkup(h(mod.default))).toBe("");
    expect(renderToStaticMarkup(h(mod.GetTheAppCard))).toBe("");
  });

  it("renders a real, labelled link once the listing is live", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_STORE_URL", "https://apps.apple.com/app/id6798875872");
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { createElement: h } = await import("react");
    const mod = await import("@/components/AppStoreBadge");
    const out = renderToStaticMarkup(h(mod.default));
    expect(out).toContain("https://apps.apple.com/app/id6798875872");
    // The accessible name must CONTAIN the visible label, word for word. Voice
    // Control users say what they see — "tap Download on the App Store" — and
    // the command fails if the name does not carry that phrase. The old label
    // reordered the words around "SwiftCard" and never matched (caught by
    // scripts/qa-a11y.mjs on every page the badge appears on).
    expect(out).toContain('aria-label="Download on the App Store"');
    const visible = out.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
    expect(visible).toContain("Download on the App Store");
    expect(out).toContain("rd-appstore-shine");
    // Opens out of the site; never without noopener.
    expect(out).toContain('rel="noopener noreferrer"');
  });
});

// ── Exactly one badge above the fold, at every width ───────────────────────
//
// The nav badge lives in a `hidden lg:flex` cluster, because a 375px bar has no
// room for the logo, the CTA, the menu trigger AND a badge. That left phones
// with no App Store link above the fold at all — the nearest one was in the
// footer, measured 13,000px down the homepage — while SiteNav's own comment
// said "Phones get the hero badge beside 'See how it works' instead". It had
// been saying that with no hero badge to point at.
//
// So the hero badge is `lg:hidden`: the exact complement of that cluster. The
// pair has to stay complementary or the site gets two badges in one viewport
// (which is what the 2026-09-03 removal was avoiding) or none (which is what it
// caused). Both halves are pinned here because either one alone reads as
// arbitrary.
describe("the hero badge and the nav badge are complements", () => {
  const hero = read("src/app/page.tsx");
  const nav = read("src/components/site/SiteNav.tsx");

  it("the hero carries a phone-only badge beside See how it works", () => {
    const row = hero.slice(hero.indexOf('id="hero-cta"') - 900, hero.indexOf("<HeroClaim"));
    expect(row, "the badge must sit in the same row as the CTA").toContain("<AppStoreBadge");
    expect(row).toMatch(/<AppStoreBadge[^>]*className="lg:hidden"/);
    // size="lg" is the one built for this slot — 50px tall, matching the
    // .rd-btn-lg beside it to the pixel. Any other size and the two sit a
    // couple of pixels off, which is the sort of thing you cannot unsee.
    expect(row).toMatch(/<AppStoreBadge[^>]*size="lg"/);
  });

  it("the nav badge stays desktop-only, so the two never both show", () => {
    // Anchored on the badge and read BACKWARDS to its wrapper: the file has
    // more than one `hidden lg:flex`, and slicing from the first found the
    // desktop links row instead of the button cluster.
    const at = nav.indexOf("<AppStoreBadge");
    expect(at, "the nav must still carry a badge").toBeGreaterThan(-1);
    const before = nav.slice(0, at);
    const wrapper = before.lastIndexOf('<div className="hidden lg:flex');
    expect(wrapper, "the nav badge must sit inside a hidden lg:flex cluster").toBeGreaterThan(-1);
    // …and nothing closes that div between the wrapper and the badge.
    expect(before.slice(wrapper).includes("</div>")).toBe(false);
    expect(nav.slice(at, at + 80)).toContain('size="sm"');
  });

  it("lg is used by the hero and nowhere else", () => {
    // It is tuned to one specific neighbour. Reusing it somewhere without that
    // 50px button beside it would inherit padding chosen for a 343px column.
    const users = CONSUMERS.map(([f]) => f).filter((f) => /size="lg"/.test(read(f)));
    expect(users).toEqual(["src/app/page.tsx"]);
  });
});
