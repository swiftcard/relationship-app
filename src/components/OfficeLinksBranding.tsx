"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { SwiftLinkStyleControls, type SwiftLinkStyle } from "@/components/SwiftLinkDesign";
import { PinnedLinkPreview } from "@/components/PinnedCardPreview";
import { normalizeSocial, socialDestination } from "@/lib/social-url";
import { socialInput } from "@/lib/social-input";
import SocialHandleField from "@/components/SocialHandleField";
import AddLinkForm from "@/components/AddLinkForm";
import SwiftLinkLivePreview from "@/components/SwiftLinkLivePreview";
// From lib/office-link-design, NOT lib/office-brand: that module reaches for
// the service-role database client, and importing a value from it here would
// put it on this client bundle's path.
import { OFFICE_LINK_DESIGN_KEYS } from "@/lib/office-link-design";

// ── Branding → Links ────────────────────────────────────────────────────────
//
// The Swift Links half of the Branding page, and a deliberate mirror of the
// Card half beside it: the same three numbered sections, the same lock
// checkbox at the foot, the same one save button. An admin who has set up
// their cards already knows how this works.
//
// The two halves post SEPARATE keys to /api/office/brand and are saved
// independently, so working on one can never blank the other.
//
// THE TWO RULES, which are the card's rules applied to this surface:
//
//   CONTENT (Instagram, pinned links, bio) behaves like Company information —
//   whatever the admin fills in lands on every member's page and is read-only
//   for them, whether or not the design is locked. A field left blank stays
//   the member's own.
//
//   APPEARANCE behaves like Card appearance — pushed only while "Keep every
//   Swift Links page matching" is ticked.
//
// Pinned links are ADDITIVE. A member can always add their own underneath;
// they simply cannot touch the office's. An office wants its booking link on
// every page, not to stop a salesperson linking their own calendar.

/** A company link, or a section header that chapters the page (no URL). */
type OfficeLinkRow = { label: string; url: string; kind?: "header" | "link"; size?: "featured" | "grid" | "compact"; rowStyle?: "tile" | "solid" | "outline"; media?: { url: string; type: "image" | "video" }; glass?: boolean };

type OfficeRow = {
  // No id: /api/office/brand resolves the office from the SESSION, never from
  // anything the client sends, so this component never needs to know it.
  name?: string | null;
  brand_company?: string | null;
  brand_website?: string | null;
  brand_logo_url?: string | null;
  brand_link_design?: Record<string, unknown> | null;
  brand_link_bio?: string | null;
  brand_link_instagram?: string | null;
  brand_links?: OfficeLinkRow[] | null;
  brand_locks?: { template?: boolean; linkDesign?: boolean } | null;
};

const inputCls =
  "w-full bg-gray-950 border border-gray-800 rounded-xl px-3.5 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-purple-500/40";

function Section({ n, title, desc, children }: { n: number; title: string; desc: string; children: React.ReactNode }) {
  return (
    <section className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
      <div className="flex items-start gap-3 mb-4">
        <span className="shrink-0 w-6 h-6 rounded-full bg-purple-500/15 border border-purple-500/30 text-purple-300 text-[0.6875rem] font-bold grid place-items-center">
          {n}
        </span>
        <div className="min-w-0">
          <h2 className="text-sm font-bold text-white">{title}</h2>
          <p className="text-[0.6875rem] text-gray-500 mt-0.5 leading-snug">{desc}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

export default function OfficeLinksBranding({ office }: { office: OfficeRow }) {
  const router = useRouter();
  // The page's look, read with the same shape the member's own Social design
  // step writes. Only the office vocabulary is kept, so a stray key from an
  // older blob can never reach the controls.
  const [style, setStyle] = useState<SwiftLinkStyle>(() => {
    const d = (office.brand_link_design ?? {}) as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of OFFICE_LINK_DESIGN_KEYS) {
      const v = d[k as string];
      if (v !== undefined && v !== null && v !== "") out[k as string] = v;
    }
    return out as SwiftLinkStyle;
  });
  const patchStyle = (p: Partial<SwiftLinkStyle>) => setStyle((prev) => ({ ...prev, ...p }));

  const [bio, setBio] = useState(office.brand_link_bio ?? "");
  const [instagram, setInstagram] = useState(office.brand_link_instagram ?? "");
  // A row is either a link (label + url) or a SECTION HEADER (label only,
  // kind: "header") — the same two shapes a teammate can add under their own
  // links, so a company page can be chaptered the way a personal one can.
  const [links, setLinks] = useState<OfficeLinkRow[]>(office.brand_links ?? []);
  const [newLink, setNewLink] = useState({ label: "", url: "" });
  // Opt-in: an office that has never opened this tab must not silently start
  // overwriting pages its members already built.
  const [lockLinkDesign, setLockLinkDesign] = useState(office.brand_locks?.linkDesign === true);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");

  // Same rule as every other link form (wizard, editor, homepage builder):
  // both boxes filled is enough, and a bare address gets https:// added. This
  // used to demand a typed "https://" — with the shared AddLinkForm the button
  // would have lit up and then silently done nothing.
  const readyToAdd = !!newLink.label.trim() && !!newLink.url.trim();
  function addLink() {
    if (!readyToAdd) return;
    let url = newLink.url.trim();
    if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
    setLinks((prev) => [...prev, { label: newLink.label.trim(), url }]);
    setNewLink({ label: "", url: "" });
  }

  async function save() {
    if (status === "saving") return;
    // A value that cannot become a link would put a dead Instagram button on
    // every member's page; the red line under the box already says why.
    if (instagram.trim() && !socialDestination("instagram", instagram)) {
      document.getElementById("office-link-ig")?.focus();
      return;
    }
    setStatus("saving");
    try {
      const res = await fetch("/api/office/brand", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        // ONLY the Links keys. The Card tab's fields are absent, so the route
        // leaves every one of them exactly as it found them.
        body: JSON.stringify({ linkDesign: style, linkBio: bio, linkInstagram: normalizeSocial(instagram, "instagram"), links, lockLinkDesign }),
      });
      setStatus(res.ok ? "saved" : "error");
      if (res.ok) {
        setTimeout(() => setStatus("idle"), 2500);
        router.refresh();
      }
    } catch {
      setStatus("error");
    }
  }

  // What the preview stands in for: a teammate's page under this branding.
  const previewSocials = { instagram: instagram || "yourteam", website: office.brand_website ?? undefined };

  // ONE preview, rendered in two slots — the same pattern the card editor uses.
  //
  // On a wide screen it is a sticky panel beside the controls. On a phone there
  // is no beside, and it used to sit at the very BOTTOM: you filled in the
  // branding and never saw the thing you were branding without scrolling past
  // everything. It now sits between "Links information" and "Links appearance"
  // (owner, 2026-09-11) — directly under what you just typed, directly above
  // the design controls whose effect you want to watch.
  const preview = (
    // data-preview-frame marks the box whose WIDTH is the contract. What is
    // inside renders at true phone width and is scaled to fit by measuring the
    // container at runtime, which a static render cannot do — so the layout
    // tests measure this frame and skip its contents (tests/render).
    <div data-preview-frame className="rounded-2xl overflow-hidden border border-gray-800">
      <SwiftLinkLivePreview
        name="Sam Rivera"
        handle="samrivera"
        company={office.brand_company ?? undefined}
        title="Associate"
        bio={bio || "Their own bio goes here."}
        logoUrl={office.brand_logo_url ?? undefined}
        socials={previewSocials}
        links={links}
        style={style}
        paid
      />
    </div>
  );
  const previewCaption = (
    <p className="text-[0.6875rem] text-gray-600 mt-2.5 leading-snug">
      A teammate&apos;s page under this branding. Their name, photo and their own links are theirs.
    </p>
  );

  return (
    <div data-tour="admin-branding-links" className="flex flex-col gap-4 lg:grid lg:grid-cols-[1fr_300px] lg:items-start">
      <div className="space-y-4 min-w-0">
        {/* Phone: pinned at the top below the admin header while every
            section scrolls under it, the same as Social design; tap to see the
            whole page. */}
        <PinnedLinkPreview stickBelow=".sc-office-header">{preview}</PinnedLinkPreview>
        <Section
          n={1}
          title="Links information"
          desc="What every teammate's Swift Links page says. Leave anything blank to let them write their own."
        >
          <div className="space-y-4">
            <div>
              <label htmlFor="office-link-bio" className="block text-xs font-medium text-gray-400 mb-1">Bio</label>
              <textarea
                id="office-link-bio"
                value={bio}
                onChange={(e) => setBio(e.target.value.slice(0, 500))}
                rows={3}
                placeholder="One or two lines about the company — appears under everyone's name."
                className={`${inputCls} resize-none`}
              />
              <p className="text-[0.625rem] text-gray-600 mt-1">
                {bio
                  ? "Everyone's page shows this. Their own bio is kept and returns if you clear this."
                  : "Empty — each teammate writes their own."}
              </p>
            </div>

            <div>
              {/* The same row every teammate sees (SocialHandleField): the
                  Instagram icon, and a box showing instagram.com/ so the
                  username obviously goes after it. Just the username, like
                  every other Instagram box in the product (owner, 2026-09-17). */}
              <SocialHandleField
                spec={{ ...socialInput("instagram")!, label: "Company Instagram" }}
                id="office-link-ig"
                value={instagram}
                onChange={setInstagram}
                onBlur={() => setInstagram((v) => normalizeSocial(v, "instagram"))}
              />
              <p className="text-[0.625rem] text-gray-600 mt-1">
                Shows on everyone&apos;s page. Their own Instagram comes back if you clear this — other socials stay theirs.
              </p>
            </div>

            <div>
              <p className="block text-xs font-medium text-gray-400 mb-1">Company Additional Links</p>
              <p className="text-[0.625rem] text-gray-600 mb-2.5">
                These appear at the top of every teammate&apos;s page and they can&apos;t change them — but they can
                still add their own underneath.
              </p>
              {links.length > 0 && (
                <div className="space-y-2 mb-2">
                  {links.map((l, i) => l.kind === "header" ? (
                    // Label only, edited in place — the same control the
                    // teammate's own "Add a section header" produces.
                    <div key={`h-${i}`} className="flex items-center gap-2.5 bg-gray-950 border border-gray-700 border-dashed rounded-xl px-3 py-2.5">
                      <span className="text-[0.5625rem] font-bold uppercase tracking-wide text-gray-500 shrink-0">Section</span>
                      <input
                        type="text"
                        value={l.label}
                        onChange={(e) => setLinks((prev) => prev.map((x, xi) => (xi === i ? { ...x, label: e.target.value.slice(0, 120) } : x)))}
                        placeholder="Section title (e.g. Listings)"
                        className="flex-1 min-w-0 bg-transparent text-gray-200 text-xs font-bold uppercase tracking-wide focus:outline-none placeholder-gray-600"
                      />
                      <button
                        type="button"
                        onClick={() => setLinks((prev) => prev.filter((_, xi) => xi !== i))}
                        aria-label={`Remove section ${l.label || "header"}`}
                        className="shrink-0 grid place-items-center w-9 h-9 -mr-1.5 rounded-lg text-gray-500 hover:text-red-400 hover:bg-red-500/10 transition-colors text-lg leading-none"
                      >
                        ×
                      </button>
                    </div>
                  ) : (
                    <div key={`${l.url}-${i}`} className="flex items-center gap-2.5 bg-gray-950 border border-gray-800 rounded-xl px-3 py-2.5">
                      <div className="flex-1 min-w-0">
                        <p className="text-gray-200 text-xs font-semibold truncate">{l.label}</p>
                        <p className="text-gray-600 text-[0.625rem] truncate">{l.url}</p>
                      </div>
                      {/* A real tap target, not a bare glyph. Measured: the
                          plain "×" came out 18px tall, which is a miss on a
                          phone — and this one deletes a link from fifteen
                          people's pages. */}
                      <button
                        type="button"
                        onClick={() => setLinks((prev) => prev.filter((_, xi) => xi !== i))}
                        aria-label={`Remove ${l.label}`}
                        className="shrink-0 grid place-items-center w-9 h-9 -mr-1.5 rounded-lg text-gray-500 hover:text-red-400 hover:bg-red-500/10 transition-colors text-lg leading-none"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {/* Outside the list wrapper on purpose: a header has to be able to
                  open the first section before any company link exists. */}
              <button
                type="button"
                onClick={() => setLinks((prev) => [...prev, { label: "", url: "", kind: "header" as const }])}
                // Real padding, not a bare text link: measured at 15px tall
                // without it, which is a miss on a phone — and this control
                // sits on the page fifteen people hand to customers.
                className="block mb-1 -ml-1.5 px-1.5 py-2 rounded-lg text-[0.6875rem] font-semibold text-gray-400 hover:text-gray-200 hover:bg-gray-800/60 transition-colors"
              >
                + Add a section header
              </button>
              {/* The same add form as every teammate's (AddLinkForm): ideas that
                  show what a link is for, then "Button text" and "Web address". */}
              <AddLinkForm
                value={newLink}
                onChange={setNewLink}
                onAdd={addLink}
                addLabel="+ Add company link"
                addClass="bg-purple-600 hover:bg-purple-500 text-white"
                ideas={["Book a meeting", "Leave a review", "See our listings", "Watch our video", "Shop now"]}
                idPrefix="office-link-new"
              />
            </div>
          </div>
        </Section>

        {/* Phone only: the preview belongs between what you fill in and the
            design controls. Capped at 232px — the page renders at true phone
            width and scales to its slot, so a narrower slot is a smaller
            preview, and at full column width it was swallowing the screen. */}

        <Section
          n={2}
          title="Links appearance"
          desc="The design your whole team inherits — the same controls your teammates see under Social design."
        >
          {/* The same panel as Social design, including step 7 "Link buttons"
              for the company links (Featured / Grid / Compact, photo or video). */}
          <SwiftLinkStyleControls value={style} onChange={patchStyle} links={links} onLinksChange={setLinks} />
        </Section>

        <Section n={3} title="What team members can edit" desc="Everything else on their page is what you set above.">
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 mb-4">
            <div>
              <p className="text-[0.625rem] font-semibold uppercase tracking-wide text-gray-500 mb-1.5">They fill in</p>
              <ul className="space-y-1">
                {[
                  "Their name and photo",
                  "Their own link buttons",
                  ...(bio ? [] : ["Their bio"]),
                  "LinkedIn, TikTok, X, Facebook, YouTube, Snapchat",
                ].map((t) => (
                  <li key={t} className="flex items-start gap-1.5 text-[0.6875rem] text-gray-400">
                    <span className="text-gray-600 shrink-0" aria-hidden="true">✓</span>{t}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="text-[0.625rem] font-semibold uppercase tracking-wide text-gray-500 mb-1.5">You control</p>
              <ul className="space-y-1">
                {[
                  ...(bio ? ["The bio"] : []),
                  ...(instagram ? ["Company Instagram"] : []),
                  ...(links.length ? ["Company Additional Links"] : []),
                  ...(lockLinkDesign ? ["The page's whole look"] : []),
                ].map((t) => (
                  <li key={t} className="flex items-start gap-1.5 text-[0.6875rem] text-gray-500">
                    <span className="text-gray-600 shrink-0" aria-hidden="true">🔒</span>{t}
                  </li>
                ))}
                {!bio && !instagram && !links.length && !lockLinkDesign && (
                  <li className="text-[0.6875rem] text-gray-600">Nothing yet — fill anything in above and it lands here.</li>
                )}
              </ul>
            </div>
          </div>

          <label className="flex items-start gap-2 text-xs text-gray-400 cursor-pointer">
            <input
              type="checkbox"
              checked={lockLinkDesign}
              onChange={(e) => setLockLinkDesign(e.target.checked)}
              className="accent-purple-500 mt-0.5"
            />
            <span>
              Keep every Swift Links page matching
              <span className="block text-[0.6875rem] text-gray-600 mt-0.5">
                Your teammates keep their own bio, socials and links — only the look becomes yours.
                Leave it off to let each person design their own page.
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
            {status === "saving" ? "Saving…" : "Save & apply to all Swift Links"}
          </button>
          {status === "saved" && <span className="text-green-400 text-xs font-semibold">Applied to every page ✓</span>}
          {status === "error" && <span className="text-red-400 text-xs font-semibold">Couldn&apos;t save — try again</span>}
        </div>
      </div>

      {/* Wide screens keep the sticky panel beside the controls — there is a
          beside here, and it follows you down the page. */}
      <aside className="hidden lg:block lg:sticky lg:top-4">
        <p className="text-[0.6875rem] font-semibold text-gray-400 uppercase tracking-wide mb-2">Live preview</p>
        {preview}
        {previewCaption}
      </aside>
    </div>
  );
}
