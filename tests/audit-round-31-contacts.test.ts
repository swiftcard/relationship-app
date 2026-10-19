import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { contactFieldProblem, CONTACT_FIELD_MAX } from "@/lib/contact-limits";

// ── Audit round 31 (2026-10-18): Contacts says when a save didn't happen, and
//    holds a contact to sane lengths ─────────────────────────────────────────
//
// F-CONTACTS-03  A failed Notes or "Where we met" save gave no word at all.
// F-CONTACTS-04  An ended session read "Unauthorized" or "try again".
// F-CONTACTS-05  No field had a length limit; a non-text name was a 500; a
//                database error's own words went back to the person.

const read = (p: string) => readFileSync(p, "utf8");

describe("F-CONTACTS-03/04: a save that didn't land says so", () => {
  const contacts = read("src/components/ContactsClient.tsx");
  const fn = contacts.slice(contacts.indexOf("async function updateField("), contacts.indexOf("// tags is a Postgres text[]"));

  it("an ended session is told apart, and any other failure is said out loud", () => {
    expect(fn).toContain("if (res.status === 401) fail(\"You've been signed out, so this wasn't saved.");
    expect(fn).toContain('fail(data.message || "Couldn\'t save that — please try again.");');
    expect(fn).toContain('fail("Couldn\'t save that — check your connection and try again.");');
  });

  it("Add contact says signed-out in words, not \"Unauthorized\"", () => {
    expect(read("src/components/AddContactModal.tsx")).toContain("You've been signed out, so this contact wasn't added.");
  });
});

describe("F-CONTACTS-05: contact fields are text, within limits", () => {
  it("accepts text within the limit and clearing a field", () => {
    expect(contactFieldProblem({ name: "Dana", notes: "x".repeat(CONTACT_FIELD_MAX.notes), where_met: null })).toBeNull();
  });

  it("refuses non-text and over-long values in words", () => {
    expect(contactFieldProblem({ name: 42 })).toBe('"name" must be text.');
    expect(contactFieldProblem({ notes: "x".repeat(CONTACT_FIELD_MAX.notes + 1) })).toMatch(/too long — keep it under 5,000 characters/);
    expect(contactFieldProblem({ where_met: "x".repeat(201) })).toContain('"Where we met"');
  });

  it("both write routes check before writing, and the database's own words never reach the person", () => {
    const patch = read("src/app/api/leads/[id]/route.ts");
    const manual = read("src/app/api/leads/manual/route.ts");
    expect(patch).toContain("const tooBig = contactFieldProblem(body);");
    expect(manual.indexOf("const tooBig = contactFieldProblem(body);")).toBeLessThan(manual.indexOf("if (!name?.trim())"));
    expect(manual).not.toMatch(/NextResponse\.json\(\{ error: error\.message \}/);
  });

  it("the editors stop at the same lengths", () => {
    const contacts = read("src/components/ContactsClient.tsx");
    expect(contacts).toContain("maxLength={CONTACT_FIELD_MAX.notes}");
    expect(contacts).toContain("maxLength={CONTACT_FIELD_MAX.where_met}");
    const modal = read("src/components/AddContactModal.tsx");
    for (const k of ["name", "email", "phone", "company"]) expect(modal).toContain(`maxLength={CONTACT_FIELD_MAX.${k}}`);
  });
});
