import Foundation
import Capacitor
import UIKit
import UserNotifications

// ─────────────────────────────────────────────────────────────────────────────
// AppBadge — the red number on the SwiftCard icon.
//
// The SERVER sets it: every APNs alert carries `aps.badge` = the person's
// unread notifications (src/lib/push.ts), so the icon is right the moment a
// lead lands, app closed or not. The APP corrects it: NotificationBell calls
// set() with its own unread count whenever it loads, polls, or something is
// marked read — so reading the bell clears the icon, and the badge can never
// stick on a number that is no longer true (2026-10-06 notification audit).
//
// Takes only a number, clamped to 0…99. Never prompts: the badge permission
// rides the notification permission the person already granted, and without
// it iOS simply ignores the call.
// ─────────────────────────────────────────────────────────────────────────────

@objc(AppBadgePlugin)
public class AppBadgePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "AppBadgePlugin"
    public let jsName = "AppBadge"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "set", returnType: CAPPluginReturnPromise)
    ]

    @objc func set(_ call: CAPPluginCall) {
        let count = max(0, min(99, call.getInt("count") ?? 0))
        DispatchQueue.main.async {
            if #available(iOS 16.0, *) {
                UNUserNotificationCenter.current().setBadgeCount(count) { _ in }
            } else {
                UIApplication.shared.applicationIconBadgeNumber = count
            }
            call.resolve(["count": count])
        }
    }
}
