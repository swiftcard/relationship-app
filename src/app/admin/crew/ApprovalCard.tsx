import Link from "next/link";
import { agentName, scrub } from "@/lib/crew/agent-status";
import { agentById } from "@/lib/crew/registry";
import type { Approval } from "@/lib/crew/types";
import CopyOpen from "./CopyOpen";
import { Badge, LockIcon, Technical, btn, card, input } from "./ui";

// One thing waiting for the owner: a preview, then Approve / Edit / Reject.
// Once approved, drafts we post by hand get "Copy & open" and "I posted it".
// Edit is a link (?edit=<id>) that re-renders the card with the text box, so
// every button works before the page's JavaScript loads.

const KIND_LABEL: Record<string, string> = {
  reply: "Reply",
  comment: "Comment",
  dm: "Message",
  connect_note: "Connection note",
  post: "Social post",
  blog_post: "Blog post",
  code_fix: "Website fix",
  email_list_export: "Lead list",
  spend: "Spending",
  ask: "Question",
};

/** What happens when you tap Approve, in one line. */
const ON_APPROVE: Record<string, string> = {
  reply: "Approve, then you post it yourself.",
  comment: "Approve, then you post it yourself.",
  dm: "Approve, then you send it yourself.",
  connect_note: "Approve, then you send it from LinkedIn.",
  post: "Approve, then you post it yourself.",
  blog_post: "Approve puts this post live on the SwiftCard blog.",
  code_fix: "Approve asks a coding agent to write the fix for review. Nothing changes on the site until you merge it.",
  ask: "Approve tells the agents your answer is yes.",
};

export const PLATFORM: Record<string, string> = {
  reddit: "Reddit",
  instagram: "Instagram",
  threads: "Threads",
  facebook: "Facebook",
  quora: "Quora",
  indiehackers: "Indie Hackers",
  linkedin: "LinkedIn",
  alignable: "Alignable",
  tiktok: "TikTok",
  pinterest: "Pinterest",
  youtube: "YouTube",
  bluesky: "Bluesky",
  web: "Website",
  email: "Email",
  site: "SwiftCard site",
};

const POSTED_KINDS: Approval["kind"][] = ["reply", "comment", "dm", "connect_note", "post"];

function whereLabel(url: string) {
  try {
    const u = new URL(url);
    const path = u.pathname.length > 1 ? (u.pathname.length > 40 ? `${u.pathname.slice(0, 39)}…` : u.pathname) : "";
    return `${u.hostname.replace(/^www\./, "")}${path}`;
  } catch {
    return "the original";
  }
}

/** `here` is the page this card sits on (path + query, no #), so Edit and Cancel come back to it. */
export function withEdit(here: string, id: string | null): string {
  const u = new URL(here, "https://x.invalid");
  if (id) u.searchParams.set("edit", id);
  else u.searchParams.delete("edit");
  return `${u.pathname}${u.search}`;
}

export default function ApprovalCard({ a, tab, here, editing = false }: { a: Approval; tab: string; here: string; editing?: boolean }) {
  const action = `/api/admin/crew/approvals/${a.id}`;
  const def = agentById(a.agent_id);
  const from = def ? agentName(def) : "an agent";
  const technical = a.kind === "code_fix";
  const options = Array.isArray(a.meta?.options) ? (a.meta.options as { n: number; name: string; image: string | null }[]) : null;
  const editable = a.status === "pending" && !technical && a.kind !== "ask" && !options;
  const images = Array.isArray(a.meta?.images) ? (a.meta.images as { key: string; url: string }[]) : null;
  const prUrl = typeof (a.meta?.result as { pr_url?: string } | undefined)?.pr_url === "string" ? (a.meta.result as { pr_url: string }).pr_url : null;
  const error = typeof a.meta?.error === "string" ? scrub(a.meta.error) : null;
  const second =
    a.debate && !a.debate.skipped && a.debate.outcome !== "single" ? (a.debate.outcome === "agreed" ? "A second reviewer checked this and agreed." : "A second reviewer asked for changes; this is the improved version.") : null;
  const showEditor = editing && editable;
  return (
    <article id={`a-${a.id}`} className={`${card} space-y-3 scroll-mt-20`} data-approval={a.id}>
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge tone="blue">{KIND_LABEL[a.kind] ?? "Draft"}</Badge>
        {a.platform && <Badge>{PLATFORM[a.platform] ?? "Online"}</Badge>}
        {a.status === "approved" && <Badge tone="green">Approved, waiting for you to post</Badge>}
        <span className="text-gray-500 text-xs">from {from}</span>
      </div>
      <div>
        <p className="text-white font-semibold text-[0.9375rem] break-words">{scrub(a.title)}</p>
        {a.summary && <p className="text-gray-300 text-sm mt-1 whitespace-pre-line break-words">{scrub(a.summary)}</p>}
        {a.target_url && (
          <a href={a.target_url} target="_blank" rel="noopener noreferrer" className="inline-block mt-1 text-blue-300 text-xs break-all hover:underline">
            Where it goes: {whereLabel(a.target_url)} ↗
          </a>
        )}
      </div>
      {second && <p className="text-gray-400 text-xs">{second}</p>}
      {error && <p className="rounded-lg bg-red-500/10 border border-red-900/40 text-red-200 text-sm px-3 py-2">Approved, but it couldn&apos;t be carried out: {error}</p>}
      {prUrl && (
        <a href={prUrl} target="_blank" rel="noopener noreferrer" className="text-blue-300 text-sm hover:underline">
          Review the fix on GitHub ↗
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
              <span className="block text-xs text-gray-400 mt-1 truncate">
                {o.n}. {o.name}
              </span>
            </a>
          ))}
        </div>
      )}
      {images && images.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {images.map((im, i) => (
            <a key={im.key} href={im.url} target="_blank" rel="noopener noreferrer" download className="shrink-0">
              {/* eslint-disable-next-line @next/next/no-img-element -- storage URLs, shown as-is */}
              <img src={im.url} alt={`Picture ${i + 1}`} className="h-28 rounded-md border border-gray-800" loading="lazy" />
            </a>
          ))}
        </div>
      )}

      {a.body && !technical && !showEditor && (
        <div className="rounded-xl bg-gray-900 border border-gray-800 px-3 py-2.5">
          <p className="text-gray-500 text-[0.6875rem] mb-1">Preview</p>
          <p className="text-gray-100 text-sm whitespace-pre-wrap break-words max-h-80 overflow-y-auto">{a.body}</p>
        </div>
      )}
      {a.body && technical && (
        <Technical>
          <pre className="whitespace-pre-wrap max-h-72 overflow-auto">{a.body}</pre>
        </Technical>
      )}

      {a.status === "pending" ? (
        <div className="space-y-2">
          {ON_APPROVE[a.kind] && (
            <p className="flex items-center gap-1.5 text-gray-500 text-xs">
              <LockIcon className="h-3 w-3 shrink-0" />
              {ON_APPROVE[a.kind]}
            </p>
          )}
          {showEditor ? (
            <form method="post" action={action} className="space-y-2">
              <input type="hidden" name="tab" value={tab} />
              <label className="block text-sm text-gray-300 space-y-1">
                <span>Edit the text</span>
                <textarea name="body" defaultValue={a.body} rows={Math.min(14, Math.max(4, Math.ceil(a.body.length / 60)))} className={input} />
              </label>
              <div className="flex flex-wrap gap-2">
                <button name="action" value="approve" className={`${btn} bg-emerald-600 text-white hover:bg-emerald-500`}>
                  Save and approve
                </button>
                <button name="action" value="edit" className={`${btn} bg-gray-800 text-white hover:bg-gray-700`}>
                  Save for later
                </button>
                <Link href={`${withEdit(here, null)}#a-${a.id}`} className={`${btn} text-gray-300 hover:text-white`}>
                  Cancel
                </Link>
              </div>
            </form>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <form method="post" action={action} className="flex flex-wrap items-center gap-2">
                <input type="hidden" name="tab" value={tab} />
                {options && (
                  <label className="text-sm text-gray-300 flex items-center gap-2 min-w-0">
                    <span className="shrink-0">Which one?</span>
                    <select name="choice" defaultValue="1" className={`${input} w-auto max-w-[12rem]`}>
                      {options.map((o) => (
                        <option key={o.n} value={String(o.n)}>
                          {o.n}. {o.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <button name="action" value="approve" className={`${btn} bg-emerald-600 text-white hover:bg-emerald-500 px-5`}>
                  Approve
                </button>
              </form>
              {editable && (
                <Link href={`${withEdit(here, a.id)}#a-${a.id}`} className={`${btn} bg-gray-800 text-white hover:bg-gray-700`}>
                  Edit
                </Link>
              )}
              <form method="post" action={action} className="flex items-center gap-2">
                <input type="hidden" name="tab" value={tab} />
                <input type="hidden" name="action" value="reject" />
                <select name="reason" className={`${input} w-auto max-w-[9.5rem]`} aria-label="Why reject (optional)" defaultValue="">
                  <option value="">Why? (optional)</option>
                  <option>Too salesy</option>
                  <option>Wrong person</option>
                  <option>Wrong facts</option>
                  <option>Sounds like a bot</option>
                  <option>Not worth it</option>
                </select>
                <button className={`${btn} bg-gray-900 text-red-200 border border-red-900/60 hover:bg-red-950`}>Reject</button>
              </form>
            </div>
          )}
        </div>
      ) : (
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
      )}
    </article>
  );
}
