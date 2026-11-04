import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// ── Book a demo: where the button lives on /pricing ─────────────────────────
// Owner, 2026-11-03: "on the pricing page, on the office plan only", and it
// must not "ruin that pricing plan". The render test (tests/render/
// book-demo.interactive.test.ts) measures the layout; this pins the place.

const read = (p: string) => readFileSync(p, "utf8");
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\s*\}/g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const page = code("src/app/pricing/page.tsx");

describe("the Book a demo button on /pricing", () => {
  it("appears exactly once, and only inside the Office card", () => {
    expect(page.split("<BookDemoButton").length - 1).toBe(1);
    const office = page.slice(page.indexOf("<OfficePlanCard"), page.indexOf("</OfficePlanCard>"));
    expect(office).toContain("<BookDemoButton seats={seats} />");
    const beforeOffice = page.slice(0, page.indexOf("<OfficePlanCard"));
    expect(beforeOffice).not.toContain("<BookDemoButton");
  });

  it("sits under Get Office, inside the same plan gate, hidden for a team already paying for Office", () => {
    const office = page.slice(page.indexOf("<OfficePlanCard"), page.indexOf("</OfficePlanCard>"));
    const getOffice = office.indexOf("className={OFFICE_CTA_CLASS}");
    const demo = office.indexOf("{!onPaidOffice && <BookDemoButton seats={seats} />}");
    expect(getOffice).toBeGreaterThan(-1);
    expect(demo).toBeGreaterThan(getOffice);
    // Still inside the Office card's own <div {...gate}>: no div closes between.
    const gateOpen = office.lastIndexOf("<div {...gate}>", demo);
    expect(gateOpen).toBeGreaterThan(-1);
    expect(office.slice(gateOpen, demo)).not.toContain("</div>");
    // The page keeps its three plan gates (the button added none).
    expect(page.split("{...gate}").length - 1).toBe(3);
  });

  it("the help chat names the button the visitor sees", () => {
    const kb = read("src/lib/knowledge/docs/marketing-site.ts");
    const doc = kb.slice(kb.indexOf('id: "book-a-demo"'));
    expect(doc).toContain('press \\"Book a demo\\" under \\"Get Office\\" on the Office card');
  });
});
