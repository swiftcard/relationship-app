import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import TemplateStyleControls from "@/components/card-templates/TemplateStyleControls";
import { proFeaturesInUse } from "@/lib/plan";
import { META, CARD_LOOK_FAMILIES, looksInFamily } from "@/lib/template-style-presets";
import { isFreeFinish } from "@/lib/card-finishes";

// ── A Free account can try every Pro design control, and is stopped at Save ───
//
// Owner, 2026-09-11: "in the Add a Card button, I want users to be able to use
// custom colors and custom materials for all the pro features, just to see how
// it would look on their card. When they go to press Save Changes, it will say,
// 'You cannot use these features. These are pro features.'"
//
// Every Pro finish, every Look and the photo/video picker already worked that
// way. The one exception was the free-hand colour input — `disabled` on a Free
// account — so the single feature they were being asked to pay for was the
// single one they could not look at. These pin the whole contract, both halves:
// nothing in the panel is dead, and nothing gets past the save.

const markup = (locked: boolean, proTags = false) =>
  renderToStaticMarkup(createElement(TemplateStyleControls, {
    value: {},
    onChange: () => {},
    template: "classic-pro",
    locked,
    proTags,
  }));

const proTagCount = (html: string) => (html.match(/>PRO</g) ?? []).length;

describe("the design panel on a Free account", () => {
  const free = markup(true);
  const pro = markup(false);

  it("lets them pick any colour, exactly as a Pro account can", () => {
    const inputs = free.match(/<input[^>]*type="color"[^>]*>/g) ?? [];
    // Name colour, details colour, accent/icons and at least one surface.
    expect(inputs.length).toBeGreaterThanOrEqual(4);
    for (const input of inputs) expect(input).not.toContain("disabled");
    expect(inputs.length).toBe((pro.match(/<input[^>]*type="color"[^>]*>/g) ?? []).length);
  });

  it("does not grey out or swallow taps on the colour row", () => {
    expect(free).not.toContain("pointer-events-none");
    expect(free).not.toContain('aria-disabled="true"');
  });

  it("tags every Pro choice on a Free account's Edit card (owner, 2026-09-18)", () => {
    // "How do these users know which features are pro features?" Save Changes
    // still stops them (ProRequiredDialog, pinned in pro-required-on-save);
    // the tags only say beforehand which choices it will name.
    const tagged = markup(true, true);
    const colourInputs = (tagged.match(/<input[^>]*type="color"[^>]*>/g) ?? []).length;
    const proFinishes = 5; // Frosted, Brushed, Carbon, Linen, Gilt edge
    // The Look rows open closed (owner, 2026-10-14), so the tags in view are
    // the rows made only of Pro-finish Looks — Glass — tagged on the row itself.
    const proLookRows = CARD_LOOK_FAMILIES.filter((f) =>
      looksInFamily(META["classic-pro"], f.id).every((l) => !!l.finish && !isFreeFinish(l.finish))).length;
    expect(proLookRows).toBe(1);
    // any color × each colour step, Photo or video, the Pro finishes, the Pro Look rows.
    expect(proTagCount(tagged)).toBe(colourInputs + 1 + proFinishes + proLookRows);
    // Tagging changes nothing else: same controls, still all live.
    expect(tagged.match(/<button[^>]*\sdisabled(=|\s|>)/g)).toBeNull();
    expect(tagged.replace(/<span[^>]*>PRO<\/span>/g, "").replace(/<span class="absolute[^"]*"><\/span>/g, ""))
      .toBe(free);
  });

  it("shows no PRO tag unless the Edit card asks for them — Pro accounts and every other caller", () => {
    expect(proTagCount(free)).toBe(0); // `locked` alone (the build wizard) draws nothing
    expect(proTagCount(pro)).toBe(0);
  });

  it("keeps every finish and Look tappable — the preview IS the demo", () => {
    // A disabled ATTRIBUTE, not the Tailwind `disabled:` class the media
    // button legitimately carries for its own uploading state.
    expect(free.match(/<button[^>]*\sdisabled(=|\s|>)/g)).toBeNull();
  });
});

describe("the wall is at Save Changes, and it holds", () => {
  it("names the custom colour a Free account just tried", () => {
    const features = proFeaturesInUse({ textColor: "#ff3366" }, "classic-pro");
    expect(features).toContain("Your own colors");
  });

  it("names a Pro finish and a background photo too", () => {
    expect(proFeaturesInUse({ finish: "brushed" }, "classic-pro").join(" ")).toMatch(/finish/i);
    expect(proFeaturesInUse({ panelMedia: "https://x/y.jpg" }, "classic-pro")).toContain("Background photo");
  });

  it("stays out of the way when they only used Free things", () => {
    // A preset colour is every plan's to keep — no dialog, no interruption.
    expect(proFeaturesInUse({}, "classic-pro")).toEqual([]);
  });
});
