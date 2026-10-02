"use client";

import Link from "next/link";
import { useState } from "react";
import ImageUpload from "@/components/ImageUpload";
import ProfilePhotoSuggest from "@/components/ProfilePhotoSuggest";
import LogoSuggest from "@/components/LogoSuggest";
import ClassicPro from "@/components/card-templates/ClassicPro";
import ModernBold from "@/components/card-templates/ModernBold";
import PhotoFirst from "@/components/card-templates/PhotoFirst";
import LocalBusiness from "@/components/card-templates/LocalBusiness";
import LuxuryMinimal from "@/components/card-templates/LuxuryMinimal";
import LogoFirst from "@/components/card-templates/LogoFirst";
import { SAMPLE_DATA, withoutSocials } from "@/components/card-templates/types";
import { PlanGate } from "@/components/PlanGate";
import { PLAN_LIMITS, isPaidPlan } from "@/lib/plan";
import type { ComponentType } from "react";
import type { CardData, CardCustomization, CardLink, CardTestimonial } from "@/components/card-templates/types";


const LINK_PRESETS: { emoji: string; label: string }[] = [
  { emoji: "", label: "Book a call" },
  { emoji: "", label: "Visit website" },
  { emoji: "", label: "View portfolio" },
  { emoji: "", label: "Leave a review" },
  { emoji: "", label: "Pay me" },
  { emoji: "", label: "View menu" },
  { emoji: "", label: "Download" },
  { emoji: "", label: "Watch video" },
];

function parseSocial(raw: string, platform: "instagram" | "twitter" | "tiktok" | "linkedin" | "snapchat"): string {
  const v = raw.trim();
  if (!v) return "";
  const urlStr = v.includes("://") ? v : `https://${v}`;
  try {
    const url = new URL(urlStr);
    const parts = url.pathname.split("/").filter(Boolean);
    if (platform === "linkedin") {
      if (parts[0] === "in" && parts[1]) return `linkedin.com/in/${parts[1]}`;
      return v;
    }
    if (platform === "snapchat") {
      if (parts[0] === "add" && parts[1]) return `@${parts[1]}`;
    }
    const handle = parts[0]?.replace(/^@/, "");
    if (handle) return `@${handle}`;
  } catch { /* not a URL */ }
  if (v.startsWith("@")) return v;
  if (/^[\w.]+$/.test(v) && platform !== "linkedin") return `@${v}`;
  return v;
}

const TEMPLATES: { id: string; label: string; Component: ComponentType<{ data: CardData }>; tags: string[] }[] = [
  { id: "classic-pro",    label: "Classic Pro",    Component: ClassicPro,     tags: ["QR", "Social", "Logo"] },
  { id: "modern-bold",    label: "Modern Bold",    Component: ModernBold,     tags: ["QR", "Social", "Bold"] },
  { id: "photo-first",    label: "Photo First",    Component: PhotoFirst,     tags: ["Photo", "QR", "Social"] },
  { id: "local-business", label: "Local Business", Component: LocalBusiness,  tags: ["Logo", "QR", "Map"] },
  { id: "luxury-minimal", label: "Luxury Minimal", Component: LuxuryMinimal,  tags: ["QR", "Minimal", "Gold"] },
  { id: "logo-first",     label: "Logo First",     Component: LogoFirst,      tags: ["Logo", "QR", "Navy"] },
];

const PRESET_COLORS = [
  { label: "Blue",   value: "#2563eb" },
  { label: "Green",  value: "#16a34a" },
  { label: "Red",    value: "#dc2626" },
  { label: "Purple", value: "#7c3aed" },
  { label: "Pink",   value: "#db2777" },
  { label: "Orange", value: "#ea580c" },
  { label: "Teal",   value: "#0d9488" },
  { label: "Gold",   value: "#b08d57" },
  { label: "Slate",  value: "#475569" },
];

const FONT_OPTIONS = [
  { label: "Sans-serif (default)", value: "" },
  { label: "Serif",  value: "Georgia, 'Times New Roman', serif" },
  { label: "Mono",   value: "ui-monospace, 'Courier New', monospace" },
];

type Profile = {
  username: string;
  name: string;
  title: string | null;
  company: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  linkedin: string | null;
  instagram: string | null;
  twitter: string | null;
  tiktok: string | null;
  photo_url: string | null;
  logo_url: string | null;
  template: string | null;
  plan: string | null;
  customization: CardCustomization | null;
};

export default function ProfileForm({ profile, linkedinEnabled = false }: { profile: Profile; linkedinEnabled?: boolean }) {
  const isPro = isPaidPlan(profile.plan);
  const [photoUrl, setPhotoUrl] = useState<string | null>(profile.photo_url);
  const [logoUrl, setLogoUrl] = useState<string | null>(profile.logo_url);
  const [template, setTemplate] = useState(profile.template ?? "classic-pro");
  const [customization, setCustomization] = useState<CardCustomization>(profile.customization ?? {});
  const [links, setLinks] = useState<CardLink[]>((profile.customization as CardCustomization)?.links ?? []);
  const [addingLink, setAddingLink] = useState(false);
  const [newLink, setNewLink] = useState<CardLink>({ emoji: "", label: "", url: "" });
  const [testimonials, setTestimonials] = useState<CardTestimonial[]>((profile.customization as CardCustomization)?.testimonials ?? []);
  const [addingTestimonial, setAddingTestimonial] = useState(false);
  const [newTestimonial, setNewTestimonial] = useState<CardTestimonial>({ name: "", text: "" });
  const [form, setForm] = useState({
    name: profile.name || "",
    title: profile.title || "",
    company: profile.company || "",
    email: profile.email || "",
    phone: profile.phone || "",
    website: profile.website || "",
    linkedin: profile.linkedin || "",
    instagram: profile.instagram || "",
    twitter: profile.twitter || "",
    tiktok: profile.tiktok || "",
  });
  const [status, setStatus] = useState<"idle" | "loading" | "saved" | "error">("idle");

  function handle(e: React.ChangeEvent<HTMLInputElement>) {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("loading");
    // HYDRATION-SAFE SUBMIT. Everything is interactive before it is hydrated:
    // a person who starts typing the moment the page paints (measured on
    // production 2026-09-11: React attached ~1s after the DOM was there) fills
    // the DOM while `form` state still holds the server values, and the save
    // then silently sent the OLD text with a green "Saved". The DOM is the
    // truth at submit time, so read every named field from it and let it win
    // over state. Fields without a name (colour pickers, toggles) keep state.
    const fd = new FormData(e.currentTarget as HTMLFormElement);
    const fromDom = (key: string, fallback: string) => { const v = fd.get(key); return typeof v === "string" ? v : fallback; };
    const formNow = Object.fromEntries(Object.entries(form).map(([k, v]) => [k, fromDom(k, v as string)])) as typeof form;
    const customizationNow = { ...customization, about: fromDom("about", (customization.about as string | undefined) ?? "") };
    // Save through the server so Pro-only design gates (accent/font + link cap)
    // are enforced — the browser can't write straight to the profiles table.
    try {
      const res = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...formNow, template, customization: { ...customizationNow, links, testimonials } }),
      });
      setStatus(res.ok ? "saved" : "error");
      if (res.ok) setTimeout(() => setStatus("idle"), 2000);
    } catch {
      setStatus("error");
    }
  }

  // Free is limited to FREE_MAX_LINKS Swift Links; Pro/Office get unlimited.
  const atLinkCap = !isPro && links.length >= PLAN_LIMITS.FREE_MAX_LINKS;
  function addLink() {
    if (atLinkCap) return;
    if (!newLink.label.trim() || !newLink.url.trim()) return;
    const url = newLink.url.startsWith("http") ? newLink.url : `https://${newLink.url}`;
    setLinks((prev) => [...prev, { ...newLink, url }]);
    setNewLink({ emoji: "", label: "", url: "" });
    setAddingLink(false);
  }

  function removeLink(i: number) {
    setLinks((prev) => prev.filter((_, idx) => idx !== i));
  }

  const mainFields = [
    { name: "name", label: "Full name", required: true },
    { name: "title", label: "Job title" },
    { name: "company", label: "Company" },
    { name: "email", label: "Email", type: "email" },
    { name: "phone", label: "Phone", type: "tel" },
    { name: "website", label: "Website" },
    { name: "linkedin", label: "LinkedIn URL" },
  ];

  const socialFields = [
    { name: "instagram", label: "Instagram handle" },
    { name: "twitter", label: "X / Twitter handle" },
    { name: "tiktok", label: "TikTok handle" },
    { name: "snapchat", label: "Snapchat username", isCustom: true },
  ];

  const inputCls = "w-full bg-white border border-slate-200 text-slate-900 placeholder-slate-400 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-[#1D4ED8] transition-colors shadow-sm";

  const SelectedTemplate = TEMPLATES.find((t) => t.id === template)?.Component ?? TEMPLATES[0].Component;
  const previewData: CardData = {
    name: form.name || SAMPLE_DATA.name,
    title: form.title || SAMPLE_DATA.title,
    company: form.company || SAMPLE_DATA.company,
    phone: form.phone || SAMPLE_DATA.phone,
    email: form.email || SAMPLE_DATA.email,
    website: form.website || SAMPLE_DATA.website,
    instagram: form.instagram || "",
    twitter: form.twitter || "",
    tiktok: form.tiktok || "",
    linkedin: form.linkedin || "",
    initials: form.name ? form.name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2) : SAMPLE_DATA.initials,
    photoUrl,
    logoUrl,
    // Without this the preview's QR encoded MiniQR's generic swiftcard.me
    // fallback instead of this person's actual card.
    cardUrl: `${(process.env.NEXT_PUBLIC_APP_URL || "https://swiftcard.me").replace(/^https?:\/\//, "")}/${profile.username}`,
    customization,
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="bg-white border border-slate-200 rounded-2xl px-4 py-3 mb-2 shadow-sm">
        <p className="text-xs text-slate-600">Card URL</p>
        <p className="text-[#1D4ED8] text-sm">swiftcard.me/{profile.username}</p>
      </div>

      {/* Photo + Logo uploads */}
      <div className="bg-white border border-slate-200 rounded-2xl px-4 py-4 space-y-4 shadow-sm">
        <p className="text-xs text-slate-600 font-medium">Photos & Logo</p>
        <div>
          <ImageUpload
            field="photo"
            currentUrl={photoUrl}
            label="Profile photo (shown on Photo card template)"
            shape="circle"
            onUploaded={(url) => setPhotoUrl(url)}
          />
          {/* Suggest my headshot — same preview-first flow as the card editors. */}
          <ProfilePhotoSuggest
            linkedinEnabled={linkedinEnabled}
            returnTo="/profile"
            onConfirm={(url) => setPhotoUrl(url)}
          />
        </div>
        <div>
          <ImageUpload
            field="logo"
            currentUrl={logoUrl}
            label="Company logo (shown on all card templates)"
            shape="square"
            onUploaded={(url) => setLogoUrl(url)}
          />
          {/* Suggest my company logo — fails safe (renders nothing) if unconfigured. */}
          <LogoSuggest company={form.company} email={form.email} website={form.website} onConfirm={(url) => setLogoUrl(url || null)} />
        </div>
      </div>

      {/* htmlFor/id, not just proximity: a <label> that names no control is not
          a label — VoiceOver announced these as bare edit fields and Voice
          Control had nothing to match "tap Job title" against. */}
      {mainFields.map((f) => (
        <div key={f.name}>
          <label htmlFor={`profile-${f.name}`} className="text-xs text-slate-600 block mb-1">{f.label}</label>
          <input
            id={`profile-${f.name}`}
            name={f.name}
            type={f.type || "text"}
            required={f.required}
            value={form[f.name as keyof typeof form]}
            onChange={handle}
            className={inputCls}
          />
        </div>
      ))}

      <div className="h-px bg-slate-200 my-2" />
      <p className="text-xs text-slate-600 font-medium">Social links</p>

      {socialFields.map((f) => (
        <div key={f.name}>
          <label htmlFor={`profile-${f.name}`} className="text-xs text-slate-600 block mb-1">{f.label}</label>
          <input
            id={`profile-${f.name}`}
            name={f.name}
            type="text"
            placeholder="@yourhandle or paste URL"
            value={f.isCustom ? (customization[f.name as keyof typeof customization] as string ?? "") : form[f.name as keyof typeof form]}
            onChange={(e) => {
              if (f.isCustom) {
                setCustomization((prev) => ({ ...prev, [f.name]: e.target.value }));
              } else {
                setForm((prev) => ({ ...prev, [f.name]: e.target.value }));
              }
            }}
            onBlur={(e) => {
              const platform = f.name as "instagram" | "twitter" | "tiktok" | "linkedin" | "snapchat";
              const parsed = parseSocial(e.target.value, platform);
              if (f.isCustom) {
                setCustomization((prev) => ({ ...prev, [f.name]: parsed }));
              } else {
                setForm((prev) => ({ ...prev, [f.name]: parsed }));
              }
            }}
            className={inputCls}
          />
        </div>
      ))}

      {/* About / bio */}
      <div className="h-px bg-slate-200 my-2" />
      <p className="text-xs text-slate-600 font-medium">About section (optional)</p>
      <div>
        <label className="text-xs text-slate-600 block mb-1">About you or your business</label>
        <textarea
          name="about"
          placeholder="A short bio, what you do, or your services. This appears on your public card."
          value={customization.about ?? ""}
          onChange={(e) => setCustomization((prev) => ({ ...prev, about: e.target.value }))}
          rows={3}
          className="w-full bg-white border border-slate-200 text-slate-900 placeholder-slate-400 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-[#1D4ED8] transition-colors shadow-sm resize-none"
        />
      </div>

      {/* Action Links (Link-in-bio) */}
      <div className="h-px bg-slate-200 my-2" />
      <div className="flex items-center justify-between mb-1">
        <p className="text-xs text-slate-600 font-medium">Action links</p>
      </div>
      <p className="text-[0.6875rem] text-slate-600 mb-3">Add buttons to your card — Book a call, View portfolio, Leave a review, and more.</p>

      {links.length > 0 && (
        <div className="space-y-2 mb-3">
          {links.map((link, i) => (
            <div key={i} className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5">
              <span className="text-base shrink-0">{link.emoji}</span>
              <div className="flex-1 min-w-0">
                <p className="text-slate-900 text-xs font-semibold truncate">{link.label}</p>
                <p className="text-slate-600 text-[0.625rem] truncate">{link.url}</p>
              </div>
              <button
                type="button"
                onClick={() => removeLink(i)}
                className="text-slate-600 hover:text-red-500 transition-colors text-lg leading-none shrink-0"
                title="Remove"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {addingLink ? (
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3">
          <p className="text-xs text-slate-600 font-medium">Quick picks</p>
          <div className="flex flex-wrap gap-2">
            {LINK_PRESETS.map((p) => (
              <button
                key={p.label}
                type="button"
                onClick={() => setNewLink((n) => ({ ...n, emoji: p.emoji, label: p.label }))}
                className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border transition-colors"
                style={{
                  background: newLink.label === p.label ? "#EBF0FF" : "#fff",
                  borderColor: newLink.label === p.label ? "#1D4ED8" : "#e2e8f0",
                  color: newLink.label === p.label ? "#1D4ED8" : "#64748b",
                }}
              >
                <span>{p.emoji}</span> {p.label}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="Emoji"
              value={newLink.emoji}
              onChange={(e) => setNewLink((n) => ({ ...n, emoji: e.target.value }))}
              className="w-14 bg-white border border-slate-200 rounded-lg px-2 py-2 text-sm text-center focus:outline-none focus:border-[#1D4ED8]"
            />
            <input
              type="text"
              placeholder="Button label"
              value={newLink.label}
              onChange={(e) => setNewLink((n) => ({ ...n, label: e.target.value }))}
              className={`${inputCls} flex-1`}
            />
          </div>
          <input
            type="text"
            placeholder="https://calendly.com/yourname"
            value={newLink.url}
            onChange={(e) => setNewLink((n) => ({ ...n, url: e.target.value }))}
            className={inputCls}
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={addLink}
              disabled={!newLink.label.trim() || !newLink.url.trim()}
              className="flex-1 bg-[#1D4ED8] disabled:opacity-40 text-white text-xs font-semibold py-2 rounded-lg transition-opacity"
            >
              Add link
            </button>
            <button
              type="button"
              onClick={() => { setAddingLink(false); setNewLink({ emoji: "", label: "", url: "" }); }}
              className="px-4 text-xs text-slate-500 hover:text-slate-700"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : atLinkCap ? (
        <PlanGate
          feature="swift-links-cap"
          nativeCopy="Pro feature — Free includes 2 links. More links are only available on the Pro plan"
        >
          <p className="text-[0.6875rem] text-slate-500 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 leading-relaxed">
            Free includes {PLAN_LIMITS.FREE_MAX_LINKS} additional links. <Link href="/upgrade" className="text-[#1D4ED8] font-semibold hover:underline">Upgrade to Pro</Link> to access unlimited additional links.
          </p>
        </PlanGate>
      ) : (
        <button
          type="button"
          onClick={() => setAddingLink(true)}
          className="w-full border border-dashed border-slate-400 text-slate-600 hover:border-[#1D4ED8] hover:text-[#1D4ED8] text-xs font-medium py-2.5 rounded-xl transition-colors"
        >
          + Add link
        </button>
      )}

      {/* Testimonials */}
      <div className="h-px bg-slate-200 my-2" />
      <div className="flex items-center justify-between mb-1">
        <p className="text-xs text-slate-600 font-medium">Testimonials</p>
        <span className="text-[0.625rem] text-slate-600">{testimonials.length} added</span>
      </div>
      <p className="text-[0.6875rem] text-slate-600 mb-3">Social proof from clients or customers, shown on your card.</p>

      {testimonials.length > 0 && (
        <div className="space-y-2 mb-3">
          {testimonials.map((t, i) => (
            <div key={i} className="flex items-start gap-2 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5">
              <div className="flex-1 min-w-0">
                <p className="text-slate-900 text-xs font-semibold">{t.name}</p>
                <p className="text-slate-500 text-[0.6875rem] mt-0.5 leading-snug">&ldquo;{t.text}&rdquo;</p>
              </div>
              <button
                type="button"
                onClick={() => setTestimonials((prev) => prev.filter((_, idx) => idx !== i))}
                className="text-slate-600 hover:text-red-500 transition-colors text-lg leading-none shrink-0 mt-0.5"
                title="Remove"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {addingTestimonial ? (
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3">
          <input
            type="text"
            placeholder="Their name (e.g. Sarah M.)"
            value={newTestimonial.name}
            onChange={(e) => setNewTestimonial((n) => ({ ...n, name: e.target.value }))}
            className={inputCls}
          />
          <textarea
            placeholder="What they said about you..."
            value={newTestimonial.text}
            onChange={(e) => setNewTestimonial((n) => ({ ...n, text: e.target.value }))}
            rows={3}
            className="w-full bg-white border border-slate-200 text-slate-900 placeholder-slate-400 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-[#1D4ED8] transition-colors shadow-sm resize-none"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                if (!newTestimonial.name.trim() || !newTestimonial.text.trim()) return;
                setTestimonials((prev) => [...prev, newTestimonial]);
                setNewTestimonial({ name: "", text: "" });
                setAddingTestimonial(false);
              }}
              disabled={!newTestimonial.name.trim() || !newTestimonial.text.trim()}
              className="flex-1 bg-[#1D4ED8] disabled:opacity-40 text-white text-xs font-semibold py-2 rounded-lg transition-opacity"
            >
              Add testimonial
            </button>
            <button
              type="button"
              onClick={() => { setAddingTestimonial(false); setNewTestimonial({ name: "", text: "" }); }}
              className="px-4 text-xs text-slate-500 hover:text-slate-700"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setAddingTestimonial(true)}
          className="w-full border border-dashed border-slate-400 text-slate-600 hover:border-[#1D4ED8] hover:text-[#1D4ED8] text-xs font-medium py-2.5 rounded-xl transition-colors"
        >
          + Add testimonial
        </button>
      )}

      {/* Template picker */}
      <div className="h-px bg-slate-200 my-2" />
      <p className="text-xs text-slate-600 font-medium">Card design</p>

      {/* Live preview — withoutSocials so it matches the PUBLISHED card, which
          strips the social row. Without it this preview promised a row of social
          links the real card never renders. */}
      <div className="w-full pointer-events-none">
        <SelectedTemplate data={withoutSocials(previewData)} />
      </div>

      <div className="grid grid-cols-2 gap-x-2 gap-y-4 sm:grid-cols-3 pt-3">
        {TEMPLATES.map(({ id, label, Component, tags }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTemplate(id)}
            // Same shape as the marketing gallery: the preview is a real card
            // with real contact links, so the button announced as a container
            // of other controls (axe: nested-interactive). One named button.
            // The "★ Most Popular" ribbon is the only visible text left outside
            // the inert preview, so the name must contain it or Voice Control's
            // "tap Most Popular" finds nothing.
            aria-label={id === "photo-first" ? `${label} template — most popular` : `${label} template`}
            aria-pressed={template === id}
            className="relative text-left rounded-xl border-2 transition-all"
            style={{
              borderColor: template === id ? "#1D4ED8" : "#e2e8f0",
              boxShadow: template === id ? "0 0 0 2px #1D4ED820" : "none",
            }}
          >
            {id === "photo-first" && (
              <span className="absolute -top-2 left-1/2 -translate-x-1/2 z-10 whitespace-nowrap text-[0.53125rem] font-bold uppercase tracking-wide text-white px-2 py-0.5 rounded-full shadow-sm" style={{ background: "#1D4ED8" }}>
                ★ Most Popular
              </span>
            )}
            {/* inert: the preview is a rendered card, not a set of controls. */}
            <div inert className="rounded-[10px] overflow-hidden">
            <div className="w-full pointer-events-none" style={{ transform: "scale(0.85)", transformOrigin: "top left", width: "117%", height: "auto" }}>
              <Component data={SAMPLE_DATA} />
            </div>
            <div className="bg-white px-2 pt-1.5 pb-2">
              <p
                className="text-xs font-semibold text-center truncate"
                style={{ color: template === id ? "#1D4ED8" : "#6b7280", fontSize: 10 }}
              >
                {label}
              </p>
              <div className="flex flex-wrap gap-1 justify-center mt-1">
                {tags.map((tag) => (
                  <span
                    key={tag}
                    className="text-[0.5625rem] font-bold px-1.5 py-0.5 rounded-full"
                    style={{
                      background: template === id ? "#EBF0FF" : "#f1f5f9",
                      color: template === id ? "#1D4ED8" : "#94a3b8",
                    }}
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>
            </div>
          </button>
        ))}
      </div>

      {/* Customization — Pro only */}
      {isPro ? (
        <div className="bg-white border border-slate-200 rounded-2xl px-4 py-4 space-y-4 shadow-sm">
          <div className="flex items-center justify-between">
            <p className="text-xs text-slate-600 font-medium">Accent color</p>
            <div className="flex items-center gap-2">
              <input
                type="color"
                aria-label="Accent colour"
                value={customization.accentColor ?? "#2563eb"}
                onChange={(e) => setCustomization((c) => ({ ...c, accentColor: e.target.value }))}
                className="w-8 h-8 rounded-lg border border-slate-200 cursor-pointer p-0.5 bg-white"
              />
              <span className="text-xs text-slate-600 font-mono">{customization.accentColor ?? "#2563eb"}</span>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {PRESET_COLORS.map((c) => (
              <button
                key={c.value}
                type="button"
                title={c.label}
                onClick={() => setCustomization((prev) => ({ ...prev, accentColor: c.value }))}
                className="w-7 h-7 rounded-full border-2 transition-transform hover:scale-110"
                style={{
                  background: c.value,
                  borderColor: customization.accentColor === c.value ? "#1e293b" : "transparent",
                }}
              />
            ))}
            {customization.accentColor && (
              <button
                type="button"
                onClick={() => setCustomization((prev) => ({ ...prev, accentColor: undefined }))}
                className="text-xs text-slate-600 hover:text-slate-600 px-2"
              >
                Reset
              </button>
            )}
          </div>
          <div>
            <p className="text-xs text-slate-500 font-medium mb-2">Font style</p>
            <div className="flex gap-2 flex-wrap">
              {FONT_OPTIONS.map((f) => (
                <button
                  key={f.label}
                  type="button"
                  onClick={() => setCustomization((prev) => ({ ...prev, font: f.value || undefined }))}
                  className="text-xs px-3 py-1.5 rounded-lg border transition-colors"
                  style={{
                    fontFamily: f.value || "inherit",
                    borderColor: (customization.font ?? "") === f.value ? "#2563eb" : "#e2e8f0",
                    background: (customization.font ?? "") === f.value ? "#eff6ff" : "#fff",
                    color: (customization.font ?? "") === f.value ? "#2563eb" : "#64748b",
                  }}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <PlanGate
          feature="customization"
          nativeCopy="Pro feature — Customization is only available on the Pro plan"
        >
          <div className="bg-slate-50 border border-slate-200 rounded-2xl px-4 py-4 text-center">
            <p className="text-xs text-slate-600 font-medium">Accent color & font</p>
            <p className="text-xs text-slate-600 mt-1">Make it unmistakably yours — unlock the custom designer with Pro.</p>
            <Link href="/upgrade" className="inline-block mt-2 text-xs font-semibold text-[#1D4ED8] hover:underline">Upgrade to Pro →</Link>
          </div>
        </PlanGate>
      )}

      {status === "error" && <p role="alert" className="text-red-500 text-xs text-center">Couldn&apos;t save your changes. Please try again.</p>}

      <button
        type="submit"
        disabled={status === "loading"}
        className="w-full bg-[#1D4ED8] hover:bg-[#1740C4] disabled:opacity-50 text-white font-semibold py-3 rounded-full transition-colors text-sm"
      >
        {status === "loading" ? "Saving…" : status === "saved" ? "Saved ✓" : "Save Changes"}
      </button>
    </form>
  );
}
