// One quoted CSV cell that a spreadsheet will never run as a formula.
//
// Every contact field in an export was typed by whoever filled in a public
// card's form, and Excel and Sheets treat a cell starting with = + - @ (or a
// tab/CR) as a formula. Both exports prefixed those with a quote — but only
// when the very first character matched, so " =HYPERLINK(…)" (a leading space,
// which Sheets strips before evaluating) and the full-width ＝ ＋ － ＠ forms got
// through (audit SEC-18). The test is made after leading whitespace now.

const FORMULA_START = /^[=+\-@\t\r＝＋－＠]/;

export function csvCell(v: string | null | undefined): string {
  const s = v ?? "";
  const safe = FORMULA_START.test(s.trimStart()) || /^[\t\r]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
}
