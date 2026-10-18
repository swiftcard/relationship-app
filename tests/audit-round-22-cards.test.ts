import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// ── Audit round 22 (2026-10-18): a card that never vanishes, an NFC write
//    that can be stopped ────────────────────────────────────────────────────
//
// C02-009  CardScaler read a 0 width as real: scale 0, opacity 0, height 0.
//          The boot script read the same 0 as "not measurable" (|| 460), so a
//          card the server HTML showed was hidden by hydration whenever the
//          slot measured 0 at that moment — Safari's link previews, Quick
//          Look, a lazily laid-out background tab.
// C02-011  "Write to a tag" waited for a tag forever: no cancel, no timeout,
//          no stop on leaving the page — the next tag near the phone was
//          written.
// C02-012  Checked, no change: a MANUAL rename frees the old address by
//          design (rename_card_slug keeps no alias, the editor warns), so the
//          old serial's Wallet registrations must go with it.

const read = (p: string) => readFileSync(p, "utf8");

describe("C02-009: a 0 measurement never hides the card", () => {
  const scaler = read("src/components/CardScaler.tsx");
  const recompute = scaler.slice(scaler.indexOf("function recompute()"), scaler.indexOf("recompute();"));

  it("hydration reads 0 the way the boot script does: as unknown", () => {
    expect(recompute).toContain("const measured = outerRef.current?.clientWidth || 0;");
    expect(recompute).toContain("if (!measured && lastScaleRef.current > 0) return;");
    expect(recompute).toContain("const w = measured || NATURAL;");
    expect(recompute).not.toMatch(/clientWidth \?\? NATURAL/);
    expect(scaler).toContain("var w=o.clientWidth||${NATURAL}");
  });

  it("the self-report ignores a page nobody is looking at", () => {
    expect(scaler).toContain('document.visibilityState !== "visible"');
    expect(scaler).toContain("prerendering === true");
    expect(scaler).toContain("window.innerWidth === 0");
    expect(scaler).toContain("if (!unseen && isCollapsedWhileVisible(outerRef.current)) reportCollapse(NATURAL);");
  });
});

describe("C02-011: an NFC write can be stopped", () => {
  const nfc = read("src/components/NFCWriter.tsx");

  it("writes with an abort signal, gives up after a minute, and stops when the page goes", () => {
    expect(nfc).toContain("await reader.write({ records: [{ recordType: \"url\", data: tagUrl }] }, { signal: ctrl.signal });");
    expect(nfc).toContain("const WRITE_TIMEOUT_MS = 60_000;");
    expect(nfc).toContain("useEffect(() => () => pending.current?.abort(), []);");
  });

  it("the same button cancels while waiting — it is no longer disabled", () => {
    expect(nfc).toContain("if (pending.current) { pending.current.abort(); return; } // tap again = cancel");
    expect(nfc).not.toMatch(/disabled=\{status === "writing"\}/);
    expect(nfc).toContain('"Waiting for a tag… (tap to cancel)"');
  });
});

describe("C02-012: a manual rename releases the old address on purpose", () => {
  it("the route frees the old slug (no alias), so its Wallet registrations go too", () => {
    const rename = read("src/app/api/cards/[id]/rename/route.ts");
    expect(rename).toContain("Old shared links / QR codes / Wallet passes point at the old");
    expect(rename).toContain("await releaseSlugArtifacts(admin, [oldSlug]);");
    expect(rename).not.toMatch(/_prevSlugs\s*=/);
  });
});
