"use client";

import WalletPassFace, { type WalletPassCard } from "@/components/WalletPassFace";
import PhoneFrame, { StatusBar, phoneScreenWidth } from "@/components/PhoneFrame";
import CardScaler from "@/components/CardScaler";
import InertPreview from "@/components/InertPreview";
import ClassicPro from "@/components/card-templates/ClassicPro";
import { SAMPLE_DATA, withoutSocials } from "@/components/card-templates/types";

// Two white-screen iPhones showing the ways to share a SwiftCard:
//   1) Apple Wallet — the real PASS, credit cards tucked below
//   2) Share sheet — the iOS share button + full share sheet
// Everything is static/illustrative. (There used to be a third phone showing
// the QR modal; the pass face already carries the QR, so it said nothing the
// Wallet phone doesn't — owner cut it 2026-08-14.)

const CARD_URL = "https://swiftcard.me/alexmorgan";

// The demo card, in the shape the pass generator reads. WalletPassFace derives
// the colours and the band layout from this exactly as the real pass does, so
// what this mock shows is what the download produces.
const PASS_CARD: WalletPassCard = {
  name: "Alex Morgan",
  title: "Realtor®",
  company: "Coastline Realty",
  phone: "(415) 555-0188",
  email: "alex@coastline.com",
  // The same demo headshot the rest of the marketing site uses for Alex,
  // pre-cropped square on her face. The full-frame demo-girl.jpg centres on
  // her collar, so a circular crop of it cuts her chin off — real uploads come
  // through ImageUpload shape="circle" already face-centred, so the crop makes
  // this behave like a real one instead of teaching the renderer a special case.
  photoUrl: "/marketing/demo-girl-face.jpg",
  template: "classic-pro",
  cardUrl: CARD_URL,
};

// The card page sitting behind the share sheet, and the thumbnail inside it —
// the real template with the site's demo identity.
const PAGE_CARD = withoutSocials(SAMPLE_DATA);

const TUCKED = [
  { grad: "linear-gradient(120deg,#1a1a2e,#3a3a5c)", tail: "2084", network: "VISA" },
  { grad: "linear-gradient(120deg,#0f766e,#0e7490)", tail: "7731", network: "amex" },
  { grad: "linear-gradient(120deg,#c2410c,#ea580c)", tail: "0090", network: "MC" },
];

function Phone({ label, labelClass, children }: { label: string; labelClass: string; children: React.ReactNode }) {
  return (
    <div className="shrink-0 flex flex-col items-center gap-3.5 snap-center">
      {/* One shared iPhone for the whole site — see components/PhoneFrame.
          The Island used to be hand-sized here (48x18 on a 240px phone); the
          frame derives it from the real 125x37pt proportion instead, so this
          phone and the 340px one down the page are the same device. */}
      <PhoneFrame width={240} statusBar={false} screenStyle={{ height: 500, background: "#FFFFFF" }}>
        <div className="absolute inset-0 flex flex-col">{children}</div>
      </PhoneFrame>
      <span className={`${labelClass} text-[0.8125rem] font-semibold`}>{label}</span>
    </div>
  );
}

// 1 — Apple Wallet
export function WalletScreen() {
  return (
    <>
      <StatusBar width={phoneScreenWidth(240)} />
      <div className="flex items-center justify-between px-4 pt-3">
        <h3 className="text-slate-900 text-[1.625rem] font-bold tracking-tight leading-none">Wallet</h3>
        <span className="w-7 h-7 rounded-full bg-slate-100 flex items-center justify-center text-slate-500">
          <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.4}><path d="M12 5v14M5 12h14" strokeLinecap="round" /></svg>
        </span>
      </div>
      {/* The real pass — the same face the .pkpass download produces, at the
          proportion Wallet shows it: a fixed-size object with pass colour
          filling the middle and the barcode anchored at its bottom.

          Width: the frame is 240 but PhoneFrame's rail and bezel take ~7.8px
          per side, so the SCREEN is ~224. 208 (the old value) was sized
          against the FRAME, so it overflowed past the screen's right edge and
          was clipped by the bezel. Wallet insets a pass by roughly 2.5% of the
          screen per side, which is px-1.5 here — not px-4 — so 194 both fits
          and matches. justify-center keeps it centered rather than silently
          overflowing if either number is ever touched again.

          Height: measured against a real 375pt storeCard — header ~40 + strip
          144 + fields ~44 + barcode block ~194 = ~422pt, so about 1.13x the
          width, not the 1.64x this started at. 219 is that ratio. */}
      <div className="px-1.5 pt-4 flex justify-center">
        <WalletPassFace card={PASS_CARD} width={194} height={219} />
      </div>

      <div className="flex-1" />

      {/* Credit cards tucked at the bottom, running OFF the screen edge the
          way Wallet's stack does — every card a sliver, none shown whole. The
          negative margin pushes the stack past the screen bottom; the frame's
          screen has overflow:hidden, which clips it. */}
      {/* px-3 puts the stack on exactly the pass's left and right edges: the
          pass is 194 centred in a 206 box, so it sits 12px in from the screen
          — matching that here is what makes the two read as one stack rather
          than two differently-sized objects. */}
      <div className="px-3 relative" style={{ marginBottom: -28 }}>
        {TUCKED.map((c, i) => (
          <div
            key={c.tail}
            className="rounded-[16px] shadow-[0_-4px_14px_-6px_rgba(0,0,0,0.35)]"
            // z-index ASCENDS: each card sits in FRONT of the one above it, so
            // what shows of every card is its TOP strip — which is where the
            // label row lives, and how Wallet actually stacks. It descended
            // before, so each card covered the label of the card above it.
            style={{ background: c.grad, marginTop: i === 0 ? 0 : -42, height: 62, zIndex: 10 + i }}
          >
            {/* Only the top ~20px of each card shows; the label row must fit
                inside that, digits right-aligned and tabular so they line up
                card to card. */}
            <div className="flex items-center justify-between px-4 h-[20px] pt-1.5">
              <span className="text-white/60 text-[0.6875rem] font-medium tabular-nums tracking-[0.12em] leading-none">•••• {c.tail}</span>
              <span className="text-white text-[0.6875rem] font-bold italic tracking-tight leading-none">{c.network}</span>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

// 2 — iOS share sheet (share button + full sheet). Kept at a realistic scale so
// it reads like an actual screenshot rather than a zoomed-in mock.
function AppIcon({ bg, children, label }: { bg: string; children: React.ReactNode; label: string }) {
  return (
    <div className="flex flex-col items-center gap-1 shrink-0 w-[46px]">
      <span className="w-[46px] h-[46px] rounded-[11px] flex items-center justify-center text-white shadow-sm" style={{ background: bg }}>{children}</span>
      <span className="text-slate-600 text-[0.53125rem] font-medium truncate w-full text-center">{label}</span>
    </div>
  );
}
function ContactBubble({ initials, name, color }: { initials: string; name: string; color: string }) {
  return (
    <div className="flex flex-col items-center gap-1 shrink-0 w-[46px]">
      <span className="w-[46px] h-[46px] rounded-full flex items-center justify-center text-white text-[0.875rem] font-semibold shadow-sm" style={{ background: color }}>{initials}</span>
      <span className="text-slate-600 text-[0.53125rem] font-medium truncate w-full text-center">{name}</span>
    </div>
  );
}
// The action rows iOS shows under the apps, each with its own glyph on the
// right the way the real sheet draws them.
const SHEET_ACTIONS: Array<[string, React.ReactNode]> = [
  ["Copy Link", <svg key="c" viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={1.9}><rect x="9" y="9" width="11" height="11" rx="2.5" /><path d="M5 15V6a2 2 0 012-2h9" strokeLinecap="round" /></svg>],
  ["Add to Home Screen", <svg key="h" viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={1.9}><rect x="4" y="4" width="16" height="16" rx="4" /><path d="M12 9v6M9 12h6" strokeLinecap="round" /></svg>],
  ["Save to Files", <svg key="f" viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={1.9}><path d="M3.5 7.5A2 2 0 015.5 5.5h3.2l1.6 2h8.2a2 2 0 012 2v7a2 2 0 01-2 2H5.5a2 2 0 01-2-2v-9z" strokeLinejoin="round" /></svg>],
  ["Print", <svg key="p" viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={1.9}><path d="M7 9V4h10v5M7 18H5.5A1.5 1.5 0 014 16.5v-4A1.5 1.5 0 015.5 11h13a1.5 1.5 0 011.5 1.5v4a1.5 1.5 0 01-1.5 1.5H17M7 14h10v6H7z" strokeLinejoin="round" /></svg>],
];

export function ShareSheetScreen() {
  return (
    <>
      <StatusBar width={phoneScreenWidth(240)} />
      {/* What is BEHIND the sheet: the card page you were looking at when you
          hit Share, dimmed the way iOS dims it. Before this the sheet floated
          over a bare white screen with a gradient button, which is the one
          thing a real screenshot never looks like. */}
      {/* Both cards in this scene are PICTURES of Alex's card, not the card:
          one sits under the dim, the other is a 36px thumbnail. ClassicPro
          renders real tel:/mailto:/website links, so without `inert` they were
          three tap targets buried under the dim overlay — the nightly QA sweep
          reported them "covered" on m-home and d-home every night (issue #47).
          A person who taps here wants the demo, not to phone Alex. */}
      <div className="relative flex-1 overflow-hidden">
        <div className="px-3 pt-2">
          <InertPreview className="rounded-xl overflow-hidden shadow-sm">
            <CardScaler><ClassicPro data={PAGE_CARD} /></CardScaler>
          </InertPreview>
          <div className="mt-2.5 rounded-xl bg-white p-2.5" style={{ border: "1px solid #E4DDD4" }}>
            <p className="text-slate-900 font-bold text-[0.5625rem]">Save Alex&apos;s contact</p>
            <div className="mt-1.5 rounded-full py-1.5 text-center text-white text-[0.53125rem] font-bold" style={{ background: "#2563EB" }}>Save Contact</div>
          </div>
        </div>
        {/* the dim */}
        <div className="absolute inset-0 pointer-events-none" aria-hidden="true" style={{ background: "rgba(0,0,0,0.28)" }} />
      </div>

      {/* the share sheet, slid up from the bottom */}
      <div className="rounded-t-[22px] shadow-[0_-10px_40px_rgba(0,0,0,0.25)] pt-2 pb-3" style={{ background: "#F2F2F7" }}>
        <div className="w-9 h-1 rounded-full bg-slate-300 mx-auto mb-2.5" />
        {/* preview row — the real sheet leads with a thumbnail of the thing
            being shared (here the card itself, not a letter tile) and closes
            with the X that iOS 16+ puts in this row. */}
        <div className="mx-2.5 mb-3 flex items-center gap-2.5 rounded-2xl bg-white p-2.5 shadow-sm">
          <InertPreview className="w-9 h-[22px] rounded-[4px] overflow-hidden shrink-0 ring-1 ring-slate-200">
            <CardScaler natural={360}><ClassicPro data={PAGE_CARD} /></CardScaler>
          </InertPreview>
          <span className="min-w-0 flex-1">
            <span className="block text-slate-900 text-[0.6875rem] font-bold leading-tight truncate">Alex Morgan&apos;s SwiftCard</span>
            <span className="block text-slate-400 text-[0.5625rem] truncate">swiftcard.me/alexmorgan</span>
            <span className="block text-[#007AFF] text-[0.5625rem] font-medium mt-0.5">Options ›</span>
          </span>
          <span className="w-[18px] h-[18px] rounded-full bg-slate-200/90 grid place-items-center text-slate-500 shrink-0" aria-hidden="true">
            <svg viewBox="0 0 24 24" className="w-2.5 h-2.5" fill="none" stroke="currentColor" strokeWidth={3}><path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" /></svg>
          </span>
        </div>
        {/* AirDrop / contacts row */}
        <div className="flex gap-2 px-2.5 mb-2.5 overflow-x-auto rd-scrollbar-none">
          <ContactBubble initials="JS" name="Jordan" color="#0A84FF" />
          <ContactBubble initials="PR" name="Priya" color="#FF375F" />
          <ContactBubble initials="MW" name="Marcus" color="#30D158" />
          <AppIcon bg="#1f2937" label="AirDrop"><svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2}><path d="M6 8a8 8 0 000 8M9.5 6a12 12 0 000 12M13 4.5a16 16 0 000 15" strokeLinecap="round" /></svg></AppIcon>
        </div>
        {/* app row */}
        {/* A picture of the iOS share sheet, inside a phone mockup that is
            already named "Share sheet". Hidden from assistive tech so it is not
            a second, unreachable scroll region announcing five app names. */}
        <div aria-hidden="true" className="flex gap-2 px-2.5 mb-1 overflow-x-auto rd-scrollbar-none">
          <AppIcon bg="linear-gradient(180deg,#3ee15a,#12bf3a)" label="Messages"><svg viewBox="0 0 24 24" className="w-[22px] h-[22px]" fill="currentColor"><path d="M12 3C6.5 3 2 6.6 2 11c0 2.2 1.1 4.2 3 5.6V21l3.6-2c1.1.3 2.2.4 3.4.4 5.5 0 10-3.6 10-8.4S17.5 3 12 3z" /></svg></AppIcon>
          <AppIcon bg="linear-gradient(180deg,#3cb0ff,#0a7cff)" label="Mail"><svg viewBox="0 0 24 24" className="w-[21px] h-[21px]" fill="currentColor"><path d="M4 5.5h16A1.5 1.5 0 0121.5 7v.3L12 13.4 2.5 7.3V7A1.5 1.5 0 014 5.5z" /><path d="M2.5 9.2l8.9 5.7c.37.24.86.24 1.23 0l8.87-5.7V17a1.5 1.5 0 01-1.5 1.5H4A1.5 1.5 0 012.5 17V9.2z" /></svg></AppIcon>
          <AppIcon bg="#25D366" label="WhatsApp"><svg viewBox="0 0 24 24" className="w-[22px] h-[22px]" fill="currentColor"><path d="M12 2a10 10 0 00-8.5 15.2L2 22l4.9-1.3A10 10 0 1012 2zm5.3 14.1c-.2.6-1.3 1.2-1.8 1.2-.5.1-1 .1-3.2-.7-2.7-1.1-4.4-3.9-4.5-4.1-.1-.2-1.1-1.4-1.1-2.7s.7-1.9 1-2.2c.2-.2.5-.3.7-.3h.5c.2 0 .4 0 .6.5l.8 2c.1.2.1.4 0 .5l-.4.5c-.2.2-.3.3-.1.6.2.3.8 1.3 1.7 2.1 1.2 1 2 1.3 2.3 1.5.2.1.4.1.5-.1l.7-.8c.2-.2.3-.2.6-.1l1.9.9c.3.1.4.2.5.3 0 .2 0 .8-.2 1.4z" /></svg></AppIcon>
          <AppIcon bg="#0A66C2" label="LinkedIn"><svg viewBox="0 0 24 24" className="w-[20px] h-[20px]" fill="currentColor"><path d="M6.94 8.5H4V20h2.94V8.5zM5.47 3.75A1.72 1.72 0 105.47 7.2a1.72 1.72 0 000-3.45zM20 20h-2.94v-5.6c0-1.33-.02-3.05-1.86-3.05-1.86 0-2.15 1.45-2.15 2.95V20H10.1V8.5h2.82v1.57h.04c.4-.75 1.36-1.54 2.8-1.54 3 0 3.55 1.97 3.55 4.53V20z" /></svg></AppIcon>
          <AppIcon bg="radial-gradient(circle at 30% 107%, #fdf497 0%, #fdf497 5%, #fd5949 45%, #d6249f 60%, #285AEB 90%)" label="Instagram"><svg viewBox="0 0 24 24" className="w-[20px] h-[20px]" fill="none" stroke="currentColor" strokeWidth={2}><rect x="4" y="4" width="16" height="16" rx="5" /><circle cx="12" cy="12" r="3.6" /><circle cx="17" cy="7" r="1.1" fill="currentColor" stroke="none" /></svg></AppIcon>
          <AppIcon bg="linear-gradient(180deg,#9aa0aa,#6b7280)" label="Copy"><svg viewBox="0 0 24 24" className="w-[19px] h-[19px]" fill="none" stroke="currentColor" strokeWidth={2}><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 012-2h10" /></svg></AppIcon>
        </div>
        {/* action list — label left, its own glyph right, hairline between
            rows and an inset separator, the way the real grouped list draws. */}
        <div className="mx-2.5 mt-3 rounded-2xl bg-white overflow-hidden">
          {SHEET_ACTIONS.map(([label, glyph], i) => (
            <div key={label} className="relative flex items-center justify-between px-3.5 py-[7px]">
              <span className="text-slate-900 text-[0.6875rem]">{label}</span>
              <span className="text-slate-500">{glyph}</span>
              {i < SHEET_ACTIONS.length - 1 && <span className="absolute left-3.5 right-0 bottom-0 h-px bg-slate-200/80" />}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

export default function ShareWaysPhones({ light = false }: { light?: boolean }) {
  const labelClass = light ? "text-slate-500" : "text-white/60";
  // snap-x: on a phone only ~1.4 of the two phones fit, so a free scroll stops
  // mid-phone and looks cut off. Snap centers one phone per swipe like a
  // deliberate carousel. Desktop fits both, so snapping never engages.
  // tabIndex + a name because it scrolls: a region you can only reach by
  // swiping is unreachable with a keyboard, which is the only way some people
  // drive this app on a Mac (axe: scrollable-region-focusable).
  return (
    <>
    <div
      tabIndex={0}
      role="group"
      aria-label="Ways to share your card — scroll sideways for more"
      className="max-w-full flex gap-6 justify-start sm:justify-center overflow-x-auto snap-x snap-mandatory sm:snap-none rd-scrollbar-none pb-2 px-2"
    >
      <Phone label="Apple Wallet" labelClass={labelClass}><WalletScreen /></Phone>
      <Phone label="Share sheet" labelClass={labelClass}><ShareSheetScreen /></Phone>
    </div>
    {/* Only ~1.4 phones fit on a 390px screen, so the second one is cut. Say
        it swipes rather than leaving it looking clipped (owner mobile pass). */}
    <p className={`sm:hidden mt-3 text-center text-[0.8125rem] font-medium ${light ? "text-slate-500" : "text-white/60"}`}>
      Swipe for more ways <span aria-hidden="true">→</span>
    </p>
    </>
  );
}
