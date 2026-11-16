-- Storage: size and file-type limits on the two buckets that have none.
-- WRITTEN 2026-11-15, NOT YET APPLIED.
--
-- What the 2026-11-15 check found (read-only):
--   * storage.objects and storage.buckets have row level security ON and NOT
--     ONE policy. So the browser's keys (anon, or a signed-in user) cannot
--     upload, list, overwrite or delete anything in any bucket. Every write
--     goes through the server (service role, or a signed upload URL the
--     server issues). That is the locked-down state; this file adds no policy
--     and must not: any policy here is a door.
--   * All five buckets are public, which only means a file can be READ by
--     someone who already has its exact URL. Nobody can list a bucket.
--   * card-uploads, card-shares and card-signatures already carry a size cap
--     and an allowed-types list (security-lockdown-2026-09-24.sql).
--   * pins and crew-media carry neither. Both are empty and only the server
--     can write to them, so this is tidying, not an open hole: it caps what a
--     future server bug or a leaked signed URL could put there.
--
-- Safe to run more than once. Deletes nothing.
-- To apply: Supabase dashboard -> SQL Editor -> paste -> Run.
-- To check: select id, file_size_limit, allowed_mime_types from storage.buckets;

update storage.buckets
   set file_size_limit = 10485760,   -- 10 MB
       allowed_mime_types = array['image/jpeg','image/png','image/webp']
 where id = 'pins';

update storage.buckets
   set file_size_limit = 27262976,   -- 26 MB, same as card-uploads
       allowed_mime_types = array['image/jpeg','image/png','image/webp','image/gif','video/mp4']
 where id = 'crew-media';
