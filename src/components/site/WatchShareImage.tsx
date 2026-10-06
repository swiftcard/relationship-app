import { MiniQR } from "@/components/card-templates/MiniQR";

// The Apple Watch visual — the product itself, not a photograph.
//
// It replaced Apple's own press shot on 2026-09-11 (their copyright, and it
// showed phone-to-phone NameDrop, which SwiftCard does not do). Rebuilt the
// same day after the owner saw the first version: the watch was too big, the
// QR too small, and "SwiftCard" and the time were being sliced by the screen's
// rounded corners.
//
// WHY THE NUMBERS ARE WHAT THEY ARE
//
// Everything is a percentage of ONE width, so the whole thing scales as a unit
// and nothing can drift at a different rate to anything else:
//
//   • case      1 : 1.19  — the real 45mm case (45mm tall, 38mm wide)
//   • bezel     5.5% of the width on every side
//   • screen    corner radius 27% of its own width, like the hardware
//   • content   inset 13% left and right. That is the width of the corner
//     curve at the height the status row sits at, so the S of "SwiftCard"
//     and the 1 of "9:41" clear the glass instead of being cut by it.
//   • bands     sized by ASPECT RATIO, never a percentage height: this box has
//     no definite height of its own, so a percentage height would resolve
//     against auto and collapse the bands in any layout that did not happen
//     to give the parent a height.
//   • QR        ~78% of the screen WIDTH — the face is mostly code, which is
//     the point of the picture: someone scans it. Measured, not guessed:
//     scripts/qa-sweep and the render suite both walk this component.
//   • rows      every text row keeps >=13% clear of the left and right glass
//     edges and >=5% of the top and bottom. Before this rebuild the S of
//     "SwiftCard" and the 1 of "9:41" were sliced off by the corner curve.
//
// The QR is a real MiniQR pointing at the demo card, so it genuinely scans.
export default function WatchShareImage() {
  return (
    <div
      className="relative w-[180px] sm:w-[208px] select-none"
      role="img"
      aria-label="An Apple Watch showing Alex Morgan's SwiftCard QR code, captioned Scan to connect"
    >
      {/* band, upper */}
      <div
        className="mx-auto aspect-[62/34] w-[62%] rounded-t-[18px]"
        style={{ background: "linear-gradient(180deg, #20242E 0%, #171A22 100%)" }}
        aria-hidden="true"
      />

      {/* case */}
      <div
        className="relative mx-auto w-full aspect-[1/1.19] rounded-[30%/25%] p-[5.5%] -my-[2%]"
        style={{
          background: "linear-gradient(155deg, #464C5C 0%, #1A1E27 48%, #333846 100%)",
          boxShadow: "var(--rd-sh-lg), inset 0 1px 0 rgba(255,255,255,.22)",
        }}
      >
        {/* digital crown + side button */}
        <div className="absolute -right-[3.5%] top-[26%] h-[15%] w-[4%] rounded-r-[3px]" style={{ background: "linear-gradient(90deg, #2B303B, #565C6C)" }} aria-hidden="true" />
        <div className="absolute -right-[2.5%] top-[47%] h-[20%] w-[2.5%] rounded-r-[3px]" style={{ background: "#2B303B" }} aria-hidden="true" />

        {/* screen */}
        <div className="relative h-full w-full overflow-hidden rounded-[27%/23%] bg-black text-white">
          {/* One inset for every row, so nothing meets the corner curve. */}
          {/* The real watch app's screen (ios/App/SwiftCardWatch/ContentView):
              watchOS's own clock top-right, then the code on a WHITE rounded
              tile filling most of the face, and under it the name and a blue
              "Scan to connect" — which the wearer scrolls to. No app title and
              no name above the code. */}
          <div className="flex h-full w-full flex-col px-[13%] py-[7%]">
            <div className="flex items-baseline justify-end">
              <span className="text-[0.5rem] sm:text-[0.5625rem] font-semibold tabular-nums text-white">9:41</span>
            </div>

            {/* The face is mostly QR — that is the whole story of this picture. */}
            {/* The QR row alone breaks OUT of the 13% inset: at the vertical
                middle of the screen there is no corner curve to clear, so the
                code can run wider than the text rows and still sit on glass. */}
            <div className="-mx-[9%] flex min-h-0 flex-1 items-center justify-center py-[3%]">
              {/* MiniQR draws itself at a FIXED pixel size with inline width/height.
                  The arbitrary-variant overrides below beat those inline styles
                  (Tailwind emits !important), so the code fills this square and
                  scales with the watch instead of sitting at one size. */}
              <div className="aspect-square w-[90%] rounded-[10px] bg-white p-[3.5%] [&>[data-qr]]:!h-full [&>[data-qr]]:!w-full">
                <MiniQR size={128} url="https://swiftcard.me/alexmorgan" fg="#0E1017" />
              </div>
            </div>

            <p className="truncate text-center text-[0.5625rem] sm:text-[0.625rem] font-semibold leading-tight">Alex Morgan</p>
            <p className="mt-[1%] flex items-center justify-center gap-[3px] text-[0.5rem] sm:text-[0.5625rem] font-semibold text-[#4DA8F5]">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} className="w-[1em] h-[1em]" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 8V5a1 1 0 011-1h3M16 4h3a1 1 0 011 1v3M20 16v3a1 1 0 01-1 1h-3M8 20H5a1 1 0 01-1-1v-3" />
              </svg>
              Scan to connect
            </p>
          </div>
        </div>
      </div>

      {/* band, lower */}
      <div
        className="mx-auto aspect-[62/34] w-[62%] rounded-b-[18px]"
        style={{ background: "linear-gradient(180deg, #171A22 0%, #20242E 100%)" }}
        aria-hidden="true"
      />

      {/* the glow it sits in */}
      <div
        className="pointer-events-none absolute left-1/2 top-1/2 -z-10 aspect-square w-[130%] -translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{ background: "radial-gradient(closest-side, rgba(37,99,235,.30), transparent)" }}
        aria-hidden="true"
      />
    </div>
  );
}
