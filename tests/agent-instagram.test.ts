import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { isCampaignSource, isSignupSource } from "@/lib/referral";
import { campaignDestination, campaignLink, PROFESSION_TEMPLATE } from "@/lib/campaign-links";
import { campaignSourceLabel, getSignupSourceLabel } from "@/lib/source-labels";
import { isSocialInAppBrowser } from "@/lib/in-app-browser";
import { PRESET_TEMPLATES } from "@/components/card-templates/TemplatePicker";

// Tracked signup sources (ig_, tt_, li_, yt_, rd_, fb_ ...), the /go redirect,
// in-app browsers, and the Pinterest pin pages. The Instagram and Facebook
// comment bots that first used these were removed 2026-10-19; the links stay.

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8");
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(join(root, dir))) {
    const p = `${dir}/${f}`;
    if (statSync(join(root, p)).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|mjs)$/.test(f)) out.push(p);
  }
  return out;
}

describe("every Instagram signup is countable", () => {
  it("campaign codes are valid signup sources (they were dropped to 'direct' before)", () => {
    for (const s of ["ig_bio", "ig_dm", "ig_ad", "ig_prospect", "ig_creator_maya_sells", "ig_p_17900000000000001", "li_page", "fb_ad"]) {
      expect(isSignupSource(s), s).toBe(true);
      expect(isCampaignSource(s), s).toBe(true);
    }
    for (const s of ["ig_", "instagram", "ig_Bio", "ig_bio;drop", "xx_bio"]) expect(isCampaignSource(s), s).toBe(false);
  });
  it("/go/<code> lands in the builder with the source, and on the profession's template", () => {
    expect(campaignDestination("ig_bio")).toBe("/cards/new?src=ig_bio");
    expect(campaignDestination("ig_bio", "real-estate-agents")).toBe("/cards/new?src=ig_bio&template=photo-first");
    // A mistyped code still reaches the builder — never a dead end, never a bogus source.
    expect(campaignDestination("nonsense")).toBe("/cards/new");
    expect(campaignLink("ig_bio")).toBe("https://swiftcard.me/go/ig_bio");
    const ids = new Set(PRESET_TEMPLATES.map((t) => t.id));
    for (const [slug, t] of Object.entries(PROFESSION_TEMPLATE)) expect(ids.has(t), `${slug} → ${t}`).toBe(true);
  });
  it("the /go route counts real taps only, and is a temporary redirect", () => {
    const c = code("src/app/go/[code]/route.ts");
    expect(c).toContain('name: "campaign_link_clicked"');
    expect(c).toMatch(/next-router-prefetch"\) === "1" \|\| isLikelyBot/);
    expect(c).toContain("307");
    expect(c).not.toContain("308");
    // Clicks are written by our server only — a browser cannot forge them.
    expect(code("src/lib/events.ts")).toMatch(/SERVER_EVENTS = \["campaign_link_clicked"\]/);
    expect(read("src/lib/slug.ts")).toMatch(/"go"/);
  });
  it("the admin reads a campaign source as words", () => {
    expect(campaignSourceLabel("ig_bio")).toBe("Instagram — bio link");
    expect(getSignupSourceLabel("ig_p_ab12")).toBe("Instagram — post ab12");
    expect(getSignupSourceLabel("ig_creator_maya")).toBe("Instagram — creator @maya");
    expect(campaignSourceLabel("badge")).toBeNull();
  });
});

describe("Instagram's own browser must not strand a signup", () => {
  it("recognises the in-app browsers Google refuses to sign in from", () => {
    expect(isSocialInAppBrowser("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 350.0.0.20.100 (iPhone15,2; iOS 18_0)")).toBe(true);
    expect(isSocialInAppBrowser("Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/128 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/480.0.0.0;]")).toBe(true);
    expect(isSocialInAppBrowser("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1")).toBe(false);
    expect(isSocialInAppBrowser(null)).toBe(false);
  });
  it("the Google button steps aside there and points at email signup", () => {
    const c = code("src/components/GoogleSignInButton.tsx");
    expect(c).toMatch(/isSocialInAppBrowser\(navigator\.userAgent\)[\s\S]{0,120}setPhase\("in_app"\)/);
    expect(c).toMatch(/phase === "in_app"[\s\S]{0,300}Use your email below/);
  });
});

describe("the Instagram tables stay locked down", () => {
  it("the schema is service-role only and de-duplicates on Instagram's own id", () => {
    const sql = read("supabase/agent-instagram.sql");
    expect(sql).toMatch(/unique \(kind, external_id\)/);
    expect(sql).toMatch(/alter table agent_ig_events enable row level security/);
    expect(sql).toMatch(/alter table agent_ig_posts\s+enable row level security/);
    expect(sql).not.toMatch(/create policy/i);
  });
});

// ── TikTok (owner order 2026-10-02): "reuse the best Instagram videos" ───────
// No tool may post to TikTok or reply there (its Content Sharing Guidelines
// rule out a utility that uploads to your own account), so the bot is the
// hand-off: the agent writes the TikTok version of what converted on Instagram,
// the queue hands over the video file, and the bio link makes signups countable.
describe("TikTok: posted by hand, counted by signups", () => {
  it("TikTok links are valid sources, read as words, and land in the builder", () => {
    for (const s of ["tt_bio", "tt_dm", "tt_creator_maya"]) expect(isSignupSource(s), s).toBe(true);
    expect(getSignupSourceLabel("tt_bio")).toBe("TikTok — bio link");
    expect(getSignupSourceLabel("tt_creator_maya")).toBe("TikTok — creator @maya");
    expect(campaignLink("tt_bio")).toBe("https://swiftcard.me/go/tt_bio");
    expect(campaignDestination("tt_bio")).toBe("/cards/new?src=tt_bio");
  });
  it("TikTok's own browser gets email signup, not a Google button that cannot work", () => {
    expect(isSocialInAppBrowser("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 musical_ly_36.0.0 JsSdk/2.0 NetType/WIFI Channel/App Store ByteLocale/en Region/US")).toBe(true);
    expect(isSocialInAppBrowser("Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/128.0 Mobile Safari/537.36 trill_360000 BytedanceWebview/d8a21c6")).toBe(true);
  });
  it("there is still no TikTok posting code — the owner posts it", () => {
    expect(read("src/lib/agent-connections.ts")).not.toMatch(/"tiktok"/);
  });
});

// ── LinkedIn (owner order 2026-10-04) ────────────────────────────────────────
// LinkedIn gives no API for finding people and its search cannot be driven
// from the owner's account (it signed him out). The finder therefore reads
// public new-hire announcements — "Newcastle Realty welcomes John Pedlowe" —
// through Google News RSS inside the Radar, and Ava finds the person on
// LinkedIn and writes the comment + connection note the owner sends.
describe("LinkedIn tracked links", () => {
  it("LinkedIn tracked links are valid signup sources", () => {
    for (const s of ["li_dm", "li_post", "li_page", "rd_realtors"]) expect(isSignupSource(s), s).toBe(true);
    expect(getSignupSourceLabel("li_post")).toBe("LinkedIn — post");
  });
});

// ── Pinterest + YouTube (owner order 2026-10-04): long-term traffic ─────────
describe("Pinterest: every pin is a real design, posted once, linking back", () => {
  it("every pin idea has a persona the homepage renders, a board, and a valid code", async () => {
    const { PIN_IDEAS, pinCode } = await import("@/lib/pinterest-pins");
    const src = read("src/components/site/HeroShowcase.tsx");
    expect(PIN_IDEAS.length).toBeGreaterThanOrEqual(10);
    for (const p of PIN_IDEAS) {
      expect(src, `${p.slug}: persona "${p.persona}" is not a homepage persona`).toContain(`key: "${p.persona}"`);
      expect(isCampaignSource(pinCode(p.slug)), pinCode(p.slug)).toBe(true);
      expect(p.description.length).toBeLessThanOrEqual(800);
      expect(p.headline.length).toBeLessThanOrEqual(100);
    }
    expect(new Set(PIN_IDEAS.map((p) => p.slug)).size).toBe(PIN_IDEAS.length);
    expect(getSignupSourceLabel("pin_luxury_business_cards")).toBe("Pinterest — luxury business cards");
  });
  it("the pin page is static and noindex, and the picture is 1000×1500", () => {
    const page = read("src/app/pin/[slug]/page.tsx");
    expect(page).toContain('export const dynamic = "force-static"');
    expect(page).toMatch(/robots: \{ index: false, follow: false \}/);
    expect(read("src/app/pin/[slug]/PinPicture.tsx")).toMatch(/width: PIN_W, height: PIN_H/);
    const idx = read("src/lib/knowledge/index.ts");
    expect(idx).toContain('"/pin/[slug]"');
  });
  it("the route posts each idea once, needs the bot secret, and links through /go", () => {
    const r = code("src/app/api/agents/pinterest/pin/route.ts");
    expect(r).toMatch(/if \(!botAuthorized\(req\)\) return NextResponse\.json\(\{ error: "Unauthorized" \}, \{ status: 401 \}\)/);
    expect(r).toMatch(/existing\?\.status === "posted"\) return NextResponse\.json\(\{ ok: true, already: true/);
    expect(r).toContain("campaignLink(code, idea.profession)");
    expect(r).toContain("onConflict: \"slug\"");
    const script = read("scripts/pinterest-pins.mjs");
    expect(script).toContain("/api/agents/pinterest/pin");
    expect(script).toMatch(/viewport: \{ width: 1000, height: 1500 \}/);
    expect(read(".github/workflows/pinterest-pins.yml")).toContain("node scripts/pinterest-pins.mjs");
    expect(read("supabase/agent-pinterest.sql")).toMatch(/values \('pins', 'pins', true\)/);
  });
  it("Pinterest is a connectable account with a refresh path", () => {
    const conns = read("src/lib/agent-connections.ts");
    expect(conns).toContain('"pinterest"');
    expect(conns).toMatch(/conn\.provider === "pinterest"/);
    const oauth = read("src/lib/agent-connect-oauth.ts");
    expect(oauth).toContain("https://www.pinterest.com/oauth/");
    expect(oauth).toContain("https://api.pinterest.com/v5/oauth/token");
  });
  it("YouTube tracked links are valid signup sources", () => {
    expect(isSignupSource("yt_linq_alternative")).toBe(true);
  });
});
