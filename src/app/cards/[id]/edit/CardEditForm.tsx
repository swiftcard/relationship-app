"use client";

// Editing a card is organized into four tabs — Card info, Card design,
// Socials, Social design — the same four sections (and order) as the new-card
// wizard, with a live preview so every change is visible immediately.
//
// DESKTOP pins that preview in a sticky right-hand column. MOBILE has no such
// column: each tab renders its own preview inline, at the point in the form
// where it belongs, and the two Swift Links tabs preview the LINKS PAGE rather
// than the card — see the block above the return.

import { useState, useEffect, useRef } from "react";
import { CARD_FIELD_MAX, MAX_CARD_PHONES } from "@/lib/card-limits";
import { useRouter } from "next/navigation";
import Link from "next/link";
import DashboardLink from "@/components/DashboardLink";
import { PlanGate } from "@/components/PlanGate";
import { PLAN_LIMITS, proFeaturesInUse, proLinkFeaturesInUse, convertCustomizationToFreeClosest, LINK_STYLE_KEYS } from "@/lib/plan";
import { freeSafeLook, DEFAULT_SWIFTLINK_LOOK } from "@/lib/swiftlink-looks";
import ProRequiredDialog from "@/components/ProRequiredDialog";
import ImageUpload from "@/components/ImageUpload";
import LogoSuggest from "@/components/LogoSuggest";
import ProfilePhotoSuggest from "@/components/ProfilePhotoSuggest";
import CardScaler from "@/components/CardScaler";
import { DEFAULT_PRESET, buildPreset } from "@/lib/custom-layout";
import InertPreview from "@/components/InertPreview";
import ClassicPro from "@/components/card-templates/ClassicPro";
import CustomCard from "@/components/card-templates/CustomCard";
import CustomCardDesigner from "@/components/CustomCardDesigner";
import TemplateStyleControls from "@/components/card-templates/TemplateStyleControls";
import TemplatePicker, { PRESET_TEMPLATES } from "@/components/card-templates/TemplatePicker";
import LinkButtonsControls from "@/components/LinkButtonsControls";
import PinnedCardPreview, { PinnedLinkPreview } from "@/components/PinnedCardPreview";
import UndoDesignButton from "@/components/UndoDesignButton";
import { useDesignHistory, useUndoShortcut, changedKeys } from "@/lib/use-design-history";
import { SwiftLinkStyleControls, type SwiftLinkStyle } from "@/components/SwiftLinkDesign";
import { MoreOptions, Segmented, Switch } from "@/components/ui/DesignControls";
import SwiftLinkLivePreview from "@/components/SwiftLinkLivePreview";
import AddressInput, { EMPTY_ADDRESS } from "@/components/AddressInput";
import { withoutSocials } from "@/components/card-templates/types";
import type { TemplateStyle } from "@/components/card-templates/shared";
import type { CardAddress, CardData, CardLink, CardPhone, PhoneLabel, CustomLayout } from "@/components/card-templates/types";
import { normalizeSocial } from "@/lib/social-url";
import { SOCIAL_INPUTS } from "@/lib/social-input";
import SocialHandleField from "@/components/SocialHandleField";
import AddLinkForm from "@/components/AddLinkForm";
import FormSection from "@/components/ui/FormSection";
import LinkPreviewThumb from "@/components/LinkPreviewThumb";
import CardUrlEditor from "@/components/CardUrlEditor";
import { unitLine } from "@/lib/address-unit";


type SocialKey = "linkedin" | "instagram" | "tiktok" | "facebook" | "twitter" | "snapchat" | "youtube";

// The one place that decides what a person is told to type in a social box
// lives in lib/social-input — see the note there. Every row now asks for the
// same thing (a username) instead of a URL on some rows and a handle on others.
const SOCIALS = SOCIAL_INPUTS;


const inputCls =
  "w-full bg-gray-900 border border-gray-700 text-white placeholder-gray-600 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-blue-500 transition-colors";

// The same four sections as the new-card wizard, in the same order:
// 1 Card information · 2 Card design · 3 Socials · 4 Social design.
type TabId = "content" | "design" | "sharing" | "linkdesign";
const TABS: { id: TabId; label: string; hint: string }[] = [
  { id: "content", label: "Card info", hint: "Name & contact details" },
  { id: "design", label: "Card design", hint: "Photos, template, colors & fonts" },
  { id: "sharing", label: "Socials", hint: "Bio, socials & additional links" },
  { id: "linkdesign", label: "Social design", hint: "Style your Swift Links page" },
];

const sectionLabel = "text-xs font-semibold text-gray-400 uppercase tracking-wider";

type Card = {
  id: string;
  username: string;
  label?: string;
  name: string;
  title: string;
  company: string;
  phone: string;
  email: string;
  website: string;
  linkedin: string;
  instagram: string;
  twitter: string;
  tiktok: string;
  template: string;
  customization?: { bio?: string; facebook?: string; snapchat?: string; youtube?: string; about?: string; address?: CardAddress; links?: CardLink[]; customLayout?: CustomLayout; phones?: CardPhone[]; fax?: string; accentColor?: string; bgColor?: string; textColor?: string; infoColor?: string; fontFamily?: string; surfaceColor?: string; finish?: string; panelMedia?: string; panelMediaType?: string; panelMediaPoster?: string; panelDim?: number; linkLook?: string; linkBgColor?: string; linkTextColor?: string; linkFontFamily?: string; linkIconShape?: string; linkIconFill?: string; logoShape?: "auto" | "circle"; hideCardLink?: boolean; linkHeroStyle?: string; linkHeroContent?: string; linkHeroImage?: string; linkHeroMediaType?: string; linkButtonStyle?: string; linkButtonColor?: string; linkBgMedia?: string; linkBgMediaType?: string; linkBgDim?: number; linkGlass?: boolean; linkAccentColor?: string };
};

// Company information owned by the user's Office organization (sub-users only).
// Any field the office set is shown read-only under "Managed by your
// organization"; a field the office left blank stays editable. `lockDesign`
// mirrors the office's Lock Card Design setting and freezes the Design tab.
export type OrgManaged = {
  company: string | null;
  website: string | null;
  logoUrl: string | null;
  phone: string | null;
  fax: string | null;
  address: CardAddress | null;
  lockDesign: boolean;
  /** Link buttons the office pins to every page. Members add their own on top. */
  /** kind "header" is a section title that chapters the page and has no URL. */
  officeLinks: { label: string; url: string; kind?: "header" }[] | null;
  /** The bio the office set for every links page, or null to leave it to them. */
  linkBio: string | null;
  /** The company Instagram, or null. Every OTHER social stays the member's. */
  linkInstagram: string | null;
  /** "Keep every Swift Links page matching" — the page's LOOK is the office's. */
  lockLinkDesign: boolean;
  // True when the viewer is the office OWNER editing one of their NON-primary
  // cards (which inherits the brand). Changes the copy from "managed by your
  // organization" to "set on your office's Branding page".
  ownerInherited?: boolean;
};

type Props = { card: Card; photoUrl?: string | null; logoUrl?: string | null; isPro?: boolean; trialEligible?: boolean; isPrimary?: boolean; org?: OrgManaged | null; linkedinEnabled?: boolean; /** Just joined a team (?joined=1): saving goes on to the dashboard tour. */ tourAfterSave?: boolean; /** Server-chosen opening tab — the LinkedIn return leg opens "design". */ initialTab?: TabId };

// Small "who owns this field" tag shown next to org-controlled values.
function ManagedTag({ owner }: { owner?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1 text-[0.625rem] font-semibold text-purple-300 bg-purple-500/10 border border-purple-500/25 rounded-full px-2 py-0.5">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-2.5 h-2.5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
      </svg>
      {owner ? "From your Branding page" : "Managed by your organization"}
    </span>
  );
}

// Note: editing is auth-only — a guest has no existing card to edit — so per the
// guest-auth-flow contract no useGuestDraft/requireAuth wiring is needed here.
// Guest mode lives in NewCardWizard.

/** The three pieces of a card's look that "Save without them" converts. */
type FreeDesign = { template: string; templateStyleState: TemplateStyle; linkStyleState: SwiftLinkStyle };

// Social design's per-link look, and the link it belongs to (by what it is,
// not where it sits, so a list changed on Socials never mismatches).
function linkKeyOf(l: CardLink): string {
  return `${l.kind ?? "link"}|${l.label}|${l.url}`;
}
function linkStyleOf(l: CardLink) {
  return { k: linkKeyOf(l), size: l.size, rowStyle: l.rowStyle, glass: l.glass, media: l.media };
}

export default function CardEditForm({ card, photoUrl, logoUrl: initialLogoUrl, isPro = false, trialEligible = false, isPrimary = false, org = null, linkedinEnabled = false, initialTab, tourAfterSave = false }: Props) {
  const saveUrl = isPrimary ? "/api/profile" : `/api/cards/${card.id}`;
  const logoCardId = isPrimary ? undefined : card.id;
  const router = useRouter();
  // `initialTab` is decided on the SERVER from the query string. It exists for
  // the LinkedIn return leg: the importer lives in ProfilePhotoSuggest, which
  // sits on the DESIGN tab, and this editor otherwise always opens on
  // "content" — so the component never mounted and the photo was never
  // imported. The user connected LinkedIn and nothing happened at all.
  // Choosing the tab server-side keeps the first paint right and avoids a
  // hydration mismatch.
  const [tab, setTab] = useState<TabId>(initialTab ?? "content");

  // Org-managed fields (office sub-users). Each flag is per-field: the office
  // manages exactly what it has set; blanks stay in the employee's hands.
  const orgCompany = org?.company?.trim() || null;
  const orgWebsite = org?.website?.trim() || null;
  const orgLogo = org?.logoUrl || null;
  const orgPhone = org?.phone?.trim() || null;
  const orgFax = org?.fax?.trim() || null;
  const orgAddress = org?.address && Object.values(org.address).some((v) => (v ?? "").toString().trim()) ? org.address : null;
  const designLocked = !!org?.lockDesign;
  // The office's pinned links, matched by URL so a member cannot claim one by
  // renaming it. Their own links are everything else.
  const officeLinks = org?.officeLinks ?? null;
  // Headers have no URL, so they are excluded here and matched by their marker
  // instead — see isOfficeRow. Without that, every header (theirs and the
  // company's) would share the empty string as an identity.
  const officeLinkUrls = new Set(
    (officeLinks ?? []).filter((l) => l.kind !== "header").map((l) => l.url.trim().toLowerCase().replace(/\/+$/, "")),
  );
  /** Is this row the company's? The server stamps office rows `office: true`
   *  as it pins them; the URL check keeps rows saved before that stamp existed
   *  working too. */
  const isOfficeRow = (l: { url?: string; office?: unknown } | undefined) =>
    // Only while they're ON a team (org set). A company row left on a card
    // after leaving is theirs to delete — it used to stay locked as "Company"
    // forever, with no office left to manage it.
    !!org && !!l && (l.office === true || officeLinkUrls.has(String(l.url ?? "").trim().toLowerCase().replace(/\/+$/, "")));
  const linkDesignLocked = !!org?.lockLinkDesign;
  const bioManaged = !!org?.linkBio;
  const instagramManaged = !!org?.linkInstagram;

  // On tab change, jump the editor column back to the top. Defer to the next
  // frame and jump instantly — mobile browsers can drop a smooth scroll issued
  // mid-render.
  useEffect(() => {
    const id = requestAnimationFrame(() => window.scrollTo({ top: 0, left: 0, behavior: "auto" }));
    return () => cancelAnimationFrame(id);
  }, [tab]);

  // Content — card details. Org-managed fields initialize FROM the org so the
  // saved payload always matches the organization's current values, even if
  // this card hadn't been re-synced yet.
  // A card saved without a nickname opens with its name in the box — the
  // same fallback the dashboard shows as its label — so the required rule
  // below never blocks saving an unrelated edit to an older card.
  const [label, setLabel] = useState(orgCompany ?? (card.label?.trim() || card.name || ""));
  // Required wherever the box is shown (owner, 2026-09-30) — the same rule as
  // the create-card wizard. Not the primary card or an office member's.
  const nicknameInputRef = useRef<HTMLInputElement>(null);
  const [nicknameMissing, setNicknameMissing] = useState(false);
  const [name, setName] = useState(card.name || "");
  const [company, setCompany] = useState(orgCompany ?? (card.company || ""));
  const [title, setTitle] = useState(card.title || "");
  // The office phone rides in `phones` as a server-injected `office:true` entry.
  // Sub-users edit only their own numbers — the office entry is filtered out
  // here (shown read-only in the company panel) and re-applied on save.
  const initialPhones = (card.customization?.phones ?? []).filter((p) => !(orgPhone && (p as { office?: boolean }).office));
  const [phones, setPhones] = useState<CardPhone[]>(
    initialPhones.length
      ? initialPhones
      : card.phone && card.phone !== orgPhone
      ? [{ number: card.phone, label: "mobile", showOnCard: true }]
      : [{ number: "", label: "mobile", showOnCard: true }]
  );
  const [fax, setFax] = useState(orgFax ?? (card.customization?.fax || ""));
  const [email, setEmail] = useState(card.email || "");
  const [address, setAddress] = useState<Required<CardAddress>>({ ...EMPTY_ADDRESS, ...(orgAddress ?? card.customization?.address ?? {}) });

  // Sharing — bio, social links, additional links
  const [bio, setBio] = useState(card.customization?.bio || "");
  // The Swift Links bio is required — the AI follow-ups write from it
  // (lib/sender-about). A Save without one lands on the Socials tab with the
  // box outlined and focused: the message beside Save can be a phone-screen
  // below the field it is about. Two frames, so it runs after the tab change's
  // own jump to the top.
  const [bioMissing, setBioMissing] = useState(false);
  const [bioFocusTick, setBioFocusTick] = useState(0);
  useEffect(() => {
    if (!bioFocusTick) return;
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => {
        const el = document.querySelector<HTMLTextAreaElement>('[data-hydrate="bio"]');
        el?.scrollIntoView({ behavior: "smooth", block: "center" });
        el?.focus({ preventScroll: true });
      });
    });
    return () => { cancelAnimationFrame(outer); cancelAnimationFrame(inner); };
  }, [bioFocusTick]);
  // Social-design toggle: "View SwiftCard →" on the Swift Links page (default shown).
  const [showCardLinkBtn, setShowCardLinkBtn] = useState(card.customization?.hideCardLink !== true);
  const [website, setWebsite] = useState(orgWebsite ?? (card.website || ""));
  // HYDRATION CATCH-UP. Everything is interactive before it is hydrated: a
  // person who starts typing the instant the editor paints fills the DOM while
  // these hooks still hold the saved values, and Save would then send the old
  // text with a green tick (measured on production 2026-09-11 on the profile
  // form; same shape here). Once React attaches, read what is actually in the
  // six core fields and adopt it. Runs once, costs nothing when nobody typed.
  useEffect(() => {
    const adopt = (key: string, current: string, set: (v: string) => void) => {
      const el = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[data-hydrate="${key}"]`);
      if (el && !el.readOnly && el.value !== current) set(el.value);
    };
    adopt("name", name, setName); adopt("company", company, setCompany); adopt("title", title, setTitle);
    adopt("email", email, setEmail); adopt("website", website, setWebsite); adopt("bio", bio, setBio);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only by design
  }, []);
  const [links, setLinks] = useState<CardLink[]>(card.customization?.links ?? []);
  const [newLink, setNewLink] = useState({ label: "", url: "" });
  const [socials, setSocials] = useState<Record<SocialKey, string>>({
    linkedin:  card.linkedin || "",
    instagram: card.instagram || "",
    tiktok:    card.tiktok || "",
    facebook:  card.customization?.facebook || "",
    twitter:   card.twitter || "",
    snapchat:  card.customization?.snapchat || "",
    youtube:   card.customization?.youtube || "",
  });

  // Content — media; Design — template + style
  const [cardLogoUrl, setCardLogoUrl] = useState<string | null>(initialLogoUrl ?? null);
  // What logo_url holds once this is saved, so every preview shows the live
  // page: the editor's own logo, or on a team member's card the OFFICE's (or
  // none) — the server writes the brand's logo over theirs on every save.
  const liveLogoUrl = org ? orgLogo : cardLogoUrl;
  // Logo display shape: "auto" keeps the classic square/wide/banner behavior;
  // "circle" renders the whole mark inside a circular plate (never cropped).
  const [logoShape, setLogoShape] = useState<"auto" | "circle">(card.customization?.logoShape === "circle" ? "circle" : "auto");
  const [photoState, setPhotoState] = useState<string | null>(photoUrl ?? null);
  // Card design → Photos opens by itself only while something is still missing.
  // Read ONCE at mount (see MoreOptions): a live value would fold the section
  // shut under the owner the moment an upload finished. An office member's logo
  // is the organization's, so only their headshot counts.
  const [photosStartOpen] = useState(() => !((org ? true : !!initialLogoUrl) && !!photoUrl));
  const [template, setTemplate] = useState(card.template || "classic-pro");
  const [customLayout, setCustomLayout] = useState<CustomLayout>(card.customization?.customLayout ?? buildPreset(DEFAULT_PRESET));
  // Preset-template styling (Pro). Undefined fields fall back to each template's
  // baked-in design, so a card saved before this feature is unchanged.
  const [templateStyleState, setTemplateStyleState] = useState<TemplateStyle>({
    accentColor: card.customization?.accentColor ?? undefined,
    bgColor: card.customization?.bgColor ?? undefined,
    surfaceColor: card.customization?.surfaceColor ?? undefined,
    textColor: card.customization?.textColor ?? undefined,
    infoColor: card.customization?.infoColor ?? undefined,
    fontFamily: card.customization?.fontFamily ?? undefined,
    // Finish + panel media (lib/card-finishes.ts). Every key TemplateStyle
    // carries has to be listed in BOTH this reader and the save payload below:
    // the controls come from the shared TemplateStyleControls, so a key missing
    // here renders a picker that opens blank and forgets what it is told.
    finish: card.customization?.finish ?? undefined,
    panelMedia: card.customization?.panelMedia ?? undefined,
    panelMediaType: card.customization?.panelMediaType ?? undefined,
    panelMediaPoster: card.customization?.panelMediaPoster ?? undefined,
    panelDim: typeof card.customization?.panelDim === "number" ? card.customization.panelDim : undefined,
  });
  function patchTemplateStyle(patch: Partial<TemplateStyle>) {
    setTemplateStyleState((prev) => ({ ...prev, ...patch }));
  }
  // "Social design" — the Swift Links PAGE's look. Separate keys from the
  // card's style, so styling one surface never restyles the other.
  const [linkStyleState, setLinkStyleState] = useState<SwiftLinkStyle>({
    linkLook: card.customization?.linkLook ?? undefined,
    linkIconShape: card.customization?.linkIconShape ?? undefined,
    linkIconFill: card.customization?.linkIconFill ?? undefined,
    linkBgColor: card.customization?.linkBgColor ?? undefined,
    linkTextColor: card.customization?.linkTextColor ?? undefined,
    linkFontFamily: card.customization?.linkFontFamily ?? undefined,
    linkHeroStyle: card.customization?.linkHeroStyle ?? undefined,
    linkHeroContent: card.customization?.linkHeroContent ?? undefined,
    linkHeroImage: card.customization?.linkHeroImage ?? undefined,
    linkHeroMediaType: card.customization?.linkHeroMediaType ?? undefined,
    linkButtonStyle: card.customization?.linkButtonStyle ?? undefined,
    linkButtonColor: card.customization?.linkButtonColor ?? undefined,
    linkBgMedia: card.customization?.linkBgMedia ?? undefined,
    linkBgMediaType: card.customization?.linkBgMediaType ?? undefined,
    linkBgDim: card.customization?.linkBgDim ?? undefined,
    // NOT `?? undefined` on a boolean by accident: false is a real stored
    // value here ("frosting explicitly turned off"), and ?? passes it through.
    linkGlass: card.customization?.linkGlass ?? undefined,
    linkAccentColor: card.customization?.linkAccentColor ?? undefined,
  });
  function patchLinkStyle(patch: Partial<SwiftLinkStyle>) {
    setLinkStyleState((prev) => ({ ...prev, ...patch }));
  }

  // ── Undo — Card design and Social design (lib/use-design-history) ─────────
  // Each tab has its own history of what ITS controls change; a press steps
  // back one change, newest first, and a save ends both histories.
  const cardHistory = useDesignHistory(
    { template, customLayout, style: templateStyleState, logoShape, logo: cardLogoUrl, photo: photoState },
    (s) => {
      setTemplate(s.template);
      setCustomLayout(s.customLayout);
      setTemplateStyleState(s.style);
      setLogoShape(s.logoShape);
      setCardLogoUrl(s.logo);
      setPhotoState(s.photo);
    },
  );
  // Social design styles each link (tile size, row style, blur, tile photo)
  // but the links themselves belong to the Socials tab — so only those style
  // fields are tracked, matched back by link, and a link added or removed
  // there is never a step to undo here.
  const linkHistory = useDesignHistory(
    { style: linkStyleState, showCardLink: showCardLinkBtn, linkStyles: links.map(linkStyleOf) },
    (s) => {
      setLinkStyleState(s.style);
      setShowCardLinkBtn(s.showCardLink);
      setLinks((cur) => cur.map((l) => {
        const was = s.linkStyles.find((x) => x.k === linkKeyOf(l));
        return was ? { ...l, size: was.size, rowStyle: was.rowStyle, glass: was.glass, media: was.media } : l;
      }));
    },
    {
      describe: (prev, next) =>
        prev.linkStyles.map((x) => x.k).join("\n") === next.linkStyles.map((x) => x.k).join("\n")
          ? changedKeys(prev, next)
          : null,
    },
  );
  useUndoShortcut(tab === "design", cardHistory);
  useUndoShortcut(tab === "linkdesign", linkHistory);

  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");

  // ── Unsaved-changes guard ──────────────────────────────────────────────
  // There is no autosave here (the builder has one; the editor saves on
  // Save), and nothing stopped a reload, a closed tab or a tap on Cancel from
  // dropping ten minutes of edits without a word (UX audit 2026-09-30).
  // "Dirty" is: any typed input since mount (every text box and textarea
  // bubbles an input event to the root), or a design step the undo history
  // has recorded. Saving clears it (the histories are cleared on save, and
  // typedRef is reset there too). While dirty:
  //   • closing or reloading the tab gets the browser's own "leave page?"
  //     prompt (beforeunload — the only hook there is for that);
  //   • Cancel turns into an in-page "Discard changes?" with Keep editing /
  //     Discard, the same two-step ManageCards uses — no window.confirm,
  //     which would hang the automated flows.
  const typedRef = useRef(false);
  const [typed, setTyped] = useState(false);
  const dirty = typed || cardHistory.canUndo || linkHistory.canUndo;
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  useEffect(() => {
    if (!dirty || status === "saved") return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty, status]);
  const noteTyped = () => { if (!typedRef.current) { typedRef.current = true; setTyped(true); } };
  const [error, setError] = useState("");
  // Set when the save is rejected because this is a non-primary card that is
  // view-only on Free (api/cards/[id] → error:"view_only" / code:"CARD_VIEW_ONLY").
  // Previously this had no proper surface; now web shows the message + an
  // Upgrade link and native shows the neutral PlanGate string.
  const [viewOnly, setViewOnly] = useState(false);

  // Phone management (multiple numbers, each labeled + toggleable on the card).
  function updatePhone(i: number, patch: Partial<CardPhone>) {
    setPhones((prev) => prev.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));
  }
  function addPhone() {
    // On an office team the company number is set by the admin and injected by
    // the server, so anything the member adds here is a personal (mobile) line.
    setPhones((prev) => [...prev, { number: "", label: org ? "mobile" : "office", showOnCard: true }]);
  }
  function removePhone(i: number) {
    setPhones((prev) => (prev.length > 1 ? prev.filter((_, idx) => idx !== i) : prev));
  }
  const cleanPhones: CardPhone[] = phones
    .filter((p) => p.number.trim())
    // Force mobile for office members: the office line is the admin's to set,
    // so a member can never save a second "Office" number on their card.
    .map((p) => ({ number: p.number.trim(), label: org ? ("mobile" as PhoneLabel) : p.label, showOnCard: p.showOnCard }));
  const primaryPhone =
    (cleanPhones.find((p) => p.showOnCard) ?? cleanPhones[0])?.number ?? "";

  function setSocial(key: SocialKey, value: string) {
    setSocials((prev) => ({ ...prev, [key]: value }));
  }
  function normalizeOnBlur(key: SocialKey) {
    setSocials((prev) => ({ ...prev, [key]: normalizeSocial(prev[key], key) }));
  }

  // Free is limited to FREE_MAX_LINKS Swift Links; Pro/Office get unlimited.
  const atLinkCap = !isPro && links.length >= PLAN_LIMITS.FREE_MAX_LINKS;
  function addLink() {
    if (atLinkCap) return;
    const linkLabel = newLink.label.trim();
    let url = newLink.url.trim();
    if (!linkLabel || !url) return;
    if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
    // Add the link, then reset the fields so another can be entered right away.
    setLinks((prev) => [...prev, { label: linkLabel, url }]);
    setNewLink({ label: "", url: "" });
  }
  function removeLink(i: number) {
    setLinks((prev) => prev.filter((_, idx) => idx !== i));
  }

  const previewData: CardData = {
    name: name || card.username,
    title,
    company,
    phone: primaryPhone,
    email,
    // Same omission as the create wizard: hardcoded "" while the save sends
    // website.trim(), so editing the website changed nothing in the preview.
    website,
    linkedin: socials.linkedin,
    instagram: socials.instagram,
    twitter: socials.twitter,
    tiktok: socials.tiktok,
    snapchat: socials.snapchat,
    initials: (name || card.username)[0]?.toUpperCase() ?? "?",
    photoUrl: photoState,
    logoUrl: liveLogoUrl,
    cardUrl: `swiftcard.me/${card.username}`,
    address: [
      [address.street, unitLine(address.unit)].filter(Boolean).join(", "),
      address.city,
      [address.state, address.zip].filter(Boolean).join(" "),
    ].filter(Boolean).join("\n"),
    customization: {
      snapchat: socials.snapchat,
      // Facebook and YouTube live ONLY in customization — CustomCard reads them
      // from here and nowhere else. Without them the Custom template's preview
      // dropped both icons while the saved card showed them.
      facebook: socials.facebook,
      youtube: socials.youtube,
      customLayout,
      // Preview mirrors the live card: the office number the server injects on
      // every connected card is shown here too, ahead of personal numbers.
      phones: org && orgPhone
        ? [{ number: orgPhone, label: "office" as PhoneLabel, showOnCard: true }, ...cleanPhones]
        : cleanPhones,
      fax: fax.trim(),
      logoShape,
      ...templateStyleState,
    },
  };
  const hasLogo = !!(org ? org.logoUrl : cardLogoUrl);
  const photosSummary = hasLogo && photoState
    ? "Both added"
    : hasLogo ? "Logo added · add a headshot"
    : photoState ? (org ? "Headshot added" : "Headshot added · add a logo")
    : "Add your logo and headshot";
  const PreviewTemplate = template === "custom" ? CustomCard : (PRESET_TEMPLATES.find((t) => t.id === template)?.Component ?? ClassicPro);
  const customSelected = template === "custom";

  // Pro design on a Free account: the editor lets it all be tried on — every
  // finish is tappable, the photo/video picker opens, the preview renders it —
  // and the wall stands here, at Save. Before this the save simply succeeded
  // and the server quietly stripped the Pro keys, so the person found a flat
  // card on their live link with nothing having told them why.
  const [proBlock, setProBlock] = useState<string[] | null>(null);

  /**
   * "Save without them": the Free version of this card's design, applied to the
   * editor AND handed straight to the save. It used to send the Pro design as-is and let
   * the server hide it — correct for the live card, but the editor reopened with
   * the Pro finish still selected and asked the same question on every later
   * Save (2026-09-23 free-account review). Same converter the builder's Free
   * step uses (NewCardWizard applyFreeDesignConversion); the Swift Links half
   * mirrors sanitizeCustomizationForPlan. Links themselves are content and are
   * not touched.
   */
  function applyFreeDesign(): FreeDesign {
    const result = convertCustomizationToFreeClosest({ ...templateStyleState, ...(template === "custom" ? { customLayout } : {}) }, template);
    const c = result.customization;
    const ts: TemplateStyle = {
      accentColor: c.accentColor as string | undefined,
      bgColor: c.bgColor as string | undefined,
      surfaceColor: c.surfaceColor as string | undefined,
      textColor: c.textColor as string | undefined,
      infoColor: c.infoColor as string | undefined,
      fontFamily: c.fontFamily as string | undefined,
      finish: c.finish as string | undefined,
      panelMedia: c.panelMedia as string | undefined,
      panelMediaType: c.panelMediaType as string | undefined,
      panelMediaPoster: c.panelMediaPoster as string | undefined,
      panelDim: typeof c.panelDim === "number" ? c.panelDim : undefined,
    };
    const ls: SwiftLinkStyle = { ...linkStyleState };
    for (const k of LINK_STYLE_KEYS) delete (ls as Record<string, unknown>)[k];
    if (ls.linkLook) {
      const safe = freeSafeLook(ls.linkLook);
      ls.linkLook = safe === DEFAULT_SWIFTLINK_LOOK && ls.linkLook !== DEFAULT_SWIFTLINK_LOOK ? undefined : safe;
    }
    setTemplate(result.template);
    setTemplateStyleState(ts);
    setLinkStyleState(ls);
    return { template: result.template, templateStyleState: ts, linkStyleState: ls };
  }

  // What is on screen right now — the design a normal Save writes.
  const stateDesign: FreeDesign = { template, templateStyleState, linkStyleState };

  async function handleSave(opts?: {
    allowFreeConversion?: boolean;
    /** Save this design instead of what is on state (applyFreeDesign — React
     *  state set in the same click is not readable yet). */
    design?: FreeDesign;
  }) {
    // Same names as the state they stand in for, so every line below reads
    // exactly as it always has.
    const { template, templateStyleState, linkStyleState } = opts?.design ?? stateDesign;
    if (!name.trim()) {
      setTab("content");
      setError("Full name is required.");
      setProBlock(null);
      return;
    }
    if (!isPrimary && !org && !label.trim()) {
      setTab("content");
      setError("Card nickname is required.");
      setNicknameMissing(true);
      setProBlock(null);
      // Two frames: on another step or tab the box isn't mounted yet.
      requestAnimationFrame(() => requestAnimationFrame(() => {
        nicknameInputRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
        nicknameInputRef.current?.focus({ preventScroll: true });
      }));
      return;
    }
    // An office-set bio fills the page on its own (bioManaged); otherwise the
    // member's own bio is required.
    if (!bioManaged && !bio.trim()) {
      setTab("sharing");
      setBioMissing(true);
      setBioFocusTick((n) => n + 1);
      setError("Your bio is required.");
      setProBlock(null);
      return;
    }

    if (!isPro && !opts?.allowFreeConversion) {
      // Same detection the converter and the server sanitizer use, so the
      // dialog can never disagree with what would actually be saved.
      //
      // BOTH TABS, one Save. Card design and Social design are two halves of
      // one form and one button saves them together, so the dialog lists
      // whatever is Pro across both — the Swift Links half named by its own
      // checker (proLinkFeaturesInUse), because the page keys are stripped by a
      // different rule than the card's and the card converter must not learn
      // about them (it decides what every card RENDERS as).
      const proFeatures = [
        ...proFeaturesInUse({ ...templateStyleState, ...linkStyleState, customLayout }, template),
        ...proLinkFeaturesInUse(linkStyleState as unknown as Record<string, unknown>, links),
      ];
      if (proFeatures.length) {
        setProBlock(proFeatures);
        setStatus("idle");
        return;
      }
    }
    setProBlock(null);

    setStatus("saving");
    setError("");
    setViewOnly(false);
    try {
      const res = await fetch(saveUrl, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          company: company.trim(),
          title: title.trim(),
          email: email.trim(),
          website: website.trim(),
          linkedin: normalizeSocial(socials.linkedin, "linkedin"),
          instagram: normalizeSocial(socials.instagram, "instagram"),
          twitter: normalizeSocial(socials.twitter, "twitter"),
          tiktok: normalizeSocial(socials.tiktok, "tiktok"),
          phone: primaryPhone,
          ...(isPrimary ? {} : { label }),
          template,
          customization: {
            bio: bio.trim(),
            facebook: normalizeSocial(socials.facebook, "facebook"),
            snapchat: normalizeSocial(socials.snapchat, "snapchat"),
            youtube: normalizeSocial(socials.youtube, "youtube"),
            address,
            links: links.filter((l) => (l.kind === "header" ? l.label.trim() : true)),
            customLayout,
            phones: cleanPhones,
            fax: fax.trim(),
            // Preset-template style overrides (Pro; stripped server-side on Free).
            // Sent explicitly (undefined → key cleared to the template default).
            accentColor: templateStyleState.accentColor ?? null,
            bgColor: templateStyleState.bgColor ?? null,
            surfaceColor: templateStyleState.surfaceColor ?? null,
            textColor: templateStyleState.textColor ?? null,
            infoColor: templateStyleState.infoColor ?? null,
            fontFamily: templateStyleState.fontFamily ?? null,
            finish: templateStyleState.finish ?? null,
            panelMedia: templateStyleState.panelMedia ?? null,
            panelMediaType: templateStyleState.panelMediaType ?? null,
            panelMediaPoster: templateStyleState.panelMediaPoster ?? null,
            panelDim: templateStyleState.panelDim ?? null,
            // Swift Links page design ("Social design" — Pro, stripped on Free).
            linkLook: linkStyleState.linkLook ?? null,
            linkIconShape: linkStyleState.linkIconShape ?? null,
            linkIconFill: linkStyleState.linkIconFill ?? null,
            linkBgColor: linkStyleState.linkBgColor ?? null,
            linkTextColor: linkStyleState.linkTextColor ?? null,
            linkFontFamily: linkStyleState.linkFontFamily ?? null,
            linkHeroStyle: linkStyleState.linkHeroStyle ?? null,
            linkHeroContent: linkStyleState.linkHeroContent ?? null,
            linkHeroImage: linkStyleState.linkHeroImage ?? null,
            linkHeroMediaType: linkStyleState.linkHeroMediaType ?? null,
            linkButtonStyle: linkStyleState.linkButtonStyle ?? null,
            linkButtonColor: linkStyleState.linkButtonColor ?? null,
            // Page background media. This list is a WHITELIST, not a spread —
            // every key has to be named or it is silently dropped on save,
            // which is exactly what happened to these four when the feature
            // landed: the background previewed live in the editor and then
            // vanished the moment you pressed Save.
            linkBgMedia: linkStyleState.linkBgMedia ?? null,
            linkBgMediaType: linkStyleState.linkBgMediaType ?? null,
            linkBgDim: linkStyleState.linkBgDim ?? null,
            linkGlass: linkStyleState.linkGlass ?? null,
            linkAccentColor: linkStyleState.linkAccentColor ?? null,
            // "View SwiftCard →" toggle — sent explicitly (null clears back to shown) so the merge can flip it both ways.
            hideCardLink: showCardLinkBtn ? null : true,
            // Headshot is per-card (explicit key, null when removed).
            photoUrl: photoState ?? null,
            // Logo display shape — null clears back to the "auto" default.
            logoShape: logoShape === "circle" ? "circle" : null,
          },
          logo_url: cardLogoUrl,
        }),
      });
      if (res.ok) {
        setStatus("saved");
        // Saved: what is on screen is now the card. Undo only ever reaches
        // back to the last save.
        cardHistory.clear();
        linkHistory.clear();
        typedRef.current = false;
        setTyped(false);
        // A name/company change may have auto-renamed the card URL — follow the
        // slug the server reports, or ?card= selects a card that no longer exists.
        const okJson = await res.json().catch(() => ({} as { renamedTo?: string }));
        // The card's address NOW — renamed by a name change (renamedTo), or by
        // hand in "Card URL" earlier in this session (slug). card.username is
        // the address the page loaded with, and sending the dashboard there
        // after a manual rename found no card (and pinned a dead address as
        // the active card).
        const slugNow = okJson.renamedTo || okJson.slug || card.username;
        // Show the "Saved" confirmation briefly, then return to THIS card's
        // dashboard (not the bare picker).
        // A teammate who just joined (?joined=1) goes on to the tour — the
        // banner above told them "save, and your dashboard is ready", and
        // saving used to be the one exit that skipped it.
        setTimeout(() => { router.push(`/dashboard?card=${encodeURIComponent(slugNow)}${tourAfterSave ? "&tour=1" : ""}`); }, 1000);
      } else {
        // Surface the server's plain-English reason when it gives one (e.g. an
        // org-managed field was changed) instead of a bare "Error".
        const json = await res.json().catch(() => ({} as { message?: string; error?: string; code?: string }));
        if (json.error === "view_only" || json.code === "CARD_VIEW_ONLY") setViewOnly(true);
        // A fallback sentence, always. Without one, a failure that carried no
        // `message` left `error` empty and the ENTIRE report to the user was the
        // button relabelling itself "Error — try again" — which does not say
        // whether anything saved, whether to wait, or what to do differently
        // (audit 2026-09-29).
        setError(
          typeof json.message === "string" && json.message
            ? json.message
            : "Couldn't save your changes. Please try again.",
        );
        setStatus("error");
        setTimeout(() => setStatus("idle"), 2500);
      }
    } catch {
      // Network failure — don't leave the button stuck on "Saving…". Same
      // wording the card builder uses for the same failure, so the two screens
      // describe one problem the same way.
      setError("Couldn't reach the server — check your connection and try again.");
      setStatus("error");
      setTimeout(() => setStatus("idle"), 2500);
    }
  }

  const saveLabel =
    status === "saving" ? "Saving…" : status === "saved" ? "Saved!" : status === "error" ? "Error — try again" : "Save changes";

  // ── Previews ───────────────────────────────────────────────────────────────
  //
  // Defined ONCE and rendered in two places: the pinned right column on desktop,
  // and inline inside a step on mobile. Extracting them is the point — a phone
  // and a laptop showing different previews of the same card would be worse than
  // the layout problem this solves.
  //
  // On mobile the preview used to sit above the whole form on every step, which
  // pushed the actual fields off-screen and showed a card preview even while
  // editing the Swift Links page. Now each step places its own, next to the
  // controls that change it.
  // The card itself, built ONCE. The inline/pinned preview and the phone's
  // docked preview (Card design tab) both render this exact element, so the two
  // can never show different cards.
  const cardTemplateEl = <PreviewTemplate data={customSelected ? previewData : withoutSocials(previewData)} />;

  const cardPreviewInner = (
    // Look-only: the card's own phone/email/links stay clickable on the
    // PUBLISHED card, but never here — design is changed with the controls, not
    // by clicking the picture. See InertPreview.
    <InertPreview className="rounded-2xl overflow-hidden border border-gray-800">
      {/* Scale from the 460px natural width (same as the published card) so a
          long name/title/company never clips in-preview. */}
      <CardScaler>
        {cardTemplateEl}
      </CardScaler>
    </InertPreview>
  );

  const linkPreviewInner = (
    <SwiftLinkLivePreview
      showCardLink={showCardLinkBtn}
      style={linkStyleState}
      name={name || card.username}
      handle={card.username}
      company={company}
      title={title}
      bio={bio}
      photoUrl={photoState}
      // liveLogoUrl is what logo_url holds after the save, so the hero's
      // headshot → logo → initials fallback previews exactly as it renders.
      logoUrl={liveLogoUrl}
      socials={{
        instagram: socials.instagram, tiktok: socials.tiktok, linkedin: socials.linkedin,
        twitter: socials.twitter, facebook: socials.facebook, snapchat: socials.snapchat,
        youtube: socials.youtube, website,
      }}
      links={links}
      paid={isPro}
    />
  );

  /**
   * Mobile-only inline card preview.
   *
   * Full width: a card is a wide, short shape, so it reads fine at the column
   * width and shrinking it would just make the text unreadable.
   */
  const mobileCardPreview = (caption: string) => (
    <div className="lg:hidden pt-1">
      <p className="text-[0.6875rem] font-semibold text-gray-400 uppercase tracking-wide mb-2">Live preview</p>
      {cardPreviewInner}
      <p className="text-gray-600 text-[0.6875rem] mt-2 leading-snug">{caption}</p>
    </div>
  );

  /**
   * Mobile-only inline Swift Links preview.
   *
   * Capped at 220px and centred. SwiftLinkLivePreview renders the REAL profile
   * at a 390px phone width and CardScaler shrinks it to whatever slot holds it,
   * so a full-width slot on a phone produced a ~0.9 scale — a preview nearly as
   * tall as the screen it was being previewed on. 220px lands it around 0.56:
   * a true mini-phone, pixel-identical to the published page, that a thumb can
   * scroll past. The cap is the ONLY thing that changes; nothing is clamped or
   * simplified, so it still looks exactly like the real page.
   */
  const mobileLinkPreview = (caption: string) => (
    <div className="lg:hidden pt-1">
      <p className="text-[0.6875rem] font-semibold text-gray-400 uppercase tracking-wide mb-2">
        Your Swift Links page
      </p>
      <div className="w-full max-w-[220px] mx-auto">{linkPreviewInner}</div>
      <p className="text-gray-600 text-[0.6875rem] mt-2 leading-snug text-center">{caption}</p>
    </div>
  );

  // The custom designer IS a live card you edit by touching it, so the sticky
  // preview column beside it would be a second, identical, non-interactive copy
  // of the same card. Stand the designer down the full width instead.
  const designerIsCanvas = tab === "design" && customSelected && isPro && !designLocked;

  return (
    <div onInput={noteTyped} className={`grid gap-6 lg:items-start ${designerIsCanvas ? "" : "lg:grid-cols-[minmax(0,1fr)_340px]"}`}>
      {/* ── EDITOR (left on desktop; the whole page on mobile) ── */}
      <div className="min-w-0 order-2 lg:order-1">
        {/* Tabs */}
        <div className="flex gap-1 bg-gray-900 border border-gray-800 rounded-xl p-1 mb-2">
          {TABS.map((t) => {
            const on = tab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                // text-[0.6875rem] on phones: four tabs share the row now, and
                // "Social design" must never clip inside its pill.
                className={`flex-1 text-[0.6875rem] sm:text-sm leading-tight font-semibold py-2 px-0.5 rounded-lg transition-colors ${on ? "bg-blue-600 text-white" : "text-gray-400 hover:text-white hover:bg-gray-800"}`}
              >
                {t.label}
              </button>
            );
          })}
        </div>
        <p className="text-gray-600 text-[0.6875rem] mb-5">{TABS.find((t) => t.id === tab)?.hint}</p>

        {/* ── CONTENT ── */}
        {tab === "content" && (
          <div className="space-y-4 sc-step-in">
            {/* Company information — office sub-users see the org-owned half of
                their card here, read-only. Fields the office set never render as
                inputs below; whatever it left blank stays editable. */}
            {org && (orgCompany || orgWebsite || orgPhone || orgFax || orgAddress || orgLogo) && (
              <div className="rounded-2xl border border-purple-500/20 bg-purple-500/[0.04] p-4">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <p className={sectionLabel}>Company information</p>
                  <ManagedTag owner={org.ownerInherited} />
                </div>
                <p className="text-gray-500 text-xs mb-3">
                  {org.ownerInherited
                    ? "These are set on your office's Branding page and appear on every card on your team — yours included."
                    : "Your organization keeps these details up to date on every connected card."}
                </p>
                <dl className="space-y-1.5">
                  {orgLogo && (
                    <div className="flex items-center justify-between gap-3">
                      <dt className="text-gray-500 text-xs">Company logo</dt>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <dd><img src={orgLogo} alt="Company logo" className="w-8 h-8 rounded-lg object-contain bg-white p-0.5" /></dd>
                    </div>
                  )}
                  {([
                    orgCompany && { k: "Card nickname", v: orgCompany },
                    orgCompany && { k: "Company name", v: orgCompany },
                    orgPhone && { k: "Office phone", v: orgPhone },
                    orgFax && { k: "Fax", v: orgFax },
                    orgAddress && {
                      k: "Address",
                      v: [orgAddress.street, orgAddress.unit, orgAddress.city, orgAddress.state, orgAddress.zip]
                        .filter((v) => (v ?? "").toString().trim()).join(", "),
                    },
                    orgWebsite && { k: "Website", v: orgWebsite },
                  ].filter(Boolean) as { k: string; v: string }[]).map((b) => (
                    <div key={b.k} className="flex items-center justify-between gap-3">
                      <dt className="text-gray-500 text-xs shrink-0">{b.k}</dt>
                      <dd className="text-gray-300 text-xs font-medium truncate">{b.v}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}

            {/* A team with nothing set yet: say who owns the company half,
                instead of those fields silently not being there. */}
            {org && !(orgCompany || orgWebsite || orgPhone || orgFax || orgAddress || orgLogo) && (
              <p className="rounded-2xl border border-purple-500/20 bg-purple-500/[0.04] px-4 py-3 text-gray-400 text-xs leading-relaxed">
                Your organization manages the company details — name, logo, website and office contact — on every team card. You edit your own details below.
              </p>
            )}

            {/* Four boxed groups instead of one long column (owner, 2026-09-29:
                "make that page look much more organized to the human eye"):
                About you, How people reach you, Location, Card nickname — the
                same FormSection boxes, in the same order, as the create-card
                wizard. Fields, placeholders and data-hydrate keys unchanged.

                Company-level fields are the ORGANIZATION's territory for a
                sub-user — hidden whether or not the admin filled them in, so a
                member can never add their own company info. (Owner decision,
                Jul 2026: gate on `org`, not per-field values.) A group left
                with nothing to show is not drawn at all. */}
            <FormSection id="about" title="About you">
              <div>
                <label htmlFor="card-name" className="block text-xs font-medium text-gray-400 mb-1.5">Full name <span className="text-red-500">*</span></label>
                <input id="card-name" type="text" placeholder="John Smith" data-hydrate="name" maxLength={CARD_FIELD_MAX.name} value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
                {/* A member has no company field, which is where the URL editor
                    lives for everyone else — so they could never change their
                    card's address, although it is theirs (the rename API allows
                    it). */}
                {org && <CardUrlEditor cardId={card.id} currentSlug={card.username} />}
              </div>
              <div>
                <label htmlFor="card-title" className="block text-xs font-medium text-gray-400 mb-1.5">Job title</label>
                <input id="card-title" type="text" placeholder="Sales Director" data-hydrate="title" maxLength={CARD_FIELD_MAX.title} value={title} onChange={(e) => setTitle(e.target.value)} className={inputCls} />
              </div>
              {!org && (
                <div>
                  <label htmlFor="card-company" className="block text-xs font-medium text-gray-400 mb-1.5">Company name</label>
                  <input id="card-company" type="text" placeholder="Acme Corp" data-hydrate="company" maxLength={CARD_FIELD_MAX.company} value={company} onChange={(e) => setCompany(e.target.value)} className={inputCls} />
                  <CardUrlEditor cardId={card.id} currentSlug={card.username} />
                </div>
              )}
            </FormSection>

            <FormSection id="reach" title="How people reach you">
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-xs font-medium text-gray-400">Phone numbers</label>
                  <button type="button" onClick={addPhone} className="text-xs font-semibold text-blue-400 hover:text-blue-300">+ Add number</button>
                </div>
                <div className="space-y-2">
                  {/* flex-wrap + min-w-[9rem], like the wizard: inside its box the
                      row is 32px narrower, and at 320px the number field would
                      otherwise be squeezed until you could not read what you
                      typed. The On-card toggle drops to a second line instead. */}
                  {phones.map((p, i) => (
                    <div key={i} className="flex flex-wrap items-center gap-2">
                      {/* Office members don't choose a type — see the wizard: the
                          company number is admin-set and server-injected, so every
                          number added here is a personal mobile. */}
                      {org ? (
                        <span
                          title="Your organization sets the office number — numbers you add are your mobile."
                          className="bg-gray-900 border border-gray-700 text-gray-400 rounded-xl px-3 py-3 text-sm shrink-0"
                        >
                          Mobile
                        </span>
                      ) : (
                        <select
                          aria-label={`Label for phone number ${i + 1}`}
                          value={p.label}
                          onChange={(e) => updatePhone(i, { label: e.target.value as PhoneLabel })}
                          className="bg-gray-900 border border-gray-700 text-gray-200 rounded-xl px-2 py-3 text-sm focus:outline-none focus:border-blue-500 shrink-0"
                        >
                          <option value="mobile">Mobile</option>
                          <option value="office">Office</option>
                        </select>
                      )}
                      <input
                        type="tel"
                        placeholder="+1 (555) 000-0000"
                        value={p.number}
                        maxLength={CARD_FIELD_MAX.phone}
                        onChange={(e) => updatePhone(i, { number: e.target.value })}
                        className={`${inputCls} flex-1 min-w-[9rem]`}
                      />
                      <button
                        type="button"
                        onClick={() => updatePhone(i, { showOnCard: !p.showOnCard })}
                        title={p.showOnCard ? "Showing on card" : "Hidden from card"}
                        // gray-400, not gray-500: same button as the wizard, same
                        // reason — gray-500 on gray-900 is 3.67:1, under the 4.5:1
                        // this 12px label needs (see NewCardWizard "Off card").
                        className={`shrink-0 px-3 py-2.5 rounded-xl text-xs font-semibold border transition-colors ${p.showOnCard ? "bg-blue-600 border-blue-600 text-white" : "bg-gray-900 border-gray-700 text-gray-400"}`}
                      >
                        {p.showOnCard ? "On card ✓" : "Off card"}
                      </button>
                      {phones.length > 1 && (
                        <button type="button" onClick={() => removePhone(i)} className="shrink-0 text-gray-600 hover:text-red-400 px-1 text-lg leading-none" aria-label="Remove number">×</button>
                      )}
                    </div>
                  ))}
                </div>
                <p className="text-gray-600 text-xs mt-1.5">
                  {org ? "Numbers you add are your mobile. Pick which show on your card." : "Pick which numbers show on your card."}
                </p>
                {phones.filter((p) => p.showOnCard && p.number.trim()).length > MAX_CARD_PHONES && (
                  <p className="text-amber-300 text-xs mt-1">
                    Only {MAX_CARD_PHONES} numbers fit on your card — the first {MAX_CARD_PHONES} marked On card are shown. The rest stay saved.
                  </p>
                )}
                {org && orgPhone && (
                  <p className="text-gray-500 text-xs mt-1">
                    Your office number ({orgPhone}) is added to your card automatically by your organization.
                  </p>
                )}
              </div>
              <div>
                <label htmlFor="card-email" className="block text-xs font-medium text-gray-400 mb-1.5">Email</label>
                <input id="card-email" type="email" placeholder="john@company.com" data-hydrate="email" maxLength={CARD_FIELD_MAX.email} value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} />
              </div>

              {/* Website is CARD information — it renders on the card itself (and
                  on Swift Links too), so it's asked here with the other card
                  fields, not on the Socials tab. Company-level for a sub-user:
                  the org decides it, so members never get the input. */}
              {!org && (
                <div>
                  <label htmlFor="card-website" className="block text-xs font-medium text-gray-400 mb-1.5">Website</label>
                  <input
                    id="card-website"
                    type="text"
                    placeholder="yoursite.com"
                    data-hydrate="website" maxLength={CARD_FIELD_MAX.website} value={website}
                    onChange={(e) => setWebsite(e.target.value)}
                    className={inputCls}
                  />
                </div>
              )}
            </FormSection>

            {!org && (
              <FormSection id="location" title="Location" note="Optional.">
                <AddressInput value={address} onChange={setAddress} />
                <div>
                  <label htmlFor="card-fax" className="block text-xs font-medium text-gray-400 mb-1.5">
                    Fax number <span className="text-gray-600 font-normal">· shows on your card only</span>
                  </label>
                  <input id="card-fax" type="tel" maxLength={CARD_FIELD_MAX.fax} placeholder="+1 (555) 000-0000" value={fax} onChange={(e) => setFax(e.target.value)} className={inputCls} />
                </div>
              </FormSection>
            )}

            {/* Last: it never appears on the card — it only names the card on
                the dashboard. Not for the primary card (it saves through
                /api/profile, which has no label) or an office member. */}
            {!isPrimary && !org && (
              <FormSection id="nickname" title="Card nickname" required labelFor="card-nickname" note="Only you see this — it names the card on your dashboard.">
                <input
                  id="card-nickname"
                  ref={nicknameInputRef}
                  type="text"
                  placeholder="e.g. Sales Card"
                  value={label}
                  aria-required="true"
                  aria-invalid={nicknameMissing || undefined}
                  onChange={(e) => {
                    setLabel(e.target.value);
                    if (nicknameMissing && e.target.value.trim()) { setNicknameMissing(false); setError(""); }
                  }}
                  className={`${inputCls}${nicknameMissing ? " ring-2 ring-red-500/70 border-red-500" : ""}`}
                />
              </FormSection>
            )}

            {/* Mobile: the card preview sits at the BOTTOM of this step, after
                the last field, so the form starts at the top of the screen. */}
            {mobileCardPreview("Your changes appear here instantly.")}
          </div>
        )}

        {/* ── CARD DESIGN — Photos · Template · numbered design steps (matches
            the wizard's step 2). Photos stay editable even under an office
            design lock: the lock covers template/colors, never someone's own
            headshot. ── */}
        {tab === "design" && (
          <div className="space-y-5 sc-step-in">
            {/* Phone: the card sits at the top of the tab and stays pinned to
                the top of the screen while every control below scrolls under
                it. Not while the custom designer is open — that IS the card. */}
            {!(customSelected && isPro && !designLocked) && (
              <PinnedCardPreview undo={cardHistory}>{cardTemplateEl}</PinnedCardPreview>
            )}
            {/* Photos — open while something is missing, folded to a one-row
                summary once both are set, so a returning owner lands on the
                design rather than on two upload blocks. `photosStartOpen` is
                computed once at mount: a live value would snap the section shut
                the moment an upload finished. Native <details>: works before
                hydration. */}
            <MoreOptions
              label="Logo & headshot"
              hint={photosSummary}
              defaultOpen={photosStartOpen}
              lead={
                <span className="flex -space-x-2 shrink-0" aria-hidden>
                  {[liveLogoUrl, photoState].map((src, i) =>
                    src ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img key={i} src={src} alt="" className={`w-7 h-7 border-2 border-gray-900 bg-white object-contain ${i === 1 ? "rounded-full object-cover" : "rounded-lg"}`} />
                    ) : (
                      <span key={i} className={`w-7 h-7 border-2 border-gray-900 bg-gray-800 ${i === 1 ? "rounded-full" : "rounded-lg"}`} />
                    ),
                  )}
                </span>
              }
            >
              {/* Company logo is editable only on a NON-office card. Every card
                  under an office (org set — employee or owner alike) inherits
                  the brand logo, which is set on the office Branding page; the
                  upload is hidden here so a manual change can't be attempted
                  and silently reverted. */}
              {!org && (
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1.5">Company logo</label>
                  {/* defer: the logo waits for Save, like the headshot below and the
                      builder. Without it an upload or Remove wrote cards.logo_url
                      on the spot — live even after Cancel — and because the row
                      already held the new logo when Save ran, the save saw "no
                      change": no signature refresh, no Wallet pass update. */}
                  <ImageUpload field="logo" currentUrl={cardLogoUrl} label="Upload your company logo" shape="square" cardId={logoCardId} defer onUploaded={(url) => setCardLogoUrl(url || null)} />
                  <LogoSuggest company={company} email={email} website={website} onConfirm={(url) => setCardLogoUrl(url || null)} />
                  {cardLogoUrl && (
                    <div className="mt-2">
                      {/* Was a hand-rolled pair of buttons whose SELECTED state
                          was bg-gray-700 sitting on a bg-gray-800 track — two
                          greys one step apart, which on a phone in daylight
                          told you nothing about which shape was active. Now the
                          shared Segmented: filled blue, like every other
                          either/or choice in the editor. */}
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
                      <p className="text-[0.6875rem] text-gray-500 mt-1.5 leading-snug">
                        {logoShape === "circle" ? "Your full logo inside a clean circle — nothing gets cut off." : "Adapts to your logo — square, wide, or banner."}
                      </p>
                    </div>
                  )}
                  {!isPrimary && <p className="text-[0.6875rem] text-gray-600 mt-1">Per-card logo (different from your profile logo)</p>}
                </div>
              )}
              {org && !orgLogo && (
                <p className="text-[0.6875rem] text-gray-500">
                  {org.ownerInherited
                    ? "Your company logo is set on your office's Branding page — add it there and it appears on every card."
                    : "Your company logo is managed by your organization."}
                </p>
              )}
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1.5">Headshot</label>
                <ImageUpload
                  field="photo"
                  currentUrl={photoState}
                  label="Upload your headshot"
                  hint="Recommended. This will also be used for your SwiftLink."
                  shape="circle"
                  defer
                  onUploaded={(url) => setPhotoState(url || null)}
                />
                <ProfilePhotoSuggest
                  linkedinEnabled={linkedinEnabled}
                  returnTo={`/cards/${card.id}/edit`}
                  onConfirm={(url) => setPhotoState(url)}
                />
              </div>
            </MoreOptions>

            {/* Template + look — locked for sub-users while the office's Lock
                Card Design setting is on. The server rejects locked-design
                writes regardless; this just makes the rule visible. */}
            {designLocked ? (
              <div className="rounded-2xl border border-purple-500/20 bg-purple-500/[0.04] p-5">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <p className={sectionLabel}>Card design</p>
                  <ManagedTag />
                </div>
                <p className="text-gray-400 text-sm leading-relaxed">
                  Your organization keeps every card matching, so the template, colors, fonts,
                  finish and panel background are set by your Office admin. If they turn off the design lock, you&apos;ll be able
                  to customize your card&apos;s look right here.
                </p>
              </div>
            ) : (
            <div className="space-y-5">
              <TemplatePicker
                template={template}
                onSelect={setTemplate}
                data={withoutSocials(previewData)}
                customUnlocked={isPro}
                proTags={!isPro}
              />

              {/* The designer comes AFTER the picker that selects it, and brings
                  its own live card — so it replaces the inline preview rather than
                  sitting beside a second one. */}
              {customSelected && isPro ? (
                <CustomCardDesigner layout={customLayout} data={previewData} onChange={setCustomLayout} canScan={isPro} undo={cardHistory} />
              ) : null}

              {/* Restyle the chosen preset, one numbered step at a time. Looks,
                  swatches, fonts and three finishes are EVERY plan; only "any
                  colour", the Pro finishes (and the Looks built on them) and a
                  panel photo/video are Pro — and on Free each of those carries
                  a light-blue PRO tag (proTags). The wall is Save Changes,
                  where the full offer opens. */}
              {!customSelected && (
                <TemplateStyleControls value={templateStyleState} onChange={patchTemplateStyle} template={template} locked={!isPro} proTags={!isPro} />
              )}
            </div>
            )}
          </div>
        )}

        {/* ── SHARING (Swift Links page) ── */}
        {tab === "sharing" && (
          <div className="space-y-5 sc-step-in">
            <p className="text-gray-400 text-xs leading-relaxed">
              These go on your <strong className="text-gray-200">Swift Links</strong> page — the page people open from your card.
            </p>

            {/* Three boxed groups — Bio, Social profiles, Additional links —
                instead of one long column (owner, 2026-09-29: "it looks like a
                whole mishmash"). The shared pieces are FormSection,
                SocialHandleField and AddLinkForm, the same ones the create-card
                wizard, the homepage builder and Office Links branding use. */}
            {/* Bio. The office can write one bio for the whole team. When it
                has, the field is read-only rather than editable-then-overwritten:
                the server replaces it on save, so an editable box here would
                quietly throw their words away. */}
            <FormSection
              id="bio"
              title="Bio"
              labelFor="card-bio"
              required={!bioManaged}
              trailing={bioManaged ? <ManagedTag owner={org?.ownerInherited} /> : undefined}
              note={bioManaged
                ? "Your company writes one bio for the whole team. Yours is saved and comes back if they stop."
                : "Who you help and what you do — the first thing people read. AI follow-ups use it too."}
            >
              <div>
                <textarea
                  id="card-bio"
                  value={bioManaged ? (org?.linkBio ?? "") : bio}
                  data-hydrate="bio"
                  onChange={(e) => {
                    setBio(e.target.value);
                    if (bioMissing && e.target.value.trim()) { setBioMissing(false); setError(""); }
                  }}
                  readOnly={bioManaged}
                  required={!bioManaged}
                  aria-invalid={bioMissing || undefined}
                  rows={3}
                  placeholder="e.g. Austin realtor helping first-time buyers find their dream home — 10+ years, 200+ closings. Let's talk!"
                  className={`${inputCls} resize-none ${bioManaged ? "opacity-70 cursor-default" : ""}${bioMissing ? " ring-2 ring-red-500/70 border-red-500" : ""}`}
                />
                {bioMissing && <p className="text-red-400 text-xs mt-1">Add a bio to save your card.</p>}
              </div>
            </FormSection>

            {/* Social profiles (website lives on the Card info tab — it's card
                information). Each box shows the start of its link, so "what do
                I type?" is answered before anything is typed. */}
            <FormSection id="socials" title="Social profiles" note="Type your username — or paste your profile link.">
              <div className="space-y-3.5">
                {SOCIALS.map((spec) => {
                  // Instagram is the ONE social an office can set. Every other
                  // one stays the member's, by the owner's explicit rule. A page
                  // has ONE Instagram button, so the company's is the one it
                  // shows — and the note says plainly that their own handle
                  // still exists, or a greyed box holding someone else's handle
                  // reads as "mine was deleted".
                  const managed = spec.key === "instagram" && instagramManaged;
                  return (
                    <SocialHandleField
                      key={spec.key}
                      spec={spec}
                      id={`card-social-${spec.key}`}
                      value={managed ? (org?.linkInstagram ?? "") : socials[spec.key]}
                      onChange={(v) => setSocial(spec.key, v)}
                      onBlur={() => normalizeOnBlur(spec.key)}
                      managed={managed}
                      managedTag={<ManagedTag owner={org?.ownerInherited} />}
                      managedNote="Your page shows the company Instagram. Yours is saved and comes back if they stop."
                    />
                  );
                })}
              </div>
            </FormSection>

            {/* Additional links.

                An office can PIN links to every member's page. Those lead the
                list, are tinted and labelled "Company", and have no remove
                control — the server re-pins them on save, so a control there
                would silently undo itself. Everything the member adds follows
                and stays entirely theirs, which is the point: an office wants
                its booking link on every page, not to stop a salesperson
                linking their own calendar. */}
            <FormSection
              id="links"
              title="Additional links"
              trailing={officeLinks?.length ? <ManagedTag owner={org?.ownerInherited} /> : undefined}
              note={officeLinks?.length
                ? "Your company's links come first. Add your own below."
                : "Buttons on your page that open any website."}
            >
              {links.length > 0 && (
                <div className="space-y-2">
                  {links.map((l, i) =>
                    l.kind === "header" ? (
                      // A section header — label only, editable in place.
                      <div key={i} className={`flex items-center gap-2.5 border border-dashed rounded-xl px-3 py-2.5 ${isOfficeRow(l) ? "bg-purple-500/[0.06] border-purple-500/25" : "bg-gray-900 border-gray-700"}`}>
                        <span className="text-[0.5625rem] font-bold uppercase tracking-wide text-gray-500 shrink-0">Section</span>
                        <input
                          type="text"
                          value={l.label}
                          onChange={(e) => setLinks((prev) => prev.map((x, xi) => (xi === i ? { ...x, label: e.target.value } : x)))}
                          placeholder="Section title (e.g. Watch)"
                          readOnly={isOfficeRow(l)}
                          className={`flex-1 min-w-0 bg-transparent text-gray-200 text-xs font-bold uppercase tracking-wide focus:outline-none placeholder-gray-600 ${isOfficeRow(l) ? "cursor-default opacity-80" : ""}`}
                        />
                        {/* A company section is re-pinned by the server on every
                            save, so an × here would silently undo itself — the
                            same reason a company LINK carries a word instead. */}
                        {isOfficeRow(l) ? (
                          <span className="text-[0.5625rem] font-semibold uppercase tracking-wide text-purple-300 shrink-0">Company</span>
                        ) : (
                          <button type="button" onClick={() => removeLink(i)} aria-label="Remove section" className="text-gray-600 hover:text-red-400 transition-colors text-lg leading-none shrink-0">×</button>
                        )}
                      </div>
                    ) : (
                    <div key={i} className={`rounded-xl px-3 py-2.5 border ${isOfficeRow(l) ? "bg-purple-500/[0.06] border-purple-500/25" : "bg-gray-900 border-gray-700"}`}>
                      <div className="flex items-center gap-2.5">
                        <LinkPreviewThumb url={l.url} />
                        <div className="flex-1 min-w-0">
                          <p className="text-gray-200 text-xs font-semibold truncate">{l.label}</p>
                          <p className="text-gray-500 text-[0.625rem] truncate">{l.url}</p>
                        </div>
                        {/* An office link carries a word, not a disabled button:
                            the server re-pins it on save, so a remove control
                            here would silently undo itself. The member's own
                            links keep theirs. */}
                        {isOfficeRow(l) ? (
                          <span className="text-[0.5625rem] font-semibold uppercase tracking-wide text-purple-300 shrink-0">Company</span>
                        ) : (
                          <button type="button" onClick={() => removeLink(i)} aria-label={`Remove ${l.label}`} className="text-gray-600 hover:text-red-400 transition-colors text-lg leading-none shrink-0">×</button>
                        )}
                      </div>
                      {/* How the link LOOKS on the page (Featured / Grid /
                          Compact, its preview, its row style) is chosen per
                          link on the Social design tab — see LinkButtonsControls. */}
                    </div>
                    ),
                  )}
                </div>
              )}
              {atLinkCap ? (
                <PlanGate
                  feature="swift-links-cap"
                  nativeCopy="Pro feature — Free includes 2 links. More links are only available on the Pro plan"
                >
                  <p className="text-[0.6875rem] text-gray-500 bg-gray-900 border border-gray-800 rounded-xl px-3 py-2.5 leading-relaxed">
                    Free includes {PLAN_LIMITS.FREE_MAX_LINKS} additional links. <Link href="/upgrade" className="text-blue-400 font-semibold hover:text-blue-300">Upgrade to Pro</Link> to access unlimited additional links.
                  </p>
                </PlanGate>
              ) : (
                <AddLinkForm value={newLink} onChange={setNewLink} onAdd={addLink} idPrefix="card-link" />
              )}
              {/* Section headers — chapters for a long page. Pro, like the
                  tile sizes: Free pages don't render them. OUTSIDE the
                  links-exist wrapper so a header can open the page's first
                  section before any link has been added. Last and quiet: it is
                  an extra, not the first thing to do. */}
              {isPro && (
                <button
                  type="button"
                  onClick={() => setLinks((prev) => [...prev, { label: "", url: "", kind: "header" as const }])}
                  className="block text-[0.6875rem] font-semibold text-gray-400 hover:text-gray-200 transition-colors"
                >
                  + Add a section header
                </button>
              )}
            </FormSection>

            {/* Mobile: the SWIFT LINKS preview, not the card one. This step
                edits the bio, socials and link buttons — none of which appear on
                the card — so showing a card preview here was previewing the
                wrong thing. Placed after the links so it reflects everything
                above it. */}
            {mobileLinkPreview("Your bio, socials and links appear here.")}
          </div>
        )}

        {/* ── SOCIAL DESIGN — the Swift Links page's look, with a live preview
            of the page itself. Separate keys from the card design, so the two
            tabs never fight over the same values. ── */}
        {tab === "linkdesign" && (
          <div className="space-y-4 sc-step-in">
            {/* Phone: the Swift Links page sits at the top of the tab and stays
                pinned while every control below scrolls under it; tap it to see
                the whole page. */}
            <PinnedLinkPreview undo={linkHistory}>{linkPreviewInner}</PinnedLinkPreview>
            {/* The per-link "Link buttons" section edits the SAME links array
                the office may have locked. Its controls render only when both
                props are passed, so when the office holds the links they are
                omitted rather than shown and then silently reverted by the
                server on save — and a line below says why the section is gone,
                instead of leaving a hole. */}
            {linkDesignLocked ? (
              // The office holds this page's LOOK, the mirror of "Keep every
              // card matching" on the card side. The whole panel is replaced by
              // one explanation rather than shown disabled: every control here
              // would be reverted on save, and a dead control with no reason is
              // what generates a support ticket.
              <div className="rounded-2xl border border-purple-500/20 bg-purple-500/[0.04] p-5">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <p className={sectionLabel}>Swift Links design</p>
                  <ManagedTag owner={org?.ownerInherited} />
                </div>
                <p className="text-gray-400 text-sm leading-relaxed">
                  Your organization keeps every Swift Links page matching, so the look, colors,
                  fonts and page background are set by your Office admin. Your bio, your socials
                  and your own link buttons are still yours.
                </p>
                {/* The page LOOK is the office's, but each member's OWN link
                    buttons are still theirs to style (owner, 2026-09-16).
                    Company rows show here tagged and fixed. */}
                {links.some((l) => l.kind !== "header" && !isOfficeRow(l)) && (
                  <div className="mt-4 pt-4 border-t border-purple-500/15">
                    <p className="text-gray-200 text-[0.8125rem] font-semibold">Your link buttons</p>
                    <p className="text-gray-500 text-[0.6875rem] leading-snug mb-2">Choose how each of your own links appears: Featured, Grid or Compact.</p>
                    <LinkButtonsControls links={links} onChange={setLinks} pageRowStyle={linkStyleState.linkButtonStyle} pageGlass={!!linkStyleState.linkGlass && !!linkStyleState.linkBgMedia} isLocked={isOfficeRow} />
                  </div>
                )}
              </div>
            ) : (
              <SwiftLinkStyleControls
                value={linkStyleState}
                onChange={patchLinkStyle}
                locked={!isPro}
                links={links}
                onLinksChange={setLinks}
                isLinkLocked={isOfficeRow}
              />
            )}
            {/* Last, after the design steps, in plain words (owner, 2026-09-29:
                nobody knew what "Show the 'View SwiftCard' button" meant, and it
                sat above step 1). Same on/off, same wiring — the small
                "View SwiftCard →" link at the bottom of the Swift Links page.
                The shared Switch: the whole row is the target. */}
            <Switch
              checked={showCardLinkBtn}
              onChange={setShowCardLinkBtn}
              label="Link to your business card"
              help="A small link at the bottom of your page that opens your card."
            />
            {/* Same removal as the Card design tab above: the offer belongs
                on Save Changes, not parked under the controls. */}
            {/* On DESKTOP the page preview renders in the pinned right column,
                where it REPLACES the card preview on this tab — the Swift Links
                page is what's being styled. Mobile's copy is at the top of this
                tab, above the controls. */}
          </div>
        )}

        {error && (
          viewOnly ? (
            <PlanGate
              feature="card-view-only"
              nativeCopy="This card is view-only. Editing multiple cards is only available on the Pro plan"
            >
              <p className="text-red-400 text-sm mt-4">
                {error} <Link href="/upgrade" className="underline font-semibold text-blue-400 hover:text-blue-300">Upgrade to Pro</Link>
              </p>
            </PlanGate>
          ) : (
            <p className="text-red-400 text-sm mt-4">{error}</p>
          )
        )}

        {/* Actions */}
        {confirmDiscard && dirty && (
          <div role="alert" className="mt-6 rounded-xl border border-amber-800/50 bg-amber-950/40 px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
            <p className="text-amber-200 text-sm font-medium">Discard your unsaved changes?</p>
            <div className="flex items-center gap-2 shrink-0">
              <button type="button" onClick={() => setConfirmDiscard(false)} className="text-sm font-semibold text-white bg-gray-800 hover:bg-gray-700 border border-gray-700 px-4 py-2 rounded-full transition-colors">
                Keep editing
              </button>
              <DashboardLink card={card.username} className="text-sm font-semibold text-white bg-red-600 hover:bg-red-500 px-4 py-2 rounded-full transition-colors">
                Discard
              </DashboardLink>
            </div>
          </div>
        )}
        <div className="flex gap-3 mt-6">
          {dirty && !confirmDiscard ? (
            <button type="button" onClick={() => setConfirmDiscard(true)} className="flex-1 text-center border border-gray-700 text-gray-400 hover:border-gray-500 font-semibold py-3 rounded-full transition-colors text-sm">
              Cancel
            </button>
          ) : (
            <DashboardLink card={card.username} className="flex-1 text-center border border-gray-700 text-gray-400 hover:border-gray-500 font-semibold py-3 rounded-full transition-colors text-sm">
              Cancel
            </DashboardLink>
          )}
          <button
            onClick={() => handleSave()}
            disabled={status === "saving"}
            // Background as a CLASS, not an inline style. The light theme
            // recolours .text-white to ink and makes an exception only when the
            // bg-* class sits on the same element (globals.css) — an inline
            // background missed that exception, so the primary Save button was
            // dark-on-blue at 3.43:1 in light mode.
            className={`flex-[2] font-semibold py-3 rounded-full transition-colors text-sm text-white disabled:opacity-50 ${status === "saved" ? "bg-green-600" : "bg-blue-600"}`}
          >
            {saveLabel}
          </button>
        </div>
      </div>

      {/* ── LIVE PREVIEW — DESKTOP ONLY, pinned to the right.
          hidden lg:block: on mobile each step renders its own preview inline,
          beside the controls that change it (see mobileCardPreview /
          mobileLinkPreview above). This column used to be order-1 on mobile,
          which put a preview above the entire form on every step.
          BOTH Swift Links tabs — Socials and Social design — show the Swift
          Links page preview instead of the card. Socials edits the bio, the
          social handles and the link buttons; none of those appear on the card
          at all, so previewing the card there showed a picture that could not
          respond to anything being typed. Mobile has done this since the
          per-step previews landed; this brings desktop in line. ── */}
      {/* Not rendered at all while the designer is the canvas — a class-level
          hide would leave the grid's 340px track claimed by an empty column. */}
      {!designerIsCanvas && (
      <div className="hidden lg:block order-1 lg:order-2 lg:sticky lg:top-6">
        {/* Keyed by WHICH preview: card → Swift Links fades across; two tabs
            that share a preview keep it mounted (no flicker). */}
        <div key={tab === "linkdesign" || tab === "sharing" ? "links" : "card"} className="sc-step-in">
        {tab === "linkdesign" || tab === "sharing" ? (
          <>
            <div className="flex items-center justify-between gap-2 mb-2">
              <p className="text-[0.6875rem] font-semibold text-gray-400 uppercase tracking-wide">
                Your Swift Links page — this is how it will look
              </p>
              {tab === "linkdesign" && <UndoDesignButton history={linkHistory} variant="pill" className="shrink-0" />}
            </div>
            {linkPreviewInner}
            <p className="text-gray-600 text-[0.6875rem] mt-2 leading-snug">
              {tab === "sharing"
                ? "Your bio, socials and links appear here as you add them."
                : "It updates live as you pick colors and fonts."}
            </p>
          </>
        ) : (
          <>
            <div className="flex items-center justify-between mb-2">
              <p className="text-[0.6875rem] font-semibold text-gray-400 uppercase tracking-wide">Live preview</p>
              {/* "View live" removed entirely (owner request) — both the header and
                  this preview link are gone from the card editor. The slot holds
                  Card design's Undo instead. */}
              {tab === "design" && <UndoDesignButton history={cardHistory} variant="pill" />}
            </div>
            {cardPreviewInner}
            {/* Only Card info and Card design reach this branch now, and both
                edit the card itself — so the old "the card above only shows
                your name, title & contact details" apology for the Socials tab
                is gone with the branch that needed it. */}
            <p className="text-gray-600 text-[0.6875rem] mt-2 leading-snug">Your changes appear here instantly.</p>
          </>
        )}
        </div>
      </div>
      )}
      {proBlock && (
        <ProRequiredDialog
          features={proBlock}
          trialEligible={trialEligible}
          busy={status === "saving"}
          onCancel={() => setProBlock(null)}
          onSaveWithoutPro={() => handleSave({ allowFreeConversion: true, design: applyFreeDesign() })}
        />
      )}
    </div>
  );
}
