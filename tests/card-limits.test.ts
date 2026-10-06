import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CARD_FIELD_MAX, MAX_CARD_PHONES, clampAddress, clampCardWrite, clampField } from "@/lib/card-limits";
import { cardPhones } from "@/components/card-templates/shared";
import { buildCardData } from "@/lib/card-data";
import type { CardData } from "@/components/card-templates/types";

// Owner, 2026-10-02: details always fit — "even if every single field is added".
// The card prints at most lib/card-limits; tests/render/card-every-template
// measures every template at exactly these limits. Here: the limits are applied
// everywhere a card's content enters or leaves, so nothing past them can print.

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const long = (n: number) => "x".repeat(n);

describe("clamping", () => {
  it("cuts each field at its limit and trims", () => {
    for (const [f, max] of Object.entries(CARD_FIELD_MAX)) {
      expect(clampField(f as keyof typeof CARD_FIELD_MAX, long(max + 25)).length, f).toBe(max);
      expect(clampField(f as keyof typeof CARD_FIELD_MAX, "  ok  "), f).toBe("ok");
    }
    expect(clampField("name", null)).toBe("");
  });

  it("an address prints at most three lines, each within the limit", () => {
    const a = clampAddress([long(90), "", "City", "ST 12345", "extra line"].join("\n"));
    const lines = a.split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[0].length).toBe(CARD_FIELD_MAX.addressLine);
  });

  it("a save is clamped field by field, and nothing else is touched", () => {
    const out = clampCardWrite({
      name: long(200), email: long(200), label: long(200), template: "classic-pro",
      customization: {
        fax: long(99), accentColor: "#123456",
        phones: [{ number: long(99), label: "mobile", showOnCard: true }],
        address: { street: long(99), unit: long(99), city: long(99), state: "CA", zip: long(99) },
      },
    });
    expect(out.name).toHaveLength(CARD_FIELD_MAX.name);
    expect(out.email).toHaveLength(CARD_FIELD_MAX.email);
    expect(out.label).toHaveLength(200);
    const c = out.customization as Record<string, never>;
    expect((c.fax as string).length).toBe(CARD_FIELD_MAX.fax);
    expect((c.phones as { number: string }[])[0].number.length).toBe(CARD_FIELD_MAX.phone);
    expect((c.address as { street: string }).street.length).toBe(CARD_FIELD_MAX.addressLine);
    expect((c.address as { unit: string }).unit.length).toBe(20);
    expect((c.address as { zip: string }).zip.length).toBe(10);
    expect(c.accentColor).toBe("#123456");
  });
});

describe("the card prints at most MAX_CARD_PHONES numbers", () => {
  it("the first four marked On card", () => {
    const phones = Array.from({ length: 7 }, (_, i) => ({ number: `(415) 555-01${i}0`, label: "mobile" as const, showOnCard: i !== 1 }));
    const data = { name: "A", title: "", company: "", phone: "", email: "", customization: { phones } } as CardData;
    const shown = cardPhones(data);
    expect(MAX_CARD_PHONES).toBe(4);
    expect(shown.map((p) => p.number)).toEqual(["(415) 555-0100", "(415) 555-0120", "(415) 555-0130", "(415) 555-0140"]);
  });

  it("buildCardData — what every surface renders — clamps a card saved before the limits", () => {
    const { data } = buildCardData(
      { name: long(300), title: long(300), company: long(300), email: long(300), website: long(300), username: "a" },
      { appUrl: "https://swiftcard.me", isPro: true },
    );
    expect(data.name).toHaveLength(CARD_FIELD_MAX.name);
    expect(data.title).toHaveLength(CARD_FIELD_MAX.title);
    expect(data.email).toHaveLength(CARD_FIELD_MAX.email);
    expect(data.website).toHaveLength(CARD_FIELD_MAX.website);
  });
});

describe("pinned at source", () => {
  it("both save routes clamp what they write", () => {
    expect(read("src/app/api/cards/[id]/route.ts")).toMatch(/\.update\(clampCardWrite\(updates\)\)/);
    expect(read("src/app/api/cards/route.ts")).toMatch(/const cardRow = clampCardWrite\(\{/);
  });

  it("the editors stop typing at the limits and say only four numbers print", () => {
    for (const f of ["src/app/cards/[id]/edit/CardEditForm.tsx", "src/app/cards/new/NewCardWizard.tsx"]) {
      const src = read(f);
      for (const k of ["name", "title", "company", "email", "website", "fax", "phone"]) {
        expect(src, `${f}: ${k}`).toContain(`maxLength={CARD_FIELD_MAX.${k}}`);
      }
      expect(src, f).toMatch(/Only \{MAX_CARD_PHONES\} numbers fit on your card/);
    }
    expect(read("src/components/AddressInput.tsx")).toContain("maxLength={CARD_FIELD_MAX.addressLine}");
  });

  it("four templates draw the QR as the details block's corner", () => {
    for (const t of ["ClassicPro", "ModernBold", "PhotoFirst", "LuxuryMinimal"]) {
      expect(read(`src/components/card-templates/${t}.tsx`), t).toMatch(/<ContactRows[\s\S]*?qr=\{\{/);
    }
    // Sized for the height ABOVE the QR, so a card that fit before looks the same.
    expect(read("src/components/card-templates/shared.tsx")).toMatch(/calc\(\(100cqh - \$\{2 \+ qrCorner\}px\)/);
  });

  it("custom cards size text with one rule, drawn and modelled alike", () => {
    expect(read("src/components/card-templates/CustomCard.tsx")).toMatch(/const sized = textBlockPx\(block, shown, fs, zonePx\);/);
    expect(read("src/lib/custom-layout.ts")).toMatch(/const sized = isSocial \? fs : textBlockPx\(block, text, fs\);/);
  });
});
