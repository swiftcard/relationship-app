"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

// While the manager is still writing (or an agent is running), refresh the
// page every few seconds so the answer appears on its own. Stops after a
// while (90 seconds by default); a reload always works.
export default function ChatAutoRefresh({ active, everyMs = 3000, forMs = 90_000 }: { active: boolean; everyMs?: number; forMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const started = Date.now();
    const t = setInterval(() => {
      if (Date.now() - started > forMs) return clearInterval(t);
      router.refresh();
    }, everyMs);
    return () => clearInterval(t);
  }, [active, router, everyMs, forMs]);
  return null;
}
