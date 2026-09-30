import Foundation
import WatchConnectivity
import CoreImage
import CoreImage.CIFilterBuiltins

// ─────────────────────────────────────────────────────────────────────────────
// WatchSessionBridge — the iPhone half of the Apple Watch app.
//
// WHY THIS EXISTS
// An App Group is shared between an app and its EXTENSIONS on the SAME device.
// The Apple Watch is a different device with its own filesystem, so the
// `group.me.swiftcard.app` suite that feeds the home-screen widget is invisible
// to SwiftCardWatch. The only supported channel between the two is
// WatchConnectivity, and this is our one use of it.
//
// WHY updateApplicationContext AND NOT sendMessage/transferUserInfo
//   • sendMessage requires the counterpart to be reachable RIGHT NOW. The watch
//     app is almost never running when the card changes, so it would fail.
//   • transferUserInfo queues every call and delivers them in order — a FIFO of
//     stale cards to replay after a week of not wearing the watch.
//   • updateApplicationContext keeps exactly ONE latest value, delivers it in
//     the background whenever the devices next talk, and overwrites anything
//     still queued. "The user's current card" is precisely that shape.
//
// The payload is deliberately identical to the widget's — url, name, company —
// and is READ BACK from the App Group rather than passed around, so the widget
// and the watch can never disagree about which card is active.
//
// PLUS ONE THING THE WIDGET DOES NOT NEED: the QR grid.
// watchOS has no CoreImage, so the watch cannot generate a QR code at all —
// the module fails to resolve and the target will not build. The encoding
// therefore happens HERE, where CoreImage exists, and what crosses to the watch
// is the finished grid of black/white modules. See `qrMatrix` at the bottom of
// this file and WatchQRCode on the other side.
//
// Everything here fails soft. No paired watch, no watch app installed, watch in
// another room: all normal, none of them an error the person should ever see.
// ─────────────────────────────────────────────────────────────────────────────

final class WatchSessionBridge: NSObject, WCSessionDelegate {

    static let shared = WatchSessionBridge()

    // Same suite and key WidgetBridge writes. The widget and the watch show the
    // same card because they read the same slot, not because two code paths
    // remember to stay in step.
    private static let appGroup = "group.me.swiftcard.app"
    private static let storeKey = "widget_card"

    /// Key inside the application-context dictionary. `nil`/absent means
    /// "signed out" — the watch clears rather than keeping the last account's
    /// QR code on a wrist that may have changed hands.
    private static let contextKey = "card"

    private override init() { super.init() }

    // MARK: - Activation

    /// Safe to call more than once; WCSession ignores repeat activations.
    /// `isSupported()` is false on iPad and on a Mac running the iPhone binary,
    /// where this whole file is a no-op.
    func activate() {
        guard WCSession.isSupported() else { return }
        let session = WCSession.default
        session.delegate = self
        session.activate()
    }

    // MARK: - Publishing

    /// Push the current card to the watch. Called by WidgetBridge on every
    /// setCard/clearCard, and again on activation and whenever the watch state
    /// changes, so a watch that was unpaired, asleep or out of range at the
    /// moment of the change still converges on the right card.
    func publishCurrentCard() {
        guard WCSession.isSupported() else { return }
        let session = WCSession.default

        // Not activated yet — activation itself re-publishes, so dropping this
        // call is correct rather than lossy.
        guard session.activationState == .activated else {
            activate()
            return
        }

        // No watch, or the watch app was never installed: nothing to send. Not
        // an error — the overwhelmingly common case.
        #if os(iOS)
        guard session.isPaired, session.isWatchAppInstalled else { return }
        #endif

        var context: [String: Any] = [:]
        if let card = storedCard() {
            context[Self.contextKey] = card
        }
        // A monotonic stamp guarantees the dictionary differs from the last
        // one. updateApplicationContext is free to skip a payload equal to the
        // one already delivered, which would silently drop a re-publish after
        // the watch app was reinstalled and lost its cache.
        context["updatedAt"] = Date().timeIntervalSince1970

        do {
            try session.updateApplicationContext(context)
        } catch {
            // Throws only for an inactive session or a non-serializable
            // payload. The next activation or watch-state change retries.
            NSLog("[watch] updateApplicationContext failed: \(error.localizedDescription)")
        }
    }

    /// The active card as WidgetBridge last wrote it, decoded into the plain
    /// dictionary WatchConnectivity can carry.
    private func storedCard() -> [String: String]? {
        guard
            FileManager.default.containerURL(
                forSecurityApplicationGroupIdentifier: Self.appGroup
            ) != nil,
            let raw = UserDefaults(suiteName: Self.appGroup)?.string(forKey: Self.storeKey),
            let data = raw.data(using: .utf8),
            let obj = try? JSONSerialization.jsonObject(with: data) as? [String: String],
            let url = obj["url"], !url.isEmpty
        else { return nil }

        var payload: [String: String] = [
            "url": url,
            "name": obj["name"] ?? "My SwiftCard",
            "company": obj["company"] ?? "",
        ]

        // The watch cannot build this for itself. If encoding somehow fails the
        // card still goes over without it — the watch then shows the name and
        // the readable link, which is worth more than showing nothing.
        if let qr = Self.qrMatrix(for: url) {
            payload["qrWidth"] = String(qr.width)
            payload["qrBits"] = qr.bits
        }
        return payload
    }

    // MARK: - WCSessionDelegate

    func session(_ session: WCSession, activationDidCompleteWith state: WCSessionActivationState, error: Error?) {
        guard state == .activated else { return }
        // First chance to deliver anything set while the session was inactive —
        // including the card written during this very launch.
        publishCurrentCard()
    }

    #if os(iOS)
    // The watch app can ask for the card directly. This is the recovery path
    // for the one case application context cannot cover: the watch app was
    // opened before it had ever received a context (fresh install, or the
    // person opened it first and the phone app has not run since).
    func session(_ session: WCSession, didReceiveMessage message: [String: Any], replyHandler: @escaping ([String: Any]) -> Void) {
        var reply: [String: Any] = [:]
        if let card = storedCard() { reply[Self.contextKey] = card }
        replyHandler(reply)
    }

    /// Watch paired/unpaired, or the watch app installed/removed. A watch that
    /// gains the app after the card was set would otherwise show its empty
    /// state until the next card change.
    func sessionWatchStateDidChange(_ session: WCSession) {
        publishCurrentCard()
    }

    /// Both are REQUIRED on iOS — the protocol does not make them optional, and
    /// omitting them fails to compile. Switching watches deactivates the old
    /// session; re-activating is what binds the session to the new one.
    func sessionDidBecomeInactive(_ session: WCSession) {}

    func sessionDidDeactivate(_ session: WCSession) {
        WCSession.default.activate()
    }
    #endif

    // MARK: - QR encoding (for a platform that cannot do its own)

    /// Encode `string` as a QR code and return the raw module grid.
    ///
    /// Rendered at scale 1, so the CGImage is exactly one pixel per module —
    /// CIQRCodeGenerator's natural output, quiet-zone border included. Every
    /// pixel is then read as one module, which means this code never has to
    /// know the QR version, the module count, or where the border ends. It
    /// just forwards whatever CoreImage drew.
    ///
    /// Returns the grid width and the modules packed one bit each, row-major,
    /// MSB first, base64'd. Around 180 bytes for a typical card URL — small
    /// enough to sit inside an application context without a second thought.
    static func qrMatrix(for string: String) -> (width: Int, bits: String)? {
        let filter = CIFilter.qrCodeGenerator()
        filter.message = Data(string.utf8)
        // "M" matches the home-screen widget, so all three surfaces show the
        // same code with the same error tolerance.
        filter.correctionLevel = "M"

        guard
            let output = filter.outputImage,
            let cg = CIContext().createCGImage(output, from: output.extent)
        else { return nil }

        let width = cg.width
        let height = cg.height
        // CIQRCodeGenerator is always square. If that ever stops being true the
        // packing below would silently produce a skewed grid, so refuse instead.
        guard width > 0, width == height else { return nil }

        // Draw into a known 8-bit grayscale buffer rather than trusting the
        // CGImage's own layout: colour space, alpha and byte order vary, and
        // reading the provider's bytes directly is how this kind of code ends
        // up working on one OS version and inverting on the next.
        var pixels = [UInt8](repeating: 0, count: width * height)
        guard let context = CGContext(
            data: &pixels,
            width: width,
            height: height,
            bitsPerComponent: 8,
            bytesPerRow: width,
            space: CGColorSpaceCreateDeviceGray(),
            bitmapInfo: CGImageAlphaInfo.none.rawValue
        ) else { return nil }
        context.interpolationQuality = .none
        context.draw(cg, in: CGRect(x: 0, y: 0, width: width, height: height))

        var packed = [UInt8](repeating: 0, count: (width * height + 7) / 8)
        for y in 0..<height {
            for x in 0..<width {
                // NOT flipped. CoreGraphics' drawing origin is bottom-left,
                // but the bytes of a bitmap context are stored top row first,
                // so `pixels[0]` is already the top-left module. An earlier
                // version flipped the rows here and shipped a vertically
                // MIRRORED code: a QR's three finder squares sit top-left,
                // top-right and bottom-left, and the mirror put the empty
                // corner top-right. Most scanners (iOS Camera, Vision, ZXing)
                // tolerate a mirror, which is why it looked fine — some do
                // not. Verified 2026-09-30 by decoding the grid AND checking
                // which corner has no finder; see SHELL-RUNBOOK §6c.
                let value = pixels[y * width + x]
                guard value < 128 else { continue }   // dark module
                let index = y * width + x
                packed[index / 8] |= (1 << (7 - UInt8(index % 8)))
            }
        }

        return (width, Data(packed).base64EncodedString())
    }
}
