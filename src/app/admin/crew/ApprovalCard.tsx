import type { Person } from "@/lib/crew/staff";
import type { Approval, TeamId } from "@/lib/crew/types";
import CopyOpen from "./CopyOpen";
import { Avatar, Badge, btn, card, input } from "./ui";

// One draft waiting for the owner: Approve / Reject, then "I posted it".

const KIND_LABEL: Record<string, string> = {
  reply: "Reply",
  comment: "Comment",
  dm: "DM",
  connect_note: "Connect note",
  post: "Social post",
  blog_post: "Blog post",
  code_fix: "Fix",
  email_list_export: "Lead list",
  spend: "Spend",
  ask: "Question",
};

const POSTED_KINDS: Approval["kind"][] = ["reply", "comment", "dm", "connect_note", "post"];

export default function ApprovalCard({ a, tab, who }: { a: Approval; tab: string; who: (Person & { team: TeamId }) | null }) {
  const action = `/api/admin/crew/approvals/${a.id}`;
  const editable = a.status === "pending" && a.kind !== "code_fix" && a.kind !== "ask" && !Array.isArray(a.meta?.options);
  const tierWhy = typeof a.meta?.tier_why === "string" ? a.meta.tier_why : null;
  const options = Array.isArray(a.meta?.options) ? (a.meta.options as { n: number; name: string; image: string | null }[]) : null;
  const images = Array.isArray(a.meta?.images) ? (a.meta.images as { key: string; url: string }[]) : null;
  const prUrl = typeof (a.meta?.result as { pr_url?: string } | undefined)?.pr_url === "string" ? (a.meta.result as { pr_url: string }).pr_url : null;
  return (
    <article id={`a-${a.id}`} className={`${card} space-y-3 scroll-mt-20`} data-approval={a.id}>
      <div className="flex items-center gap-2.5 min-w-0">
        {who && <Avatar name={who.first} team={who.team} size="sm" />}
        <p className="text-sm text-gray-300 min-w-0 truncate">
          {who ? (
            <>
              <span className="text-white font-medium">{who.first}</span> <span className="text-gray-500">· {who.title}</span>
            </>
          ) : (
            a.agent_id
          )}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge tone="blue">{KIND_LABEL[a.kind] ?? a.kind}</Badge>
        {a.platform && <Badge>{a.platform}</Badge>}
        {a.status === "approved" && <Badge tone="green">Approved</Badge>}
      </div>
      <div>
        <p className="text-white font-semibold text-[0.9375rem] break-words">{a.title}</p>
        <p className="text-gray-300 text-sm mt-1 whitespace-pre-line break-words">{a.summary}</p>
        {a.target_url && (
          <a href={a.target_url} target="_blank" rel="noopener noreferrer" className="text-blue-300 text-xs break-all hover:underline">
            {a.target_url}
          </a>
        )}
      </div>
      {a.debate && <p className="text-gray-400 text-xs">{a.debate.line}</p>}
      {tierWhy && <p className="text-amber-200/80 text-xs">{tierWhy}</p>}
      {prUrl && (
        <a href={prUrl} target="_blank" rel="noopener noreferrer" className="text-blue-300 text-sm hover:underline">
          Open the fix on GitHub
        </a>
      )}

      {options && options.some((o) => o.image) && (
        <div className="grid grid-cols-3 gap-2">
          {options.map((o) => (
            <a key={o.n} href={o.image ?? undefined} target="_blank" rel="noopener noreferrer" className="block min-w-0">
              {o.image && (
                // eslint-disable-next-line @next/next/no-img-element -- storage URLs, shown as-is
                <img src={o.image} alt={`Option ${o.n}: ${o.name}`} className="w-full rounded-lg border border-gray-800" loading="lazy" />
              )}
              <span className="block text-xs text-gray-400 mt-1 truncate">{o.n}. {o.name}</span>
            </a>
          ))}
        </div>
      )}
      {images && images.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {images.map((im) => (
            <a key={im.key} href={im.url} target="_blank" rel="noopener noreferrer" download className="shrink-0">
              {/* eslint-disable-next-line @next/next/no-img-element -- storage URLs, shown as-is */}
              <img src={im.url} alt={im.key} className="h-28 rounded-md border border-gray-800" loading="lazy" />
              <span className="block text-[0.6875rem] text-gray-500 mt-0.5">{im.key}</span>
            </a>
          ))}
        </div>
      )}

      {a.status === "pending" ? (
        <>
          <form method="post" action={action} className="space-y-2">
            <input type="hidden" name="tab" value={tab} />
            {options && (
              <label className="block text-sm text-gray-300 space-y-1">
                <span>Which one?</span>
                <select name="choice" defaultValue="1" className={`${input} sm:w-64`}>
                  {options.map((o) => (
                    <option key={o.n} value={String(o.n)}>
                      {o.n}. {o.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {editable ? (
              <textarea name="body" defaultValue={a.body} rows={Math.min(14, Math.max(4, Math.ceil(a.body.length / 70)))} className={input} aria-label="Draft" />
            ) : (
              a.body && <pre className="text-gray-300 text-xs whitespace-pre-wrap break-words bg-gray-900 rounded-lg p-3 max-h-72 overflow-auto">{a.body}</pre>
            )}
            <button name="action" value="approve" className={`${btn} bg-emerald-600 text-white hover:bg-emerald-500 w-full sm:w-auto`}>
              Approve
            </button>
          </form>
          <form method="post" action={action} className="flex flex-col sm:flex-row gap-2">
            <input type="hidden" name="tab" value={tab} />
            <input type="hidden" name="action" value="reject" />
            <select name="reason" className={`${input} sm:w-56`} aria-label="Why reject" defaultValue="">
              <option value="">Why? (optional)</option>
              <option>Too salesy</option>
              <option>Wrong person</option>
              <option>Wrong facts</option>
              <option>Sounds like a bot</option>
              <option>Not worth it</option>
            </select>
            <button className={`${btn} bg-gray-800 text-white hover:bg-gray-700`}>Reject</button>
          </form>
        </>
      ) : (
        <div className="space-y-2">
          {a.body && <pre className="text-gray-300 text-sm whitespace-pre-wrap break-words bg-gray-900 rounded-lg p-3">{a.body}</pre>}
          <div className="flex flex-wrap gap-2">
            <CopyOpen text={a.body} href={a.target_url} />
            <form method="post" action={action}>
              <input type="hidden" name="tab" value={tab} />
              <button name="action" value="posted" className={`${btn} bg-gray-800 text-white hover:bg-gray-700`}>
                {POSTED_KINDS.includes(a.kind) ? "I posted it" : "Mark done"}
              </button>
            </form>
            <form method="post" action={action}>
              <input type="hidden" name="tab" value={tab} />
              <input type="hidden" name="reason" value="Changed my mind" />
              <button name="action" value="reject" className={`${btn} text-gray-400 hover:text-white`}>
                {POSTED_KINDS.includes(a.kind) ? "Didn’t post it" : "Drop it"}
              </button>
            </form>
          </div>
        </div>
      )}
    </article>
  );
}
