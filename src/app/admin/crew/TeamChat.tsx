import type { Room } from "@/lib/crew/dashboard";
import { CHAT_MAX_CHARS } from "@/lib/crew/manager-chat";
import type { TimelineItem } from "@/lib/crew/timeline";
import type { TeamId } from "@/lib/crew/types";
import ChatAutoRefresh from "./ChatAutoRefresh";
import { Avatar, btn, card, input, nyTime } from "./ui";

// A group's chat: you and its manager, plus everything the group did this week
// (drafts, your decisions, the morning report, problems), oldest at the top.

const CHIPS: Record<TeamId, string[]> = {
  watchdog: ["How did today go?", "Is anything broken right now?", "What's waiting for me?"],
  replies: ["How did today go?", "What's waiting for me?", "Pause Reddit replies for today"],
  contact: ["How did today go?", "Who are we messaging?", "What's waiting for me?"],
  leads: ["How did today go?", "How many leads did we find today?", "What's waiting for me?"],
  office: ["How did today go?", "Which offices did we find?", "What's waiting for me?"],
  marketing: ["How did today go?", "What's the next blog post?", "What's waiting for me?"],
  system: [],
};

function Item({ it }: { it: TimelineItem }) {
  const time = <span className="text-gray-600 text-[0.6875rem]">{nyTime(it.at)}</span>;
  if (it.kind === "owner") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-blue-600 text-white px-3.5 py-2">
          <p className="text-sm whitespace-pre-wrap break-words">{it.body}</p>
          <p className="text-blue-200/70 text-[0.6875rem] mt-0.5 text-right">You · {nyTime(it.at)}</p>
        </div>
      </div>
    );
  }
  if (it.kind === "manager") {
    return (
      <div className="flex items-end gap-2">
        {it.who && <Avatar name={it.who.first} team={it.who.team} size="sm" />}
        <div className={`max-w-[85%] rounded-2xl rounded-bl-md px-3.5 py-2 ${it.status === "failed" ? "bg-red-500/10 border border-red-900/40" : "bg-gray-800"}`}>
          <p className="text-gray-400 text-[0.6875rem] mb-0.5">Manager</p>
          {it.status === "pending" ? (
            <p className="text-gray-300 text-sm" data-writing>
              writing<span className="animate-pulse">…</span>
            </p>
          ) : (
            <p className={`text-sm whitespace-pre-wrap break-words ${it.status === "failed" ? "text-red-200" : "text-gray-100"}`}>{it.body}</p>
          )}
          <p className="mt-0.5">{time}</p>
        </div>
      </div>
    );
  }
  if (it.kind === "report") {
    return (
      <div className="flex items-start gap-2">
        {it.who && <Avatar name={it.who.first} team={it.who.team} size="sm" />}
        <div className="min-w-0 flex-1 rounded-2xl border border-gray-800 bg-gray-900/60 px-3.5 py-3">
          <p className="text-gray-400 text-xs mb-1.5">
            Daily report · {nyTime(it.at)}
          </p>
          <pre className="text-gray-200 text-sm whitespace-pre-wrap break-words font-sans">{it.body}</pre>
        </div>
      </div>
    );
  }
  if (it.kind === "system") {
    return (
      <p className="text-center text-xs text-gray-400 px-4 break-words">
        {it.body} {time}
      </p>
    );
  }
  return (
    <div className="flex items-start gap-2 px-1">
      {it.who ? <Avatar name={it.who.first} team={it.who.team} size="sm" /> : <span className="h-7 w-7 shrink-0" aria-hidden />}
      <p className={`min-w-0 flex-1 text-xs leading-5 break-words ${it.kind === "alert" ? "text-amber-200/90" : "text-gray-400"}`}>
        {it.body}{" "}
        {it.href && (
          <a href={it.href} className="text-blue-300 hover:underline whitespace-nowrap">
            See it ↑
          </a>
        )}{" "}
        {time}
      </p>
    </div>
  );
}

export default function TeamChat({ room, timeline, tab }: { room: Room; timeline: TimelineItem[]; tab: string }) {
  const name = "the manager";
  const writing = timeline.some((t) => t.kind === "manager" && t.status === "pending");
  return (
    <section id="chat" className={`${card} p-0 overflow-hidden scroll-mt-20`} aria-labelledby={`chat-${room.team}`}>
      <div className="flex items-center gap-2.5 border-b border-gray-800 px-4 py-3">
        {room.manager && <Avatar name="M" team={room.team} size="sm" />}
        <div className="min-w-0">
          <h2 id={`chat-${room.team}`} className="text-white font-semibold text-sm">
            Ask the manager
          </h2>
          <p className="text-gray-500 text-xs">Ask how things went, or ask it to pause one of its agents. The group&apos;s week shows up here too.</p>
        </div>
      </div>
      {/* Reversed column: the newest message sits at the bottom, in view, with no script. */}
      <div className="max-h-[30rem] overflow-y-auto flex flex-col-reverse">
        <div className="space-y-3 px-3 py-4">
          {timeline.length === 0 ? (
            <p className="text-center text-sm text-gray-500 py-6">Nothing here yet this week. Ask {name} anything.</p>
          ) : (
            timeline.map((it) => <Item key={it.key} it={it} />)
          )}
        </div>
      </div>
      <div id="chat-end" className="border-t border-gray-800 p-3 space-y-2 scroll-mt-20">
        {CHIPS[room.team].length > 0 && (
          <form method="post" action={`/api/admin/crew/chat/${room.team}`} className="flex gap-1.5 overflow-x-auto no-scrollbar">
            <input type="hidden" name="tab" value={tab} />
            {CHIPS[room.team].map((c) => (
              <button key={c} name="text" value={c} className="shrink-0 min-h-10 rounded-full border border-gray-700 px-3 text-xs text-gray-300 hover:text-white hover:border-gray-500">
                {c}
              </button>
            ))}
          </form>
        )}
        <form method="post" action={`/api/admin/crew/chat/${room.team}`} className="flex items-end gap-2">
          <input type="hidden" name="tab" value={tab} />
          <label className="sr-only" htmlFor={`chat-text-${room.team}`}>
            Message to {name}
          </label>
          <textarea id={`chat-text-${room.team}`} name="text" rows={2} required maxLength={CHAT_MAX_CHARS} placeholder={`Message ${name}…`} className={`${input} resize-none`} />
          <button className={`${btn} bg-blue-600 text-white hover:bg-blue-500 shrink-0`}>Send</button>
        </form>
      </div>
      <ChatAutoRefresh active={writing} />
    </section>
  );
}
