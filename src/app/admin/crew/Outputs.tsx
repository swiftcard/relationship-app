import { plainFinding, scrub } from "@/lib/crew/agent-status";
import type { Dashboard } from "@/lib/crew/dashboard";
import { Badge, Technical, card, nyTime } from "./ui";

// What the website-health group produces, shown on its page: the open
// problems and the fixes you approved. (Lead lists live in the Google Sheet.)

const FINDING_KIND: Record<string, string> = { bug: "Website error", speed: "Speed", security: "Security", ui: "Screen layout", flow: "Sign-up or flow", payment: "Payments", app: "Phone app" };

export function Findings({ d }: { d: Dashboard }) {
  const fixes = d.recentDone.filter((a) => a.kind === "code_fix" && a.status === "done");
  return (
    <section className={`${card} space-y-3`}>
      <h2 className="text-white font-semibold">Open problems</h2>
      {d.findings.length === 0 ? (
        <p className="text-gray-500 text-sm">Nothing open. Anything broken shows up here.</p>
      ) : (
        <ul className="divide-y divide-gray-800">
          {d.findings.slice(0, 15).map((f) => (
            <li key={f.id} className="py-2 space-y-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge tone={f.status === "proposed" ? "blue" : "amber"}>{f.status === "proposed" ? "Fix drafted" : "Open"}</Badge>
                <Badge>{FINDING_KIND[f.kind] ?? "Problem"}</Badge>
              </div>
              <p className="text-gray-200 text-sm break-words">{plainFinding(f)}</p>
              <p className="text-gray-500 text-xs">Last seen {nyTime(f.last_seen)}</p>
              {f.kind === "bug" && <Technical>{f.title}</Technical>}
            </li>
          ))}
        </ul>
      )}
      {fixes.length > 0 && (
        <div className="space-y-1.5 border-t border-gray-800 pt-3">
          <h3 className="text-white font-semibold text-sm">Fixes you approved</h3>
          {fixes.map((a) => {
            const r = (a.meta?.result ?? {}) as { pr_url?: string | null; run_url?: string | null };
            return (
              <p key={a.id} className="text-sm text-gray-300 break-words">
                {scrub(a.title.replace(/^Fix:\s*/, ""))}:{" "}
                {r.pr_url ? (
                  <a href={r.pr_url} target="_blank" rel="noopener noreferrer" className="text-blue-300 hover:underline">
                    review the fix
                  </a>
                ) : r.run_url ? (
                  <a href={r.run_url} target="_blank" rel="noopener noreferrer" className="text-blue-300 hover:underline">
                    no change was made, see why
                  </a>
                ) : (
                  <span className="text-gray-500">being written</span>
                )}
              </p>
            );
          })}
        </div>
      )}
    </section>
  );
}
