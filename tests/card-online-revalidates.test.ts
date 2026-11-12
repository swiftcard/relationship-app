import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// Bringing a card back online returns early, before the revalidate every other
// save reaches. Without its own revalidate the public page kept serving the
// cached "offline" answer: the owner saw "back online" while visitors, the QR
// and the link got a 404 for a minute or more (reproduced on production
// 2026-11-12 after a teammate was removed from an Office).
describe("bringing a card back online refreshes the public page", () => {
  const src = readFileSync(new URL("../src/app/api/cards/[id]/route.ts", import.meta.url), "utf8");
  const start = src.indexOf("if (wantsOnline) {");
  const end = src.indexOf("return NextResponse.json({ ok: true, online: true })", start);

  it("finds the bring-online path", () => {
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
  });

  it("revalidates the card page after the write and before it answers", () => {
    const block = src.slice(start, end);
    const write = block.indexOf("update({ is_offline: false })");
    const revalidate = block.indexOf("revalidateCardPage(");
    expect(write).toBeGreaterThan(-1);
    expect(revalidate).toBeGreaterThan(write);
  });

  it("reads the slug it needs to revalidate", () => {
    expect(src.slice(start, end)).toMatch(/\.select\("is_office_card, username"\)/);
  });
});
