import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ON_CARD_SCALARS, canonicalize, cardContentChanged } from "@/lib/card-changed";

const root = process.cwd();
const raw = (p: string) => readFileSync(join(root, p), "utf8");
const code = (p: string) => raw(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const OWNER_ROUTE = "src/app/api/cards/[id]/route.ts";
const OFFICE_ROUTE = "src/app/api/office/cards/[id]/route.ts";

// "Update your email signature" must fire when the card CHANGED — not when a
// save happened. The same save also deletes two cached PNGs (the share preview
// and the signature image), so a false positive is not just a stray
// notification: it throws away artifacts and tells someone their card changed
// when it didn't.

describe("cardContentChanged", () => {
  const before = {
    name: "Alex Morgan", title: "Broker", company: "Morgan & Co.", phone: "555",
    email: "a@x.test", website: "", linkedin: "", instagram: "", twitter: "",
    tiktok: "", template: "classic-pro", logo_url: "",
    customization: { accent: "#111", font: "inter" },
  };

  it("a save that submits identical values is NOT a change", () => {
    expect(cardContentChanged(before, { name: "Alex Morgan", title: "Broker" })).toBe(false);
  });

  it("a changed scalar IS a change", () => {
    expect(cardContentChanged(before, { title: "Managing Broker" })).toBe(true);
  });

  it("a changed design IS a change", () => {
    expect(cardContentChanged(before, { customization: { accent: "#f00", font: "inter" } })).toBe(true);
  });

  it("the same design with keys in a different order is NOT a change", () => {
    // Postgres jsonb does not preserve key order, so the blob comes back
    // reordered and a naive stringify compare would fire on every save.
    expect(cardContentChanged(before, { customization: { font: "inter", accent: "#111" } })).toBe(false);
  });

  it("nested design objects are compared order-independently too", () => {
    const b = { customization: { link: { bg: "#000", fg: "#fff" } } };
    expect(cardContentChanged(b, { customization: { link: { fg: "#fff", bg: "#000" } } })).toBe(false);
    expect(cardContentChanged(b, { customization: { link: { fg: "#eee", bg: "#000" } } })).toBe(true);
  });

  it("null and empty string are the same absence", () => {
    expect(cardContentChanged({ title: null }, { title: "" })).toBe(false);
    expect(cardContentChanged({ title: "" }, { title: null })).toBe(false);
  });

  it("a field the form did not submit is not a change", () => {
    expect(cardContentChanged(before, { label: "Work" })).toBe(false);
  });

  it("renaming a card (label) is NOT an on-card change", () => {
    // The dashboard nickname never appears on the card or in the signature.
    expect(ON_CARD_SCALARS).not.toContain("label");
    expect(cardContentChanged(before, { label: "Conference card" })).toBe(false);
  });

  it("taking a card offline is NOT an on-card change", () => {
    expect(cardContentChanged(before, { is_offline: true })).toBe(false);
  });

  it("canonicalize sorts keys recursively and leaves scalars alone", () => {
    expect(JSON.stringify(canonicalize({ b: 1, a: { d: 2, c: 3 } }))).toBe('{"a":{"c":3,"d":2},"b":1}');
    expect(canonicalize("x")).toBe("x");
    expect(canonicalize(null)).toBe(null);
    expect(JSON.stringify(canonicalize([{ b: 1, a: 2 }]))).toBe('[{"a":2,"b":1}]');
  });
});

describe("both save routes gate on a REAL change", () => {
  it("the owner's own save compares against a pre-write snapshot", () => {
    const c = code(OWNER_ROUTE);
    expect(c).toMatch(/const \{ data: beforeCard \}[\s\S]{0,400}\.from\("cards"\)/);
    expect(c).toMatch(/cardContentChanged\(b, updates\)/);
  });

  it("the office-admin save does too — it used to fire on ANY submitted field", () => {
    // Regression: `Object.keys(updates).some(k => k !== "is_offline")` meant an
    // admin opening an employee's card and pressing Save unchanged deleted both
    // cached PNGs and notified the employee.
    const c = code(OFFICE_ROUTE);
    expect(c, "the office route is back to counting submitted fields").not.toMatch(
      /Object\.keys\(updates\)\.some\(\(k\) => k !== "is_offline"\)/,
    );
    expect(c).toMatch(/cardContentChanged\(beforeCard as Record<string, unknown>, updates\)/);
  });

  it("neither route keeps its own copy of the rule", () => {
    for (const f of [OWNER_ROUTE, OFFICE_ROUTE]) {
      expect(code(f), `${f} re-declares canonicalize`).not.toMatch(/function canonicalize/);
      expect(code(f), `${f} re-declares ON_CARD_SCALARS`).not.toMatch(/const ON_CARD_SCALARS/);
    }
  });

  it("the office snapshot is taken BEFORE the update, not after", () => {
    const c = code(OFFICE_ROUTE);
    const snap = c.indexOf("const { data: beforeCard }");
    const write = c.indexOf('.from("cards").update(updates)');
    expect(snap).toBeGreaterThan(-1);
    expect(write).toBeGreaterThan(-1);
    expect(snap, "the snapshot reads the row AFTER it was written").toBeLessThan(write);
  });
});

describe("each snapshot selects every column the comparison reads", () => {
  // A column missing from the select is undefined at compare time, so any
  // non-empty submitted value looks like a change — silently reintroducing the
  // false positive. TypeScript cannot catch this: the select is a string.
  function selectedColumns(file: string, marker: string): string[] {
    const src = raw(file);
    const at = src.indexOf(marker);
    expect(at, `${marker} not found in ${file}`).toBeGreaterThan(-1);
    const sel = src.indexOf('.select("', at);
    const start = sel + '.select("'.length;
    return src.slice(start, src.indexOf('"', start)).split(",").map((s) => s.trim());
  }

  it("the owner route's snapshot", () => {
    const cols = selectedColumns(OWNER_ROUTE, "const { data: beforeCard }");
    for (const k of ON_CARD_SCALARS) expect(cols, `missing ${k}`).toContain(k);
    expect(cols).toContain("customization");
  });

  it("the office route's snapshot", () => {
    const cols = selectedColumns(OFFICE_ROUTE, "const { data: beforeCard }");
    for (const k of ON_CARD_SCALARS) expect(cols, `missing ${k}`).toContain(k);
    expect(cols).toContain("customization");
    // It also drives the notification target and the storage keys.
    expect(cols).toContain("username");
    expect(cols).toContain("user_id");
  });
});

describe("the notification itself stays deduped and non-fatal", () => {
  it("both routes skip when an unread reminder already exists", () => {
    for (const f of [OWNER_ROUTE, OFFICE_ROUTE]) {
      const c = code(f);
      expect(c, `${f} lost its dedupe`).toMatch(/\.eq\("type", "signature_stale"\)[\s\S]{0,200}\.eq\("read", false\)/);
      expect(c).toMatch(/if \(!pending\?\.length\)/);
    }
  });

  it("a failed notification never fails the save", () => {
    for (const f of [OWNER_ROUTE, OFFICE_ROUTE]) {
      expect(code(f), `${f} lost its try/catch`).toMatch(/try \{[\s\S]*?\} catch \{/);
    }
  });
});

// ── Signature-specific accuracy (owner bug report 2026-08-25) ───────────────
// The signature image shows neither the Swift Links list nor internal
// customization keys — edits to those must not nag "re-copy your signature".
import { signatureContentChanged } from "@/lib/card-changed";

describe("signatureContentChanged ignores what the signature can't show", () => {
  const before = {
    name: "Jeff", title: "Agent", customization: {
      accentColor: "#123456",
      links: [{ label: "Menu", url: "https://a.example" }],
      _claimDraftId: "abc",
    },
  };
  it("a links-only edit is NOT a signature change", () => {
    expect(signatureContentChanged(before, {
      customization: { ...before.customization, links: [{ label: "New menu", url: "https://b.example" }] },
    })).toBe(false);
  });
  it("internal _key churn is NOT a signature change", () => {
    expect(signatureContentChanged(before, {
      customization: { ...before.customization, _claimDraftId: "zzz" },
    })).toBe(false);
  });
  it("a design change IS a signature change", () => {
    expect(signatureContentChanged(before, {
      customization: { ...before.customization, accentColor: "#ff0000" },
    })).toBe(true);
  });
  it("an on-card scalar change IS a signature change", () => {
    expect(signatureContentChanged(before, { name: "Jeffrey" })).toBe(true);
  });

  // 2026-10-09: Edit card sends every design key on every save, null for unset.
  // A card saved before Title color / Company color existed has no such keys,
  // so its first save after them added `titleColor: null` — which read as a
  // change: both PNGs thrown away and a "re-copy your signature" for nothing.
  it("a save that only fills in cleared keys (null, \"\") is NOT a change", () => {
    const updates = {
      customization: {
        ...before.customization,
        titleColor: null, companyColor: null, photoShape: null, fax: "",
        links: [{ label: "New menu", url: "https://b.example" }],
      },
    };
    expect(signatureContentChanged(before, updates)).toBe(false);
    expect(cardContentChanged(before, { customization: { ...before.customization, titleColor: null, companyColor: null } })).toBe(false);
  });
  it("picking a Title color or Company color IS a change", () => {
    expect(signatureContentChanged(before, { customization: { ...before.customization, titleColor: "#d4af7a" } })).toBe(true);
    expect(cardContentChanged(before, { customization: { ...before.customization, companyColor: "#93c5fd" } })).toBe(true);
    // ...and clearing one that was set is a change back.
    const set = { ...before, customization: { ...before.customization, titleColor: "#d4af7a" } };
    expect(signatureContentChanged(set, { customization: { ...before.customization, titleColor: null } })).toBe(true);
  });
  it("both routes gate the nudge on it", () => {
    for (const f of ["src/app/api/cards/[id]/route.ts", "src/app/api/office/cards/[id]/route.ts"]) {
      const src = raw(f);
      expect(src, `${f} must use signatureContentChanged`).toContain("signatureContentChanged(");
      // The notification block must be reachable only when signatureChanged.
      expect(src).toMatch(/signatureChanged/);
    }
  });
});

// ── Owner's rule (2026-09-24): "Update your signature" is for the CARD and
// CARD DESIGN only — never Socials or Social design. The signature is a copy of
// the card, and a standard template never draws socials.
describe("socials and social design never ask for a signature re-copy", () => {
  const before = {
    name: "Dana", template: "classic-pro", instagram: "@old", linkedin: "",
    customization: { accentColor: "#111", facebook: "", youtube: "", snapchat: "", linkLook: "paper" },
  };

  it("a Socials-tab edit on a standard template is NOT a signature change", () => {
    expect(signatureContentChanged(before, { instagram: "@new", linkedin: "linkedin.com/in/dana" })).toBe(false);
    expect(signatureContentChanged(before, {
      customization: { ...before.customization, facebook: "fb.com/dana", youtube: "@dana", snapchat: "dana" },
    })).toBe(false);
  });

  it("a Social design edit is NOT a signature change", () => {
    expect(signatureContentChanged(before, {
      customization: { ...before.customization, linkLook: "aura", linkButtonStyle: "outline", hideCardLink: true },
    })).toBe(false);
  });

  it("socials + a card change together IS a signature change", () => {
    expect(signatureContentChanged(before, { instagram: "@new", title: "Broker" })).toBe(true);
    expect(signatureContentChanged(before, {
      customization: { ...before.customization, facebook: "fb.com/dana", accentColor: "#f00" },
    })).toBe(true);
  });

  it("a Custom card that DRAWS socials does count them — they are on the card", () => {
    const layout = { background: "#000", textColor: "#fff", fontFamily: "inter", elements: [], blocks: [
      { id: "s", type: "socials", on: true, zone: "left", emphasis: "normal" },
    ] };
    const custom = { ...before, template: "custom", customization: { ...before.customization, customLayout: layout } };
    expect(signatureContentChanged(custom, { instagram: "@new" })).toBe(true);
  });

  it("a Custom card whose socials block is OFF does not", () => {
    const layout = { background: "#000", textColor: "#fff", fontFamily: "inter", elements: [], blocks: [
      { id: "n", type: "field", field: "name", on: true, zone: "left", emphasis: "hero" },
      { id: "s", type: "socials", on: false, zone: "left", emphasis: "normal" },
    ] };
    const custom = { ...before, template: "custom", customization: { ...before.customization, customLayout: layout } };
    expect(signatureContentChanged(custom, { instagram: "@new" })).toBe(false);
  });
});
