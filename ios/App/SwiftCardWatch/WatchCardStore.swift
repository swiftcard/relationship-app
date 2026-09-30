import Foundation
import WatchConnectivity

// ─────────────────────────────────────────────────────────────────────────────
// The watch half of the phone's WatchSessionBridge.
//
// It has exactly one job: keep `card` equal to whatever the iPhone last said
// the active card was, and survive every way the two devices can be out of
// touch. There are three inbound paths and they are not redundant:
//
//   1. didReceiveApplicationContext — the normal one. The phone sets a single
//      latest value; watchOS delivers it in the background, whether or not this
//      app is running, and overwrites any earlier undelivered value.
//   2. The cached copy on disk, read synchronously in `init`. This is what the
//      first frame renders from, so a raised wrist shows the QR immediately
//      instead of a spinner, and it is the ONLY path when the phone is off,
//      out of range or in another room.
//   3. An explicit request over `sendMessage`, sent once on launch when there
//      is no cache yet. Covers the fresh install where the person opens the
//      watch app before the phone app has run again — the one hole (1) leaves,
//      because an application context that was already delivered is not
//      re-delivered to a reinstalled app.
//
// Nothing here is allowed to fail loudly. A watch with no phone nearby is a
// normal state, not an error, and it still has a working card. Nor is anything
// allowed to wait forever: see the activation timeout in `init`.
// ─────────────────────────────────────────────────────────────────────────────

final class WatchCardStore: NSObject, ObservableObject, WCSessionDelegate {

    /// Nil means "no card" — either never received, or the phone signed out.
    /// The UI treats those the same: it points at the iPhone.
    @Published private(set) var card: WatchCard?

    /// True only until the first activation settles, so the empty state can say
    /// "checking your iPhone" rather than accusing the person of not having a
    /// card during the second it takes to connect.
    @Published private(set) var isConnecting: Bool = true

    override init() {
        // Read BEFORE activating: the cached card is what the first frame draws.
        card = WatchCardStorage.load()
        super.init()

        guard WCSession.isSupported() else {
            isConnecting = false
            return
        }
        let session = WCSession.default
        session.delegate = self
        session.activate()

        // Activation is not guaranteed to complete — ever. On a watch that has
        // been unpaired, or whose companion app was removed, the callback
        // simply never fires, and without this the app sits on "Checking your
        // iPhone…" for as long as it is open. Found by running it on a watch
        // simulator with no paired phone, where it hung indefinitely.
        //
        // Three seconds is generous for a local IPC handshake and short enough
        // that nobody reads it as a hang. If activation lands later it still
        // wins: apply() sets isConnecting = false again and fills in the card.
        DispatchQueue.main.asyncAfter(deadline: .now() + 3) { [weak self] in
            self?.isConnecting = false
        }
    }

    // MARK: - Applying an update

    /// One funnel for all three inbound paths, so persistence, the published
    /// value and the complication reload can never be done by one path and
    /// forgotten by another.
    private func apply(context: [String: Any]) {
        // An absent "card" key is a real value: the phone signed out.
        let payload = context["card"] as? [String: String]

        let next: WatchCard? = payload.flatMap { dict in
            guard let url = dict["url"], !url.isEmpty else { return nil }
            return WatchCard(
                url: url,
                name: dict["name"] ?? "",
                company: dict["company"] ?? "",
                // Sent as a string because WatchConnectivity carries this as a
                // [String: String]; absent if the phone's encoder failed, which
                // the card survives (name and link still render).
                qrWidth: dict["qrWidth"].flatMap { Int($0) },
                qrBits: dict["qrBits"]
            )
        }

        DispatchQueue.main.async {
            self.isConnecting = false
            guard next != self.card else { return }
            self.card = next
            WatchCardStorage.save(next)
        }
    }

    /// Ask the phone directly. Only worth doing while it is reachable — an
    /// unreachable `sendMessage` just errors — and only when we have nothing,
    /// because the application context covers every other case for free.
    private func requestCardIfNeeded() {
        // `card` is written on the main queue by apply(); the delegate
        // callbacks that call this arrive on WatchConnectivity's own queue.
        // Hop to main before reading it so the check and the write never race.
        DispatchQueue.main.async { [weak self] in
            guard let self, self.card == nil, WCSession.default.isReachable else { return }
            WCSession.default.sendMessage(
                ["request": "card"],
                replyHandler: { [weak self] reply in self?.apply(context: reply) },
                errorHandler: { _ in /* phone went away mid-flight — cache stands */ }
            )
        }
    }

    // MARK: - WCSessionDelegate

    func session(_ session: WCSession, activationDidCompleteWith state: WCSessionActivationState, error: Error?) {
        // The context that arrived while this app was not running is waiting in
        // `receivedApplicationContext`; it is NOT re-delivered to the callback.
        // Reading it here is what makes a cold launch show the current card.
        let received = session.receivedApplicationContext
        if !received.isEmpty {
            apply(context: received)
        } else {
            DispatchQueue.main.async { self.isConnecting = false }
        }
        requestCardIfNeeded()
    }

    func session(_ session: WCSession, didReceiveApplicationContext context: [String: Any]) {
        apply(context: context)
    }

    /// The phone came within range. If we launched with nothing — no cache, no
    /// stored context — this is the moment the request can finally succeed.
    func sessionReachabilityDidChange(_ session: WCSession) {
        requestCardIfNeeded()
    }
}
