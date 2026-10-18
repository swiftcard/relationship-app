import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";

// ── Audit round 17 (2026-10-18): what a stranger can learn or change ────────
//
// SEC-01  The public share form matched an existing contact by a phone number
//         anyone can type: the answer said whether that number was already in
//         the owner's contacts, and the stranger could append text to the
//         contact and take over its device identity.
// SEC-02  /api/account-exists answered for any address: an open "is this a
//         SwiftCard customer?" oracle.
// SEC-03  Contact details read off scanned cards, recipients and senders were
//         written verbatim to logs, error_events and the alert webhook.

const inserted: Record<string, unknown>[] = [];
vi.mock("@/lib/rate-limit", () => ({ isRateLimited: async () => false }));
vi.mock("@/lib/supabase-admin", () => ({
  getAdminSupabase: () => ({ from: () => ({ insert: async (row: Record<string, unknown>) => { inserted.push(row); return { error: null }; } }) }),
}));

import { reportError } from "@/lib/report-error";

const read = (p: string) => readFileSync(p, "utf8");

describe("SEC-03: no contact details in any error sink", () => {
  const logged: string[] = [];
  let spy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    inserted.length = 0;
    logged.length = 0;
    spy = vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => { logged.push(a.map(String).join(" ")); });
  });
  afterEach(() => spy.mockRestore());

  it("the message, the stack and the extras are scrubbed in the log line and the durable row", async () => {
    await reportError("email.send", new Error('duplicate key value (jane@acme.com) for +1 (555) 123-4567'), {
      to: "jane@acme.com",
      phone: "+1 555 123 4567",
      subject: "Your card for Jane",
      userId: "6f1c9a52-8d3e-4b7a-9c21-0e5d4f3a2b10",
    });
    const all = [...logged, JSON.stringify(inserted)].join("\n");
    expect(all).not.toContain("jane@acme.com");
    expect(all).not.toMatch(/555\D{0,3}123\D{0,3}4567/);
    // What diagnoses the failure survives.
    expect(all).toContain("6f1c9a52-8d3e-4b7a-9c21-0e5d4f3a2b10");
    expect(all).toContain("email.send");
  });

  it("design transfer logs what KIND of detail a redraw kept, never the detail", () => {
    const dt = read("src/app/api/design-transfer/route.ts");
    expect(dt).not.toMatch(/\[\.\.\.problems\.leaks,/);
    expect(dt.match(/\[\.\.\.leakKinds\(problems\.leaks\),/g)?.length).toBe(2);
    expect(dt).not.toMatch(/String\(measureRaw\)\.slice\(/);
  });
});

describe("SEC-01: a typed phone number proves nothing", () => {
  const route = read("src/app/api/leads/route.ts");
  const dedupe = route.slice(route.indexOf("if (known) {"), route.indexOf("// Free plan: 5 new leads/month."));

  it("a repeat share changes the contact, or binds this browser, only from a browser already known as that contact", () => {
    expect(dedupe).toContain("const sameBrowser = await isKnownBrowserOf(admin, known as { id: string; visitor_id?: string | null }, visitor_id);");
    expect(dedupe).toContain("const fill = sameBrowser ? sameContactFill(known, { email, company, message }) : null;");
    expect(dedupe).toContain("if (sameBrowser && !(await isOwnerRequest(admin, card_owner).catch(() => false))) {");
  });

  it("known means the contact's own stamp or a live device binding", () => {
    const fn = route.slice(route.indexOf("async function isKnownBrowserOf("), route.indexOf("export async function POST"));
    expect(fn).toContain("if (lead.visitor_id && lead.visitor_id === visitorId) return true;");
    expect(fn).toMatch(/\.from\("contact_devices"\)[\s\S]*\.eq\("lead_id", lead\.id\)[\s\S]*\.eq\("visitor_id", visitorId\)[\s\S]*\.is\("superseded_at", null\)[\s\S]*\.is\("wrong_at", null\)/);
  });

  it("the answer is the same as a new share's — it reveals nothing", () => {
    expect(dedupe).toContain("return attachVisitIdentity(NextResponse.json({ success: true }), visitIdentity);");
    expect(route).not.toMatch(/deduped: true/);
  });
});

describe("SEC-02: only about an address this browser shared", () => {
  const route = read("src/app/api/account-exists/route.ts");

  it("asks for this browser's own share of the address before looking up any account", () => {
    const tie = route.indexOf('.eq("visitor_id", visitorId)');
    expect(route).toContain("const visitorId = req.cookies.get(VISITOR_COOKIE)?.value ?? \"\";");
    expect(route).toContain("if (!visitorId) return NextResponse.json({ exists: false });");
    expect(tie).toBeGreaterThan(0);
    expect(tie).toBeLessThan(route.indexOf('admin.from("profiles")'));
  });
});
