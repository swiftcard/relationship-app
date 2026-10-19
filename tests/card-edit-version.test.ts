import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { cardEditVersion, CARD_EDIT_COLUMNS, CARD_EDIT_CUSTOMIZATION_KEYS, CARD_CHANGED_ELSEWHERE } from "@/lib/card-edit-version";

// ── A card saved elsewhere is noticed, and nothing else trips it (C02-006) ──
//
// The behaviour in the real editor is tests/render/card-edit-conflict. This
// file holds the fingerprint to what the editor actually writes: a key the
// editor saves that the fingerprint skips would let two devices overwrite it
// silently again; a key it covers that the editor never writes would raise a
// false "changed elsewhere".

const read = (p: string) => readFileSync(p, "utf8");
const EDITOR = read("src/app/cards/[id]/edit/CardEditForm.tsx");

function saveBody() {
  const start = EDITOR.indexOf("      const res = await fetch(saveUrl, {");
  const end = EDITOR.indexOf("        }),\n      });", start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return EDITOR.slice(start, end).split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");
}

describe("the fingerprint covers exactly what Edit card saves", () => {
  it("every customization key in the save body, and nothing more", () => {
    const body = saveBody();
    const cust = body.slice(body.indexOf("          customization: {"), body.indexOf("          logo_url: cardLogoUrl,"));
    const keys = new Set([...cust.matchAll(/^\s{12}([a-zA-Z]+)[,:]/gm)].map((m) => m[1]));
    expect([...keys].sort()).toEqual([...CARD_EDIT_CUSTOMIZATION_KEYS].sort());
  });

  it("every card column in the save body", () => {
    const body = saveBody();
    const top = new Set([...body.matchAll(/^\s{10}(?:\.\.\.\(isPrimary \? \{\} : \{ )?([a-z_]+)[,:]/gm)].map((m) => m[1]));
    top.delete("customization");
    top.delete("method");
    for (const k of top) expect(CARD_EDIT_COLUMNS as readonly string[], `"${k}" is saved but not fingerprinted`).toContain(k);
  });
});

describe("cardEditVersion", () => {
  const base = {
    id: "c1", username: "dana", name: "Dana", company: "Acme", title: "Broker", email: "d@a.co", website: "", phone: "1",
    label: null, template: "classic-pro", logo_url: null, linkedin: "", instagram: "", twitter: "", tiktok: "",
    customization: { bio: "Hi", links: [{ label: "Site", url: "https://a.co" }], accentColor: "#123456", _prevSlugs: ["old"], _shareCapturedAt: "x" },
  };
  const v = cardEditVersion(base);

  it("is stable, and blind to key order", () => {
    expect(cardEditVersion({ ...base })).toBe(v);
    const reordered = { ...base, customization: { accentColor: "#123456", _shareCapturedAt: "x", links: [{ url: "https://a.co", label: "Site" }], bio: "Hi", _prevSlugs: ["old"] } };
    expect(cardEditVersion(reordered)).toBe(v);
  });

  it("changes when anything the editor writes changes", () => {
    expect(cardEditVersion({ ...base, name: "Dana E" })).not.toBe(v);
    expect(cardEditVersion({ ...base, logo_url: "https://x/l.png" })).not.toBe(v);
    expect(cardEditVersion({ ...base, customization: { ...base.customization, links: [] } })).not.toBe(v);
    expect(cardEditVersion({ ...base, customization: { ...base.customization, photoUrl: "https://x/p.jpg" } })).not.toBe(v);
  });

  it("ignores what the editor never writes: system keys, the address, the row id", () => {
    expect(cardEditVersion({ ...base, username: "dana-acme", id: "other", is_offline: true })).toBe(v);
    expect(cardEditVersion({ ...base, customization: { ...base.customization, _prevSlugs: ["old", "dana"], _shareCapturedAt: "y" } })).toBe(v);
  });

  it("an absent key and a null one are the same card", () => {
    expect(cardEditVersion({ ...base, customization: { ...base.customization, photoUrl: null } })).toBe(v);
  });
});

describe("the save route and the editor use it", () => {
  const route = read("src/app/api/cards/[id]/route.ts");

  it("refuses a stale save with 409 unless forced, before anything is written", () => {
    const check = route.indexOf("cardEditVersion(beforeCard as Record<string, unknown>) !== baseVersion");
    expect(check).toBeGreaterThan(-1);
    expect(route.slice(check - 200, check)).toContain("body.force !== true");
    expect(route.slice(check, check + 400)).toContain("code: CARD_CHANGED_ELSEWHERE");
    expect(route.slice(check, check + 600)).toContain("{ status: 409 }");
    expect(check).toBeLessThan(route.indexOf(".update(clampCardWrite(updates))"));
    expect(CARD_CHANGED_ELSEWHERE).toBe("CARD_CHANGED_ELSEWHERE");
  });

  it("reads label with the rest of the before-row, and hands back the new version", () => {
    expect(route).toContain('.select("username, name, title, company, phone, email, website, linkedin, instagram, twitter, tiktok, template, logo_url, label, customization")');
    expect(route.split("version: await versionNow(admin, id)").length - 1).toBe(2);
  });

  it("the edit page sends the loaded version down", () => {
    expect(read("src/app/cards/[id]/edit/page.tsx")).toContain("editVersion={cardEditVersion(card as Record<string, unknown>)}");
    expect(EDITOR).toContain("...(!isPrimary && baseVersion ? { baseVersion, ...(opts?.force ? { force: true } : {}) } : {}),");
    expect(EDITOR).toContain("onClick={() => handleSave({ ...refusedSave.current, force: true })}");
  });
});
