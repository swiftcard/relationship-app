"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import ImageUpload from "@/components/ImageUpload";
import DashboardLink from "@/components/DashboardLink";
import LogoSuggest from "@/components/LogoSuggest";
import ProfilePhotoSuggest from "@/components/ProfilePhotoSuggest";
import EnablePushButton from "@/components/EnablePushButton";
import { GetTheAppCard } from "@/components/AppStoreBadge";
import CardScaler from "@/components/CardScaler";
import { DEFAULT_PRESET, buildPreset } from "@/lib/custom-layout";
import InertPreview from "@/components/InertPreview";
import ClassicPro from "@/components/card-templates/ClassicPro";
import CustomCard from "@/components/card-templates/CustomCard";
import CustomCardDesigner from "@/components/CustomCardDesigner";
import { PlanGate, PlanNotice } from "@/components/PlanGate";
import { isNativeApp } from "@/lib/platform";
import TemplateStyleControls from "@/components/card-templates/TemplateStyleControls";
import TemplatePicker, { PRESET_TEMPLATES } from "@/components/card-templates/TemplatePicker";
import LinkButtonsControls from "@/components/LinkButtonsControls";
import PinnedCardPreview, { PinnedLinkPreview } from "@/components/PinnedCardPreview";
import UndoDesignButton from "@/components/UndoDesignButton";
import { useDesignHistory, useUndoShortcut, changedKeys } from "@/lib/use-design-history";
import AddressInput, { EMPTY_ADDRESS } from "@/components/AddressInput";
import { withoutSocials } from "@/components/card-templates/types";
import type { TemplateStyle } from "@/components/card-templates/shared";
import type { CardAddress, CardData, CardLink, CardPhone, PhoneLabel, CustomLayout } from "@/components/card-templates/types";
import { socialUrl, socialDestination } from "@/lib/social-url";
import { SOCIAL_INPUTS, socialHint } from "@/lib/social-input";
import { cardSlug, prettyCardSlug } from "@/lib/slug";
import { useGuestDraft, draftHasWork, draftStore, accountDraftKey, GUEST_DRAFT_KEY, type GuestDraft } from "@/lib/guest-draft";
import { resetMarketingSketch } from "@/lib/guest-reset";
import { consumePrefill, hasSketchContent, PREFILL_STYLE_KEYS, PREFILL_LINK_STYLE_KEYS, PREFILL_CARD_MEDIA_KEYS, PREFILL_LINK_MEDIA_KEYS, type CardPrefill } from "@/lib/prefill";
// Shared with the edit form + server so a social typed here connects to the
// same URL everywhere (blur, save, guest-draft snapshot all normalize).
import { normalizeSocial } from "@/lib/social-url";
import { track } from "@/lib/events";
import { PLAN_LIMITS, PRO_CUSTOMIZATION_KEYS, LINK_STYLE_KEYS, LINK_STRUCTURAL_KEYS, convertCustomizationToFreeClosest, describeFreeDesignChanges, proLinkFeaturesInUse } from "@/lib/plan";
import { SwiftLinkStyleControls, type SwiftLinkStyle } from "@/components/SwiftLinkDesign";
import { MoreOptions, Segmented, Switch } from "@/components/ui/DesignControls";
import SwiftLinkLivePreview from "@/components/SwiftLinkLivePreview";
import PlanCards from "@/components/PlanCards";
import FreeDesignChoice from "@/components/FreeDesignChoice";
import GuestGateModal from "@/components/GuestGateModal";
import ReferralGiftPanel from "@/components/ReferralGiftPanel";
import ForceLightTheme from "@/components/ForceLightTheme";
import { unitLine } from "@/lib/address-unit";

type SocialKey = "linkedin" | "instagram" | "tiktok" | "facebook" | "twitter" | "snapchat" | "youtube";

// The one place that decides what a person is told to type in a social box
// lives in lib/social-input — see the note there. Every row now asks for the
// same thing (a username) instead of a URL on some rows and a handle on others.
const SOCIALS = SOCIAL_INPUTS;

// For these URL-style networks, show the exact format to copy so the link works.
type Socials = Record<SocialKey, string>;
const EMPTY_SOCIALS: Socials = {
  linkedin: "", instagram: "", tiktok: "", facebook: "", twitter: "", snapchat: "", youtube: "",
};



const inputCls =
  "w-full bg-gray-900 border border-gray-700 text-white placeholder-gray-600 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-blue-500 transition-colors";

// The control at the top-left of every wizard step — "Back" on steps 2–4, the
// way out ("Home" / "Dashboard") on step 1 and the success screen. ONE string
// for all three so they cannot drift: it is the same slot in the same place, and
// it must look and feel identical whichever one is rendered.
//
// `w-fit` is load-bearing. A bare flex container is a BLOCK, so the "Home" link
// stretched the full 896px of the column and every pixel of that invisible strip
// was a live click target — and clicking it used to wipe the whole unfinished
// draft. A stray click well to the right of the word "Home" silently destroyed
// the card. (Home no longer wipes anything but the marketing sketch — see
// resumeChoice.) The target is now the text and its arrow, nothing more.
//
// `cursor-pointer` because the same slot renders as an <a> on step 1 and a
// <button> on steps 2–4, and a button would otherwise show the plain arrow
// cursor while the link shows a hand. Same control, same place — it has to feel
// the same on every step.
// Is this page load the SAME builder visit carrying on, rather than a fresh
// entry from a button? Those resume an unfinished card without asking:
//   • ?claim=1 — back from the account gate (login / sign-up) for this draft
//   • ?li_photo= / ?integration= — back from the guest LinkedIn photo import
//   • a reload or browser Back/Forward whose document IS /cards/new
// Every "Get started free"-style link is a plain navigation, so it asks. The
// pathname check matters: after reloading /pricing, a click into the builder is
// a client-side route change and the navigation entry still says "reload".
function resumesSilently(): boolean {
  if (typeof window === "undefined") return false;
  const sp = new URLSearchParams(window.location.search);
  if (sp.get("claim") === "1" || sp.has("li_photo") || sp.has("integration")) return true;
  try {
    const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    return !!nav && (nav.type === "reload" || nav.type === "back_forward") && new URL(nav.name).pathname === "/cards/new";
  } catch {
    return false;
  }
}

const topControlCls =
  "text-gray-500 hover:text-white text-sm transition-colors flex items-center gap-1.5 mb-8 w-fit cursor-pointer";

// Company information owned by the user's Office organization (sub-users only).
// Managed fields are shown as already prepared instead of asked for; blanks the
// office left stay editable. `lockDesign` mirrors the office's Lock Card Design.
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
  /** That look, so the preview shows it while lockLinkDesign is on. */
  linkDesign?: Record<string, unknown> | null;
  // The office's locked look — so the sub-user's LIVE PREVIEW shows the real
  // template + colors/fonts while they build, not a default that only snaps to
  // the brand after saving. Only meaningful when lockDesign is true.
  template: string | null;
  design: Record<string, unknown> | null;
  customLayout: unknown | null;
};

// Small "who owns this field" tag shown next to org-controlled values.
function ManagedTag() {
  return (
    <span className="inline-flex items-center gap-1 text-[0.625rem] font-semibold text-purple-300 bg-purple-500/10 border border-purple-500/25 rounded-full px-2 py-0.5">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-2.5 h-2.5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
      </svg>
      Managed by your organization
    </span>
  );
}

// Guest mode: a signed-out visitor can build a full card without an account. The
// server wrapper (cards/new/page.tsx) passes guest={!user}. Every change is
// snapshotted to a localStorage draft; the "Create card" action is gated behind
// auth (requireAuth) and the draft is claimed → real card after they sign in.
// Social design's per-link look, and the link it belongs to (see CardEditForm).
function linkKeyOf(l: CardLink): string {
  return `${l.kind ?? "link"}|${l.label}|${l.url}`;
}
function linkStyleOf(l: CardLink) {
  return { k: linkKeyOf(l), size: l.size, rowStyle: l.rowStyle, glass: l.glass, media: l.media };
}

export default function NewCardWizard({ isPro, guest = false, isFirstCard = false, trialEligible = true, referralGift = false, tourOnDone = false, org = null, linkedinEnabled = false, draftOwner = null }: {
  isPro: boolean;
  /** A friend's free month is waiting (server-resolved): offered in the plan gate. */
  referralGift?: boolean;
  /** Whether this account can still get the Pro trial (server-resolved). */
  trialEligible?: boolean;
  guest?: boolean;
  /** The account's FIRST card (count === 0) being built while signed in and on
   *  Free — unlocks the Pro design controls as a preview, same as a guest, then
   *  gates on an explicit Free/Pro choice before the card is created. */
  isFirstCard?: boolean;
  /** This is the account's first card (any plan) — hand off to the dashboard
   *  with the guided tour. Distinct from isFirstCard, the Free design gate. */
  tourOnDone?: boolean;
  /** Absolute origin for the share link/QR — passed in so a preview deploy
   *  shares its own URL rather than hardcoding production. */
  appUrl?: string;
  /** Apple Wallet only when the signing certs are configured, so the button
   *  never offers a download that fails. */
  walletEnabled?: boolean;
  /** Office sub-users only: the org-managed company half of the card. */
  org?: OrgManaged | null;
  /** LinkedIn OAuth configured — enables "Suggest my headshot". */
  linkedinEnabled?: boolean;
  /** Signed in: the account id whose own unfinished-card draft this builder
   *  keeps (lib/guest-draft accountDraftKey). Null for a guest. */
  draftOwner?: string | null;
}) {
  const router = useRouter();
  // After a paid checkout the success page routes the OWNER here to create their
  // card first (it counts as Office seat 1). Every plan finishes on the
  // dashboard with the tour — an Office owner included; the team console is
  // one tap away on its Admin tab (owner, 2026-09-22).
  const searchParams = useSearchParams();
  const postCheckout = searchParams.get("postcheckout");
  // First card → the guided tour starts on the dashboard (the empty-state
  // dashboard deliberately does not run it — nothing to point at yet).
  const doneHref = (postCheckout || isFirstCard || tourOnDone) ? "/dashboard?tour=1" : "/dashboard";
  // A plan-specific CTA (Get Pro / Get Office) routes here with ?plan=… so the
  // visitor still builds their card first, but AFTER account creation goes
  // straight to payment for that plan — no plan chooser again (unified flow).
  // Hero claim box (homepage): /cards/new?name=First — the visitor just typed
  // their name, so it is the freshest intent and wins over a restored draft's.
  const heroName = (searchParams.get("name") ?? "").trim().slice(0, 80);
  const planParam = searchParams.get("plan");
  const presetPlan: "pro" | "office" | null = planParam === "pro" ? "pro" : planParam === "office" ? "office" : null;
  const presetAnnual = searchParams.get("interval") === "annual";
  const presetSeats = Math.max(2, Math.floor(Number(searchParams.get("seats")) || 2));
  const presetPromo = searchParams.get("promo") || null;
  // Only requireAuth from the hook (stable). Autosave uses the raw debounced
  // saveDraft so it never triggers a setState → re-render → save loop.
  const { requireAuth } = useGuestDraft();
  const [step, setStep] = useState(1);
  // Gates the autosave until the stored draft has been read back in.
  const hydratedRef = useRef(false);
  // Set when a fresh entry finds an unfinished card — shows the "Continue your
  // card / Start a new card" question instead of the form (see restoreDraft).
  const [resumeChoice, setResumeChoice] = useState<GuestDraft | null>(null);
  // WHOSE unfinished card this builder keeps. A guest's lives under the guest
  // key (claimed into the account after sign-up). A signed-in account now keeps
  // its OWN, keyed by account id: a refresh used to throw a half-built card
  // away (2026-09-22 signup review). Never for an Office member — their company
  // half comes from the organization, and restoring over it would undo that.
  const canDraft = guest || (!!draftOwner && !org);
  const drafts = useMemo(
    () => draftStore(guest || !draftOwner ? GUEST_DRAFT_KEY : accountDraftKey(draftOwner)),
    [guest, draftOwner],
  );
  // A mini-builder sketch that arrived while that question was open.
  const heldPrefillRef = useRef<CardPrefill | null>(null);
  // Synchronous in-flight guard for card creation. The `disabled` prop only
  // takes effect after React re-renders with status==="loading", so a fast
  // double-tap can fire two POSTs before that — creating two cards (even on
  // Free, whose limit check isn't atomic). A ref flips instantly. (cards audit M3)
  const creatingRef = useRef(false);
  // True once we've actually restored something — drives the "we kept your
  // work" note, so the restore is visible rather than spooky.
  const [restored, setRestored] = useState(false);

  // Advancing (or going back) a step should start the user at the top of the
  // new step. Defer to the next frame so the new content is laid out first, and
  // jump instantly — mobile browsers can drop a smooth scroll issued mid-render.
  useEffect(() => {
    const id = requestAnimationFrame(() => window.scrollTo({ top: 0, left: 0, behavior: "auto" }));
    return () => cancelAnimationFrame(id);
  }, [step]);

  // Top of the funnel: the editor opened. Fires once per mount, not per step.
  useEffect(() => {
    track("card_creation_started", { variant: guest ? "guest" : "authed" });
  }, [guest]);

  // Payment happens on Stripe's side and /checkout/success only ever redirects,
  // so the first moment we can observe a completed purchase is the page it hands
  // the buyer to. This is one of the two landing spots (the other is
  // /dashboard?upgraded=true).
  useEffect(() => {
    if (postCheckout) track("checkout_completed", { plan: postCheckout === "office" ? "office" : "pro" });
  }, [postCheckout]);

  // Org-managed fields (office sub-users) — per-field: the office manages
  // exactly what it has set, blanks stay editable.
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
  // Headers carry no URL, so they are matched by their marker instead — see
  // isOfficeRow. Including them here would give every header the same identity.
  const officeLinkUrls = new Set(
    (officeLinks ?? []).filter((l) => l.kind !== "header").map((l) => l.url.trim().toLowerCase().replace(/\/+$/, "")),
  );
  /** Is this row the company's? The server stamps office rows `office: true`. */
  const isOfficeRow = (l: { url?: string; office?: unknown } | undefined) =>
    !!l && (l.office === true || officeLinkUrls.has(String(l.url ?? "").trim().toLowerCase().replace(/\/+$/, "")));
  const linkDesignLocked = !!org?.lockLinkDesign;
  const bioManaged = !!org?.linkBio;
  const instagramManaged = !!org?.linkInstagram;

  // First-card design preview: a guest (account unknown pre-signup) or an
  // already-authed Free account building its first card get the Pro design
  // controls unlocked to try, then must explicitly pick Free or Pro before the
  // card is created (see the plan-choice modal below). A plan-specific CTA
  // (?plan=pro/office, presetPlan below) already has a fixed target plan, so it
  // skips this extra choice.
  // A SIGNED-IN buyer who came from a plan CTA (/pricing → ?plan=pro|office)
  // is on the way to paying for exactly this card, so they get the same
  // unlocked design a signed-out visitor from the same button gets. They used
  // to be the one case left locked: isFirstCard is false for a plan entry, so
  // the Pro look was greyed out in the builder they were about to pay for.
  const designUnlocked = isPro || guest || isFirstCard || (!!presetPlan && !postCheckout);
  // …but Custom design is NOT part of that preview, for anyone. It opens only
  // for an account that pays — Pro or Office (owner, 2026-09-18: "The only
  // time someone can ever access custom design is in the actual dashboard if
  // they pay for the Pro or Office plan"). Everyone else — a guest in Get
  // Started, a Free account's first card — sees the row, locked, with its
  // small PRO tag. (Before this, a guest had no row at all and a Free first
  // card could open the designer as a preview.)
  const customDesignAvailable = isPro;
  const showAuthedFirstCardGate = !guest && isFirstCard && !isPro && !presetPlan;

  // Step 1 — card details. Managed fields start (and stay) on the org's values;
  // the server enforces them again on create.
  const [nickname, setNickname] = useState(orgCompany ?? "");
  const [name, setName] = useState(heroName);
  const [company, setCompany] = useState(orgCompany ?? "");
  const [title, setTitle] = useState("");
  const [phones, setPhones] = useState<CardPhone[]>([{ number: "", label: "mobile", showOnCard: true }]);
  const [fax, setFax] = useState(orgFax ?? "");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState<Required<CardAddress>>({ ...EMPTY_ADDRESS, ...(orgAddress ?? {}) });

  // Step 2 — bio, social links, additional links
  const [bio, setBio] = useState("");
  const [website, setWebsite] = useState(orgWebsite ?? "");
  const [links, setLinks] = useState<CardLink[]>([]);
  // What actually saves: an added-but-never-titled section header is
  // scaffolding, not content — it never persists.
  const savableLinks = links.filter((l) => (l.kind === "header" ? l.label.trim() : true));
  const [newLink, setNewLink] = useState({ label: "", url: "" });
  const [socials, setSocials] = useState<Socials>(EMPTY_SOCIALS);

  // The slug the SERVER actually saved — the server auto-dedupes the URL slug on
  // a collision, so it can differ from our locally-derived `username`. Used for
  // the "card is live" URL so we never show a slug that isn't the real one.
  const [createdUsername, setCreatedUsername] = useState<string | null>(null);

  // Step 3 — media + design
  const [logoUrl, setLogoUrl] = useState<string | null>(orgLogo);
  const [logoShape, setLogoShape] = useState<"auto" | "circle">("auto");
  const [headshotUrl, setHeadshotUrl] = useState<string | null>(null);
  // Card design → Photos opens by itself only while something is still missing
  // (for a new card: always). Read ONCE at mount — see MoreOptions. An office
  // member's logo is the organization's, so only their headshot counts.
  const [photosStartOpen] = useState(() => !((org ? true : !!logoUrl) && !!headshotUrl));
  // ?template=… — set by "Apply this design" on /templates, so the design the
  // visitor picked there is already applied when the builder opens.
  const presetTemplate = searchParams.get("template");
  const validPresetTemplate = presetTemplate && PRESET_TEMPLATES.some((t) => t.id === presetTemplate) ? presetTemplate : null;
  // When the office LOCKS the design, seed the design state from the office
  // brand so the live preview shows the real template + colors/fonts from the
  // first render — not the default that only snapped to the brand after saving.
  // (Unlocked office / non-office: the visitor designs freely, as before.)
  // An UNLOCKED office starts its members from the company look too — they may
  // change it, but a teammate's first card opening on the stock classic-pro
  // instead of the company's own template read as "the branding didn't load".
  const [template, setTemplate] = useState(
    org?.template ? org.template : (validPresetTemplate ?? "classic-pro")
  );
  const [customLayout, setCustomLayout] = useState<CustomLayout>(
    org?.template === "custom" && org?.customLayout ? (org.customLayout as CustomLayout) : buildPreset(DEFAULT_PRESET)
  );
  // Preset-template styling (Pro). All fields optional → template defaults apply.
  // Seeded from the office design (see the template seed above).
  const [templateStyleState, setTemplateStyleState] = useState<TemplateStyle>(
    org?.design ? (org.design as TemplateStyle) : {}
  );
  function patchTemplateStyle(patch: Partial<TemplateStyle>) {
    setTemplateStyleState((prev) => ({ ...prev, ...patch }));
  }
  // "Social design" — the Swift Links PAGE's look (step 4). Separate keys from
  // the card's style above, so styling one surface never restyles the other.
  // Seeded from the office's page look while it holds that look, so step 4's
  // "Your organization sets this page's look" sits beside a preview that
  // actually shows it (it showed the default look).
  const [linkStyleState, setLinkStyleState] = useState<SwiftLinkStyle>(
    () => (linkDesignLocked && org?.linkDesign ? (org.linkDesign as SwiftLinkStyle) : {}),
  );
  function patchLinkStyle(patch: Partial<SwiftLinkStyle>) {
    setLinkStyleState((prev) => ({ ...prev, ...patch }));
  }

  // The card starts EMPTY. If the visitor sketched a card / SwiftLink /
  // signature on the marketing site, we stash it here and offer a one-tap
  // "Autofill" — nothing is filled in until they explicitly choose it.
  const [pendingPrefill, setPendingPrefill] = useState<CardPrefill | null>(null);
  useEffect(() => {
    const p = consumePrefill();
    if (!p || !hasSketchContent(p)) return;
    // An unfinished card is waiting and the visitor hasn't said what to do with
    // it yet: hold the sketch until they answer "Continue your card / Start a
    // new card" (see resumeChoice below). Applying it now would mix two cards.
    if (canDraft && !resumesSilently() && draftHasWork(drafts.load())) {
      heldPrefillRef.current = p;
      return;
    }
    applySketchEntry(p);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-time read of the stashed sketch on mount
  }, []);

  function applySketchEntry(p: CardPrefill) {
    // A mini-builder "Make it live" stamps `step` on the prefill — an EXPLICIT
    // hand-off, so autofill immediately and start at the beginning (they still
    // walk through every step, socials and design included). An ambient sketch
    // (no step — e.g. a leftover from a generic "Get started") keeps the opt-in
    // "Autofill / start blank" prompt so nothing is silently applied.
    if (typeof p.step === "number") {
      // Explicit hand-off — autofill now and begin at step 1.
      applyPrefillData(p);
      setStep(1);
    } else {
      // Ambient sketch — offer the opt-in "Autofill / start blank" prompt.
      setPendingPrefill(p);
    }
  }

  // Apply a stashed sketch into the form. Used by the explicit "Autofill"
  // button (with pendingPrefill) AND by the auto-apply hand-off path above.
  // Leaves the current step where it is.
  function applyPrefillData(p: CardPrefill | null) {
    if (!p) return;
    if (p.name) setName(p.name);
    if (p.title) setTitle(p.title);
    if (p.company) setCompany(p.company);
    if (p.email) setEmail(p.email);
    if (p.phone) setPhones([{ number: p.phone, label: "mobile", showOnCard: true }]);
    if (p.address) setAddress((prev) => ({ ...prev, ...p.address }));
    if (p.bio) setBio(p.bio);
    if (p.website) setWebsite(p.website);
    if (p.socials) setSocials((prev) => ({ ...prev, ...p.socials }));
    // Whole link, not a flattened copy — size/rowStyle/media are choices the
    // visitor already made on the marketing builder.
    if (p.links?.length) setLinks(p.links.map((l) => ({ ...l })));
    if (p.fax) setFax(p.fax);
    // Never put anyone onto a Custom design they cannot open — they would be
    // stranded on a design they cannot see or change.
    if (p.template && !(!customDesignAvailable && p.template === "custom")) setTemplate(p.template);
    if (p.logoShape === "circle") setLogoShape("circle");
    // Carry the WHOLE colour/font scheme, not just the accent — the homepage
    // builders expose the same TemplateStyleControls the editor does, so
    // dropping any of these would lose design work the visitor already did.
    setTemplateStyleState((prev) => {
      const next = { ...prev };
      for (const k of PREFILL_STYLE_KEYS) {
        const v = p[k];
        if (typeof v === "string" && v) next[k] = v;
      }
      // A photo or video the visitor uploaded behind the card in the sketch.
      for (const k of PREFILL_CARD_MEDIA_KEYS) {
        const v = p[k];
        if (v !== undefined && v !== "") (next as Record<string, unknown>)[k] = v;
      }
      return next;
    });
    // Swift Links page design ("Social design") rides its own keys.
    setLinkStyleState((prev) => {
      const next = { ...prev };
      for (const k of PREFILL_LINK_STYLE_KEYS) {
        const v = p[k];
        if (typeof v === "string" && v) next[k] = v;
      }
      for (const k of PREFILL_LINK_MEDIA_KEYS) {
        const v = p[k];
        if (v !== undefined && v !== "") (next as Record<string, unknown>)[k] = v;
      }
      return next;
    });
    if (p.hideCardLink) setShowCardLinkBtn(false);
    if (p.logoUrl) setLogoUrl(p.logoUrl);
    if (p.headshotUrl) setHeadshotUrl(p.headshotUrl);
    setPendingPrefill(null);
  }

  // Social-design toggle: the faint "View SwiftCard →" link on the Swift
  // Links page. ON by default — hiding it is the owner's explicit choice.
  const [showCardLinkBtn, setShowCardLinkBtn] = useState(true);

  // ── Undo — the Card design and Social design steps (lib/use-design-history).
  // Same two histories as the card editor: one per step, a press steps back one
  // change, and creating the card ends them.
  const cardHistory = useDesignHistory(
    { template, customLayout, style: templateStyleState, logoShape, logo: logoUrl, photo: headshotUrl },
    (s) => {
      setTemplate(s.template);
      setCustomLayout(s.customLayout);
      setTemplateStyleState(s.style);
      setLogoShape(s.logoShape);
      setLogoUrl(s.logo);
      setHeadshotUrl(s.photo);
    },
  );
  // Only each link's LOOK is Social design's (links belong to Socials) — see
  // the card editor for why they are matched back by link.
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
  useUndoShortcut(step === 2, cardHistory);
  useUndoShortcut(step === 4, linkHistory);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [error, setError] = useState("");
  // Step 1's one required field, flagged in place when Next finds it empty.
  const nameInputRef = useRef<HTMLInputElement>(null);
  const [nameMissing, setNameMissing] = useState(false);
  // Step 3's one required field: the Swift Links bio (the AI follow-ups write
  // from it — lib/sender-about). An office-set bio fills it on its own. Next on
  // Socials, the final save and a create from any gate all check it; a miss
  // lands on step 3 with the box outlined and focused. Two frames, so it runs
  // after the step change's own jump to the top.
  const bioRequiredMissing = !bioManaged && !bio.trim();
  const [bioMissing, setBioMissing] = useState(false);
  const [bioFocusTick, setBioFocusTick] = useState(0);
  useEffect(() => {
    if (!bioFocusTick) return;
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => {
        const el = document.getElementById("wizard-bio");
        el?.scrollIntoView({ behavior: "smooth", block: "center" });
        el?.focus({ preventScroll: true });
      });
    });
    return () => { cancelAnimationFrame(outer); cancelAnimationFrame(inner); };
  }, [bioFocusTick]);
  /** False (and sends them to the bio) when the required bio is empty. */
  function requireBio(): boolean {
    if (!bioRequiredMissing) return true;
    setStep(3);
    setBioMissing(true);
    setBioFocusTick((n) => n + 1);
    return false;
  }
  // Native-only: when a Free user hits the card cap we can't send them to the
  // /upgrade selling screen (forbidden in-app), so we show a neutral notice
  // instead. Stays false on web, so the web flow (router.push("/upgrade")) is
  // unchanged.
  const [multiCardBlocked, setMultiCardBlocked] = useState(false);
  // Guest flow: after building the card, pick a plan BEFORE creating the account.
  // The choice is stashed (plan-intent) and honored on /welcome after signup —
  // Free → dashboard, Pro/Office → checkout. An authed first-card builder shares
  // this same modal (showAuthedFirstCardGate) but creates the card directly —
  // Free converts the design in place (pendingFreeConfirm shows the notice
  // first if anything Pro-only was actually used), Pro/Office creates then
  // sends them to checkout.
  const [showPlan, setShowPlan] = useState(false);
  const [pendingFreeConfirm, setPendingFreeConfirm] = useState(false);

  // Snap the current draft's design down to the closest Free-safe preset in
  // place (never touches actual content — name, links, photos, etc. are a
  // separate part of the customization object). Returns whether anything Pro-
  // only was actually present to convert, which drives whether the "we applied
  // a basic Free design" notice is shown at all.
  /**
   * Returns the converted values as well as applying them.
   *
   * THE BUG THIS SHAPE EXISTS FOR. This used to return only `changed`, and
   * `confirmFreeDesignAndCreate` called it and then `handleCreate()` in the
   * same tick — so the POST read `template` / `templateStyleState` /
   * `linkStyleState` from the render that was already closed over, i.e. the
   * UNCONVERTED Pro design. "Lose the designs and continue with Free" sent the
   * Pro design to the server every single time. It was invisible only because
   * the server re-sanitizes on write; the moment a plan is passed alongside it
   * (chosenPlan), or the sanitizer is relaxed, it would persist.
   *
   * Handing the values back means the caller can pass exactly what it just
   * decided, instead of hoping React has re-rendered.
   */
  function applyFreeDesignConversion(): {
    changed: boolean;
    template: string;
    templateStyleState: TemplateStyle;
    linkStyleState: SwiftLinkStyle;
  } {
    const draftStyle: Record<string, unknown> = { ...templateStyleState, ...(template === "custom" ? { customLayout } : {}) };
    const result = convertCustomizationToFreeClosest(draftStyle, template);
    setTemplate(result.template);
    setTemplateStyleState({
      accentColor: result.customization.accentColor as string | undefined,
      bgColor: result.customization.bgColor as string | undefined,
      surfaceColor: result.customization.surfaceColor as string | undefined,
      textColor: result.customization.textColor as string | undefined,
      infoColor: result.customization.infoColor as string | undefined,
      fontFamily: result.customization.fontFamily as string | undefined,
      // Read back from the CONVERTED customization, not from the draft: the
      // converter keeps a free finish (Sheen, Halo) and drops a Pro one, and
      // strips panel media outright. Rebuilding from the draft would put a Pro
      // finish straight back on a card the server is about to strip it from.
      finish: result.customization.finish as string | undefined,
      panelMedia: result.customization.panelMedia as string | undefined,
      panelMediaType: result.customization.panelMediaType as string | undefined,
      panelMediaPoster: result.customization.panelMediaPoster as string | undefined,
      panelDim: typeof result.customization.panelDim === "number" ? result.customization.panelDim : undefined,
    });

    // The Swift Links half. describeFreeDesignChanges + proLinkFeaturesInUse
    // WARN about these (freeDesignChanges() lists them in the dialog), but the
    // conversion never touched them — so the visitor was told a Glass look and
    // photo link buttons would go, agreed, and the client carried on holding
    // them. Only the server stripped them. Mirrors sanitizeCustomizationForPlan:
    // every LINK_STYLE_KEY dropped, structural keys (linkLook, hero style and
    // content) kept.
    const freeLinkStyle: SwiftLinkStyle = { ...linkStyleState };
    for (const k of LINK_STYLE_KEYS) delete (freeLinkStyle as Record<string, unknown>)[k];
    setLinkStyleState(freeLinkStyle);

    const converted: TemplateStyle = {
      accentColor: result.customization.accentColor as string | undefined,
      bgColor: result.customization.bgColor as string | undefined,
      surfaceColor: result.customization.surfaceColor as string | undefined,
      textColor: result.customization.textColor as string | undefined,
      infoColor: result.customization.infoColor as string | undefined,
      fontFamily: result.customization.fontFamily as string | undefined,
      finish: result.customization.finish as string | undefined,
      panelMedia: result.customization.panelMedia as string | undefined,
      panelMediaType: result.customization.panelMediaType as string | undefined,
      panelMediaPoster: result.customization.panelMediaPoster as string | undefined,
      panelDim: typeof result.customization.panelDim === "number" ? result.customization.panelDim : undefined,
    };
    return {
      changed: result.changed,
      template: result.template,
      templateStyleState: converted,
      linkStyleState: freeLinkStyle,
    };
  }

  /**
   * What Free would change about this card, WITHOUT changing it.
   *
   * The conversion used to be applied the moment Free was clicked, and the
   * notice shown afterwards — so the card was already rewritten behind a panel
   * that was still asking. Deciding first and converting second is what makes
   * "keep it exactly like this" a real offer rather than an undo.
   */
  function freeDesignChanges(): string[] {
    const draftStyle: Record<string, unknown> = { ...templateStyleState, ...(template === "custom" ? { customLayout } : {}) };
    return [
      ...describeFreeDesignChanges(draftStyle, template),
      // The Swift Links half of the same build. The design step lets a
      // first-card visitor style that page too, and until now this notice
      // listed only what Free changes about the CARD — so someone picked a
      // Glass look and photo link buttons, chose Free on the strength of a
      // list that never mentioned them, and found a plain page. Named by the
      // same checker the edit screen's save wall uses, so the two agree.
      ...proLinkFeaturesInUse(linkStyleState as unknown as Record<string, unknown>, links).map(
        (name) => `${name} is not included`,
      ),
    ];
  }

  function handleAuthedFirstCardFree() {
    if (freeDesignChanges().length) { setPendingFreeConfirm(true); return; }
    setShowPlan(false);
    handleCreate();
  }

  // They chose Free with their eyes open: NOW convert, then save.
  //
  // The converted values are passed straight into the save. Reading them back
  // off state here would read the PRE-conversion design — setState does not
  // apply within the same tick — which is exactly what this branch used to do.
  function confirmFreeDesignAndCreate() {
    const converted = applyFreeDesignConversion();
    setPendingFreeConfirm(false);
    setShowPlan(false);
    handleCreate(undefined, {
      template: converted.template,
      templateStyleState: converted.templateStyleState,
      linkStyleState: converted.linkStyleState,
    });
  }

  /**
   * "Keep my card exactly like this" — the trial.
   *
   * Authed first card only, like the gate it lives in. Routed through the SAME
   * handler a Pro pick uses rather than a shortcut of its own, so it cannot
   * quietly stop matching however Pro is sold next.
   */
  function keepDesignWithTrial() {
    track("upgrade_started", { placement: "wizard_free_design_choice", plan: "pro" });
    setPendingFreeConfirm(false);
    handleAuthedFirstCardPaid("pro", false, 1);
  }

  function handleAuthedFirstCardPaid(plan: "pro" | "office", annual: boolean, seats: number) {
    setShowPlan(false);
    handleCreate({ plan, annual, seats });
  }

  // "Start my free month of Pro" in the builder's plan gate: save the card as
  // designed (it is about to be Pro), then start the month exactly as /welcome
  // does, then the same "Your card is live!" step.
  function handleAuthedFirstCardGift() {
    setPendingFreeConfirm(false);
    setShowPlan(false);
    handleCreate(undefined, undefined, true);
  }

  // handleGuestFree / confirmGuestFree / pickPlanThenSignUp lived here and are
  // gone (2026-09-15). They existed to record a guest's plan choice BEFORE the
  // account existed, which meant the only place to put it was localStorage —
  // and a one-shot localStorage read is what lost a guest's "Free" and put them
  // on a Pro trial. A guest now goes design → account → plan, and /welcome owns
  // the plan decision with the account already in hand.

  // Card URL auto-fills from full name + company in the fused format
  // ("johnsmith-acmecorp") — one hyphen between name and company, none inside
  // either (owner order 2026-08-26).
  const username = cardSlug(name, company);
  // What the visitor-facing link LOOKS like: "AaronLavi-MalveCapital". The
  // routes are case-insensitive, so this exact string is shareable.
  const prettyUsername = prettyCardSlug(name, company);
  const cardLabel = nickname.trim() || name.trim();

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
    const label = newLink.label.trim();
    let url = newLink.url.trim();
    if (!label || !url) return;
    if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
    // Add, then reset the fields so another link can be entered right away.
    setLinks((prev) => [...prev, { label, url }]);
    setNewLink({ label: "", url: "" });
  }
  function removeLink(i: number) {
    setLinks((prev) => prev.filter((_, idx) => idx !== i));
  }

  function goNextFrom1() {
    if (!name.trim()) {
      setError("Full name is required.");
      // The message renders beside the Next button, a phone-screen or more
      // below the field it is about. Take them to the field.
      setNameMissing(true);
      nameInputRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      nameInputRef.current?.focus({ preventScroll: true });
      return;
    }
    if (!username) {
      setError("Please enter a name we can turn into a URL.");
      return;
    }
    setError("");
    setStep(2);
  }

  const previewData: CardData = {
    name: name || "Your name",
    title,
    company,
    phone: primaryPhone,
    email,
    // The live preview must show the website as it is typed. This was hardcoded
    // to "" while the save below sends website.trim(), so the field silently
    // never appeared while building the card and only showed up after the card
    // was created — it read as "the website didn't save".
    website,
    linkedin: socials.linkedin,
    // The company's Instagram when the office sets it — what the card will carry.
    instagram: instagramManaged ? (org?.linkInstagram ?? "") : socials.instagram,
    twitter: socials.twitter,
    tiktok: socials.tiktok,
    snapchat: socials.snapchat,
    initials: (name || "?")[0]?.toUpperCase() ?? "?",
    photoUrl: headshotUrl,
    logoUrl,
    cardUrl: `swiftcard.me/${prettyUsername || "your-card"}`,
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
      // every connected card shows here too, ahead of personal numbers.
      phones: org && orgPhone
        ? [{ number: orgPhone, label: "office" as PhoneLabel, showOnCard: true }, ...cleanPhones]
        : cleanPhones,
      fax: fax.trim(),
      logoShape,
      ...templateStyleState,
    },
  };
  const photosSummary = logoUrl && headshotUrl
    ? "Both added"
    : logoUrl ? "Logo added · add a headshot"
    : headshotUrl ? (org ? "Headshot added" : "Headshot added · add a logo")
    : org ? "Add your headshot" : "Add your logo and headshot";
  const PreviewTemplate = template === "custom" ? CustomCard : (PRESET_TEMPLATES.find((t) => t.id === template)?.Component ?? ClassicPro);
  const customSelected = template === "custom";
  // On the design step the custom designer IS a live card you edit by touching
  // it, so the pinned preview column beside it would be a second, identical,
  // non-interactive copy. Give the designer the full width instead.
  const designerIsCanvas = step === 2 && customSelected && customDesignAvailable && !designLocked;

  // Guest autosave: snapshot the exact shape we'd POST to /api/cards into the
  // localStorage draft on every change. The claim route mirrors /api/cards'
  // allow-list, so extra keys are harmless and missing ones default. Logo +
  // headshot ride in `images` as data URLs (guest can't upload) and are pushed to
  // storage + rewritten to real URLs at claim time. saveDraft is debounced.
  // ── Restore an in-progress guest draft ────────────────────────────────────
  // The autosave below has always written a draft, but NOTHING ever read it back
  // into the editor — loadDraft() was only called by GuestDraftClaim, after
  // signup. So a guest who reloaded, hit back, or came back later got an empty
  // form on top of a full draft, and the autosave (which REPLACES rather than
  // merges) then overwrote that draft with blanks within 400ms. The work was
  // gone, permanently, and the draft only ever survived one uninterrupted
  // gate → login → return trip.
  //
  // Two parts to the fix: read the draft back in, and refuse to autosave until
  // we have (hydratedRef), so the blank first render can't clobber it.
  // Freshly-connected guest LinkedIn photo (see the ?li_photo= effect below) —
  // applied at the END of the restore so a resumed draft's older photo can't
  // overwrite the one the user just connected for.
  const liPhotoRef = useRef<string | null>(null);
  const applyLiPhoto = () => {
    if (liPhotoRef.current) {
      setHeadshotUrl(liPhotoRef.current);
      liPhotoRef.current = null;
    }
  };

  useEffect(() => {
    if (!canDraft) { hydratedRef.current = true; applyLiPhoto(); return; }
    let live = true;
    // Async so the setState calls aren't synchronous inside the effect body;
    // the autosave effect below runs first and no-ops on !hydratedRef.
    (async () => {
      const draft = drafts.load();
      if (!live) return;

      if (draft && draftHasWork(draft)) {
        // A reload, the browser Back button, the login return and the LinkedIn
        // photo return are the SAME visit carrying on — resume without asking.
        // Anything else is a fresh entry (every "Get started free"-style button
        // on the site), and a fresh entry never lands mid-card by surprise:
        // it asks first. Autosave stays off (hydratedRef false) until they
        // answer, so the blank form behind the question can't overwrite it.
        if (resumesSilently()) {
          restoreDraft(draft);
        } else {
          setResumeChoice(draft);
          return;
        }
      } else if (draft) {
        // Opened once, nothing entered — not worth a question later.
        drafts.clear();
      }
      hydratedRef.current = true;
      applyLiPhoto();
    })();
    return () => { live = false; };
    // validPresetTemplate is read as a snapshot of the URL this page opened
    // with; it can't change without a navigation that remounts the wizard.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guest, canDraft, drafts]);

  // ── "Continue your card" / "Start a new card" ─────────────────────────────
  // Owner rule 2026-09-16: every "Get started free"-style button on the site
  // runs the same flow — New card → Card design → Socials → Social design →
  // plan + account. Before this, the SAME header button opened a blank card on
  // the homepage (which wiped the draft on load) but dropped a visitor into
  // step 3 of an old card from /pricing or /blog. Now no entry point wipes and
  // none resumes silently: the builder asks, once, whenever real work exists.
  function restoreDraft(draft: GuestDraft) {
    const p = (draft.payload ?? {}) as Record<string, unknown>;
    const cust = (p.customization ?? {}) as Record<string, unknown>;
      const s = (v: unknown) => (typeof v === "string" ? v : "");
      setName(heroName || s(p.name));
      setCompany(s(p.company));
      setTitle(s(p.title));
      setEmail(s(p.email));
      setWebsite(s(p.website));
      // `label` is the nickname the user typed; `username` is derived from
      // name+company, so it rebuilds itself and must not be restored.
      setNickname(s(p.label) === s(p.name) ? "" : s(p.label));
      setSocials({
        linkedin: s(p.linkedin), instagram: s(p.instagram), tiktok: s(p.tiktok),
        twitter: s(p.twitter), facebook: s(cust.facebook), snapchat: s(cust.snapchat),
        youtube: s(cust.youtube),
      });
      // A ?template= from "Apply this design" is an explicit choice made
      // seconds ago, so it beats whatever design a resumed draft happens to
      // carry. Everything else in the draft is still restored.
      if (typeof p.template === "string" && !validPresetTemplate && !(!customDesignAvailable && p.template === "custom")) setTemplate(p.template);
      setBio(s(cust.bio));
      setFax(s(cust.fax));
      if (Array.isArray(cust.links)) setLinks(cust.links as CardLink[]);
      if (Array.isArray(cust.phones) && (cust.phones as CardPhone[]).length) {
        setPhones(cust.phones as CardPhone[]);
      }
      if (cust.address && typeof cust.address === "object") {
        setAddress({ ...EMPTY_ADDRESS, ...(cust.address as Partial<Required<CardAddress>>) });
      }
      if (cust.customLayout && typeof cust.customLayout === "object") {
        setCustomLayout(cust.customLayout as CustomLayout);
      }
      // Both used to reset on a mid-build reload, and the next autosave then
      // overwrote the stored value with the default.
      if (cust.logoShape === "circle") setLogoShape("circle");
      if (cust.hideCardLink === true) setShowCardLinkBtn(false);
      // Style keys ride alongside the known customization fields. Reuse the
      // plan module's list rather than a parallel one, so a new design key
      // can't be added there and silently dropped here.
      const style: Record<string, unknown> = {};
      for (const k of PRO_CUSTOMIZATION_KEYS) if (cust[k] !== undefined) style[k] = cust[k];
      if (Object.keys(style).length) setTemplateStyleState(style as TemplateStyle);
      // Swift Links page design keys ride alongside the card's, on their own
      // list — the Pro keys AND the every-plan structural ones (Look, header
      // style/content, uploaded header photo), which this restore used to
      // silently drop.
      const ls: Record<string, unknown> = {};
      for (const k of [...LINK_STYLE_KEYS, ...LINK_STRUCTURAL_KEYS]) if (cust[k] !== undefined) ls[k] = cust[k];
      if (Object.keys(ls).length) setLinkStyleState(ls as SwiftLinkStyle);

      // Images ride as base64 data URLs (a guest can't reach the upload route).
      if (draft.images?.logo) setLogoUrl(draft.images.logo);
      if (draft.images?.photo) setHeadshotUrl(draft.images.photo);

      if (typeof draft.step === "number" && draft.step >= 1 && draft.step <= 4) setStep(draft.step);
      setRestored(true);
  }

  function continueDraft() {
    if (!resumeChoice) return;
    restoreDraft(resumeChoice);
    // They chose the card they already had; a sketch from the homepage builders
    // would overwrite it, so it is dropped rather than mixed in.
    heldPrefillRef.current = null;
    setResumeChoice(null);
    hydratedRef.current = true;
    applyLiPhoto();
  }

  // The "Your card is live!" screen just asked about notifications; the
  // dashboard's first push nudge must not repeat the question moments later.
  function markPushAsked() {
    try { if (!localStorage.getItem("sc_push_nudge_dismissed")) localStorage.setItem("sc_push_nudge_dismissed", "1"); } catch { /* ignore */ }
    try { localStorage.setItem("sc_appstore_seen", "1"); } catch { /* ignore */ }
  }

  function startNewCard() {
    drafts.clear();
    setResumeChoice(null);
    const held = heldPrefillRef.current;
    heldPrefillRef.current = null;
    // "Start a new card" means BLANK (owner, 2026-09-16: offering the details
    // they had already typed right after they chose a new card "doesn't need to
    // be there"). The one exception is an explicit "Make it live" hand-off from
    // a homepage builder (it carries a step) — that IS the new card they chose.
    // An ambient sketch is thrown away, not offered.
    if (held && typeof held.step === "number") applySketchEntry(held);
    hydratedRef.current = true;
    applyLiPhoto();
  }

  // ── Guest LinkedIn photo return (?li_photo=) ──────────────────────────────
  // A guest's "Connect LinkedIn" in the headshot suggester runs a one-shot
  // OAuth import (no account) and lands back here with the stored photo URL.
  // The value is stashed here (mount effects run before the async draft
  // restore above resumes) and applied by the restore effect once hydration is
  // done — applying it directly here would race the restore, whose draft photo
  // would then overwrite the photo the user just connected for.
  // Only our own storage host is accepted — the param is never trusted blind.
  useEffect(() => {
    const url = new URL(window.location.href);
    const photo = url.searchParams.get("li_photo");
    if (!photo) return;
    const supa = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (supa && photo.startsWith(`${supa}/storage/v1/object/public/`)) {
      liPhotoRef.current = photo;
    }
    url.searchParams.delete("li_photo");
    url.searchParams.delete("integration");
    url.searchParams.delete("status");
    window.history.replaceState({}, "", url.toString());
  }, []);

  useEffect(() => {
    if (!canDraft) return;
    // Never write before the restore has run, or the empty first render wipes
    // the very draft we're about to load.
    if (!hydratedRef.current) return;
    // Step 5 is "Your card is live!" — the card exists. Saving here would put
    // the finished card straight back as an "unfinished" one.
    if (step >= 5) return;
    drafts.save({
      step,
      payload: {
        username, label: cardLabel, name, company, title,
        phone: primaryPhone, email, website,
        linkedin: normalizeSocial(socials.linkedin, "linkedin"),
        instagram: normalizeSocial(socials.instagram, "instagram"),
        tiktok: normalizeSocial(socials.tiktok, "tiktok"),
        twitter: normalizeSocial(socials.twitter, "twitter"),
        template,
        logo_url: null,
        customization: {
          bio,
          facebook: normalizeSocial(socials.facebook, "facebook"),
          snapchat: normalizeSocial(socials.snapchat, "snapchat"),
          youtube: normalizeSocial(socials.youtube, "youtube"),
          links: savableLinks, address, phones: cleanPhones, fax: fax.trim(),
          ...templateStyleState,
          ...linkStyleState,
          ...(showCardLinkBtn ? {} : { hideCardLink: true }),
          // The Circle logo shape — picked here or in the homepage card /
          // signature builders — was never written to the draft, so the claim
          // saved every guest's card as "Original".
          ...(logoShape === "circle" ? { logoShape: "circle" as const } : {}),
          photoUrl: null,
          ...(template === "custom" ? { customLayout } : {}),
        },
      },
      images: {
        ...(logoUrl ? { logo: logoUrl } : {}),
        ...(headshotUrl ? { photo: headshotUrl } : {}),
      },
    });
  }, [guest, canDraft, drafts, step, username, cardLabel, name, company, title, primaryPhone, email, website,
      socials, template, bio, links, address, cleanPhones, fax, templateStyleState,
      linkStyleState, customLayout, logoUrl, headshotUrl, showCardLinkBtn, logoShape]);

  /**
   * `design` overrides the design state for THIS save.
   *
   * React state set moments earlier is not readable here — this function closes
   * over the values from the render it was created in. The Free conversion runs
   * and saves in one tick, so it hands its result in directly rather than
   * setting state and hoping. See applyFreeDesignConversion.
   */
  async function handleCreate(
    planChoice?: { plan: "pro" | "office"; annual: boolean; seats: number },
    design?: { template: string; templateStyleState: TemplateStyle; linkStyleState: SwiftLinkStyle },
    referralMonth = false,
    /** Just bought Pro in the app (StoreKit) from this builder's plan gate.
     *  The server may not have the Apple grant yet, so the card must say Pro
     *  itself — see chosenPlan below. */
    iapPurchased = false,
  ) {
    const saveTemplate = design?.template ?? template;
    const saveTemplateStyle = design?.templateStyleState ?? templateStyleState;
    const saveLinkStyle = design?.linkStyleState ?? linkStyleState;
    if (!name.trim() || !username) {
      setStep(1);
      setError("Full name is required.");
      return;
    }
    if (!requireBio()) return;
    if (creatingRef.current) return; // a create is already in flight
    creatingRef.current = true;
    setStatus("loading");
    setError("");

    let res: Response;
    try {
      res = await fetch("/api/cards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username,
          label: cardLabel,
          name: name.trim(),
          company: company.trim(),
          title: title.trim(),
          phone: primaryPhone,
          email: email.trim(),
          website: website.trim(),
          // Normalize at save too — onBlur alone misses Enter-to-submit and the
          // prefill autofill path, which set state without ever blurring the field.
          linkedin: normalizeSocial(socials.linkedin, "linkedin"),
          instagram: normalizeSocial(socials.instagram, "instagram"),
          tiktok: normalizeSocial(socials.tiktok, "tiktok"),
          twitter: normalizeSocial(socials.twitter, "twitter"),
          template: saveTemplate,
          logo_url: logoUrl,
          customization: {
            bio: bio.trim(),
            facebook: normalizeSocial(socials.facebook, "facebook"),
            snapchat: normalizeSocial(socials.snapchat, "snapchat"),
            youtube: normalizeSocial(socials.youtube, "youtube"),
            links: savableLinks,
            address,
            phones: cleanPhones,
            fax: fax.trim(),
            ...(logoShape === "circle" ? { logoShape: "circle" as const } : {}),
            // Preset-template style overrides (Pro; stripped server-side on Free).
            // Only fields the user actually set are present here.
            ...saveTemplateStyle,
            // Swift Links page design: the named Look saves on every plan
            // (Free snapped to the free pair server-side); the custom bg/text/font
            // fine-tune keys are Pro and stripped on Free.
            ...saveLinkStyle,
            // "View SwiftCard →" toggle (absent = shown, the default).
            ...(showCardLinkBtn ? {} : { hideCardLink: true }),
            // Headshot is per-card (explicit key, null when none) — never inherits
            // another card's photo.
            photoUrl: headshotUrl ?? null,
            ...(saveTemplate === "custom" ? { customLayout } : {}),
          },
          // A first card saved from the plan gate WITHOUT a paid pick is the
          // Free choice — say so, so the server records the plan as decided
          // (api/cards) and the dashboard does not send them back to choose.
          // An in-app purchase is a Pro pick too. It used to fall through to
          // "free" (the gate is still showing), so when Apple's grant hadn't
          // reached the server yet the card was saved with its Pro design
          // stripped and Free recorded as the plan they chose — for someone
          // who had just paid.
          ...(planChoice ? { chosenPlan: planChoice.plan } : referralMonth || iapPurchased ? { chosenPlan: "pro" } : presetPlan && !postCheckout ? { chosenPlan: presetPlan } : showAuthedFirstCardGate ? { chosenPlan: "free" } : {}),
        }),
      });
    } catch {
      creatingRef.current = false; // allow retry
      setError("Couldn't reach the server — check your connection and try again.");
      setStatus("error");
      return;
    }

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (data.error === "limit" || data.error === "upgrade") {
        // In the native app the /upgrade screen is a selling surface and is
        // suppressed — show a neutral notice in place instead of navigating.
        if (isNativeApp) {
          creatingRef.current = false;
          setMultiCardBlocked(true);
          setStatus("error");
          return;
        }
        // They're signed in and already hit a Free cap — send them to the
        // in-product upgrade screen, not the marketing page with its Free
        // column and trial offer.
        router.push("/upgrade");
        return;
      }
      creatingRef.current = false; // allow retry
      // `message` is the sentence; `error` is a machine code ("invalid",
      // "team_card_limit") that used to be shown to the person as-is.
      setError(data.message || data.error || "Something went wrong.");
      setStatus("error");
      return;
    }

    // Remember the slug the server actually saved (it may have been deduped).
    const savedUsername = (data?.card?.username as string | undefined) || username;
    setCreatedUsername(savedUsername);
    // The card exists now — nothing before this is undoable any more.
    cardHistory.clear();
    linkHistory.clear();
    // Created — the account's unfinished-card draft is done with. (A guest's
    // is cleared by the claim, which is what creates their card.)
    if (!guest) drafts.clear();
    // The card exists and is serving — the single most important funnel step.
    track("card_creation_completed");
    track("card_published", { cardId: (data?.card?.id as string | undefined) });

    // A logged-in buyer who built this card as part of Get Pro / Get Office still
    // has to pay — take them straight to checkout for that plan (this new card is
    // seat 1 for Office). `postCheckout` means they already paid and are building
    // the card AFTER payment, so that path skips this and shows the done screen.
    if (!guest && presetPlan && !postCheckout) {
      const qs = new URLSearchParams({ plan: presetPlan, interval: presetAnnual ? "annual" : "monthly" });
      if (presetPlan === "office") qs.set("seats", String(presetSeats));
      // Carry the promo through the builder — /pricing → /cards/new → /checkout.
      // Without this the code is silently dropped mid-flow and the buyer pays
      // full price for an offer they were shown.
      if (presetPromo) qs.set("promo", presetPromo);
      router.push(`/checkout?${qs.toString()}`);
      return;
    }

    // First-card design preview, Pro/Office chosen at the in-wizard plan gate:
    // the card is saved as-designed (server kept it thanks to chosenPlan — see
    // /api/cards), now send them to pay for it.
    if (!guest && planChoice) {
      const qs = new URLSearchParams({ plan: planChoice.plan, interval: planChoice.annual ? "annual" : "monthly" });
      if (planChoice.plan === "office") qs.set("seats", String(planChoice.seats));
      qs.set("success", `/welcome?step=setup&for=${planChoice.plan}`);
      router.push(`/checkout?${qs.toString()}`);
      return;
    }

    if (!guest && referralMonth) {
      const r = await fetch("/api/account/choose-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ referralMonth: true }),
      }).catch(() => null);
      // Either way the card exists; /welcome shows "Your card is live!" when
      // the month started, or the plan chooser again if it could not.
      router.push(r?.ok ? "/welcome?step=setup&for=pro" : "/welcome");
      return;
    }

    // Card created — last step: turn on notifications for this card so the
    // owner gets contact alerts + view milestones on their device.
    setStatus("idle");
    setStep(5);
  }

  // One definition, three render sites: the pinned DESKTOP sidebar (steps 1-3),
  // and an inline MOBILE copy in step 1 (below the fax field) and step 2
  // (between the template picker and the colour controls). Defined once so the
  // two viewports can never drift apart.
  // The card itself, built ONCE: the preview and the phone's docked preview
  // on step 2 both render this element, so they can never disagree.
  const cardTemplateEl = <PreviewTemplate data={customSelected ? previewData : withoutSocials(previewData)} />;

  const livePreview = (
    <>
      <div className="flex items-center justify-between gap-2 mb-2">
        <p className="text-[0.6875rem] font-semibold text-gray-400 uppercase tracking-wide">Live preview</p>
        {step === 2 && <UndoDesignButton history={cardHistory} variant="pill" />}
      </div>
      {/* Look-only — design is changed with the controls, never by
          clicking the card itself. See InertPreview. */}
      <InertPreview className="rounded-2xl overflow-hidden border border-gray-800">
        <CardScaler>
          {cardTemplateEl}
        </CardScaler>
      </InertPreview>
      <p className="text-gray-600 text-[0.6875rem] mt-2 leading-snug">Your card so far — it updates as you fill things in.</p>
    </>
  );

  // Step 4's sidebar copy: on Social design the thing being styled is the
  // Swift Links page, so the page preview REPLACES the card's Live Preview in
  // the pinned top-right slot (and inline on mobile) instead of sitting next
  // to it.
  // The Swift Links page itself, built ONCE: the inline preview (step 3, the
  // desktop sidebar) and the phone's pinned preview on step 4 render this exact
  // element, so they can never disagree.
  const linkPageEl = (
    <SwiftLinkLivePreview
      style={linkStyleState}
      name={name}
      handle={username || "yourname"}
      company={company}
      title={title}
      // An office member's page carries what the server puts there on create:
      // the company bio and Instagram when the office sets them, and the
      // company's pinned links ahead of their own. The preview used to show
      // only what they typed, so "Your organization's links are already on
      // your page" sat beside a page with none of them.
      bio={bioManaged ? (org?.linkBio ?? "") : bio}
      photoUrl={headshotUrl}
      // Same value saved as the card's logo_url below, so the hero's
      // headshot → logo → initials fallback previews exactly as it renders.
      logoUrl={logoUrl}
      socials={{
        instagram: instagramManaged ? (org?.linkInstagram ?? "") : socials.instagram, tiktok: socials.tiktok, linkedin: socials.linkedin,
        twitter: socials.twitter, facebook: socials.facebook, snapchat: socials.snapchat,
        youtube: socials.youtube, website,
      }}
      links={officeLinks?.length ? [...(officeLinks as CardLink[]), ...links.filter((l) => !isOfficeRow(l))] : links}
      paid={designUnlocked}
      showCardLink={showCardLinkBtn}
    />
  );

  const linkPagePreview = (
    <>
      <div className="flex items-center justify-between gap-2 mb-2">
        <p className="text-[0.6875rem] font-semibold text-gray-400 uppercase tracking-wide">
          Your Swift Links page — this is how it will look
        </p>
        {step === 4 && <UndoDesignButton history={linkHistory} variant="pill" className="shrink-0" />}
      </div>
      {linkPageEl}
      {/* Both Swift Links steps share this preview, so the caption names what
          the step you are on actually changes. */}
      <p className="text-gray-600 text-[0.6875rem] mt-2 leading-snug">
        {step === 3
          ? "Your bio, socials and links appear here as you add them."
          : "It updates live as you pick colors and fonts."}
      </p>
    </>
  );

  /**
   * The MOBILE Swift Links preview — same component, capped to a mini-phone.
   *
   * SwiftLinkLivePreview renders the real profile at a 390px phone width and
   * CardScaler shrinks it to whatever slot holds it, so a full-width slot on a
   * phone produced ~0.9 scale: a preview nearly as tall as the screen it was
   * previewing. 220px lands it around 0.56 — a true mini-phone, pixel-identical
   * to the published page, that a thumb can scroll past. The width cap is the
   * only change; nothing is clamped or simplified.
   */
  const mobileLinkPagePreview = (
    <div className="w-full max-w-[220px] mx-auto">{linkPagePreview}</div>
  );

  if (resumeChoice) {
    const draftName = typeof resumeChoice.payload?.name === "string" ? resumeChoice.payload.name.trim() : "";
    const stepNames = ["Card information", "Card design", "Socials", "Social design"];
    const stoppedAt = stepNames[Math.min(Math.max((resumeChoice.step || 1) - 1, 0), 3)];
    return (
      <main className="sc-app sc-canvas-white min-h-screen bg-gray-950 px-5 py-10">
        <ForceLightTheme />
        <div className="max-w-md mx-auto">
          <Link href="/" className={topControlCls}>
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
            </svg>
            Home
          </Link>
          <section className="rounded-2xl border border-gray-800 bg-gray-900 p-6" aria-labelledby="resume-title">
            <h1 id="resume-title" className="text-2xl font-bold text-white">You have an unfinished card</h1>
            <p className="text-gray-400 text-sm mt-2 leading-relaxed">
              {draftName ? <><span className="text-white font-semibold">{draftName}</span> · </> : null}
              You stopped at {stoppedAt}. Pick up where you left off, or start a new card from the beginning.
            </p>
            <div className="mt-6 flex flex-col gap-3">
              <button
                type="button"
                onClick={continueDraft}
                className="w-full bg-blue-600 hover:bg-blue-500 text-white font-semibold py-3 rounded-full transition-colors text-sm"
              >
                Continue your card
              </button>
              <button
                type="button"
                onClick={startNewCard}
                className="w-full border border-gray-700 text-gray-300 hover:border-gray-500 hover:text-white font-semibold py-3 rounded-full transition-colors text-sm"
              >
                Start a new card
              </button>
            </div>
            <p className="text-gray-500 text-xs mt-4 text-center">Starting a new card deletes the unfinished one.</p>
          </section>
        </div>
      </main>
    );
  }

  return (
    <>
    <main className="sc-app sc-canvas-white min-h-screen bg-gray-950 px-5 py-10">
      <ForceLightTheme />
      <div className={step === 5 ? "max-w-md mx-auto" : "max-w-4xl mx-auto"}>
        {/* The one control at the TOP of the page. It has to match what is
            actually behind the user, because that is what people assume it
            does.
            • STEPS 2–4 → "Back", to the step they just came from. This said
              "Home" on every step, which made it the only top-of-page control
              on Card design, Socials and Social design — and for a guest that
              link used to WIPE the draft (it no longer does — see resumeChoice).
              People look UP to go back, not down, so reaching for it by reflex
              threw away the whole half-built card. The "← Back" buttons at the
              bottom of those steps stay; this one catches everyone who never
              scrolls that far.
            • STEP 1 and the success screen → nothing precedes them, so this is
              the way OUT, and it matches how the user got here: "Home" for a
              guest / marketing entry (no jump into a lingering session's
              account without a fresh sign-in), or "Dashboard" for a signed-in
              "Add Card" (add=1 → guest=false, the server verified the
              session). */}
        {step >= 2 && step <= 4 ? (
          <button
            type="button"
            onClick={() => setStep(step - 1)}
            className={topControlCls}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
            </svg>
            Back
          </button>
        ) : guest ? (
          <Link
            href="/"
            // Leaving for Home KEEPS the unfinished card (owner rule
            // 2026-09-16: nobody loses a card by accident). It only drops the
            // marketing sketch and plan pick; coming back through any "Get
            // started free"-style button asks "Continue your card / Start a new
            // card" — the one place a card is ever discarded.
            onClick={() => resetMarketingSketch()}
            className={topControlCls}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
            </svg>
            Home
          </Link>
        ) : step === 5 ? (
          // The card is live: this corner exit goes where the big "Continue"
          // button goes — the dashboard WITH the tour for a first card — and
          // records that notifications were just offered. It used to be a
          // plain dashboard link, so a first-timer who tapped it (an invited
          // teammate most of all: their seat skips every plan step) landed
          // with no tour and got the notification question asked twice.
          <Link href={doneHref} onClick={markPushAsked} className={topControlCls}>
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
            </svg>
            Dashboard
          </Link>
        ) : (
          <DashboardLink className={topControlCls}>
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
            </svg>
            Dashboard
          </DashboardLink>
        )}

        {/* Steps 1–4: form on the left, a live preview pinned to the right on
            DESKTOP. On mobile there is no sidebar — each step renders its own
            preview inline. Step 5 (success) is full-width. */}
        <div className={step === 5 ? "" : `grid gap-6 lg:items-start ${designerIsCanvas ? "" : "lg:grid-cols-[minmax(0,1fr)_340px]"}`}>
        <div className={step === 5 ? "" : "min-w-0 order-2 lg:order-1"}>

        {/* Step indicator (hidden on the post-create success screen) —
            1 Card information · 2 Card design · 3 Socials · 4 Social design */}
        {step <= 4 && (
          <div className="flex items-center gap-2 mb-6">
            {[1, 2, 3, 4].map((n) => (
              <div key={n} className="flex items-center gap-2 flex-1">
                <div
                  className="w-6 h-6 rounded-full flex items-center justify-center text-[0.6875rem] font-bold shrink-0 transition-colors"
                  style={{ background: step >= n ? "#2563eb" : "#1f2937", color: step >= n ? "#fff" : "#6b7280" }}
                >
                  {n}
                </div>
                {n < 4 && <div className="flex-1 h-px" style={{ background: step > n ? "#2563eb" : "#1f2937" }} />}
              </div>
            ))}
          </div>
        )}

        {/* Step 1 — card details */}
        {step === 1 && (
          <div className="space-y-4">
            <div className="mb-1">
              <h1 className="text-2xl font-bold text-white">New card</h1>
              <p className="text-gray-400 text-sm mt-1">Start with the basics.</p>
              {/* Say so when we bring a draft back, otherwise a pre-filled form
                  after a reload reads as a glitch rather than a save. */}
              {restored && (
                <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-green-500/10 border border-green-500/20 px-2.5 py-1 text-[0.6875rem] font-semibold text-green-400" role="status">
                  We kept your work from last time
                </p>
              )}
            </div>

            {/* Explicit autofill — the form stays empty unless the visitor
                chooses to pull in what they sketched on the homepage. */}
            {pendingPrefill && (
              <div className="rounded-xl border border-blue-700/50 bg-blue-950/40 px-4 py-3.5">
                <p className="text-blue-100 text-sm font-semibold">Use what you already entered?</p>
                <p className="text-blue-300/80 text-xs mt-1 leading-relaxed">
                  We saved the details you sketched on the homepage. Autofill them, or start with a blank card.
                </p>
                <div className="flex gap-2 mt-3">
                  <button type="button" onClick={() => applyPrefillData(pendingPrefill)} className="flex-1 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold py-2 rounded-full transition-colors">
                    Autofill my details
                  </button>
                  <button type="button" onClick={() => setPendingPrefill(null)} className="px-4 text-gray-400 hover:text-white text-xs font-medium transition-colors">
                    Start blank
                  </button>
                </div>
              </div>
            )}

            <div className="flex items-start gap-2.5 rounded-xl border border-blue-800/40 bg-blue-950/30 px-3.5 py-3">
              <svg viewBox="0 0 24 24" fill="none" stroke="#60a5fa" strokeWidth={1.8} className="w-4 h-4 shrink-0 mt-0.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
              </svg>
              <p className="text-blue-200/90 text-xs leading-relaxed">
                You only need to fill out the fields marked with a red asterisk <span className="text-red-500 font-semibold">*</span> — but for the best results, fill out everything you can.
              </p>
            </div>

            {/* Office sub-users: the company half is already prepared by their
                organization — shown read-only so they know it's done, never
                asked for. Fields the office left blank still render below. */}
            {org && (orgCompany || orgWebsite || orgPhone || orgFax || orgAddress || orgLogo) && (
              <div className="rounded-2xl border border-purple-500/20 bg-purple-500/[0.04] p-4">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Company information</p>
                  <ManagedTag />
                </div>
                <p className="text-gray-500 text-xs mb-3">
                  Your organization already prepared these details — they&apos;ll be on your card automatically.
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

            {/* Nothing prepared yet: say who owns the company half, instead of
                it silently not being there. */}
            {org && !(orgCompany || orgWebsite || orgPhone || orgFax || orgAddress || orgLogo) && (
              <p className="rounded-2xl border border-purple-500/20 bg-purple-500/[0.04] px-4 py-3 text-gray-400 text-xs leading-relaxed">
                Your organization adds the company details — name, logo, website and office contact — to every team card. You just add your own.
              </p>
            )}

            {/* Company-level fields are the ORGANIZATION's territory for a
                sub-user — hidden whether or not the admin filled them in, so a
                member can never add their own company info. (Owner decision,
                Jul 2026: gate on `org`, not per-field values.) */}
            {!org && (
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1.5">Card nickname</label>
                <input type="text" placeholder="e.g. Sales Card" value={nickname} onChange={(e) => setNickname(e.target.value)} className={inputCls} />
                <p className="text-gray-600 text-xs mt-1">A label shown on your dashboard so you can tell your cards apart.</p>
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1.5">Full name <span className="text-red-500">*</span></label>
              <input
                ref={nameInputRef}
                type="text"
                placeholder="John Smith"
                maxLength={120}
                value={name}
                aria-invalid={nameMissing || undefined}
                onChange={(e) => {
                  setName(e.target.value);
                  // The error sat under the Next button and stayed there after
                  // the name was filled in (2026-09-22 signup review).
                  if (nameMissing && e.target.value.trim()) { setNameMissing(false); setError(""); }
                }}
                className={`${inputCls}${nameMissing ? " ring-2 ring-red-500/70 border-red-500" : ""}`}
              />
              {/* A member has no company field, which is where this hint lives
                  for everyone else — so they never saw their card's address
                  until the card was already live. */}
              {org && <p className="text-gray-600 text-xs mt-1">Card URL: swiftcard.me/{prettyUsername || "your-name"}</p>}
            </div>
            {!org && (
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1.5">Company name</label>
                <input type="text" placeholder="Acme Corp" value={company} onChange={(e) => setCompany(e.target.value)} className={inputCls} />
                <p className="text-gray-600 text-xs mt-1">Card URL: swiftcard.me/{prettyUsername || "your-name"}</p>
              </div>
            )}
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1.5">Job title</label>
              <input type="text" placeholder="Sales Director" value={title} onChange={(e) => setTitle(e.target.value)} className={inputCls} />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-xs font-medium text-gray-400">Phone numbers</label>
                <button type="button" onClick={addPhone} className="text-xs font-semibold text-blue-400 hover:text-blue-300">+ Add number</button>
              </div>
              <div className="space-y-2">
                {/* flex-wrap: the type picker, the number and the On-card toggle
                    are three fixed-ish items in one row. At 320px that squeezed
                    the number field to 98px and hid 30px of what you'd typed —
                    you could not read your own phone number back. Wrapping lets
                    the toggle drop to a second line there; at 375px and up the
                    row still fits on one line exactly as before. */}
                {phones.map((p, i) => (
                  <div key={i} className="flex flex-wrap items-center gap-2">
                    {/* Office members don't choose a type: the company number is
                        set once by their admin on the Branding page and injected
                        server-side, so every number they add here is a personal
                        mobile. Offering "Office" let them add a second, competing
                        office number to a company-branded card. */}
                    {org ? (
                      <span
                        title="Your organization sets the office number — numbers you add are your mobile."
                        className="bg-gray-900 border border-gray-700 text-gray-400 rounded-xl px-3 py-3 text-sm shrink-0"
                      >
                        Mobile
                      </span>
                    ) : (
                      <select
                        // Its only visible context is the phone field beside it,
                        // so on its own it announced as an unlabelled select.
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
                      onChange={(e) => updatePhone(i, { number: e.target.value })}
                      // min-w-[9rem], not min-w-0: with min-w-0 the field just
                      // shrank to 98px at 320px and hid 30px of the number, and
                      // flex-wrap never fired because nothing ever exceeded the
                      // line. Giving it a floor forces the On-card toggle onto a
                      // second row there instead. 9rem = 144px is below the
                      // 153px the field already gets at 375px, so every real
                      // phone keeps the single-row layout untouched.
                      className={`${inputCls} flex-1 min-w-[9rem]`}
                    />
                    <button
                      type="button"
                      onClick={() => updatePhone(i, { showOnCard: !p.showOnCard })}
                      title={p.showOnCard ? "Showing on card" : "Hidden from card"}
                      // "Off card" is STATE the owner has to be able to read —
                      // this number is hidden from their card — not decoration.
                      // At gray-500 it measured 3.67:1 against gray-900 in the
                      // dark theme, under the 4.5:1 a 12px label needs. gray-400
                      // is 6.82:1, still clearly quieter than the blue "on"
                      // state, and it is the shade the template chips below
                      // already use for exactly the same unselected job.
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
              <p className="text-gray-600 text-xs mt-1.5">Label each number and pick which ones appear on your card (you can show more than one).</p>
              {org && orgPhone && (
                <p className="text-gray-500 text-xs mt-1">
                  Your office number ({orgPhone}) is added to your card automatically by your organization.
                </p>
              )}
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1.5">Email</label>
              <input type="email" placeholder="john@company.com" value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} />
            </div>

            {/* Website is CARD information — it renders on the card itself (and
                on Swift Links too), so it's asked here with the other card
                fields, not on the Socials step. Company-level for a sub-user:
                the org decides it, so members never get the input. */}
            {!org && (
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1.5">Website</label>
                <input
                  type="text"
                  placeholder="yoursite.com"
                  value={website}
                  onChange={(e) => setWebsite(e.target.value)}
                  className={inputCls}
                />
              </div>
            )}

            {!org && <AddressInput value={address} onChange={setAddress} />}

            {!org && (
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1.5">
                  Fax number <span className="text-gray-600 font-normal">· shows on your card only</span>
                </label>
                <input type="tel" placeholder="+1 (555) 000-0000" value={fax} onChange={(e) => setFax(e.target.value)} className={inputCls} />
              </div>
            )}

            {/* Mobile: the card preview sits at the BOTTOM of this step, right
                after the last field. It used to be the sidebar copy dropped to
                order-3, which put it below the "Next" button — past the point
                anyone was still scrolling. */}
            <div className="lg:hidden">{livePreview}</div>

            {error && <p className="text-red-400 text-sm">{error}</p>}

            <button onClick={goNextFrom1} className="w-full bg-blue-600 hover:bg-blue-500 text-white font-semibold py-3 rounded-full transition-colors text-sm mt-2">
              Next: Card design →
            </button>
          </div>
        )}

        {/* Step 3 — Socials: bio, social links, additional links */}
        {step === 3 && (
          <div className="space-y-5">
            <div className="mb-1">
              <h1 className="text-2xl font-bold text-white">Socials</h1>
              <p className="text-gray-400 text-sm mt-1">Your bio, social profiles, and extra links — they live on your Swift Links page. Only the bio is required.</p>
            </div>

            {/* Swiftlinks bio */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label htmlFor="wizard-bio" className="block text-xs font-medium text-gray-400">
                  Swift Links bio{!bioManaged && <span className="text-red-400 ml-0.5" aria-hidden="true">*</span>}
                </label>
                {/* The office can write one bio for the whole team, and the
                    server puts it on the card when it's created — so an
                    editable box here quietly threw the member's words away
                    (the editor already shows it read-only; now both agree). */}
                {bioManaged
                  ? <ManagedTag />
                  : <span className="text-[0.625rem] font-semibold text-blue-400">Tip: be descriptive</span>}
              </div>
              <textarea
                id="wizard-bio"
                value={bioManaged ? (org?.linkBio ?? "") : bio}
                onChange={(e) => {
                  setBio(e.target.value);
                  if (bioMissing && e.target.value.trim()) setBioMissing(false);
                }}
                readOnly={bioManaged}
                required={!bioManaged}
                aria-invalid={bioMissing || undefined}
                rows={3}
                placeholder="e.g. Austin realtor helping first-time buyers find their dream home — 10+ years, 200+ closings. Let's talk!"
                className={`w-full bg-gray-900 border border-gray-700 text-white placeholder-gray-600 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-blue-500 transition-colors resize-none ${bioManaged ? "opacity-70 cursor-default" : ""}${bioMissing ? " ring-2 ring-red-500/70 border-red-500" : ""}`}
              />
              {bioMissing && <p className="text-red-400 text-xs mt-1">Add a bio to continue.</p>}
              {bioManaged ? (
                <p className="text-gray-600 text-[0.6875rem] mt-1">Your company writes one bio for the whole team. AI follow-ups also read this bio when they write your messages.</p>
              ) : (
                <p className="text-gray-600 text-[0.6875rem] mt-1">
                  Shows at the top of your Swift Links — the first thing visitors read. Say <strong className="text-gray-400">who you help, what you do, and why they should reach out</strong>. Descriptive bios get more taps. <strong className="text-gray-400">AI follow-ups also read your bio</strong>, so the messages they write speak to what you do.
                </p>
              )}
            </div>

            {/* Social links (website lives on step 1 — it's card information) */}
            <div>
              <p className="text-xs font-medium text-gray-400 mb-1">Social links</p>
              <p className="text-gray-600 text-[0.6875rem] mb-3">Type your username for each one — we build the link. Pasting a full profile URL works too.</p>
              <div className="space-y-3">
                {SOCIALS.map(({ key, label, placeholder }) => {
                  // Instagram is the ONE social an office can set; the server
                  // puts the company's on the card. Every other one stays theirs.
                  const managed = key === "instagram" && instagramManaged;
                  const linked = !managed && socials[key].trim().length > 0;
                  return (
                    <div key={key}>
                      <div className="flex items-center justify-between mb-1">
                        <label className="block text-xs text-gray-500">
                          {label}
                          {managed && <span className="ml-1.5 align-middle"><ManagedTag /></span>}
                        </label>
                        {linked && socialUrl(key, socials[key]) && (
                          <a href={socialUrl(key, socials[key])!} target="_blank" rel="noopener noreferrer"
                            className="flex items-center gap-1 text-[0.625rem] font-semibold text-blue-400 hover:text-blue-300">
                            <svg viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3"><path fillRule="evenodd" d="M5.22 14.78a.75.75 0 001.06 0l7.22-7.22v5.69a.75.75 0 001.5 0v-7.5a.75.75 0 00-.75-.75h-7.5a.75.75 0 000 1.5h5.69l-7.22 7.22a.75.75 0 000 1.06z" clipRule="evenodd" /></svg>
                            Open link
                          </a>
                        )}
                      </div>
                      <input
                        type="text"
                        placeholder={placeholder}
                        value={managed ? (org?.linkInstagram ?? "") : socials[key]}
                        onChange={(e) => setSocial(key, e.target.value)}
                        onBlur={() => normalizeOnBlur(key)}
                        readOnly={managed}
                        className={`${inputCls} ${managed ? "opacity-70 cursor-default" : ""}`}
                      />
                      {/* Say where this will actually go. "Open link" above tells
                          you nothing until you click it, and nobody clicks it
                          while typing — so a wrong handle stayed invisible until
                          a visitor hit the 404. This also surfaces the guesses:
                          "John Doe" becomes linkedin.com/in/john-doe. */}
                      {managed ? (
                        <p className="text-gray-600 text-[0.6875rem] mt-1">Your page shows the company Instagram.</p>
                      ) : linked && socialDestination(key, socials[key]) ? (
                        <p className="text-gray-600 text-[0.6875rem] mt-1">
                          Opens <span className="text-gray-400 font-medium break-all">{socialDestination(key, socials[key])}</span>
                        </p>
                      ) : linked ? (
                        <p className="text-red-400 text-[0.6875rem] mt-1">
                          This won&rsquo;t open as a link — just your username, like <span className="font-medium">{SOCIALS.find((x) => x.key === key)!.example}</span>
                        </p>
                      ) : (
                        <p className="text-gray-600 text-[0.6875rem] mt-1">{socialHint(SOCIALS.find((x) => x.key === key)!)}</p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="h-px bg-gray-800" />

            {/* Additional links.

                An office can PIN links to every page; the server adds them to a
                new member card on save, so they are not repeated here — what
                this step collects is the member's OWN links, which sit after
                the company's. */}
            <div>
              <p className="text-xs font-medium text-gray-400 mb-1">Additional links</p>
              <p className="text-gray-600 text-[0.6875rem] mb-3">
                {officeLinks?.length
                  ? "Your organization's links are already on your page. Add your own here — they're yours to change."
                  : "Add your links — can be a review page, recent video, listing, etc."}
              </p>
              {links.length > 0 && (
                <div className="space-y-2 mb-2">
                  {links.map((l, i) =>
                    l.kind === "header" ? (
                      <div key={i} className={`flex items-center gap-2 border border-dashed rounded-xl px-3 py-2.5 ${isOfficeRow(l) ? "bg-purple-500/[0.06] border-purple-500/25" : "bg-gray-900 border-gray-700"}`}>
                        <span className="text-[0.5625rem] font-bold uppercase tracking-wide text-gray-500 shrink-0">Section</span>
                        <input
                          type="text"
                          value={l.label}
                          onChange={(e) => setLinks((prev) => prev.map((x, xi) => (xi === i ? { ...x, label: e.target.value } : x)))}
                          placeholder="Section title (e.g. Watch)"
                          readOnly={isOfficeRow(l)}
                          className={`flex-1 min-w-0 bg-transparent text-gray-200 text-xs font-bold uppercase tracking-wide focus:outline-none placeholder-gray-600 ${isOfficeRow(l) ? "cursor-default opacity-80" : ""}`}
                        />
                        {isOfficeRow(l) ? (
                          <span className="text-[0.5625rem] font-semibold uppercase tracking-wide text-purple-300 shrink-0">Company</span>
                        ) : (
                          <button type="button" onClick={() => removeLink(i)} className="text-gray-600 hover:text-red-400 transition-colors text-lg leading-none shrink-0">×</button>
                        )}
                      </div>
                    ) : (
                    <div key={i} className="bg-gray-900 border border-gray-700 rounded-xl px-3 py-2.5">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 min-w-0">
                          <p className="text-gray-200 text-xs font-semibold truncate">{l.label}</p>
                          <p className="text-gray-500 text-[0.625rem] truncate">{l.url}</p>
                        </div>
                        <button type="button" onClick={() => removeLink(i)} className="text-gray-600 hover:text-red-400 transition-colors text-lg leading-none shrink-0">×</button>
                      </div>
                      {/* How the link LOOKS on the page (Featured / Grid /
                          Compact, its preview, its row style) is chosen per
                          link on the Social design step — see LinkButtonsControls. */}
                    </div>
                    ),
                  )}
                </div>
              )}
              {/* Section headers — chapters for a long page. Pro-gated the
                  same way as the size control, and OUTSIDE the links-exist
                  wrapper so a header can open the page's first section before
                  any link has been added. */}
              {designUnlocked && (
                <button
                  type="button"
                  onClick={() => setLinks((prev) => [...prev, { label: "", url: "", kind: "header" as const }])}
                  className="block mb-2 text-[0.6875rem] font-semibold text-gray-400 hover:text-gray-200 transition-colors"
                >
                  + Add a section header
                </button>
              )}
              {atLinkCap ? (
                <PlanGate
                  feature="swift-links-cap"
                  nativeCopy="Pro feature — Free includes 2 links. More links are only available on the Pro plan"
                >
                  <p className="text-[0.6875rem] text-gray-500 bg-gray-900 border border-gray-800 rounded-xl px-3 py-2.5 leading-relaxed">
                    Free includes {PLAN_LIMITS.FREE_MAX_LINKS} additional links. <Link href="/upgrade" className="text-blue-400 font-semibold hover:text-blue-300 underline">Upgrade to Pro</Link> to access unlimited additional links.
                  </p>
                </PlanGate>
              ) : (
                <div className="space-y-2">
                  <input
                    type="text"
                    placeholder="Link name (e.g. Leave a review)"
                    value={newLink.label}
                    onChange={(e) => setNewLink((n) => ({ ...n, label: e.target.value }))}
                    className={inputCls}
                  />
                  <input
                    type="text"
                    placeholder="https://…"
                    value={newLink.url}
                    onChange={(e) => setNewLink((n) => ({ ...n, url: e.target.value }))}
                    className={inputCls}
                  />
                  {(() => {
                    const readyToAdd = !!newLink.label.trim() && !!newLink.url.trim();
                    return (
                      <button
                        type="button"
                        onClick={addLink}
                        disabled={!readyToAdd}
                        className={`w-full text-xs font-semibold py-2.5 rounded-xl transition-colors ${
                          readyToAdd
                            ? "sc-btn-glow bg-blue-600 hover:bg-blue-500 text-white border border-blue-500"
                            : "border border-dashed border-gray-700 text-gray-400 disabled:opacity-40"
                        }`}
                      >
                        + Add link
                      </button>
                    );
                  })()}
                </div>
              )}
            </div>

            {/* Mobile: the SWIFT LINKS preview, not the card one. Everything on
                this step — bio, socials, extra links — lives on the Swift Links
                page and NONE of it shows on the card, so the card preview that
                used to sit at the bottom here was previewing the wrong thing.
                After the links, so it reflects everything above it. */}
            <div className="lg:hidden">{mobileLinkPagePreview}</div>

            <div className="flex gap-3 mt-2">
              <button onClick={() => setStep(2)} className="flex-1 border border-gray-700 text-gray-400 hover:border-gray-500 font-semibold py-3 rounded-full transition-colors text-sm">
                ← Back
              </button>
              <button onClick={() => { if (requireBio()) setStep(4); }} className="flex-[2] bg-blue-600 hover:bg-blue-500 text-white font-semibold py-3 rounded-full transition-colors text-sm">
                Next: Social design →
              </button>
            </div>
          </div>
        )}

        {/* Step 5 — card created: turn on notifications for this card */}
        {step === 5 && (
          <div className="space-y-5 text-center">
            <div className="w-14 h-14 rounded-full bg-green-900/40 border border-green-700/40 flex items-center justify-center mx-auto">
              <svg className="w-7 h-7 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white">Your card is live!</h1>
              <p className="text-blue-400 text-sm mt-1 font-mono">swiftcard.me/{createdUsername ? (cardSlug(name, company) === createdUsername ? prettyUsername : createdUsername) : prettyUsername}</p>
              {/* The account's first card is when "Your SwiftCard is live" goes
                  out (lib/welcome-email: once per account, card + plan) — the
                  same line the /welcome version of this screen shows. A later
                  card sends nothing, so it says nothing. */}
              {(isFirstCard || tourOnDone || postCheckout) && (
                <p className="text-gray-400 text-sm mt-3">We also sent you an email with your link.</p>
              )}
            </div>

            <EnablePushButton />

            <GetTheAppCard />

            <button
              type="button"
              onClick={() => { markPushAsked(); router.push(doneHref); }}
              className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold text-base py-4 rounded-full transition-colors"
            >
              Go to my dashboard →
            </button>
          </div>
        )}

        {/* Step 2 — Card design: Photos · Template · the numbered design steps
            (the same tab as the edit form's Card design) */}
        {step === 2 && (
          <div className="space-y-5">
            {/* Phone: the card sits at the top of the step and stays pinned to
                the top of the screen while every control below scrolls under
                it. Not while the custom designer is open — that IS the card. */}
            {!(customSelected && customDesignAvailable && !designLocked) && (
              <PinnedCardPreview undo={cardHistory}>{cardTemplateEl}</PinnedCardPreview>
            )}
            <div className="mb-1">
              <h1 className="text-2xl font-bold text-white">Card design</h1>
              <p className="text-gray-400 text-sm mt-1">{org ? (designLocked ? "Add your headshot — your organization sets the logo and the design." : "Add your headshot, then pick a design. Your organization sets the logo.") : "Add your logo and headshot, then pick a design."}</p>
            </div>

            {/* Photos — open while something is missing (always, for a new
                card), folded to a summary once both are set. Native <details>,
                so it works before hydration. */}
            <MoreOptions
              label="Logo & headshot"
              hint={photosSummary}
              defaultOpen={photosStartOpen}
              lead={
                <span className="flex -space-x-2 shrink-0" aria-hidden>
                  {[logoUrl, headshotUrl].map((src, i) =>
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
              {/* The company logo is org territory for a sub-user — managed tile
                  when the admin has set one, and NO upload either way (a member
                  can never add their own; the branding page is the only source). */}
              {org ? (
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="block text-xs font-medium text-gray-400">Company logo</label>
                    <ManagedTag />
                  </div>
                  <div className="flex items-center gap-3 rounded-xl border border-gray-800 bg-gray-900/60 px-3.5 py-3">
                    {orgLogo ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={orgLogo} alt="Company logo" className="w-10 h-10 rounded-lg object-contain bg-white p-1" />
                    ) : null}
                    <p className="text-gray-500 text-xs">
                      {orgLogo
                        ? "Your organization's logo is used on every connected card."
                        : "Your organization manages the company logo — it appears here once your admin sets it on the Branding page."}
                    </p>
                  </div>
                </div>
              ) : (
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1.5">Company logo</label>
                  <ImageUpload field="logo" currentUrl={logoUrl} label="Upload your company logo" shape="square" defer guest={guest} onUploaded={(url) => setLogoUrl(url || null)} />
                  {/* Suggest an official company logo (Agent 4 contract). Fails safe —
                      renders nothing when the provider isn't configured. */}
                  <LogoSuggest company={company} email={email} onConfirm={(url) => setLogoUrl(url || null)} />
                  {logoUrl && (
                    <div className="mt-2">
                      {/* The shared Segmented, same as the edit form. This was a
                          hand-rolled grey-on-grey pair whose selected state was
                          nearly invisible. */}
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
              )}

              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1.5">Headshot</label>
                <ImageUpload
                  field="photo"
                  currentUrl={headshotUrl}
                  label="Upload your headshot"
                  hint="Recommended. This will also be used for your SwiftLink."
                  shape="circle"
                  defer
                  guest={guest}
                  onUploaded={(url) => setHeadshotUrl(url || null)}
                />
                {/* Gravatar/web lookup works from the typed email pre-account;
                    a guest's Connect LinkedIn runs the one-shot guest OAuth
                    photo import and returns here via ?li_photo= (see the effect
                    above) — their draft stays local the whole time. A signed-in
                    builder with its own draft (canDraft) takes that same round
                    trip: the draft is written first, and the hop is refused if
                    it can't be. Only an Office member (no draft) still uses the
                    popup that keeps this page alive. */}
                <ProfilePhotoSuggest
                  linkedinEnabled={linkedinEnabled}
                  returnTo={guest ? "/cards/new" : "/cards/new?add=1"}
                  guest={guest}
                  email={email}
                  photoReturn={canDraft}
                  beforeLeave={() => drafts.flush()}
                  onConfirm={(url) => setHeadshotUrl(url)}
                />
              </div>
            </MoreOptions>

            {/* Design — locked for sub-users while the office's Lock Card Design
                setting is on; the server enforces the office look regardless. */}
            {designLocked ? (
              <div className="rounded-2xl border border-purple-500/20 bg-purple-500/[0.04] p-5">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Card design</p>
                  <ManagedTag />
                </div>
                <p className="text-gray-400 text-sm leading-relaxed">
                  Your organization keeps every card matching, so the template, colors and
                  fonts are applied automatically when your card is created.
                </p>
              </div>
            ) : (
            <div className="space-y-5">
              <TemplatePicker
                template={template}
                onSelect={setTemplate}
                data={withoutSocials(previewData)}
                customUnlocked={customDesignAvailable}
                upsell={false}
              />

              {/* The designer comes AFTER the picker that selects it, and is
                  itself a live card you edit by touching — so it stands in for
                  the inline preview rather than sitting above a second copy. */}
              {customSelected && customDesignAvailable ? (
                <div>
                  {/* canScan={isPro}, NOT designUnlocked: the designer is shown
                      to guests and Free first-card users as a preview, but
                      /api/scan-design needs a session and a paid plan. */}
                  <CustomCardDesigner layout={customLayout} data={previewData} onChange={setCustomLayout} canScan={isPro} undo={cardHistory} />
                </div>
              ) : null}

              {/* Restyle the chosen preset, one numbered step at a time. No PRO
                  badge on a header: Looks, swatches, fonts and three finishes
                  work on every plan. The Pro pieces carry their own tag inside
                  the panel (same as the editor — the two must never disagree). */}
              {!customSelected && (
                <div>
                  <TemplateStyleControls value={templateStyleState} onChange={patchTemplateStyle} template={template} locked={!designUnlocked} canUpload />
                  {!isPro && !designUnlocked && (
                    <PlanGate
                      feature="colors-fonts"
                      nativeCopy="Any color, material finishes and panel photos are part of the Pro plan"
                    >
                      <Link href="/upgrade" className="block text-center text-[0.6875rem] text-blue-400 hover:text-blue-300 mt-2">
                        Any color, every finish and photo backgrounds come with Pro →
                      </Link>
                    </PlanGate>
                  )}
                </div>
              )}
            </div>
            )}

            <div className="flex gap-3 mt-1">
              <button onClick={() => setStep(1)} className="flex-1 border border-gray-700 text-gray-400 hover:border-gray-500 font-semibold py-3 rounded-full transition-colors text-sm">
                ← Back
              </button>
              <button onClick={() => setStep(3)} className="flex-[2] bg-blue-600 hover:bg-blue-500 text-white font-semibold py-3 rounded-full transition-colors text-sm">
                Next: Socials →
              </button>
            </div>
          </div>
        )}

        {/* Step 4 — Social design: the Swift Links page's look, with a live
            preview of the page itself. Separate keys from the card design, so
            the two steps never fight over the same values. */}
        {step === 4 && (
          <div className="space-y-5">
            {/* Phone: the Swift Links page sits at the top of the step and stays
                pinned while every control below scrolls under it; tap it to
                see the whole page. */}
            <PinnedLinkPreview undo={linkHistory}>{linkPageEl}</PinnedLinkPreview>
            <div className="mb-1">
              <h1 className="text-2xl font-bold text-white">Social design</h1>
              <p className="text-gray-400 text-sm mt-1">
                Style your Swift Links page — the page where your bio, socials and links live.
              </p>
            </div>

            {/* The "View SwiftCard →" link at the bottom of the page — theirs to
                keep or hide. The shared Switch, identical to the editor's: one
                on/off control for the whole product. */}
            <Switch
              checked={showCardLinkBtn}
              onChange={setShowCardLinkBtn}
              label={"Show the “View SwiftCard” button"}
              help="The small link at the bottom of your Swift Links page that opens your card."
            />

            {linkDesignLocked ? (
              // Mirrors the editor: the office holds this page's look, so the
              // panel is replaced by one explanation rather than shown dead.
              <div className="rounded-2xl border border-purple-500/20 bg-purple-500/[0.04] p-5">
                <p className="text-white text-sm font-semibold mb-1.5">Your organization sets this page&apos;s look</p>
                <p className="text-gray-400 text-sm leading-relaxed">
                  Every Swift Links page on your team matches. Your bio, your socials and your own
                  link buttons are still yours.
                </p>
                {/* The page LOOK is the office's, but each member's OWN link
                    buttons are still theirs to style (owner, 2026-09-16).
                    Company rows show here tagged and fixed. */}
                {links.some((l) => l.kind !== "header" && !isOfficeRow(l)) && (
                  <div className="mt-4 pt-4 border-t border-purple-500/15">
                    <p className="text-gray-200 text-[0.8125rem] font-semibold">Your link buttons</p>
                    <p className="text-gray-500 text-[0.6875rem] leading-snug mb-2">Choose how each of your own links appears: Featured, Grid or Compact.</p>
                    <LinkButtonsControls links={links} onChange={setLinks} pageRowStyle={linkStyleState.linkButtonStyle} pageGlass={!!linkStyleState.linkGlass && !!linkStyleState.linkBgMedia} isLocked={isOfficeRow} canUpload />
                  </div>
                )}
              </div>
            ) : (
              <SwiftLinkStyleControls
                value={linkStyleState}
                onChange={patchLinkStyle}
                locked={!designUnlocked}
                links={links}
                onLinksChange={setLinks}
                isLinkLocked={isOfficeRow}
                // A guest has no account to upload against yet (every upload
                // route answers 401) — same rule as the homepage builder.
                canUpload
              />
            )}
            {!isPro && !designUnlocked && (
              <PlanGate
                feature="colors-fonts"
                nativeCopy="Pro feature — Custom colors and fonts are only available on the Pro plan"
              >
                <Link href="/upgrade" className="block text-center text-[0.6875rem] text-blue-400 hover:text-blue-300">
                  Unlock custom colors &amp; fonts with Pro →
                </Link>
              </PlanGate>
            )}

            {error && <p className="text-red-400 text-sm">{error}</p>}
            {/* Native-only: shown in place of the /upgrade redirect when a Free
                user hits the card cap. Never renders on web (multiCardBlocked
                stays false there). */}
            {multiCardBlocked && (
              <div className="mt-2">
                <PlanNotice tier="pro" copy="Pro feature — Multiple cards are only available on the Pro plan" />
              </div>
            )}

            {/* The final row. Back is sized to its word and the save button takes
                the rest on ONE line: at 390px the old 1:2 split squeezed "Save and
                create your account →" into two cramped lines inside its pill
                (owner, 2026-09-16: "looks very unprofessional"). */}
            <div className="flex items-center gap-3 mt-1">
              <button onClick={() => setStep(3)} className="shrink-0 border border-gray-700 text-gray-400 hover:border-gray-500 font-semibold px-5 py-3.5 rounded-full transition-colors text-sm">
                ← Back
              </button>
              {/* ── A GUEST NEVER PICKS A PLAN HERE (2026-09-15) ──────────────
                  The order is: build → design → socials → social design →
                  save → CREATE ACCOUNT → choose plan. Asking for the plan
                  before the account existed meant the answer had nowhere to
                  live but localStorage, and a one-shot localStorage read is
                  what put a guest who chose Free onto a Pro trial: the value
                  was gone by the time /welcome asked for it, so /welcome asked
                  again. There is no stored intent to lose now — /welcome owns
                  the plan decision, once, with the account already in hand. */}
              <button
                onClick={() => {
                  // Before any gate or sign-up: a guest's card is created from
                  // the saved draft after the account exists, never here.
                  if (!requireBio()) return;
                  if (!guest) {
                    // First-card design preview on an authed Free account →
                    // force the same Free/Pro choice a guest gets, since they
                    // may have used Pro-only colors/the custom designer.
                    if (showAuthedFirstCardGate) { setShowPlan(true); return; }
                    requireAuth("save", handleCreate);
                    return;
                  }
                  // Guest: save the work and make the account. `?plan=pro` from
                  // /pricing is carried to /welcome in the URL by the claim, not
                  // stashed as an intent — a hint about which card to highlight,
                  // never a decision already taken.
                  requireAuth("save", handleCreate, { forceGate: true });
                }}
                disabled={status === "loading"}
                className="flex-1 min-w-0 whitespace-nowrap bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-semibold px-4 py-3.5 rounded-full shadow-[0_8px_20px_-8px_rgba(37,99,235,0.6)] transition-colors text-[0.9375rem]"
              >
                {status === "loading" ? "Creating…"
                  : showAuthedFirstCardGate ? "Continue to plans →"
                  : !guest ? "Create card →"
                  : "Save & create account →"}
              </button>
            </div>
          </div>
        )}
        </div>{/* editor column */}

        {/* Pinned preview — DESKTOP ONLY. Steps 1-2 build the CARD, so they
            preview the card. Steps 3 (Socials) and 4 (Social design) build the
            SWIFT LINKS page — the bio, the social handles, the link buttons and
            their styling — none of which appear on the card, so both preview
            the links page. Mobile already worked this way.

            Mobile renders nothing here: every step drops its own preview inline
            at the point in the form where it belongs, which CSS `order` cannot
            express — order can reorder a sibling, but never place one INSIDE
            the form column. */}
        {step !== 5 && !designerIsCanvas && (
          <div className="hidden lg:block lg:order-2 lg:sticky lg:top-6">
            {step === 3 || step === 4 ? linkPagePreview : livePreview}
          </div>
        )}
        </div>{/* grid */}
      </div>
    </main>
    {/* Plan-choice gate — AUTHED FIRST CARD ONLY.
        A signed-in owner creating their first card already has an account, so
        the plan can be settled here and the card created once, with any Pro-only
        design converted in place (after a confirmation when something actually
        needs converting).
        A GUEST never reaches this: they have no account yet, so there is nowhere
        to record a plan except localStorage, and that is precisely the hole that
        put someone on a trial they declined. Their plan step is /welcome. */}
    {showPlan && showAuthedFirstCardGate && (
      <>
      {/* Dim + blur live on their OWN non-scrolling layer. backdrop-filter on the
          SAME element as overflow-y-auto silently kills touch scrolling on iOS
          Safari — here that would trap a phone user in the plan gate, unable to
          scroll down to the plan cards. Same split as SignatureDemo's popup. */}
      <div className="fixed inset-0 z-[89] bg-gray-950/97 backdrop-blur-sm" aria-hidden />
      <div className="fixed inset-0 z-[90] overflow-y-auto">
        {/* pt clears the notch/status bar in the shell — "Back to your card"
            sat directly under the clock on a notched iPhone. */}
        <div className="min-h-full flex items-start justify-center px-5 pb-10 pt-[max(2.5rem,calc(env(safe-area-inset-top)+2.5rem))]">
          <div className="w-full max-w-6xl">
            <div className="text-center mb-6">
              {/* "Back to your card" on the plan cards only. The design choice
                  ("Before you go Free") has NO way back (owner, 2026-09-18):
                  keep the card exactly as built, or continue with Free and
                  redesign with free features — the same two as /welcome. */}
              {!pendingFreeConfirm && (
                <button
                  onClick={() => setShowPlan(false)}
                  className="text-gray-500 hover:text-white text-sm mb-4 inline-flex items-center gap-1.5"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
                  Back to your card
                </button>
              )}
              <h2 className="text-white font-bold text-2xl">{pendingFreeConfirm ? "Before you go Free" : "Choose your plan"}</h2>
              <p className="text-gray-400 text-sm mt-1.5">
                {pendingFreeConfirm
                  ? "One thing to know about the card you just designed."
                  : "Pick a plan for this card. Free to start — upgrade anytime."}
              </p>
            </div>
            {referralGift && (
              <ReferralGiftPanel onStart={handleAuthedFirstCardGift} busy={status === "loading"} starting={status === "loading"} />
            )}
            {pendingFreeConfirm ? (
              <FreeDesignChoice
                changes={freeDesignChanges()}
                onKeepWithTrial={keepDesignWithTrial}
                onContinueFree={confirmFreeDesignAndCreate}
                trialEligible={trialEligible}
                onIapPurchased={() => { setShowPlan(false); setPendingFreeConfirm(false); handleCreate(undefined, undefined, false, true); }}
                busy={status === "loading"}
              />
            ) : (
              <PlanCards
                onFree={handleAuthedFirstCardFree}
                onPaid={handleAuthedFirstCardPaid}
                busy={null}
                trialEligible={trialEligible}
                // NOT "Start free →": that is the PRO card's button label too
                // (it starts the free trial), so this screen had two buttons
                // reading exactly the same words — one genuinely free, one a
                // paid subscription with a card taken at checkout. Someone
                // reaching for Free could land in checkout, and the label gave
                // them no way to tell. Found while driving the live flow.
                freeLabel="Continue with Free →"
                // Native IAP: the entitlement is synced before this fires, so the
                // server keeps the Pro design; no checkout hop, straight to save.
                onIapPurchased={() => { setShowPlan(false); handleCreate(undefined, undefined, false, true); }}
                // onCreateAccountForPro is gone: it only ever existed for a
                // guest on native, and a guest no longer sees this gate at all.
              />
            )}
          </div>
        </div>
      </div>
      </>
    )}
    {/* Self-contained auth gate — the useGuestDraft hook opens it via a window
        event when a guest triggers a protected action. */}
    <GuestGateModal />
    </>
  );
}
