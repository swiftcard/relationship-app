import { describe, expect, it } from "vitest";
import { propose } from "@/lib/crew/approvals";
import { remainingToday, warmedCap } from "@/lib/crew/rate-limit";
import { setup } from "./crew-helpers";

// Ceilings, not targets: a new account starts at a fifth of the ceiling.

describe("warm-up", () => {
  it("climbs a fifth a week and tops out at the ceiling", () => {
    const start = "2026-10-01";
    expect(warmedCap(10, start, new Date("2026-10-02T12:00:00Z"))).toBe(2);
    expect(warmedCap(10, start, new Date("2026-10-09T12:00:00Z"))).toBe(4);
    expect(warmedCap(10, start, new Date("2026-11-30T12:00:00Z"))).toBe(10);
    expect(warmedCap(3, start, new Date("2026-10-02T12:00:00Z"))).toBe(1);
  });
  it("counts today's drafts against the cap", async () => {
    const { store, ctx } = await setup();
    const now = new Date();
    const first = await remainingToday(store, { agentId: ctx.def.id, platform: "reddit", action: "reply", defaultCeiling: 10, now });
    expect(first).toEqual({ cap: 2, used: 0, left: 2 });
    await propose(ctx, { kind: "reply", title: "t", summary: "s", body: "b", platform: "reddit", targetUrl: "https://r/1" });
    expect((await remainingToday(store, { agentId: ctx.def.id, platform: "reddit", action: "reply", defaultCeiling: 10, now })).left).toBe(1);
  });
});
