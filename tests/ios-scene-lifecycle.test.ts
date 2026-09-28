import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

/**
 * The iOS 27 launch crash, pinned at source.
 *
 * 1.0.3 (build 13) went live 2026-09-25 and on iOS 27.0 showed a black frame
 * and closed before any of our code ran. The crash log
 * (App-2026-09-28-114750.ips) is UIKit tripping a breakpoint in
 * ___UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption at scene
 * creation: an app on a current SDK that still uses the pre-iOS-13
 * app-delegate window with no UIApplicationSceneManifest is a warning on iOS
 * 26 and a kill on iOS 27. App Review passed it on iOS 26.
 *
 * Every assertion here is a way that fix could quietly come undone — a
 * `cap sync` or template refresh restoring the stock AppDelegate, the manifest
 * dropped from Info.plist, the file falling out of the Xcode target — and
 * each one puts the black-screen-then-gone launch straight back.
 */
describe("iOS shell adopts the UIScene lifecycle (iOS 27 launch requirement)", () => {
  const plist = read("ios/App/App/Info.plist");
  const proj = read("ios/App/App.xcodeproj/project.pbxproj");
  const scene = read("ios/App/App/SceneDelegate.swift");
  const delegate = read("ios/App/App/AppDelegate.swift");

  it("Info.plist declares one window scene owned by SceneDelegate, built from Main", () => {
    expect(plist).toContain("<key>UIApplicationSceneManifest</key>");
    expect(plist).toContain("<key>UIWindowSceneSessionRoleApplication</key>");
    expect(plist).toContain("<string>$(PRODUCT_MODULE_NAME).SceneDelegate</string>");
    expect(plist).toMatch(/<key>UISceneStoryboardFile<\/key>\s*<string>Main<\/string>/);
    // Both keys at once would give UIKit two ways to build the window.
    expect(plist).not.toContain("UIMainStoryboardFile");
  });

  it("SceneDelegate is a UIWindowSceneDelegate that owns the window", () => {
    expect(scene).toMatch(/class SceneDelegate: UIResponder, UIWindowSceneDelegate/);
    expect(scene).toMatch(/var window: UIWindow\?/);
    // The window belongs to the scene now. A second one on the AppDelegate is
    // exactly the pre-scene shape iOS 27 rejects.
    expect(delegate).not.toMatch(/var window: UIWindow\?/);
  });

  it("the Xcode App target compiles SceneDelegate.swift", () => {
    expect(proj).toMatch(/\/\* SceneDelegate\.swift \*\/ = \{isa = PBXFileReference;/);
    expect(proj).toMatch(/\/\* SceneDelegate\.swift in Sources \*\//);
    // In the App group AND the App target's Sources phase — a reference alone
    // shows in the navigator and builds nothing.
    const sources = proj.match(/504EC3001FED79650016851F \/\* Sources \*\/ = \{[\s\S]*?\};/)?.[0] ?? "";
    expect(sources).toContain("SceneDelegate.swift in Sources");
  });

  it("forwards URL opens and Universal Links to Capacitor from the scene", () => {
    // Under scenes UIKit routes these to the scene delegate and stops calling
    // the application-delegate versions. Without the forwards, native OAuth's
    // swiftcard://auth-callback return leg and every swiftcard.me universal
    // link would open the app and then do nothing.
    expect(scene).toMatch(/func scene\(_ scene: UIScene, openURLContexts[\s\S]*?ApplicationDelegateProxy\.shared\.application\(UIApplication\.shared, open:/);
    expect(scene).toMatch(/func scene\(_ scene: UIScene, continue userActivity: NSUserActivity\)[\s\S]*?ApplicationDelegateProxy\.shared\.application\(UIApplication\.shared, continue: userActivity/);
    // Cold launch from a link arrives in connectionOptions, not the two above.
    expect(scene).toMatch(/willConnectTo[\s\S]*?connectionOptions\.urlContexts[\s\S]*?connectionOptions\.userActivities/);
  });

  it("keeps APNs registration on the application delegate, where iOS still delivers it", () => {
    expect(delegate).toMatch(/didRegisterForRemoteNotificationsWithDeviceToken/);
    expect(delegate).toMatch(/didFailToRegisterForRemoteNotificationsWithError/);
  });
});
