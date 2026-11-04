"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type SlotsState = { status: "idle" | "loading" | "ready" | "error"; slots: string[] };

/** The open demo times from /api/demo/slots. `reload` after a "just taken". */
export function useDemoSlots(enabled: boolean): SlotsState & { reload: () => void } {
  const [state, setState] = useState<SlotsState>({ status: enabled ? "loading" : "idle", slots: [] });
  const seq = useRef(0);

  // Only ever sets state once the answer is in.
  const fetchSlots = useCallback(() => {
    const mine = ++seq.current;
    return fetch("/api/demo/slots", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { slots?: unknown }) => {
        if (mine !== seq.current) return;
        const slots = Array.isArray(d.slots) ? d.slots.filter((x): x is string => typeof x === "string") : [];
        setState({ status: "ready", slots });
      })
      .catch(() => { if (mine === seq.current) setState((s) => ({ status: "error", slots: s.slots })); });
  }, []);

  const reload = useCallback(() => {
    setState((s) => ({ status: "loading", slots: s.slots }));
    void fetchSlots();
  }, [fetchSlots]);

  useEffect(() => { if (enabled) void fetchSlots(); }, [enabled, fetchSlots]);
  return { ...state, reload };
}
