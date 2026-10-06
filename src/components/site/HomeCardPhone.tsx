"use client";

import CardScaler from "@/components/CardScaler";
import ClassicPro from "@/components/card-templates/ClassicPro";
import PhoneFrame from "@/components/PhoneFrame";
import { SAMPLE_DATA, withoutSocials } from "@/components/card-templates/types";
import { cardPageTheme } from "@/lib/card-page-theme";
import DemoSwiftLinks from "./DemoSwiftLinks";

// The homepage's closing panel shows a REAL SwiftCard, not a drawing of one:
// the Classic Professional template (every new card's default) with the demo
// identity, on the live card page's own wash, with the page's first two
// sections — exactly the top of what someone sees when they open a SwiftCard
// link. Markup for the sections is the same as TemplateGallery's
// LinkExperience. Static and aria-hidden: it is a picture of the product.

const CARD = withoutSocials(SAMPLE_DATA);
const FIRST = SAMPLE_DATA.name.split(" ")[0];
const theme = cardPageTheme(null, "classic-pro");
const panel = "w-full rounded-2xl p-4 shadow-sm";
const panelStyle = { background: "#fff", border: "1px solid #E4DDD4" } as const;

export default function HomeCardPhone({ width = 290 }: { width?: number }) {
  return (
    <div aria-hidden="true" className="pointer-events-none select-none">
      <PhoneFrame width={width} glare={false} screenStyle={{ background: theme.pageBackground }}>
        <div className="px-4 pt-2 pb-8 flex flex-col gap-4">
          <div className="rounded-2xl overflow-hidden">
            <CardScaler><ClassicPro data={CARD} /></CardScaler>
          </div>
          <div className={panel} style={panelStyle}>
            <p className="text-slate-900 font-bold text-[0.8125rem] tracking-tight">Save {FIRST}&apos;s contact</p>
            <p className="text-slate-500 text-[0.6875rem] mt-0.5 mb-2.5">One tap adds them to your phone contacts — no app needed.</p>
            <div className="w-full rounded-full py-2.5 text-white text-[0.78125rem] font-bold flex items-center justify-center gap-1.5" style={{ background: theme.accent }}>
              <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2}><path d="M19 21v-8H5v8M5 3h11l3 3v3M9 3v4h6" strokeLinecap="round" strokeLinejoin="round" /></svg>
              Save Contact
            </div>
          </div>
          {/* The page's second section since 2026-09-22: Swift Links (the real
              card section, shared by every mockup), then Share your info. */}
          <div className={panel} style={panelStyle}>
            <DemoSwiftLinks />
          </div>
        </div>
      </PhoneFrame>
    </div>
  );
}
