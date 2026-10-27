// ── One look for every state a panel can be in ─────────────────────────────
// Loading, failed, empty, and "not measured yet". Each has exactly one
// appearance across the whole console, so the owner learns it once.
// No hooks: usable from server and client components alike.

export function Skeleton({ className = "" }: { className?: string }) {
  return <div aria-hidden className={`adm-skel ${className}`} />;
}

/** The shape of a page while its data loads: header, KPI row, a chart, a list. */
export function PageSkeleton({ kpis = 4 }: { kpis?: number }) {
  return (
    <div role="status" aria-label="Loading" className="space-y-6 sm:space-y-8">
      <div className={`grid gap-3 sm:gap-4 grid-cols-2 ${kpis >= 4 ? "lg:grid-cols-4" : "lg:grid-cols-3"}`}>
        {Array.from({ length: kpis }, (_, i) => (
          <div key={i} className="adm-card p-4 sm:p-5 space-y-3">
            <Skeleton className="h-3.5 w-24" />
            <Skeleton className="h-8 w-20" />
            <Skeleton className="h-3 w-28" />
          </div>
        ))}
      </div>
      <div className="adm-card p-4 sm:p-5 space-y-4">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-40 w-full" />
      </div>
      <div className="grid gap-4 sm:gap-5 lg:grid-cols-2">
        {[0, 1].map((i) => (
          <div key={i} className="adm-card p-4 sm:p-5 space-y-3">
            <Skeleton className="h-4 w-32" />
            {[0, 1, 2, 3].map((j) => <Skeleton key={j} className="h-3 w-full" />)}
          </div>
        ))}
      </div>
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="adm-card p-6 sm:p-8 text-center">
      <p className="sc-t-headline">Couldn&apos;t load this</p>
      <p className="adm-muted sc-t-subhead mt-1">{message}</p>
      {onRetry && (
        <button type="button" onClick={onRetry} className="sc-btn sc-btn-tinted sc-btn-sm mt-4">
          Try again
        </button>
      )}
    </div>
  );
}

export function EmptyState({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <p className={`adm-muted sc-t-subhead py-6 text-center ${className}`}>{children}</p>;
}

/**
 * A number the product doesn't measure yet. Drawn in its final place so the
 * layout is complete, but dashed and labelled so it can never be read as zero.
 */
export function NotTracked({ title, detail, className = "" }: { title: string; detail: string; className?: string }) {
  return (
    <div className={`adm-notracked p-4 sm:p-5 ${className}`}>
      <p className="sc-t-footnote font-semibold" style={{ color: "var(--sc-label-muted)" }}>{title}</p>
      <p className="adm-kpi-value mt-1.5" aria-hidden style={{ color: "var(--sc-label-3)" }}>—</p>
      <p className="sc-t-caption mt-1.5">Not tracked yet · {detail}</p>
    </div>
  );
}

/** A collapsed "how this is counted" note at the foot of a tab. */
export function HowCounted({ children }: { children: React.ReactNode }) {
  return (
    <details className="adm-card px-4 sm:px-5 py-3 group">
      <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden flex items-center justify-between gap-3 min-h-[36px]">
        <span className="sc-t-subhead font-medium">How these numbers are counted</span>
        <span aria-hidden className="adm-muted transition-transform group-open:rotate-90">›</span>
      </summary>
      <div className="adm-muted sc-t-footnote space-y-2 pt-2 pb-1">{children}</div>
    </details>
  );
}
