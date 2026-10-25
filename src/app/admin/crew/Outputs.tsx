import { plainFinding, scrub } from "@/lib/crew/agent-status";
import type { Dashboard } from "@/lib/crew/dashboard";
import type { Lead } from "@/lib/crew/types";
import { PLATFORM } from "./ApprovalCard";
import { Badge, Technical, card, nyTime } from "./ui";

// What some groups produce, shown on the group's page: the lead lists, the
// website-health group's open problems and the fixes you approved.

const FINDING_KIND: Record<string, string> = { bug: "Website error", speed: "Speed", security: "Security", ui: "Screen layout", flow: "Sign-up or flow", payment: "Payments", app: "Phone app" };

type LeadRow = Lead & { id: string; created_at: string };

export function ColdEmailRules() {
  return (
    <div className={`${card} space-y-2`}>
      <p className="text-white font-semibold text-sm">Before anyone sends a cold email</p>
      <p className="text-gray-400 text-sm">No agent sends email. Nothing should be sent to this list until all of these are true:</p>
      <ul className="text-gray-300 text-sm space-y-1 list-disc pl-5">
        <li>A separate sending domain and email provider (never swiftcard.me or our product email).</li>
        <li>An unsubscribe link in every email, honored within 10 days, added to the suppression list.</li>
        <li>Our physical mailing address in every email.</li>
        <li>Honest From name and subject lines.</li>
        <li>People in Europe, the UK, Canada and Brazil left out (they are flagged and kept out of the sheet).</li>
      </ul>
    </div>
  );
}

export function LeadsList({ list, title, today, rows }: { list: Lead["list"]; title: string; today: Record<string, number>; rows: LeadRow[] }) {
  const total = Object.values(today).reduce((a, b) => a + b, 0);
  return (
    <section className={`${card} space-y-3`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-white font-semibold">{title}</h2>
        <a href={`/api/admin/crew/leads?list=${list}`} className="text-blue-300 text-sm hover:underline">
          Download CSV
        </a>
      </div>
      <p className="text-gray-400 text-sm">
        {total} found today{Object.keys(today).length ? ` (${Object.entries(today).map(([k, v]) => `${PLATFORM[k] ?? "other"}: ${v}`).join(", ")})` : ""}.
      </p>
      {rows.length === 0 ? (
        <p className="text-gray-500 text-sm">None yet.</p>
      ) : (
        <ul className="divide-y divide-gray-800">
          {rows.slice(0, 30).map((r) => (
            <li key={r.id} className="py-2 text-sm">
              <p className="text-gray-200 break-words">
                {r.name ? `${r.name} · ` : ""}
                {r.company ?? ""} {r.title ? `(${r.title})` : ""}
              </p>
              <p className="text-gray-400 text-xs break-all">
                {[r.email, r.phone, [r.city, r.region].filter(Boolean).join(", ")].filter(Boolean).join(" · ")}
                {r.region_restricted ? " · outside the US rules, kept off the list" : ""}
              </p>
              <a href={r.source_url.startsWith("http") ? r.source_url : undefined} target="_blank" rel="noopener noreferrer" className="text-gray-600 text-xs break-all">
                Found on {PLATFORM[r.source_platform] ?? "the web"}
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

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
