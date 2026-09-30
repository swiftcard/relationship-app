import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

// ── SwiftCard on Apple Watch ────────────────────────────────────────────────
//
// The watch app is native SwiftUI inside the Capacitor project, and almost
// every way it can break is invisible to a type check, a lint and a passing
// build:
//
//   • A target that exists on disk but not in project.pbxproj compiles nothing.
//     That exact thing happened to the home-screen widget: its source sat in
//     the repo for weeks while the shipped app had no widget at all.
//   • A watch app that builds but is not EMBEDDED produces a normal .ipa with
//     no watch app inside it. Apple accepts it and review passes.
//   • WKCompanionAppBundleIdentifier is the only thing making the pair a pair.
//     One character wrong and the app installs and never receives a card.
//   • CoreImage does not exist on watchOS. An `import CoreImage` in watch code
//     fails to resolve the module — so the QR has to be encoded on the phone,
//     and the day someone "simplifies" that by moving it back, the watch stops
//     building entirely.
//
// These are source guards, not behaviour tests: CI has no Xcode. The behaviour
// was verified by running the app on the watch simulator and reading the QR
// back out of the screenshot with a scanner.

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8");

/**
 * Swift with its comments removed.
 *
 * Needed because these files explain at length WHY CoreImage cannot be used on
 * the watch — naming the API they must not call. A guard that reads comments
 * fails on the very documentation that keeps the rule alive.
 */
const code = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const APP_GROUP = "group.me.swiftcard.app";
const WATCH_BUNDLE = "me.swiftcard.app.watchkitapp";
const COMPLICATION_BUNDLE = "me.swiftcard.app.watchkitapp.widget";

describe("the watch targets are in the Xcode project, not just on disk", () => {
  const proj = read("ios/App/App.xcodeproj/project.pbxproj");

  it("both targets exist and are the right product types", () => {
    expect(proj).toContain("SwiftCardWatch");
    expect(proj).toContain("SwiftCardWatchWidgetExtension");
    // The watch app is an APPLICATION (single-target watch app, watchOS 7+),
    // not an extension. The old app+extension pair is gone.
    expect(proj).toMatch(/BB0000000000000000000001 \/\* SwiftCardWatch \*\/ = \{[\s\S]*?productType = "com\.apple\.product-type\.application";/);
  });

  it("every watch source file is compiled by a target", () => {
    for (const file of [
      "SwiftCardWatchApp.swift",
      "ContentView.swift",
      "WatchCard.swift",
      "WatchCardStore.swift",
      "SwiftCardWatchWidget.swift",
    ]) {
      expect(proj).toContain(`${file} in Sources`);
    }
  });

  it("WatchCard.swift is compiled into BOTH watch targets", () => {
    // The app writes the card and the complication reads it. They agree on the
    // suite, the key and the shape because they share this one file — not
    // because two copies were kept in step by hand.
    //
    // Counting PBXBuildFile DEFINITIONS pointing at the one file reference:
    // two of them, one per target. Counting "in Sources" instead would find
    // four, because each definition is also listed inside its build phase.
    const builds = proj.match(/= \{isa = PBXBuildFile; fileRef = BB000000000000000000000C/g) ?? [];
    expect(builds.length).toBe(2);
  });

  it("the watch app is embedded in the iPhone app, or it never installs", () => {
    expect(proj).toContain("Embed Watch Content");
    // dstSubfolderSpec 16 + this dstPath is the one shape iOS looks in.
    expect(proj).toMatch(/dstPath = "\$\(CONTENTS_FOLDER_PATH\)\/Watch";/);
    expect(proj).toMatch(/dstSubfolderSpec = 16;/);
    expect(proj).toContain("SwiftCardWatch.app in Embed Watch Content");
  });

  it("the complication is embedded in the watch app", () => {
    expect(proj).toContain("SwiftCardWatchWidgetExtension.appex in Embed Foundation Extensions");
  });

  it("the watch targets build for watchOS, not for the project's iPhone default", () => {
    // The PROJECT-level configs say SDKROOT = iphoneos. Without a per-target
    // override the watch targets fail before compiling a line.
    const watchSdk = proj.match(/SDKROOT = watchos;/g) ?? [];
    expect(watchSdk.length).toBe(4); // debug + release, two targets
    const family = proj.match(/TARGETED_DEVICE_FAMILY = 4;/g) ?? [];
    expect(family.length).toBe(4);
  });

  it("bundle ids nest under the iPhone app's", () => {
    expect(proj).toContain(`PRODUCT_BUNDLE_IDENTIFIER = ${WATCH_BUNDLE};`);
    expect(proj).toContain(`PRODUCT_BUNDLE_IDENTIFIER = ${COMPLICATION_BUNDLE};`);
  });

  it("versions stay in lockstep with the iPhone app", () => {
    // App Store upload rejects a watch app whose version differs from its
    // companion, and the failure arrives after a full archive and upload.
    const marketing = new Set(proj.match(/MARKETING_VERSION = [^;]+;/g) ?? []);
    const build = new Set(proj.match(/CURRENT_PROJECT_VERSION = [^;]+;/g) ?? []);
    expect(marketing.size).toBe(1);
    expect(build.size).toBe(1);
  });
});

describe("the watch app declares itself correctly to watchOS", () => {
  const plist = read("ios/App/SwiftCardWatch/Info.plist");

  it("is a modern single-target watch app", () => {
    expect(plist).toContain("<key>WKApplication</key>");
    // WKWatchKitApp is the retired two-target shape; setting it instead builds
    // fine and then fails to install with no useful diagnostic. Matched as a
    // KEY, because the plist's own comment names it to explain why it is gone.
    expect(plist).not.toContain("<key>WKWatchKitApp</key>");
  });

  it("names the iPhone app it belongs to", () => {
    expect(plist).toContain("<key>WKCompanionAppBundleIdentifier</key>");
    expect(plist).toContain("<string>me.swiftcard.app</string>");
    // Must be the App target's real bundle id, or the pair never pairs.
    expect(read("ios/App/App.xcodeproj/project.pbxproj"))
      .toContain("PRODUCT_BUNDLE_IDENTIFIER = me.swiftcard.app;");
  });

  it("runs without the phone, because the card is cached on the watch", () => {
    expect(plist).toContain("<key>WKRunsIndependentlyOfCompanionApp</key>");
  });

  it("the complication is a WidgetKit extension", () => {
    expect(read("ios/App/SwiftCardWatchWidget/Info.plist"))
      .toContain("com.apple.widgetkit-extension");
  });

  it("both watch targets carry the App Group", () => {
    // Without it the complication cannot read what the app received and sits on
    // its empty state forever.
    expect(read("ios/App/SwiftCardWatch/SwiftCardWatch.entitlements")).toContain(APP_GROUP);
    expect(read("ios/App/SwiftCardWatchWidget/SwiftCardWatchWidget.entitlements")).toContain(APP_GROUP);
  });

  it("both watch bundles ship a privacy manifest — UserDefaults is a required-reason API", () => {
    // The phone app and the phone widget declare it; a nested bundle without
    // one draws ITMS-91053 at upload. Both must also be in the Resources phase
    // or the file sits in the repo and never reaches the bundle.
    const proj = read("ios/App/App.xcodeproj/project.pbxproj");
    for (const dir of ["SwiftCardWatch", "SwiftCardWatchWidget"]) {
      const m = read(`ios/App/${dir}/PrivacyInfo.xcprivacy`);
      expect(m).toContain("NSPrivacyAccessedAPICategoryUserDefaults");
      expect(m).toContain("<string>1C8F.1</string>");
      expect(m).toContain("<key>NSPrivacyTracking</key>\n\t<false/>");
    }
    expect(proj).toContain("BB0000000000000000000025 /* PrivacyInfo.xcprivacy in Resources */,");
    expect(proj).toContain("CC0000000000000000000025 /* PrivacyInfo.xcprivacy in Resources */,");
  });

  it("ships an app icon — watchOS will not install without one", () => {
    expect(existsSync(join(root, "ios/App/SwiftCardWatch/Assets.xcassets/AppIcon.appiconset/Contents.json"))).toBe(true);
    expect(read("ios/App/SwiftCardWatch/Assets.xcassets/AppIcon.appiconset/Contents.json"))
      .toContain('"platform" : "watchos"');
  });
});

describe("the phone is what feeds the watch", () => {
  const bridge = read("ios/App/App/WatchSessionBridge.swift");
  const widget = read("ios/App/App/WidgetBridge.swift");
  const delegate = read("ios/App/App/AppDelegate.swift");

  it("reads the SAME slot the home-screen widget renders", () => {
    // One source of truth for "the active card". Two would drift.
    expect(bridge).toContain(`appGroup = "${APP_GROUP}"`);
    expect(bridge).toContain('storeKey = "widget_card"');
  });

  it("uses application context, not messages or queued transfers", () => {
    // sendMessage needs the watch app running; transferUserInfo replays a
    // backlog of stale cards. Only application context is a latest-value slot.
    expect(bridge).toMatch(/updateApplicationContext\(/);
    expect(bridge).not.toMatch(/transferUserInfo\(/);
  });

  it("publishes on every card change, including sign-out", () => {
    // Two calls in WidgetBridge: setCard and clearCard. A watch left showing
    // the previous account's QR is the handed-on-device problem clearCard
    // exists to prevent.
    const calls = widget.match(/WatchSessionBridge\.shared\.publishCurrentCard\(\)/g) ?? [];
    expect(calls.length).toBe(2);
  });

  it("activates at launch and re-publishes on every foreground", () => {
    // The webview may never call setCard in a session where nothing changed,
    // so a watch that missed the last update needs another chance. Launch is
    // the AppDelegate's; "every foreground" is sceneDidBecomeActive — under
    // the UIScene lifecycle (required by iOS 27) UIKit never calls
    // applicationDidBecomeActive, so a re-publish left there is dead code.
    expect(delegate).toMatch(/WatchSessionBridge\.shared\.activate\(\)/);
    const scene = read("ios/App/App/SceneDelegate.swift");
    expect(scene).toMatch(/func sceneDidBecomeActive[\s\S]*?WatchSessionBridge\.shared\.publishCurrentCard\(\)/);
    expect(delegate).not.toMatch(/applicationDidBecomeActive/);
  });

  it("stamps each payload so an unchanged card is not skipped as a duplicate", () => {
    expect(bridge).toContain('context["updatedAt"]');
  });

  it("implements the two delegate methods iOS requires", () => {
    // Not optional on iOS: omitting them fails to compile, and re-activating in
    // sessionDidDeactivate is what binds a newly paired watch.
    expect(bridge).toMatch(/func sessionDidBecomeInactive\(/);
    expect(bridge).toMatch(/func sessionDidDeactivate\(/);
  });
});

describe("the QR is encoded on the phone because watchOS cannot do it", () => {
  const bridge = read("ios/App/App/WatchSessionBridge.swift");
  const card = read("ios/App/SwiftCardWatch/WatchCard.swift");
  const view = read("ios/App/SwiftCardWatch/ContentView.swift");
  const store = read("ios/App/SwiftCardWatch/WatchCardStore.swift");
  const complication = read("ios/App/SwiftCardWatchWidget/SwiftCardWatchWidget.swift");

  it("the phone generates the module grid", () => {
    expect(bridge).toContain("qrCodeGenerator");
    expect(bridge).toMatch(/static func qrMatrix\(/);
    expect(bridge).toContain('payload["qrBits"]');
  });

  it("NO watch source imports CoreImage — the module does not exist there", () => {
    // This is the guard that matters most in this file. `import CoreImage` in
    // any watch target fails to resolve before compiling a line, so a
    // well-meaning "just generate it on the watch like the widget does" breaks
    // the build outright rather than degrading.
    for (const src of [card, view, store, complication]) {
      expect(code(src)).not.toMatch(/^import CoreImage/m);
      expect(code(src)).not.toContain("qrCodeGenerator");
    }
  });

  it("the watch draws the grid as vector rects", () => {
    expect(card).toContain("struct WatchQRCode");
    expect(card).toMatch(/Canvas \{/);
    expect(view).toContain("WatchQRCode(modules:");
  });

  it("the grid packing agrees on both sides — MSB first, row-major", () => {
    // A grid unpacked the other way round still looks like a QR code and
    // scans as nothing at all.
    expect(bridge).toMatch(/packed\[index \/ 8\] \|= \(1 << \(7 - UInt8\(index % 8\)\)\)/);
    expect(card).toMatch(/\(byte >> \(7 - UInt8\(index % 8\)\)\) & 1 == 1/);
  });

  it("the phone does NOT flip rows — a bitmap context is already top-down", () => {
    // CoreGraphics DRAWS from the bottom left, but the bytes of a bitmap
    // context are stored top row first. The first version flipped the rows
    // and shipped a vertically mirrored QR; it "scanned" only because most
    // decoders tolerate a mirror. Proven by decoding the grid and checking the
    // corner with no finder pattern (must be bottom-right).
    expect(bridge).toContain("pixels[y * width + x]");
    expect(bridge).not.toContain("pixels[(height - 1 - y)");
  });

  it("the grid is optional, so an older cached card still shows something", () => {
    expect(card).toMatch(/let qrWidth: Int\?/);
    expect(card).toMatch(/let qrBits: String\?/);
  });
});

describe("the watch never lies about what it can do", () => {
  const view = read("ios/App/SwiftCardWatch/ContentView.swift");
  const store = read("ios/App/SwiftCardWatch/WatchCardStore.swift");

  it('only offers "Scan to connect" when there IS a code', () => {
    expect(view).toMatch(/if card\.qrModules != nil \{[\s\S]{0,200}Scan to connect/);
  });

  it("stops saying it is connecting if activation never completes", () => {
    // Found by running it on a watch simulator with no paired phone: the app
    // sat on "Checking your iPhone…" indefinitely.
    expect(store).toMatch(/asyncAfter\(deadline: \.now\(\) \+ 3\)/);
  });

  it("renders from the cache before any session work, so a raised wrist is instant", () => {
    expect(store).toMatch(/card = WatchCardStorage\.load\(\)[\s\S]{0,80}super\.init\(\)/);
  });

  it("clears when the phone signs out", () => {
    expect(store).toMatch(/let payload = context\["card"\] as\? \[String: String\]/);
    // A nil card must actually erase the stored one, not be ignored.
    expect(read("ios/App/SwiftCardWatch/WatchCard.swift"))
      .toMatch(/removeObject\(forKey: WATCH_STORE_KEY\)/);
  });
});

describe("a release would actually contain the watch app", () => {
  const exportOptions = read("ios/App/ExportOptions.plist");
  const provision = read("scripts/asc-provision.mjs");
  const release = read("scripts/ios-release.sh");

  it("every shipped bundle id has a provisioning profile mapped", () => {
    for (const id of ["me.swiftcard.app", "me.swiftcard.app.SwiftCardWidgetExtension", WATCH_BUNDLE, COMPLICATION_BUNDLE]) {
      expect(exportOptions).toContain(`<key>${id}</key>`);
    }
  });

  it("the provisioning script mints profiles for all four", () => {
    expect(provision).toContain(WATCH_BUNDLE);
    expect(provision).toContain(COMPLICATION_BUNDLE);
    expect(provision).toContain("SwiftCard Watch App Store");
    expect(provision).toContain("SwiftCard Watch Complication App Store");
  });

  it("the release gate fails a build with no watch app in it", () => {
    // The whole point of the gate: a copy-files phase that stops running
    // produces a valid .ipa that silently has no watch app, and nothing else
    // in the toolchain says a word about it.
    expect(release).toContain("Watch/SwiftCardWatch.app");
    expect(release).toMatch(/missing\+=\("Watch\/SwiftCardWatch\.app/);
    expect(release).toMatch(/missing\+=\("watch complication \.appex/);
  });
});
