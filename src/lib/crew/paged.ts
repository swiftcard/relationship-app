// ── Reading past PostgREST's 1,000-row answer ───────────────────────────────
// PostgREST answers a plain select with at most 1,000 rows (the project's
// max-rows), silently. Every crew read that can pass that (runs, usage, leads,
// Sheet rows, approvals) goes through here: pages of 1,000 over a stable
// order, up to `max`. Without it the budget undercounts spend and the Sheet
// forgets rows once a day passes 1,000 of anything. Kept free of the database
// client so tests can pin it.

export const PAGE_ROWS = 1000;

export async function paged<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>, max: number, what: string): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < max; from += PAGE_ROWS) {
    const to = Math.min(from + PAGE_ROWS, max) - 1;
    const res = await build(from, to);
    if (res.error) throw new Error(`crew store ${what}: ${res.error.message}`);
    const rows = res.data ?? [];
    out.push(...rows);
    if (rows.length < to - from + 1) break;
  }
  return out;
}
