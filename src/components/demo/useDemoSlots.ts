"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type SlotsPrefill = { name: string; company: string; email: string; phone: string; teamSize: string };
export type SlotsState = {
  status: "idle" | "loading" | "ready" | "error";
  slots: string[];
  /** The length the server is offering: 30, or 15 for a setup call from a preview. */
  durationMin: number | null;
  /** What the form starts with when it was opened from a Card Builder preview. */
  prefill: SlotsPrefill | null;
};

const str = (v: unknown) => (typeof v === "string" ? v : "");

/** The open demo times from /api/demo/slots. `reload` after a "just taken".
 *  `query` rides on the request: "ref=<preview slug>" or "len=15". */
export function useDemoSlots(enabled: boolean, query = ""): SlotsState & { reload: () => void } {
  const [state, setState] = useState<SlotsState>({ status: enabled ? "loading" : "idle", slots: [], durationMin: null, prefill: null });
  const seq = useRef(0);

  // Only ever sets state once the answer is in.
  const fetchSlots = useCallback(() => {
    const mine = ++seq.current;
    return fetch(`/api/demo/slots${query ? `?${query}` : ""}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { slots?: unknown; durationMin?: unknown; prefill?: unknown }) => {
        if (mine !== seq.current) return;
        const slots = Array.isArray(d.slots) ? d.slots.filter((x): x is string => typeof x === "string") : [];
        const p = d.prefill && typeof d.prefill === "object" ? (d.prefill as Record<string, unknown>) : null;
        setState({
          status: "ready", slots,
          durationMin: typeof d.durationMin === "number" ? d.durationMin : null,
          prefill: p ? { name: str(p.name), company: str(p.company), email: str(p.email), phone: str(p.phone), teamSize: str(p.teamSize) } : null,
        });
      })
      .catch(() => { if (mine === seq.current) setState((s) => ({ ...s, status: "error" })); });
  }, [query]);

  const reload = useCallback(() => {
    setState((s) => ({ ...s, status: "loading" }));
    void fetchSlots();
  }, [fetchSlots]);

  useEffect(() => { if (enabled) void fetchSlots(); }, [enabled, fetchSlots]);
  return { ...state, reload };
}
