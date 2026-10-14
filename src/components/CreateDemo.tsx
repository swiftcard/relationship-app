// The Create + side as the marketing replicas show it (/preview and the
// homepage's DashboardDemo): what CreateLinkBox looks like once something is
// linked — a sample signature where every part is a link, the Copy button and
// where it works. Drawn, like every other button in the replicas: nothing is
// uploaded or copied from a marketing page. `href` makes the sample's parts
// real links (the /preview demo has a live demo card to open); without it
// they're plain text.

type Person = { name: string; title?: string; company?: string; phone?: string; email?: string };

/** One piece of the sample, linked like CreateLinkBox links every piece. */
function Part({ href, children, style }: { href?: string; children: React.ReactNode; style: React.CSSProperties }) {
  return href
    ? <a href={href} target="_blank" rel="noopener noreferrer" style={{ ...style, textDecoration: "none" }}>{children}</a>
    : <span style={style}>{children}</span>;
}

export default function CreateDemo({ person, href, as: Heading = "h3" }: { person: Person; href?: string; as?: "h2" | "h3" }) {
  const initials = person.name.split(" ").map((p) => p[0] ?? "").join("").slice(0, 2).toUpperCase();
  return (
    <>
      <div className="mb-4">
        <Heading className="text-base font-semibold text-white">Link anything to your SwiftCard</Heading>
        <p className="text-gray-400 text-sm mt-1 leading-relaxed">
          Paste your email signature or add a picture. The whole thing becomes one clickable link to your SwiftCard.
        </p>
        {/* The same tip block as the real side (app/share/page.tsx). */}
        <p className="mt-3 flex items-start gap-2 rounded-xl bg-blue-500/10 border border-blue-500/20 px-3 py-2.5 text-xs text-gray-400 leading-relaxed">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden className="w-4 h-4 shrink-0 mt-px text-blue-400"><path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 01-.75.75H9a.75.75 0 01-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184" /></svg>
          <span><strong className="text-white font-semibold">Already have a signature?</strong> Copy it from your email and paste it in. Same fonts, same colors, nothing changes.</span>
        </p>
      </div>
      <div className="bg-gray-900 border border-gray-800/80 rounded-2xl p-5">
        <p className="text-gray-500 text-xs mb-3">{href ? "How it looks — click anywhere on it to try your link:" : "How it looks — every part of it opens your SwiftCard:"}</p>
        <div className="rounded-xl border border-gray-700/60 bg-white p-4 overflow-hidden">
          {/* A plain, everyday signature — the kind people already have. */}
          <table cellPadding={0} cellSpacing={0} style={{ fontFamily: "Arial, Helvetica, sans-serif", fontSize: 13, color: "#222222", borderCollapse: "collapse" }}>
            <tbody>
              <tr>
                <td style={{ paddingRight: 12, verticalAlign: "top" }}>
                  <Part href={href} style={{ display: "inline-flex", width: 44, height: 44, borderRadius: 8, background: "#0f2a4a", color: "#ffffff", fontWeight: 700, fontSize: 15, alignItems: "center", justifyContent: "center" }}>{initials}</Part>
                </td>
                <td style={{ borderLeft: "2px solid #c9a24b", paddingLeft: 12, verticalAlign: "top", lineHeight: 1.45 }}>
                  <Part href={href} style={{ color: "#0f2a4a", fontWeight: 700, fontSize: 14 }}>{person.name}</Part><br />
                  {(person.title || person.company) && <><Part href={href} style={{ color: "#555555" }}>{[person.title, person.company].filter(Boolean).join(" · ")}</Part><br /></>}
                  {person.phone && <><Part href={href} style={{ color: "#555555" }}>{person.phone}</Part><br /></>}
                  {person.email && <Part href={href} style={{ color: "#c9a24b" }}>{person.email}</Part>}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <span className="mt-4 block text-center bg-blue-600 text-white font-semibold text-sm py-2.5 rounded-full">Copy</span>
        <div className="mt-3 space-y-1.5 text-[0.6875rem] text-gray-500 leading-relaxed">
          <p><strong className="text-gray-300">Email, Google Docs, Word, Notion, websites:</strong> it pastes just as you see it, and a click anywhere opens your SwiftCard.</p>
          <p><strong className="text-gray-300">Texts and social apps:</strong> it pastes as your link, showing this as its preview. A tap opens your SwiftCard.</p>
        </div>
      </div>
    </>
  );
}
