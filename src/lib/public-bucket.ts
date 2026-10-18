import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Upload to a public bucket, creating the bucket only if it is missing.
 *
 * The share-image and signature routes called createBucket before EVERY
 * upload, believing it a no-op when the bucket exists. It is an INSERT: each
 * call was a failed duplicate-key write in the database log (47 a day) and a
 * wasted round trip on every card save (audit C02-001). Now the upload goes
 * first, and only a "bucket not found" answer creates it and tries once more.
 */
export async function uploadToPublicBucket(
  admin: SupabaseClient,
  bucket: string,
  path: string,
  body: Buffer,
  opts: { contentType: string; upsert?: boolean; cacheControl?: string },
): Promise<{ error: { message: string } | null }> {
  const put = () => admin.storage.from(bucket).upload(path, body, opts);
  const first = await put();
  if (!first.error || !isMissingBucket(first.error)) return { error: first.error };
  await admin.storage.createBucket(bucket, { public: true }).catch(() => {});
  const second = await put();
  return { error: second.error };
}

function isMissingBucket(e: { message?: string; statusCode?: string | number }): boolean {
  return /bucket not found/i.test(e.message ?? "") || String(e.statusCode ?? "") === "404";
}
