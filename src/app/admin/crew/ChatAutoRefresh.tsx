"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

// While the manager is still writing (or an agent is running), refresh the
// page every few seconds so the answer appears on its own. Stops after a
// while (90 seconds by default); a reload always works. Each refresh re-runs
// the whole page on the server, so it waits while the tab is hidden and
// catches up the moment it is looked at again.
export default function ChatAutoRefresh({ active, everyMs = 5000, forMs = 90_000 }: { active: boolean; everyMs?: number; forMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const started = Date.now();
    const t = setInterval(() => {
      if (Date.now() - started > forMs) return clearInterval(t);
      if (document.visibilityState === "hidden") return;
      router.refresh();
    }, everyMs);
    const onVisible = () => {
      if (document.visibilityState === "visible" && Date.now() - started <= forMs) router.refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [active, router, everyMs, forMs]);
  return null;
}
