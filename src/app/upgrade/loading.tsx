// Shown the moment an "Upgrade" link is tapped, while the server checks the
// plan, a pending team invite and trial eligibility (one of which can be a
// Stripe call). Without it the previous screen sat frozen with no sign the tap
// registered (perf audit 2026-10-06). Same ground and column as the page, so
// the real content replaces it in place.
export default function Loading() {
  return (
    <main className="min-h-screen bg-gray-950 px-5 py-12" aria-busy="true" aria-label="Loading">
      <div className="max-w-4xl mx-auto animate-pulse">
        <div className="mx-auto h-6 w-28 rounded-full bg-white/[0.06]" />
        <div className="mx-auto mt-4 h-8 w-64 max-w-full rounded-lg bg-white/[0.06]" />
        <div className="mx-auto mt-3 h-4 w-80 max-w-full rounded bg-white/[0.04]" />
        <div className="mt-10 grid gap-4 md:grid-cols-2">
          <div className="h-80 rounded-2xl bg-white/[0.04] border border-white/[0.06]" />
          <div className="h-80 rounded-2xl bg-white/[0.04] border border-white/[0.06]" />
        </div>
      </div>
    </main>
  );
}
