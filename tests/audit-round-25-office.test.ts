import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// ── Audit round 25 (2026-10-18): one name per teammate, and edits an admin
//    can't break a card with ──────────────────────────────────────────────
//
// F-OFFICE-01  Team showed the invited name ("Dana Lee"); Analytics, the person
//              page and the CSV showed the handle ("dana-3f9a2c").
// F-OFFICE-03  "Edit details" on a teammate's card took anything: non-text,
//              a blank name, 10,000 characters.
// F-OFFICE-04  An invite took any string as the email (a paid seat held by an
//              address that could only bounce) and an uncapped name.

const read = (p: string) => readFileSync(p, "utf8");

describe("F-OFFICE-01: the same name on every Office screen", () => {
  const analytics = read("src/lib/office-analytics.ts");

  it("Analytics falls back to the invited name and address before the handle, as Team does", () => {
    expect(analytics).toContain('.select("user_id, invite_name, invite_email")');
    const ladder = analytics.slice(analytics.indexOf("name: (prof?.name as string)"), analytics.indexOf('|| "Member",'));
    const order = ["prof?.name", "slugs[0]?.name", "invite_name", "invite_email", "prof?.username"].map((k) => ladder.indexOf(k));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
});

describe("F-OFFICE-03: an admin's edit meets the owner's rules", () => {
  const route = read("src/app/api/office/cards/[id]/route.ts");

  it("text fields must be text; settings must be an object; the name can't be blank; the email must look like one", () => {
    expect(route).toContain('return NextResponse.json({ error: `"${key}" must be text.` }, { status: 400 });');
    expect(route).toContain('return NextResponse.json({ error: "Invalid card settings." }, { status: 400 });');
    expect(route).toContain('return NextResponse.json({ error: "A name is required." }, { status: 400 });');
    expect(route).toContain(`return NextResponse.json({ error: "That email address doesn't look right." }, { status: 400 });`);
  });

  it("and the write is clamped to what the card prints", () => {
    expect(route).toContain('await admin.from("cards").update(clampCardWrite(updates)).eq("id", id);');
  });
});

describe("F-OFFICE-04: an invite goes to an address", () => {
  const route = read("src/app/api/office/invite/route.ts");

  it("refuses a string that isn't an email, before any seat is held", () => {
    const check = route.indexOf("That email address doesn't look right.");
    expect(check).toBeGreaterThan(0);
    expect(check).toBeLessThan(route.indexOf('.from("office_members")'));
  });

  it("caps the invited name like a card's", () => {
    expect(route).toContain("name.trim().slice(0, 120)");
  });
});
