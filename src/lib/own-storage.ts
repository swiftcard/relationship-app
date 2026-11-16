// A picture in OUR storage can be read by the browser directly: storage
// answers every request with `Access-Control-Allow-Origin: *`, so a canvas or
// a fetch can use it without /api/img-proxy. The proxy exists for OTHER
// hosts' pictures (hotlink protection, no CORS) and stays the fallback here:
// each caller tries storage first and the proxy only if that read fails.
// Every picture read through the proxy is a function run plus the picture's
// bytes sent twice, which is what this avoids.

/** True for a public object in this project's own storage. */
export function isOwnStorageUrl(url: string | null | undefined): boolean {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  return !!base && typeof url === "string" && url.startsWith(`${base}/storage/v1/object/public/`);
}
