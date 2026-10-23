"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

// While the manager is still writing, refresh the room every few seconds so
// the answer appears on its own. Stops after 90 seconds; a reload always works.
export default function ChatAutoRefresh({ active }: { active: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const started = Date.now();
    const t = setInterval(() => {
      if (Date.now() - started > 90_000) return clearInterval(t);
      router.refresh();
    }, 3000);
    return () => clearInterval(t);
  }, [active, router]);
  return null;
}
