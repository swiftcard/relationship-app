import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";

// ── The preview's button books a setup call (owner, 2026-11-15) ─────────────
// "Reuse the Office demo flow for the preview button. Use 15-minute slots.
// Prefill from the preview, mark it 'meeting booked', and send me a phone push."

type Row = Record<string, unknown>;
const st = vi.hoisted(() => ({
  preview: null as Row | null,
  inPlay: true,
  booked: [] as Row[],
  notified: [] as Row[],
  pushes: [] as Row[],
  updates: [] as Row[],
}));

vi.mock("@/lib/prospect-preview/store", () => ({
  getPreviewBySlug: async (slug: string) => (st.preview && st.preview.slug === slug ? st.preview : null),
  markMeetingBooked: async (id: string, bookingId: string) => { st.booked.push({ id, bookingId }); return st.inPlay; },
}));
vi.mock("@/lib/prospect-preview/alert", () => ({ alertTargets: async (p: { alert_user_id?: string | null }) => (p.alert_user_id ? [p.alert_user_id] : ["admin-1", "admin-2"]) }));
vi.mock("@/lib/admin-notify", () => ({ notifyAdmin: async (n: Row) => { st.notified.push(n); } }));
vi.mock("@/lib/push", () => ({ sendPushToUser: async (userId: string, p: Row) => { st.pushes.push({ userId, ...p }); } }));
vi.mock("@/lib/supabase-admin", () => ({
  getAdminSupabase: () => ({
    from: (table: string) => ({
      update: (patch: Row) => {
        const filters: Row = {};
        const chain = { eq: (k: string, v: unknown) => { filters[k] = v; return chain; }, then: (ok: (v: unknown) => unknown) => { st.updates.push({ table, patch, filters }); return ok({ error: null }); } };
        return chain;
      },
    }),
  }),
}));

const LIVE = {
  id: "11111111-1111-4111-8111-111111111111", slug: "harbor-realty-x7k2", status: "live", expires_at: new Date(Date.now() + 86_400_000).toISOString(),
  owner_name: "Dana Reyes", office_name: "Harbor Realty", email: "dana@harbor.example", phone: "(212) 555-0101", team_size: null,
  team_members: [{ name: "A" }, { name: "B" }, { name: "C" }, { name: "D" }, { name: "E" }, { name: "F" }],
};

beforeEach(() => { st.inPlay = true; st.preview = { ...LIVE }; st.booked.length = 0; st.notified.length = 0; st.pushes.length = 0; st.updates.length = 0; });

describe("which preview a ref means", () => {
  it("a published, unexpired preview's slug, in any case", async () => {
    const { previewForRef } = await import("@/lib/prospect-preview/booking");
    expect((await previewForRef("Harbor-Realty-X7K2"))?.id).toBe(LIVE.id);
  });
  it("never a draft, a paused or an expired one, an unknown slug, or junk", async () => {
    const { previewForRef } = await import("@/lib/prospect-preview/booking");
    st.preview = { ...LIVE, status: "draft" };
    expect(await previewForRef(LIVE.slug)).toBeNull();
    st.preview = { ...LIVE, status: "paused" };
    expect(await previewForRef(LIVE.slug)).toBeNull();
    st.preview = { ...LIVE, expires_at: new Date(Date.now() - 1000).toISOString() };
    expect(await previewForRef(LIVE.slug)).toBeNull();
    st.preview = { ...LIVE };
    for (const junk of ["nope-000000", "", null, undefined, 7, "../admin", "a b", "x".repeat(500)]) expect(await previewForRef(junk)).toBeNull();
  });
});

describe("what the form starts with", () => {
  it("only what their own preview page already shows them", async () => {
    const { prefillFor } = await import("@/lib/prospect-preview/booking");
    const p = prefillFor(LIVE as never);
    expect(p).toEqual({ name: "Dana Reyes", company: "Harbor Realty", email: "dana@harbor.example", phone: "(212) 555-0101", teamSize: "6–15" });
    expect(Object.keys(p).sort()).toEqual(["company", "email", "name", "phone", "teamSize"]);
    // The researched head count is not on the page, so it is not in the form.
    expect(prefillFor({ ...LIVE, email: null, team_members: [], team_size: 40 } as never)).toMatchObject({ email: "", teamSize: "2–5" });
  });
});

describe("when it is booked", () => {
  const booking = { id: "22222222-2222-4222-8222-222222222222", name: "Dana Reyes", company: "Harbor Realty", starts_at: "2026-11-17T15:15:00.000Z" };
  it("the preview moves to meeting booked, the bell gets a row, every admin's phone gets one push", async () => {
    const { previewCallBooked } = await import("@/lib/prospect-preview/booking");
    await previewCallBooked({ id: LIVE.id }, booking);
    expect(st.booked).toEqual([{ id: LIVE.id, bookingId: booking.id }]);
    expect(st.notified[0]).toMatchObject({ kind: "prospects", title: "Meeting booked: Dana Reyes", href: "/admin/demos", dedupeKey: `prospect-booked:${booking.id}` });
    expect(String(st.notified[0].body)).toBe("Harbor Realty · Tue, Nov 17 at 10:15 AM EST · 15-min setup call");
    expect(st.pushes.map((p) => p.userId)).toEqual(["admin-1", "admin-2"]);
    expect(st.pushes[0]).toMatchObject({ title: "Meeting booked: Dana Reyes", url: "https://swiftcard.me/admin/demos", category: "prospect_view" });
  });
  it("a preview already booked, won or lost is left alone and nobody's phone rings (the booking page is public)", async () => {
    st.inPlay = false;
    const { previewCallBooked } = await import("@/lib/prospect-preview/booking");
    await previewCallBooked({ id: LIVE.id }, booking);
    expect(st.notified).toHaveLength(0);
    expect(st.pushes).toHaveLength(0);
    const store = readFileSync("src/lib/prospect-preview/store.ts", "utf8");
    expect(store).toContain('.eq("id", id).is("demo_booking_id", null).or("stage.is.null,stage.not.in.(meeting_booked,won,lost)").select("id");');
  });
  it("the automated test's own preview tells only the account it names, never the owner's phone", async () => {
    const { previewCallBooked } = await import("@/lib/prospect-preview/booking");
    await previewCallBooked({ id: LIVE.id, alert_user_id: "qa-user" }, booking);
    expect(st.pushes.map((p) => p.userId)).toEqual(["qa-user"]);
    const alert = readFileSync("src/lib/prospect-preview/alert.ts", "utf8");
    expect(alert).toContain("return preview.alert_user_id ? [preview.alert_user_id] : adminUserIds();");
    expect(alert).toContain("const ids = await alertTargets(v.preview);");
    // Nothing in the app can set it: no form field, no admin action, no tool.
    for (const f of ["src/lib/prospect-preview/input.ts", "src/app/api/admin/card-builder/[id]/route.ts", "src/app/api/admin/card-builder/route.ts", "tests/tools/card-builder.tool.ts"]) {
      expect(readFileSync(f, "utf8"), f).not.toContain("alert_user_id");
    }
  });
  it("a booking on an address that cannot exist sends no email and no invitation", async () => {
    const { isTestAddress } = await import("@/lib/demo/config");
    expect(isTestAddress("qa-cb-123@swiftcard-test.invalid")).toBe(true);
    for (const real of ["dana@harbor.example", "a@invalid.com", "invalid@gmail.com", "a@b.invalidx"]) expect(isTestAddress(real)).toBe(false);
    expect(readFileSync("src/lib/demo/outbox.ts", "utf8")).toContain('if (isTestAddress(b.email)) return { sent: false, skip: "test_address" };');
    expect(readFileSync("src/lib/demo/google-calendar.ts", "utf8")).toContain("attendees: isTestAddress(input.attendee.email) ? [] :");
  });
  it("a cancel reopens the preview only while it still points at that booking", async () => {
    const { previewCallCanceled } = await import("@/lib/prospect-preview/booking");
    await previewCallCanceled(LIVE.id, booking.id);
    expect(st.updates[0]).toMatchObject({ table: "prospect_previews", patch: { demo_booking_id: null, stage: null }, filters: { id: LIVE.id, demo_booking_id: booking.id, stage: "meeting_booked" } });
  });
});

describe("the wiring", () => {
  const read = (p: string) => readFileSync(p, "utf8");
  it("the page asks the server which length to offer, with the slug from its own address", () => {
    const flow = read("src/components/demo/DemoBookingFlow.tsx");
    expect(flow).toContain('new URLSearchParams(window.location.search).get("ref")');
    expect(flow).toContain("useDemoSlots(ref !== null, ref ? `ref=${encodeURIComponent(ref)}` : \"\")");
    expect(flow).toContain("...(ref ? { ref } : {}),");
    // Never replaces what a person typed.
    expect(flow).toContain("name: d.name || prefill.name,");
  });
  it("the server, not the browser, decides it is a preview booking", () => {
    const book = read("src/app/api/demo/book/route.ts");
    expect(book).toContain("const preview = input.ref ? await previewForRef(input.ref) : null;");
    expect(book).toContain("...(preview ? { durationMin: PREVIEW_CALL_MIN, preview } : {}),");
    const service = read("src/lib/demo/service.ts");
    expect(service).toContain("if (input.preview) await previewCallBooked(input.preview, booking);");
    expect(service).toContain("if (b.prospect_preview_id) await previewCallCanceled(b.prospect_preview_id, b.id, now);");
  });
});

// Owner, 2026-11-15: "Add these as automated tests so they run on every deploy."
describe("Card Builder is driven end to end on every deploy", () => {
  const read = (p: string) => readFileSync(p, "utf8");
  const wf = read(".github/workflows/nightly-qa.yml");
  const qa = read("scripts/qa-card-builder.mjs");
  it("the after-deploy run starts it, and its failures reach the one incident issue", () => {
    expect(wf).toContain("deployment_status:");
    expect(wf).toContain("ADMIN_BASE=http://localhost:3222 OUT=nightly/card-builder node scripts/qa-card-builder.mjs || true");
    expect(read("scripts/qa-nightly-summary.mjs")).toContain('"nightly/card-builder/failures.json"');
  });
  it("swiftcard.me's admin list is never touched: the throwaway admin exists only on the build started beside it", () => {
    expect(wf).toContain("QA_ADMIN_EMAIL: qa-cb-ci-${{ github.run_id }}@swiftcard-test.invalid");
    expect(wf).toContain('ADMIN_EMAILS="$QA_ADMIN_EMAIL" npx next start -p 3222');
    expect(qa).toContain('if (!/@swiftcard-test\\.invalid$/.test(adminEmail))');
    expect(read("src/lib/admin.ts")).toContain("const ADMIN_EMAILS = (process.env.ADMIN_EMAILS ?? \"\")");
  });
  it("it never rings the owner, and proves it left nothing behind", () => {
    expect(qa).toContain("alert_user_id: userId,");
    expect(qa).toContain("@swiftcard-test.invalid`;");
    expect(qa).toContain("nothing is left behind");
    // The upload replaces the stored connections, so the owner's are kept aside and put back.
    expect(qa).toContain("savedConnections = await rows(");
    expect(qa).toContain("the owner's own connections are as they were");
  });
  it("a view only counts from a browser that is not announcing itself as automated, with no bypass on the server", () => {
    expect(qa).toContain('args: ["--disable-blink-features=AutomationControlled"]');
    expect(read("src/app/api/p/view/route.ts")).not.toMatch(/qa|bypass|x-test/i);
  });
});

