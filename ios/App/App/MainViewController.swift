import UIKit
import Capacitor

// ─────────────────────────────────────────────────────────────────────────────
// The app's bridge view controller, existing for exactly one reason: to
// register WidgetBridgePlugin.
//
// Capacitor does NOT discover plugins by scanning the Objective-C runtime.
// `CapacitorBridge.registerPlugins()` builds its list from five hardcoded
// built-ins plus the class names in capacitor.config.json's `packageClassList`
// — and `npx cap sync ios` regenerates that list from installed npm packages
// only. An app-local plugin therefore never appears in it, no matter that the
// class is in the binary and conforms to CAPBridgedPlugin.
//
// Without this, `window.Capacitor.Plugins.WidgetBridge` is undefined, the
// optional call in NativeAppBridge.tsx quietly no-ops, and the home-screen
// widget stays on its empty state forever — the exact bug WidgetBridge was
// written to fix.
//
// `registerPluginType(_:)` is NOT the API to use here: it early-returns while
// `autoRegisterPlugins` is true, which is the default. `registerPluginInstance`
// is the supported path for app-local plugins.
//
// Wired up in Base.lproj/Main.storyboard, whose customClass points at this
// class instead of the stock CAPBridgeViewController.
// ─────────────────────────────────────────────────────────────────────────────

class MainViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        super.capacitorDidLoad()
        bridge?.registerPluginInstance(WidgetBridgePlugin())
        // Same reason as above — app-local plugins are never auto-discovered.
        // Without this line window.Capacitor.Plugins.ExternalPurchase is
        // undefined, and src/lib/external-purchase.ts (which fails closed)
        // renders no subscribe button, which is the 3.1.1 rejection again.
        bridge?.registerPluginInstance(ExternalPurchasePlugin())
        // Same reason again: app-local plugins are never auto-discovered, and
        // src/lib/app-review.ts fails closed — no plugin, no prompt, no error.
        bridge?.registerPluginInstance(AppReviewPlugin())

        // No scroll indicators: the flashing bar on the right of every scroll
        // is drawn by iOS on the webview's scroll view — CSS can't reach it.
        // Native apps built with UIKit lists show one too, but on a webview it
        // reads as "this is a web page"; the owner wants it gone (2026-08-10).
        webView?.scrollView.showsVerticalScrollIndicator = false
        webView?.scrollView.showsHorizontalScrollIndicator = false

        // THE APP NEVER ZOOMS.
        //
        // globals.css already sets `touch-action: pan-x pan-y` on the shell,
        // which drops the pinch and double-tap gestures — but only for content
        // the stylesheet reaches. It cannot cross into a cross-origin iframe,
        // and it does not govern the zoom iOS performs by itself when a form
        // control smaller than 16px is focused (a floor in globals.css handles
        // ours; a third-party embed's fields are beyond it).
        //
        // Zooming in a webview is the SCROLL VIEW's zoom, so disabling it here
        // covers every one of those cases at once, including inside iframes.
        // Pinning minimum == maximum == 1 additionally means there is no zoomed
        // state to be left stranded in, which was the actual bug: the previous
        // approach disabled the user's pinch while leaving the automatic
        // zoom-in intact, so the app zoomed itself in with no way back out.
        //
        // bouncesZoom must be off too, or a pinch still rubber-bands the whole
        // page and springs back — visually identical to a zoom that "sticks"
        // for a moment.
        //
        // Native rather than web-only because this survives any future CSS
        // regression, and because delegate-level zoom cannot be re-enabled by
        // page content.
        pinZoom()

        // capacitorDidLoad() runs ONCE, at bridge creation — and this shell
        // loads a REMOTE url (server.url = https://swiftcard.me) that performs
        // genuine full-document navigations after that point, starting with
        // sc-boot's location.replace('/dashboard') on the very first launch.
        // WebKit re-derives minimum/maximumZoomScale from each new document's
        // viewport meta and rebuilds its gesture recognisers, so a one-shot pin
        // is undone by the first navigation — i.e. before the user ever sees a
        // screen. Re-applying on every committed URL change is what makes it
        // hold for the life of the app.
        //
        // KVO on `url` rather than the navigation delegate or the scroll-view
        // delegate: Capacitor owns both (CAPBridgeViewController installs its
        // WebViewDelegationHandler as each), and taking either from it breaks
        // the bridge — plugin calls, app-bound-domain handling and its own
        // zoom guard all hang off them.
        urlObservation = webView?.observe(\.url, options: [.new]) { [weak self] _, _ in
            self?.pinZoom()
            // A new document starts at --sc-text-scale: 1 (the CSS default), so
            // the user's text size has to be re-applied on every navigation for
            // exactly the same reason the zoom pin does.
            self?.applyTextScale()
            self?.applyPlatformFlags()
        }

        applyTextScale()
        applyPlatformFlags()

        // No signal → the saved card's QR, drawn natively over the webview,
        // instead of a blank screen. See OfflineCard.swift.
        if let webView {
            offlineCard = OfflineCardController(webView: webView, homeURL: bridge?.config.appStartServerURL)
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // LARGER TEXT (Dynamic Type) for a webview app.
    //
    // WKWebView does NOT inherit Dynamic Type. iOS scales UIKit labels from
    // preferredContentSizeCategory; web content is laid out by WebKit and never
    // hears about it, so an app like this one ships with the Larger Text setting
    // doing literally nothing — which is why we could not honestly claim
    // Apple's "Larger Text" nutrition label before this.
    //
    // pageZoom is the obvious lever and the wrong one: this app pins the scroll
    // view's zoom to 1.0 in both directions (see pinZoom above), and zooming
    // also magnifies images, padding and chrome — that is a magnifier, not
    // Dynamic Type. Instead we hand WebKit the one number it needs and let the
    // stylesheet do the work: every text size in the app is rem, so setting the
    // root font-size scales type and leaves the layout grid alone.
    //
    // Clamped to 2x. Past that the phone layouts stop being usable, and the
    // label asks for support through the accessibility sizes, not to infinity.
    // ─────────────────────────────────────────────────────────────────────────
    private func textScale(for category: UIContentSizeCategory) -> Double {
        switch category {
        case .extraSmall:                        return 0.85
        case .small:                             return 0.90
        case .medium:                            return 0.95
        case .large:                             return 1.00   // iOS default
        case .extraLarge:                        return 1.12
        case .extraExtraLarge:                   return 1.24
        case .extraExtraExtraLarge:              return 1.35
        case .accessibilityMedium:               return 1.60
        case .accessibilityLarge:                return 1.75
        case .accessibilityExtraLarge:           return 1.90
        case .accessibilityExtraExtraLarge:      return 2.00
        case .accessibilityExtraExtraExtraLarge: return 2.00
        default:                                 return 1.00
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // RUNNING ON A MAC
    //
    // On Apple Silicon this same iPhone binary runs on macOS ("Designed for
    // iPhone"). Most of the app is fine there — it is a webview — but three
    // things are simply absent: Core NFC, adding a pass to Apple Wallet, and
    // the rear camera. The web layer cannot tell: the user agent still says
    // iPhone, Capacitor still says ios, and every feature check that asks
    // "am I native?" answers yes and then fails at the point of use.
    //
    // ProcessInfo.isiOSAppOnMac is the authoritative answer and exists only
    // natively, so it is pushed to the document the same way the text scale is —
    // including on every navigation, because a fresh document starts blank.
    // Read from JS as document.documentElement.dataset.scMac === "1".
    // ─────────────────────────────────────────────────────────────────────────
    func applyPlatformFlags() {
        let onMac = ProcessInfo.processInfo.isiOSAppOnMac
        let js = "document.documentElement.dataset.scMac = '\(onMac ? "1" : "0")';"
        webView?.evaluateJavaScript(js, completionHandler: nil)
    }

    func applyTextScale() {
        let scale = textScale(for: traitCollection.preferredContentSizeCategory)
        // documentElement, not body: the CSS reads var(--sc-text-scale) on :root.
        let js = "document.documentElement.style.setProperty('--sc-text-scale','\(scale)');"
        webView?.evaluateJavaScript(js, completionHandler: nil)
    }

    // Settings → Display & Brightness → Text Size can change while the app is
    // open (and Control Centre's text-size slider changes it constantly), so the
    // scale has to follow the trait, not just be read once at launch.
    override func traitCollectionDidChange(_ previous: UITraitCollection?) {
        super.traitCollectionDidChange(previous)
        if previous?.preferredContentSizeCategory != traitCollection.preferredContentSizeCategory {
            applyTextScale()
        }
    }

    /// Zoom pinned to exactly 1.0, in every direction it can be changed.
    ///
    /// bouncesZoom must be off too: with it on, a pinch still rubber-bands the
    /// whole page and springs back, which reads as a zoom that "sticks" for a
    /// moment rather than one that never happens.
    private func pinZoom() {
        guard let scrollView = webView?.scrollView else { return }
        scrollView.minimumZoomScale = 1.0
        scrollView.maximumZoomScale = 1.0
        scrollView.bouncesZoom = false
        scrollView.pinchGestureRecognizer?.isEnabled = false
    }

    private var urlObservation: NSKeyValueObservation?
    private var offlineCard: OfflineCardController?

    deinit {
        urlObservation?.invalidate()
    }
}
