import { describe, it, expect } from "vitest";
import {
  SWIFTLINK_LOOKS, FREE_SWIFTLINK_LOOKS, DEFAULT_SWIFTLINK_LOOK,
  getLook, isFreeLook, freeSafeLook,
  LOOK_FAMILIES, looksInFamily, familyOfLook, washGradient,
} from "@/lib/swiftlink-looks";

// ── WCAG relative luminance / contrast ──────────────────────────────────────
function lum(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function contrast(a: string, b: string): number {
  const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

describe("every Look is readable (WCAG AA)", () => {
  it.each(SWIFTLINK_LOOKS)("$id: text on sheet ≥ 4.5:1", (l) => {
    expect(contrast(l.text, l.sheet), `${l.id} text/sheet = ${contrast(l.text, l.sheet).toFixed(2)}`).toBeGreaterThanOrEqual(4.5);
  });
  it.each(SWIFTLINK_LOOKS)("$id: accentText on accent ≥ 4.5:1 (the Connect button)", (l) => {
    expect(contrast(l.accentText, l.accent), `${l.id} = ${contrast(l.accentText, l.accent).toFixed(2)}`).toBeGreaterThanOrEqual(4.5);
  });
  it.each(SWIFTLINK_LOOKS)("$id: mode matches the sheet it claims", (l) => {
    // A "light" look must actually have a light sheet and vice versa — the
    // mode drives neutral chrome (rings, hovers), and a lie here makes those
    // invisible.
    expect(lum(l.sheet) > 0.5, `${l.id} sheet luminance ${lum(l.sheet).toFixed(2)}`).toBe(l.mode === "light");
  });
  it("all hex values are well-formed", () => {
    for (const l of SWIFTLINK_LOOKS) {
      for (const v of [l.sheet, l.page, l.text, l.accent, l.accentText, l.tile]) {
        expect(v).toMatch(/^#[0-9A-F]{6}$/i);
      }
    }
  });
  it("ids are unique", () => {
    const ids = SWIFTLINK_LOOKS.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  // A GRADIENT look's sheet is two colours, and the text sits on both of them.
  it.each(SWIFTLINK_LOOKS.filter((l) => l.sheetTo))("$id: text on the second gradient stop ≥ 4.5:1", (l) => {
    const c = contrast(l.text, l.sheetTo!);
    expect(c, `${l.id} text/sheetTo = ${c.toFixed(2)}`).toBeGreaterThanOrEqual(4.5);
  });
});

// ── The GLASS family's real surface ─────────────────────────────────────────
//
// This is the check that keeps the see-through family honest. Text on a glass
// look does NOT sit on `sheet`: it sits on `sheet` painted at `frost` alpha
// over the colour wash, and the surface therefore changes down the page. The
// worst stop is what a reader is actually up against.
//
// Without this, a wash could be darkened one shade at a time until a light
// look's near-black text was sitting on a mid-grey, with every existing
// assertion still green — because they all measure a colour that is never
// fully on screen.
function blend(over: string, under: string, alpha: number): string {
  const [o, u] = [over, under].map((h) => {
    const n = parseInt(h.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  });
  const mix = o.map((c, i) => Math.round(c * alpha + u[i] * (1 - alpha)));
  return "#" + mix.map((v) => v.toString(16).padStart(2, "0")).join("");
}

describe("glass looks are readable through their own frosting", () => {
  const glass = SWIFTLINK_LOOKS.filter((l) => l.wash?.length);

  it("the family actually has glass looks with a wash", () => {
    // Guards against the family surviving as a label after its content is
    // refactored away.
    expect(glass.length).toBeGreaterThanOrEqual(4);
  });

  it.each(glass)("$id: text stays ≥ 4.5:1 over every wash stop", (l) => {
    for (const stop of l.wash!) {
      const surface = blend(l.sheet, stop, l.frost!);
      const c = contrast(l.text, surface);
      expect(c, `${l.id} over ${stop} → ${surface} = ${c.toFixed(2)}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it.each(glass)("$id: the frosting never flips the look's own mode", (l) => {
    // A "light" look whose surface goes dark under its wash would render its
    // chrome (rings, hover wells) invisible — the same lie the mode test above
    // catches for the sheet hex.
    for (const stop of l.wash!) {
      const surface = blend(l.sheet, stop, l.frost!);
      expect(lum(surface) > 0.5, `${l.id} over ${stop} → ${surface}`).toBe(l.mode === "light");
    }
  });

  it.each(glass)("$id: declares a frost alpha that leaves the wash visible", (l) => {
    // Fully opaque is not glass, and near-transparent cannot carry text.
    expect(l.frost, l.id).toBeGreaterThanOrEqual(0.45);
    expect(l.frost, l.id).toBeLessThanOrEqual(0.9);
  });

  it("washGradient builds a real CSS gradient, and nothing for a solid look", () => {
    expect(washGradient(getLook("frost"))).toMatch(/^linear-gradient\(160deg, #[0-9A-F]{6} 0%.*100%\)$/i);
    expect(washGradient(getLook("paper"))).toBeNull();
    // Aura is in the glass FAMILY but its "wash" is the owner's photo, which
    // the renderer supplies — it must not also paint a gradient.
    expect(washGradient(getLook("aura"))).toBeNull();
  });
});

// ── The three families ──────────────────────────────────────────────────────
describe("look families", () => {
  it("every look declares a family the picker knows about", () => {
    const known = new Set(LOOK_FAMILIES.map((f) => f.id));
    for (const l of SWIFTLINK_LOOKS) {
      expect(known.has(l.family), `${l.id} → ${l.family}`).toBe(true);
    }
  });

  it("no family is empty — an empty dropdown is a dead control", () => {
    for (const f of LOOK_FAMILIES) {
      expect(looksInFamily(f.id).length, f.id).toBeGreaterThan(0);
    }
  });

  it("every look is reachable from exactly one family", () => {
    const total = LOOK_FAMILIES.reduce((n, f) => n + looksInFamily(f.id).length, 0);
    expect(total).toBe(SWIFTLINK_LOOKS.length);
  });

  it("both free looks sit in the same group, so Free is never sent hunting", () => {
    const fams = new Set(FREE_SWIFTLINK_LOOKS.map((id) => familyOfLook(id)));
    expect(fams.size).toBe(1);
    // …and it is the group the default opens on.
    expect(familyOfLook(DEFAULT_SWIFTLINK_LOOK)).toBe([...fams][0]);
  });

  it("familyOfLook falls back with getLook rather than throwing", () => {
    expect(familyOfLook("nonsense")).toBe(familyOfLook(DEFAULT_SWIFTLINK_LOOK));
    expect(familyOfLook(null)).toBe(familyOfLook(DEFAULT_SWIFTLINK_LOOK));
  });

  it("each family is named and described for the dropdown row", () => {
    for (const f of LOOK_FAMILIES) {
      expect(f.name.length, f.id).toBeGreaterThan(2);
      expect(f.blurb.length, f.id).toBeGreaterThan(10);
    }
  });
});

describe("the plan line", () => {
  it("the default look is light and free", () => {
    // Owner decision 2026-08-18: default is light. And a default a Free page
    // cannot render would be a contradiction in terms.
    const d = getLook(DEFAULT_SWIFTLINK_LOOK);
    expect(d.mode).toBe("light");
    expect(isFreeLook(d.id)).toBe(true);
  });
  it("Onyx preserves the pre-Looks stock page byte-for-byte", () => {
    // Existing pages must not change appearance except by the deliberate
    // default flip. These are SwiftLinkProfile's old SHEET / PAGE constants.
    const onyx = getLook("onyx");
    expect(onyx.sheet.toUpperCase()).toBe("#191A1A");
    expect(onyx.page.toUpperCase()).toBe("#09090B");
    expect(onyx.text).toBe("#FFFFFF");
    expect(isFreeLook("onyx")).toBe(true);
  });
  it("exactly the advertised number of free looks", () => {
    // Photo match (the default since 2026-10-15), Paper and Onyx.
    expect(FREE_SWIFTLINK_LOOKS).toHaveLength(3);
    for (const id of FREE_SWIFTLINK_LOOKS) expect(SWIFTLINK_LOOKS.some((l) => l.id === id)).toBe(true);
  });
  it("freeSafeLook keeps free choices and snaps everything else to the default", () => {
    expect(freeSafeLook("onyx")).toBe("onyx");
    expect(freeSafeLook("paper")).toBe("paper");
    expect(freeSafeLook("orchid")).toBe(DEFAULT_SWIFTLINK_LOOK);
    expect(freeSafeLook(undefined)).toBe(DEFAULT_SWIFTLINK_LOOK);
    expect(freeSafeLook("nonsense")).toBe(DEFAULT_SWIFTLINK_LOOK);
  });
  it("getLook never returns undefined", () => {
    expect(getLook("garbage").id).toBe(DEFAULT_SWIFTLINK_LOOK);
    expect(getLook(null).id).toBe(DEFAULT_SWIFTLINK_LOOK);
  });
});

// ── Social icon shape & fill ─────────────────────────────────────────────────
// The icon customization keys are Pro styling: they must be stripped for free
// accounts exactly like the other link-style keys, and unknown stored values
// must normalize to safe defaults so an old or hand-edited row can't break the
// public page.
import { normalizeIconShape, normalizeIconFill, DEFAULT_ICON_SHAPE, DEFAULT_ICON_FILL, ICON_SHAPES, ICON_FILLS } from "../src/lib/swiftlink-looks";
import { LINK_STYLE_KEYS } from "../src/lib/plan";

describe("social icon shape & fill", () => {
  it("normalizes unknown shapes and fills to the defaults", () => {
    expect(normalizeIconShape("squircle")).toBe("squircle");
    expect(normalizeIconShape("square")).toBe("square");
    expect(normalizeIconShape("circle")).toBe("circle");
    expect(normalizeIconShape("hexagon")).toBe(DEFAULT_ICON_SHAPE);
    expect(normalizeIconShape(undefined)).toBe(DEFAULT_ICON_SHAPE);
    expect(normalizeIconShape(null)).toBe(DEFAULT_ICON_SHAPE);
    expect(normalizeIconFill("accent")).toBe("accent");
    expect(normalizeIconFill("mono")).toBe("mono");
    expect(normalizeIconFill("brand")).toBe("brand");
    expect(normalizeIconFill("rainbow")).toBe(DEFAULT_ICON_FILL);
    expect(normalizeIconFill(undefined)).toBe(DEFAULT_ICON_FILL);
  });
  it("every advertised option normalizes to itself", () => {
    for (const s of ICON_SHAPES) expect(normalizeIconShape(s.id)).toBe(s.id);
    for (const f of ICON_FILLS) expect(normalizeIconFill(f.id)).toBe(f.id);
  });
  it("icon keys are plan-gated like the rest of the link styling", () => {
    expect(LINK_STYLE_KEYS).toContain("linkIconShape");
    expect(LINK_STYLE_KEYS).toContain("linkIconFill");
  });
});

// Picking a Look must clear the fine-tune background/text overrides — they win
// over the Look at render time, so a stale custom color would make every Look
// in the picker appear broken. Pinned at source level (the panel is a client
// component; the invariant is the shape of the patch it emits).
import { readFileSync } from "node:fs";
describe("Look press resets fine-tune overrides", () => {
  it("LookPicker's onPick clears every fine-tune colour override", () => {
    // Named individually rather than matched loosely: each one wins over the
    // Look at render time, so a key left off this list is a Look that visibly
    // "doesn't work" until the owner finds the stale override themselves.
    // linkAccentColor joined them on 2026-09-10 with the Connect button colour.
    const src = readFileSync("src/components/SwiftLinkDesign.tsx", "utf8");
    const m = /onPick=\{\(v\) => onChange\(\{ linkLook: v, ([^}]*)\}\)\}/.exec(src);
    expect(m, "LookPicker onPick patch not found").not.toBeNull();
    const cleared = m![1].split(",").map((p) => p.trim().split(":")[0].trim()).filter(Boolean);
    expect(cleared.sort()).toEqual(
      ["linkAccentColor", "linkBgColor", "linkButtonColor", "linkTextColor"],
    );
  });
});

// ── Gradient + Aura looks ────────────────────────────────────────────────────
// A gradient look's text must read against BOTH stops (the sheet renders
// sheet→sheetTo top to bottom), and Aura's hex fields are its no-photo
// fallback AND its contrast floor — the photo overlay only ever darkens.
describe("gradient and Aura looks", () => {
  it("text passes AA against every gradient's second stop", () => {
    for (const l of SWIFTLINK_LOOKS) {
      if (!l.sheetTo) continue;
      expect(l.sheetTo).toMatch(/^#[0-9A-F]{6}$/i);
      expect(contrast(l.text, l.sheetTo), `${l.id} text/sheetTo = ${contrast(l.text, l.sheetTo).toFixed(2)}`).toBeGreaterThanOrEqual(4.5);
    }
  });
  it("the library ships Dawn and Nebula gradients and the Aura photo look, all Pro", () => {
    const dawn = SWIFTLINK_LOOKS.find((l) => l.id === "dawn");
    const nebula = SWIFTLINK_LOOKS.find((l) => l.id === "nebula");
    const aura = SWIFTLINK_LOOKS.find((l) => l.id === "aura");
    expect(dawn?.sheetTo).toBeTruthy();
    expect(nebula?.sheetTo).toBeTruthy();
    expect(aura?.aura).toBe(true);
    for (const id of ["dawn", "nebula", "aura"]) expect(isFreeLook(id)).toBe(false);
  });
  it("Aura's fallback is dark: a photoless page must still read", () => {
    const aura = SWIFTLINK_LOOKS.find((l) => l.id === "aura")!;
    expect(aura.mode).toBe("dark");
    expect(contrast(aura.text, aura.sheet)).toBeGreaterThanOrEqual(4.5);
  });
});
