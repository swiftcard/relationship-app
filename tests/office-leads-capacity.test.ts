import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8");
/** Source with comments removed — these files EXPLAIN what was taken out. */
const code = (p: string) =>
  read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const lib = read("src/lib/office-leads.ts");

// ── The team Leads tab told the truth about 600 leads and no more ───────────
//
// Two queries, each .limit(300), merged and de-duplicated in memory. So the
// page printed "600 so far" permanently once an office passed it, the Team
// tab's per-person counts were EXACT and uncapped (two adjacent tabs
// disagreeing with no way to reconcile), there was no export anywhere in the
// console, and — the part nobody had noticed — a lead past the cap could not
// be marked contacted at all, because the ownership check looked for it in
// that same truncated list.

describe("one query, an exact total, and real paging", () => {
  it("matches current-team and departed-member leads in a single filter", () => {
    expect(lib).toContain("function officeLeadFilter(");
    expect(lib).toMatch(/card_owner\.in\.\(\$\{safe\.join\(","\)\}\),\$\{byTag\}/);
  });

  it("survives an office whose members have no slugs yet", () => {
    // `in.()` with an empty list is not valid PostgREST — it would throw and
    // take the whole Leads tab with it.
    expect(lib).toMatch(/return safe\.length \? .* : byTag;/);
  });

  it("asks the database for an exact count, not the length of a page", () => {
    expect(lib).toMatch(/\.select\(select, \{ count: "exact" \}\)/);
    expect(lib).toMatch(/const total = count \?\? leads\.length;/);
    expect(lib).toMatch(/hasMore: offset \+ leads\.length < total/);
  });

  it("pages with range, and bounds what a caller can ask for", () => {
    expect(lib).toMatch(/\.range\(offset, offset \+ limit - 1\)/);
    // A hand-crafted ?limit=100000 must not become a 100k-row read.
    expect(lib).toMatch(/Math\.min\(Math\.max\(1, Math\.floor\(opts\.limit \?\? OFFICE_LEADS_PAGE\)\), 500\)/);
    expect(lib).toMatch(/Math\.max\(0, Math\.floor\(opts\.offset \?\? 0\)\)/);
  });

  it("refuses to interpolate a slug that could widen the filter", () => {
    // The filter is a STRING, and it is the boundary between one office's
    // leads and another's. Every slug in the database is [a-z0-9-] today
    // (normalizeSlug), but a legacy import or hand-inserted row containing a
    // comma or paren would not break the query — it would silently broaden it.
    expect(lib).toMatch(/const SAFE_SLUG = \/\^\[a-z0-9-\]\+\$\//);
    expect(lib).toMatch(/slugs\.filter\(\(s\) => SAFE_SLUG\.test\(s\)\)/);
    // And the sanitised list, not the raw one, is what gets joined.
    expect(lib).toMatch(/safe\.length \? `card_owner\.in\.\(\$\{safe\.join\(","\)\}\)/);
  });

  it("no longer caps at 300", () => {
    expect(lib).not.toMatch(/\.limit\(300\)/);
  });
});

// ── The CRM status is gone, and so is everything that served it ─────────────
//
// New / Contacted / Closed / Not interested, plus a "Mark contacted" button and
// an uncontacted counter, all removed 2026-09-11. The owner asked what the
// statuses connected to and the answer was nothing: two of the four had no
// writer anywhere in the product, the one an admin could set showed up on no
// other screen, and the teammate who owns the contact never saw any of it.
//
// The column now shows the contact's FOLLOW-UP state, derived from what their
// automations are actually doing — the same thing that teammate sees on the
// contact itself. Nothing to mark, nothing to keep in sync.
describe("nothing on the leads table is a status an admin has to maintain", () => {
  it("the status setter and its route are gone", () => {
    expect(lib).not.toContain("officeOwnsLead");
    expect(existsSync(join(root, "src/app/api/office/leads/[id]/route.ts"))).toBe(false);
    const table = code("src/app/office/admin/leads/LeadsTable.tsx");
    expect(table).not.toMatch(/Mark contacted/);
    expect(table).not.toMatch(/setLeadStatus/);
  });

  it("so is the counter that depended on it", () => {
    expect(lib).not.toContain("getOfficeUncontactedLeadCount");
    expect(lib).not.toContain("WORKED_STATUS_VALUES");
  });

  it("none of the four orphan labels is offered anywhere on the table", () => {
    const table = code("src/app/office/admin/leads/LeadsTable.tsx");
    for (const label of ["Contacted", "Closed", "Not interested", "Any status", "nobody has followed up yet"]) {
      expect(table, `"${label}" is still on the leads table`).not.toContain(label);
    }
  });

  it("the follow-up state is derived from the row, never stored", () => {
    expect(lib).toContain("followUp: followUpState(");
    expect(lib).toMatch(/follow_up_sequence/);
    const followup = code("src/lib/lead-followup.ts");
    // Pure: no database, nothing to set.
    expect(followup).not.toMatch(/supabase|admin|fetch\(/i);
    expect(followup).toContain("export function followUpState(");
  });
});

describe("export takes everything", () => {
  const route = read("src/app/api/office/leads/export/route.ts");

  it("pages through rather than taking a slice", () => {
    expect(lib).toContain("export async function getAllOfficeLeads(");
    expect(route).toContain("getAllOfficeLeads(ctx.officeId)");
  });

  it("resolves the team once for the whole export, not once per page", () => {
    // officeSlugMap costs five queries and its answer cannot change mid-export;
    // twenty thousand leads is forty pages, so re-deriving it per page is two
    // hundred round trips spent re-answering the same question.
    const fn = lib.slice(lib.indexOf("export async function getAllOfficeLeads"));
    expect(fn).toMatch(/const bySlug = await officeSlugMap\(officeId\);/);
    expect(fn).toMatch(/fetchLeadPage\(officeId, bySlug,/);
    expect(fn, "the export is resolving the team inside the loop again").not.toMatch(/await getOfficeLeads\(/);
  });

  it("de-duplicates the export too", () => {
    // A lead captured mid-export shifts later rows down; a CSV with a row
    // twice is worse than one built a moment earlier.
    const fn = lib.slice(lib.indexOf("export async function getAllOfficeLeads"));
    expect(fn).toContain("seen.has(l.id)");
  });

  it("is gated on the same capability as the Leads tab", () => {
    // requireOfficeCapability also re-checks the owner is still on a paid
    // Office plan, so a lapsed office cannot export its team's contacts.
    // userId: the session, or the iOS app's one-minute download token for
    // exactly this path (resolveDownloadUserId), as the Analytics export does.
    expect(route).toContain('resolveDownloadUserId(req, "/api/office/leads/export")');
    expect(route).toContain('requireOfficeCapability(userId, "view_org_analytics")');
    expect(route).toMatch(/status: 401/);
    expect(route).toMatch(/status: 403/);
  });

  it("never trusts a client-supplied office id", () => {
    expect(route).toContain("ctx.officeId");
    expect(route).not.toMatch(/searchParams\.get\("office/);
  });

  it("defuses spreadsheet formula injection, like the personal export", () => {
    // Every lead field is typed by whoever filled in the public form.
    expect(route).toMatch(/\/\^\[=\+\\-@\\t\\r\]\//);
    expect(route).toMatch(/replace\(\/"\/g, '""'\)/);
  });

  it("writes the person's name and the same follow-up label the table shows", () => {
    expect(route).toContain("esc(l.capturedBy)");
    expect(route).toContain("FOLLOW_UP_COPY[l.followUp].label");
    expect(route).toContain("Name,Email,Phone,Captured by,Follow-up,Date added");
  });

  it("is never cached — it is a snapshot of live customer data", () => {
    expect(route).toMatch(/"Cache-Control": "no-store"/);
  });
});

describe("the paging route", () => {
  const route = read("src/app/api/office/leads/list/route.ts");

  it("resolves the office from the session, not the query string", () => {
    expect(route).toContain('requireOfficeCapability(user.id, "view_org_analytics")');
    expect(route).toContain("getOfficeLeads(ctx.officeId");
  });

  it("treats a junk offset as zero rather than throwing", () => {
    expect(route).toMatch(/Number\.isFinite\(raw\) && raw > 0 \? Math\.floor\(raw\) : 0/);
  });
});

describe("the table says what is on screen and what is not", () => {
  const table = read("src/app/office/admin/leads/LeadsTable.tsx");
  const page = read("src/app/office/admin/leads/page.tsx");

  it("the header shows the EXACT total, not the loaded count", () => {
    expect(page).toMatch(/page\.total \? ` — \$\{page\.total\.toLocaleString\(\)\} so far`/);
    expect(table).toMatch(/Showing \$\{rows\.length\.toLocaleString\(\)\} of \$\{knownTotal\.toLocaleString\(\)\} contacts/);
  });

  it("offers Load more with how many remain", () => {
    expect(table).toMatch(/Load more — \$\{Math\.max\(0, knownTotal - rows\.length\)\.toLocaleString\(\)\} to go/);
  });

  it("advances the offset by what the SERVER returned, not by rows kept", () => {
    // rows.length shrinks whenever a duplicate is dropped, so using it rewinds
    // the window and re-requests rows already on screen. Modelled with four
    // leads arriving mid-scroll, that left the list stuck at four rows through
    // five consecutive "Load more" clicks — the button looks broken exactly
    // when the office is busiest.
    expect(table).toContain("const [serverOffset, setServerOffset]");
    expect(table).toMatch(/offset=\$\{serverOffset\}/);
    expect(table).toMatch(/setServerOffset\(\(o\) => o \+ page\.leads\.length\)/);
    expect(table, "the offset is back to rows.length").not.toMatch(/offset=\$\{rows\.length\}/);
  });

  it("refreshes the total from each page rather than quoting first render", () => {
    expect(table).toContain("setKnownTotal(page.total)");
  });

  it("de-duplicates appended pages", () => {
    // A lead captured between two page loads shifts every later row down by
    // one, which would otherwise render a row twice.
    expect(table).toMatch(/const seen = new Set\(rs\.map\(\(r\) => r\.id\)\)/);
    expect(table).toMatch(/page\.leads\.filter\(\(l\) => !seen\.has\(l\.id\)\)/);
  });

  it("keeps the list on a failed page load and offers a retry", () => {
    expect(table).toContain("setLoadError(true)");
    expect(table).toMatch(/Your list is still here/);
  });

  it("does not claim 'nothing matches' while pages are unfetched", () => {
    // The filters only see loaded rows, so that would be a lie.
    expect(table).toMatch(/Nothing on this page matches those filters/);
  });

  it("builds the person filter from loaded rows, so it grows as pages arrive", () => {
    expect(table).toMatch(/new Set\(rows\.map\(\(l\) => l\.capturedBy\)\)/);
  });

  it("downloads the export through DownloadLink, not fetch or next/link", () => {
    // The browser handles the download and the Content-Disposition filename,
    // and inside the iOS shell WKWebView cannot save an attachment at all —
    // DownloadLink opens it in the system browser sheet there instead of
    // leaving a dead tap. Same component the personal contacts export uses.
    expect(table).toMatch(/<DownloadLink[\s\S]{0,300}href="\/api\/office\/leads\/export"/);
    expect(table).toContain('import DownloadLink from "@/components/DownloadLink"');
  });
});
