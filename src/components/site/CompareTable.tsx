import NativeHidden from "@/components/NativeHidden";

// ── The two-column SwiftCard-vs-them table ───────────────────────────────────
//
// /compare/<x>-alternative and /compare/swiftcard-vs-<x> render the same
// table: a label column, a SwiftCard column in brand blue, a competitor column
// in grey. One component so the glyph rules (a ✓ is green with a text
// equivalent, a ✗ is visible and announced as "No") and the phone swipe hint
// stay identical on every comparison page.
//
// Honesty rule carried in the data, not here: a competitor cell is ✓, ✗ only
// when their official site confirms it, otherwise "Not listed". Rows that
// quote OUR price are flagged `pricing` and dropped inside the native shell
// (App Review 3.1.1: the iOS app must not show our pricing).

export type CompareRow = { label: string; swiftcard: string; them: string; pricing?: true };

export function CompareCell({ value, brand }: { value: string; brand?: boolean }) {
  const isCheck = value.startsWith("✓");
  const isCross = value.startsWith("✗");
  const isUnknown = value === "Not listed";
  return (
    <td className={`px-4 py-4 text-sm text-center align-middle ${brand ? "font-semibold" : "text-slate-600"}`} style={brand ? { color: "#1D4ED8" } : undefined}>
      {/* The glyph is the answer, so it gets a text equivalent and a shade you
          can actually see (✗ was slate-300, ~1.6:1). */}
      {isCross ? (
        <span>
          <span aria-hidden="true" className="text-slate-500">✗</span>
          <span className="sr-only">No</span>
          {value.length > 1 ? <span className="text-slate-500 text-xs"> {value.slice(1).trim()}</span> : null}
        </span>
      ) : isCheck ? (
        <span>
          <span aria-hidden="true" className="text-green-600 text-base">✓</span>
          <span className="sr-only">Yes</span>
          {value.length > 1 ? <span className="text-slate-500 text-xs"> {value.slice(1).trim()}</span> : null}
        </span>
      ) : isUnknown ? (
        // "Not listed" means their public site does not say — neither a yes
        // nor a no. Quieter than a claim, on purpose.
        <span className="text-slate-400 text-xs italic">Not listed</span>
      ) : value}
    </td>
  );
}

export default function CompareTable({ competitor, rows, minWidth = 520 }: { competitor: string; rows: CompareRow[]; minWidth?: number }) {
  return (
    <>
      {/* Phones: the table is wider than the screen, so say it swipes and
          fade the cut edge — without this the competitor columns are simply
          invisible on a phone (owner mobile pass, 2026-09-17). */}
      <p className="sm:hidden mb-2 flex items-center gap-1.5 text-[0.8125rem] font-medium text-slate-500">
        Swipe the table to compare
        <span aria-hidden="true">→</span>
      </p>
      <div className="relative">
        <div className="relative overflow-x-auto rounded-3xl border border-slate-200 bg-white shadow-[0_18px_40px_-28px_rgba(15,23,42,0.3)]">
          <table className="w-full border-collapse" style={{ minWidth }}>
            <thead>
              <tr className="border-b border-slate-200">
                <th className="px-4 py-4 text-left text-sm font-semibold text-slate-900 w-2/5">&nbsp;</th>
                <th className="px-4 py-4 text-sm font-bold text-center" style={{ color: "#1D4ED8" }}>SwiftCard</th>
                <th className="px-4 py-4 text-sm font-semibold text-slate-500 text-center">{competitor}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => {
                const tr = (
                  <tr key={row.label} className={i % 2 === 1 ? "bg-[#F5F7FB]" : ""}>
                    <td className="px-4 py-4 text-sm font-medium text-slate-700">{row.label}</td>
                    <CompareCell value={row.swiftcard} brand />
                    <CompareCell value={row.them} />
                  </tr>
                );
                // Rows quoting OUR price are dropped inside the native shell (3.1.1).
                return row.pricing ? <NativeHidden key={row.label}>{tr}</NativeHidden> : tr;
              })}
            </tbody>
          </table>
        </div>
        {/* the cut edge, faded so it reads as "there is more" */}
        <span className="sm:hidden pointer-events-none absolute inset-y-0 right-0 w-10 rounded-r-3xl" style={{ background: "linear-gradient(90deg, rgba(255,255,255,0) 0%, #ffffff 92%)" }} aria-hidden="true" />
      </div>
    </>
  );
}
