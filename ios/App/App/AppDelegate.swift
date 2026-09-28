import UIKit
import Capacitor

// LIFECYCLE: UIScene, not the classic app-delegate window. Info.plist's
// UIApplicationSceneManifest hands the window and the foreground/URL/link
// callbacks to SceneDelegate.swift; iOS 27 kills at launch any app that still
// owns a `window` here without a scene manifest (build 13, 2026-09-28 — see
// the header of SceneDelegate.swift). Do not add a `window` property back.
@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Apple Watch link. Activation must happen at launch, not when the card
        // first changes: WCSession delivers the application context only once
        // it is activated, and the webview may never call setCard in a session
        // where nothing about the card changed. Activating here means a watch
        // that missed the last update still converges on the right card the
        // next time the phone app is opened. No-op without a paired watch.
        WatchSessionBridge.shared.activate()
        return true
    }

    // No app-level "did become active" / "will enter foreground" methods here:
    // under the scene lifecycle UIKit does not call them. The every-foreground
    // Apple Watch re-publish lives in SceneDelegate.sceneDidBecomeActive.

    // APNs registration results — still delivered to the APPLICATION delegate
    // under scenes, so these stay here. The PushNotifications plugin listens on these
    // notifications rather than the delegate itself, so without these two
    // forwards `PushNotifications.register()` never resolves — EnablePushButton
    // would sit on its timeout and no device token would ever reach lib/apns.ts.
    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        NotificationCenter.default.post(name: .capacitorDidRegisterForRemoteNotifications, object: deviceToken)
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        NotificationCenter.default.post(name: .capacitorDidFailToRegisterForRemoteNotifications, object: error)
    }

    // URL opens and Universal Links: with a scene manifest UIKit delivers these
    // to SceneDelegate (openURLContexts / continue userActivity), which forwards
    // them to the same ApplicationDelegateProxy. These two stay as a belt-and-
    // braces path for any OS that still routes through the application
    // delegate; both post the same Capacitor notifications either way.
    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }

}
