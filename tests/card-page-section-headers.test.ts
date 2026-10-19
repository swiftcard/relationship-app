import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { cardLinkRows } from "@/lib/swiftlink-tiles";

// Section headers from the Swift Links editor also chapter the links list in
// the card page's "Swift Links" box (owner request 2026-10-19).

type Row = { label: string; url: string; kind?: "link" | "header" };
const L = (label: string): Row => ({ label, url: `https://${label.toLowerCase()}.com` });
const H = (label: string): Row => ({ label, url: "", kind: "header" });
const labels = (rows: Row[]) => rows.map((r) => (r.kind === "header" ? `#${r.label}` : r.label));

describe("cardLinkRows — the card page's link rows", () => {
  it("paid: headers sit between the links, in the owner's order", () => {
    expect(labels(cardLinkRows<Row>([H("Listings"), L("One"), L("Two"), H("Book"), L("Three")], true)))
      .toEqual(["#Listings", "One", "Two", "#Book", "Three"]);
  });

  it("a header with nothing under it is dropped (end of list, or straight before another header)", () => {
    expect(labels(cardLinkRows<Row>([H("Empty"), H("Real"), L("One"), H("Trailing")], true)))
      .toEqual(["#Real", "One"]);
    expect(cardLinkRows<Row>([H("Only")], true)).toEqual([]);
  });

  it("Free shows no headers — same plan line as the Swift Links page", () => {
    expect(labels(cardLinkRows<Row>([H("Listings"), L("One"), L("Two")], false))).toEqual(["One", "Two"]);
  });

  it("drops blank rows and survives a corrupted links value", () => {
    expect(labels(cardLinkRows<Row>([L("One"), { label: "  ", url: "https://x.com" }, { label: "No url", url: "" }, H("  "), null as unknown as Row], true)))
      .toEqual(["One"]);
    expect(cardLinkRows<Row>("garbage", true)).toEqual([]);
    expect(cardLinkRows<Row>({ 0: L("x") }, true)).toEqual([]);
  });
});

describe("wiring", () => {
  const page = readFileSync("src/app/[username]/page.tsx", "utf8");
  const box = readFileSync("src/components/CardActionLinks.tsx", "utf8");

  it("the card page builds its rows with cardLinkRows on the owner's plan", () => {
    expect(page).toMatch(/cardLinkRows<[^>]+>\(customization\.links, isPaidPlan\(profile\.plan\)\)/);
  });

  it("the saved contact never carries a header row", () => {
    expect(page).toContain("links: actionLinks,");
    expect(readFileSync("src/lib/vcard.ts", "utf8")).toMatch(/if \(!l \|\| l\.kind === "header"\) continue;/);
  });

  it("dividers and the box itself count real links, not headers", () => {
    expect(page).toMatch(/hasConnectSection = !!bio \|\| connectLinks\.length > 0 \|\| realLinkCount > 0/);
    expect(page).not.toMatch(/actionLinks\.length > 0/);
  });

  it("a header renders as a heading row inside the box, not as a link", () => {
    expect(box).toMatch(/l\.kind === "header" \? \(\s*<h3/);
    expect(box).toMatch(/if \(!links\.some\(\(l\) => l\.kind !== "header"\)\) return null;/);
  });
});
