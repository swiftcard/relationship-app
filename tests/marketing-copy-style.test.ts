import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import ts from "typescript";

// The marketing site's house style (owner, 2026-10-19: "a lot of grammatical
// errors, a lot of missing quotations, and a lot of dashes, which makes
// everything look AI"). The copy was rewritten by hand; this keeps it that
// way. It reads only what a visitor can see or a search engine indexes: JSX
// text, string literals and template text. Code comments are not checked
// (the parser drops them), and neither are import paths.
//
//   • No em dashes. Write the sentence with a period, comma, colon or
//     parentheses instead. Number ranges keep their en dash ("8am–9pm").
//     A cell holding only "—" (the "no value" mark in a table) is allowed.
//   • American spelling, like the rest of the product.
//   • One name per feature: "Swift Links", never "SwiftLinks", "SwiftLink"
//     or "Swift Link".
//
// Owner, same day: "Make sure you go through every page on the website." So
// it covers every page a visitor can reach signed out, not only marketing:
// the legal pages, the public card and Swift Links pages, the card builder,
// sign-in and join, checkout, the demo, the error and email pages. (The legal
// pages' exact compliance sentences are pinned separately, in
// tests/sms-consent.test.ts.)

const PAGES = [
  "src/app/page.tsx",
  "src/app/layout.tsx",
  "src/app/about/page.tsx",
  "src/app/company/page.tsx",
  "src/app/press/page.tsx",
  "src/app/testimonials/page.tsx",
  "src/app/faq/page.tsx",
  "src/app/contact/page.tsx",
  "src/app/contact/layout.tsx",
  "src/app/download/page.tsx",
  "src/app/templates/page.tsx",
  "src/app/templates/layout.tsx",
  "src/app/pricing/page.tsx",
  "src/app/pricing/layout.tsx",
  "src/app/business-card-view-tracking/page.tsx",
  "src/app/link-in-bio-with-analytics/page.tsx",
  "src/app/blog/page.tsx",
  "src/app/blog/[slug]/page.tsx",
  "src/app/not-found.tsx",
  "src/app/products/[slug]/page.tsx",
  "src/app/for/[slug]/page.tsx",
  "src/app/compare/page.tsx",
  "src/app/compare/[slug]/page.tsx",
  "src/lib/plan-content.ts",
  "src/lib/brand.ts",
  "src/components/PlanCards.tsx",
  "src/components/PlanTierCards.tsx",
  "src/components/PromoCodeBox.tsx",
  "src/components/AppStoreBadge.tsx",
  // Legal
  "src/app/privacy/page.tsx",
  "src/app/terms/page.tsx",
  "src/app/sms-consent/page.tsx",
  "src/app/sms-terms/page.tsx",
  // The public card page and the Swift Links page
  "src/app/[username]/page.tsx",
  "src/app/links/[username]/page.tsx",
  "src/components/SaveContactButton.tsx",
  "src/components/LeadCaptureForm.tsx",
  "src/components/ConnectButton.tsx",
  "src/components/SwiftLinksPromoSheet.tsx",
  "src/lib/referral.ts",
  // The card builder (signed out at /cards/new) and its editor twin
  "src/app/cards/new/NewCardWizard.tsx",
  "src/app/cards/[id]/edit/CardEditForm.tsx",
  "src/components/ProfilePhotoSuggest.tsx",
  "src/components/LogoSuggest.tsx",
  "src/components/ImageUpload.tsx",
  "src/components/CardUrlEditor.tsx",
  "src/components/FreeDesignChoice.tsx",
  "src/components/AiDesignSheet.tsx",
  "src/components/CreateDemo.tsx",
  "src/components/PinnedCardPreview.tsx",
  "src/components/SwiftLinkDesign.tsx",
  "src/components/card-templates/TemplateStyleControls.tsx",
  "src/lib/template-style-presets.ts",
  // Sign-in, join, checkout, the demo, error and email pages
  "src/components/LoginForm.tsx",
  "src/components/JoinSignIn.tsx",
  "src/components/GoogleSignInButton.tsx",
  "src/components/HumanCheck.tsx",
  "src/components/GuestDraftClaim.tsx",
  "src/components/NativePaywall.tsx",
  "src/components/AppStorePopup.tsx",
  "src/app/join/[token]/page.tsx",
  "src/app/checkout/CheckoutClient.tsx",
  "src/app/checkout/success/AwaitingPlan.tsx",
  "src/app/preview/page.tsx",
  "src/app/preview/PreviewClient.tsx",
  "src/app/error.tsx",
  "src/app/global-error.tsx",
  "src/app/account-deleted/page.tsx",
  "src/app/unsubscribe/page.tsx",
  "src/app/unsubscribe/UnsubscribeContent.tsx",
  "src/app/email/preferences/page.tsx",
  "src/components/email/PreferenceCenter.tsx",
  "src/components/EmailPreferencesForm.tsx",
];
const SITE_DIR = "src/components/site";
const FILES = [
  ...PAGES,
  ...readdirSync(SITE_DIR).filter((f) => /\.tsx?$/.test(f)).map((f) => `${SITE_DIR}/${f}`),
];

type Hit = { file: string; line: number; text: string };

/** Every piece of visible text in a file: JSX text, string literals and the
 *  literal parts of template strings, minus import/export module paths. */
function visibleText(file: string): Hit[] {
  const src = readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out: Hit[] = [];
  const push = (node: ts.Node, text: string) => {
    if (!text.trim()) return;
    out.push({ file, line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1, text });
  };
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return;
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) return;
    if (ts.isJsxText(node)) push(node, node.text);
    else if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) push(node, node.text);
    else if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) push(node, node.text);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

const ALL = FILES.flatMap(visibleText);
const show = (hits: Hit[]) => hits.map((h) => `${h.file}:${h.line}  ${h.text.trim().slice(0, 90)}`).join("\n");

// PlanGate's "Pro feature — …" copy never reaches the screen with its dash:
// PlanNotice strips that prefix and shows a "Pro feature" badge instead, and
// tests/plan-gate-wiring.test.ts pins the strings as written.
const PLAN_GATE_PREFIX = /^(Pro|Office) feature — /;

describe("the website's copy reads like a person wrote it", () => {
  it("covers the files it claims to", () => {
    expect(FILES.length).toBeGreaterThan(50);
    expect(ALL.length).toBeGreaterThan(1000);
  });

  it("has no em dashes in visible text", () => {
    const hits = ALL.filter((h) => h.text.includes("—") && h.text.trim() !== "—" && !PLAN_GATE_PREFIX.test(h.text));
    expect(hits, `em dashes in visible copy:\n${show(hits)}`).toEqual([]);
  });

  it("uses American spelling", () => {
    const hits = ALL.filter((h) => /\b(colours?|honours?|organisations?|cancell(?:ed|ing)|behaviours?|favourites?|centred?)\b/i.test(h.text));
    expect(hits, `British spelling:\n${show(hits)}`).toEqual([]);
  });

  it('calls the link page "Swift Links" everywhere', () => {
    const hits = ALL.filter((h) => /\bSwiftLinks?\b|\bSwift Link\b(?!s)/.test(h.text));
    expect(hits, `other names for Swift Links:\n${show(hits)}`).toEqual([]);
  });
});
