import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { safeNextPath } from "@/lib/safe-next";
import { nanpE164 } from "@/lib/messaging";
import { from as senderFrom } from "@/lib/email-senders";
import { safeCssValue, safeFontValue } from "@/lib/custom-layout";

// The security audit of 2026-09-24 (owner: "make sure it is impossible to hack
// our website, our app, or any of our stuff"). Each block pins one finding so
// it cannot quietly come back.

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

describe("?next= cannot leave the site through characters the URL parser deletes", () => {
  it("refuses tab, newline, carriage return, space and backslash anywhere", () => {
    for (const probe of ["/\t/evil.com", "/\n/evil.com", "/\r/evil.com", "/%09/evil.com".replace("%09", "\t"), "/a\\b", "/ /evil.com", "/x\u007f"]) {
      expect(safeNextPath(probe), JSON.stringify(probe)).toBeNull();
    }
  });
  it("still allows every ordinary path", () => {
    for (const ok of ["/dashboard", "/dashboard?card=abc&tab=links", "/cards/new?add=1#top", "/join/abc123"]) {
      expect(safeNextPath(ok)).toBe(ok);
    }
  });
  it("whatever survives resolves on our origin", () => {
    for (const probe of ["/\t/evil.com", "/\\evil.com", "//evil.com", "/ok", "/%2F%2Fevil.com"]) {
      const safe = safeNextPath(probe);
      if (safe) expect(new URL(safe, "https://swiftcard.me").origin).toBe("https://swiftcard.me");
    }
  });
  it("the LinkedIn callback uses the shared guard, not its own", () => {
    const s = read("src/app/api/integrations/linkedin/callback/route.ts");
    expect(s).toContain("safeNextPath(returnRaw)");
    expect(s).not.toMatch(/returnRaw\.startsWith\("\/"\) && !returnRaw\.startsWith\("\/\/"\)/);
  });
});

describe("the image proxy can never act as a page on swiftcard.me", () => {
  const s = read("src/app/api/img-proxy/route.ts");
  it("serves with a sandbox CSP and nosniff, only image types, size-capped", () => {
    expect(s).toMatch(/"Content-Security-Policy": "default-src 'none';[^"]*sandbox"/);
    expect(s).toContain('"X-Content-Type-Options": "nosniff"');
    expect(s).toContain("IMAGE_TYPE.test(ct)");
    expect(s).toContain("readCapped(res, MAX_BYTES)");
    expect(s).not.toContain('ct.startsWith("image/")');
  });
});

describe("admin data never renders on the strength of the layout alone", () => {
  it("every admin page that loads data server-side checks admin itself", () => {
    const pages = walk(join(process.cwd(), "src/app/admin")).filter((p) => p.endsWith("page.tsx"));
    const dataImports = /from "@\/lib\/(supabase-admin|retention-alert|admin-[a-z-]+|analytics[a-z-]*)"/;
    for (const p of pages) {
      const src = readFileSync(p, "utf8");
      if (!dataImports.test(src)) continue;
      expect(src, p).toMatch(/requireAdmin\(\)|isAdminEmail\(|ADMIN_EMAILS\.includes\(/);
    }
  });
  it("the retention page in particular", () => {
    expect(read("src/app/admin/retention/page.tsx")).toContain("if (!(await requireAdmin())) notFound();");
  });
});

describe("account-exists answers about one real address, never a pattern", () => {
  const s = read("src/app/api/account-exists/route.ts");
  it("validates the shape and escapes the one legal wildcard", () => {
    expect(s).toContain("!EMAIL_SHAPE.test(email)");
    expect(s).toContain('.ilike("email", pattern)');
    expect(s).not.toContain('.ilike("email", email)');
    const shape = /^[a-z0-9._+-]{1,64}@[a-z0-9-]+(\.[a-z0-9-]+)+$/;
    for (const bad of ["a%@gmail.com", "%@acme.com", "a*@x.com", "a@%", "a,b@x.com"]) expect(shape.test(bad), bad).toBe(false);
    for (const good of ["dana.reed+cards@gmail.com", "j_doe@company.co.uk"]) expect(shape.test(good), good).toBe(true);
  });
});

describe("texts only ever go to North American numbers", () => {
  it("normalises US/Canada numbers to E.164", () => {
    expect(nanpE164("(516) 555-0199")).toBe("+15165550199");
    expect(nanpE164("516.555.0199")).toBe("+15165550199");
    expect(nanpE164("1 516 555 0199")).toBe("+15165550199");
    expect(nanpE164("+1 (416) 555-0199")).toBe("+14165550199");
  });
  it("refuses everything else before Twilio is called", () => {
    for (const bad of ["+44 20 7946 0958", "+882 1234 5678", "+1 116 555 0199", "555-0199", "", "+15165550199999"]) {
      expect(nanpE164(bad), bad).toBeNull();
    }
    expect(read("src/lib/messaging.ts")).toMatch(/const e164 = nanpE164\(to\);\s*\n\s*if \(!e164\) return \{ status: "failed", sid: null \};/);
  });
  it("every user send route shares one daily ceiling", () => {
    for (const f of ["src/app/api/sms/send/route.ts", "src/app/api/leads/[id]/message/route.ts", "src/app/api/leads/share-card/route.ts"]) {
      expect(read(f), f).toContain("await outboundDailyCapHit(user.id)");
    }
  });
});

describe("a user's card name can't send mail as SwiftCard", () => {
  it("strips the brand from a connect@ display name and always says 'via SwiftCard'", () => {
    expect(senderFrom("connect", "SwiftCard Account Security")).toBe("Account Security via SwiftCard <connect@swiftcard.me>");
    expect(senderFrom("connect", "Swift Card Billing")).toBe("Billing via SwiftCard <connect@swiftcard.me>");
    expect(senderFrom("connect", "Dana Reed")).toBe("Dana Reed via SwiftCard <connect@swiftcard.me>");
    expect(senderFrom("connect", "SwiftCard")).toBe("SwiftCard <connect@swiftcard.me>");
  });
  it("address-list syntax can't ride in a name", () => {
    expect(senderFrom("connect", "Dana, support@evil.com; x")).not.toMatch(/[,;@].*via/);
  });
});

describe("promo codes can't be used past their limit", () => {
  it("both redemption paths take a use atomically", () => {
    for (const f of ["src/app/api/promo/redeem/route.ts", "src/app/api/stripe/checkout/route.ts"]) {
      const s = read(f);
      expect(s, f).toContain("claimPromoUse(admin,");
      expect(s, f).not.toMatch(/update\(\{ uses_count: [^}]*\+ 1 \}\)/);
    }
    expect(read("src/lib/promo-claim.ts")).toMatch(/\.eq\("uses_count", used\)/);
  });
});

describe("OAuth connects finish only in the browser that started them", () => {
  beforeAll(() => { process.env.OAUTH_SECRET ||= "test-secret-for-binding"; });
  it("the binding matches its own state and nothing else", async () => {
    const { signState, oauthBindCookieValue, stateBoundToBrowser } = await import("@/lib/oauth-state");
    const mine = signState("user-a");
    const theirs = signState("user-b");
    expect(stateBoundToBrowser(mine, oauthBindCookieValue(mine))).toBe(true);
    expect(stateBoundToBrowser(mine, oauthBindCookieValue(theirs))).toBe(false);
    expect(stateBoundToBrowser(mine, undefined)).toBe(false);
    expect(stateBoundToBrowser(mine, "")).toBe(false);
  });
  it("Google and LinkedIn set it on connect and require it on callback", () => {
    for (const p of ["google", "linkedin"]) {
      expect(read(`src/app/api/integrations/${p}/connect/route.ts`)).toContain(`res.cookies.set(oauthBindCookieName("${p}"), oauthBindCookieValue(state), OAUTH_BIND_COOKIE_OPTIONS);`);
      expect(read(`src/app/api/integrations/${p}/callback/route.ts`)).toContain(`stateBoundToBrowser(state, request.cookies.get(oauthBindCookieName("${p}"))?.value)`);
    }
  });
});

describe("owner-typed colours and fonts are only ever colours and fonts", () => {
  it("rejects declarations and url()", () => {
    expect(safeCssValue("#000;position:fixed;inset:0")).toBeUndefined();
    expect(safeCssValue("url(https://tracker.example/p.gif)")).toBeUndefined();
    expect(safeFontValue("Inter;background:url(x)")).toBeUndefined();
    expect(safeCssValue("#1a2b3c")).toBe("#1a2b3c");
    expect(safeCssValue("linear-gradient(135deg, #111 0%, #222 100%)")).toBe("linear-gradient(135deg, #111 0%, #222 100%)");
    expect(safeFontValue("'Playfair Display', serif")).toBe("'Playfair Display', serif");
    expect(safeCssValue("")).toBeUndefined();
  });
  it("the card templates and the Swift Links page both apply them", () => {
    expect(read("src/lib/template-style.ts")).toContain("bgColor: safeCssValue(c.bgColor)");
    const links = read("src/app/links/[username]/page.tsx");
    expect(links).toContain("bg: safeCssValue(customization.linkBgColor)");
    expect(links).toContain("font: safeFontValue(customization.linkFontFamily)");
  });
});

describe("personal data stops being public when it should", () => {
  it("a deleted or offline card no longer serves its stored signature image", () => {
    expect(read("src/app/api/card-signature/[username]/route.ts")).toContain("if (base && (await isCardActive(slug)) && (await storedCaptureIsCurrent(");
  });
  it("account delete removes the rendered card images at once", () => {
    const s = read("src/app/api/account/delete/route.ts");
    expect(s).toContain('admin.storage.from("card-shares").remove(objects)');
    expect(s).toContain('admin.storage.from("card-signatures").remove(objects)');
  });
  it("the purge removes contacts kept under the profile handle", () => {
    expect(read("src/lib/account-purge.ts")).toMatch(/select\("username"\)\.eq\("id", userId\)/);
  });
  it("error reports keep the path, never a token-carrying query string", () => {
    expect(read("src/components/ClientErrorReporter.tsx")).toContain("url: location.origin + location.pathname");
    expect(read("src/app/api/client-error/route.ts")).toContain('.split(/[?#]/)[0]');
    expect(read("src/lib/report-error.ts")).toContain('!context.startsWith("client.")');
  });
});

describe("free Pro can't be minted on a new account", () => {
  it("the retention month needs an account at least two weeks old", () => {
    const s = read("src/app/api/account/retention/route.ts");
    expect(s).toContain("accountOldEnough(opts.accountCreatedAt)");
    expect(s.match(/accountCreatedAt: user\.created_at \?\? null,/g)?.length).toBe(2);
  });
  it("a late App Store grant asks RevenueCat first", () => {
    expect(read("src/app/api/iap/revenuecat/route.ts")).toMatch(/if \(decision\.action === "grant"\) \{[\s\S]{0,600}rcProActive\(profile\.id as string\)\) === false\) return "stale_grant";/);
  });
});

describe("the public lead form takes bounded input", () => {
  it("types and lengths every field, and caps floods per card", () => {
    const s = read("src/app/api/leads/route.ts");
    expect(s).toContain("!optionalText(message, 3000)");
    expect(s).toMatch(/isRateLimited\(`lead-card:\$\{card_owner\.trim\(\)\.toLowerCase\(\)\}`, 120, 60 \* 60 \* 1000\)/);
  });
});

describe("no App Review password in the public repo", () => {
  it("no script carries a literal demo-account password", () => {
    const files = walk(join(process.cwd(), "scripts")).filter((p) => /\.(mjs|js|cjs|ts)$/.test(p));
    for (const f of files) {
      expect(readFileSync(f, "utf8"), f).not.toMatch(/SwiftReview![0-9a-f]{8}["'`]/);
    }
  });
});

describe("the two glitches the owner reported", () => {
  it("the light theme is put back if anything strips it off <html>", () => {
    const s = read("src/app/layout.tsx");
    expect(s).toContain("new MutationObserver(");
    expect(s).toContain("attributeFilter:['class','data-sc-theme','data-sc-mac',");
    expect(s).toContain("if(t!=='dark')d.setAttribute(a,'light');");
  });
  it("the loading skeleton's tab bar keeps the Admin tab", () => {
    const nav = read("src/components/MobileNav.tsx");
    expect(nav).toContain('export const NAV_EXTRA_TABS_KEY = "sc_nav_extra_tabs";');
    expect(nav).toContain('remembered.includes("admin")');
    expect(read("src/lib/account-state.ts")).toContain('"sc_nav_extra_tabs"');
  });
});
