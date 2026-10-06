import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isApnsEndpoint, APNS_PREFIX } from "@/lib/apns";

// ── Native-capability wiring for the Capacitor iOS shell ─────────────────────
// These guards assert the shell's native integrations stay wired: the
// system-browser OAuth flow (Google blocks embedded-webview OAuth), APNs push,
// universal-link navigation, native share, and Wallet hand-off. All of it is
// native-gated; the web bundle only ever loads the plugins via dynamic import
// inside detectNativeApp() branches.

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8");

describe("apns endpoint namespacing", () => {
  it("recognizes apns-prefixed endpoints and rejects web push endpoints", () => {
    expect(isApnsEndpoint(`${APNS_PREFIX}abcdef123`)).toBe(true);
    expect(isApnsEndpoint("https://fcm.googleapis.com/fcm/send/xyz")).toBe(false);
    expect(isApnsEndpoint(null)).toBe(false);
    expect(isApnsEndpoint(undefined)).toBe(false);
    expect(isApnsEndpoint("")).toBe(false);
  });
});

describe("push routing splits APNs from web-push", () => {
  const src = read("src/lib/push.ts");
  it("filters subscriptions by isApnsEndpoint and sends via the APNs sender", () => {
    expect(src).toMatch(/isApnsEndpoint/);
    // sendApnsDetailed — the variant that returns Apple's own answer, so a
    // rejected send is never counted as delivered.
    expect(src).toMatch(/sendApnsDetailed/);
    // web-push must stay for browser subscriptions
    expect(src).toMatch(/webpush\.sendNotification/);
  });
  it("prunes dead APNs tokens like web-push prunes 404/410", () => {
    expect(src).toMatch(/result === "gone"[\s\S]*?delete\(\)\.eq\("endpoint", sub\.endpoint\)/);
  });
});

describe("native OAuth uses the system browser, not the webview", () => {
  const login = read("src/components/LoginForm.tsx");
  const auth = read("src/lib/native-auth.ts");
  it("LoginForm's native Google handler routes through startNativeOAuth", () => {
    expect(login).toMatch(/if \(native\) \{[\s\S]*?startNativeOAuth\(supabase, "google", redirectTo, mode\)/);
  });
  it("Apple handler routes through startNativeOAuth", () => {
    expect(login).toMatch(/startNativeOAuth\(supabase, "apple", redirectTo, mode\)/);
  });
  it("native-auth opens the provider URL via @capacitor/browser with skipBrowserRedirect", () => {
    expect(auth).toMatch(/skipBrowserRedirect: true/);
    expect(auth).toMatch(/@capacitor\/browser/);
    expect(auth).toMatch(/swiftcard:\/\/auth-callback/);
  });
  it("completeNativeOAuth only accepts the swiftcard: scheme", () => {
    expect(auth).toMatch(/u\.protocol !== "swiftcard:"\) return false/);
  });
});

describe("NativeAppBridge is mounted and handles links + push taps", () => {
  const layout = read("src/app/layout.tsx");
  const bridge = read("src/components/NativeAppBridge.tsx");
  it("mounted in the root layout", () => {
    expect(layout).toMatch(/<NativeAppBridge \/>/);
  });
  it("no-ops on web (guards on detectNativeApp before any plugin import)", () => {
    expect(bridge).toMatch(/if \(!detectNativeApp\(\)\) return;/);
  });
  it("only navigates to our own origin from universal links", () => {
    expect(bridge).toMatch(/u\.hostname === "swiftcard\.me" \|\| u\.hostname === "www\.swiftcard\.me"/);
  });
  it("push taps only navigate to same-origin paths", () => {
    // Now the shared guard (rejects "//" and "/\\" alike).
    expect(bridge).toMatch(/safeNextPath\(dest\)/);
  });
});

describe("AASA covers the OAuth return path", () => {
  const aasa = read("src/app/.well-known/apple-app-site-association/route.ts");
  // No link opens the app any more (owner, 2026-09-29): the OAuth return is
  // the swiftcard:// scheme, so the AASA excludes every path.
  it("excludes every path — the OAuth return never needed it", () => {
    expect(aasa).toMatch(/paths: \[\.\.\.AASA_PATHS\]/);
    expect(read("src/lib/universal-links.ts")).toMatch(/AASA_PATHS = \["NOT \/\*"\]/);
  });
});

describe("iOS shell project wiring", () => {
  it("Info.plist registers the swiftcard:// scheme and purpose strings", () => {
    const plist = read("ios/App/App/Info.plist");
    expect(plist).toContain("<string>swiftcard</string>");
    expect(plist).toContain("NSCameraUsageDescription");
    expect(plist).toContain("NSPhotoLibraryUsageDescription");
  });
  it("entitlements carry aps-environment and NO associated domains, and are wired into the build", () => {
    // No link may ever open the app (owner, 2026-09-29) — see
    // tests/aasa-card-links.test.ts for the full rule.
    const ent = read("ios/App/App/App.entitlements");
    expect(ent).not.toContain("com.apple.developer.associated-domains");
    expect(ent).not.toContain("applinks:");
    expect(ent).toContain("aps-environment");
    const pbx = read("ios/App/App.xcodeproj/project.pbxproj");
    expect(pbx).toContain("CODE_SIGN_ENTITLEMENTS = App/App.entitlements;");
  });

  // ── The assertion above passed for ten consecutive builds that shipped with
  // NO entitlements at all. It reads the SOURCE .entitlements file and a build
  // setting; neither survives to the binary unless the archive is signed.
  // CODE_SIGNING_ALLOWED=NO skipped ProcessProductPackaging, so no .xcent was
  // ever compiled and exportArchive signed the app with application-identifier
  // and team-identifier only. Push was dead on every device, Universal Links
  // opened Safari, and the widget never read its shared container — with a
  // green test suite throughout. These pin the things that actually decide it.
  it("the release archive is SIGNED, so entitlements are compiled into the binary", () => {
    // Comments explain the old failure and name the flag, so read only the
    // executable lines.
    const code = read("scripts/ios-release.sh")
      .split("\n")
      .filter((l) => !l.trimStart().startsWith("#"))
      .join("\n");
    expect(code).not.toMatch(/CODE_SIGNING_ALLOWED=NO/);
    expect(code).not.toMatch(/CODE_SIGNING_REQUIRED=NO/);
  });

  it("the release script verifies the SIGNED binary's real entitlements before upload", () => {
    const sh = read("scripts/ios-release.sh");
    // Must read them back out of the .ipa — not the profile, which only says
    // what the app is allowed to claim, and disagreed with the binary for ten
    // builds without a single warning from the toolchain.
    expect(sh).toMatch(/codesign -d --entitlements/);
    expect(sh).toMatch(/aps-environment/);
    expect(sh).toMatch(/group\.me\.swiftcard\.app/);
    // Associated domains are now REFUSED, not required: a build that claims
    // links would open other people's cards inside the app.
    expect(sh).toMatch(/if grep -q 'associated-domains' <<<"\$ENTS"; then missing\+=/);
    expect(sh).not.toMatch(/grep -q 'associated-domains' <<<"\$ENTS" \|\|/);
  });

  it("Release signs against the distribution profile with production APNs", () => {
    const pbx = read("ios/App/App.xcodeproj/project.pbxproj");
    expect(pbx).toContain("CODE_SIGN_ENTITLEMENTS = App/AppRelease.entitlements;");
    expect(pbx).toContain('PROVISIONING_PROFILE_SPECIFIER = "SwiftCard App Store";');
    expect(pbx).toContain('PROVISIONING_PROFILE_SPECIFIER = "SwiftCard Widget App Store";');
    // A development aps-environment in a distribution build registers against
    // SANDBOX APNs: registration succeeds, a token is stored, and every send
    // fails with DeviceTokenNotForTopic. Strictly worse than failing loudly.
    const rel = read("ios/App/App/AppRelease.entitlements");
    expect(rel).toContain("<string>production</string>");
    expect(rel).not.toContain("com.apple.developer.associated-domains");
    expect(rel).not.toContain("applinks:");
    expect(rel).toContain("group.me.swiftcard.app");
  });

  // The plugin fires "registration" with retainUntilConsumed FALSE, so an event
  // that lands before the listener is attached is dropped and never redelivered.
  // register() must therefore come after an AWAITED addListener.
  it("push registration attaches its listeners before calling register()", () => {
    const btn = read("src/components/EnablePushButton.tsx");
    expect(btn).toMatch(/await\s+PushNotifications\.addListener\("registration"/);
    expect(btn).toMatch(/await\s+PushNotifications\.addListener\("registrationError"/);
    const attach = btn.indexOf('addListener("registrationError"');
    const register = btn.indexOf("PushNotifications.register()");
    expect(attach).toBeGreaterThan(-1);
    expect(register).toBeGreaterThan(attach);
  });

  it("a push failure reports its real reason instead of being swallowed", () => {
    const btn = read("src/components/EnablePushButton.tsx");
    expect(btn).toMatch(/reportPushFailure/);
    expect(btn).toMatch(/api\/client-error/);
  });

  // 2026-09-03: the App Store 1.0.0 build shipped without the aps-environment
  // entitlement, and every tap on the switch said "check your connection".
  // That build stays on phones until people update, so the copy has to name
  // the update — a connection message on a build defect is a dead end.
  it("an old build without the push entitlement is told to update, not to retry", () => {
    const btn = read("src/components/EnablePushButton.tsx");
    expect(btn).toMatch(/\/aps-environment\/\.test\(result\.error/);
    expect(btn).toMatch(/setReason\("old-build"\)/);
    expect(btn).toContain("Update the app from the App Store");
    // The generic message must NOT show for the old-build case.
    expect(btn).toMatch(/reason !== "old-build" && \(\s*<p[^>]*>Couldn&apos;t turn notifications on/);
  });

  // Owner order 2026-09-03: turning on notifications is one of the first things
  // the app should offer. New accounts get it on "Your card is live!"; existing
  // accounts signing in got nothing — so a banner at the top of the dashboard,
  // gone once push is on or declined.
  //
  // 2026-09-09: it is no longer native-only. Gating it on the iPhone shell
  // excluded everyone who signs up on a laptop, which is most people, and the
  // push table showed it — two registered devices in the whole product. It now
  // renders wherever the switch can actually succeed (state === "idle"), which
  // is the honest gate: an iPhone Safari tab that needs installing first, or a
  // shell with no plugin, still gets nothing here.
  it("the dashboard offers the push switch on every platform that can accept it", () => {
    const nudge = read("src/components/PushNudge.tsx");
    // NOT gated on the native shell — that gate is the bug this replaced.
    expect(nudge).not.toMatch(/useIsNativeApp/);
    expect(nudge).toMatch(/state !== "idle"/);
    expect(nudge).toContain("<EnablePushButton onDone={dismiss} />");
    expect(nudge).toContain("Not now");

    const dash = read("src/app/dashboard/page.tsx");
    const nudgeAt = dash.indexOf("<PushNudge ");
    const trialAt = dash.indexOf("<TrialBanner");
    const cardsAt = dash.indexOf('data-tour="my-cards"');
    expect(nudgeAt).toBeGreaterThan(-1);
    // Top of the page: above the trial banner and the My Cards box.
    expect(nudgeAt).toBeLessThan(trialAt);
    expect(nudgeAt).toBeLessThan(cardsAt);
  });

  // At most two asks, ever. A prompt that keeps returning is the same
  // disrespect as a notification that keeps returning, and it is the reason to
  // trust the product less, not more.
  it("asks at most twice and never invents the number it asks with", () => {
    const nudge = read("src/components/PushNudge.tsx");
    // Stage 0 = never asked, 1 = cold ask declined, 2 = done for good.
    expect(nudge).toMatch(/const asking = stage === 0 \|\| \(stage === 1 && hasActivity\)/);
    expect(nudge).toMatch(/const next = hasActivity \? 2 : 1/);
    // The second ask quotes real views. It must say "opened N times" — never
    // "N people", which the view count does not prove (repeat opens count too).
    expect(nudge).toContain("Your card has been opened");
    expect(nudge).not.toMatch(/\$\{viewCount\} people/);
  });
  it("official Capacitor plugins are dependencies", () => {
    const pkg = JSON.parse(read("package.json"));
    for (const p of ["@capacitor/browser", "@capacitor/app", "@capacitor/push-notifications", "@capacitor/share"]) {
      expect(pkg.dependencies[p]).toBeTruthy();
    }
  });
});

describe("home-screen QR widget wiring", () => {
  it("bridge syncs the active card through the WidgetBridge native plugin", () => {
    const bridge = read("src/components/NativeAppBridge.tsx");
    expect(bridge).toMatch(/Plugins\?\.WidgetBridge/);
    expect(bridge).toMatch(/setCard\(/);
    expect(bridge).toMatch(/source=widget/);
  });
  it("bridge re-syncs the widget + watch when the active card changes, not only on mount", () => {
    // A dashboard card switch is a client-side navigation: NativeAppBridge
    // (root layout) never remounts, so without this the iOS widget and the
    // Apple Watch kept the previous card until the app was relaunched.
    const bridge = read("src/components/NativeAppBridge.tsx");
    const persist = read("src/components/CardSelectionPersist.tsx");
    expect(bridge).toMatch(/window\.addEventListener\(ACTIVE_CARD_EVENT, onActiveCard\)/);
    expect(bridge).toMatch(/window\.removeEventListener\(ACTIVE_CARD_EVENT, onActiveCard\)/);
    expect(bridge).toMatch(/const syncWidgetCard = async \(\) =>/);
    expect(persist).toMatch(/window\.dispatchEvent\(new Event\(ACTIVE_CARD_EVENT\)\)/);
    expect(read("src/lib/active-card.ts")).toContain('ACTIVE_CARD_EVENT = "swiftcard:active-card"');
  });
  // Regression guard for the bug this replaced: @capacitor/preferences' `group`
  // option is only a key prefix on UserDefaults.standard, which lives in the
  // app's own container. A widget extension cannot read it, so routing the card
  // through Preferences left the widget permanently on its empty state.
  it("bridge does NOT route widget data through @capacitor/preferences", () => {
    const bridge = read("src/components/NativeAppBridge.tsx");
    expect(bridge).not.toMatch(/await\s+Preferences\.set/);
    expect(bridge).not.toMatch(/import\("@capacitor\/preferences"\)/);
  });
  it("app + widget entitlements share the app group", () => {
    expect(read("ios/App/App/App.entitlements")).toContain("group.me.swiftcard.app");
    expect(read("ios/App/SwiftCardWidget/SwiftCardWidget.entitlements")).toContain("group.me.swiftcard.app");
  });
  it("WidgetBridge writes the real App Group suite the widget reads", () => {
    const b = read("ios/App/App/WidgetBridge.swift");
    // The suite — not UserDefaults.standard — is what makes the data visible.
    expect(b).toMatch(/UserDefaults\(suiteName:/);
    expect(b).toContain('appGroup = "group.me.swiftcard.app"');
    expect(b).toContain('storeKey = "widget_card"');
    // Without an explicit reload the widget keeps its snapshot for 6 hours.
    expect(b).toMatch(/WidgetCenter\.shared\.reloadTimelines\(ofKind: "SwiftCardQR"\)/);
  });
  it("widget reads the same group/key and QR-encodes the card url", () => {
    const w = read("ios/App/SwiftCardWidget/SwiftCardWidget.swift");
    expect(w).toContain('APP_GROUP = "group.me.swiftcard.app"');
    expect(w).toContain('STORE_KEY = "widget_card"');
    expect(w).toContain("qrCodeGenerator");
    // The kind string must match what WidgetBridge reloads.
    expect(w).toContain('kind: "SwiftCardQR"');
  });
  // Capacitor does NOT scan the ObjC runtime for plugins. registerPlugins()
  // uses five hardcoded built-ins plus capacitor.config.json's packageClassList,
  // which `cap sync` regenerates from npm packages only — so an app-local plugin
  // is invisible to it however correctly it is written. WidgetBridge shipped
  // unregistered exactly once; window.Capacitor.Plugins.WidgetBridge was
  // undefined, the optional call no-opped, and the widget stayed empty.
  it("WidgetBridge is explicitly registered — Capacitor will not find it alone", () => {
    const vc = read("ios/App/App/MainViewController.swift");
    expect(vc).toContain("CAPBridgeViewController");
    expect(vc).toMatch(/override func capacitorDidLoad\(\)/);
    expect(vc).toMatch(/registerPluginInstance\(WidgetBridgePlugin\(\)\)/);
    // registerPluginType early-returns while autoRegisterPlugins is true (its
    // default), so a call to it would silently do nothing. Ignore comment lines
    // — the file deliberately explains why that API is the wrong one.
    const code = vc
      .split("\n")
      .filter((l) => !l.trim().startsWith("//"))
      .join("\n");
    expect(code).not.toMatch(/registerPluginType\s*\(/);
  });

  it("the storyboard instantiates that subclass, not the stock controller", () => {
    // Registration only happens if this view controller is the one that loads.
    const sb = read("ios/App/App/Base.lproj/Main.storyboard");
    expect(sb).toContain('customClass="MainViewController"');
    expect(sb).not.toContain('customClass="CAPBridgeViewController"');
    expect(read("ios/App/App.xcodeproj/project.pbxproj")).toContain(
      "MainViewController.swift in Sources"
    );
  });

  it("a missing App Group is detected by the container, not by suiteName", () => {
    // UserDefaults(suiteName:) returns non-nil even without the entitlement, so
    // writes would silently go somewhere the widget cannot read.
    const b = read("ios/App/App/WidgetBridge.swift");
    expect(b).toMatch(/containerURL\(\s*forSecurityApplicationGroupIdentifier:/);
  });

  it("the widget is cleared on sign-out, not left showing the last account", () => {
    const bridge = read("src/components/NativeAppBridge.tsx");
    expect(bridge).toMatch(/clearCard\(\)/);
  });

  it("the widget target is actually in the Xcode project", () => {
    // The extension's source existed on disk for weeks without a target to
    // build it — the app shipped no widget at all.
    const proj = read("ios/App/App.xcodeproj/project.pbxproj");
    expect(proj).toContain("SwiftCardWidgetExtension");
    expect(proj).toContain('productType = "com.apple.product-type.app-extension"');
    expect(proj).toContain("SwiftCardWidget.swift in Sources");
    // Embedded into the app bundle's PlugIns folder, or it never installs.
    expect(proj).toContain("Embed Foundation Extensions");
    expect(proj).toMatch(/dstSubfolderSpec = 13;/);
  });
});

describe("APNs delegate forwarding", () => {
  // PushNotifications.register() resolves only when the AppDelegate reposts
  // the UIApplication callbacks as Capacitor notifications. Without these the
  // registration listener in EnablePushButton just times out.
  it("AppDelegate forwards both APNs registration outcomes", () => {
    const d = read("ios/App/App/AppDelegate.swift");
    expect(d).toMatch(/didRegisterForRemoteNotificationsWithDeviceToken/);
    expect(d).toContain(".capacitorDidRegisterForRemoteNotifications");
    expect(d).toMatch(/didFailToRegisterForRemoteNotificationsWithError/);
    expect(d).toContain(".capacitorDidFailToRegisterForRemoteNotifications");
  });
});

describe("Liquid-Glass native styling layer", () => {
  const css = read("src/app/globals.css");
  const bridge = read("src/components/NativeAppBridge.tsx");
  it("NativeAppBridge stamps html.native-app and injects viewport-fit only on native", () => {
    expect(bridge).toMatch(/classList\.add\("native-app"\)/);
    expect(bridge).toMatch(/viewport-fit=cover/);
    // both must sit AFTER the detectNativeApp() guard — web untouched
    expect(bridge.indexOf('classList.add("native-app")')).toBeGreaterThan(bridge.indexOf("if (!detectNativeApp()) return;"));
  });
  it("every glass rule is scoped under html.native-app (web cannot match)", () => {
    const section = css.slice(css.indexOf("NATIVE SHELL — Liquid-Glass motion layer"));
    expect(section.length).toBeGreaterThan(100);
    // No selector in the section may start outside the native-app scope.
    const selectors = section.split("\n").filter((l) => /^[a-zA-Z.\[@:]/.test(l) && l.includes("{") && !l.startsWith("@"));
    for (const s of selectors) {
      expect(s.trim().startsWith("html.native-app"), `unscoped selector: ${s}`).toBe(true);
    }
  });
  it("accessibility fallbacks exist: reduced motion, reduced transparency, contrast, no-backdrop-filter", () => {
    const section = css.slice(css.indexOf("NATIVE SHELL — Liquid-Glass motion layer"));
    expect(section).toMatch(/prefers-reduced-motion: no-preference/);
    expect(section).toMatch(/prefers-reduced-transparency: reduce/);
    expect(section).toMatch(/prefers-contrast: more/);
    expect(section).toMatch(/@supports not \(\(backdrop-filter/);
  });
  it("MobileNav carries the sc-tabbar anchor class", () => {
    expect(read("src/components/MobileNav.tsx")).toMatch(/className="sc-tabbar /);
  });
});

describe("native share + Wallet hand-off", () => {
  it("ShareButton tries the native share sheet first inside the shell", () => {
    const src = read("src/components/ShareButton.tsx");
    expect(src).toMatch(/detectNativeApp\(\)[\s\S]*?shareNatively\(/);
    expect(read("src/lib/native-share.ts")).toMatch(/import\("@capacitor\/share"\)/);
  });
  it("AddToWalletButton opens the pass via the system browser on native", () => {
    const src = read("src/components/AddToWalletButton.tsx");
    expect(src).toMatch(/detectNativeApp\(\)/);
    expect(src).toMatch(/@capacitor\/browser/);
  });
  it("EnablePushButton registers native tokens through the shared subscribe route", () => {
    const src = read("src/components/EnablePushButton.tsx");
    // The prefix is CHOSEN, not hardcoded: "apns:" on iOS, "fcm:" on Android.
    // It used to be the literal "apns:", which on Android filed a Firebase
    // token as an Apple one — lib/push.ts then posted it to Apple, Apple
    // rejected it, and the row was pruned as a dead device. Android push would
    // have been silently impossible. See lib/push-device.ts.
    expect(src).toMatch(/\$\{nativePushPrefix\(\)\}\$\{result\.token\}/);
    expect(src).toMatch(/nativePushPrefix/);
    expect(src).toMatch(/@capacitor\/push-notifications/);
  });
});
