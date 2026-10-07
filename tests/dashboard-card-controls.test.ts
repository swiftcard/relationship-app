import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ── One control for opening your own card, not two ───────────────────────────
//
// History, because this regressed once and the mechanism is easy to repeat:
//
//   2026-06-25  A "Preview" link was added inside CardPreviewDownload, rendered
//               whenever the `previewUrl` prop was passed.
//   2026-07-10  The dashboard DROPPED previewUrl — which removed that link —
//               and added the "View live card" button instead. One control.
//   2026-07-27  An iOS audit needed previewUrl back, because DownloadCardButton
//               uses it as the native share target (WKWebView can't save a
//               generated PNG). Restoring the prop silently resurrected the
//               "Preview" link, putting two buttons for the same URL side by
//               side again. The commit even noted the link reappearing and
//               shipped anyway.
//
// The trap: `previewUrl` serves TWO purposes, and the one you want (native
// share) drags in the one you don't (the link). These pin them apart.

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8");

describe("the dashboard has exactly one way to open your live card", () => {
  const preview = read("src/components/CardPreviewDownload.tsx");
  const dashboard = read("src/app/dashboard/page.tsx");

  it("CardPreviewDownload renders no Preview link", () => {
    expect(preview, "the Preview link is back — it duplicates View live card").not.toMatch(/>\s*Preview\s*</);
    // The specific shape that came back: an anchor guarded on previewUrl.
    expect(preview, "previewUrl is rendering a link again").not.toMatch(/\{previewUrl && \(\s*<a/);
  });

  it("the card box is just the card: no previewUrl, no share link, no download", () => {
    // 2026-10-06: the download saved a real PNG in the app too (lib/save-image),
    // so the link stopped being its native fallback. 2026-10-07 (owner): the
    // desktop-only Download under the card went too — it duplicated "Other
    // ways to share → Download card (PNG)", which every device already has —
    // and with it previewUrl, whose last job was deciding where it sat.
    expect(preview).not.toMatch(/shareUrl/);
    expect(preview).not.toMatch(/previewUrl/);
    expect(preview).not.toMatch(/<DownloadCardButton/);
    expect(dashboard).not.toMatch(/previewUrl=\{cardUrl\}/);
  });

  it("View live is the one control, and it's still there", () => {
    // Match the rendered TEXT NODE, not the bare phrase: the phrase also appears
    // in the comment explaining why previewUrl renders nothing, so a plain count
    // sees two and fails. (Third time a comment of mine has fooled one of these
    // assertions — always anchor on what actually ships.)
    //
    // 2026-08-11: the page header that held this button was removed, and the
    // button moved INTO the My Cards box beside "Add card", shortened to
    // "View live". The pattern below is deliberately a superset — it still
    // matches the old "View live card" — so resurrecting the header control
    // under either label trips the duplicate check rather than sneaking past a
    // now-stale exact string.
    // Case-insensitive, and a text node may follow a JSX comment's `}` as well
    // as a tag's `>`, so the rename to "View Live Link" is still counted here.
    const rendered = dashboard.match(/(?:>|\})\s*View live[^<{]*</gi) ?? [];
    expect(rendered.length, "View live is missing, or duplicated").toBe(1);
  });

  it("reads 'View Live Link' on every device", () => {
    // Owner, 2026-09-29: the phone first, then the computer too. One label, no
    // phone/computer split left behind.
    expect(dashboard).toMatch(/\}\s*View Live Link\s*<\/a>/);
    expect(dashboard, "the old computer-only label is back").not.toMatch(/>\s*View live\s*</);
    expect(dashboard).not.toMatch(/<span className="lg:hidden">View Live Link<\/span>/);
  });

  it("it lives in the My Cards box, not a page header", () => {
    // The header (an <h1>Dashboard</h1> and the selected card's name) is gone;
    // the control belongs beside the card list it acts on.
    expect(dashboard, "the Dashboard page header is back").not.toMatch(/<h1[^>]*>Dashboard<\/h1>/);
    expect(dashboard).toMatch(/flex items-center gap-2 shrink-0/);
  });
});
