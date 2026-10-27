import { googleFetch } from "./auth";

// ── Google Drive API v3: the workbook's home and the daily snapshots ─────────
// Everything is created inside the Shared Drive (supportsAllDrives), because
// the service account cannot own a file anywhere else.

const BASE = "https://www.googleapis.com/drive/v3/files";
const ALL = "supportsAllDrives=true&includeItemsFromAllDrives=true";

export const MIME = {
  spreadsheet: "application/vnd.google-apps.spreadsheet",
  folder: "application/vnd.google-apps.folder",
} as const;

export type DriveFile = { id: string; name: string; mimeType: string; webViewLink?: string; createdTime?: string };

function q(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

export async function listChildren(parentId: string, driveId: string, o: { name?: string; mimeType?: string } = {}): Promise<DriveFile[]> {
  const parts = [`'${q(parentId)}' in parents`, "trashed = false"];
  if (o.name) parts.push(`name = '${q(o.name)}'`);
  if (o.mimeType) parts.push(`mimeType = '${q(o.mimeType)}'`);
  const url = `${BASE}?${ALL}&corpora=drive&driveId=${encodeURIComponent(driveId)}&q=${encodeURIComponent(parts.join(" and "))}&fields=files(id,name,mimeType,webViewLink,createdTime)&pageSize=200`;
  const r = await googleFetch(url, { scopes: ["drive"], what: "drive.files.list" });
  const j = (await r.json()) as { files?: DriveFile[] };
  return j.files ?? [];
}

export async function createFile(o: { name: string; mimeType: string; parentId: string }): Promise<DriveFile> {
  const r = await googleFetch(`${BASE}?${ALL}&fields=id,name,mimeType,webViewLink,createdTime`, {
    method: "POST",
    scopes: ["drive"],
    what: "drive.files.create",
    body: JSON.stringify({ name: o.name, mimeType: o.mimeType, parents: [o.parentId] }),
  });
  return (await r.json()) as DriveFile;
}

/** The folder with this name under the parent, created if missing. */
export async function ensureFolder(name: string, parentId: string, driveId: string): Promise<DriveFile> {
  const found = await listChildren(parentId, driveId, { name, mimeType: MIME.folder });
  return found[0] ?? createFile({ name, mimeType: MIME.folder, parentId });
}

export async function copyFile(fileId: string, o: { name: string; parentId: string }): Promise<DriveFile> {
  const r = await googleFetch(`${BASE}/${encodeURIComponent(fileId)}/copy?${ALL}&fields=id,name,mimeType,webViewLink,createdTime`, {
    method: "POST",
    scopes: ["drive"],
    what: "drive.files.copy",
    body: JSON.stringify({ name: o.name, parents: [o.parentId] }),
    timeoutMs: 120_000,
  });
  return (await r.json()) as DriveFile;
}

export async function deleteFile(fileId: string): Promise<void> {
  await googleFetch(`${BASE}/${encodeURIComponent(fileId)}?${ALL}`, { method: "DELETE", scopes: ["drive"], what: "drive.files.delete" });
}

export async function getFile(fileId: string): Promise<DriveFile> {
  const r = await googleFetch(`${BASE}/${encodeURIComponent(fileId)}?${ALL}&fields=id,name,mimeType,webViewLink,createdTime`, { scopes: ["drive"], what: "drive.files.get" });
  return (await r.json()) as DriveFile;
}

export type Permission = { id: string; emailAddress?: string; role: string; type: string };

export async function listPermissions(fileId: string): Promise<Permission[]> {
  const r = await googleFetch(`${BASE}/${encodeURIComponent(fileId)}/permissions?${ALL}&fields=permissions(id,emailAddress,role,type)`, { scopes: ["drive"], what: "drive.permissions.list" });
  const j = (await r.json()) as { permissions?: Permission[] };
  return j.permissions ?? [];
}

/** Give one Google account Editor access, without an email notification. Idempotent. */
export async function shareWith(fileId: string, email: string, role: "writer" | "reader" = "writer"): Promise<boolean> {
  const have = await listPermissions(fileId);
  if (have.some((p) => p.emailAddress?.toLowerCase() === email.toLowerCase())) return false;
  await googleFetch(`${BASE}/${encodeURIComponent(fileId)}/permissions?${ALL}&sendNotificationEmail=false`, {
    method: "POST",
    scopes: ["drive"],
    what: "drive.permissions.create",
    body: JSON.stringify({ type: "user", role, emailAddress: email }),
  });
  return true;
}
