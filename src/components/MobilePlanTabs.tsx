"use client";

// Mobile-only pill row shown above the plan grid (Free/Pro/Office stack in a
// single column below `md`, forcing a lot of scrolling to compare them). This
// lets a phone visitor jump straight to one tier — defaulting to Pro, since
// that's the plan we want most visitors on mobile to land on — instead of
// scrolling past Free first. Desktop already shows all three side by side and
// never renders this. The same pills on every plan chooser (PlanTierCards),
// web and app, over any page theme.
export type PlanTier = "free" | "pro" | "office";

const TABS: { key: PlanTier; label: string }[] = [
  { key: "free", label: "Free" },
  { key: "pro", label: "Pro" },
  { key: "office", label: "Office" },
];

export default function MobilePlanTabs({
  active,
  onChangeAction,
  tiers,
}: {
  active: PlanTier;
  onChangeAction: (tier: PlanTier) => void;
  tiers?: PlanTier[];
}) {
  const tabs = tiers ? TABS.filter((t) => tiers.includes(t.key)) : TABS;

  return (
    <div className="md:hidden flex justify-center mb-5">
      <div className="inline-flex items-center gap-1 rounded-full p-1 border bg-slate-100 border-slate-200">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => onChangeAction(t.key)}
            aria-pressed={active === t.key}
            className="px-4 py-1.5 rounded-full text-xs font-bold transition-colors"
            style={{ background: active === t.key ? "#2563EB" : "transparent", color: active === t.key ? "#fff" : "#334155" }}
          >
            {t.label}
          </button>
        ))}
      </div>
    </div>
  );
}
