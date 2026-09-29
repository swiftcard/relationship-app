// Call · Text · Email circles for the MARKETING replicas of the app
// (DashboardDemo, /preview) — the look of components/ContactQuickActions,
// without links: these are fictional people.

// ── Contact row action button — mirrors components/ContactQuickActions ──────
// A span, not a link: these are fictional people (no tel:/mailto: to nowhere).
// The .sc-qa-* classes are the product's own, so the light theme darkens them
// exactly as it does on the real Contacts page.
function ActionButton({ label, tone, children }: { label: string; tone: "call" | "text" | "email"; children: React.ReactNode }) {
  return (
    <span
      title={label}
      aria-label={label}
      className={`sc-qa-${tone} flex items-center justify-center w-8 h-8 rounded-full border shrink-0`}
    >
      {children}
    </span>
  );
}

export default function DemoContactActions({ name, phone, email }: { name: string; phone: boolean; email: boolean }) {
  return (
    <div className="flex items-center gap-1 shrink-0">
      {phone && (
        <ActionButton label={`Call ${name}`} tone="call">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-3.5 h-3.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z" />
          </svg>
        </ActionButton>
      )}
      {phone && (
        <ActionButton label={`Text ${name}`} tone="text">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-3.5 h-3.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z" />
          </svg>
        </ActionButton>
      )}
      {email && (
        <ActionButton label={`Email ${name}`} tone="email">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-3.5 h-3.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25H4.5a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5H4.5a2.25 2.25 0 00-2.25 2.25m19.5 0l-9.75 6.75L2.25 6.75" />
          </svg>
        </ActionButton>
      )}
    </div>
  );
}
