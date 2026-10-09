"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import CardScaler from "@/components/CardScaler";
import InertPreview from "@/components/InertPreview";
import ClassicPro from "@/components/card-templates/ClassicPro";
import ModernBold from "@/components/card-templates/ModernBold";
import PhotoFirst from "@/components/card-templates/PhotoFirst";
import LocalBusiness from "@/components/card-templates/LocalBusiness";
import LuxuryMinimal from "@/components/card-templates/LuxuryMinimal";
import LogoFirst from "@/components/card-templates/LogoFirst";
import CustomCard from "@/components/card-templates/CustomCard";
import { DEFAULT_PRESET, buildPreset, normalizeCustomLayout, withoutFaceImage } from "@/lib/custom-layout";
import { withoutSocials, type CustomLayout } from "@/components/card-templates/types";
import CustomCardDesigner from "@/components/CustomCardDesigner";
import ImageUpload from "@/components/ImageUpload";
import LogoSuggest from "@/components/LogoSuggest";
import TemplateStyleControls from "@/components/card-templates/TemplateStyleControls";
import TemplatePicker from "@/components/card-templates/TemplatePicker";
import PinnedCardPreview from "@/components/PinnedCardPreview";
import { Segmented } from "@/components/ui/DesignControls";
import OfficeLinksBranding from "@/components/OfficeLinksBranding";
import type { TemplateStyle } from "@/components/card-templates/shared";

// Dark-theme form matching the /office/admin shell (bg-gray-900 panels, purple
// accent). THE brand source — with no primary card, everything the team
// inherits (logo, company, website, template, colors & fonts) is set right
// here. Organised into the three questions an owner actually has:
//   1. Company information — what's true about the business
//   2. Card appearance     — what it looks like
//   3. What team members can edit — where their control ends
// Plus a live preview, so "every card uses this" is something they can see
// rather than something they have to take on faith.

const TEMPLATE_COMPONENTS = {
  "classic-pro": ClassicPro,
  "modern-bold": ModernBold,
  "photo-first": PhotoFirst,
  "local-business": LocalBusiness,
  "luxury-minimal": LuxuryMinimal,
  "logo-first": LogoFirst,
  // "custom" is a real brand template — /api/office/brand accepts it, and an
  // office is SEEDED with it automatically when the owner's oldest card uses
  // the designer. It was missing here, so the preview silently fell back to
  // Classic Pro: the admin was shown a card their team does not have, on the
  // one page whose whole job is "every card looks like this".
  custom: CustomCard,
} as const;

type TemplateId = keyof typeof TEMPLATE_COMPONENTS;
const isTemplateId = (v: string): v is TemplateId => v in TEMPLATE_COMPONENTS;

type Addr = { street?: string; unit?: string; city?: string; state?: string; zip?: string };
type Brand = {
  brand_logo_url?: string | null;
  brand_company?: string | null;
  brand_website?: string | null;
  brand_template?: string | null;
  brand_phone?: string | null;
  brand_fax?: string | null;
  brand_address?: Addr | null;
  // "links" (an all-or-nothing freeze on a member's link buttons) is retired —
  // the Links tab's pinned-and-additive model replaced it. "linkDesign" is read
  // by OfficeLinksBranding, not here.
  brand_locks?: { template?: boolean; linkDesign?: boolean } | null;
  brand_design?: Record<string, unknown> | null;
  /** Seeded from the owner's oldest card when its template is "custom". */
  brand_custom_layout?: unknown;
};

const inputCls =
  "w-full bg-gray-950 border border-gray-800 rounded-xl px-3 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-purple-500/40";

function Section({ n, title, desc, children }: {
  n: number; title: string; desc: string; children: React.ReactNode;
}) {
  return (
    <section className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
      <div className="flex items-start gap-3 mb-4">
        <span className="w-5 h-5 rounded-full bg-purple-500/15 text-purple-300 text-[0.6875rem] font-bold flex items-center justify-center shrink-0 mt-0.5" aria-hidden="true">
          {n}
        </span>
        <div>
          <h2 className="text-sm font-bold text-white">{title}</h2>
          <p className="text-gray-500 text-xs mt-0.5">{desc}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

export default function OfficeBranding({ office }: { office: Brand }) {
  const router = useRouter();
  // Everything here is editable — this page IS the brand source.
  const [logoUrl, setLogoUrl] = useState<string | null>(office.brand_logo_url ?? null);
  const [company, setCompany] = useState(office.brand_company ?? "");
  const [website, setWebsite] = useState(office.brand_website ?? "");
  const [template, setTemplate] = useState(office.brand_template ?? "classic-pro");
  // The team's CUSTOM design (owner, 2026-09-18: admins may set one as the look
  // everyone inherits). Seeded from the saved brand, never with a face image —
  // that is one person's card with their details baked in, and on a team it
  // would put the admin's details on every member's card (teamCustomLayout).
  const [customLayout, setCustomLayout] = useState<CustomLayout>(() =>
    office.brand_custom_layout
      ? withoutFaceImage(normalizeCustomLayout(office.brand_custom_layout))
      : buildPreset(DEFAULT_PRESET),
  );
  const customSelected = template === "custom";
  // The team look — the same keys the card editor writes, and it must stay that
  // way: this page renders the card editor's OWN TemplateStyleControls, so any
  // control added there appears here automatically. A key missing from this
  // reader is a control an admin can see and touch that saves nothing.
  const [design, setDesign] = useState<TemplateStyle>(() => {
    const d = (office.brand_design ?? {}) as Record<string, unknown>;
    const pick = (k: string) => (typeof d[k] === "string" && (d[k] as string).trim() ? (d[k] as string) : undefined);
    const dim = typeof d.panelDim === "number" ? d.panelDim : undefined;
    return {
      accentColor: pick("accentColor"), bgColor: pick("bgColor"), surfaceColor: pick("surfaceColor"), textColor: pick("textColor"),
      infoColor: pick("infoColor"), titleColor: pick("titleColor"), companyColor: pick("companyColor"),
      fontFamily: pick("fontFamily"),
      finish: pick("finish"),
      panelMedia: pick("panelMedia"), panelMediaType: pick("panelMediaType"),
      panelMediaPoster: pick("panelMediaPoster"),
      ...(dim === undefined ? {} : { panelDim: dim }),
      ...(d.photoShape === "circle" ? { photoShape: "circle" as const } : {}),
    };
  });
  const patchDesign = (p: Partial<TemplateStyle>) => setDesign((prev) => ({ ...prev, ...p }));
  // Original vs Circle logo plate — the same control Card design has, applied
  // to every team card (the logo is the company's).
  const [logoShape, setLogoShape] = useState<"auto" | "circle">(
    (office.brand_design as Record<string, unknown> | null | undefined)?.logoShape === "circle" ? "circle" : "auto",
  );
  const [phone, setPhone] = useState(office.brand_phone ?? "");
  const [fax, setFax] = useState(office.brand_fax ?? "");
  const [address, setAddress] = useState<Addr>(office.brand_address ?? {});
  const [lockTemplate, setLockTemplate] = useState(office.brand_locks?.template !== false);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  // WHICH HALF OF THE BRAND. A card and a Swift Links page are two different
  // surfaces with two different vocabularies, and an admin works on one at a
  // time — so they are two tabs over one page rather than one very long form.
  // Each tab posts only its own keys, so saving one can never blank the other.
  const [tab, setTab] = useState<"card" | "links">("card");

  // The URL hash picks the tab: /office/admin/branding#links opens Links.
  //
  // Two things need it. The admin tour walks through both halves of Branding,
  // and its engine opens a collapsed surface by setting the hash — the same
  // mechanism SettingsShell uses (lib/admin-tour-steps.ts, `section`). And a
  // link straight to the Links half is a reasonable thing to send someone.
  //
  // Read in an effect, never in the initial state: the server cannot see a
  // hash, so initialising from it would make the first client render disagree
  // with the HTML.
  useEffect(() => {
    const fromHash = () => {
      const h = window.location.hash.replace("#", "");
      if (h === "links" || h === "card") setTab(h);
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
  }, []);

  const setAddr = (k: keyof Addr, v: string) => setAddress((a) => ({ ...a, [k]: v }));

  async function save() {
    if (status === "saving") return;
    setStatus("saving");
    try {
      const res = await fetch("/api/office/brand", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          logoUrl, company, website, template, design: { ...design, logoShape }, phone, fax, address, lockTemplate,
          // Only with the Custom template — the server ignores it otherwise.
          ...(customSelected ? { customLayout } : {}),
        }),
      });
      setStatus(res.ok ? "saved" : "error");
      if (res.ok) {
        setTimeout(() => setStatus("idle"), 2500);
        // Server parts of the page (the "started from your card" note, the
        // setup checklist) catch up; this form's own state is kept.
        router.refresh();
      }
    } catch {
      setStatus("error");
    }
  }

  // Live preview — a stand-in teammate, so the owner sees the company half
  // exactly as it will appear on every card, filled around placeholder personal
  // details they don't control.
  const Preview = TEMPLATE_COMPONENTS[isTemplateId(template) ? template : "classic-pro"];
  const addrLine = [address.street, address.unit, address.city, address.state, address.zip]
    .filter((v) => (v ?? "").toString().trim()).join(", ");
  const previewData = withoutSocials({
    name: "Dana Lee",
    title: "Sales Manager",
    company: company || "Your company",
    phone: phone || "(415) 555-0188",
    email: "dana@" + (website ? website.replace(/^https?:\/\//, "").replace(/\/.*$/, "") : "company.com"),
    website: website || "",
    address: addrLine || undefined,
    initials: "DL",
    logoUrl,
    cardUrl: "swiftcard.me/dana",
    // The layout being designed right now, so the preview follows every change
    // in the designer before it is saved.
    customization: {
      ...design,
      logoShape,
      customLayout,
    },
  });

  return (
    // Flattened (no wrapping "left column" div) so mobile — where this is a
    // plain flex-col, not a grid — stacks children in DOCUMENT order: Company
    // info, then the preview, then everything else. That's the point: on a
    // phone you fill in company info and immediately see the card update,
    // instead of scrolling past every section to find the preview at the
    // bottom. Desktop pins each item back into its column/row explicitly, so
    // the two-column sticky-preview layout is unchanged there.
    <>
      {/* Card | Links. Two equal halves of the same job, so a segmented pair
          rather than a nav: an admin is switching surface, not navigating. */}
      <div
        role="tablist"
        aria-label="What to brand"
        // The admin tour stops here to say there are two surfaces to brand —
        // without it the tour talked about the card and never mentioned that
        // the Swift Links page has its own half (lib/admin-tour-steps.ts).
        data-tour="admin-branding-tabs"
        className="inline-flex items-center gap-1 p-1 mb-4 rounded-full bg-gray-900 border border-gray-800"
      >
        {([["card", "Card"], ["links", "Links"]] as const).map(([id, label]) => (
          <button
            key={id}
            role="tab"
            type="button"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={`px-4 py-1.5 rounded-full text-xs font-semibold transition-colors ${
              tab === id ? "bg-purple-600 text-white" : "text-gray-400 hover:text-white"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* BOTH tabs stay mounted; the inactive one is hidden. Rendering only the
          selected tab threw the other away on every switch, and it came back
          re-initialised from the page's props — unsaved edits vanished, and
          after a save it showed the OLD values, which a second Save would
          then push back out to every teammate. */}
      <div hidden={tab !== "links"}>
        <OfficeLinksBranding office={office} />
      </div>
      <div hidden={tab !== "card"}>
    <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[1fr_300px] lg:items-start">
      {/* Phone: the card pinned at the top while every section scrolls under
          it — the same as Card design — below the admin header and tabs. */}
      <PinnedCardPreview stickBelow=".sc-office-header"><Preview data={previewData} /></PinnedCardPreview>
      {/* 1 ── Company information ─────────────────────────────────────── */}
      <div className="lg:col-start-1 min-w-0">
        <Section n={1} title="Company information" desc="What's true about your business. This is the same on everyone's card.">
          <div className="space-y-4">
            <div>
              <ImageUpload defer field="logo" shape="square" currentUrl={logoUrl} label="Company logo" onUploaded={(u) => setLogoUrl(u || null)} />
              {/* Auto-search uses the website domain when set — a far better hit
                  rate than a name search — and falls back to the company name. */}
              <LogoSuggest company={company} website={website} onConfirm={(u) => setLogoUrl(u)} />
              {logoUrl && (
                <div className="mt-2">
                  <p className="text-[0.6875rem] text-gray-500 mb-1.5">Logo shape on the card</p>
                  <Segmented
                    label="Logo shape on the card"
                    value={logoShape}
                    onChange={setLogoShape}
                    options={[
                      { value: "auto", label: "Original" },
                      { value: "circle", label: "Circle" },
                    ]}
                  />
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1.5">Company name</label>
                <input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Coastline Realty" className={inputCls} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1.5">Website</label>
                <input value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="coastlinehomes.com" className={inputCls} />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1.5">
                  Main phone number <span className="text-gray-600 font-normal">(optional)</span>
                </label>
                <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(555) 123-4567" className={inputCls} />
                <p className="text-[0.6875rem] text-gray-600 mt-1">Shows as &quot;Office&quot; on every card, next to each person&apos;s own number.</p>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1.5">
                  Fax number <span className="text-gray-600 font-normal">(optional)</span>
                </label>
                <input type="tel" value={fax} onChange={(e) => setFax(e.target.value)} placeholder="(555) 123-4568" className={inputCls} />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1.5">
                Business address <span className="text-gray-600 font-normal">(optional)</span>
              </label>
              <div className="grid grid-cols-6 gap-2">
                <input value={address.street ?? ""} onChange={(e) => setAddr("street", e.target.value)} placeholder="Street" aria-label="Street" className={`col-span-4 ${inputCls}`} />
                <input value={address.unit ?? ""} onChange={(e) => setAddr("unit", e.target.value)} placeholder="Unit" aria-label="Unit" className={`col-span-2 ${inputCls}`} />
                <input value={address.city ?? ""} onChange={(e) => setAddr("city", e.target.value)} placeholder="City" aria-label="City" className={`col-span-3 ${inputCls}`} />
                <input value={address.state ?? ""} onChange={(e) => setAddr("state", e.target.value)} placeholder="State" aria-label="State" className={`col-span-1 ${inputCls}`} />
                <input value={address.zip ?? ""} onChange={(e) => setAddr("zip", e.target.value)} placeholder="ZIP" aria-label="ZIP" className={`col-span-2 ${inputCls}`} />
              </div>
            </div>
          </div>
        </Section>
      </div>

      {/* Live preview — moved here in DOCUMENT order (right after Company
          information) so mobile sees it right away. On desktop this becomes
          the sticky right-hand column via explicit grid placement below. */}
      <aside className="hidden lg:block lg:col-start-2 lg:[grid-row:1/-1] lg:sticky lg:top-24">
        <p className="text-[0.6875rem] font-semibold text-gray-500 uppercase tracking-wider mb-2">Preview</p>
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-3">
          <div className="rounded-xl overflow-hidden">
            <InertPreview><CardScaler><Preview data={previewData} /></CardScaler></InertPreview>
          </div>
          <p className="text-[0.6875rem] text-gray-600 mt-2.5 leading-snug">
            {/* Was "everything else is what you set here", which is not true:
                socials are theirs too. An admin reading the old line would
                believe they controlled more of a member's card than they do.
                Bio is NOT named here — it never renders on a card at all (no
                template reads it); it is a Swift Links field, and the Links
                tab is where an office takes it. */}
            An example teammate. Their own details and socials stay theirs — the
            company look and details are what you set here.
          </p>
        </div>
      </aside>

      <div className="lg:col-start-1 min-w-0 flex flex-col gap-4">
        {/* 2 ── Card appearance ─────────────────────────────────────────── */}
        <Section n={2} title="Card appearance" desc="The design your whole team inherits — template, colors and fonts.">
          {/* The same template gallery as Card design — every template drawn
              with the company's details, and the Custom design row OPEN: an
              admin here is on the Office plan (owner, 2026-09-18). */}
          <TemplatePicker template={template} onSelect={setTemplate} data={previewData} customUnlocked upsell={false} />
          <div className="mt-4">
            {customSelected ? (
              // The card editor's own designer, in team mode: a photo copies
              // the LAYOUT only, never an image with someone's details baked in.
              <CustomCardDesigner layout={customLayout} data={previewData} onChange={setCustomLayout} canScan teamBrand />
            ) : (
              // The exact colour/font control the card editor uses — one look
              // system everywhere. Writes offices.brand_design on save.
              <TemplateStyleControls value={design} onChange={patchDesign} template={template} />
            )}
          </div>
          <p className="text-[0.6875rem] text-gray-600 mt-3">
            Use the lock below to decide whether every team card must match this design.
          </p>
        </Section>

        {/* 3 ── What team members can edit ──────────────────────────────── */}
        <Section n={3} title="What team members can edit" desc="Everything else is locked to what you set above.">
          <div className="rounded-xl border border-gray-800 bg-gray-950/50 p-3.5 mb-4">
            <p className="text-[0.6875rem] font-semibold text-gray-400 mb-2">Each person fills in only:</p>
            <ul className="flex flex-wrap gap-x-4 gap-y-1.5">
              {/* CARD fields only. "Their bio" used to sit in this list and was
                  always wrong — bio renders on the Swift Links page, never on a
                  card — and it is now something the Links tab can take, so
                  leaving it here would have promised the member a field their
                  admin may have already claimed one tab over. */}
              {["Their name", "Their photo", "Their job title", "Their phone", "Their email",
                "Their social profiles"].map((t) => (
                <li key={t} className="flex items-center gap-1.5 text-[0.6875rem] text-gray-400">
                  <span className="text-green-400" aria-hidden="true">✓</span>{t}
                </li>
              ))}
            </ul>
            <p className="text-[0.6875rem] font-semibold text-gray-400 mt-3 mb-2">They can never change:</p>
            <ul className="flex flex-wrap gap-x-4 gap-y-1.5">
              {["Company logo", "Company name", "Website", "Office phone", "Fax number", "Address"].map((t) => (
                <li key={t} className="flex items-center gap-1.5 text-[0.6875rem] text-gray-500">
                  <span className="text-gray-600" aria-hidden="true">🔒</span>{t}
                </li>
              ))}
            </ul>
            {/* The two lists above describe the CARD. Everything on a member's
                Swift Links page is decided one tab over, and saying so here is
                what keeps "Their social profiles" honest: an office that pins
                Instagram on the Links tab takes that one social from them. */}
            <p className="text-[0.6875rem] text-gray-500 mt-3 leading-snug">
              Their Swift Links page — bio, Instagram and pinned link buttons — is set on
              the <strong className="text-gray-400">Links</strong> tab.
            </p>
          </div>

          <label className="flex items-start gap-2 text-xs text-gray-400 cursor-pointer">
              <input
                type="checkbox"
                checked={lockTemplate}
                onChange={(e) => setLockTemplate(e.target.checked)}
                className="accent-purple-500 mt-0.5"
              />
              <span>
                Keep every card matching
                <span className="block text-[0.6875rem] text-gray-600 mt-0.5">
                  Recommended. Uncheck only if you want each person to pick their own style.
                </span>
              </span>
            </label>
        </Section>

        <div className="flex items-center gap-3 flex-wrap">
          <button
            onClick={save}
            disabled={status === "saving"}
            className="bg-purple-600 hover:bg-purple-500 text-white text-sm font-semibold px-5 py-2.5 rounded-full transition-colors disabled:opacity-50"
          >
            {status === "saving" ? "Saving…" : "Save & apply to team cards"}
          </button>
          {status === "saved" && <span className="text-green-400 text-sm font-medium" role="status">Applied to your team&apos;s cards ✓</span>}
          {status === "error" && (
            <span className="text-red-400 text-sm" role="alert">Something went wrong — please try again.</span>
          )}
        </div>
      </div>
    </div>
      </div>
    </>
  );
}
