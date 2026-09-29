import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { unitLine } from "@/lib/address-unit";
import { formatAddress } from "@/components/AddressInput";
import { buildVCard } from "@/lib/vcard";

// ── 2026-09-24 UI review: phone app, phone web, desktop ─────────────────────

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("an address's unit keeps the word the person typed", () => {
  it("adds 'Unit' only to a bare number or letter", () => {
    expect(unitLine("1450")).toBe("Unit 1450");
    expect(unitLine("12B")).toBe("Unit 12B");
    expect(unitLine("Suite 1450")).toBe("Suite 1450");
    expect(unitLine("Ste. 200")).toBe("Ste. 200");
    expect(unitLine("Apt 4B")).toBe("Apt 4B");
    expect(unitLine("#12")).toBe("#12");
    expect(unitLine("Floor 3")).toBe("Floor 3");
    expect(unitLine("4th Floor")).toBe("4th Floor");
    expect(unitLine("unit 7")).toBe("unit 7");
    expect(unitLine("  ")).toBe("");
    expect(unitLine(undefined)).toBe("");
  });

  it("the card, the saved contact and the address field all agree", () => {
    const a = { street: "12000 Pacific Coast Hwy", unit: "Suite 1450", city: "San Francisco", state: "CA", zip: "94122" };
    expect(formatAddress(a)).toBe("12000 Pacific Coast Hwy, Suite 1450 · San Francisco, CA, 94122");
    expect(buildVCard({ name: "A", address: a } as Parameters<typeof buildVCard>[0])).toContain("ADR;TYPE=WORK:;;12000 Pacific Coast Hwy Suite 1450;");
    for (const f of ["src/lib/card-data.ts", "src/lib/vcard.ts", "src/components/AddressInput.tsx", "src/app/cards/[id]/edit/CardEditForm.tsx", "src/app/cards/new/NewCardWizard.tsx"]) {
      const s = read(f);
      expect(s, f).toContain("unitLine(");
      expect(s, f).not.toMatch(/`Unit \$\{/);
    }
  });
});

describe("nothing sits on the phone's tab bar or edge", () => {
  it("'Tap outside to close' sits under the QR card, never pinned to the screen bottom", () => {
    for (const f of ["src/components/QRCodeModal.tsx"]) {
      const s = read(f);
      expect(s, f).not.toMatch(/absolute bottom-8[^"]*">Tap outside to close/);
      // On its own SOLID pill: under the card it can land over dimmed page
      // text, which ghosted through a translucent one.
      expect(s, f).toMatch(/<p className="mt-4 rounded-full bg-\[#0d1b3e\] [^"]*">Tap outside to close<\/p>/);
      expect(s, f).toMatch(/fixed inset-0 z-\[\d+\] flex flex-col items-center justify-center/);
    }
  });

  it("the contact list's divider is a desktop column divider, not a line down the phone's edge", () => {
    expect(read("src/components/ContactsClient.tsx")).toMatch(/w-full lg:w-80 xl:w-96 shrink-0 lg:border-r border-gray-800 flex-col/);
  });

  it("Add contact's email example fits its half-width box", () => {
    expect(read("src/components/AddContactModal.tsx")).toContain('placeholder="sarah@acme.com"');
  });

  it("the Swift Links mini phone fades an edge with more page beyond it instead of slicing a line", () => {
    const s = read("src/components/PinnedCardPreview.tsx");
    expect(s).toMatch(/frame\.scrollTop \+ frame\.clientHeight < frame\.scrollHeight - 2/);
    expect(s).toMatch(/style=\{fade \? \{ maskImage: fade, WebkitMaskImage: fade \} : undefined\}/);
  });
});

describe("sign-in can't be submitted before the page can handle it", () => {
  it("the submit button is disabled in the server HTML and live once hydrated", () => {
    const s = read("src/components/LoginForm.tsx");
    expect(s).toMatch(/useSyncExternalStore\(noopSubscribe, \(\) => true, \(\) => false\)/);
    expect(s).toMatch(/type="submit"\s+disabled=\{!hydrated \|\| status === "loading"\}/);
    // Still POST — the credential rule stands.
    expect(s).toMatch(/<form onSubmit=\{handleSubmit\} method="post"/);
  });
});
