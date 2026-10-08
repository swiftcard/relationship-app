import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  stripArtworkPrompt, transferChecklist, cleanDesignSpec, faceLayoutFromScan, freeLayoutFromFace, maskBoxes,
  findLeaks, artworkLeaks, outputProblems, hasProblems, retrySuffix, leakRetrySuffix, sourceFacts,
  OUTPUT_CHECK_PROMPT, SOURCE_FACTS_PROMPT, PRECISE_SCAN_PROMPT, DESIGN_SPEC_PROMPT, EMPTY_FACTS,
} from "@/lib/design-transfer";
import { normalizeCustomLayout } from "@/lib/custom-layout";
import type { CustomLayout } from "@/components/card-templates/types";

// Copy a card = "the design in this picture, as MY editable card" (owner,
// 2026-10-08). Load-bearing and easy to lose in an innocent edit:
//
//  1. The model draws ONLY artwork — no letter, logo or face — and the output
//     check knows the ORIGINAL card's facts, so a surviving brand or name is
//     caught, not just a foreign email.
//  2. The card is cut out of whatever surrounds it, in the source and in the
//     generated image, so a mockup or a desk is never "the card".
//  3. The owner's details are OUR elements at the measured positions, so the
//     result is editable and can never be misspelled.
//  4. bgImage/faceImage are URLs that land in an <img src> on the public card,
//     so normalizeCustomLayout must drop anything that isn't ours.

const id = { name: "Menash Harooni", title: "Founder", phone: "(516) 829-0348", email: "m@swiftcard.me", hasLogo: true };

describe("the artwork prompt", () => {
  it("asks for a clean digital redraw with every letter, logo and face left out", () => {
    const p = stripArtworkPrompt();
    expect(p).toMatch(/clean, flat DIGITAL graphic/);
    expect(p).not.toMatch(/textures/);
    expect(p).toMatch(/LEAVE OUT COMPLETELY, with no trace: all text/);
    expect(p).toMatch(/every logo,\s+emblem, brand mark, icon and wordmark/);
    expect(p).toMatch(/photograph of a person/);
    expect(p).toMatch(/no sample name/);
    // Framing — the whole-picture-as-the-card glitch, named at the source.
    expect(p).toMatch(/fills the\s+ENTIRE canvas edge to edge/);
    expect(p).toMatch(/no drop\s+shadow, no table, no second card/);
    expect(p).toMatch(/no paper texture or grain/);
  });

  it("tells the model the blanked rectangles are deliberate when the card was painted out first", () => {
    expect(stripArtworkPrompt("", { masked: true })).toMatch(/have been blanked\s+on purpose/);
    expect(stripArtworkPrompt("")).not.toMatch(/blanked/);
  });

  it("the design read rides along when there is one, and never describes the logo", () => {
    const spec = cleanDesignSpec("Base colour #f5f0e6 (cream). Navy #1b2a4a band across the left third, thin gold #c9a24a rule under the name.");
    expect(spec).toContain("#1b2a4a");
    expect(stripArtworkPrompt(spec)).toContain(spec);
    expect(cleanDesignSpec("ok")).toBe("");
    expect(cleanDesignSpec(null)).toBe("");
    expect(stripArtworkPrompt("")).not.toMatch(/THE DESIGN, as read/);
    expect(DESIGN_SPEC_PROMPT).toMatch(/Do NOT describe the logo's subject/);
  });

  it("the checklist is about the artwork and the arrangement, not spelling", () => {
    const items = transferChecklist(id).join(" | ");
    expect(items).toMatch(/Nothing from the original card/i);
    expect(items).toMatch(/Your logo sits where theirs was/);
    expect(items).toMatch(/drag anything to move it/);
    expect(transferChecklist({ ...id, hasLogo: false }).join(" | ")).toMatch(/original logo is gone/);
  });
});

describe("normalizeCustomLayout: faceImage and bgImage are guarded sinks", () => {
  const base: Partial<CustomLayout> = { background: "#fff", textColor: "#111", fontFamily: "sans-serif", elements: [] };
  const ours = `${process.env.NEXT_PUBLIC_APP_URL || "https://swiftcard.me"}/x/face.png`;

  it("keeps an https URL on our own host", () => {
    expect(normalizeCustomLayout({ ...base, faceImage: ours }).faceImage).toBe(ours);
    const free = normalizeCustomLayout({ ...base, bgImage: ours, elements: [{ id: "name", type: "field", field: "name", x: 5, y: 5 }] });
    expect(free.bgImage).toBe(ours);
    expect(free.elements).toHaveLength(1);
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
      expect(normalizeCustomLayout({ ...base, bgImage: bad as never }).bgImage, String(bad)).toBeUndefined();
    }
  });

  it("the free renderer draws the artwork under the elements and the editor can remove it", () => {
    const card = readFileSync("src/components/card-templates/CustomCard.tsx", "utf8");
    const bg = card.indexOf("layout.bgImage &&");
    const els = card.indexOf("layout.elements.map((el) => (\n        <FreeElement");
    expect(bg).toBeGreaterThan(-1);
    expect(els).toBeGreaterThan(bg);
    expect(readFileSync("src/components/FreeCardEditor.tsx", "utf8")).toMatch(/commit\(\{ \.\.\.layout, bgImage: undefined \}\)/);
  });
});

describe("faceLayoutFromScan: the measurement validator", () => {
  it("clamps hostile geometry and drops unknown kinds", () => {
    const out = faceLayoutFromScan({
      background: "url(javascript:alert(1))",
      font: "comic",
      panels: [{ x: -50, y: 900, w: 1e9, h: 0, color: "red" }],
      elements: [
        { kind: "name", x: 120, y: -5, w: 400, h: 2, align: "diagonal", color: "#ZZZZZZ", weight: "heavy", size: "massive" },
        { kind: "script", x: 0, y: 0, w: 10, h: 10 },
        { kind: "name", x: 1, y: 1, w: 10, h: 10 }, // duplicate — dropped
      ],
    });
    expect(out).not.toBeNull();
    expect(out!.background).toBe("#ffffff"); // junk → fallback, never a CSS sink
    expect(out!.font).toBeUndefined();
    expect(out!.panels[0]).toMatchObject({ x: 0, y: 100, color: "#e5e7eb" });
    expect(out!.elements).toHaveLength(1);
    expect(out!.elements[0]).toMatchObject({ kind: "name", x: 0, align: "left", size: "md", weight: "bold" });
    expect(out!.elements[0].x + out!.elements[0].w).toBeLessThanOrEqual(100);
  });

  it("reads the font family and the icon flag; the old serif boolean still works", () => {
    expect(faceLayoutFromScan({ background: "#ffffff", font: "elegant", elements: [] })!.font).toBe("elegant");
    expect(faceLayoutFromScan({ background: "#ffffff", serif: true, elements: [] })!.font).toBe("serif");
    const out = faceLayoutFromScan({ background: "#ffffff", elements: [{ kind: "phone", x: 5, y: 60, w: 30, h: 5, icon: true }] })!;
    expect(out.elements.find((e) => e.kind === "phone")!.icon).toBe(true);
    expect(PRECISE_SCAN_PROMPT).toMatch(/"font":"sans"\|"serif"\|"display"\|"elegant"\|"mono"\|"rounded"/);
    expect(PRECISE_SCAN_PROMPT).toMatch(/"icon": true when a small symbol/);
  });

  it("keeps the extra content boxes for painting out, drops a box that is most of the card", () => {
    const out = faceLayoutFromScan({
      background: "#ffffff",
      elements: [{ kind: "name", x: 10, y: 10, w: 40, h: 8 }, { kind: "logo", x: 70, y: 10, w: 20, h: 20 }],
      extra: [{ x: 10, y: 80, w: 30, h: 5 }, { x: 0, y: 0, w: 100, h: 60 }, "junk", { x: 50, y: 50 }],
    })!;
    expect(out.extra).toEqual([{ x: 10, y: 80, w: 30, h: 5 }]);
    // Everything measured, plus the extras, is a box to paint out.
    expect(maskBoxes(out)).toEqual([
      { x: 10, y: 10, w: 40, h: 8 }, { x: 70, y: 10, w: 20, h: 20 }, { x: 10, y: 80, w: 30, h: 5 },
    ]);
    expect(PRECISE_SCAN_PROMPT).toMatch(/extra = the box of EVERY other piece of content/);
  });

  it("synthesizes a name slot when the reading lacks one — never rejects for it", () => {
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
describe("faceLayoutFromScan: contrast and bounds rescue", () => {
  it("flips ink that matches the surface it sits on", () => {
    const out = faceLayoutFromScan({
      background: "#f0f0ee",
      elements: [{ kind: "name", x: 5, y: 80, w: 40, h: 10, color: "#ffffff", size: "xl", weight: "bold", align: "left" }],
    })!;
    expect(out.elements.find((e) => e.kind === "name")!.color).toBe("#141b26");
  });

  it("respects the panel under the element, not just the background", () => {
    const out = faceLayoutFromScan({
      background: "#ffffff",
      panels: [{ x: 50, y: 0, w: 50, h: 100, color: "#1e0f2d" }],
      elements: [{ kind: "phone", x: 60, y: 30, w: 30, h: 8, color: "#111111", size: "md", weight: "normal", align: "left" }],
    })!;
    expect(out.elements.find((e) => e.kind === "phone")!.color).toBe("#ffffff");
  });

  it("keeps a readable measured color (accents survive)", () => {
    const out = faceLayoutFromScan({
      background: "#f0f0ee",
      elements: [{ kind: "company", x: 5, y: 10, w: 40, h: 8, color: "#673ab7", size: "md", weight: "bold", align: "left" }],
    })!;
    expect(out.elements.find((e) => e.kind === "company")!.color).toBe("#673ab7");
  });

  it("pulls low text up so its glyphs stay on the canvas", () => {
    const out = faceLayoutFromScan({
      background: "#ffffff",
      elements: [{ kind: "name", x: 5, y: 95, w: 40, h: 3, color: "#111111", size: "xl", weight: "bold", align: "left" }],
    })!;
    const name = out.elements.find((e) => e.kind === "name")!;
    expect(name.y + (84 * 1.3 / 800) * 100).toBeLessThanOrEqual(98.01);
  });

  it("slides an off-canvas image back inside", () => {
    const out = faceLayoutFromScan({
      background: "#ffffff",
      elements: [{ kind: "headshot", x: 92, y: 90, w: 20, h: 20, color: "#000000", size: "md", weight: "normal", align: "left" }],
    })!;
    const img = out.elements.find((e) => e.kind === "headshot")!;
    expect(img.x + img.w).toBeLessThanOrEqual(100);
    expect(img.y + img.h).toBeLessThanOrEqual(100);
  });

  it("slides a thin accent bar off a text element's glyphs (no strike-through)", () => {
    const out = faceLayoutFromScan({
      background: "#ffffff",
      panels: [{ x: 40, y: 26, w: 20, h: 1, color: "#673ab7" }],
      elements: [{ kind: "name", x: 40, y: 22, w: 40, h: 6, color: "#111111", size: "xl", weight: "bold", align: "left" }],
    })!;
    const bar = out.panels[0];
    const name = out.elements.find((e) => e.kind === "name")!;
    expect(bar.y).toBeGreaterThanOrEqual(name.y + Math.max(name.h, (84 * 1.3 / 800) * 100));
  });

  it("leaves a real side panel alone even when text sits on it", () => {
    const out = faceLayoutFromScan({
      background: "#ffffff",
      panels: [{ x: 0, y: 0, w: 35, h: 100, color: "#1e0f2d" }],
      elements: [{ kind: "name", x: 5, y: 40, w: 25, h: 8, color: "#ffffff", size: "lg", weight: "bold", align: "left" }],
    })!;
    expect(out.panels[0]).toMatchObject({ x: 0, y: 0, h: 100 });
  });
});

// ── The measurement → an editable free design (2026-10-08) ──────────────────
describe("freeLayoutFromFace", () => {
  const face = faceLayoutFromScan({
    background: "#f5f0e6", font: "serif",
    panels: [{ x: 0, y: 0, w: 32, h: 100, color: "#1b2a4a" }],
    elements: [
      { kind: "logo", x: 6, y: 30, w: 20, h: 30, round: true },
      { kind: "name", x: 40, y: 18, w: 50, h: 9, align: "left", color: "#1b2a4a", weight: "bold", size: "xl", caps: true },
      { kind: "title", x: 40, y: 31, w: 40, h: 4, align: "left", color: "#c9a24a", weight: "normal", size: "sm" },
      { kind: "phone", x: 40, y: 62, w: 40, h: 4, align: "left", color: "#333333", weight: "normal", size: "sm", icon: true },
      { kind: "email", x: 40, y: 70, w: 45, h: 4, align: "left", color: "#333333", weight: "normal", size: "sm", icon: true },
    ],
  })!;
  const owner = { name: "Sam Lee", title: "Broker", phone: "(415) 555-0137", email: "sam@example.com", website: "https://samlee.com", hasLogo: true, hasHeadshot: false };
  const art = "https://swiftcard.me/storage/art.png";

  it("puts the owner's details at the measured positions, as fields the editor can move", () => {
    const layout = freeLayoutFromFace(face, owner, { bgImage: art });
    expect(layout.bgImage).toBe(art);
    expect(layout.fontFamily).toMatch(/Georgia/);
    expect(layout.background).toBe("#f5f0e6");
    expect(layout.accentColor).toBe("#1b2a4a");
    const byId = Object.fromEntries(layout.elements.map((e) => [e.id, e]));
    expect(byId.name).toMatchObject({ type: "field", field: "name", x: 40, y: 18, color: "#1b2a4a", weight: 700, upper: true });
    expect(byId.name.fontSize).toBeGreaterThan(byId.phone.fontSize!);
    expect(byId.phone).toMatchObject({ icon: true, color: "#333333", weight: 400 });
    expect(byId.title).toMatchObject({ color: "#c9a24a" });
    // The artwork carries the panel: no shape duplicates it.
    expect(layout.elements.some((e) => e.type === "shape")).toBe(false);
    // The live QR is on the card, bottom-right, and pictures paint before text.
    expect(byId.qr).toMatchObject({ type: "qr", align: "right" });
    expect(layout.elements.findIndex((e) => e.id === "logo")).toBeLessThan(layout.elements.findIndex((e) => e.id === "name"));
  });

  it("the owner's logo takes the original logo's slot, in its shape; no headshot slot without a headshot", () => {
    const layout = freeLayoutFromFace(face, owner, { bgImage: art });
    const logo = layout.elements.find((e) => e.type === "logo")!;
    expect(logo).toMatchObject({ x: 6, y: 30, frame: "circle" });
    expect(logo.size).toBeGreaterThan(24);
    expect(layout.elements.some((e) => e.type === "headshot")).toBe(false);
    // No logo at all → no logo element, nothing to show a placeholder for.
    expect(freeLayoutFromFace(face, { ...owner, hasLogo: false }, { bgImage: art }).elements.some((e) => e.type === "logo")).toBe(false);
  });

  it("a detail the original had no slot for is stacked under the last contact line, in its style", () => {
    const layout = freeLayoutFromFace(face, owner, { bgImage: art });
    const email = layout.elements.find((e) => e.id === "email")!;
    const site = layout.elements.find((e) => e.id === "website")!;
    expect(site).toBeTruthy();
    expect(site.x).toBe(email.x);
    expect(site.y).toBeGreaterThan(email.y);
    expect(site).toMatchObject({ fontSize: email.fontSize, color: email.color, icon: true });
    // Nothing the owner doesn't have.
    expect(layout.elements.some((e) => e.id === "company" || e.id === "address")).toBe(false);
  });

  it("without artwork, the measured panels become editable shapes behind everything", () => {
    const layout = freeLayoutFromFace(face, owner, { bgImage: null });
    expect(layout.bgImage).toBeUndefined();
    expect(layout.elements[0]).toMatchObject({ type: "shape", shape: "rect", x: 0, y: 0, w: 32, h: 100, fill: "#1b2a4a" });
  });

  it("everything it makes survives the layout gate unchanged", () => {
    const layout = freeLayoutFromFace(face, owner, { bgImage: art });
    const norm = normalizeCustomLayout(layout);
    expect(norm.elements.map((e) => e.id)).toEqual(layout.elements.map((e) => e.id));
    expect(norm.bgImage).toBe(art);
    expect(norm.blocks).toBeUndefined();
  });
});

// ── The leak gate ────────────────────────────────────────────────────────────
describe("findLeaks", () => {
  const owner = { name: "Sam Lee", company: "Lee Realty", email: "Sam@Example.com", phone: "(415) 555-0137", website: "https://www.leerealty.com/", hasLogo: true };
  const source = sourceFacts({
    names: ["Jordan Rivera"], companies: ["Starbucks Coffee Company"], brands: ["Starbucks"],
    emails: ["jordan@starbucks.com"], phones: ["(206) 555-0100"], websites: ["starbucks.com"], addresses: ["2401 Utah Ave S, Seattle"], taglines: ["Inspiring the human spirit"],
  });

  it("flags foreign emails, phones, websites; allows the owner's own", () => {
    const leaks = findLeaks(
      { emails: ["sam@example.com", "nadlanhomesllc@gmail.com"], phones: ["+1 415-555-0137", "(212) 555-9999"], websites: ["LeeRealty.com", "https://starbucks.com/cards"] },
      owner,
    );
    expect(leaks).toEqual(["nadlanhomesllc@gmail.com", "(212) 555-9999", "https://starbucks.com/cards"]);
  });

  it("knows the ORIGINAL card: its name, company, logo and slogan are leaks; the owner's are not", () => {
    const leaks = findLeaks(
      { names: ["Sam Lee", "Jordan Rivera"], companies: ["Lee Realty", "Starbucks"], logos: ["Starbucks siren", "Lee Realty monogram"] },
      owner, source,
    );
    expect(leaks).toEqual(["Jordan Rivera", "Starbucks", "Starbucks siren"]);
    // A tagline printed as a "company" line is still the source's.
    expect(findLeaks({ companies: ["Inspiring the human spirit"] }, owner, source)).toEqual(["Inspiring the human spirit"]);
  });

  it("without source facts, a name or company can't be judged — but a logo can when the owner has none", () => {
    expect(findLeaks({ names: ["Jordan Rivera"], companies: ["Starbucks"] }, owner)).toEqual([]);
    expect(findLeaks({ logos: ["green siren in a circle"] }, { ...owner, hasLogo: false })).toEqual(["green siren in a circle"]);
    expect(findLeaks({ logos: ["blue house mark"] }, owner)).toEqual([]); // could be the owner's own
  });

  it("survives junk scans and ignores short digit fragments", () => {
    expect(findLeaks(null, { name: "S" })).toEqual([]);
    expect(findLeaks({ emails: "not-an-array", phones: [42, "12345"] }, { name: "S" })).toEqual([]);
    expect(sourceFacts(null)).toEqual(EMPTY_FACTS);
    expect(sourceFacts({ names: "x", brands: [1, "Nike"] }).brands).toEqual(["Nike"]);
  });

  it("the artwork pass may carry nothing readable at all — but a decorative line is not a logo", () => {
    expect(artworkLeaks({ emails: [], names: ["Jordan Rivera"], logos: ["Starbucks siren"], companies: [] })).toEqual(["Jordan Rivera", "Starbucks siren"]);
    expect(artworkLeaks({ phones: ["(206) 555-0100"] })).toEqual(["(206) 555-0100"]);
    // Lettering of any kind counts (live: a redraw with "#C9A024" written on it).
    expect(artworkLeaks({ otherText: ["#C9A024", "SAMPLE"] })).toEqual(["#C9A024", "SAMPLE"]);
    // The checker names rules and stripes as "logos" despite instructions (live:
    // "golden horizontal line"); those are artwork and stay. A mark described
    // with brand words still counts.
    expect(artworkLeaks({ logos: ["golden horizontal line", "thin gold rule", "navy left panel", "green circle logo", "letter S monogram"] })).toEqual(["green circle logo", "letter S monogram"]);
    expect(artworkLeaks(null)).toEqual([]);
    expect(OUTPUT_CHECK_PROMPT).toContain('"otherText":[]');
  });

  it("the retry suffix names the leaked text and the mark", () => {
    const s = leakRetrySuffix(["a@b.com", "Starbucks siren"]);
    expect(s).toContain('"a@b.com"');
    expect(s).toContain('"Starbucks siren"');
    expect(s).toMatch(/the text, the logo, the\s+mark/);
  });

  it("the prompts ask for everything the gate compares", () => {
    for (const key of ['"names"', '"companies"', '"brands"', '"websites"', '"taglines"']) expect(SOURCE_FACTS_PROMPT).toContain(key);
    for (const key of ['"names"', '"companies"', '"logos"', '"websites"', '"looksLikePhoto"', '"cardCorners"']) expect(OUTPUT_CHECK_PROMPT).toContain(key);
    expect(OUTPUT_CHECK_PROMPT).toMatch(/Starbucks/);
  });
});

// ── The output check: photo look, scene, crop ───────────────────────────────
describe("outputProblems", () => {
  const owner = { name: "Sam Lee", phone: "(415) 555-0137", email: "sam@example.com" };
  const full = [[0, 0], [100, 0], [100, 100], [0, 100]];

  it("flags a photo look as well as leaks, and the retry names both", () => {
    const photo = outputProblems({ emails: ["sam@example.com"], phones: [], looksLikePhoto: true, cardCorners: full }, owner);
    expect(photo).toMatchObject({ leaks: [], photo: true, scene: false, quad: null });
    expect(hasProblems(photo)).toBe(true);
    expect(retrySuffix(photo)).toMatch(/looked like a photograph of a paper card/);
    expect(retrySuffix(photo)).not.toMatch(/it kept/);

    const both = outputProblems({ emails: ["old@owner.com"], looksLikePhoto: true }, owner);
    expect(both.leaks).toEqual(["old@owner.com"]);
    expect(retrySuffix(both)).toMatch(/"old@owner.com"/);
    expect(retrySuffix(both)).toMatch(/photograph/);
  });

  it("a card drawn with a margin is cut out; one drawn small in a scene is rejected", () => {
    // 1400×800 output, card drawn inset 8% — crop, no problem.
    const inset = outputProblems({ cardCorners: [[8, 8], [92, 8], [92, 92], [8, 92]] }, owner, EMPTY_FACTS, { width: 1400, height: 800 });
    expect(hasProblems(inset)).toBe(false);
    expect(inset.quad).toEqual([[112, 64], [1288, 64], [1288, 736], [112, 736]]);
    // Card at 30% of the frame — a mockup scene: retry, naming it.
    const scene = outputProblems({ cardCorners: [[25, 25], [75, 25], [75, 75], [25, 75]] }, owner, EMPTY_FACTS, { width: 1400, height: 800 });
    expect(scene.scene).toBe(true);
    expect(scene.quad).toBeNull();
    expect(retrySuffix(scene)).toMatch(/fill the ENTIRE canvas edge to edge/);
    // Fills the frame → nothing to cut.
    expect(outputProblems({ cardCorners: full }, owner, EMPTY_FACTS, { width: 1400, height: 800 }).quad).toBeNull();
  });

  it("artwork mode treats every transcription as a leak", () => {
    const p = outputProblems({ names: ["Jordan Rivera"], cardCorners: full }, owner, EMPTY_FACTS, { artwork: true });
    expect(p.leaks).toEqual(["Jordan Rivera"]);
  });

  it("junk or a missing flag reads as clean — never burns a retry", () => {
    expect(hasProblems(outputProblems(null, owner))).toBe(false);
    expect(hasProblems(outputProblems({ looksLikePhoto: "yes", cardCorners: "nope" }, owner))).toBe(false);
  });
});

// ── The route's shape ────────────────────────────────────────────────────────
describe("the route", () => {
  const route = readFileSync("src/app/api/design-transfer/route.ts", "utf8");

  it("cuts the card out, reads it three ways at once, draws artwork only, and answers a layout", () => {
    const flatten = route.indexOf("prepareCardImage(sourceBase64, sourceMediaType)");
    const reads = route.indexOf("prompt: DESIGN_SPEC_PROMPT");
    const art = route.indexOf("stripArtworkPrompt(spec, { masked");
    expect(flatten).toBeGreaterThan(-1);
    expect(reads).toBeGreaterThan(flatten);
    expect(art).toBeGreaterThan(reads);
    expect(route).toContain("prompt: SOURCE_FACTS_PROMPT");
    expect(route).toContain("prompt: PRECISE_SCAN_PROMPT");
    // The artwork is checked in artwork mode against the source facts, and cut to the card.
    expect(route).toMatch(/outputProblems\(scan, identity, facts, \{ artwork: true/);
    expect(route).toContain("cropToQuad(img.data, quad, \"png\")");
    // The content is painted out BEFORE the model draws, and the model is told so;
    // a flat design falls back to the painted-out card, through the same gate.
    const mask = route.indexOf("maskRegions(Buffer.from(imageBase64");
    expect(mask).toBeGreaterThan(reads);
    expect(mask).toBeLessThan(art);
    expect(route).toContain("stripArtworkPrompt(spec, { masked: !!masked })");
    expect(route).toMatch(/imageBase64: source\.imageBase64, mediaType: source\.mediaType/);
    expect(route).toMatch(/if \(!art && masked && prepared\.kind === "flat"\)/);
    // No model-drawn text any more: the full rebuild and the server-side typesetter are gone.
    expect(route).not.toMatch(/transferPrompt|renderFaceImage/);
    expect(route).toContain("freeLayoutFromFace(face, identity, { bgImage })");
    expect(route).toMatch(/layout,\s+artwork: !!bgImage/);
    // The raw upload never reaches an engine — only the prepared card does.
    expect(route).not.toMatch(/imageBase64: sourceBase64/);
    const scan = readFileSync("src/app/api/scan-design/route.ts", "utf8");
    expect(scan).toContain("prepareCardImage(imageBase64, mediaType)");
    expect(scan).toContain("imageBase64: card.imageBase64");
  });

  it("the designer previews the real renderer and commits the layout, never a frozen image", () => {
    const designer = readFileSync("src/components/CustomCardDesigner.tsx", "utf8");
    expect(designer).toMatch(/<FreeCard data=\{\{ \.\.\.data, customization: \{ \.\.\.\(data\.customization \?\? \{\}\), customLayout: transfer\.layout \} \}\} layout=\{transfer\.layout\} placeholder \/>/);
    expect(designer).toContain("commit({ ...transfer.layout, faceImage: undefined })");
    expect(designer).not.toMatch(/faceImage: transfer\.url/);
    expect(designer).not.toMatch(/Make it editable blocks instead/);
  });
});
