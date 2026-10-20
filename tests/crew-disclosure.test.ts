import { describe, expect, it } from "vitest";
import { propose } from "@/lib/crew/approvals";
import { decide } from "@/lib/crew/decide";
import { applyDisclosure, hasRequiredDisclosure, isPromotional } from "@/lib/crew/disclosure";
import { setup } from "./crew-helpers";

// Every promotional draft says who is talking; plain helpful comments don't.

const opts = { on: true, disclosure: "(I work on SwiftCard, so I'm biased.)" };

describe("disclosure", () => {
  it("adds the line only when SwiftCard is mentioned, and only once", () => {
    expect(isPromotional("try swiftcard.me")).toBe(true);
    expect(applyDisclosure("Nice listing photos.", opts)).toBe("Nice listing photos.");
    const once = applyDisclosure("I use SwiftCard for this.", opts);
    expect(once).toContain(opts.disclosure);
    expect(applyDisclosure(once, opts)).toBe(once);
    expect(applyDisclosure("Full disclosure, I work on SwiftCard. It does both.", opts)).not.toContain(opts.disclosure);
    expect(hasRequiredDisclosure("I use SwiftCard for this.", opts)).toBe(false);
  });

  it("propose() adds it, and an edit that strips it gets it back", async () => {
    const { store, ctx } = await setup();
    const r = await propose(ctx, { kind: "reply", title: "t", summary: "s", body: "SwiftCard does a card and a link page — one price.", platform: "reddit", targetUrl: "https://r/1" });
    if (!r.ok) throw new Error(r.reason);
    const a = await store.getApproval(r.id);
    expect(a!.body).toContain(opts.disclosure);
    expect(a!.body).not.toContain("—");
    await decide(store, r.id, { action: "edit", body: "SwiftCard does both.", by: "owner" });
    expect((await store.getApproval(r.id))!.body).toContain(opts.disclosure);
  });

  it("respects the owner turning it off", async () => {
    const { store, ctx } = await setup();
    await store.updateSettings({ disclosure_on: false });
    ctx.settings.disclosure_on = false;
    const r = await propose(ctx, { kind: "comment", title: "t", summary: "s", body: "SwiftCard is nice", platform: "instagram", targetUrl: "https://i/1" });
    if (!r.ok) throw new Error(r.reason);
    expect((await store.getApproval(r.id))!.body).toBe("SwiftCard is nice");
  });
});
