"use client";

/**
 * The "Called" checkbox. Ticking it saves straight away (it submits the form
 * it sits in, notes and all). Before hydration it is an ordinary checkbox and
 * the Save button beside it does the same job.
 */
export default function CalledBox({ called, who }: { called: boolean; who: string }) {
  return (
    <label className="inline-flex items-center gap-2 sc-t-subhead font-medium cursor-pointer min-h-[32px]">
      <input
        type="checkbox"
        name="called"
        defaultChecked={called}
        aria-label={`Called ${who}`}
        className="w-5 h-5"
        style={{ accentColor: "var(--sc-tint)" }}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
      />
      Called
    </label>
  );
}
