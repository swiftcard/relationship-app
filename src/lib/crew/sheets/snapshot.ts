import { env } from "../env";
import { MIME, copyFile, deleteFile, ensureFolder, listChildren } from "../google/drive";
import { nyDay } from "../schedule";
import type { CrewStore } from "../store";
import { logActivity } from "./activity";
import { DAILY_FOLDER, WORKBOOK_NAME } from "./bootstrap";

// ── Daily snapshots: SwiftCard Leads/Daily/YYYY-MM-DD ───────────────────────
// A dated copy of the whole workbook, made once a day in the Shared Drive,
// for history, recovery and comparing days. Copies are not worked from (the
// agents only ever read and write the live workbook) and are deleted after
// RETENTION_DAYS. They inherit the Shared Drive's access, nothing wider.

export const RETENTION_DAYS = 90;

export async function snapshotWorkbook(store: CrewStore, sheetId: string, now = new Date()): Promise<{ url: string | null; removed: number; error?: string }> {
  const drive = env("CREW_SHARED_DRIVE_ID");
  if (!drive) return { url: null, removed: 0 };
  const day = nyDay(now);
  try {
    const daily = await ensureFolder(DAILY_FOLDER, drive, drive);
    const folder = await ensureFolder(day, daily.id, drive);
    const have = await listChildren(folder.id, drive, { mimeType: MIME.spreadsheet });
    const copy = have[0] ?? (await copyFile(sheetId, { name: `${WORKBOOK_NAME} ${day}`, parentId: folder.id }));
    let removed = 0;
    const cutoff = nyDay(new Date(now.getTime() - RETENTION_DAYS * 86400_000));
    for (const f of await listChildren(daily.id, drive, { mimeType: MIME.folder })) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(f.name) && f.name < cutoff) {
        await deleteFile(f.id).catch(() => null);
        removed++;
      }
    }
    await logActivity(store, { action: "sync", target: copy.webViewLink ?? copy.id, message: `Daily snapshot ${day}${removed ? `, ${removed} old day folders removed` : ""}` });
    return { url: copy.webViewLink ?? null, removed };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    await logActivity(store, { action: "sync", result: "failed", error, message: `Daily snapshot ${day} failed` });
    return { url: null, removed: 0, error };
  }
}
