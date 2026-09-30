import SwiftUI

// ─────────────────────────────────────────────────────────────────────────────
// SwiftCard for Apple Watch.
//
// A standalone watchOS app (WKApplication), not a WatchKit extension: since
// watchOS 7 the app IS the target, and the companion iPhone app is named in
// Info.plist via WKCompanionAppBundleIdentifier.
//
// The store is created here and only here. It owns the WCSession delegate, and
// WatchConnectivity permits exactly one delegate per process — building a
// second one anywhere would silently steal delivery from the first.
// ─────────────────────────────────────────────────────────────────────────────

@main
struct SwiftCardWatchApp: App {

    // @StateObject, not @State or a fresh instance in the body: the session
    // must outlive every view update, and activating a WCSession per redraw
    // would thrash the connection to the phone.
    @StateObject private var store = WatchCardStore()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(store)
        }
        // Lets watchOS launch this app IN THE BACKGROUND when the phone's
        // application context arrives while the app is closed. The store is
        // created above and activates the session on launch, so the delivery
        // itself needs no code here — but without this declaration the card
        // sat undelivered until the next foreground launch, and the
        // complication kept showing the previous card (or "No card yet" on a
        // fresh install) until then. The short wait gives the session time to
        // hand the context to WatchCardStore, which persists it and reloads
        // the complication, before the system suspends us again.
        .backgroundTask(.watchConnectivity) {
            try? await Task.sleep(for: .seconds(2))
        }
    }
}
