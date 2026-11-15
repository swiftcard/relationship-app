# crew:sheet-daily addProtectedRange 400 (2026-10-29)

No code change made. The bug is already fixed at HEAD (fddbc53).

- The error was logged at 20:00 UTC on 2026-10-29. It said unprotectedRanges are only allowed on ProtectedRanges covering a whole sheet.
- `src/lib/crew/sheets/bootstrap.ts` (~line 235-239) now builds the Controls protection with `range: { sheetId }` only. The Value column is exempted through `unprotectedRanges`.
- `tests/crew-sheet-sync-writes.test.ts` already has a fake Google validator that rejects the old shape. It also has the test "only ever puts unprotectedRanges on a protection that covers a whole sheet".
- Only 1 event was seen. The most likely cause is that the run used a deploy from before this fix.

If the error shows up again after a deploy whose `/api/health` reports fddbc53 or later, look at the live sheet. A pre-existing protection may need clearing: `existingProtections` only matches descriptions containing "backend" or "Key column".
