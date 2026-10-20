// ── Minimal markdown → HTML for blog posts ───────────────────────────────────
// Input is ADMIN-APPROVED content only (posts are reviewed before they are
// published), so this renderer favors simplicity: it escapes
// everything first, then re-introduces a fixed whitelist of constructs.
// No raw HTML passes through — <script> in a post renders as text.

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function inline(s: string): string {
  return s
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    // Links: same-site paths and https only.
    // Quotes and angle brackets are excluded from the URL class so a crafted
    // link can never break out of the href attribute — the author is an LLM
    // reading the open web, which makes markdown a prompt-injection surface
    // even though every post is human-reviewed before publish.
    .replace(/\[([^\]]+)\]\((\/[^)\s"'<>]*|https:\/\/[^)\s"'<>]+)\)/g, '<a href="$2">$1</a>');
}

export function renderBlogMarkdown(md: string): string {
  const lines = esc(md.replace(/\r/g, "")).split("\n");
  const out: string[] = [];
  let list: "ul" | "ol" | null = null;
  let table: string[][] | null = null;
  const closeList = () => { if (list) { out.push(`</${list}>`); list = null; } };
  const flushTable = () => {
    if (!table) return;
    const [head, ...rows] = table.filter((r) => !r.every((c) => /^:?-+:?$/.test(c.trim())));
    out.push('<div class="overflow-x-auto"><table><thead><tr>' + head.map((c) => `<th>${inline(c)}</th>`).join("") + "</tr></thead><tbody>" +
      rows.map((r) => "<tr>" + r.map((c) => `<td>${inline(c)}</td>`).join("") + "</tr>").join("") + "</tbody></table></div>");
    table = null;
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (/^\|.*\|$/.test(line.trim())) { closeList(); (table ??= []).push(line.trim().slice(1, -1).split("|")); continue; }
    flushTable();
    const h = line.match(/^(#{1,4})\s+(.*)/);
    if (h) { closeList(); out.push(`<h${h[1].length + 1}>${inline(h[2])}</h${h[1].length + 1}>`); continue; } // h1 in md → h2 (page owns the h1)
    const li = line.match(/^[-*]\s+(.*)/);
    if (li) { if (list !== "ul") { closeList(); out.push("<ul>"); list = "ul"; } out.push(`<li>${inline(li[1])}</li>`); continue; }
    const ol = line.match(/^\d+\.\s+(.*)/);
    if (ol) { if (list !== "ol") { closeList(); out.push("<ol>"); list = "ol"; } out.push(`<li>${inline(ol[1])}</li>`); continue; }
    if (line.startsWith("&gt; ")) { closeList(); out.push(`<blockquote>${inline(line.slice(5))}</blockquote>`); continue; }
    if (!line.trim()) { closeList(); continue; }
    closeList();
    out.push(`<p>${inline(line)}</p>`);
  }
  closeList(); flushTable();
  return out.join("\n");
}
