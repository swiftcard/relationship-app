import WidgetKit
import SwiftUI
import CoreImage.CIFilterBuiltins

// ─────────────────────────────────────────────────────────────────────────────
// SwiftCard home-screen QR widget.
//
// Renders the user's active card as a scannable QR code so they can share
// without even opening the app. The app side (NativeAppBridge in the webview)
// writes the active card to the shared App Group store via
// @capacitor/preferences (group: "group.me.swiftcard.app", key "widget_card");
// this extension reads it and generates the QR locally with CoreImage — fully
// offline, no network entitlement needed.
//
// Xcode setup (see docs/ios-review/SHELL-RUNBOOK.md §Widget):
//   1. File → New → Target → Widget Extension, name: SwiftCardWidget
//      (uncheck "Include Live Activity" / configuration intents).
//   2. Replace the generated Swift file's contents with this file.
//   3. Add the App Groups capability (group.me.swiftcard.app) to BOTH the App
//      target and the SwiftCardWidget target.
// ─────────────────────────────────────────────────────────────────────────────

private let APP_GROUP = "group.me.swiftcard.app"
private let STORE_KEY = "widget_card"

struct CardInfo: Decodable {
    let url: String
    let name: String
    let company: String
}

func loadCard() -> CardInfo? {
    guard
        let raw = UserDefaults(suiteName: APP_GROUP)?.string(forKey: STORE_KEY),
        let data = raw.data(using: .utf8)
    else { return nil }
    return try? JSONDecoder().decode(CardInfo.self, from: data)
}

// QR generation — CoreImage, scaled up crisply (nearest-neighbor via CGAffineTransform).
func qrImage(for string: String) -> UIImage? {
    let filter = CIFilter.qrCodeGenerator()
    filter.message = Data(string.utf8)
    filter.correctionLevel = "M"
    guard let output = filter.outputImage else { return nil }
    let scaled = output.transformed(by: CGAffineTransform(scaleX: 12, y: 12))
    guard let cg = CIContext().createCGImage(scaled, from: scaled.extent) else { return nil }
    return UIImage(cgImage: cg)
}

// ── Timeline ─────────────────────────────────────────────────────────────────

struct Entry: TimelineEntry {
    let date: Date
    let card: CardInfo?
}

struct Provider: TimelineProvider {
    func placeholder(in context: Context) -> Entry {
        Entry(date: .now, card: CardInfo(url: "https://swiftcard.me", name: "Your SwiftCard", company: ""))
    }
    func getSnapshot(in context: Context, completion: @escaping (Entry) -> Void) {
        completion(Entry(date: .now, card: loadCard() ?? placeholder(in: context).card))
    }
    func getTimeline(in context: Context, completion: @escaping (Timeline<Entry>) -> Void) {
        // Static content — refresh occasionally in case the active card changed.
        let entry = Entry(date: .now, card: loadCard())
        completion(Timeline(entries: [entry], policy: .after(.now.addingTimeInterval(60 * 60 * 6))))
    }
}

// ── Views ────────────────────────────────────────────────────────────────────

struct QRView: View {
    let card: CardInfo
    var body: some View {
        if let ui = qrImage(for: card.url) {
            Image(uiImage: ui)
                .resizable()
                .interpolation(.none)
                .scaledToFit()
                .padding(6)
                .background(Color.white, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                .accessibilityLabel("Your SwiftCard QR code")
        } else {
            Image(systemName: "qrcode")
                .font(.system(size: 40))
                .foregroundStyle(.secondary)
        }
    }
}

struct EmptyStateView: View {
    var body: some View {
        VStack(spacing: 6) {
            Image(systemName: "bolt.fill")
                .font(.system(size: 22, weight: .bold))
                .foregroundStyle(.blue)
            Text("Open SwiftCard\nto set up your QR")
                .font(.system(size: 12, weight: .semibold))
                .multilineTextAlignment(.center)
                .foregroundStyle(.secondary)
        }
    }
}

struct WidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: Entry

    var body: some View {
        Group {
            if let card = entry.card {
                switch family {
                case .systemMedium:
                    HStack(spacing: 14) {
                        QRView(card: card)
                        VStack(alignment: .leading, spacing: 4) {
                            Text(card.name)
                                .font(.system(size: 16, weight: .bold, design: .rounded))
                                .lineLimit(1)
                            if !card.company.isEmpty {
                                Text(card.company)
                                    .font(.system(size: 12, weight: .medium))
                                    .foregroundStyle(.secondary)
                                    .lineLimit(1)
                            }
                            Spacer(minLength: 2)
                            Label("Scan to connect", systemImage: "viewfinder")
                                .font(.system(size: 11, weight: .semibold))
                                .foregroundStyle(.blue)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }
                default: // .systemSmall
                    QRView(card: card)
                }
            } else {
                EmptyStateView()
            }
        }
        .padding(family == .systemSmall ? 10 : 14)
        // Tapping the widget opens the app; NativeAppBridge sees ?source=widget
        // and lands on the dashboard with this card selected (a public card
        // page inside the app had no way back out).
        .widgetURL(URL(string: entry.card?.url ?? "https://swiftcard.me"))
        .containerBackground(for: .widget) {
            // Matches the app's brand navy; the system supplies glass/tinting
            // treatments (incl. iOS 26 glass) on top automatically.
            Color(red: 0.012, green: 0.027, blue: 0.071)
        }
    }
}

// ── Widget declaration ───────────────────────────────────────────────────────

struct SwiftCardWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "SwiftCardQR", provider: Provider()) { entry in
            WidgetView(entry: entry)
        }
        .configurationDisplayName("My SwiftCard QR")
        .description("Your card's QR code, one glance away. Anyone can scan it to connect.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

@main
struct SwiftCardWidgetBundle: WidgetBundle {
    var body: some Widget {
        SwiftCardWidget()
    }
}
