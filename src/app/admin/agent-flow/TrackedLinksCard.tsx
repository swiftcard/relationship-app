"use client";

import { useEffect, useState } from "react";

// Agent Flow → Settings → Tracked links. What each social platform actually
// produced, judged the only way that matters: signups. Every platform has one
// link for its bio (swiftcard.me/go/<platform>_bio); the code in the link is
// the signup source, so a tap and the account it becomes share a name.
// Server side: src/app/api/admin/agents/links/route.ts.

type Platform = { prefix: string; name: string; bio_link: string; taps: number; signups: number; trials: number };
type LinkRow = { code: string; label: string; taps: number; signups: number; trials: number };

export default function TrackedLinksCard() {
  const [d, setD] = useState<{ platforms: Platform[]; links: LinkRow[] } | null>(null);
  const [copied, setCopied] = useState("");

  useEffect(() => {
    let off = false;
    fetch("/api/admin/agents/links", { cache: "no-store" }).then((r) => r.json()).then((j) => { if (!off && j?.platforms) setD(j); }).catch(() => {});
    return () => { off = true; };
  }, []);

  async function copy(link: string) {
    try { await navigator.clipboard.writeText(link); setCopied(link); setTimeout(() => setCopied(""), 1500); } catch { /* the link is on screen to select */ }
  }

  if (!d) return null;
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900 p-4 space-y-3">
      <div>
        <p className="text-white text-sm font-semibold">Tracked links — what each platform brought in</p>
        <p className="text-gray-500 text-xs mt-0.5">Put each platform&apos;s link in its bio. A tap opens the card builder, and the signup is recorded under that platform. Last 30 days.</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs text-left">
          <thead className="text-gray-500">
            <tr><th className="py-1 pr-3 font-normal">Platform</th><th className="py-1 pr-3 font-normal">Bio link</th><th className="py-1 px-2 font-normal text-right">Taps</th><th className="py-1 px-2 font-normal text-right">Signups</th><th className="py-1 pl-2 font-normal text-right">Pro trials</th></tr>
          </thead>
          <tbody>
            {d.platforms.map((p) => (
              <tr key={p.prefix} className="border-t border-gray-800 text-gray-300">
                <td className="py-1.5 pr-3 font-semibold text-gray-200">{p.name}</td>
                <td className="py-1.5 pr-3">
                  <button onClick={() => copy(p.bio_link)} title="Copy this link" className="text-blue-400 hover:underline break-all text-left">{copied === p.bio_link ? "Copied ✓" : p.bio_link.replace(/^https:\/\//, "")}</button>
                </td>
                <td className="py-1.5 px-2 text-right tabular-nums">{p.taps}</td>
                <td className="py-1.5 px-2 text-right tabular-nums font-semibold text-white">{p.signups}</td>
                <td className="py-1.5 pl-2 text-right tabular-nums">{p.trials}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {d.links.length > 0 && (
        <details className="text-xs text-gray-400">
          <summary className="cursor-pointer text-gray-300">Every link that was tapped or brought a signup</summary>
          <ul className="mt-1.5 space-y-1">
            {d.links.map((l) => (
              <li key={l.code} className="flex flex-wrap gap-x-3">
                <span className="text-gray-200">{l.label}</span>
                <span>{l.taps} taps</span>
                <span className="text-white">{l.signups} signups</span>
                {l.trials > 0 && <span>{l.trials} Pro trials</span>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
