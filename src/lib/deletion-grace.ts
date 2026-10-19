// How long a deleted account can still be reopened before it is purged —
// ONE number (audit F-SETTINGS-03). It was three literals ("must match" was
// the only guard), and reopen and the purge even used different edges of the
// last day. Import-free, so the page, the API and the purge job can all read
// it.
export const DELETION_GRACE_DAYS = 30;
export const DELETION_GRACE_MS = DELETION_GRACE_DAYS * 24 * 60 * 60 * 1000;

/** Past the window: no reopen, and due for the purge. The same edge for both. */
export function deletionGraceOver(deletedAtMs: number, nowMs: number = Date.now()): boolean {
  return nowMs - deletedAtMs >= DELETION_GRACE_MS;
}
