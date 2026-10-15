import { describe, it, expect } from "vitest";
import { sanitizeCustomizationForPlan, PRO_CUSTOMIZATION_KEYS, nearestPreset, convertCustomizationToFreeClosest } from "@/lib/plan";
import { META, FALLBACK_META, freeSafeValues } from "@/lib/template-style-presets";

// These cover the persistence contract for the new editable-template style keys
// (bgColor / textColor / fontFamily) alongside the existing accent/font gating,
// plus backward-compat with customization blobs saved before the feature.

describe("editable-template style keys are Pro-gated", () => {
  it("lists the new style keys as Pro-only", () => {
    for (const k of ["accentColor", "font", "bgColor", "textColor", "fontFamily"]) {
      expect(PRO_CUSTOMIZATION_KEYS).toContain(k);
    }
  });

  it("snaps every color key to the nearest Free-safe preset for a Free account (never deletes them outright)", () => {
    const meta = META["classic-pro"];
    const input = {
      // An arbitrary Pro custom pick, close to (but not exactly) the
      // template's fallback branding-panel color ("#0e1b35").
      accentColor: "#ff0000",
      bgColor: "#0e1a34",
      textColor: "#ffffff",
      fontFamily: "Georgia, serif",
      about: "hi",
      links: [{ label: "Site", url: "https://x.com" }],
    };
    const out = sanitizeCustomizationForPlan(input, false, "classic-pro");
    // Snapped, not deleted: every key is still present, pointing at one of the
    // template's own presets — or an accent one of its Looks offers, since a
    // Look sets the accent too (2026-10-15).
    expect(freeSafeValues(meta, "accent")).toContain(out.accentColor);
    expect(meta.bg.presets).toContain(out.bgColor);
    expect(meta.text.presets).toContain(out.textColor);
    // Font has no custom-input equivalent to snap against — the picked value
    // IS its own closest match, so it passes through untouched.
    expect(out.fontFamily).toBe("Georgia, serif");
    // Free-baseline content is untouched.
    expect(out.about).toBe("hi");
    expect(out.links).toEqual([{ label: "Site", url: "https://x.com" }]);
  });

  it("leaves keys that were never set as undefined (nothing to snap)", () => {
    const out = sanitizeCustomizationForPlan({ about: "hi" }, false, "classic-pro");
    expect(out.bgColor).toBeUndefined();
    expect(out.textColor).toBeUndefined();
    expect(out.accentColor).toBeUndefined();
  });

  it("passes through an exact preset value unchanged", () => {
    const meta = META["classic-pro"];
    const exact = meta.accent.presets[2];
    const out = sanitizeCustomizationForPlan({ accentColor: exact }, false, "classic-pro");
    expect(out.accentColor).toBe(exact);
  });

  it("downgrades the custom template to classic-pro and drops the freeform layout for Free", () => {
    const out = sanitizeCustomizationForPlan(
      { bgColor: "#123456", customLayout: { background: "#000", elements: [] } },
      false,
      "custom",
    );
    expect(out).not.toHaveProperty("customLayout");
    // No standard-template style keys to snap from a custom layout — left at
    // the target template's baked-in default rather than guessed.
    expect(out.bgColor).toBeUndefined();
  });

  it("keeps every style key for a paid account", () => {
    const input = { accentColor: "#ff0000", bgColor: "#101010", textColor: "#fff", fontFamily: "Mono" };
    expect(sanitizeCustomizationForPlan(input, true, "classic-pro")).toEqual(input);
  });
});

describe("nearestPreset", () => {
  it("passes an exact match through untouched", () => {
    expect(nearestPreset("#2563eb", ["#2563eb", "#111827"], "#111827")).toBe("#2563eb");
  });

  it("returns undefined when the value was never set", () => {
    expect(nearestPreset(undefined, ["#2563eb"], "#111827")).toBeUndefined();
  });

  it("picks the closest preset by color distance", () => {
    // #000001 is 1 unit from black, ~ far from white.
    expect(nearestPreset("#000001", ["#000000", "#ffffff"], "#000000")).toBe("#000000");
  });
});

describe("convertCustomizationToFreeClosest", () => {
  it("reports changed:false when there's nothing Pro-only to convert", () => {
    const result = convertCustomizationToFreeClosest({ about: "hi" }, "classic-pro");
    expect(result.changed).toBe(false);
    expect(result.template).toBe("classic-pro");
  });

  it("reports changed:true when a Pro-only color was set", () => {
    const result = convertCustomizationToFreeClosest({ accentColor: "#ff0000" }, "classic-pro");
    expect(result.changed).toBe(true);
  });

  // The "we'll apply a basic Free design" notice is driven by `changed`. It
  // used to fire whenever a design key EXISTED, so a guest who tapped a Free
  // Look or picked a font was told their card was being replaced when it was
  // not. `changed` must mean "the card will look different".
  it("reports changed:false for a card built entirely from Free choices", () => {
    for (const [id, meta] of Object.entries(META)) {
      for (const look of meta.looks) {
        const cust: Record<string, unknown> = { bgColor: look.bg, textColor: look.text, fontFamily: "Georgia, serif", finish: "sheen" };
        if (look.font) cust.fontFamily = look.font;
        if (meta.surface && look.surface) cust.surfaceColor = look.surface;
        // A Pro-finish Look is a real conversion — it is not in this set.
        if (look.finish && look.finish !== "sheen" && look.finish !== "halo") continue;
        if (look.finish) cust.finish = look.finish;
        const r = convertCustomizationToFreeClosest(cust, id);
        expect(r.changed, `${id} / ${look.name} was flagged as converted`).toBe(false);
      }
    }
  });

  it("reports changed:true for a Pro finish or panel media, which the converter removes", () => {
    expect(convertCustomizationToFreeClosest({ finish: "brushed" }, "classic-pro").changed).toBe(true);
    expect(convertCustomizationToFreeClosest({ panelMedia: "https://x/y.jpg", panelMediaType: "image" }, "classic-pro").changed).toBe(true);
    expect(convertCustomizationToFreeClosest({ finish: "halo" }, "classic-pro").changed).toBe(false);
  });

  it("falls back to FALLBACK_META presets for an unknown template", () => {
    const result = convertCustomizationToFreeClosest({ accentColor: "#ff0000" }, "some-unknown-template");
    expect(FALLBACK_META.accent.presets).toContain(result.customization.accentColor);
  });
});

describe("backward compatibility with cards saved before the feature", () => {
  it("an old blob with no style keys is preserved verbatim (paid)", () => {
    const legacy = {
      bio: "Realtor",
      phones: [{ number: "555", label: "mobile", showOnCard: true }],
      links: [{ label: "Reviews", url: "https://g.co" }],
      customLayout: { background: "#0e1b35", fontFamily: "sans", textColor: "#fff", elements: [] },
    };
    expect(sanitizeCustomizationForPlan(legacy, true)).toEqual(legacy);
  });

  it("an old blob still renders on Free (baseline content kept, no style keys to strip)", () => {
    const legacy = { bio: "Realtor", fax: "555-0000", about: "hi" };
    const out = sanitizeCustomizationForPlan(legacy, false);
    expect(out).toEqual(legacy);
  });

  it("does not mutate the input blob", () => {
    const input = { accentColor: "#ff0000", bgColor: "#101010", about: "hi" };
    sanitizeCustomizationForPlan(input, false);
    expect(input).toHaveProperty("accentColor");
    expect(input).toHaveProperty("bgColor");
  });
});
