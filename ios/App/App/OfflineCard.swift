import UIKit
import WebKit
import Network
import CoreImage.CIFilterBuiltins

// ─────────────────────────────────────────────────────────────────────────────
// OFFLINE CARD — your QR code when there is no signal.
//
// The shell is a remote-URL webview, so with no connection there is nothing to
// show: the load fails, no `server.errorPath` is set, and the user was left on
// the launch image and then a blank canvas. That is the worst possible moment
// to fail — conventions, basements and crowded venues are exactly where people
// open the app to show their code.
//
// The code itself never needed the network. WidgetBridge already keeps the
// active card in the App Group (`widget_card`) for the home-screen widget and
// the Apple Watch, and a QR is just that URL encoded. So when a page load fails
// for a NETWORK reason, this draws the card natively over the webview: name,
// company, the QR on a white plate, the readable link, and "Try again". It
// retries by itself the moment the connection comes back (NWPathMonitor) or the
// app returns to the foreground, and disappears on the first successful load.
//
// Signed out → WidgetBridge.clearCard has emptied the slot → this shows only
// "You're offline", never the previous account's card.
//
// WHY A NAVIGATION-DELEGATE PROXY rather than `server.errorPath`:
// Capacitor loads errorPath on EVERY didFail / didFailProvisionalNavigation,
// including cancellations — and a policy-cancelled navigation (every external
// link Capacitor hands to Safari) arrives as one. errorPath would replace the
// app with the offline page whenever someone tapped a social link. The proxy
// filters to genuine connectivity errors. It cannot be a subclass: Capacitor's
// loadView() is final and constructs its WebViewDelegationHandler itself.
// ─────────────────────────────────────────────────────────────────────────────

/// Sits in front of Capacitor's WebViewDelegationHandler as the webview's
/// navigationDelegate. Everything is forwarded to Capacitor untouched — the
/// bridge, app-bound-domain handling and external-link routing all live in its
/// delegate methods — and the three load-outcome callbacks are also reported.
///
/// `navigationDelegate` is weak, so the owner must keep this object alive.
/// `inner` is weak too: CapacitorBridge retains the real handler.
final class NavigationOutcomeProxy: NSObject, WKNavigationDelegate {
    weak var inner: WKNavigationDelegate?
    var onLoaded: (() -> Void)?
    var onNetworkFailure: ((URL?) -> Void)?

    init(inner: WKNavigationDelegate?) {
        self.inner = inner
        super.init()
    }

    // Anything this class does not implement goes straight to Capacitor.
    override func responds(to aSelector: Selector!) -> Bool {
        super.responds(to: aSelector) || (inner?.responds(to: aSelector) ?? false)
    }

    override func forwardingTarget(for aSelector: Selector!) -> Any? {
        if let inner, inner.responds(to: aSelector) { return inner }
        return super.forwardingTarget(for: aSelector)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        inner?.webView?(webView, didFinish: navigation)
        onLoaded?()
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        inner?.webView?(webView, didFail: navigation, withError: error)
        report(error)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        inner?.webView?(webView, didFailProvisionalNavigation: navigation, withError: error)
        report(error)
    }

    private func report(_ error: Error) {
        guard Self.isConnectivityError(error) else { return }
        let failing = (error as NSError).userInfo[NSURLErrorFailingURLErrorKey] as? URL
        onNetworkFailure?(failing)
    }

    /// Only "the network isn't there". Cancellations (-999), WebKit's "frame
    /// load interrupted" (a policy-cancelled navigation — every external link),
    /// HTTP-level and TLS errors all fall through, so they never show this.
    static func isConnectivityError(_ error: Error) -> Bool {
        let e = error as NSError
        guard e.domain == NSURLErrorDomain else { return false }
        switch e.code {
        case NSURLErrorNotConnectedToInternet,
             NSURLErrorNetworkConnectionLost,
             NSURLErrorTimedOut,
             NSURLErrorCannotFindHost,
             NSURLErrorCannotConnectToHost,
             NSURLErrorDNSLookupFailed,
             NSURLErrorInternationalRoamingOff,
             NSURLErrorCallIsActive,
             NSURLErrorDataNotAllowed:
            return true
        default:
            return false
        }
    }
}

/// The active card as WidgetBridge last wrote it. Same App Group and key as
/// WidgetBridge.swift, WatchSessionBridge.swift and SwiftCardWidget.swift.
struct OfflineCardInfo {
    let url: String
    let name: String
    let company: String

    private static let appGroup = "group.me.swiftcard.app"
    private static let storeKey = "widget_card"

    static func load() -> OfflineCardInfo? {
        guard
            FileManager.default.containerURL(
                forSecurityApplicationGroupIdentifier: appGroup
            ) != nil,
            let raw = UserDefaults(suiteName: appGroup)?.string(forKey: storeKey),
            let data = raw.data(using: .utf8),
            let obj = try? JSONSerialization.jsonObject(with: data) as? [String: String],
            let url = obj["url"], !url.isEmpty
        else { return nil }
        return OfflineCardInfo(
            url: url,
            name: obj["name"] ?? "My SwiftCard",
            company: obj["company"] ?? ""
        )
    }
}

/// Full-screen offline card, drawn over the webview.
final class OfflineCardView: UIView {
    var onRetry: (() -> Void)?

    private let stack = UIStackView()
    private let statusLabel = UILabel()
    private let nameLabel = UILabel()
    private let companyLabel = UILabel()
    private let plate = UIView()
    private let qrView = UIImageView()
    private let linkLabel = UILabel()
    private let noteLabel = UILabel()
    private let retryButton = UIButton(type: .system)

    // The shell's own canvas colour (capacitor.config.ts backgroundColor), so
    // the hand-off to and from the webview has no flash.
    private static let canvas = UIColor(red: 3 / 255, green: 7 / 255, blue: 18 / 255, alpha: 1)
    private static let secondary = UIColor(red: 148 / 255, green: 163 / 255, blue: 184 / 255, alpha: 1)
    private static let accent = UIColor(red: 37 / 255, green: 99 / 255, blue: 235 / 255, alpha: 1)

    override init(frame: CGRect) {
        super.init(frame: frame)
        build()
    }

    required init?(coder: NSCoder) {
        super.init(coder: coder)
        build()
    }

    private func build() {
        backgroundColor = Self.canvas
        overrideUserInterfaceStyle = .dark

        stack.axis = .vertical
        stack.alignment = .center
        stack.spacing = 10
        stack.translatesAutoresizingMaskIntoConstraints = false
        addSubview(stack)

        style(statusLabel, .footnote, Self.secondary, weight: .semibold)
        style(nameLabel, .title2, .white, weight: .bold)
        style(companyLabel, .subheadline, Self.secondary, weight: .regular)
        style(linkLabel, .footnote, Self.secondary, weight: .medium)
        style(noteLabel, .footnote, Self.secondary, weight: .regular)

        // White plate: a QR needs a light quiet zone to scan, whatever the theme.
        plate.backgroundColor = .white
        plate.layer.cornerRadius = 24
        plate.layer.cornerCurve = .continuous
        plate.translatesAutoresizingMaskIntoConstraints = false
        qrView.translatesAutoresizingMaskIntoConstraints = false
        qrView.contentMode = .scaleAspectFit
        // Nearest-neighbour: modules stay razor-sharp at any size.
        qrView.layer.magnificationFilter = .nearest
        qrView.isAccessibilityElement = true
        qrView.accessibilityLabel = "QR code for your SwiftCard"
        plate.addSubview(qrView)

        var config = UIButton.Configuration.filled()
        config.baseBackgroundColor = Self.accent
        config.baseForegroundColor = .white
        config.cornerStyle = .capsule
        config.contentInsets = NSDirectionalEdgeInsets(top: 12, leading: 28, bottom: 12, trailing: 28)
        config.title = "Try again"
        retryButton.configuration = config
        retryButton.addAction(UIAction { [weak self] _ in self?.onRetry?() }, for: .primaryActionTriggered)

        [statusLabel, nameLabel, companyLabel, plate, linkLabel, noteLabel, retryButton]
            .forEach(stack.addArrangedSubview)
        stack.setCustomSpacing(20, after: companyLabel)
        stack.setCustomSpacing(14, after: plate)
        stack.setCustomSpacing(24, after: noteLabel)

        let side = plate.widthAnchor.constraint(equalTo: widthAnchor, multiplier: 0.72)
        side.priority = .defaultHigh
        NSLayoutConstraint.activate([
            stack.centerYAnchor.constraint(equalTo: safeAreaLayoutGuide.centerYAnchor),
            stack.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 28),
            stack.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -28),
            stack.topAnchor.constraint(greaterThanOrEqualTo: safeAreaLayoutGuide.topAnchor, constant: 16),
            stack.bottomAnchor.constraint(lessThanOrEqualTo: safeAreaLayoutGuide.bottomAnchor, constant: -16),
            side,
            plate.widthAnchor.constraint(lessThanOrEqualToConstant: 340),
            plate.heightAnchor.constraint(equalTo: plate.widthAnchor),
            qrView.topAnchor.constraint(equalTo: plate.topAnchor, constant: 18),
            qrView.bottomAnchor.constraint(equalTo: plate.bottomAnchor, constant: -18),
            qrView.leadingAnchor.constraint(equalTo: plate.leadingAnchor, constant: 18),
            qrView.trailingAnchor.constraint(equalTo: plate.trailingAnchor, constant: -18),
        ])
    }

    private func style(_ label: UILabel, _ text: UIFont.TextStyle, _ color: UIColor, weight: UIFont.Weight) {
        let base = UIFont.preferredFont(forTextStyle: text)
        label.font = UIFontMetrics(forTextStyle: text).scaledFont(for: .systemFont(ofSize: base.pointSize, weight: weight))
        label.adjustsFontForContentSizeCategory = true
        label.textColor = color
        label.textAlignment = .center
        label.numberOfLines = 0
    }

    /// Fill from the saved card, or the plain offline message when there is none.
    func show(card: OfflineCardInfo?) {
        statusLabel.text = "You're offline"
        if let card, let qr = Self.qrImage(for: Self.scanURL(card.url)) {
            nameLabel.text = card.name
            companyLabel.text = card.company
            companyLabel.isHidden = card.company.isEmpty
            qrView.image = qr
            plate.isHidden = false
            linkLabel.text = Self.readable(card.url)
            linkLabel.isHidden = false
            noteLabel.text = "Your QR code still works. Whoever scans it needs signal to open your card."
        } else {
            nameLabel.text = "SwiftCard"
            companyLabel.isHidden = true
            plate.isHidden = true
            linkLabel.isHidden = true
            noteLabel.text = "Reconnect to the internet to open SwiftCard."
        }
    }

    /// Same encoder and error-correction level as the widget and the watch,
    /// so every surface shows the identical code. Rendered at 1px per module;
    /// the image view scales it up with nearest-neighbour filtering.
    static func qrImage(for string: String) -> UIImage? {
        let filter = CIFilter.qrCodeGenerator()
        filter.message = Data(string.utf8)
        filter.correctionLevel = "M"
        guard
            let output = filter.outputImage,
            let cg = CIContext().createCGImage(output, from: output.extent)
        else { return nil }
        return UIImage(cgImage: cg)
    }

    /// The saved URL is the widget's own (`?source=widget`, which is how
    /// NativeAppBridge recognises a widget tap opening the app). Someone
    /// scanning this screen is a QR scan, so it is tagged `qr_code` — the
    /// source the dashboard already labels "QR code scan".
    static func scanURL(_ url: String) -> String {
        guard var parts = URLComponents(string: url) else { return url }
        var items = (parts.queryItems ?? []).filter { $0.name != "source" }
        items.append(URLQueryItem(name: "source", value: "qr_code"))
        parts.queryItems = items
        return parts.string ?? url
    }

    /// What a person reads under the code: host and path, no scheme, no query.
    private static func readable(_ url: String) -> String {
        var s = URLComponents(string: url).map { ($0.host ?? "") + $0.path } ?? url
        if s.hasPrefix("www.") { s.removeFirst(4) }
        return s.isEmpty ? url : s
    }
}

/// Owns the proxy, the overlay and the retry logic for one webview.
final class OfflineCardController {
    private weak var webView: WKWebView?
    private let homeURL: URL?
    private var proxy: NavigationOutcomeProxy?
    private var overlay: OfflineCardView?
    private var lastFailedURL: URL?
    private let monitor = NWPathMonitor()
    private var foregroundObserver: NSObjectProtocol?

    init(webView: WKWebView, homeURL: URL?) {
        self.webView = webView
        self.homeURL = homeURL

        let proxy = NavigationOutcomeProxy(inner: webView.navigationDelegate)
        proxy.onLoaded = { [weak self] in self?.hide() }
        proxy.onNetworkFailure = { [weak self] url in self?.show(failedURL: url) }
        webView.navigationDelegate = proxy
        self.proxy = proxy

        // Connection back while the offline card is up → load straight away.
        monitor.pathUpdateHandler = { [weak self] path in
            guard path.status == .satisfied else { return }
            DispatchQueue.main.async { self?.retryIfShowing() }
        }
        monitor.start(queue: DispatchQueue(label: "me.swiftcard.offline-card"))

        foregroundObserver = NotificationCenter.default.addObserver(
            forName: UIApplication.willEnterForegroundNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in self?.retryIfShowing() }
    }

    deinit {
        monitor.cancel()
        if let foregroundObserver { NotificationCenter.default.removeObserver(foregroundObserver) }
    }

    private func show(failedURL: URL?) {
        guard let webView else { return }
        if let failedURL { lastFailedURL = failedURL }
        let view = overlay ?? {
            let v = OfflineCardView(frame: webView.bounds)
            v.autoresizingMask = [.flexibleWidth, .flexibleHeight]
            v.onRetry = { [weak self] in self?.retry() }
            overlay = v
            return v
        }()
        // Re-read every time: the card may have changed since the last show.
        view.show(card: OfflineCardInfo.load())
        view.frame = webView.bounds
        // Added to the webview (the bridge's root view), above the launch
        // splash, which the SplashScreen plugin also adds there. Without this
        // the card would sit behind the splash until its 15s failsafe.
        webView.addSubview(view)
        webView.bringSubviewToFront(view)
    }

    private func hide() {
        overlay?.removeFromSuperview()
        lastFailedURL = nil
    }

    private func retryIfShowing() {
        guard overlay?.superview != nil else { return }
        retry()
    }

    private func retry() {
        guard let webView else { return }
        // A failed provisional load leaves webView.url on the PREVIOUS page (or
        // nil on a cold open), so reload() would not retry what failed. Load
        // the failing URL itself; fall back to the app's start URL.
        if let url = lastFailedURL ?? homeURL {
            webView.load(URLRequest(url: url))
        } else {
            webView.reload()
        }
    }
}
