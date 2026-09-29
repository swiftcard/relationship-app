import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8");
const fileExists = (p: string) => existsSync(join(root, p));

// ── Final App Store audit (2026-07-17) — locks for every fix in this pass ────

describe("3.1.1 — /pricing and /upgrade never PAINT on native (render guard, not just redirect)", () => {
  it("/pricing has the hydration-safe render guard", () => {
    const s = read("src/app/pricing/page.tsx");
    expect(s).toMatch(/useIsNativeApp/);
    expect(s).toMatch(/if \(native\) return null;/);
  });
  it("/upgrade on native sells via IAP only — StoreKit prices, no web checkout", () => {
    // Changed 2026-08-27 (IAP live): the native branch now RENDERS an
    // In-App-Purchase upgrade screen instead of returning null. The 3.1.1
    // guarantee it must keep: no web price and no /checkout path can paint in
    // the shell — the only prices come from StoreKit inside the paywall.
    const s = read("src/app/upgrade/UpgradeClient.tsx");
    expect(s).toMatch(/useIsNativeApp/);
    expect(s).toMatch(/canOfferIap/);
    expect(s).toMatch(/IapSubscribeButton/);
    const nb = s.slice(s.indexOf("if (native) {"), s.indexOf("\n  return (", s.indexOf("if (native) {")));
    expect(nb, "native branch paints a web price or checkout link").not.toMatch(/PLAN_PRICES|proCents|officeTotal|money\(|\/checkout/);
  });
});

describe("3.1.1 — RemoveMemberButton skips the seat-price step on native", () => {
  const s = read("src/components/office/TeamActions.tsx");
  it("gates the post-removal seat step behind !native", () => {
    expect(s).toMatch(/canManageSeats && !native/);
  });
});

describe("3.1.1 — billing components self-suppress on native (backstop)", () => {
  it("BillingManager's native branch sells via IAP only, with no web machinery", () => {
    const s = read("src/components/BillingManager.tsx");
    expect(s).toMatch(/useIsNativeApp/);
    // Third posture (App Review 3.1.1): `return null` → rejected; external
    // link-out → rejected (IAP required under 3.1.3(b)); now the branch offers
    // the In-App Purchase paywall, and Apple-billed subs manage via the App
    // Store sheet.
    const start = s.indexOf("if (native) {");
    expect(start, "native branch missing").toBeGreaterThan(-1);
    // The branch ends where the web render resumes (the web loading row).
    const end = s.indexOf("Loading billing…");
    const branch = s.slice(start, end);
    expect(branch).toMatch(/IapSubscribeButton/);
    expect(branch).toMatch(/manageIapSubscription/);
    // The link-out era must not resurface: steering to web checkout from the
    // shell is a 3.1.1 risk now that IAP exists.
    expect(branch).not.toContain("ExternalPurchaseButton");
    // None of the web manager's machinery may leak into the shell: no prices,
    // no renewal amounts, no seats, no plan switcher, no Stripe portal.
    for (const banned of ["formatUsd", "renewalLine", "PLAN_PRICES", "ManageBillingButton", "seat", "$"]) {
      expect(branch, `native branch contains ${banned}`).not.toContain(banned);
    }
  });
  it("ManageBillingButton (Stripe portal) returns null on native", () => {
    const s = read("src/components/ManageBillingButton.tsx");
    expect(s).toMatch(/useIsNativeApp/);
    expect(s).toMatch(/if \(native\) return null;/);
  });
});

describe("2.1 — NFC 'Write to a tag' button is hidden on native (manual path only)", () => {
  const s = read("src/components/NFCWriter.tsx");
  it("imports the hydration-safe hook and gates the button", () => {
    expect(s).toMatch(/useIsNativeApp/);
    expect(s).toMatch(/\{!isNative && \(/);
  });
  it("keeps the manual copy-link path unconditional (works everywhere)", () => {
    expect(s).toMatch(/Or write it yourself with an NFC app/);
  });
});

describe("1.2 UGC — report mechanism + admin takedown", () => {
  it("ReportCardLink renders only on native and routes to the contact form", () => {
    const s = read("src/components/ReportCardLink.tsx");
    expect(s).toMatch(/useIsNativeApp/);
    expect(s).toMatch(/if \(!native\) return null;/);
    expect(s).toMatch(/\/contact\?topic=report&card=/);
  });
  it("public card page mounts ReportCardLink", () => {
    expect(read("src/app/[username]/page.tsx")).toMatch(/<ReportCardLink username=\{username\} \/>/);
  });
  it("Swift Links page mounts ReportCardLink", () => {
    expect(read("src/app/links/[username]/page.tsx")).toMatch(/<ReportCardLink username=\{username\} \/>/);
  });
  it("contact form adds the report topic ONLY in report mode (web unchanged)", () => {
    const s = read("src/app/contact/page.tsx");
    expect(s).toMatch(/const REPORT_TOPIC = "Report a public card";/);
    expect(s).toMatch(/reportMode \? \[REPORT_TOPIC, \.\.\.TOPICS\] : \[\.\.\.TOPICS\]/);
  });
  it("admin PATCH supports the reversible cardOffline takedown, ownership-checked", () => {
    const s = read("src/app/api/admin/users/[id]/route.ts");
    expect(s).toMatch(/cardOffline/);
    expect(s).toMatch(/card\.user_id !== id/);
    expect(s).toMatch(/update\(\{ is_offline: offline \}\)/);
  });
});

describe("2.3.1 — native honesty notes on aspirational product pages", () => {
  it("NativeFeatureNote renders null off-native", () => {
    const s = read("src/components/NativeFeatureNote.tsx");
    expect(s).toMatch(/if \(!native\) return null;/);
  });
  it("watch + wallet pages carry the in-app clarifier", () => {
    const s = read("src/app/products/[slug]/page.tsx");
    expect(s).toMatch(/watchOS app is on our roadmap/);
    expect(s).toMatch(/NativeFeatureNote/);
  });
});

describe("5.1.1 — deletion dialog disclosures", () => {
  it("office owners see the team-consequence warning", () => {
    const s = read("src/components/ManageAccount.tsx");
    expect(s).toMatch(/isOfficeOwner/);
    expect(s).toMatch(/cancels your team&apos;s subscription immediately/);
  });
  it("settings passes the real office-owner flag", () => {
    expect(read("src/app/settings/flows/page.tsx")).toMatch(/isOfficeOwner=\{!!officeCtx\?\.isOwner\}/);
  });
  it("email-reuse copy is window-scoped (matches the actual purge behavior)", () => {
    expect(read("src/components/ManageAccount.tsx")).toMatch(/while the account is held/);
    expect(read("src/app/account-deleted/page.tsx")).toMatch(/while the deleted account is held/);
  });
});

describe("open signups (invite-only removed)", () => {
  it("the site is public (no lockdown gate in proxy)", () => {
    const s = read("src/proxy.ts");
    expect(s).not.toMatch(/LOCKDOWN|SITE_PUBLIC|isPublicPath/);
  });
  it("the signup-invite lib and verify endpoint are gone", () => {
    expect(fileExists("src/lib/signup-invite.ts")).toBe(false);
    expect(fileExists("src/app/api/invite/verify/route.ts")).toBe(false);
  });
  it("onboarding no longer gates signup on an invite code — it provisions anyone", () => {
    const s = read("src/app/onboarding/page.tsx");
    expect(s).not.toMatch(/invitedByCode/);
    expect(s).not.toMatch(/error=invite_only/);
    expect(s).not.toMatch(/consumeSignupInvite/);
    // Still provisions a brand-new account (the profiles insert survives).
    expect(s).toMatch(/from\("profiles"\)\.insert/);
  });
  it("LoginForm has no invite-code field or verification", () => {
    const s = read("src/components/LoginForm.tsx");
    expect(s).not.toMatch(/ensureInviteVerified/);
    expect(s).not.toMatch(/placeholder="Invite code"/);
    expect(s).not.toMatch(/invite-only/i);
  });
});

describe("Universal Links — no link opens the app, office invites included", () => {
  // Owner, 2026-09-29: links never open in the app. An Office invite opens in
  // the browser, where /join/[token] works signed in or out.
  const s = read("src/lib/universal-links.ts");
  it("claims no path", () => {
    expect(s).not.toContain('"/join/*"');
    expect(s).toContain('"NOT /*"');
  });
});

describe("native OAuth 'next' survives cold kill (localStorage, not sessionStorage)", () => {
  const s = read("src/lib/native-auth.ts");
  it("stash/consume use localStorage", () => {
    expect(s).toMatch(/localStorage\.setItem\(NEXT_KEY/);
    expect(s).toMatch(/localStorage\.getItem\(NEXT_KEY/);
    expect(s).not.toMatch(/sessionStorage\./); // no sessionStorage API calls (comments may mention it)
  });
});

describe("iOS shell config hardening", () => {
  it("allowNavigation drops the unused OAuth provider hosts", () => {
    // Read the COMMITTED source (capacitor.config.ts); the generated .json is
    // gitignored, so it's absent on a fresh checkout / in CI. Assert each allowed
    // host is present and the removed OAuth-provider hosts are NOT.
    const s = read("capacitor.config.ts");
    expect(s).toContain('"swiftcard.me"');
    expect(s).toContain('"www.swiftcard.me"');
    expect(s).toContain('"grxmovpmlgmjncnyiyrt.supabase.co"');
    expect(s).not.toMatch(/allowNavigation:[\s\S]*"accounts\.google\.com"/);
    expect(s).not.toMatch(/allowNavigation:[\s\S]*"appleid\.apple\.com"/);
  });
  it("privacy manifests exist for app and widget targets", () => {
    const app = read("ios/App/App/PrivacyInfo.xcprivacy");
    expect(app).toContain("NSPrivacyAccessedAPICategoryUserDefaults");
    expect(app).toContain("1C8F.1");
    const widget = read("ios/App/SwiftCardWidget/PrivacyInfo.xcprivacy");
    expect(widget).toContain("1C8F.1");
  });
  it("app-target manifest is wired into the Xcode Resources phase", () => {
    const pbx = read("ios/App/App.xcodeproj/project.pbxproj");
    expect(pbx).toMatch(/PrivacyInfo\.xcprivacy in Resources/);
  });
  it("Info.plist requires arm64 (not the retired armv7)", () => {
    const s = read("ios/App/App/Info.plist");
    expect(s).toContain("<string>arm64</string>");
    expect(s).not.toContain("armv7");
  });
});

describe("security hardening locks", () => {
  it("unsubscribe HMAC has no hardcoded fallback secret", () => {
    const s = read("src/lib/messaging.ts");
    expect(s).not.toContain('"swiftcard-unsub"');
    expect(s).toMatch(/refusing to sign unsubscribe tokens/);
  });
  it("oauth-state signs only with OAUTH_SECRET and fails closed", () => {
    const s = read("src/lib/oauth-state.ts");
    expect(s).not.toMatch(/SUPABASE_SERVICE_ROLE_KEY/);
    expect(s).toMatch(/refusing to sign OAuth state/);
  });
  it("token-crypto writes GCM and still reads legacy CBC", () => {
    const s = read("src/lib/token-crypto.ts");
    expect(s).toMatch(/aes-256-gcm/);
    expect(s).toMatch(/aes-256-cbc/);
    expect(s).toMatch(/v2:/);
  });
  it("upload validates GIF magic bytes", () => {
    expect(read("src/app/api/upload/route.ts")).toMatch(/GIF87a/);
  });
  it("push subscribe validates endpoint shape and is throttled", () => {
    const s = read("src/app/api/push/subscribe/route.ts");
    expect(s).toMatch(/isSafePushEndpoint/);
    expect(s).toMatch(/isRateLimited/);
  });
  it("previously-uncapped authenticated routes are rate limited", () => {
    for (const p of [
      "src/app/api/ai/help/route.ts",
      "src/app/api/ai/suggest-messages/route.ts",
      "src/app/api/leads/export/route.ts",
      "src/app/api/office/analytics/export/route.ts",
      "src/app/api/account/delete/route.ts",
      "src/app/api/upload/route.ts",
      "src/app/api/drafts/claim/route.ts",
    ]) {
      expect(read(p), p).toMatch(/isRateLimited/);
    }
  });
  it("the upload rate limit is on the EXPENSIVE POST handler (not just DELETE)", () => {
    const s = read("src/app/api/upload/route.ts");
    // Isolate the POST handler body and assert the guard lives inside it.
    const postBody = s.slice(s.indexOf("export async function POST"));
    expect(postBody).toMatch(/isRateLimited\(`upload:\$\{user\.id\}`/);
  });
  it("push endpoints are SSRF-checked at registration and delivery", () => {
    const sub = read("src/app/api/push/subscribe/route.ts");
    expect(sub).toMatch(/assertSafeUrl/);
    expect(sub).toMatch(/isSafePushEndpoint/);
    expect(read("src/lib/push.ts")).toMatch(/assertSafeUrl/);
  });
});

describe("2.1 — file downloads hand off to the system browser on native (WKWebView can't save)", () => {
  it("native-file helper only acts on native and returns false on web", () => {
    const s = read("src/lib/native-file.ts");
    expect(s).toMatch(/detectNativeApp\(\)/);
    expect(s).toMatch(/@capacitor\/browser/);
  });
  it("public vCard endpoint exists, respects the kill-switch, and escapes via buildVCard", () => {
    const s = read("src/app/api/card/[username]/vcard/route.ts");
    expect(s).toMatch(/isCardActive/);
    expect(s).toMatch(/buildVCard/);
    expect(s).toMatch(/text\/vcard/);
  });
  it("SaveContactButton routes the vCard through the system browser on native", () => {
    expect(read("src/components/SaveContactButton.tsx")).toMatch(/openFileViaSystemBrowser/);
  });
  it("in-app contact .vcf routes to the server vCard on native", () => {
    expect(read("src/components/ContactsClient.tsx")).toMatch(/openFileViaSystemBrowser/);
  });
  it("CSV export links use the native-aware DownloadLink", () => {
    expect(read("src/app/contacts/page.tsx")).toMatch(/DownloadLink/);
    expect(read("src/app/office/admin/analytics/EmployeeAnalyticsTable.tsx")).toMatch(/DownloadLink/);
    expect(read("src/components/DownloadLink.tsx")).toMatch(/openFileViaSystemBrowser/);
  });
  it("QR + card-image downloads fall back to the native share sheet", () => {
    expect(read("src/components/QRDownloadButton.tsx")).toMatch(/@capacitor\/share/);
    expect(read("src/components/DownloadCardButton.tsx")).toMatch(/@capacitor\/share/);
  });
});
