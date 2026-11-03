import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// Android's back button is turned into an Escape keydown while a dialog is
// open (NativeAppBridge). A bell panel that ignores Escape ignores back.
const read = (p: string) => readFileSync(p, "utf8");

describe("notification bells close on Escape / Android back", () => {
  for (const file of [
    "src/components/NotificationBell.tsx",
    "src/components/office/OfficeNotificationBell.tsx",
  ]) {
    it(`${file} wires useDialogA11y to its panel`, () => {
      const src = read(file);
      expect(src).toContain('from "@/lib/use-dialog-a11y"');
      expect(src).toMatch(/useDialogA11y\(open, \(\) => setOpen\(false\), panelRef\)/);
      expect(src).toMatch(/ref=\{panelRef\}\s+role="dialog"/);
    });
  }
});
