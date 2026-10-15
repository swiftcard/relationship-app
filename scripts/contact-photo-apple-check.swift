// Reads .vcf files with Apple's own Contacts framework — the parser an iPhone
// runs when Safari hands it a contact — and prints, per file, one JSON line:
// the name it read, how many phones and links, and the picture it kept
// (bytes and pixel size, 0 when it dropped it).
//
// Run by tests/render/contact-photo-apple.test.ts on the macOS CI runner:
//   swift scripts/contact-photo-apple-check.swift a.vcf b.vcf
// Exit 1 when a file can't be read as exactly one contact.

import AppKit
import Contacts
import Foundation

var failed = false
for path in CommandLine.arguments.dropFirst() {
  let name = (path as NSString).lastPathComponent
  do {
    let data = try Data(contentsOf: URL(fileURLWithPath: path))
    let contacts = try CNContactVCardSerialization.contacts(with: data)
    guard contacts.count == 1, let c = contacts.first else {
      print("{\"file\":\"\(name)\",\"error\":\"\(contacts.count) contacts\"}")
      failed = true
      continue
    }
    let image = c.imageDataAvailable ? c.imageData : nil
    var width = 0
    var height = 0
    if let d = image, let rep = NSBitmapImageRep(data: d) {
      width = rep.pixelsWide
      height = rep.pixelsHigh
    }
    let row: [String: Any] = [
      "file": name,
      "given": c.givenName,
      "family": c.familyName,
      "phones": c.phoneNumbers.count,
      "urls": c.urlAddresses.count,
      "imageBytes": image?.count ?? 0,
      "width": width,
      "height": height,
    ]
    let json = try JSONSerialization.data(withJSONObject: row, options: [.sortedKeys])
    print(String(data: json, encoding: .utf8)!)
  } catch {
    print("{\"file\":\"\(name)\",\"error\":\"\(String(describing: error).replacingOccurrences(of: "\"", with: "'"))\"}")
    failed = true
  }
}
exit(failed ? 1 : 0)
