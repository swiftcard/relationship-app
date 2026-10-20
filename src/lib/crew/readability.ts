// ── "Talk to us like a fifth-grader" ─────────────────────────────────────────
// Flesch-Kincaid grade level, computed in code so a report can be checked, not
// just asked nicely. Numbers, links and $ amounts are not words to grade.

function syllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (!w) return 0;
  if (w.length <= 3) return 1;
  const trimmed = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "").replace(/^y/, "");
  const groups = trimmed.match(/[aeiouy]{1,2}/g);
  return Math.max(1, groups ? groups.length : 1);
}

export function gradeLevel(text: string): number {
  const clean = text
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/\$?\d[\d,.:%]*/g, " ")
    .replace(/[#*_`>|-]/g, " ");
  const sentences = Math.max(1, (clean.match(/[.!?]+(\s|$)/g) ?? []).length + (clean.match(/\n\s*\n|\n\s*[•\-]/g) ?? []).length);
  const words = clean.split(/\s+/).filter((w) => /[a-z]/i.test(w));
  if (words.length === 0) return 0;
  const syl = words.reduce((n, w) => n + syllables(w), 0);
  return 0.39 * (words.length / sentences) + 11.8 * (syl / words.length) - 15.59;
}

export const MAX_GRADE = 5;

export function readableEnough(text: string): boolean {
  return gradeLevel(text) <= MAX_GRADE;
}

/** Every number in the text must come from the facts we gave the writer. */
export function numbersAreGrounded(text: string, facts: unknown): { ok: boolean; stray: string[] } {
  const allowed = new Set<string>();
  const walk = (v: unknown) => {
    if (typeof v === "number") {
      allowed.add(String(v));
      allowed.add(v.toFixed(2));
      allowed.add(String(Math.round(v)));
    } else if (typeof v === "string") {
      for (const m of v.match(/\d+(?:\.\d+)?/g) ?? []) allowed.add(m);
    } else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(facts);
  // Small counting words are fine ("1 thing", "2 asks"), as are list numbers.
  for (let i = 0; i <= 10; i++) allowed.add(String(i));
  const stray = (text.replace(/https?:\/\/\S+/g, "").match(/\d+(?:\.\d+)?/g) ?? []).filter((n) => !allowed.has(n) && !allowed.has(String(Number(n))));
  return { ok: stray.length === 0, stray: [...new Set(stray)] };
}
