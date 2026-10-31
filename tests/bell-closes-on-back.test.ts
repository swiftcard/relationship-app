import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

// Android's hardware back closes an open dialog by dispatching Escape
// (NativeAppBridge). A bell panel that ignores Escape stays open when back is
// pressed (nightly-app: "back-ignored-by-sheet", small-360-free-bell).

describe("notification bells close on Escape / Android back", () => {
  it("NativeAppBridge sends Escape to an open dialog on back", () => {
    const src = readFileSync("src/components/NativeAppBridge.tsx", "utf8");
    expect(src).toContain('key: "Escape"');
  });

  for (const file of [
    "src/components/NotificationBell.tsx",
    "src/components/office/OfficeNotificationBell.tsx",
  ]) {
    it(`${file} wires useDialogA11y to its panel`, () => {
      const src = readFileSync(file, "utf8");
      expect(src).toContain("useDialogA11y(open, () => setOpen(false), panelRef)");
      expect(src).toMatch(/ref=\{panelRef\}\s+role="dialog"/);
    });
  }
});
