import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const src = readFileSync(join(__dirname, "..", "src/components/NativeAppBridge.tsx"), "utf8");

describe("native shell sets the status-bar style", () => {
  it("calls SystemBars.setStyle from the app, following the app theme", () => {
    expect(src).toMatch(/SystemBars\.setStyle\(/);
    expect(src).toMatch(/SystemBarsStyle\.Dark/);
    expect(src).toMatch(/SystemBarsStyle\.Light/);
  });
});
