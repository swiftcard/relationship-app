// Shown the moment an "Upgrade" link is tapped, while the server checks the
// plan, a pending team invite and trial eligibility (one of which can be a
// Stripe call). Without it the previous screen sat frozen with no sign the tap
// registered (perf audit 2026-10-06). Same ground and column as the page, so
// the real content replaces it in place.
export default function Loading() {
  return (
    <main className="sc-app min-h-screen bg-gray-950 px-5 py-12" aria-busy="true" aria-label="Loading">
      <div className="max-w-4xl mx-auto animate-pulse">
        <div className="mx-auto h-6 w-28 rounded-full bg-gray-800" />
        <div className="mx-auto mt-4 h-8 w-64 max-w-full rounded-lg bg-gray-800" />
        <div className="mx-auto mt-3 h-4 w-80 max-w-full rounded bg-gray-800" />
        <div className="mt-10 grid gap-4 md:grid-cols-2">
          <div className="h-80 rounded-2xl bg-gray-900 border border-gray-800" />
          <div className="h-80 rounded-2xl bg-gray-900 border border-gray-800" />
        </div>
      </div>
    </main>
  );
}
