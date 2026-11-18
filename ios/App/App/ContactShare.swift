import Foundation
import Capacitor
import MessageUI
import UIKit

// ─────────────────────────────────────────────────────────────────────────────
// ContactShare: a texted card link carries the owner's contact card.
//
// WHY (owner report, 2026-11-18): a card link texted to someone the owner had
// just met arrived dead: not tappable, no preview, and they had to paste it into
// Safari. The same link texted to the owner's partner worked perfectly. The cause
// is iMessage, not the iOS version: links in a message from a number the
// recipient has not saved stay switched off, and their preview never loads,
// until the recipient replies or saves the sender (Apple's anti-phishing rule,
// tightened in iOS 26 by "Screen Unknown Senders"). No URL or server change can
// get around it.
//
// A contact card (.vcf) attached to the same text still arrives from an unknown
// number. One tap and "Create New Contact" saves the owner, which makes the
// owner a known sender, so the link turns tappable and the preview loads. Even
// if they never open the link, they now have the contact, which was the point.
//
// The website cannot do this: an sms: link cannot carry a file, and a browser's
// share sheet cannot give a file to Messages alone. So it lives here, in the
// shell. src/lib/native-contact-share.ts calls it and falls back to today's
// link-only share whenever this plugin is missing (an older app version).
//
// Methods:
//   prepare({ vcardUrl, fileName })   download the card ahead of the tap
//   share({ url, vcardUrl, fileName }) the share sheet. Messages gets the
//                                      link AND the contact card; every other
//                                      app gets the link only, as before.
//   text({ phone, body, vcardUrl, fileName }) Messages, already addressed,
//                                      message written, contact card attached.
//
// Both share and text RESOLVE with { result: "shared" | "cancelled" }. Closing
// the sheet is the person's answer, never a reason to open another one (the
// double-sheet bug in src/lib/native-share.ts). text rejects with code
// UNAVAILABLE only when this device cannot send texts at all, so the web side
// can fall back to the sms: link.
//
// Pinned by tests/contact-card-share.test.ts.
// ─────────────────────────────────────────────────────────────────────────────

@objc(ContactSharePlugin)
public class ContactSharePlugin: CAPPlugin, CAPBridgedPlugin, MFMessageComposeViewControllerDelegate {
    public let identifier = "ContactSharePlugin"
    public let jsName = "ContactShare"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "prepare", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "share", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "text", returnType: CAPPluginReturnPromise),
    ]

    /// A downloaded card is reused for this long. The owner editing the card
    /// mid-session is rare; a stale phone number on a card sent minutes later is
    /// worse than one extra download, so keep it short.
    private static let cacheLifetime: TimeInterval = 10 * 60
    /// Past this, the share goes out without the card, the same as before this
    /// plugin existed. Nobody waits longer than this on a share button.
    private static let downloadTimeout: TimeInterval = 4

    private var cache: [String: (file: URL, data: Data, at: Date)] = [:]
    private var pendingText: CAPPluginCall?

    // MARK: - JS methods

    @objc func prepare(_ call: CAPPluginCall) {
        guard let vcardUrl = Self.httpsURL(call.getString("vcardUrl")) else {
            call.resolve(["ready": false])
            return
        }
        let fileName = Self.safeFileName(call.getString("fileName"))
        card(vcardUrl, fileName: fileName) { card in
            call.resolve(["ready": card != nil])
        }
    }

    @objc func share(_ call: CAPPluginCall) {
        guard let url = Self.httpsURL(call.getString("url")) else {
            call.reject("A https url is required")
            return
        }
        let fileName = Self.safeFileName(call.getString("fileName"))
        let present: (URL?) -> Void = { [weak self] file in
            DispatchQueue.main.async {
                guard let self = self, let host = self.bridge?.viewController else {
                    call.reject("No view to present from")
                    return
                }
                var items: [Any] = [CardLinkItem(url: url)]
                if let file = file { items.append(ContactCardItem(file: file)) }
                let sheet = UIActivityViewController(activityItems: items, applicationActivities: nil)
                sheet.completionWithItemsHandler = { activity, completed, _, _ in
                    call.resolve([
                        "result": completed ? "shared" : "cancelled",
                        "activityType": activity?.rawValue ?? "",
                    ])
                }
                // iPad: a share sheet is a popover and crashes without an anchor.
                if let pop = sheet.popoverPresentationController {
                    pop.sourceView = host.view
                    pop.sourceRect = CGRect(x: host.view.bounds.midX, y: host.view.bounds.midY, width: 0, height: 0)
                    pop.permittedArrowDirections = []
                }
                host.present(sheet, animated: true)
            }
        }
        guard let vcardUrl = Self.httpsURL(call.getString("vcardUrl")) else {
            present(nil)
            return
        }
        card(vcardUrl, fileName: fileName) { card in present(card?.file) }
    }

    @objc func text(_ call: CAPPluginCall) {
        let body = call.getString("body") ?? ""
        let phone = (call.getString("phone") ?? "").filter { $0.isNumber || $0 == "+" }
        let fileName = Self.safeFileName(call.getString("fileName"))
        DispatchQueue.main.async {
            guard MFMessageComposeViewController.canSendText() else {
                call.reject("This device can't send texts", "UNAVAILABLE")
                return
            }
            // The bridge holds this plugin for the life of the app, so a
            // strong self here outlives nothing.
            let present: ((file: URL, data: Data)?) -> Void = { card in
                DispatchQueue.main.async {
                    guard let host = self.bridge?.viewController else {
                        call.reject("No view to present from")
                        return
                    }
                    let composer = MFMessageComposeViewController()
                    composer.messageComposeDelegate = self
                    if !phone.isEmpty { composer.recipients = [phone] }
                    composer.body = body
                    if let card = card,
                       MFMessageComposeViewController.canSendAttachments(),
                       MFMessageComposeViewController.isSupportedAttachmentUTI("public.vcard") {
                        composer.addAttachmentData(card.data, typeIdentifier: "public.vcard", filename: card.file.lastPathComponent)
                    }
                    self.pendingText?.resolve(["result": "cancelled"])
                    self.pendingText = call
                    host.present(composer, animated: true)
                }
            }
            guard let vcardUrl = Self.httpsURL(call.getString("vcardUrl")) else {
                present(nil)
                return
            }
            self.card(vcardUrl, fileName: fileName) { card in
                present(card.map { (file: $0.file, data: $0.data) })
            }
        }
    }

    public func messageComposeViewController(_ controller: MFMessageComposeViewController, didFinishWith result: MessageComposeResult) {
        controller.dismiss(animated: true)
        let call = pendingText
        pendingText = nil
        call?.resolve(["result": result == .sent ? "shared" : "cancelled"])
    }

    // MARK: - The contact card file

    /// The card as a file named after the owner, from the cache when it is
    /// fresh. nil when it cannot be had in time; the caller then shares without it.
    private func card(_ url: URL, fileName: String, done: @escaping ((file: URL, data: Data)?) -> Void) {
        DispatchQueue.main.async {
            let key = url.absoluteString + "|" + fileName
            if let hit = self.cache[key], Date().timeIntervalSince(hit.at) < Self.cacheLifetime,
               FileManager.default.fileExists(atPath: hit.file.path) {
                done((hit.file, hit.data))
                return
            }
            var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: Self.downloadTimeout)
            request.setValue("text/vcard", forHTTPHeaderField: "Accept")
            URLSession.shared.dataTask(with: request) { data, response, _ in
                guard let data = data,
                      (response as? HTTPURLResponse)?.statusCode == 200,
                      let head = String(data: data.prefix(64), encoding: .utf8),
                      head.uppercased().contains("BEGIN:VCARD"),
                      let file = Self.write(data, fileName: fileName) else {
                    done(nil)
                    return
                }
                DispatchQueue.main.async {
                    self.cache[key] = (file, data, Date())
                    done((file, data))
                }
            }.resume()
        }
    }

    private static func write(_ data: Data, fileName: String) -> URL? {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("contact-card", isDirectory: true)
        do {
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            let file = dir.appendingPathComponent(fileName).appendingPathExtension("vcf")
            try data.write(to: file, options: .atomic)
            return file
        } catch {
            return nil
        }
    }

    /// "Aaron Lavi" stays "Aaron Lavi"; path separators and control characters go.
    private static func safeFileName(_ raw: String?) -> String {
        let banned = CharacterSet(charactersIn: "/\\:?%*|\"<>").union(.controlCharacters).union(.newlines)
        let cleaned = (raw ?? "").components(separatedBy: banned).joined().trimmingCharacters(in: .whitespacesAndNewlines)
        let short = String(cleaned.prefix(60)).trimmingCharacters(in: .whitespaces)
        return short.isEmpty || short.hasPrefix(".") ? "Contact" : short
    }

    private static func httpsURL(_ raw: String?) -> URL? {
        guard let raw = raw, let url = URL(string: raw), let host = url.host else { return nil }
        let scheme = url.scheme?.lowercased()
        if scheme == "https" { return url }
        #if DEBUG
        // Simulator testing against a local build, never the live site
        // (CLAUDE.md). Compiled out of every release build.
        if scheme == "http" && host == "localhost" { return url }
        #endif
        return nil
    }
}

// MARK: - Share sheet items

/// The card link, for every app, exactly what the sheet shared before.
private final class CardLinkItem: NSObject, UIActivityItemSource {
    let url: URL
    init(url: URL) { self.url = url }

    func activityViewControllerPlaceholderItem(_ activityViewController: UIActivityViewController) -> Any { url }

    func activityViewController(_ activityViewController: UIActivityViewController, itemForActivityType activityType: UIActivity.ActivityType?) -> Any? { url }
}

/// The contact card, for Messages ONLY.
///
/// Its placeholder is an empty string, not the file. The sheet decides which
/// apps to list from the placeholders, and an app whose share extension takes
/// links but not contact files would drop out of the list if the placeholder
/// were the .vcf. Text is something nearly every messaging app accepts beside a
/// link. Every activity but Messages then gets nil from this item, so WhatsApp,
/// Mail, AirDrop and the rest receive the bare link, as they always did. Mail
/// and AirDrop don't need the card: Apple's unknown-sender rule is iMessage's.
private final class ContactCardItem: NSObject, UIActivityItemSource {
    let file: URL
    init(file: URL) { self.file = file }

    func activityViewControllerPlaceholderItem(_ activityViewController: UIActivityViewController) -> Any { "" }

    func activityViewController(_ activityViewController: UIActivityViewController, itemForActivityType activityType: UIActivity.ActivityType?) -> Any? {
        activityType == .message ? file : nil
    }

    func activityViewController(_ activityViewController: UIActivityViewController, dataTypeIdentifierForActivityType activityType: UIActivity.ActivityType?) -> String {
        activityType == .message ? "public.vcard" : "public.plain-text"
    }
}
