// ── Product knowledge base: types ───────────────────────────────────────────
//
// ONE corpus of product truth, consumed by every assistant surface:
//   • /api/ai/sales   — public marketing chat  (audience: "visitor")
//   • /api/ai/help    — in-app assistant       (audience: "user")
//   • /api/ai/help?area=office-admin           (audience: "office-admin")
//
// Before this existed, each route carried its own hand-written prose describing
// the product, so shipping a feature meant remembering to edit two prompts and
// two trigger lists — which never happened. A doc written once here reaches
// every surface, and tests/knowledge-truth.test.ts fails the build when a doc
// drifts from the code it describes.

/** Who is allowed to be told this. A doc can serve more than one surface. */
export type Audience = "visitor" | "user" | "office-admin";

export type KnowledgeDoc = {
  /** Stable kebab-case id. Referenced by tests — renaming one is a breaking change. */
  id: string;
  /** Short human title, used as the section heading in the grounded context. */
  title: string;
  audience: Audience[];
  /**
   * Phrases that should surface this doc. Used for BOTH the instant no-LLM
   * answer and for ranking which docs get injected as context. Write them the
   * way a user types, not the way the feature is named internally.
   */
  triggers: string[];
  /**
   * The direct answer, returned verbatim when a trigger matches strongly.
   * Keep it to a few sentences — it ships to the user unedited.
   */
  answer: string;
  /**
   * Native-app-safe replacement for `answer`. REQUIRED when `commerce` is true:
   * the App Store forbids in-app selling, so the iOS shell must never receive
   * pricing, upgrade, billing, or website copy. Enforced by a type constraint
   * below and by tests/help-guardrail.test.ts.
   */
  nativeAnswer?: string;
  /**
   * The Android app's answer, when `nativeAnswer` describes the iPhone's
   * In-App Purchase. The Android app sells nothing (owner, 2026-10-08): no
   * price, no trial, no subscribe button, no Apple account, no web checkout —
   * so an Android session gets this instead (audit F-HELP-01). Falls back to
   * `nativeAnswer` when absent. tests/help-android.test.ts holds every answer
   * an Android session can receive to the Android app's own no-selling list.
   */
  androidAnswer?: string;
  /**
   * Everything else worth knowing — exact UI labels, edge cases, what users get
   * wrong. Never returned verbatim; it is grounding context for the LLM, so it
   * can be longer and denser than `answer`.
   */
  detail?: string;
  /**
   * True when the doc mentions price, upgrading, billing, purchasing, or the
   * website. Commerce docs are dropped entirely from native-app context and
   * their `nativeAnswer` replaces `answer` on the instant path.
   */
  commerce?: boolean;
};

/**
 * A commerce doc without a `nativeAnswer` is a compile error, not a runtime
 * leak. This is the type-level half of the native guardrail; the behavioural
 * half lives in retrieval.ts and is covered by tests/help-guardrail.test.ts.
 */
export type SafeDoc =
  | (KnowledgeDoc & { commerce?: false })
  | (KnowledgeDoc & { commerce: true; nativeAnswer: string });

/** Helper so doc modules get the constraint checked at their definition site. */
export function defineDocs<T extends readonly SafeDoc[]>(docs: T): T {
  return docs;
}
