import type { Dashboard, Room } from "@/lib/crew/dashboard";
import { StaffBoard } from "./Staff";
import { Waiting } from "./TeamRoom";
import { Avatar, btn, card, input, nyTime } from "./ui";

// Your desk: Hannah's plan for tomorrow and her questions, and the in-tray
// where you hand the team a post they can't read on their own.

function Plan({ d }: { d: Dashboard }) {
  const plan = d.reports.find((r) => r.agent_id === "head");
  return (
    <section className={`${card} space-y-2`} aria-labelledby="plan">
      <div className="flex items-center gap-2.5">
        <Avatar name="Hannah" team="system" size="sm" />
        <h2 id="plan" className="text-white font-semibold">
          Hannah&apos;s plan for tomorrow
        </h2>
      </div>
      {plan ? (
        <>
          <p className="text-gray-500 text-xs">{nyTime(plan.created_at)}</p>
          <pre className="text-gray-200 text-sm whitespace-pre-wrap break-words font-sans">{plan.body}</pre>
        </>
      ) : (
        <p className="text-gray-400 text-sm">No plan yet. Once Hannah is on the team, she reads the managers&apos; morning reports and writes one here at 7:45am.</p>
      )}
    </section>
  );
}

function HandOff() {
  return (
    <form id="hand-off" method="post" action="/api/admin/crew/paste" className={`${card} space-y-3 scroll-mt-20`}>
      <h2 className="text-white font-semibold">Hand something to the team</h2>
      <p className="text-gray-400 text-sm">
        For places the team can&apos;t read on its own (Facebook groups, Alignable, Instagram and LinkedIn posts). Paste what you saw and the right person drafts from it on their next shift: Facebook goes to
        Fiona (Replies), Alignable to Alan (Contact), the rest to whoever covers that site.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="text-sm text-gray-300 space-y-1">
          <span>Where is it from?</span>
          <select name="platform" className={input} defaultValue="facebook">
            <option value="facebook">Facebook group</option>
            <option value="alignable">Alignable</option>
            <option value="instagram">Instagram</option>
            <option value="linkedin">LinkedIn</option>
            <option value="threads">Threads</option>
            <option value="bluesky">Bluesky</option>
            <option value="quora">Quora</option>
            <option value="indiehackers">Indie Hackers</option>
            <option value="reddit">Reddit</option>
            <option value="web">Somewhere else</option>
          </select>
        </label>
        <label className="text-sm text-gray-300 space-y-1">
          <span>What is it?</span>
          <select name="kind" className={input} defaultValue="post">
            <option value="post">A post</option>
            <option value="profile">A person&apos;s profile</option>
            <option value="page">A business page</option>
          </select>
        </label>
      </div>
      <label className="block text-sm text-gray-300 space-y-1">
        <span>Link (optional)</span>
        <input name="url" type="url" inputMode="url" className={input} placeholder="https://" />
      </label>
      <label className="block text-sm text-gray-300 space-y-1">
        <span>The text</span>
        <textarea name="text" rows={7} required minLength={20} className={input} placeholder="Paste the post, including the person's name or handle" />
      </label>
      <button className={`${btn} bg-blue-600 text-white hover:bg-blue-500`}>Hand it over</button>
    </form>
  );
}

export default function FrontDesk({ d, room }: { d: Dashboard; room: Room }) {
  return (
    <div className="space-y-5">
      <header className={card}>
        <h2 className="text-white text-lg font-bold">Your desk</h2>
        <p className="text-gray-400 text-sm mt-0.5">{room.job} Only &quot;Lock the whole office&quot; stops the desk.</p>
      </header>
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_22rem] gap-5 items-start">
        <div className="space-y-5 min-w-0">
          <Plan d={d} />
          <Waiting room={room} tab="desk" />
          <HandOff />
        </div>
        <div className="min-w-0">
          <StaffBoard room={room} tab="desk" economy={d.settings.economy} />
        </div>
      </div>
    </div>
  );
}
