import UIKit
import Capacitor

// ─────────────────────────────────────────────────────────────────────────────
// SceneDelegate — the UIScene lifecycle iOS 27 refuses to launch without.
//
// WHY THIS EXISTS (2026-09-28)
// Build 13 (1.0.3) went live on 2026-09-25. On iOS 27.0 it showed a black
// screen for a fraction of a second and closed, before a single line of our
// code ran. The crash log (bug_type 309, EXC_BREAKPOINT in
// ___UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption_block_invoke)
// is UIKit itself tripping a breakpoint at scene creation: an app linked
// against a current SDK that still uses the pre-iOS-13 app-delegate lifecycle
// (a `window` on the AppDelegate, no UIApplicationSceneManifest) is a runtime
// warning on iOS 26 and a hard kill on iOS 27. Apple announced the deadline at
// WWDC25; App Review passed the build on iOS 26, where it only logged.
//
// The Capacitor 8 template does not adopt scenes, so this file does. Info.plist
// declares one window scene (UIApplicationSceneManifest → this class + the
// Main storyboard), UIKit builds the window from the storyboard, and the
// MainViewController → CAPBridgeViewController path is exactly what it was.
//
// WHAT MOVES HERE FROM AppDelegate
// Under the scene lifecycle UIKit routes these to the SCENE delegate and stops
// calling the application-level versions, so each one has to be forwarded or
// it silently dies:
//   • URL opens (swiftcard://auth-callback, the OAuth and integration return
//     legs) → ApplicationDelegateProxy, which posts .capacitorOpenURL. The
//     @capacitor/app plugin turns that into appUrlOpen, which NativeAppBridge
//     listens on.
//   • Universal Links (none since 2026-09-29: the AASA excludes every path,
//     so no swiftcard.me link opens the app; kept for older cached AASAs) →
//     ApplicationDelegateProxy, which posts .capacitorOpenUniversalLink.
//   • "did become active" → the Apple Watch re-publish that used to sit in
//     applicationDidBecomeActive.
// APNs registration callbacks stay on AppDelegate: those are still delivered
// to the application delegate under scenes.
//
// Cold launches from a link arrive in connectionOptions rather than through
// the two open methods, so willConnectTo forwards them too — one main-queue
// turn later, so the storyboard's view controller has loaded and the bridge's
// plugins have registered their observers before the notification is posted.
// The App plugin retains appUrlOpen until a JS listener consumes it, so the
// web layer still sees the launch URL once the page is up.
// ─────────────────────────────────────────────────────────────────────────────

class SceneDelegate: UIResponder, UIWindowSceneDelegate {

    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        // UIKit has already created the window from UISceneStoryboardFile
        // (Main) and assigned it to `window`; nothing to build by hand.
        let urls = connectionOptions.urlContexts.map { $0.url }
        let activities = connectionOptions.userActivities
        guard !urls.isEmpty || !activities.isEmpty else { return }
        DispatchQueue.main.async {
            for url in urls {
                _ = ApplicationDelegateProxy.shared.application(UIApplication.shared, open: url, options: [:])
            }
            for activity in activities {
                _ = ApplicationDelegateProxy.shared.application(UIApplication.shared, continue: activity, restorationHandler: { _ in })
            }
        }
    }

    // swiftcard://… custom-scheme opens while the app is running or suspended.
    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        for context in URLContexts {
            _ = ApplicationDelegateProxy.shared.application(UIApplication.shared, open: context.url, options: [:])
        }
    }

    // Universal Links while the app is running or suspended.
    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        _ = ApplicationDelegateProxy.shared.application(UIApplication.shared, continue: userActivity, restorationHandler: { _ in })
    }

    func sceneDidBecomeActive(_ scene: UIScene) {
        // Re-publish the card on every foreground — the catch-all for the
        // states WatchConnectivity cannot notify us about (watch app
        // reinstalled, phone rebooted, pair never got to talk). See
        // WatchSessionBridge; this call used to live in
        // applicationDidBecomeActive, which scenes no longer invoke.
        WatchSessionBridge.shared.publishCurrentCard()
    }
}
