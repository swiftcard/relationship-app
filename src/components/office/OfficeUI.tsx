// Shared, presentational bits for the /office/admin portal. Server-safe (no
// client hooks) so any page can use them directly.

export function StatTile({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl px-4 py-4">
      <p className="text-2xl font-bold text-white tabular-nums">{value}</p>
      <p className="text-xs text-gray-500 mt-0.5">{label}</p>
      {hint && <p className="text-[0.6875rem] text-gray-600 mt-1">{hint}</p>}
    </div>
  );
}

export function PageHead({ title, desc, action }: { title: string; desc?: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 mb-5">
      <div className="min-w-0">
        <h1 className="text-[1.75rem] font-bold text-white tracking-tight">{title}</h1>
        {desc && <p className="text-gray-500 text-sm mt-0.5">{desc}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl p-10 text-center">
      <p className="text-gray-500 text-sm">{children}</p>
    </div>
  );
}

export function Badge({ tone, children }: { tone: "green" | "amber" | "gray" | "purple" | "red"; children: React.ReactNode }) {
  const tones: Record<string, string> = {
    green: "bg-green-500/10 text-green-400 border-green-500/20",
    amber: "bg-amber-500/10 text-amber-400 border-amber-500/20",
    gray: "bg-gray-800 text-gray-400 border-gray-700",
    purple: "bg-purple-500/10 text-purple-300 border-purple-500/20",
    red: "bg-red-500/10 text-red-400 border-red-500/20",
  };
  return (
    <span className={`text-[0.625rem] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full border ${tones[tone]}`}>
      {children}
    </span>
  );
}
