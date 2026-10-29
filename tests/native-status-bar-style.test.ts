import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const src = readFileSync(join(__dirname, "..", "src/components/NativeAppBridge.tsx"), "utf8");

describe("native status-bar style", () => {
  it("sets the SystemBars style from the app's theme, not the phone's", () => {
    expect(src).toMatch(/SystemBars\?:\s*\{\s*setStyle/);
    expect(src).toContain('"DARK" : "LIGHT"');
    expect(src).toMatch(/bars\.setStyle\(\{ style \}\)/);
  });

  it("re-applies the style when the theme changes and stops watching on unmount", () => {
    expect(src).toContain('attributeFilter: ["class", "data-theme"]');
    expect(src).toContain("themeWatch?.disconnect()");
  });
});
