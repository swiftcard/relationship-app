// ── The "Additional links" list: order, moves and the address rule ──────────
//
// Owner, 2026-11-06: links and section headers on the Socials step had to be
// movable ("hold on to a section header and put it above a link, or move one
// link under another") and editable after they were added. LinkListEditor is
// the one list every link surface shares (Edit card, the create-card wizard,
// Office Branding → Links, the homepage builder and the Teams demo); the moves
// themselves live here, pure, so they are tested without a browser.
//
// A LOCKED row is a company row on a member's card. The server re-pins those
// first on every save (pinOfficeLinks), so the list must never move one or put
// a member's row above it: a move the server silently undoes is worse than no
// move at all. Locked rows keep their exact indices; only the unlocked rows
// trade places among themselves.

/** A bare address gets https:// in front, which is the same rule every link form uses. */
export function withHttps(url: string): string {
  const u = url.trim();
  if (!u) return "";
  return /^https?:\/\//i.test(u) ? u : `https://${u}`;
}

/**
 * Move `rows[from]` so it ends up at index `to`, trading places only with
 * unlocked rows. Locked rows stay at their exact indices. An out-of-range or
 * locked `from`/`to` returns an unchanged copy. Never mutates the input.
 */
export function moveAmongUnlocked<T>(
  rows: readonly T[],
  from: number,
  to: number,
  isLocked: (row: T) => boolean = () => false,
): T[] {
  const out = rows.slice();
  if (from === to || from < 0 || to < 0 || from >= rows.length || to >= rows.length) return out;
  if (isLocked(rows[from]) || isLocked(rows[to])) return out;
  const slots: number[] = [];
  rows.forEach((r, i) => { if (!isLocked(r)) slots.push(i); });
  const movable = slots.map((i) => rows[i]);
  const [item] = movable.splice(slots.indexOf(from), 1);
  movable.splice(slots.indexOf(to), 0, item);
  slots.forEach((slot, k) => { out[slot] = movable[k]; });
  return out;
}

/** The nearest unlocked index above (`dir` -1) or below (`dir` 1) `from`, or `from` when there is none. */
export function nextUnlocked(locked: readonly boolean[], from: number, dir: -1 | 1): number {
  for (let j = from + dir; j >= 0 && j < locked.length; j += dir) {
    if (!locked[j]) return j;
  }
  return from;
}

/**
 * Where a dragged row would land. `rects` are the rows' positions when the
 * drag started (any one coordinate system), `dy` how far the row has moved
 * since. The row takes a slot once its centre passes that slot's midpoint,
 * which is how every list you can reorder by hand feels. Locked slots are
 * skipped and can never be the answer.
 */
export function dropIndex(
  rects: readonly { top: number; height: number }[],
  from: number,
  dy: number,
  locked: readonly boolean[],
): number {
  const r = rects[from];
  if (!r || locked[from]) return from;
  const centre = r.top + r.height / 2 + dy;
  let to = from;
  if (dy > 0) {
    for (let j = from + 1; j < rects.length; j++) {
      if (locked[j]) continue;
      if (centre > rects[j].top + rects[j].height / 2) to = j;
      else break;
    }
  } else if (dy < 0) {
    for (let j = from - 1; j >= 0; j--) {
      if (locked[j]) continue;
      if (centre < rects[j].top + rects[j].height / 2) to = j;
      else break;
    }
  }
  return to;
}

/**
 * While a row is dragged from `from` towards `to`, which way row `i` steps
 * aside to open the gap: -1 up, 1 down, 0 stays. The dragged row and locked
 * rows never step.
 */
export function shiftFor(i: number, from: number, to: number, locked: readonly boolean[]): -1 | 0 | 1 {
  if (i === from || locked[i]) return 0;
  if (from < to && i > from && i <= to) return -1;
  if (to < from && i >= to && i < from) return 1;
  return 0;
}
