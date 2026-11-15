# crew:sheet-sync HTTP 400 (unprotectedRanges)

No code change made.

- The error ("unprotectedRanges are only allowed on ProtectedRanges covering a whole sheet") came from a Controls protection that put `unprotectedRanges` on a block of columns.
- HEAD (`fddbc53`, 2026-10-29 14:23 -0400 = 18:23 UTC) already fixes it in `src/lib/crew/sheets/bootstrap.ts:235-240`. The Controls protection now uses the whole sheet (`{ sheetId }` only) and the Value column is the unprotected hole. The Key-column protection has no `unprotectedRanges`.
- `tests/crew-sheet-sync-writes.test.ts` already pins this. It has a fake Google that refuses holes on partial ranges, and a test that only whole-sheet protections carry `unprotectedRanges`.
- The logged errors are at about 20:00 UTC, so they most likely came from a deployment older than `fddbc53`. A push is not live until CI's `verify` and `render` jobs pass.
- I could not run anything. Check that `/api/health` reports `fddbc53` or later, then see whether the error recurs after the next sheet-sync run. If it still recurs on that build, the failing request index 53 needs reproducing against the real workbook.
