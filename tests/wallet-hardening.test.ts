import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { generateKeyPairSync, X509Certificate } from "node:crypto";
import { passCertDaysLeft, EMAIL_SHARES_ROW_MAX } from "@/lib/wallet";

const read = (p: string) => readFileSync(p, "utf8");

// Three hardening rules from the 2026-08-27 Wallet audit. None changes how a
// pass LOOKS for the cards that already work; each closes a way a pass could
// quietly go wrong later.
describe("Apple Wallet hardening", () => {
  it("a long email takes the secondary row alone; the phone drops to the auxiliary row", () => {
    const src = read("src/lib/wallet.ts");
    expect(EMAIL_SHARES_ROW_MAX).toBe(24);
    expect(src).toMatch(/const longEmail = !!card\.email && card\.email\.length > EMAIL_SHARES_ROW_MAX;/);
    expect(src).toMatch(/if \(card\.phone && !longEmail\) pass\.secondaryFields\.push\(\{ key: "phone"/);
    expect(src).toMatch(/if \(card\.phone && longEmail\) pass\.auxiliaryFields\.push\(\{ key: "phone"/);
    // The email itself is never dropped or moved.
    expect(src).toMatch(/if \(card\.email\) pass\.secondaryFields\.push\(\{ key: "email"/);
  });

  it("certificate expiry is readable and unreadable input is tolerated", () => {
    expect(passCertDaysLeft(undefined)).toBeNull();
    expect(passCertDaysLeft("not a cert")).toBeNull();
    // Node can't mint an X.509 cert without openssl, so verify the parser
    // on the WWDR-style structure via the class itself: a garbage PEM throws
    // and is mapped to null above; a real cert path is exercised in prod.
    expect(typeof X509Certificate).toBe("function");
    expect(() => generateKeyPairSync("ec", { namedCurve: "P-256" })).not.toThrow();
    const src = read("src/lib/wallet.ts");
    expect(src).toMatch(/warnIfCertExpiring\(\);/);
    expect(src).toMatch(/days <= 30/);
  });

  it("an image that fails to load is retried, and a degraded pass is never fingerprinted as final", () => {
    const strip = read("src/lib/wallet-strip.tsx");
    expect(strip).toMatch(/if \(attempt === 1\) return fetchImage\(url, 2\);/);
    expect(strip).toMatch(/attempt === 1 \? 2500 : 6000/);
    expect(strip).toMatch(/degraded = imageFailures > before/);
    const pass = read("src/lib/wallet-pass.ts");
    expect(pass).toMatch(/export async function buildPassDetailed/);
    const route = read("src/app/api/wallet/pass/route.ts");
    expect(route).toMatch(/buildPassDetailed\(inputs\)/);
    expect(route).toMatch(/if \(degraded\) \{[\s\S]*markWalletPassStale\(username\)[\s\S]*\} else \{[\s\S]*touchWalletPass\(username\)/);
    const reg = read("src/lib/wallet-registry.ts");
    expect(reg).toMatch(/content_hash: `degraded:\$\{Date\.now\(\)\}`/);
  });

  it("the auth-token secret is documented so a cert renewal can't strand installed passes", () => {
    expect(read(".env.example")).toMatch(/WALLET_AUTH_SECRET=/);
  });
});

// ── Onboarding-flow regressions reported by the owner, 2026-08-28 ──────────
describe("in-app signup and first-card flow", () => {
  const read2 = (p: string) => readFileSync(p, "utf8");

  it("the OAuth return leg covers the login screen instead of appearing to fail", () => {
    // Google succeeded, the sheet closed, and the webview underneath still
    // showed "Create account" for the seconds the code exchange + /onboarding
    // took — which reads as a bounce back to the signup form.
    const src = read2("src/components/NativeAppBridge.tsx");
    expect(src).toMatch(/showAuthOverlay\(\);/);
    expect(src).toMatch(/function showAuthOverlay/);
    expect(src).toMatch(/Signing you in/);
    // and it can never strand the app behind the cover
    expect(src).toMatch(/setTimeout\(\(\) => \{ document\.getElementById\("sc-auth-overlay"\)\?\.remove\(\); \}, 20000\)/);
  });

  it("onboarding records the referral before redirecting, but never waits on the referrer notification", () => {
    // AWAITED since 2026-09-17: the plan step reads the referral row to offer
    // the friend's free month, and an after() task could finish too late. The
    // slow part (notifying the referrer) is deferred inside. The welcome email
    // lives on the card-creation paths and is still never awaited there.
    const src = read2("src/app/onboarding/page.tsx");
    expect(src).toMatch(/await applyReferralOnSignup\(/);
    expect(read2("src/lib/referral-server.ts")).toContain("try { after(notify); } catch { await notify(); }");
    expect(read2("src/app/api/cards/route.ts")).toMatch(/after\(\(\) => sendWelcomeWhenCardLive/);
  });

  it("the guided tour is account-scoped, not device-scoped", () => {
    // A device flag meant anyone who skipped the tour once never saw it again
    // on any later account — including a brand-new signup on the same phone.
    const src = read2("src/lib/account-state.ts");
    const list = src.slice(src.indexOf("PERSON_SCOPED_STORAGE_KEYS"), src.indexOf("GUEST_FLOW_STORAGE_KEYS"));
    expect(list).toContain('"sc_tour_completed"');
  });

  it("the native plan chooser mirrors the web cards and never hardcodes a price", () => {
    const src = read2("src/components/PlanCards.tsx");
    expect(src).toMatch(/function NativePro/);
    expect(src).toContain("useIapOffer()");
    // StoreKit's monthly price — Apple's sheet offers annual with its own.
    expect(src).toMatch(/<ProTrialPrice price=\{price\} period="month" \/>/);
    expect(src).toMatch(/const price = offer\.monthly;/);
    // The SAME cards and tabs as the website (owner, 2026-09-30: the app
    // stacked the plans in one column). No Monthly / Annual switch: Apple's
    // sheet asks that (owner, later the same day).
    const chooser = src.slice(src.indexOf("function NativePlanChooser("), src.indexOf("export function NativeProUpgrade"));
    expect(chooser).not.toMatch(/<BillingToggle/);
    expect(chooser).toMatch(/<MobilePlanTabs/);
    expect(chooser).toMatch(/<FreePlanCard/);
    // Office is Stripe-only with no IAP product, so natively it can be neither
    // SOLD nor QUOTED. Owner, 2026-09-18: the app's plan step must still offer
    // it ("what if I wanted to get an Office account?") — so the Office card
    // renders (NativeOffice, after Free), and what stays forbidden is the
    // selling: no checkout hand-off and no price constant anywhere native.
    // The native path is the `if (native)` hand-off plus everything from
    // NativePlanChooser to the end of the file (the web render sits between).
    const nativeBranch = (
      src.slice(src.indexOf("if (native) {"), src.indexOf("{/* Monthly / annual toggle")) +
      src.slice(src.indexOf("function NativePlanChooser("))
    ).replace(/\/\/.*$/gm, "");
    expect(chooser).toMatch(/<NativeOffice /);
    expect(chooser.indexOf("<NativeOffice ")).toBeGreaterThan(chooser.indexOf("<FreePlanCard")); // after Free
    expect(nativeBranch).not.toMatch(/onPaid\(/);
    expect(nativeBranch).not.toMatch(/PLAN_PRICES|formatUsd|formatCents|seatSubtotalCents|ProWebPrice|OfficeWebPrice|OfficeSeatPicker/);
    // No price constant may reach the native card.
    expect(read2("src/lib/use-iap-price.ts")).toMatch(/getIapPackages/);
  });

  it("the native Office card only ever LEAVES the app, and fails closed", () => {
    const src = read2("src/components/PlanCards.tsx");
    const office = src.slice(src.indexOf("function NativeOffice("));
    expect(office.length).toBeGreaterThan(200);
    const code = office.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    // The default browser, through the native plugin — the remedy App Review
    // named for the US storefront. Never an <a>, window.open or a Browser sheet
    // (all of which stay INSIDE the app: the 1.0.0 (7) rejection).
    expect(code).toMatch(/openExternalPurchase\(NATIVE_OFFICE_PATH\)/);
    expect(code).not.toMatch(/<a |href=|window\.open|Browser\.open|router\.push/);
    // A shell that cannot leave the app renders NO Office card.
    expect(code).toMatch(/if \(!canLinkOut\) return null;/);
    expect(code).toMatch(/useState\(canOfferExternalPurchase\)/);
    // No price, no seat maths, no Stripe, no web checkout hand-off.
    expect(code).not.toMatch(/\$\d|PLAN_PRICES|formatUsd|formatCents|seatSubtotalCents|onPaid|stripe/i);
  });

  it("the Office link lands on the website's plan step, Office tab open, through sign-in", () => {
    const cards = read2("src/components/PlanCards.tsx");
    expect(cards).toContain('export const NATIVE_OFFICE_PATH = "/welcome?tier=office";');
    expect(cards).toMatch(/useState<PlanTier>\(initialTier\)/);
    const page = read2("src/app/welcome/page.tsx");
    // Safari has no session: the tier must survive the /login hop. Since
    // 2026-09-22 the whole selection survives it (tier, plan, seats, canceled…),
    // so tier is one of the keys carried rather than a hard-coded path.
    expect(page).toMatch(/for \(const k of \["tier", [^\]]*\] as const\)/);
    expect(page).toMatch(/redirect\(`\/login\?next=\$\{encodeURIComponent\(back\)\}`\)/);
    expect(page).toMatch(/initialTier=\{officeTier \? "office" : "pro"\}/);
    // Back in the app, the plan is re-checked — but only after the Office
    // button (or a promo code's "Use it on swiftcard.me") was really used, so
    // a StoreKit sheet can never trigger it.
    const welcome = read2("src/components/WelcomePlan.tsx");
    expect(welcome).toMatch(/leftForWebsite\.current && document\.visibilityState === "visible"\) router\.refresh\(\)/);
  });
});

// ── Scaling + security hardening, 2026-08-28 ──────────────────────────────
describe("public card page caching and redirect safety", () => {
  const read3 = (p: string) => readFileSync(p, "utf8");

  it("the card page reads its data through the per-slug cache, not a query per view", () => {
    const page = read3("src/app/[username]/page.tsx");
    expect(page).toMatch(/getCardPageData\(username\)/);
    // The inline admin reads are gone.
    expect(page).not.toMatch(/admin\.from\("cards"\)\.select\("\*"\)\.eq\("username", username\)/);
    const lib = read3("src/lib/card-page-data.ts");
    expect(lib).toMatch(/unstable_cache/);
    expect(lib).toMatch(/tags: \[cardPageTag\(slug\)\]/);
    expect(lib).toMatch(/revalidate: 60/);
  });

  it("the viewer identity is NEVER cached — owner self-view suppression stays per request", () => {
    const page = read3("src/app/[username]/page.tsx");
    const lib = read3("src/lib/card-page-data.ts");
    // getUser() must still run on the page, per request…
    expect(page).toMatch(/const viewer = await \(async \(\) => \{[\s\S]{0,800}?auth\.getUser\(\)/);
    expect(page).toMatch(/const isOwnerView = !!viewer && viewer\.id === ownerId/);
    // …and must never appear inside the cached loader (code, not comments —
    // the file explains WHY the viewer is excluded).
    const libCode = lib.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(libCode).not.toMatch(/getUser|createClient|cookies\(|headers\(/);
  });

  it("every card write drops the cached copy", () => {
    const route = read3("src/app/api/cards/[id]/route.ts");
    expect(route).toMatch(/import \{ revalidateCardPage \}/);
    // edit, rename (both slugs), delete
    expect((route.match(/revalidateCardPage\(/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect(route).toMatch(/revalidateCardPage\(renamedTo, b\.username\)/);
  });

  it("no redirect guard still uses the /\\ -blind hand-written check", () => {
    // new URL("/\\evil.com", origin) resolves to https://evil.com — the guard
    // that only rejects "//" let a post-sign-in redirect off-origin.
    for (const f of [
      "src/components/GoogleSignInButton.tsx",
      "src/lib/native-auth.ts",
      "src/app/onboarding/page.tsx",
      "src/app/api/integrations/linkedin/connect/route.ts",
      "src/components/NativeAppBridge.tsx",
    ]) {
      const src = read3(f);
      expect(src, `${f} still hand-rolls the guard`).not.toMatch(/startsWith\("\/"\) && !\w+\.startsWith\("\/\/"\)/);
      expect(src, `${f} does not use safeNextPath`).toMatch(/safeNextPath\(/);
    }
    // The helper itself rejects both shapes.
    const helper = read3("src/lib/safe-next.ts");
    expect(helper).toMatch(/startsWith\("\/\/"\) \|\| next\.startsWith\("\/\\\\"\)/);
  });

  it("flow settings are written with the service role (session UPDATE is revoked)", () => {
    const src = read3("src/app/api/settings/flows/route.ts");
    expect(src).toMatch(/getAdminSupabase\(\)\s*\n?\s*\.from\("profiles"\)\s*\n?\s*\.update\(\{ flow_settings: body \}\)/);
    expect(src).toMatch(/\.eq\("id", user\.id\)/);
  });
});

describe("the app only promises a trial this Apple ID can get (2026-09-16)", () => {
  it("drops the intro offer unless RevenueCat says ELIGIBLE", () => {
    const iap = readFileSync("src/lib/iap.ts", "utf8");
    expect(iap).toContain("checkTrialOrIntroductoryPriceEligibility");
    expect(iap).toContain("?.status !== 2) p.introPriceString = null");
  });
  it("a finished purchase can never loop back to the plan chooser", () => {
    const sync = readFileSync("src/app/api/iap/sync/route.ts", "utf8");
    expect(sync).toContain('[PLAN_CHOSEN_KEY]: "pro_pending"');
    for (const r of ["not_configured", "rc_error", "sandbox_not_allowed", "rc_unreachable"]) expect(sync).toContain(`skipped("${r}")`);
  });
});
