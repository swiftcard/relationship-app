import Foundation
import Capacitor
import WidgetKit

// ─────────────────────────────────────────────────────────────────────────────
// WidgetBridge — hands the active card to the SwiftCardWidget extension.
//
// Why this exists instead of @capacitor/preferences:
// the Preferences plugin's `group` option is NOT an iOS App Group. Its iOS
// implementation always writes to `UserDefaults.standard` and uses `group`
// only as a key prefix (see node_modules/@capacitor/preferences/ios/.../
// Preferences.swift). `UserDefaults.standard` lives in the app's own
// container, which a widget extension cannot read — so a card written that
// way is invisible to the widget no matter how the strings line up.
//
// This plugin writes to the real shared suite, `UserDefaults(suiteName:
// APP_GROUP)`, under the exact key the widget reads, and then asks WidgetKit
// to refresh — without the reload the widget would keep its stale snapshot for
// up to the 6-hour timeline policy in SwiftCardWidget.swift.
//
// The same write also feeds the Apple Watch app. The watch is a separate
// device and cannot see this App Group at all, so WatchSessionBridge reads the
// slot back and pushes it over WatchConnectivity. One call from the webview,
// three surfaces in step: home screen, watch face, wrist.
//
// The App target and the SwiftCardWidget target must both carry the
// `group.me.swiftcard.app` App Groups entitlement for the suite to resolve.
// ─────────────────────────────────────────────────────────────────────────────

@objc(WidgetBridgePlugin)
public class WidgetBridgePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "WidgetBridgePlugin"
    public let jsName = "WidgetBridge"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "setCard", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearCard", returnType: CAPPluginReturnPromise)
    ]

    // Must match APP_GROUP / STORE_KEY in SwiftCardWidget.swift.
    private static let appGroup = "group.me.swiftcard.app"
    private static let storeKey = "widget_card"

    // `UserDefaults(suiteName:)` is NOT a usable App Group check: it returns nil
    // only for the bundle identifier or the global domain. With a missing or
    // mismatched App Groups entitlement it hands back a perfectly ordinary
    // instance whose writes go somewhere the widget cannot see — so setCard
    // would resolve happily while the widget renders nothing. The container URL
    // is the thing that actually depends on the entitlement.
    private var shared: UserDefaults? {
        guard FileManager.default.containerURL(
            forSecurityApplicationGroupIdentifier: Self.appGroup
        ) != nil else { return nil }
        return UserDefaults(suiteName: Self.appGroup)
    }

    @objc func setCard(_ call: CAPPluginCall) {
        guard let url = call.getString("url"), !url.isEmpty else {
            call.reject("Must provide a card url")
            return
        }
        // Shape must stay in sync with `CardInfo` in SwiftCardWidget.swift —
        // its JSONDecoder requires all three keys to be present.
        var payload: [String: String] = [
            "url": url,
            "name": call.getString("name") ?? "My SwiftCard",
            "company": call.getString("company") ?? ""
        ]
        // The Contact QR's vCard (lib/contact-qr.ts) for the no-signal screen,
        // OfflineCard.swift. The widget and the watch decode only the three
        // keys above and ignore this one.
        if let vcard = call.getString("vcard"), !vcard.isEmpty {
            payload["vcard"] = vcard
        }

        guard
            let defaults = shared,
            let data = try? JSONSerialization.data(withJSONObject: payload),
            let json = String(data: data, encoding: .utf8)
        else {
            // Almost always a missing/mismatched App Groups entitlement. Fail
            // loudly rather than silently: the JS side logs it, and a widget
            // stuck on its empty state is otherwise very hard to diagnose.
            call.reject("App Group \(Self.appGroup) is unavailable — check the App Groups entitlement")
            return
        }

        defaults.set(json, forKey: Self.storeKey)
        reloadWidgets()
        // Same card, second screen. The Apple Watch cannot read this App Group
        // — it is a different device — so the card is pushed over
        // WatchConnectivity from the slot we just wrote. See
        // WatchSessionBridge.swift. No paired watch is the normal case and
        // costs nothing.
        WatchSessionBridge.shared.publishCurrentCard()
        call.resolve()
    }

    @objc func clearCard(_ call: CAPPluginCall) {
        shared?.removeObject(forKey: Self.storeKey)
        reloadWidgets()
        // Sign-out has to reach the wrist too: a watch left showing the
        // previous account's QR is the same handed-on-device problem the
        // widget's clearCard exists to prevent.
        WatchSessionBridge.shared.publishCurrentCard()
        call.resolve()
    }

    private func reloadWidgets() {
        WidgetCenter.shared.reloadTimelines(ofKind: "SwiftCardQR")
    }
}
