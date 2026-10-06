import { describe, expect, it } from "vitest";
import { transferPrompt, transferChecklist } from "@/lib/design-transfer";
import { normalizeCustomLayout } from "@/lib/custom-layout";
import type { CustomLayout } from "@/components/card-templates/types";

// Design transfer = "rebuild the uploaded design EXACTLY, with my details".
// Two things are load-bearing and easy to lose in an innocent edit:
//
//  1. The prompt must list ONLY the owner's details and must order the removal
//     of everything else — the single worst failure is the template's original
//     owner surviving onto the card.
//  2. faceImage is a URL that lands in an <img src> on the public card, so
//     normalizeCustomLayout must drop anything that isn't ours.

describe("transferPrompt", () => {
  const id = { name: "Menash Harooni", title: "Founder", phone: "(516) 829-0348", email: "m@swiftcard.me" };

  it("lists exactly the owner's details and demands removal of the rest", () => {
    const p = transferPrompt(id);
    expect(p).toContain("Menash Harooni");
    expect(p).toContain("(516) 829-0348");
    // No company given → the word must not appear as a fact line.
    expect(p).not.toMatch(/^- Company:/m);
    // The removal order — the defence against the template owner's details.
    // Strengthened 2026-08-19 after a production copy kept the original
    // owner's email: erase FIRST, then print, and say so in absolutes.
    expect(p).toMatch(/FIRST erase every trace of the original owner/);
    expect(p).toMatch(/must not contain\s+a single character of the original owner/);
    // Photo-of-a-card handling — the output is the flat card face, never the scene.
    expect(p).toMatch(/flat, straight-on, filling the\s+entire canvas/);
    expect(p).toMatch(/Never include hands/);
    // The exactness order — misspelling a phone number is worse than failing.
    expect(p).toMatch(/character for character/i);
  });

  it("numbers reference images by what was actually attached", () => {
    expect(transferPrompt({ ...id, hasHeadshot: true, hasLogo: true })).toMatch(/FIRST extra image.*headshot/s);
    expect(transferPrompt({ ...id, hasHeadshot: true, hasLogo: true })).toMatch(/SECOND extra image.*logo/s);
    // Logo alone is the FIRST extra image, not the second.
    expect(transferPrompt({ ...id, hasLogo: true })).toMatch(/FIRST extra image.*logo/s);
  });

  it("checklist covers the fields that were actually sent", () => {
    const items = transferChecklist(id).join(" | ");
    expect(items).toMatch(/name is spelled/i);
    expect(items).toMatch(/phone/i);
    expect(items).toMatch(/original card/i);
  });
});

describe("normalizeCustomLayout: faceImage is a guarded sink", () => {
  const base: Partial<CustomLayout> = { background: "#fff", textColor: "#111", fontFamily: "sans-serif", elements: [] };
  const ours = `${process.env.NEXT_PUBLIC_APP_URL || "https://swiftcard.me"}/x/face.png`;

  it("keeps an https URL on our own host", () => {
    expect(normalizeCustomLayout({ ...base, faceImage: ours }).faceImage).toBe(ours);
  });

  it("drops other hosts, http, javascript:, and junk", () => {
    for (const bad of [
      "https://evil.example.com/face.png",
      "http://swiftcard.me/face.png",
      "javascript:alert(1)",
      "//swiftcard.me/x.png",
      42,
      "",
    ]) {
      expect(normalizeCustomLayout({ ...base, faceImage: bad as never }).faceImage, String(bad)).toBeUndefined();
    }
  });
});

describe("faceLayoutFromScan: the free path's validator", () => {
  it("clamps hostile geometry and drops unknown kinds", async () => {
    const { faceLayoutFromScan } = await import("@/lib/design-transfer");
    const out = faceLayoutFromScan({
      background: "url(javascript:alert(1))",
      panels: [{ x: -50, y: 900, w: 1e9, h: 0, color: "red" }],
      elements: [
        { kind: "name", x: 120, y: -5, w: 400, h: 2, align: "diagonal", color: "#ZZZZZZ", weight: "heavy", size: "massive" },
        { kind: "script", x: 0, y: 0, w: 10, h: 10 },
        { kind: "name", x: 1, y: 1, w: 10, h: 10 }, // duplicate — dropped
      ],
    });
    expect(out).not.toBeNull();
    expect(out!.background).toBe("#ffffff"); // junk → fallback, never a CSS sink
    expect(out!.panels[0]).toMatchObject({ x: 0, y: 100, color: "#e5e7eb" });
    expect(out!.elements).toHaveLength(1);
    // The bounds pass slides the element fully onto the canvas (x+w ≤ 100)
    // rather than leaving the raw clamp artifact of x=96 with w=100.
    expect(out!.elements[0]).toMatchObject({ kind: "name", x: 0, align: "left", size: "md", weight: "bold" });
    expect(out!.elements[0].x + out!.elements[0].w).toBeLessThanOrEqual(100);
  });

  it("synthesizes a name slot when the reading lacks one — never rejects for it", async () => {
    // Rejecting killed real readings in production (2026-08-12): the model
    // sometimes mislabels the big text or truncates the list. The name is the
    // one element we can always place ourselves.
    const { faceLayoutFromScan } = await import("@/lib/design-transfer");
    const out = faceLayoutFromScan({
      background: "#0b1020",
      panels: [{ x: 0, y: 0, w: 35, h: 100, color: "#1a233a" }],
      elements: [{ kind: "phone", x: 40, y: 60, w: 40, h: 6 }],
    });
    expect(out).not.toBeNull();
    const name = out!.elements.find((e) => e.kind === "name")!;
    expect(name.x).toBe(40);           // clears the 35%-wide side panel
    expect(name.color).toBe("#ffffff"); // dark card → light name
    expect(name.size).toBe("xl");
  });
});

// ── The rescue passes (2026-08-18) ──────────────────────────────────────────
// A production probe produced a card with a white name on a white panel,
// half-clipped off the bottom edge. The validator now fixes both classes of
// reading; these pin that it keeps doing so.
describe("faceLayoutFromScan: contrast and bounds rescue", () => {
  it("flips ink that matches the surface it sits on", async () => {
    const { faceLayoutFromScan } = await import("@/lib/design-transfer");
    const out = faceLayoutFromScan({
      background: "#f0f0ee",
      elements: [{ kind: "name", x: 5, y: 80, w: 40, h: 10, color: "#ffffff", size: "xl", weight: "bold", align: "left" }],
    })!;
    const name = out.elements.find((e) => e.kind === "name")!;
    expect(name.color).toBe("#141b26"); // white-on-light rescued to dark
  });

  it("respects the panel under the element, not just the background", async () => {
    const { faceLayoutFromScan } = await import("@/lib/design-transfer");
    const out = faceLayoutFromScan({
      background: "#ffffff",
      panels: [{ x: 50, y: 0, w: 50, h: 100, color: "#1e0f2d" }],
      elements: [{ kind: "phone", x: 60, y: 30, w: 30, h: 8, color: "#111111", size: "md", weight: "normal", align: "left" }],
    })!;
    // dark ink on the dark panel → flipped to white
    expect(out.elements.find((e) => e.kind === "phone")!.color).toBe("#ffffff");
  });

  it("keeps a readable measured color (accents survive)", async () => {
    const { faceLayoutFromScan } = await import("@/lib/design-transfer");
    const out = faceLayoutFromScan({
      background: "#f0f0ee",
      elements: [{ kind: "company", x: 5, y: 10, w: 40, h: 8, color: "#673ab7", size: "md", weight: "bold", align: "left" }],
    })!;
    expect(out.elements.find((e) => e.kind === "company")!.color).toBe("#673ab7");
  });

  it("pulls low text up so its glyphs stay on the canvas", async () => {
    const { faceLayoutFromScan } = await import("@/lib/design-transfer");
    const out = faceLayoutFromScan({
      background: "#ffffff",
      elements: [{ kind: "name", x: 5, y: 95, w: 40, h: 3, color: "#111111", size: "xl", weight: "bold", align: "left" }],
    })!;
    const name = out.elements.find((e) => e.kind === "name")!;
    // xl glyphs are ~13.65% of the card tall; y + glyph height must fit in 98.
    expect(name.y + (84 * 1.3 / 800) * 100).toBeLessThanOrEqual(98.01);
  });

  it("slides an off-canvas image back inside", async () => {
    const { faceLayoutFromScan } = await import("@/lib/design-transfer");
    const out = faceLayoutFromScan({
      background: "#ffffff",
      elements: [{ kind: "headshot", x: 92, y: 90, w: 20, h: 20, color: "#000000", size: "md", weight: "normal", align: "left" }],
    })!;
    const img = out.elements.find((e) => e.kind === "headshot")!;
    expect(img.x + img.w).toBeLessThanOrEqual(100);
    expect(img.y + img.h).toBeLessThanOrEqual(100);
  });
  it("slides a thin accent bar off a text element's glyphs (no strike-through)", async () => {
    const { faceLayoutFromScan } = await import("@/lib/design-transfer");
    const out = faceLayoutFromScan({
      background: "#ffffff",
      panels: [{ x: 40, y: 26, w: 20, h: 1, color: "#673ab7" }],
      elements: [{ kind: "name", x: 40, y: 22, w: 40, h: 6, color: "#111111", size: "xl", weight: "bold", align: "left" }],
    })!;
    const bar = out.panels[0];
    const name = out.elements.find((e) => e.kind === "name")!;
    const nameBottom = name.y + Math.max(name.h, (84 * 1.3 / 800) * 100);
    expect(bar.y).toBeGreaterThanOrEqual(nameBottom); // below the glyphs, an underline again
  });

  it("leaves a real side panel alone even when text sits on it", async () => {
    const { faceLayoutFromScan } = await import("@/lib/design-transfer");
    const out = faceLayoutFromScan({
      background: "#ffffff",
      panels: [{ x: 0, y: 0, w: 35, h: 100, color: "#1e0f2d" }],
      elements: [{ kind: "name", x: 5, y: 40, w: 25, h: 8, color: "#ffffff", size: "lg", weight: "bold", align: "left" }],
    })!;
    expect(out.panels[0]).toMatchObject({ x: 0, y: 0, h: 100 }); // untouched
  });
});

// ── The leak gate (2026-08-19) ───────────────────────────────────────────────
// The erase-first prompt alone still let an original owner's email survive in
// a live test, so the route verifies the OUTPUT: emails/phones that aren't the
// owner's are leaks, one named retry, then the typeset engine.
describe("findLeaks", () => {
  it("flags foreign emails and phones, allows the owner's own", async () => {
    const { findLeaks } = await import("@/lib/design-transfer");
    const id = { name: "Sam", email: "Sam@Example.com", phone: "(415) 555-0137" };
    const leaks = findLeaks(
      { emails: ["sam@example.com", "nadlanhomesllc@gmail.com"], phones: ["+1 415-555-0137", "(212) 555-9999"] },
      id,
    );
    expect(leaks).toEqual(["nadlanhomesllc@gmail.com", "(212) 555-9999"]);
  });
  it("survives junk scans and ignores short digit fragments", async () => {
    const { findLeaks } = await import("@/lib/design-transfer");
    expect(findLeaks(null, { name: "S" })).toEqual([]);
    expect(findLeaks({ emails: "not-an-array", phones: [42, "12345"] }, { name: "S" })).toEqual([]);
  });
  it("the retry suffix names the leaked text", async () => {
    const { leakRetrySuffix } = await import("@/lib/design-transfer");
    const s = leakRetrySuffix(["a@b.com"]);
    expect(s).toContain('"a@b.com"');
    expect(s).toMatch(/must not\s+appear/);
  });
});

// ── A redraw, never a retouch (owner, 2026-10-06) ────────────────────────────
// A photo of the owner's own paper card came back as that photo — paper grain,
// lamp light, tilt — with only the text swapped. Every image prompt now asks
// for a NEW clean digital card, and the output check rejects a photo look.
describe("the copy is a clean digital redraw", () => {
  const id = { name: "Sam Lee", phone: "(415) 555-0137", email: "sam@example.com" };

  it("transferPrompt asks for a new DIGITAL card and forbids the photograph", async () => {
    const { transferPrompt } = await import("@/lib/design-transfer");
    const p = transferPrompt(id);
    expect(p).toMatch(/brand-new, print-ready DIGITAL business card/);
    expect(p).toMatch(/Never reproduce the photograph itself/);
    expect(p).toMatch(/no paper texture or grain/);
    expect(p).not.toMatch(/edited image/);
  });

  it("the design read rides along when there is one", async () => {
    const { transferPrompt, stripArtworkPrompt, cleanDesignSpec } = await import("@/lib/design-transfer");
    const spec = cleanDesignSpec("Base colour #f5f0e6 (cream). Navy #1b2a4a band across the left third, thin gold #c9a24a rule under the name.");
    expect(spec).toContain("#1b2a4a");
    expect(transferPrompt(id, spec)).toContain(spec);
    expect(stripArtworkPrompt(spec)).toContain(spec);
    // Too short or empty → nothing, and the prompts stand alone.
    expect(cleanDesignSpec("ok")).toBe("");
    expect(cleanDesignSpec(null)).toBe("");
    expect(transferPrompt(id, "")).not.toMatch(/THE DESIGN, as read/);
  });

  it("the artwork pass no longer asks for textures, and leaves the text out", async () => {
    const { stripArtworkPrompt } = await import("@/lib/design-transfer");
    const p = stripArtworkPrompt();
    expect(p).not.toMatch(/textures/);
    expect(p).toMatch(/clean, flat DIGITAL graphic/);
    expect(p).toMatch(/LEAVE OUT COMPLETELY: all text/);
  });

  it("the output check flags a photo look as well as leaks", async () => {
    const { outputProblems, hasProblems, retrySuffix, OUTPUT_CHECK_PROMPT } = await import("@/lib/design-transfer");
    expect(OUTPUT_CHECK_PROMPT).toMatch(/"looksLikePhoto":false/);
    const photo = outputProblems({ emails: ["sam@example.com"], phones: [], looksLikePhoto: true }, id);
    expect(photo).toEqual({ leaks: [], photo: true });
    expect(hasProblems(photo)).toBe(true);
    expect(retrySuffix(photo)).toMatch(/looked like a photograph of a paper card/);
    expect(retrySuffix(photo)).not.toMatch(/it kept/);

    const both = outputProblems({ emails: ["old@owner.com"], looksLikePhoto: true }, id);
    expect(both.leaks).toEqual(["old@owner.com"]);
    expect(retrySuffix(both)).toMatch(/"old@owner.com"/);
    expect(retrySuffix(both)).toMatch(/photograph/);

    // Junk or a missing flag reads as clean — never burns a retry.
    expect(hasProblems(outputProblems(null, id))).toBe(false);
    expect(hasProblems(outputProblems({ looksLikePhoto: "yes" }, id))).toBe(false);
  });

  it("the route runs flatten → design read → engines, all through the one check", async () => {
    const { readFileSync } = await import("node:fs");
    const route = readFileSync("src/app/api/design-transfer/route.ts", "utf8");
    const flatten = route.indexOf("prepareCardImage(sourceBase64, sourceMediaType)");
    const read = route.indexOf("prompt: DESIGN_SPEC_PROMPT");
    const engine = route.indexOf("transferPrompt(identity, spec)");
    expect(flatten).toBeGreaterThan(-1);
    expect(read).toBeGreaterThan(flatten);
    expect(engine).toBeGreaterThan(read);
    expect(route).toContain("stripArtworkPrompt(spec)");
    expect(route.match(/await check\(candidate\)/g)?.length).toBe(2);
    // The raw upload never reaches an engine — only the prepared card does.
    expect(route).not.toMatch(/imageBase64: sourceBase64/);
    const scan = readFileSync("src/app/api/scan-design/route.ts", "utf8");
    expect(scan).toContain("prepareCardImage(imageBase64, mediaType)");
    expect(scan).toContain("imageBase64: card.imageBase64");
  });
});
