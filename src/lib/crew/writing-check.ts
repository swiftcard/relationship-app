import type { ApprovalKind } from "./types";
import { BANNED_PHRASES, voiceProblems } from "./voice";

// ── The writing-quality check (spec §18) ────────────────────────────────────
// Deterministic, runs on every draft before it reaches the Sheet. A draft
// that fails is sent back for one rewrite (replies/engine.ts); if it still
// fails it reaches the Sheet marked Needs Review, with the problems in the
// row, rather than being silently dropped. Cold-email rules are checked here
// too, so the outreach code (next release) shares the one list.

/** The owner's banned list, on top of the voice file's. */
export const OWNER_BANNED = ["i hope this finds you well", "i came across", "leverage", "streamline", "game-changer", "game changer", "elevate", "seamless", "unlock", "excited to"];

export const ALL_BANNED = [...new Set([...BANNED_PHRASES, ...OWNER_BANNED])];

export type WritingCheck = { ok: boolean; problems: string[] };

export function writingProblems(text: string, o: { kind?: ApprovalKind | "cold_email"; platform?: string | null } = {}): string[] {
  const t = text.toLowerCase();
  const out = new Set(voiceProblems(text));
  for (const p of OWNER_BANNED) if (new RegExp(`\\b${p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(t)) out.add(`uses "${p}"`);
  if (/!{2,}/.test(text)) out.add("stacked exclamation points");
  const conversational = !o.kind || ["reply", "comment", "dm", "connect_note", "cold_email"].includes(o.kind);
  if (conversational) {
    const bullets = text.split("\n").filter((l) => /^\s*([-•*]|\d+[.)])\s+/.test(l)).length;
    if (bullets >= 3) out.add("reads like a bullet-point sales pitch");
    if (/#[a-z0-9_]{2,}/i.test(text) && o.platform !== "instagram") out.add("has hashtags");
  }
  if (o.kind === "cold_email") {
    const words = text.replace(/^subject:.*$/im, "").trim().split(/\s+/).filter(Boolean).length;
    if (words > 80) out.add(`${words} words (cold email limit is 80)`);
    if (/https?:\/\//i.test(text.replace(/unsubscribe[^\n]*/gi, ""))) out.add("has a promotional link in the first email");
  }
  return [...out];
}

export function checkWriting(text: string, o: { kind?: ApprovalKind | "cold_email"; platform?: string | null } = {}): WritingCheck {
  const problems = writingProblems(text, o);
  return { ok: problems.length === 0, problems };
}
