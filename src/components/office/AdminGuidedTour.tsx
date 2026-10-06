"use client";

// Thin wrapper around the shared tour engine, pointed at the Office admin
// step list and its own storage keys — runs independently of the main
// dashboard tour. Mounted once in the /office/admin layout.

import { useRouter } from "next/navigation";
import GuidedTour from "@/components/GuidedTour";
import { adminTourSteps } from "@/lib/admin-tour-steps";
import { ADMIN_TOUR_RUNNING, ADMIN_TOUR_INDEX, ADMIN_TOUR_START_EVENT, endAdminTour } from "@/lib/tour";

// The step list is cut to the viewer's role (lib/admin-tour-steps): no Branding
// steps for a role without the Branding tab, no invite step for one that can't invite.
export default function AdminGuidedTour({ canBrand, canInvite }: { canBrand: boolean; canInvite: boolean }) {
  const router = useRouter();
  return (
    <GuidedTour
      steps={adminTourSteps({ canBrand, canInvite })}
      runningKey={ADMIN_TOUR_RUNNING}
      indexKey={ADMIN_TOUR_INDEX}
      startEvent={ADMIN_TOUR_START_EVENT}
      onFinish={(completed) => {
        endAdminTour(completed);
        router.push("/office/admin");
      }}
    />
  );
}
