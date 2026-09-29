import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PLAN_FEATURES } from "@/lib/plan-content";

const root = process.cwd();
const code = (p: string) =>
  readFileSync(join(root, p), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

// Editing a card happens in ONE place: the Edit button on each card in the
// dashboard's My Cards (owner, 2026-09-29). It used to be Settings → Cards and
// sharing; that section now deletes, and has no Edit. These pin both halves,
// and the copy that tells people where to go — a signpost pointing at a control
// that no longer exists is worse than no signpost.

const DASHBOARD = "src/app/dashboard/page.tsx";
const CARD_LIST = "src/components/dashboard/MyCardsList.tsx";
const MANAGE_CARDS = "src/components/ManageCards.tsx";
const SETTINGS = "src/app/settings/flows/page.tsx";
const EDIT_HREF = "/cards/${card.id}/edit";

describe("every card in My Cards has its own Edit button", () => {
  it("links each row to that card's editor", () => {
    const c = code(CARD_LIST);
    // Inside the per-card map, so every card gets one — not just the selected.
    const map = c.slice(c.indexOf("cards.map("), c.indexOf("{upsell}"));
    expect(map).toContain(`href={\`${EDIT_HREF}\`}`);
  });

  it("is a sibling of the select link, never nested in it", () => {
    // A link inside the radio link is invalid HTML, and a tap on Edit would
    // switch cards instead of opening the editor.
    const c = code(CARD_LIST);
    const selectClose = c.indexOf("</Link>");
    const editAt = c.indexOf(EDIT_HREF);
    expect(selectClose).toBeGreaterThan(0);
    expect(editAt, "Edit sits inside the select link").toBeGreaterThan(selectClose);
  });

  it("does not make the row taller: 28px inside the row's 32px line", () => {
    const c = code(CARD_LIST);
    const at = c.indexOf(EDIT_HREF);
    const edit = c.slice(at, at + 900);
    expect(edit).toMatch(/\bh-7\b/);
    expect(edit).toMatch(/\bshrink-0\b/);
    expect(c).toMatch(/w-8 h-8 rounded-lg/);
  });

  it("names the card to a screen reader", () => {
    expect(code(CARD_LIST)).toContain("aria-label={`Edit ${card.label || card.name || card.username}`}");
  });

  it("still lets you SELECT and ADD cards", () => {
    expect(code(CARD_LIST)).toMatch(/role="radiogroup"/);
    expect(code(CARD_LIST)).toMatch(/href=\{`\?card=\$\{card\.username\}/);
    expect(code(DASHBOARD)).toMatch(/\/cards\/new\?add=1/);
  });

  it("keeps the tour anchors the guided tour targets", () => {
    const c = code(DASHBOARD);
    expect(c).toMatch(/data-tour="my-cards"/);
    expect(c).toMatch(/data-tour="your-card"/);
  });

  it("is shown to every account type, office members included", () => {
    // My Cards is not gated on the plan or the seat — it is how a team member
    // reaches the editor now that Settings has no Edit.
    const c = code(DASHBOARD);
    expect(c).toMatch(/<MyCardsList/);
    expect(c, "My Cards got gated away from office members").not.toMatch(/!isOfficeMember && <MyCardsList/);
  });
});

describe("Settings → Cards and sharing no longer edits", () => {
  it("ManageCards has no link into the editor", () => {
    expect(code(MANAGE_CARDS)).not.toMatch(/\/cards\/\$\{[^}]*\}\/edit/);
  });

  it("the section is described as what it is now", () => {
    const c = code(SETTINGS);
    expect(c).toMatch(/label: "Cards and sharing"/);
    expect(c).toContain('"Remove a card, and share your links."');
    expect(c, "the description still promises Edit").not.toMatch(/Edit, open, or remove a card/);
  });

  it("sub-users still cannot DELETE a company card", () => {
    expect(code(SETTINGS)).toMatch(/canDelete=\{!isOfficeSubUser\}/);
    const c = code(MANAGE_CARDS);
    expect(c).toMatch(/canDelete = true/);
    expect(c).toMatch(/\{canDelete && \(/);
  });
});

describe("nothing points users at the old place", () => {
  it("the guided tour sends them to Edit in My Cards", () => {
    const c = code("src/lib/tour-steps.ts");
    expect(c, "the tour still sends people to Settings to edit").not.toMatch(/head to Settings → Cards and sharing/);
    expect(c).not.toMatch(/This is where you edit/);
    expect(c).toMatch(/Tap Edit on a card to change its details or design/);
    expect(c).toMatch(/tap Edit on it in My Cards/);
  });

  it("the tour teaches the mobile card switcher without misleading desktop", () => {
    // TourContext has no viewport, so the copy has to read true on both. The
    // FREE variant must NOT mention the arrow — one card renders no arrow.
    const c = code("src/lib/tour-steps.ts");
    expect(c).toMatch(/tap the arrow beside the selected card/);
    const freeBranch = c.match(/"Your card — tap Edit[^"]*"/)?.[0] ?? "";
    expect(freeBranch, "the Free branch lost its Edit line").not.toBe("");
    expect(freeBranch, "the Free copy promises an arrow that never renders").not.toMatch(/arrow/);
  });

  it("the help assistant knows where Edit is", () => {
    const cards = code("src/lib/knowledge/docs/cards.ts");
    expect(cards).toContain('every card has its own \\"Edit\\" button');
    expect(cards, "the knowledge base still sends people to Settings to edit").not.toContain("Settings → Cards and sharing → \\\"Edit\\\"");
    expect(cards).not.toContain("Settings → Cards and sharing → Edit");
    expect(code("src/lib/knowledge/docs/dashboard.ts")).not.toMatch(/no Edit link/);
    expect(code("src/lib/knowledge/docs/account.ts")).not.toMatch(/only place a card can be edited/);
    expect(code("src/lib/knowledge/personas.ts")).not.toContain("Cards and sharing → Edit");
    expect(code("src/app/api/ai/help/route.ts")).not.toContain("tap Edit to change your card)");
  });

  it("plan marketing copy makes no claim about where editing lives", () => {
    const all = [...PLAN_FEATURES.free, ...PLAN_FEATURES.pro].join(" | ");
    expect(all).not.toMatch(/My Cards/i);
  });
});

describe("the Add card button is wired correctly", () => {
  it("is ONE pill serving both widths", () => {
    // Desktop used to carry a separate bare text link in this slot. Owner
    // asked for the phone's pill on the computer too, so there is now a single
    // control and no width-gated duplicate. shrink-0 is load-bearing — see the
    // render test, which measures it at both widths.
    const c = code(DASHBOARD);
    expect(c).toMatch(/className="shrink-0 inline-flex items-center/);
    expect(c, "a width-gated duplicate is back").not.toMatch(/className="sm:hidden shrink-0 inline-flex/);
    expect(c, "the desktop-only text link is back").not.toMatch(/className="hidden sm:flex items-center gap-3"/);
  });

  it("no full-width mobile add button survives below the header", () => {
    // It used to be a w-full dashed block under the title row. Whether the new
    // one really sits top-RIGHT is geometry, not text — that is asserted in
    // tests/render/my-cards-add-button.test.ts, which measures it.
    const c = code(DASHBOARD);
    expect(c, "the old full-width mobile add button is back").not.toMatch(
      /sm:hidden[^"]*\bw-full\b[^"]*border-dashed/,
    );
  });

  // The button is no longer CONDITIONAL on the plan (owner, 2026-09-11) — it
  // is always rendered, and the plan decides what pressing it does. That is the
  // whole point of the change: a Free account at the limit should see the same
  // control, not an absence plus a permanent upsell box.
  it("is always rendered, with the plan deciding what it does", () => {
    const c = code(DASHBOARD);
    expect(c).toMatch(/const canAddCard = isPro \|\| allCards\.length < PLAN_LIMITS\.FREE_CARD_LIMIT/);
    expect(c, "the button is conditional again").not.toMatch(/\{canAddCard && \(/);
    expect(c).toMatch(/<AddCardButton\s+locked=\{!canAddCard\}/);
  });

  it("goes to the add-card destination, exactly once", () => {
    // The destination moved into the component with the button. Scoped there
    // for the same reason it was scoped to the box before: another
    // /cards/new?add=1 lives in the card-less empty state and is not part of
    // this one.
    const c = code("src/components/AddCardButton.tsx");
    expect((c.match(/href="\/cards\/new\?add=1"/g) ?? []).length).toBe(1);
    // And the unlocked path must be a real link, not a button that navigates.
    expect(c).toMatch(/if \(!locked\) \{[\s\S]{0,200}<Link href="\/cards\/new\?add=1"/);
  });
});
