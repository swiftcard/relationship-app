"use client";

import { useRef, useState } from "react";
import { compressToBase64 } from "@/lib/scan-card";
import { useIsNativeApp } from "@/lib/platform";
import type { ImportedProfile } from "@/app/api/profile-import/route";

// "Skip the typing" — a screenshot of the person's LinkedIn profile fills the
// builder's boxes. One tap opens the photo picker (a screenshot is a photo on
// their phone), the server reads it once, the fields fill in, and the
// screenshot is dropped. Nothing is stored.
//
// Hidden for a signed-out guest inside the iOS shell: the AI consent gate
// lives on the account, and the App Review rules apply there. The same
// person sees it the moment they sign in.

const FIELD_LABELS: Record<keyof ImportedProfile, string> = {
  name: "name",
  title: "title",
  company: "company",
  city: "location",
  state: "location",
  website: "website",
};

type State =
  | { kind: "idle" }
  | { kind: "working" }
  | { kind: "done"; found: string[] }
  | { kind: "error"; message: string };

export default function ProfileImportButton({
  onImport,
  guest = false,
}: {
  onImport: (fields: ImportedProfile) => void;
  guest?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const native = useIsNativeApp();
  const [state, setState] = useState<State>({ kind: "idle" });

  if (native && guest) return null;

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setState({ kind: "working" });
    try {
      const { base64, mediaType } = await compressToBase64(file);
      const res = await fetch("/api/profile-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64: base64, mediaType }),
      });
      const data = (await res.json().catch(() => ({}))) as ImportedProfile & { message?: string };
      if (!res.ok) {
        setState({ kind: "error", message: data.message || "Couldn't read that screenshot — try a clearer one, or type the details in." });
        return;
      }
      const keys = (Object.keys(FIELD_LABELS) as (keyof ImportedProfile)[]).filter((k) => !!data[k]);
      if (keys.length === 0) {
        setState({ kind: "error", message: "Couldn't find a name or title in that screenshot — try one showing the top of the profile." });
        return;
      }
      onImport(data);
      setState({ kind: "done", found: [...new Set(keys.map((k) => FIELD_LABELS[k]))] });
    } catch {
      setState({ kind: "error", message: "Couldn't read that screenshot — check your connection and try again." });
    }
  }

  return (
    <div className="rounded-2xl border border-blue-500/25 bg-blue-500/[0.06] px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-white text-sm font-semibold">Skip the typing</p>
          <p className="text-gray-400 text-xs mt-0.5 leading-snug">Screenshot your LinkedIn profile and we fill in your name, title and company.</p>
        </div>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={state.kind === "working"}
          className="shrink-0 inline-flex items-center gap-1.5 text-xs font-bold text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-60 px-3.5 py-2.5 rounded-full transition-colors"
        >
          {state.kind === "working" ? (
            <>
              <span className="w-3.5 h-3.5 rounded-full border-2 border-white/40 border-t-white animate-spin" aria-hidden="true" />
              Reading…
            </>
          ) : (
            "Import screenshot"
          )}
        </button>
      </div>
      {state.kind === "done" && (
        <p role="status" className="text-green-400 text-xs mt-2">
          Filled in your {state.found.join(", ")} — check them below.
        </p>
      )}
      {state.kind === "error" && (
        <p role="alert" className="text-amber-400 text-xs mt-2">{state.message}</p>
      )}
      <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />
    </div>
  );
}
