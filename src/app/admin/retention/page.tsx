import { notFound } from "next/navigation";
import { retentionFunnel } from "@/lib/retention-alert";
import { requireAdmin } from "@/lib/admin";

export const metadata = { title: "Retention — SwiftCard Admin" };
// Read live every visit: the numbers here are small and the whole point is to
// see a reason while the person who wrote it is still reachable.
export const dynamic = "force-dynamic";

const OUTCOME: Record<string, { label: string; cls: string }> = {
  saved: { label: "Saved", cls: "bg-emerald-500/10 text-emerald-300 border-emerald-800/40" },
  deleted: { label: "Deleted", cls: "bg-red-500/10 text-red-300 border-red-900/40" },
  open: { label: "Mid-flow", cls: "bg-amber-500/10 text-amber-200 border-amber-800/40" },
};

const SAVED_BY: Record<string, string> = {
  grant: "30 free days",
  discount: "50% off ×3",
  downgrade: "→ Free",
  quiet: "Emails off",
  extend: "Trial → full month",
};

export default async function AdminRetentionPage() {
  // The admin layout is NOT a security boundary: an RSC request can render
  // this segment without its parent layout. Every page that reads data checks.
  if (!(await requireAdmin())) notFound();
  const { rows, totals, byReason } = await retentionFunnel();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-white">Retention</h1>
        <p className="text-gray-500 text-sm mt-1">
          Everyone who opened the delete or cancel flow — what they said, and whether we kept them.
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { k: "Save rate", v: `${totals.saveRate}%`, sub: `${totals.saved} of ${totals.saved + totals.deleted} decided` },
          { k: "Saved", v: totals.saved, sub: "took an offer" },
          { k: "Lost", v: totals.deleted, sub: "deleted anyway" },
          { k: "Mid-flow", v: totals.open, sub: "answered, no outcome" },
        ].map((c) => (
          <div key={c.k} className="rounded-2xl border border-gray-800 bg-gray-950/50 p-4">
            <p className="text-gray-500 text-xs">{c.k}</p>
            <p className="text-white text-2xl font-bold mt-1">{c.v}</p>
            <p className="text-gray-600 text-xs mt-0.5">{c.sub}</p>
          </div>
        ))}
      </div>

      {byReason.length > 0 && (
        <div className="rounded-2xl border border-gray-800 bg-gray-950/50 p-4">
          <p className="text-white font-semibold text-sm mb-3">Why they leave</p>
          <div className="space-y-2">
            {byReason.map((r) => (
              <div key={r.reason} className="flex items-center gap-3">
                <span className="text-gray-300 text-sm flex-1 truncate">{r.reason}</span>
                <span className="text-gray-500 text-xs tabular-nums">{r.saved}/{r.attempts} saved</span>
                <div className="w-28 h-2 rounded-full bg-gray-900 overflow-hidden">
                  <div
                    className="h-full bg-blue-500"
                    style={{ width: `${r.attempts ? (r.saved / r.attempts) * 100 : 0}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="rounded-2xl border border-gray-800 bg-gray-950/50 overflow-hidden">
        {rows.length === 0 ? (
          <p className="text-gray-500 text-sm p-6 text-center">
            Nobody has opened the delete or cancel flow yet.
          </p>
        ) : (
          <div className="divide-y divide-gray-900">
            {rows.map((r) => {
              const o = OUTCOME[r.outcome];
              return (
                <div key={r.userId} className="p-4">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-[0.6875rem] font-semibold px-2 py-0.5 rounded-full border ${o.cls}`}>{o.label}</span>
                    {r.savedBy && (
                      <span className="text-[0.6875rem] text-blue-300 bg-blue-500/10 border border-blue-900/40 px-2 py-0.5 rounded-full">
                        {SAVED_BY[r.savedBy] ?? r.savedBy}
                      </span>
                    )}
                    <span className="text-gray-300 text-sm">{r.email ?? r.userId.slice(0, 8)}</span>
                    <span className="text-gray-600 text-xs">{r.plan ?? "free"}</span>
                    {r.at && (
                      <span className="text-gray-600 text-xs ml-auto">
                        {new Date(r.at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                      </span>
                    )}
                  </div>
                  {r.reason && <p className="text-gray-400 text-sm mt-2">{r.reason}</p>}
                  {r.comment && (
                    <p className="text-gray-300 text-sm mt-1.5 whitespace-pre-wrap border-l-2 border-gray-800 pl-3">
                      {r.comment}
                    </p>
                  )}
                  {r.email && r.outcome !== "deleted" && (
                    <a
                      href={`mailto:${r.email}`}
                      className="inline-block mt-2 text-xs text-blue-400 hover:text-blue-300"
                    >
                      Reply to them →
                    </a>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
