import Link from "next/link";
import { renderBlogMarkdown } from "@/lib/blog-md";
import type { BlogBatch, BlogDraft, BlogLogEntry, MarketResearch } from "@/lib/crew/blog/writer";
import ChatAutoRefresh from "../ChatAutoRefresh";
import { Badge, btn, card } from "../ui";

// ── The Blog Writer's page ──────────────────────────────────────────────────
// Owner, 2026-10-29: "I click Generate ... It'll generate me two posts and
// show me those exact two blog posts and I will click the one that I want.
// When I click one, it posts it on our blog." Each post is shown exactly as
// the blog will render it (the same renderer), with how Google would show it.
// Every button is a plain form post, so it works before hydration.

const FORM = "/api/admin/crew/blog";
// The blog page's own article styles, so the preview reads like the real post.
const BODY = "text-gray-200 text-[1rem] leading-[1.8] [&_h2]:text-xl [&_h2]:font-bold [&_h2]:text-white [&_h2]:mt-8 [&_h2]:mb-3 [&_h3]:text-lg [&_h3]:font-semibold [&_h3]:text-white [&_h3]:mt-6 [&_h3]:mb-2 [&_p]:mb-4 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:mb-4 [&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:mb-4 [&_li]:mb-1 [&_a]:text-blue-300 [&_a]:underline [&_table]:w-full [&_table]:text-sm [&_table]:my-5 [&_th]:text-left [&_th]:font-semibold [&_th]:border-b [&_th]:border-gray-700 [&_th]:py-2 [&_td]:py-2 [&_td]:border-b [&_td]:border-gray-800 [&_blockquote]:border-l-2 [&_blockquote]:border-blue-400 [&_blockquote]:pl-4 [&_blockquote]:text-gray-400";

const ago = (iso: string, now: number) => {
  const m = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
  return m < 1 ? "just now" : m === 1 ? "a minute ago" : `${m} minutes ago`;
};
const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", year: "numeric" });

function Publish({ batch, index }: { batch: BlogBatch; index: number }) {
  return (
    <form method="post" action={FORM}>
      <input type="hidden" name="action" value="publish" />
      <input type="hidden" name="batch" value={batch.id} />
      <input type="hidden" name="index" value={String(index)} />
      <button className={`${btn} bg-emerald-600 text-white hover:bg-emerald-500 min-h-11 px-5 text-base font-semibold`}>Publish this one</button>
    </form>
  );
}

function Draft({ batch, d, index }: { batch: BlogBatch; d: BlogDraft; index: number }) {
  return (
    <article className={`${card} space-y-5`} aria-labelledby={`draft-${index}`} data-blog-draft={index}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="blue">Option {index + 1}</Badge>
          <Badge>{d.keyword}</Badge>
          <span className="text-xs text-gray-400">{d.words.toLocaleString("en-US")} words · for {d.reader}</span>
        </div>
        <Publish batch={batch} index={index} />
      </div>
      {/* How it would look on Google. */}
      <div className="rounded-xl bg-white px-4 py-3" aria-label="How it would look in Google">
        <p className="text-xs text-[#202124]">swiftcard.me › blog › {d.slug}</p>
        <p className="text-[1.125rem] leading-snug text-[#1a0dab] mt-0.5">{d.title}</p>
        <p className="text-sm text-[#4d5156] mt-1">{d.description}</p>
      </div>
      {d.problems.length > 0 && (
        <p className="rounded-lg border border-amber-700/60 bg-amber-950/40 px-3 py-2 text-sm text-amber-200">Worth a look before publishing: {d.problems.join("; ")}.</p>
      )}
      <h2 id={`draft-${index}`} className="text-2xl sm:text-3xl font-bold text-white leading-tight">{d.title}</h2>
      <div className={BODY} dangerouslySetInnerHTML={{ __html: renderBlogMarkdown(d.content_md) }} />
      <div className="flex justify-end border-t border-gray-800 pt-4">
        <Publish batch={batch} index={index} />
      </div>
    </article>
  );
}

export default function BlogWriterView({ batch, log, posts, research, msg, tone, now }: {
  batch: BlogBatch | null;
  log: BlogLogEntry[];
  posts: { slug: string; title: string; published_at: string | null }[];
  research: MarketResearch | null;
  msg?: string;
  tone?: string;
  now: number;
}) {
  const writing = batch?.status === "writing";
  const ready = batch?.status === "ready" && batch.drafts.length === 2;
  const mine = new Set(log.map((l) => l.slug));
  return (
    <div className="space-y-6 max-w-4xl">
      <div className="space-y-2">
        <Link href="/admin/crew" className="text-sm text-gray-400 hover:text-white">← Agents</Link>
        <h1 className="text-2xl font-bold text-white">Blog Writer</h1>
        <p className="text-gray-400 text-sm max-w-2xl">
          Press Generate and it researches the market and what ranks on Google, then writes two posts built to rank and to make the case for SwiftCard. Read both, publish the one you like, and it goes live on swiftcard.me/blog. It never posts on its own, and it never writes the same topic twice.
        </p>
      </div>

      {msg && <p role="status" className={`rounded-lg px-3 py-2 text-sm ${tone === "err" ? "border border-red-800 bg-red-950/40 text-red-200" : "border border-emerald-800 bg-emerald-950/40 text-emerald-200"}`}>{msg}</p>}

      <section className={`${card} flex flex-col sm:flex-row sm:items-center justify-between gap-4`} aria-label="Generate">
        <div className="text-sm text-gray-300">
          {writing ? (
            <>
              <p className="font-semibold text-white">Writing two posts…</p>
              <p className="mt-1">{batch.step || "Starting"} · started {ago(batch.started_at, now)}. This page updates on its own.</p>
            </>
          ) : ready ? (
            <p>Two posts are ready below. Publish one, or discard both and generate again.</p>
          ) : (
            <p>About 3 to 5 minutes, and around a dollar of AI each time.</p>
          )}
        </div>
        <div className="flex gap-2">
          {ready && (
            <form method="post" action={FORM}>
              <input type="hidden" name="action" value="discard" />
              <button className={`${btn} bg-gray-900 border border-gray-700 text-white hover:bg-gray-800`}>Discard both</button>
            </form>
          )}
          <form method="post" action={FORM}>
            <input type="hidden" name="action" value="generate" />
            <button disabled={writing || ready} className={`${btn} min-h-11 px-6 text-base font-semibold bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed`}>
              {writing ? "Writing…" : "Generate"}
            </button>
          </form>
        </div>
      </section>
      <ChatAutoRefresh active={writing} everyMs={5000} forMs={15 * 60_000} />

      {batch?.status === "failed" && batch.error && (
        <p className="rounded-lg border border-red-800 bg-red-950/40 px-3 py-2 text-sm text-red-200">The last Generate didn&apos;t finish: {batch.error}</p>
      )}
      {batch?.status === "published" && batch.published && (
        <p className="rounded-lg border border-emerald-800 bg-emerald-950/40 px-3 py-2 text-sm text-emerald-200">
          Live now: <a href={`/blog/${batch.published.slug}`} target="_blank" rel="noopener noreferrer" className="underline">{batch.published.title}</a>
        </p>
      )}

      {ready && batch.drafts.map((d, i) => <Draft key={d.slug} batch={batch} d={d} index={i} />)}

      <section className={`${card} space-y-3`} aria-labelledby="blog-log">
        <h2 id="blog-log" className="text-white font-bold">Posted so far ({posts.length})</h2>
        {posts.length === 0 ? (
          <p className="text-sm text-gray-400">Nothing on the blog yet.</p>
        ) : (
          <ul className="divide-y divide-gray-800">
            {posts.map((p) => (
              <li key={p.slug} className="py-2 flex flex-wrap items-center justify-between gap-2">
                <a href={`/blog/${p.slug}`} target="_blank" rel="noopener noreferrer" className="text-sm text-gray-200 hover:text-white hover:underline">{p.title}</a>
                <span className="text-xs text-gray-500">{mine.has(p.slug) ? "Blog Writer · " : ""}{p.published_at ? day(p.published_at) : ""}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <details className={card}>
        <summary className="cursor-pointer text-sm font-semibold text-white">What it knows about the market</summary>
        <div className="mt-3 space-y-2 text-sm text-gray-300">
          <p>A standing brief on the market, the competitors (Linktree, Popl, Blinq, HiHello, Mobilo, Linq, Dot, Link.me, Beacons, paper cards) and who buys. On top of it, live research {research ? `from ${day(research.at)} (${research.sources.length} sources), refreshed every two weeks` : "the first time you press Generate, refreshed every two weeks"}, plus a fresh look at what ranks for each post&apos;s search.</p>
          {research?.notes && <pre className="whitespace-pre-wrap text-xs text-gray-400 max-h-80 overflow-auto">{research.notes}</pre>}
        </div>
      </details>
    </div>
  );
}
