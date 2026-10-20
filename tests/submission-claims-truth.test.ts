import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8");

// Everything a reviewer is told the app does, they will try. A feature that is
// described but absent is a Guideline 2.1 rejection; a description that
// oversells is 2.3. This file exists because Apple Wallet was promised in the
// App Store description, the reviewer notes, and the watchOS justification
// while `/api/wallet/pass` returned 501 not_configured in production and no
// APPLE_PASS_* env vars had ever been set. The button was correctly gated, so
// nothing looked broken locally — the claim was the only broken part.
describe("submission copy only claims features that are actually configured", () => {
  const notes = read("app-store/APP_REVIEW_NOTES.md");
  const description = read("docs/ios-review/APP-STORE-METADATA.md");
  const testPlan = read("app-store/TESTFLIGHT_TEST_PLAN.md");

  // Wallet needs all five of these at runtime (src/lib/wallet-config.ts).
  // If someone turns Wallet on, they must set them in Vercel AND update this
  // test's expectations in the same change — that is the point.
  it("wallet-config still requires the env vars this test reasons about", () => {
    const cfg = read("src/lib/wallet-config.ts");
    for (const v of [
      "APPLE_PASS_TYPE_ID",
      "APPLE_TEAM_ID",
      "APPLE_PASS_CERT_PEM",
      "APPLE_PASS_KEY_PEM",
      "APPLE_WWDR_PEM",
    ]) {
      expect(cfg).toContain(v);
    }
  });

  it("Google Wallet stays gated behind hasGoogleWalletConfig()", () => {
    // The Android twin of the rule below: no Google Wallet button, prompt or
    // assistant answer until its three keys exist.
    const cfg = read("src/lib/google-wallet-config.ts");
    for (const v of ["GOOGLE_WALLET_ISSUER_ID", "GOOGLE_WALLET_CLIENT_EMAIL", "GOOGLE_WALLET_PRIVATE_KEY"]) expect(cfg).toContain(v);
    const dash = read("src/app/dashboard/page.tsx");
    expect(dash).toContain("hasGoogleWalletConfig()");
    expect(dash).toMatch(/googleWallet:\s*googleWalletEnabled/);
    expect(read("src/app/api/wallet/google/route.ts")).toMatch(/if \(!hasGoogleWalletConfig\(\)\)/);
    expect(read("src/lib/knowledge/derived.ts")).toMatch(/"wallet\.android": \(\) => hasGoogleWalletConfig\(\)/);
  });

  it("the Add to Wallet button stays gated behind hasWalletConfig()", () => {
    // The gate is what keeps an unconfigured Wallet from rendering a button
    // that errors. Losing it is worse than the copy problem.
    //
    // The button MOVED out of the dashboard's "Your Card" box and into the
    // "Other ways to share" modal, so the gate moved with it: the dashboard now
    // passes the card slug only when walletEnabled, and MoreShareOptions renders
    // nothing without one. Both halves are asserted — checking only the dashboard
    // would pass even if the modal rendered the button unconditionally.
    const dash = read("src/app/dashboard/page.tsx");
    expect(dash).toMatch(/walletUsername=\{\s*walletEnabled\s*\?/);
    expect(dash).toContain("hasWalletConfig()");

    const modal = read("src/components/MoreShareOptions.tsx");
    expect(modal).toMatch(/\{walletUsername\s*&&/);
    expect(modal).toMatch(/<AddToWalletButton\s+username=\{walletUsername\}/);
  });

  it("the public card page never offers Add to Wallet — not even to the owner", () => {
    // A visitor's Wallet should hold their own card, not a stranger's — and per
    // the owner's 2026-08-10 decision the card page doesn't show the button to
    // the owner either: that page is the visitor's save-contact surface. Wallet
    // lives only in the owner's own sharing surfaces (dashboard button and
    // MoreShareOptions, pinned above).
    const cardPage = read("src/app/[username]/page.tsx");
    expect(cardPage).not.toMatch(/AddToWalletButton/);
    expect(cardPage).not.toMatch(/hasWalletConfig/);
  });

  // Apple Wallet went LIVE 2026-08-10: Pass Type ID pass.me.swiftcard.card,
  // and /api/wallet/pass verified serving a signed .pkpass in production. The
  // claims are back — so this guard flips direction: they may exist ONLY while
  // the safety nets hold. The button gate (above) keeps an env regression from
  // rendering a broken control, and the uptime health check turns a quiet 501
  // back into an opened issue before a reviewer can find it.
  it("wallet claims are present again — the feature is real now", () => {
    expect(notes).toMatch(/Add to Apple Wallet/i);
    const body = description.slice(description.indexOf("## Description"));
    expect(body).toMatch(/Apple Wallet/i);
    expect(testPlan).toMatch(/Apple Wallet/);
  });

  it("…but only alongside the health-check probe that keeps them honest", () => {
    const hc = read("scripts/health-check.mjs");
    expect(hc).toMatch(/api\/wallet\/pass/);
    expect(hc).toMatch(/vnd\.apple\.pkpass/);
  });

  it("the watchOS justification may lean on Wallet again — it is real now", () => {
    const limits = read("app-store/KNOWN_LIMITATIONS.md");
    const watchRow = limits.split("\n").find((l) => l.includes("watchOS app")) ?? "";
    expect(watchRow).toMatch(/Wallet pass syncs to Watch Wallet/);
  });
});

// App Store Connect attaches a build to the version record whose string matches
// CFBundleShortVersionString exactly, and it rejects an upload outright when an
// embedded extension's version differs from its host app's. Both are silent
// until the moment you try to ship.
describe("version numbers line up for upload", () => {
  const proj = read("ios/App/App.xcodeproj/project.pbxproj");
  const metadata = read("docs/ios-review/APP-STORE-METADATA.md");

  it("every target builds the version the metadata promises", () => {
    const documented = metadata.match(/^- (\d+\.\d+\.\d+), build (\d+)\./m);
    expect(documented, "APP-STORE-METADATA.md ## Version line").not.toBeNull();
    const [, version, build] = documented!;

    const marketing = [...proj.matchAll(/MARKETING_VERSION = ([^;]+);/g)].map((m) => m[1]);
    const current = [...proj.matchAll(/CURRENT_PROJECT_VERSION = ([^;]+);/g)].map((m) => m[1]);
    // Debug + Release for each of the four targets: the app, the home-screen
    // widget, the Apple Watch app and the watch complication. Every one of
    // them ends up inside the same .ipa, and Apple rejects the upload if any
    // two disagree.
    expect(marketing).toHaveLength(8);
    expect(current).toHaveLength(8);
    expect(new Set(marketing)).toEqual(new Set([version]));
    expect(new Set(current)).toEqual(new Set([build]));
  });

  it("every embedded bundle inherits its version instead of hardcoding one", () => {
    // Hardcoding here is how app and extension drift apart between releases.
    for (const path of [
      "ios/App/SwiftCardWidget/Info.plist",
      "ios/App/SwiftCardWatch/Info.plist",
      "ios/App/SwiftCardWatchWidget/Info.plist",
    ]) {
      expect(read(path), path).toContain("$(MARKETING_VERSION)");
      expect(read(path), path).toContain("$(CURRENT_PROJECT_VERSION)");
    }
  });
});
